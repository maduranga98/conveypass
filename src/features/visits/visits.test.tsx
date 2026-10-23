import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WithId } from '@/types'
import type { DailySummary, Visit } from '@/types/visits'

const ts = (ms: number) => ({ toMillis: () => ms }) as never
const WHEN = Date.UTC(2026, 2, 10, 6, 0, 0)

const checkInVisit = vi.fn()
const checkOutVisit = vi.fn()
const logUnloadingCheck = vi.fn()
let active: WithId<Visit>[] = []
let summary: DailySummary | undefined
let role = 'security'

vi.mock('@/lib/api', () => ({
  checkInVisit: (...a: unknown[]) => checkInVisit(...a),
  checkOutVisit: (...a: unknown[]) => checkOutVisit(...a),
  logUnloadingCheck: (...a: unknown[]) => logUnloadingCheck(...a),
}))
vi.mock('@/lib/firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ col, id }),
  getDoc: async () => ({ exists: () => true, data: () => ({ tenantId: 'T', plateNo: 'WP LJ-4821' }) }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/features/auth/useAuth', () => ({ useSession: () => ({ claims: { tenantId: 'T', role }, profile: { name: 'Pat' } }) }))
vi.mock('@/features/gate/useGate', () => ({ useGates: () => ({ gates: [{ id: 'main', name: 'Main Gate' }], gate: { id: 'main', name: 'Main Gate' }, setGate: vi.fn() }) }))
vi.mock('@/features/passes/useOnline', () => ({ useOnline: () => true }))
vi.mock('@/features/passes/useToday', () => ({ useNow: () => WHEN + 90 * 60_000 }))
vi.mock('@/features/scan/QrScanner', () => ({
  QrScanner: ({ onVehicle }: { onVehicle: (id: string) => void }) => (
    <button type="button" onClick={() => onVehicle('veh_aaaaaaaaaa')}>fake scan</button>
  ),
}))
vi.mock('./queries', () => ({
  useActiveVisits: () => ({ items: active, status: 'ready', error: null, retry: vi.fn() }),
  useDailySummary: () => ({ data: summary, isError: false, isPending: summary === undefined, refetch: vi.fn() }),
}))

const visit = (id: string, plate: string, over: Partial<Visit> = {}): WithId<Visit> =>
  ({
    id, tenantId: 'T', vehicleId: 'veh_aaaaaaaaaa', driverId: 'd1', contractorId: 'C1', plateNo: plate, driverName: 'Dan Driver',
    checkIn: { timestamp: ts(WHEN), dateKey: '20260310', securityUserId: 's', securityUserName: 'Gate Guard', gateId: 'main', gateLocation: 'Main Gate', requestId: 'r' },
    unloadingCheck: null, checkOut: null, status: 'checked_in', driverOnDutyLock: true, dwellWarning: false, ...over,
  }) as WithId<Visit>

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
)

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open') }
  active = []
  summary = undefined
  role = 'security'
  checkInVisit.mockReset()
  checkOutVisit.mockReset().mockResolvedValue({ visitId: 'vis_a', at: WHEN, unloadingMissing: false })
  logUnloadingCheck.mockReset().mockResolvedValue({ visitId: 'vis_a', at: WHEN })
})

/** A Cloud Functions error as the SDK delivers it: a FirebaseError with `details.reason`. */
const apiError = async (code: string, reason: string) => {
  const { FirebaseError } = await import('firebase/app')
  return Object.assign(new FirebaseError(code, 'x'), { details: { reason } })
}

const typePin = async (user: ReturnType<typeof userEvent.setup>, pin: string) => {
  for (const d of pin) await user.click(screen.getByRole('button', { name: d }))
}

