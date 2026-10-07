import { z } from 'zod'
import {
  driverEmail,
  isValidPassword,
  isValidPin,
  normalisePhone,
  PASSWORD_MIN_LENGTH,
} from './credentials.js'
import { fail } from './errors.js'
import {
  changeOwnPasswordSchema,
  createUserSchema,
  resetCredentialSchema,
  updateUserSchema,
} from './schemas.js'
import type { AuditEntry, Caller, Claims, ContractorData, Role, UserData } from './types.js'

/** Max age of the caller's sign-in for changeOwnPassword. */
export const RECENT_LOGIN_SECONDS = 5 * 60

// ---- Ports (implemented with firebase-admin in ports.ts; faked in tests) -------------------

export interface AuthPort {
  createUser(p: { email: string; password: string; displayName: string }): Promise<{ uid: string }>
  deleteUser(uid: string): Promise<void>
  updateUser(
    uid: string,
    p: { email?: string; password?: string; displayName?: string; disabled?: boolean },
  ): Promise<void>
  setCustomUserClaims(uid: string, claims: Claims): Promise<void>
  revokeRefreshTokens(uid: string): Promise<void>
}

export interface DataPort {
  getUser(uid: string): Promise<UserData | null>
  getContractor(id: string): Promise<ContractorData | null>
  /** Atomically writes the user doc (+ createdAt/createdBy/updatedAt) and the audit entry. */
  createUserWithAudit(uid: string, data: UserData, actorUid: string, audit: AuditEntry): Promise<void>
  /** Atomically merges `patch` (+ updatedAt) into the user doc and writes the audit entry. */
  updateUserWithAudit(uid: string, patch: Partial<UserData>, audit: AuditEntry): Promise<void>
}

export interface Deps {
  auth: AuthPort
  data: DataPort
  /** Seconds since epoch. */
  now: () => number
}

// ---- Helpers -------------------------------------------------------------------------------

function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw)
  if (!result.success) throw fail('invalid-argument', 'invalid-input', 'Invalid request')
  return result.data
}

const authErrorCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined


/** The token is only a hint; the caller must also exist, be active, and match the token's role/tenant. */
async function requireActiveCaller(deps: Deps, caller: Caller): Promise<UserData> {
  const doc = await deps.data.getUser(caller.uid)
  if (
    !doc ||
    doc.status !== 'active' ||
    doc.tenantId !== caller.tenantId ||
    doc.role !== caller.role
  ) {
    throw fail('permission-denied', 'caller-not-active', 'Caller is not an active member of this tenant')
  }
  return doc
}

async function loadTarget(deps: Deps, caller: Caller, uid: string): Promise<UserData> {
  const target = await deps.data.getUser(uid)
  if (!target) throw fail('not-found', 'user-not-found', 'User not found')
  if (target.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'User belongs to a different tenant')
  }
  return target
}

/** Admin: anyone in the tenant. Supervisor: drivers of their own contractor. Everyone else: nobody. */
function assertCanManage(caller: Caller, target: UserData): void {
  if (caller.role === 'admin') return
  if (
    caller.role === 'supervisor' &&
    caller.contractorId !== null &&
    target.role === 'driver' &&
    target.contractorId === caller.contractorId
  ) {
    return
  }
  throw fail('permission-denied', 'forbidden', 'You are not allowed to manage this user')
}

