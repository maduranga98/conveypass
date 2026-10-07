import { beforeEach, describe, expect, it } from 'vitest'
import { changeOwnPassword, createUser, resetCredential, updateUser } from './core.js'
import { admin, caller, makeWorld, NOW, rejects, sup1, userDoc, type World } from './test-utils.js'

const staffInput = { role: 'officer', name: 'Off', email: 'new@x.com', password: 'longenough1' }
const driverInput = { role: 'driver', name: 'Drv', phone: '0779998888', contractorId: 'C1', password: '123456' }

let w: World
beforeEach(() => {
  w = makeWorld()
})

describe('createUser: permission matrix', () => {
  it.each(['officer', 'security'] as const)('admin can create %s', async (role) => {
    const { uid } = await createUser(w.deps, admin(), { ...staffInput, role })
    expect(w.users.get(uid)).toMatchObject({ role, tenantId: 'T1', contractorId: null, mustChangePassword: true, status: 'active' })
    expect(w.claims.get(uid)).toEqual({ role, tenantId: 'T1' })
  })

  it('a tenant admin can no longer create an admin (the platform super admin does)', async () => {
    await rejects(createUser(w.deps, admin(), { ...staffInput, role: 'admin' }), 'permission-denied', 'forbidden')
    expect(w.authUsers.size).toBe(0)
    expect(w.users.has('new1')).toBe(false)
  })

  it('admin can create a supervisor for an active contractor', async () => {
    const { uid } = await createUser(w.deps, admin(), { ...staffInput, role: 'supervisor', contractorId: 'C2' })
    expect(w.claims.get(uid)).toEqual({ role: 'supervisor', tenantId: 'T1', contractorId: 'C2' })
    expect(w.users.get(uid)?.contractorId).toBe('C2')
  })

  it('admin can create a driver; phone is normalised and login email is synthetic', async () => {
    const { uid } = await createUser(w.deps, admin(), driverInput)
    expect(w.users.get(uid)).toMatchObject({ phone: '94779998888', email: null, contractorId: 'C1' })
    expect(w.authUsers.get(uid)?.email).toBe('94779998888@drivers.convoypass.com')
    expect(w.audits.at(-1)).toMatchObject({ action: 'user.create', actorUid: 'admin', targetId: uid, tenantId: 'T1' })
  })

  it('supervisor cannot create staff of any role', async () => {
    for (const role of ['admin', 'officer', 'security', 'supervisor'] as const) {
      await rejects(createUser(w.deps, sup1(), { ...staffInput, role, contractorId: 'C1' }), 'permission-denied', 'forbidden')
    }
    expect(w.authUsers.size).toBe(0)
  })

  it('supervisor creates drivers with contractorId forced to their own', async () => {
    const { uid } = await createUser(w.deps, sup1(), { ...driverInput, contractorId: 'C2' })
    expect(w.users.get(uid)?.contractorId).toBe('C1')
    expect(w.claims.get(uid)?.contractorId).toBe('C1')
  })

  it.each([
    ['officer', caller('officer', 'officer')],
    ['security', caller('sec', 'security')],
    ['driver', caller('drv1', 'driver', 'C1')],
  ])('%s cannot create anyone', async (_n, c) => {
    w.users.set('sec', userDoc({ role: 'security', contractorId: null }))
    await rejects(createUser(w.deps, c, driverInput), 'permission-denied', 'forbidden')
  })
})