describe('check-in (security)', () => {
  const start = async () => {
    const { default: CheckInPage } = await import('./CheckInPage')
    const user = userEvent.setup()
    render(wrap(<CheckInPage />))
    await user.click(await screen.findByRole('button', { name: 'fake scan' }))
    await screen.findByText('WP LJ-4821')
    return user
  }

  it('scan, driver PIN, LET IN: sends the ids, the gate and the PIN once, and shows the driver', async () => {
    checkInVisit.mockResolvedValue({ outcome: 'checked_in', visitId: 'vis_x', at: WHEN, driverName: 'Dan Driver', plateNo: 'WP LJ-4821' })
    const user = await start()
    await typePin(user, '48291736')
    expect(await screen.findByText('LET IN')).toBeInTheDocument()
    expect(screen.getByText('Driver: Dan Driver')).toBeInTheDocument()
    expect(checkInVisit).toHaveBeenCalledTimes(1)
    expect(checkInVisit).toHaveBeenCalledWith(expect.objectContaining({ vehicleId: 'veh_aaaaaaaaaa', pin: '48291736', gateId: 'main', visitId: expect.stringMatching(/^vis_[a-z0-9]{10}$/), requestId: expect.any(String) }))
  })

  it('never shows the PIN digits, only dots', async () => {
    const user = await start()
    await user.click(screen.getByRole('button', { name: '4' }))
    await user.click(screen.getByRole('button', { name: '8' }))
    const boxes = screen.getByRole('img', { name: /2 of 8/ })
    expect(boxes.textContent).toBe('••')
  })

  it('shows every reason when entry is refused, taken from the eligibility output', async () => {
    checkInVisit.mockResolvedValue({
      outcome: 'blocked', driverName: 'Dan Driver', plateNo: 'WP LJ-4821',
      eligibility: {
        status: 'blocked', blocked: true, eligible: false, checkedAt: 1,
        vehicle: { id: 'v', documentStatus: 'expired', blocked: false, penalties: [] },
        driver: { id: 'd', documentStatus: 'valid', blocked: true, penalties: [{ id: 'p', typeName: 'Speeding', permanent: true, endDate: null }] },
        inspection: { status: 'needs_reinspection', cleared: false, reason: 'document_expired', at: 1 },
      },
    })
    const user = await start()
    await typePin(user, '48291736')
    expect(await screen.findByText('DO NOT LET IN')).toBeInTheDocument()
    for (const line of ['Vehicle documents expired', 'Driver suspended: Speeding', 'Needs re-inspection: a document expired']) expect(screen.getByText(line)).toBeInTheDocument()
  })

  it('a wrong PIN keeps the keypad, clears the digits and reuses the same visit id for the retry', async () => {
    checkInVisit.mockRejectedValueOnce(await apiError('functions/unauthenticated', 'pin-invalid'))
    checkInVisit.mockResolvedValueOnce({ outcome: 'checked_in', visitId: 'vis_x', at: WHEN, driverName: 'Dan Driver', plateNo: 'WP LJ-4821' })
    const user = await start()
    await typePin(user, '11111111')
    expect(await screen.findByText('That PIN didn’t work for this vehicle.')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /0 of 8/ })).toBeInTheDocument()
    await typePin(user, '48291736')
    expect(await screen.findByText('LET IN')).toBeInTheDocument()
    const [first, second] = checkInVisit.mock.calls.map((c) => c[0] as { visitId: string; requestId: string })
    expect(second?.visitId).toBe(first?.visitId)
    expect(second?.requestId).toBe(first?.requestId)
  })

  it('a driver who is already on a visit ends the attempt with a clear message', async () => {
    checkInVisit.mockRejectedValue(await apiError('functions/failed-precondition', 'driver-on-duty'))
    const user = await start()
    await typePin(user, '48291736')
    expect(await screen.findByText('Driver already on a visit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next vehicle' })).toBeInTheDocument()
  })
})