/** Validates a credential by the role it protects: PIN for drivers, password for staff. */
function assertCredential(role: Role, value: string): void {
  const ok = role === 'driver' ? isValidPin(value) : isValidPassword(value)
  if (!ok) {
    throw fail(
      'invalid-argument',
      'invalid-input',
      role === 'driver' ? 'PIN must be 6 digits' : `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    )
  }
}

async function requireActiveContractor(deps: Deps, caller: Caller, contractorId: string): Promise<void> {
  const contractor = await deps.data.getContractor(contractorId)
  if (!contractor) throw fail('failed-precondition', 'contractor-invalid', 'Contractor not found')
  if (contractor.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'Contractor belongs to a different tenant')
  }
  if (contractor.status !== 'active') {
    throw fail('failed-precondition', 'contractor-invalid', 'Contractor is not active')
  }
}

const audit = (
  caller: Caller,
  action: string,
  targetId: string,
  meta: AuditEntry['meta'] = {},
): AuditEntry => ({
  tenantId: caller.tenantId,
  action,
  actorUid: caller.uid,
  actorRole: caller.role,
  targetType: 'user',
  targetId,
  meta,
})

// ---- createUser ----------------------------------------------------------------------------

export async function createUser(deps: Deps, caller: Caller, raw: unknown): Promise<{ uid: string }> {
  const input = parse(createUserSchema, raw)
  await requireActiveCaller(deps, caller)

  const allowed =
    caller.role === 'admin' || (caller.role === 'supervisor' && input.role === 'driver')
  if (!allowed) throw fail('permission-denied', 'forbidden', 'You are not allowed to create this role')

  // Contractor: only supervisors and drivers belong to one. A supervisor caller is forced to their own.
  let contractorId: string | null = null
  if (input.role === 'supervisor' || input.role === 'driver') {
    contractorId = caller.role === 'supervisor' ? caller.contractorId : (input.contractorId ?? null)
    if (!contractorId) throw fail('invalid-argument', 'invalid-input', 'contractorId is required')
    await requireActiveContractor(deps, caller, contractorId)
  } else if (input.contractorId !== undefined) {
    throw fail('invalid-argument', 'invalid-input', 'contractorId is not allowed for this role')
  }

  assertCredential(input.role, input.password)

  let authEmail: string
  let docEmail: string | null = null
  let docPhone: string | null = null
  if (input.role === 'driver') {
    if (input.email !== undefined || input.phone === undefined) {
      throw fail('invalid-argument', 'invalid-input', 'Drivers require a phone number only')
    }
    const phone = normalisePhone(input.phone)
    if (!phone) throw fail('invalid-argument', 'invalid-input', 'Invalid phone number')
    docPhone = phone
    authEmail = driverEmail(phone)
  } else {
    if (input.phone !== undefined || input.email === undefined) {
      throw fail('invalid-argument', 'invalid-input', 'Staff require an email only')
    }
    docEmail = input.email
    authEmail = input.email
  }

  let uid: string
  try {
    ;({ uid } = await deps.auth.createUser({
      email: authEmail,
      password: input.password,
      displayName: input.name,
    }))
  } catch (e) {
    if (authErrorCode(e) === 'auth/email-already-exists') {
      throw input.role === 'driver'
        ? fail('already-exists', 'phone-exists', 'Phone number already registered')
        : fail('already-exists', 'email-exists', 'Email already registered')
    }
    throw fail('internal', 'internal', 'Could not create user')
  }

  try {
    const claims: Claims = { role: input.role, tenantId: caller.tenantId }
    if (contractorId) claims.contractorId = contractorId
    await deps.auth.setCustomUserClaims(uid, claims)
    await deps.data.createUserWithAudit(
      uid,
      {
        tenantId: caller.tenantId,
        role: input.role,
        contractorId,
        name: input.name,
        email: docEmail,
        phone: docPhone,
        status: 'active',
        mustChangePassword: true,
      },
      caller.uid,
      audit(caller, 'user.create', uid, { role: input.role, contractorId }),
    )
  } catch {
    // Compensation: never leave an Auth user without a users doc.
    await deps.auth.deleteUser(uid).catch(() => undefined)
    throw fail('internal', 'internal', 'Could not create user')
  }
  return { uid }
}

// ---- updateUser ----------------------------------------------------------------------------

export async function updateUser(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updateUserSchema, raw)
  await requireActiveCaller(deps, caller)
  const target = await loadTarget(deps, caller, input.uid)
  assertCanManage(caller, target)

  if (input.status !== undefined && input.uid === caller.uid) {
    throw fail('failed-precondition', 'self-status', 'You cannot change your own status')
  }

  const patch: Partial<UserData> = {}
  const authPatch: { email?: string; displayName?: string; disabled?: boolean } = {}
  const meta: AuditEntry['meta'] = {}

  if (input.name !== undefined && input.name !== target.name) {
    patch.name = input.name
    authPatch.displayName = input.name
    meta.name = true
  }

  let previousAuthEmail: string | null = null
  if (input.phone !== undefined) {
    if (target.role !== 'driver') {
      throw fail('invalid-argument', 'invalid-input', 'Only drivers have a phone number')
    }
    const phone = normalisePhone(input.phone)
    if (!phone) throw fail('invalid-argument', 'invalid-input', 'Invalid phone number')
    if (phone !== target.phone) {
      patch.phone = phone
      authPatch.email = driverEmail(phone) // the synthetic email is the driver's login identity
      previousAuthEmail = target.phone ? driverEmail(target.phone) : null
      meta.phone = true
    }
  }

  let statusAction: string | null = null
  if (input.status !== undefined && input.status !== target.status) {
    patch.status = input.status
    authPatch.disabled = input.status === 'disabled'
    statusAction = input.status === 'disabled' ? 'user.disable' : 'user.enable'
  }

  if (Object.keys(patch).length === 0) return { ok: true }

  try {
    if (Object.keys(authPatch).length > 0) await deps.auth.updateUser(input.uid, authPatch)
  } catch (e) {
    if (authErrorCode(e) === 'auth/email-already-exists') {
      throw fail('already-exists', 'phone-exists', 'Phone number already registered')
    }
    throw fail('internal', 'internal', 'Could not update user')
  }

  if (patch.status === 'disabled') await deps.auth.revokeRefreshTokens(input.uid)

  try {
    await deps.data.updateUserWithAudit(
      input.uid,
      patch,
      audit(caller, statusAction ?? 'user.update', input.uid, meta),
    )
  } catch {
    if (previousAuthEmail) await deps.auth.updateUser(input.uid, { email: previousAuthEmail }).catch(() => undefined)
    throw fail('internal', 'internal', 'Could not update user')
  }
  return { ok: true }
}

// ---- resetCredential -----------------------------------------------------------------------

export async function resetCredential(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(resetCredentialSchema, raw)
  await requireActiveCaller(deps, caller)
  const target = await loadTarget(deps, caller, input.uid)
  assertCanManage(caller, target)
  if (input.uid === caller.uid) {
    throw fail('failed-precondition', 'self-reset', 'Use change password for your own account')
  }
  assertCredential(target.role, input.newPassword)

  // Flag first: if the Auth update fails afterwards, the user is merely asked to change a still-valid credential.
  try {
    await deps.data.updateUserWithAudit(
      input.uid,
      { mustChangePassword: true },
      audit(caller, 'user.resetCredential', input.uid),
    )
    await deps.auth.updateUser(input.uid, { password: input.newPassword })
    await deps.auth.revokeRefreshTokens(input.uid)
  } catch {
    throw fail('internal', 'internal', 'Could not reset credential')
  }
  return { ok: true }
}

// ---- changeOwnPassword ---------------------------------------------------------------------

export async function changeOwnPassword(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(changeOwnPasswordSchema, raw)
  const self = await requireActiveCaller(deps, caller)

  if (deps.now() - caller.authTime > RECENT_LOGIN_SECONDS) {
    throw fail('failed-precondition', 'recent-login-required', 'Please sign in again to change your password')
  }
  assertCredential(self.role, input.newPassword)

  try {
    await deps.auth.updateUser(caller.uid, { password: input.newPassword })
    await deps.data.updateUserWithAudit(
      caller.uid,
      { mustChangePassword: false },
      audit(caller, 'user.changeOwnPassword', caller.uid),
    )
  } catch {
    throw fail('internal', 'internal', 'Could not change credential')
  }
  return { ok: true }
}

