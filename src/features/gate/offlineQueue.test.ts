import 'fake-indexeddb/auto'
import { FirebaseError } from 'firebase/app'
import { createStore } from 'idb-keyval'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyGateError, gateErrorMessage, isRetryable } from './gateErrors'
import { flushQueue, MAX_QUEUE, OfflineQueue, type NewQueueItem } from './offlineQueue'

let n = 0
let dbName = ''
const store = () => createStore(dbName, 'queue')
const queue = () => new OfflineQueue('queue:sec1', store())

const checkInItem = (i: number, over: Partial<NewQueueItem> = {}): NewQueueItem =>
  ({
    type: 'checkIn',
    requestId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    payload: { passId: `veh_${String(i).padStart(10, '0')}_20260310`, expectedAttempt: 1, gateId: 'main', requestId: `r${i}`, offlineCapturedAt: '2026-03-10T08:00:00.000Z' },
    capturedAtISO: '2026-03-10T08:00:00.000Z',
    plateNo: `CAB-${i}`,
    vehicleId: `veh_${String(i).padStart(10, '0')}`,
    createdAt: 1000 + i,
    ...over,
  }) as NewQueueItem

const typed = (code: string, reason: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new FirebaseError(`functions/${code}`, reason), { details: { reason, ...extra } })
const network = () => new FirebaseError('functions/internal', 'internal')

beforeEach(() => {
  dbName = `convoypass-test-${++n}`
  vi.stubGlobal('navigator', { onLine: true })
})

describe('OfflineQueue', () => {
  it('enqueues and lists oldest first', async () => {
    const q = queue()
    await q.enqueue(checkInItem(3))
    await q.enqueue(checkInItem(1))
    await q.enqueue(checkInItem(2))
    expect((await q.list()).map((i) => i.plateNo)).toEqual(['CAB-1', 'CAB-2', 'CAB-3'])
    expect((await q.list()).every((i) => i.status === 'waiting')).toBe(true)
  })
  it('dedupes: the same requestId, or a second waiting check-in for the same pass', async () => {
    const q = queue()
    expect(await q.enqueue(checkInItem(1))).toMatchObject({ ok: true, duplicate: false })
    expect(await q.enqueue(checkInItem(1))).toMatchObject({ ok: true, duplicate: true })
    const samePass = checkInItem(1, { requestId: 'another-request' } as Partial<NewQueueItem>)
    expect(await q.enqueue(samePass)).toMatchObject({ ok: true, duplicate: true, item: { requestId: checkInItem(1).requestId } })
    expect(await q.list()).toHaveLength(1)
  })
  it('refuses new items beyond 50', async () => {
    const q = queue()
    for (let i = 0; i < MAX_QUEUE; i++) expect(await q.enqueue(checkInItem(i))).toMatchObject({ ok: true })
    expect(await q.enqueue(checkInItem(99))).toEqual({ ok: false, reason: 'full' })
    expect(await q.list()).toHaveLength(MAX_QUEUE)
  })
  it('survives a reload (a new store on the same IndexedDB)', async () => {
    await queue().enqueue(checkInItem(1))
    await queue().enqueue(checkInItem(2))
    const reopened = new OfflineQueue('queue:sec1', createStore(dbName, 'queue'))
    expect((await reopened.list()).map((i) => i.plateNo)).toEqual(['CAB-1', 'CAB-2'])
  })
  it('keeps one queue per account', async () => {
    await queue().enqueue(checkInItem(1))
    expect(await new OfflineQueue('queue:sec2', store()).list()).toEqual([])
  })
})

describe('flushQueue', () => {
  it('sends oldest first, one at a time, and removes what succeeded', async () => {
    const q = queue()
    for (const i of [2, 1, 3]) await q.enqueue(checkInItem(i))
    const order: string[] = []
    let inFlight = 0
    const send = vi.fn(async (item: { plateNo: string }) => {
      inFlight++
      expect(inFlight).toBe(1)
      order.push(item.plateNo)
      await Promise.resolve()
      inFlight--
    })
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 3, failed: 0, stopped: false })
    expect(order).toEqual(['CAB-1', 'CAB-2', 'CAB-3'])
    expect(await q.list()).toEqual([])
  })
  it('a network error is retryable: it stops the run and keeps the item and the order', async () => {
    const q = queue()
    for (const i of [1, 2]) await q.enqueue(checkInItem(i))
    const send = vi.fn().mockRejectedValueOnce(network())
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 0, failed: 0, stopped: true })
    expect(send).toHaveBeenCalledTimes(1)
    expect((await q.list()).map((i) => [i.plateNo, i.status])).toEqual([['CAB-1', 'waiting'], ['CAB-2', 'waiting']])
    // Next run (back online) sends both; the retry reuses the same requestId.
    send.mockResolvedValue(undefined)
    expect(await flushQueue(q, send, classifyGateError)).toMatchObject({ sent: 2 })
    expect(send.mock.calls.map((c) => (c[0] as { requestId: string }).requestId)).toEqual([checkInItem(1).requestId, checkInItem(1).requestId, checkInItem(2).requestId])
  })
  it('unavailable is retryable too; offline always is', () => {
    expect(isRetryable(new FirebaseError('functions/unavailable', 'unavailable'))).toBe(true)
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryable(typed('internal', 'internal'))).toBe(true)
    vi.stubGlobal('navigator', { onLine: false })
    expect(isRetryable(typed('failed-precondition', 'pass-not-approved'))).toBe(true)
  })
  it('a typed server refusal is final: marked failed with a readable message, kept, and the run goes on', async () => {
    const q = queue()
    for (const i of [1, 2]) await q.enqueue(checkInItem(i))
    const send = vi.fn().mockRejectedValueOnce(typed('failed-precondition', 'pass-not-approved')).mockResolvedValueOnce(undefined)
    expect(await flushQueue(q, send, classifyGateError)).toEqual({ sent: 1, failed: 1, stopped: false })
    expect(await q.list()).toMatchObject([{ plateNo: 'CAB-1', status: 'failed', error: 'This pass is not approved any more. Review it again.' }])
    // Failed items are not resent; they wait for "Dismiss".
    send.mockClear()
    await flushQueue(q, send, classifyGateError)
    expect(send).not.toHaveBeenCalled()
    await q.remove(checkInItem(1).requestId)
    expect(await q.list()).toEqual([])
  })
  it('"already checked in by someone else" reads as a sentence with the time and the guard', () => {
    const at = new Date(2026, 2, 10, 8, 14).getTime()
    expect(gateErrorMessage(typed('already-exists', 'pass-checked-in', { at, byName: 'Nimal' }))).toMatch(/^Already let in at .*08:14.* by Nimal$/)
  })
})