describe('createUser: tenant and validation', () => {
  it('rejects a contractor from another tenant', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: 'CX' }), 'permission-denied', 'tenant-mismatch')
  })
  it('rejects a suspended or missing contractor', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: 'CS' }), 'failed-precondition', 'contractor-invalid')
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: 'nope' }), 'failed-precondition', 'contractor-invalid')
  })
  it('requires a contractor for supervisors and drivers, forbids it for other roles', async () => {
    await rejects(createUser(w.deps, admin(), { ...staffInput, role: 'supervisor' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...driverInput, contractorId: undefined }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...staffInput, contractorId: 'C1' }), 'invalid-argument')
  })
  it('validates PIN, password and phone by role', async () => {
    await rejects(createUser(w.deps, admin(), { ...driverInput, password: '12345' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...driverInput, password: 'abcdef' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...driverInput, phone: '0112345678' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), { ...staffInput, password: 'short' }), 'invalid-argument')
  })
  it('rejects malformed input', async () => {
    await rejects(createUser(w.deps, admin(), { role: 'god' }), 'invalid-argument')
    await rejects(createUser(w.deps, admin(), null), 'invalid-argument')
  })
  it('rejects duplicates with typed reasons', async () => {
    await createUser(w.deps, admin(), driverInput)
    await rejects(createUser(w.deps, admin(), driverInput), 'already-exists', 'phone-exists')
    await createUser(w.deps, admin(), staffInput)
    await rejects(createUser(w.deps, admin(), staffInput), 'already-exists', 'email-exists')
  })
  it('rejects callers whose users doc is missing, disabled, or contradicts the token', async () => {
    await rejects(createUser(w.deps, caller('ghost', 'admin'), staffInput), 'permission-denied', 'caller-not-active')
    w.users.set('admin', userDoc({ role: 'admin', contractorId: null, status: 'disabled' }))
    await rejects(createUser(w.deps, admin(), staffInput), 'permission-denied', 'caller-not-active')
    w.users.set('admin', userDoc({ role: 'officer', contractorId: null }))
    await rejects(createUser(w.deps, admin(), staffInput), 'permission-denied', 'caller-not-active')
    w.users.set('admin', userDoc({ role: 'admin', contractorId: null, tenantId: 'T2' }))
    await rejects(createUser(w.deps, admin(), staffInput), 'permission-denied', 'caller-not-active')
  })
  it('compensates by deleting the Auth user when the Firestore write fails', async () => {
    w.failFirestoreCreate = true
    await rejects(createUser(w.deps, admin(), staffInput), 'internal')
    expect(w.authUsers.size).toBe(0)
  })
})

describe('updateUser', () => {
  it('a tenant admin cannot update any admin account, themselves included', async () => {
    w.users.set('admin2', userDoc({ role: 'admin', contractorId: null, email: 'a2@x.com', phone: null }))
    for (const uid of ['admin', 'admin2']) {
      await rejects(updateUser(w.deps, admin(), { uid, status: 'disabled' }), 'permission-denied', 'forbidden')
      await rejects(updateUser(w.deps, admin(), { uid, name: 'New Name' }), 'permission-denied', 'forbidden')
    }
    expect(w.users.get('admin2')?.status).toBe('active')
    expect(w.users.get('admin')?.name).not.toBe('New Name')
    expect(w.revoked).toHaveLength(0)
  })
  it('a tenant admin still manages every other role', async () => {
    await updateUser(w.deps, admin(), { uid: 'officer', name: 'Olga 2' })
    expect(w.users.get('officer')?.name).toBe('Olga 2')
  })
  it('admin can disable a user: Auth disabled, tokens revoked, audit written', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    expect(w.users.get('drv1')?.status).toBe('disabled')
    expect(w.authUsers.get('drv1')?.disabled).toBe(true)
    expect(w.revoked).toContain('drv1')
    expect(w.audits.at(-1)?.action).toBe('user.disable')
  })
  it('re-enabling reverses it', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'active' })
    expect(w.authUsers.get('drv1')?.disabled).toBe(false)
    expect(w.users.get('drv1')?.status).toBe('active')
    expect(w.audits.at(-1)?.action).toBe('user.enable')
  })
  it('rejects users in another tenant', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'foreign', name: 'x' }), 'permission-denied', 'tenant-mismatch')
  })
  it('404s for unknown users', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'nope', name: 'x' }), 'not-found')
  })
  it('supervisor manages drivers of own contractor only', async () => {
    await updateUser(w.deps, sup1(), { uid: 'drv1', name: 'Renamed' })
    expect(w.users.get('drv1')?.name).toBe('Renamed')
    await rejects(updateUser(w.deps, sup1(), { uid: 'drv2', name: 'x' }), 'permission-denied', 'forbidden')
    await rejects(updateUser(w.deps, sup1(), { uid: 'officer', name: 'x' }), 'permission-denied', 'forbidden')
    await rejects(updateUser(w.deps, sup1(), { uid: 'admin', status: 'disabled' }), 'permission-denied', 'forbidden')
    await rejects(updateUser(w.deps, sup1(), { uid: 'sup1', name: 'x' }), 'permission-denied', 'forbidden')
  })
  it.each([
    ['officer', caller('officer', 'officer')],
    ['driver', caller('drv1', 'driver', 'C1')],
  ])('%s cannot update anyone', async (_n, c) => {
    await rejects(updateUser(w.deps, c, { uid: 'drv1', name: 'x' }), 'permission-denied', 'forbidden')
  })
  it('changing a driver phone also changes the login email', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', phone: '0712223333' })
    expect(w.users.get('drv1')?.phone).toBe('94712223333')
    expect(w.authUsers.get('drv1')?.email).toBe('94712223333@drivers.convoypass.com')
  })
  it('rejects phone for non-drivers, invalid phones and empty updates', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'officer', phone: '0712223333' }), 'invalid-argument')
    await rejects(updateUser(w.deps, admin(), { uid: 'drv1', phone: '123' }), 'invalid-argument')
    await rejects(updateUser(w.deps, admin(), { uid: 'drv1' }), 'invalid-argument')
  })
  it('does not accept role or tenant changes', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', name: 'Same', role: 'admin', tenantId: 'T2' })
    expect(w.users.get('drv1')).toMatchObject({ role: 'driver', tenantId: 'T1' })
  })
})

