// Runs the real Firestore data port against the emulator (`npm run test:functions` starts it).
// Without FIRESTORE_EMULATOR_HOST the whole file is skipped, so a bare `vitest run` stays hermetic.
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PassConflictError, PlateTakenError, type Deps } from './core.js'
import { newVehicleId } from './ids.js'
import { dataPort } from './ports.js'
import { admin, makeWorld } from './test-utils.js'
import type { AuditEntry, PassWrite, UserData, VehicleData } from './types.js'
import { createVehicle, updateVehicle } from './vehicles.js'

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const audit: AuditEntry = {
  tenantId: 'T1',
  action: 'test',
  actorUid: 'admin',
  actorRole: 'admin',
  targetType: 'vehicle',
  targetId: 'x',
  meta: {},
}
const vehicle = (plateKey: string, over: Partial<VehicleData> = {}): VehicleData => ({
  tenantId: 'T1',
  contractorId: 'C1',
  plateNo: plateKey,
  plateKey,
  type: 'Tipper',
  assignedDriverIds: [],
  status: 'active',
  ...over,
})

describe.skipIf(!emulator)('Firestore data port (emulator)', () => {
  const port = () => dataPort()
  let db: FirebaseFirestore.Firestore

  beforeAll(() => {
    initializeApp({ projectId: 'demo-conveypass-functions' })
    db = getFirestore()
  })
  beforeEach(async () => {
    for (const c of ['vehicles', 'vehiclePlates', 'auditLog', 'users', 'drivers', 'contractors', 'passes', 'tenants']) {
      await db.recursiveDelete(db.collection(c))
    }
  })

  it('createVehicleTx: concurrent creates of one plate leave exactly one vehicle, one guard and one audit entry', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        port().createVehicleTx({ vehicleId: newVehicleId(), vehicle: vehicle('CAB1234'), actorUid: 'admin', audit }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PlateTakenError)
    expect((await db.collection('vehicles').get()).size).toBe(1)
    expect((await db.collection('vehiclePlates').get()).size).toBe(1)
    expect((await db.collection('auditLog').get()).size).toBe(1)
    const guard = await db.doc('vehiclePlates/T1_CAB1234').get()
    const created = (await db.collection('vehicles').get()).docs[0]
    expect(guard.data()).toEqual({ vehicleId: created?.id })
    expect(created?.data()).toMatchObject({ plateKey: 'CAB1234', createdBy: 'admin' })
  })

  it('updateVehicleTx moves the guard, rejects a taken plate and removes makeModel on null', async () => {
    const a = newVehicleId()
    const b = newVehicleId()
    await port().createVehicleTx({ vehicleId: a, vehicle: vehicle('AAA1111', { makeModel: 'Tata' }), actorUid: 'u', audit })
    await port().createVehicleTx({ vehicleId: b, vehicle: vehicle('BBB2222'), actorUid: 'u', audit })

    await port().updateVehicleTx({
      vehicleId: a,
      patch: { plateNo: 'CCC 3333', makeModel: null },
      plate: { plateNo: 'CCC 3333', plateKey: 'CCC3333' },
      audit,
    })
    expect((await db.doc('vehiclePlates/T1_AAA1111').get()).exists).toBe(false)
    expect((await db.doc('vehiclePlates/T1_CCC3333').get()).data()).toEqual({ vehicleId: a })
    const doc = (await db.doc(`vehicles/${a}`).get()).data()
    expect(doc).toMatchObject({ plateNo: 'CCC 3333', plateKey: 'CCC3333' })
    expect(doc).not.toHaveProperty('makeModel')

    await expect(
      port().updateVehicleTx({ vehicleId: b, patch: { plateNo: 'CCC3333' }, plate: { plateNo: 'CCC3333', plateKey: 'CCC3333' }, audit }),
    ).rejects.toBeInstanceOf(PlateTakenError)
    expect((await db.doc(`vehicles/${b}`).get()).data()).toMatchObject({ plateKey: 'BBB2222' })
    expect((await db.doc('vehiclePlates/T1_BBB2222').get()).exists).toBe(true)
  })

  it('updateVehicleTx: two vehicles racing for the same new plate, only one wins', async () => {
    const ids = [newVehicleId(), newVehicleId()]
    await port().createVehicleTx({ vehicleId: ids[0] as string, vehicle: vehicle('AAA1111'), actorUid: 'u', audit })
    await port().createVehicleTx({ vehicleId: ids[1] as string, vehicle: vehicle('BBB2222'), actorUid: 'u', audit })
    const results = await Promise.allSettled(
      ids.map((vehicleId) =>
        port().updateVehicleTx({ vehicleId, patch: { plateNo: 'ZZZ9999' }, plate: { plateNo: 'ZZZ9999', plateKey: 'ZZZ9999' }, audit }),
      ),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await db.collection('vehiclePlates').get()).size).toBe(2)
  })

  it('core.createVehicle / updateVehicle work end to end on the real port', async () => {
    const w = makeWorld()
    const deps: Deps = { ...w.deps, data: { ...port(), getUser: w.deps.data.getUser, getContractor: w.deps.data.getContractor, getDrivers: w.deps.data.getDrivers }, newVehicleId }
    const { vehicleId } = await createVehicle(deps, admin(), { contractorId: 'C1', plateNo: 'wp lj-4821', type: 'Tipper', driverIds: ['drv1'] })
    expect(vehicleId).toMatch(/^veh_[a-z0-9]{10}$/)
    expect((await db.doc(`vehicles/${vehicleId}`).get()).data()).toMatchObject({ plateNo: 'WP LJ-4821', assignedDriverIds: ['drv1'] })
    await expect(createVehicle(deps, admin(), { contractorId: 'C1', plateNo: 'WPLJ4821', type: 'Tipper' })).rejects.toMatchObject({
      code: 'already-exists',
      details: { reason: 'plate-exists' },
    })
    await updateVehicle(deps, admin(), { vehicleId, plateNo: 'CAB-1234' })
    expect((await db.doc('vehiclePlates/T1_CAB1234').get()).data()).toEqual({ vehicleId })
  })

  it('createUserWithAudit writes the drivers doc; updateUserWithAudit patches it or backfills it', async () => {
    const user: UserData = {
      tenantId: 'T1', role: 'driver', contractorId: 'C1', name: 'D', email: null, phone: '94771234567', status: 'active', mustChangePassword: true,
    }
    const driver = { tenantId: 'T1', contractorId: 'C1', name: 'D', phone: '94771234567', status: 'active' as const }
    await port().createUserWithAudit('d1', user, 'admin', audit, driver)
    expect((await db.doc('drivers/d1').get()).data()).toMatchObject({ ...driver })

    await port().updateUserWithAudit('d1', { name: 'E' }, audit, { patch: { name: 'E', licenseNo: 'L1' } })
    expect((await db.doc('drivers/d1').get()).data()).toMatchObject({ name: 'E', licenseNo: 'L1' })

    await db.doc('users/legacy').set({ ...user, name: 'Old' })
    await port().updateUserWithAudit('legacy', { name: 'New' }, audit, { patch: { name: 'New' }, backfill: { ...driver, name: 'Old' } })
    expect((await db.doc('drivers/legacy').get()).data()).toMatchObject({ ...driver, name: 'New' })
  })

  it('listUserIdsByContractor and getDrivers', async () => {
    await db.doc('users/a').set({ tenantId: 'T1', contractorId: 'C1' })
    await db.doc('users/b').set({ tenantId: 'T1', contractorId: 'C2' })
    await db.doc('users/c').set({ tenantId: 'T2', contractorId: 'C1' })
    await db.doc('drivers/a').set({ tenantId: 'T1', contractorId: 'C1', name: 'A', phone: '1', status: 'active' })
    expect(await port().listUserIdsByContractor('T1', 'C1')).toEqual(['a'])
    expect([...(await port().getDrivers(['a', 'zzz'])).keys()]).toEqual(['a'])
    expect((await port().getDrivers([])).size).toBe(0)
  })

  const passWrite = (attempt: number, over: Partial<PassWrite> = {}): PassWrite => {
    const file = (n: string) => ({ path: `p/${attempt}/${n}`, size: 20000, contentType: 'image/jpeg' })
    return {
      tenantId: 'T1', contractorId: 'C1', vehicleId: 'veh_aaaaaaaaaa', plateNo: 'CAB-1', vehicleType: 'Tipper', dateKey: '20260310',
      driverId: 'd1', driverName: 'D', attempt, checklist: [{ id: 'x', label: 'X', answer: 'yes' }],
      evidence: { gps: file('gps.jpg'), dashcam: file('dashcam.jpg'), extra: [] },
      captureMeta: { method: 'live', clientCapturedAt: { gps: 'a', dashcam: 'b' } }, ...over,
    }
  }
  const passAudit = { ...audit, targetType: 'pass' as const, targetId: 'veh_aaaaaaaaaa_20260310' }

  it('submitPassTx: concurrent first submissions leave one pass and one audit entry', async () => {
    const id = 'veh_aaaaaaaaaa_20260310'
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => port().submitPassTx({ passId: id, pass: passWrite(1), audit: passAudit })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(PassConflictError)
    expect((await db.collection('auditLog').get()).size).toBe(1)
    const pass = await port().getPass(id)
    expect(pass).toMatchObject({ status: 'submitted', attempt: 1 })
    expect(typeof pass?.submittedAt).toBe('number')
  })

  it('submitPassTx: resubmitting a rejected pass moves the rejection into rejectionHistory', async () => {
    const id = 'veh_aaaaaaaaaa_20260310'
    await port().submitPassTx({ passId: id, pass: passWrite(1), audit: passAudit })
    await expect(port().submitPassTx({ passId: id, pass: passWrite(2), audit: passAudit })).rejects.toMatchObject({ kind: 'exists' })

    await db.doc(`passes/${id}`).update({
      status: 'rejected', rejection: { reason: 'Blurry', byUid: 's1', byRole: 'supervisor', at: new Date() },
    })
    const stored = await port().getPass(id)
    expect(typeof stored?.rejection?.at).toBe('number')
    await expect(port().submitPassTx({ passId: id, pass: passWrite(2, { driverId: 'other' }), audit: passAudit })).rejects.toMatchObject({ kind: 'driver' })
    await expect(port().submitPassTx({ passId: id, pass: passWrite(3), audit: passAudit })).rejects.toMatchObject({ kind: 'attempt' })

    await port().submitPassTx({ passId: id, pass: passWrite(2), audit: passAudit })
    const raw = (await db.doc(`passes/${id}`).get()).data()
    expect(raw).toMatchObject({ status: 'submitted', attempt: 2 })
    expect(raw).not.toHaveProperty('rejection')
    expect(raw?.rejectionHistory).toHaveLength(1)
    expect(raw?.rejectionHistory[0]).toMatchObject({ attempt: 1, reason: 'Blurry', evidence: { gps: { path: 'p/1/gps.jpg' } } })
    expect(raw?.evidence.gps.path).toBe('p/2/gps.jpg')
  })

  it('updateTenantSettingsWithAudit merges settings and keeps other tenant fields', async () => {
    await db.doc('tenants/T1').set({ name: 'Demo', timezone: 'Asia/Colombo' })
    await port().updateTenantSettingsWithAudit('T1', { passSettings: { requireLocation: true, maxExtraPhotos: 1 } }, { ...audit, targetType: 'tenant' })
    expect((await db.doc('tenants/T1').get()).data()).toMatchObject({ name: 'Demo', timezone: 'Asia/Colombo', passSettings: { requireLocation: true, maxExtraPhotos: 1 } })
  })
})