describe('check-out (security)', () => {
  it('lists vehicles on site, longest first, with the unloading state and a long-stay flag', async () => {
    active = [
      visit('vis_a', 'WP LJ-4821', { dwellWarning: true }),
      visit('vis_b', 'CAB-1', { unloadingCheck: { performed: true, timestamp: ts(WHEN), dateKey: '20260310', officerUserId: 'y', officerName: 'Yard', unloaded: true, unloadLocation: 'Bay 3' } }),
    ]
    const { default: CheckOutPage } = await import('./CheckOutPage')
    render(wrap(<CheckOutPage />))
    expect(await screen.findByText('2 on site')).toBeInTheDocument()
    expect(screen.getByText('Long stay')).toBeInTheDocument()
    expect(screen.getByText('Unloaded')).toBeInTheDocument()
    expect(screen.getByText('Not checked yet')).toBeInTheDocument()
    expect(screen.getAllByText(/1 h 30 min on site/).length).toBe(2)
  })

  it('confirm sends one request, warns when unloading was not checked, and never blocks', async () => {
    active = [visit('vis_a', 'WP LJ-4821')]
    checkOutVisit.mockResolvedValue({ visitId: 'vis_a', at: WHEN, unloadingMissing: true })
    const { default: CheckOutPage } = await import('./CheckOutPage')
    const user = userEvent.setup()
    render(wrap(<CheckOutPage />))
    await user.click(await screen.findByRole('button', { name: /WP LJ-4821/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Unloading has not been checked yet/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }))
    await waitFor(() => expect(checkOutVisit).toHaveBeenCalledTimes(1))
    expect(checkOutVisit).toHaveBeenCalledWith({ visitId: 'vis_a', requestId: expect.any(String) })
    expect(await screen.findByText('WP LJ-4821 checked out')).toBeInTheDocument()
    expect(screen.getByText('Unloading was not checked for this visit.')).toBeInTheDocument()
  })

  it('a scanned vehicle that is not checked in says so', async () => {
    const { default: CheckOutPage } = await import('./CheckOutPage')
    const user = userEvent.setup()
    render(wrap(<CheckOutPage />))
    await user.click(await screen.findByRole('button', { name: 'Scan vehicle' }))
    await user.click(await screen.findByRole('button', { name: 'fake scan' }))
    expect(await screen.findByText('This vehicle is not checked in.')).toBeInTheDocument()
  })
})

describe('unloading check (Yard Officer)', () => {
  beforeEach(() => {
    role = 'yard'
    active = [visit('vis_a', 'WP LJ-4821'), visit('vis_b', 'CAB-1', { unloadingCheck: { performed: true, timestamp: ts(WHEN), dateKey: '20260310', officerUserId: 'y', officerName: 'Yard', unloaded: true, unloadLocation: 'Bay 3' } })]
  })

  it('"yes" needs a place; save sends only the unloading fields', async () => {
    const { default: UnloadingPage } = await import('./UnloadingPage')
    const user = userEvent.setup()
    render(wrap(<UnloadingPage />))
    await user.click(await screen.findByRole('button', { name: /WP LJ-4821/ }))
    const dialog = await screen.findByRole('dialog')
    const save = within(dialog).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: /Yes, unloaded/ }))
    expect(save).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Bay 3' })).toBeInTheDocument() // a recent place
    await user.type(within(dialog).getByLabelText('Where was it unloaded?'), 'Bay 5')
    await user.click(save)
    await waitFor(() => expect(logUnloadingCheck).toHaveBeenCalledWith({ visitId: 'vis_a', unloaded: true, unloadLocation: 'Bay 5' }))
  })

  it('"no" saves without a place', async () => {
    const { default: UnloadingPage } = await import('./UnloadingPage')
    const user = userEvent.setup()
    render(wrap(<UnloadingPage />))
    await user.click(await screen.findByRole('button', { name: /WP LJ-4821/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /No, not unloaded/ }))
    expect(within(dialog).queryByLabelText('Where was it unloaded?')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(logUnloadingCheck).toHaveBeenCalledWith({ visitId: 'vis_a', unloaded: false }))
  })

  it('starts from what was already logged, so it can be corrected', async () => {
    const { default: UnloadingPage } = await import('./UnloadingPage')
    const user = userEvent.setup()
    render(wrap(<UnloadingPage />))
    await user.click(await screen.findByRole('button', { name: /CAB-1/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: /Yes, unloaded/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByLabelText('Where was it unloaded?')).toHaveValue('Bay 3')
  })
})