describe('resetCredential', () => {
  it('admin resets a driver PIN: flag set, tokens revoked, validated as PIN', async () => {
    await resetCredential(w.deps, admin(), { uid: 'drv1', newPassword: '654321' })
    expect(w.users.get('drv1')?.mustChangePassword).toBe(true)
    expect(w.authUsers.get('drv1')?.password).toBe('654321')
    expect(w.revoked).toContain('drv1')
    await rejects(resetCredential(w.deps, admin(), { uid: 'drv1', newPassword: 'password1' }), 'invalid-argument')
  })
  it('validates staff passwords', async () => {
    await rejects(resetCredential(w.deps, admin(), { uid: 'officer', newPassword: '123456' }), 'invalid-argument')
    await resetCredential(w.deps, admin(), { uid: 'officer', newPassword: 'a-good-password' })
  })
  it('supervisor: own-contractor drivers only', async () => {
    await resetCredential(w.deps, sup1(), { uid: 'drv1', newPassword: '111111' })
    await rejects(resetCredential(w.deps, sup1(), { uid: 'drv2', newPassword: '111111' }), 'permission-denied', 'forbidden')
    await rejects(resetCredential(w.deps, sup1(), { uid: 'admin', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
  })
  it('rejects cross-tenant targets and self reset', async () => {
    await rejects(resetCredential(w.deps, admin(), { uid: 'foreign', newPassword: '111111' }), 'permission-denied', 'tenant-mismatch')
    await rejects(resetCredential(w.deps, admin(), { uid: 'admin', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
  })
  it('a tenant admin cannot reset another admin', async () => {
    w.users.set('admin2', userDoc({ role: 'admin', contractorId: null, email: 'a2@x.com', phone: null }))
    await rejects(resetCredential(w.deps, admin(), { uid: 'admin2', newPassword: 'a-good-password' }), 'permission-denied', 'forbidden')
    expect(w.revoked).toHaveLength(0)
    expect(w.users.get('admin2')?.mustChangePassword).toBe(false)
  })
  it('officer and driver cannot reset', async () => {
    await rejects(resetCredential(w.deps, caller('officer', 'officer'), { uid: 'drv1', newPassword: '111111' }), 'permission-denied')
    await rejects(resetCredential(w.deps, caller('drv1', 'driver', 'C1'), { uid: 'drv1', newPassword: '111111' }), 'permission-denied')
  })
})

describe('changeOwnPassword', () => {
  it('changes a driver PIN and clears mustChangePassword', async () => {
    w.users.set('drv1', userDoc({ mustChangePassword: true }))
    await changeOwnPassword(w.deps, caller('drv1', 'driver', 'C1'), { newPassword: '246810' })
    expect(w.users.get('drv1')?.mustChangePassword).toBe(false)
    expect(w.authUsers.get('drv1')?.password).toBe('246810')
  })
  it('validates by role', async () => {
    await rejects(changeOwnPassword(w.deps, caller('drv1', 'driver', 'C1'), { newPassword: 'password1' }), 'invalid-argument')
    await rejects(changeOwnPassword(w.deps, admin(), { newPassword: '123456' }), 'invalid-argument')
    await changeOwnPassword(w.deps, admin(), { newPassword: 'a-good-password' })
  })
  it('requires a sign-in within the last 5 minutes', async () => {
    await changeOwnPassword(w.deps, caller('admin', 'admin', null, { authTime: NOW - 299 }), { newPassword: 'a-good-password' })
    await rejects(
      changeOwnPassword(w.deps, caller('admin', 'admin', null, { authTime: NOW - 301 }), { newPassword: 'a-good-password' }),
      'failed-precondition',
      'recent-login-required',
    )
  })
  it('only affects the caller: there is no uid input', async () => {
    await changeOwnPassword(w.deps, admin(), { newPassword: 'a-good-password', uid: 'drv1' })
    expect(w.authUsers.has('drv1')).toBe(false)
    expect(w.authUsers.get('admin')?.password).toBe('a-good-password')
  })
})

describe('Module 2: drivers doc', () => {
  it('createUser(driver) also creates drivers/{uid}, with optional licenseNo', async () => {
    const { uid } = await createUser(w.deps, admin(), { ...driverInput, licenseNo: ' B1234567 ' })
    expect(w.drivers.get(uid)).toEqual({
      tenantId: 'T1',
      contractorId: 'C1',
      name: 'Drv',
      phone: '94779998888',
      status: 'active',
      licenseNo: 'B1234567',
    })
  })
  it('createUser(driver) without licenseNo omits it; staff get no drivers doc and cannot have a licence', async () => {
    const { uid } = await createUser(w.deps, sup1(), driverInput)
    expect(w.drivers.get(uid)).not.toHaveProperty('licenseNo')
    const staff = await createUser(w.deps, admin(), staffInput)
    expect(w.drivers.has(staff.uid)).toBe(false)
    await rejects(createUser(w.deps, admin(), { ...staffInput, email: 'o2@x.com', licenseNo: 'X1' }), 'invalid-argument')
  })
  it('updateUser mirrors name, phone and status into drivers', async () => {
    await updateUser(w.deps, admin(), { uid: 'drv1', name: 'New', phone: '0712223333' })
    expect(w.drivers.get('drv1')).toMatchObject({ name: 'New', phone: '94712223333' })
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'disabled' })
    expect(w.drivers.get('drv1')?.status).toBe('disabled')
    await updateUser(w.deps, admin(), { uid: 'drv1', status: 'active' })
    expect(w.drivers.get('drv1')?.status).toBe('active')
  })
  it('updateUser sets and clears licenseNo for drivers only', async () => {
    await updateUser(w.deps, sup1(), { uid: 'drv1', licenseNo: 'L-99' })
    expect(w.drivers.get('drv1')?.licenseNo).toBe('L-99')
    await updateUser(w.deps, sup1(), { uid: 'drv1', licenseNo: null })
    expect(w.drivers.get('drv1')?.licenseNo).toBeNull()
    await rejects(updateUser(w.deps, admin(), { uid: 'officer', licenseNo: 'L-99' }), 'invalid-argument', 'invalid-input')
  })
  it('accepts only the canonical photo path of that driver', async () => {
    const good = 'tenants/T1/contractors/C1/drivers/drv1.jpg'
    await updateUser(w.deps, sup1(), { uid: 'drv1', photoPath: good })
    expect(w.drivers.get('drv1')?.photoPath).toBe(good)
    for (const bad of [
      'tenants/T1/contractors/C2/drivers/drv1.jpg',
      'tenants/T2/contractors/C1/drivers/drv1.jpg',
      'tenants/T1/contractors/C1/drivers/drv1b.jpg',
      'tenants/T1/contractors/C1/drivers/drv1.png',
      'tenants/T1/contractors/C1/drivers/drv1.jpg/../x.jpg',
      '/tenants/T1/contractors/C1/drivers/drv1.jpg',
      'tenants/T1/contractors/C1/drivers/drv1.jpg ',
    ]) {
      await rejects(updateUser(w.deps, admin(), { uid: 'drv1', photoPath: bad }), 'invalid-argument', 'photo-path-invalid')
    }
    await rejects(updateUser(w.deps, admin(), { uid: 'officer', photoPath: good }), 'invalid-argument')
  })
  it('supervisor still cannot touch another contractor’s driver photo', async () => {
    await rejects(
      updateUser(w.deps, sup1(), { uid: 'drv2', photoPath: 'tenants/T1/contractors/C2/drivers/drv2.jpg' }),
      'permission-denied',
      'forbidden',
    )
  })
  it('backfills the drivers doc for drivers that predate Module 2', async () => {
    w.drivers.delete('drv1')
    await updateUser(w.deps, admin(), { uid: 'drv1', licenseNo: 'L-1' })
    expect(w.drivers.get('drv1')).toEqual({
      tenantId: 'T1',
      contractorId: 'C1',
      name: 'Name',
      phone: '94771234567',
      status: 'active',
      licenseNo: 'L-1',
    })
  })
})

describe('Module 2: suspended contractors lock their users out server-side', () => {
  it('a supervisor or driver of a suspended contractor is rejected on every call', async () => {
    w.contractors.set('C1', { tenantId: 'T1', status: 'suspended' })
    await rejects(updateUser(w.deps, sup1(), { uid: 'drv1', name: 'x' }), 'permission-denied', 'caller-not-active')
    await rejects(changeOwnPassword(w.deps, caller('drv1', 'driver', 'C1'), { newPassword: '246810' }), 'permission-denied', 'caller-not-active')
  })
  it('rejects a caller whose users doc contractor differs from the token', async () => {
    await rejects(updateUser(w.deps, caller('sup1', 'supervisor', 'C2'), { uid: 'drv2', name: 'x' }), 'permission-denied', 'caller-not-active')
  })
})
