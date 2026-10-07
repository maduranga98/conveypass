import { beforeEach, describe, expect, it } from 'vitest'
import {
  changeOwnPassword,
  createUser,
  resetCredential,
  updateUser,
  type Deps,
} from './core.js'
import type { AuditEntry, Caller, Claims, ContractorData, UserData } from './types.js'

const NOW = 1_700_000_000

const userDoc = (over: Partial<UserData> = {}): UserData => ({
  tenantId: 'T1',
  role: 'driver',
  contractorId: 'C1',
  name: 'Name',
  email: null,
  phone: '94771234567',
  status: 'active',
  mustChangePassword: false,
  ...over,
})

interface World {
  deps: Deps
  users: Map<string, UserData>
  contractors: Map<string, ContractorData>
  authUsers: Map<string, { email: string; password: string; disabled: boolean; displayName: string }>
  claims: Map<string, Claims>
  audits: AuditEntry[]
  revoked: string[]
  failFirestoreCreate: boolean
}

function makeWorld(): World {
  const w: World = {
    users: new Map(),
    contractors: new Map(),
    authUsers: new Map(),
    claims: new Map(),
    audits: [],
    revoked: [],
    failFirestoreCreate: false,
    deps: undefined as unknown as Deps,
  }
  let n = 0
  w.deps = {
    now: () => NOW,
    auth: {
      createUser: async (p) => {
        if ([...w.authUsers.values()].some((u) => u.email === p.email)) {
          throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' })
        }
        const uid = `new${++n}`
        w.authUsers.set(uid, { email: p.email, password: p.password, disabled: false, displayName: p.displayName })
        return { uid }
      },
      deleteUser: async (uid) => void w.authUsers.delete(uid),
      updateUser: async (uid, p) => {
        const u = w.authUsers.get(uid) ?? { email: '', password: '', disabled: false, displayName: '' }
        w.authUsers.set(uid, { ...u, ...p })
      },
      setCustomUserClaims: async (uid, c) => void w.claims.set(uid, c),
      revokeRefreshTokens: async (uid) => void w.revoked.push(uid),
    },
    data: {
      getUser: async (uid) => w.users.get(uid) ?? null,
      getContractor: async (id) => w.contractors.get(id) ?? null,
      createUserWithAudit: async (uid, data, _actor, audit) => {
        if (w.failFirestoreCreate) throw new Error('boom')
        w.users.set(uid, data)
        w.audits.push(audit)
      },
      updateUserWithAudit: async (uid, patch, audit) => {
        w.users.set(uid, { ...(w.users.get(uid) as UserData), ...patch })
        w.audits.push(audit)
      },
    },
  }
  w.contractors.set('C1', { tenantId: 'T1', status: 'active' })
  w.contractors.set('C2', { tenantId: 'T1', status: 'active' })
  w.contractors.set('CX', { tenantId: 'T2', status: 'active' })
  w.contractors.set('CS', { tenantId: 'T1', status: 'suspended' })
  w.users.set('admin', userDoc({ role: 'admin', contractorId: null, email: 'a@x.com', phone: null }))
  w.users.set('admin2', userDoc({ role: 'admin', contractorId: null, email: 'a2@x.com', phone: null }))
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1@x.com', phone: null }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, email: 'o@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1' }))
  w.users.set('drv2', userDoc({ contractorId: 'C2', phone: '94770000002' }))
  w.users.set('foreign', userDoc({ tenantId: 'T2', contractorId: 'CX', phone: '94770000009' }))
  return w
}

const caller = (uid: string, role: Caller['role'], contractorId: string | null = null, over: Partial<Caller> = {}): Caller => ({
  uid,
  role,
  tenantId: 'T1',
  contractorId,
  authTime: NOW - 10,
  ...over,
})
const admin = () => caller('admin', 'admin')
const sup1 = () => caller('sup1', 'supervisor', 'C1')

const staffInput = { role: 'officer', name: 'Off', email: 'new@x.com', password: 'longenough1' }
const driverInput = { role: 'driver', name: 'Drv', phone: '0779998888', contractorId: 'C1', password: '123456' }

let w: World
beforeEach(() => {
  w = makeWorld()
})

const rejects = (p: Promise<unknown>, code: string, reason?: string) =>
  expect(p).rejects.toMatchObject({ code, ...(reason ? { details: { reason } } : {}) })

describe('createUser: permission matrix', () => {
  it.each(['admin', 'officer', 'security'] as const)('admin can create %s', async (role) => {
    const { uid } = await createUser(w.deps, admin(), { ...staffInput, role })
    expect(w.users.get(uid)).toMatchObject({ role, tenantId: 'T1', contractorId: null, mustChangePassword: true, status: 'active' })
    expect(w.claims.get(uid)).toEqual({ role, tenantId: 'T1' })
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
  it('admin cannot change their own status', async () => {
    await rejects(updateUser(w.deps, admin(), { uid: 'admin', status: 'disabled' }), 'failed-precondition', 'self-status')
  })
  it('admin may rename themselves', async () => {
    await updateUser(w.deps, admin(), { uid: 'admin', name: 'New Name' })
    expect(w.users.get('admin')?.name).toBe('New Name')
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
    await rejects(resetCredential(w.deps, admin(), { uid: 'admin', newPassword: 'a-good-password' }), 'failed-precondition', 'self-reset')
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