describe('daily summary', () => {
  const base: DailySummary = { dateKey: '20260310', generatedAt: WHEN, dwellLimitHours: 16, tiles: {}, dwell: [] }

  it('shows exactly the tiles the server returned for the role', async () => {
    role = 'yard'
    summary = { ...base, tiles: { unloads: 3, awaitingUnload: 2, onSite: 5, dwellWarnings: 0 } }
    const { default: DailySummaryPage } = await import('./DailySummaryPage')
    render(wrap(<DailySummaryPage backTo="/yard" />))
    expect(await screen.findByText('Unloading checks')).toBeInTheDocument()
    expect(screen.getByText('Waiting for unloading check')).toBeInTheDocument()
    expect(screen.queryByText('Suspensions issued')).not.toBeInTheDocument()
    expect(screen.queryByText('Checked in')).not.toBeInTheDocument()
    expect(screen.getByText('No long stays.')).toBeInTheDocument()
  })

  it('raises a visible warning for long stays, links admins to the visit, and says nothing is blocked', async () => {
    role = 'admin'
    summary = { ...base, tiles: { checkIns: 4, dwellWarnings: 1 }, dwell: [{ visitId: 'vis_a', plateNo: 'WP LJ-4821', driverName: 'Dan Driver', checkInAt: WHEN, hours: 17 }] }
    const { default: DailySummaryPage } = await import('./DailySummaryPage')
    render(wrap(<DailySummaryPage />))
    expect(await screen.findByText('Warning only. Nothing is blocked.')).toBeInTheDocument()
    expect(screen.getAllByText('On site for 16 hours or more').length).toBeGreaterThan(0)
    expect(screen.getByText('17 h on site')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /WP LJ-4821/ })).toHaveAttribute('href', '/admin/visits/vis_a')
  })

  it('security sees the alert but gets no link to the full timeline', async () => {
    role = 'security'
    summary = { ...base, tiles: { checkIns: 4, dwellWarnings: 1 }, dwell: [{ visitId: 'vis_a', plateNo: 'WP LJ-4821', driverName: 'Dan Driver', checkInAt: WHEN, hours: 17 }] }
    const { default: DailySummaryPage } = await import('./DailySummaryPage')
    render(wrap(<DailySummaryPage backTo="/security" />))
    expect(await screen.findByText('17 h on site')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /WP LJ-4821/ })).not.toBeInTheDocument()
  })
})

describe('visit timeline', () => {
  it('shows who did each stage and what is still to do', async () => {
    const { VisitTimeline } = await import('./VisitTimeline')
    const done = visit('vis_a', 'WP LJ-4821', {
      unloadingCheck: { performed: true, timestamp: ts(WHEN + 3_600_000), dateKey: '20260310', officerUserId: 'y', officerName: 'Yara Yard', unloaded: true, unloadLocation: 'Bay 3' },
    })
    const { rerender } = render(<VisitTimeline visit={done} />)
    expect(screen.getByText('by Gate Guard')).toBeInTheDocument()
    expect(screen.getByText('by Yara Yard')).toBeInTheDocument()
    expect(screen.getByText('Unloaded · Place: Bay 3')).toBeInTheDocument()
    expect(screen.getByText('Still on site')).toBeInTheDocument()
    rerender(<VisitTimeline visit={visit('vis_b', 'CAB-1')} />)
    expect(screen.getAllByText('Not done yet').length).toBe(2) // unloading and check-out
    rerender(
      <VisitTimeline visit={{ ...done, status: 'checked_out', checkOut: { timestamp: ts(WHEN + 7_200_000), dateKey: '20260310', securityUserId: 's2', securityUserName: 'Night Guard', requestId: 'r2' } }} />,
    )
    expect(screen.getByText('by Night Guard')).toBeInTheDocument()
    expect(screen.queryByText('Still on site')).not.toBeInTheDocument()
  })
})
