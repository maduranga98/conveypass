import { z } from 'zod'
import { isValidPassword, normalisePhone, PASSWORD_MIN_LENGTH } from './credentials.js'
import { assertPepper, pinKey } from './pin.js'
import { isPinRole, sessionExpired } from './session.js'
import type { SlaSettings } from './defaultSla.js'
import type { ReportEvent, ReportPass } from './reports/types.js'
import { sanitiseMeta } from './auditMeta.js'
import { fail } from './errors.js'
import {
  changeOwnPasswordSchema,
  createUserSchema,
  reissuePinSchema,
  resetCredentialSchema,
  updateUserSchema,
} from './schemas.js'
import type {
  AuditEntry,
  Caller,
  Claims,
  ContractorData,
  ContractorStatus,
  DriverData,
  PassData,
  PassSettings,
  PassWrite,
  PinIndexEntry,
  Role,
  StoredFile,
  TenantData,
  UserData,
  VehicleData,
  VehiclePatch,
  ChecklistItemDef,
  ApprovalStamp,
  HistoryEntry,
  PassStatus,
  Rejection,
  RejectionReasonDef,
  CheckInStamp,
  GateDef,
  GateEventData,
} from './types.js'

/** Thrown by the data port when `pinIndex/{key}` already exists (another user holds that PIN): retry with a new PIN. */
export class PinTakenError extends Error {}
/** Thrown by the data port when the plate guard document already exists. */
export class PlateTakenError extends Error {}
/** Thrown by the data port when a generated vehicle id is already in use (retry with a new id). */
export class VehicleIdTakenError extends Error {}
/** Thrown by the data port when the stored pass no longer allows the submission (lost a race, or state changed). */
export class PassConflictError extends Error {
  constructor(readonly kind: 'exists' | 'attempt' | 'driver') {
    super(`pass conflict: ${kind}`)
  }
}

/** Max age of the caller's sign-in for changeOwnPassword. */
export const RECENT_LOGIN_SECONDS = 5 * 60

// ---- Ports (implemented with firebase-admin in ports.ts; faked in tests) -------------------

export interface AuthPort {
  /** PIN users (Module 12) are created with no email and no password: `displayName` (and an optional fixed `uid`) only. */
  createUser(p: { uid?: string; email?: string; password?: string; displayName: string; disabled?: boolean }): Promise<{ uid: string }>
  /** `null` when there is no Auth user. `hasPassword`: a password provider is linked. */
  getUser(uid: string): Promise<{ email: string | null; hasPassword: boolean; disabled: boolean } | null>
  deleteUser(uid: string): Promise<void>
  updateUser(
    uid: string,
    p: { email?: string; password?: string; displayName?: string; disabled?: boolean },
  ): Promise<void>
  setCustomUserClaims(uid: string, claims: Claims): Promise<void>
  revokeRefreshTokens(uid: string): Promise<void>
}

/** What `decidePassTx` reads inside its transaction. `null` members mean the document does not exist. */
export interface DecisionContext {
  pass: PassData
  vehicle: VehicleData | null
  contractor: ContractorData | null
  /** The driver's `users` doc (source of truth for status; every driver has one). */
  driver: UserData | null
}

/** The change a decision makes to a pass. Times are milliseconds; the port converts them. */
export interface PassDecisionUpdate {
  status: PassStatus
  supervisor?: ApprovalStamp
  officer?: ApprovalStamp
  rejection?: Rejection
  entry: HistoryEntry
}

export interface DecisionPlan {
  update: PassDecisionUpdate
  audit: AuditEntry
}

/**
 * What a check-in does: `replay` returns the stored check-in unchanged (same requestId, nothing is written);
 * `write` sets status `checked_in` and the `checkIn` block, appends `entry` to `history` and writes the audit entry.
 */
export type CheckInPlan =
  | { kind: 'replay'; checkIn: CheckInStamp }
  | { kind: 'write'; checkIn: CheckInStamp; entry: HistoryEntry; audit: AuditEntry }

/** Which passes a report reads. `dateKey` ranges are inclusive and use the equality filters that have an index. */
export type PassQuery =
  | {
      kind: 'dateKey'
      tenantId: string
      fromKey: string
      toKey: string
      statuses?: readonly PassStatus[]
      contractorId?: string
      vehicleId?: string
      driverId?: string
    }
  | { kind: 'checkIn'; tenantId: string; startMs: number; endMs: number }

/** `[startMs, endMs)` of `gateEvents.at`. */
export interface GateEventQuery {
  tenantId: string
  startMs: number
  endMs: number
}

export interface DataPort {
  getUser(uid: string): Promise<UserData | null>
  getContractor(id: string): Promise<ContractorData | null>
  getDriver(uid: string): Promise<DriverData | null>
  getDrivers(uids: string[]): Promise<Map<string, DriverData>>
  getVehicle(id: string): Promise<VehicleData | null>
  /**
   * Atomically writes the user doc (+ createdAt/createdBy/updatedAt), the optional `drivers` doc and the audit entry.
   * With `pin` it is one transaction that also creates `pinIndex/{pin.key}` and throws PinTakenError when it exists.
   */
  createUserWithAudit(
    uid: string,
    data: UserData,
    actorUid: string,
    audit: AuditEntry,
    driver?: DriverData,
    pin?: { key: string; entry: PinIndexEntry },
  ): Promise<void>
  /**
   * One transaction: deletes every `pinIndex` doc of `uid`, creates `pinIndex/{key}` (PinTakenError when it exists),
   * applies `patch` to the user doc and clears `knownDevices`, writes the audit entry.
   */
  reissuePinTx(p: { uid: string; key: string; entry: PinIndexEntry; patch: Partial<UserData>; audit: AuditEntry }): Promise<void>
  /**
   * Atomically merges `patch` (+ updatedAt) into the user doc and writes the audit entry. `driver.patch` is merged
   * into the `drivers` doc in the same batch; `driver.backfill` creates it first for drivers that predate Module 2.
   */
  updateUserWithAudit(
    uid: string,
    patch: Partial<UserData>,
    audit: AuditEntry,
    driver?: { patch: Partial<DriverData>; backfill?: DriverData },
  ): Promise<void>
  /**
   * One transaction: reserve `vehiclePlates/{tenantId}_{plateKey}`, create `vehicles/{vehicleId}`, write the audit entry.
   * Throws PlateTakenError / VehicleIdTakenError.
   */
  createVehicleTx(p: { vehicleId: string; vehicle: VehicleData; actorUid: string; audit: AuditEntry }): Promise<void>
  /**
   * One transaction: patch the vehicle (+ updatedAt), write the audit entry and, when `plate` is given, move the
   * plate guard (throws PlateTakenError). The previous plate key is read inside the transaction.
   */
  updateVehicleTx(p: {
    vehicleId: string
    patch: VehiclePatch
    plate?: { plateNo: string; plateKey: string }
    audit: AuditEntry
  }): Promise<void>
  setContractorStatusWithAudit(contractorId: string, status: ContractorStatus, audit: AuditEntry): Promise<void>
  writeAudit(audit: AuditEntry): Promise<void>
  getTenant(tenantId: string): Promise<TenantData | null>
  getPass(passId: string): Promise<PassData | null>
  /**
   * One transaction on `passes/{passId}`: creates it (`status: submitted`) when it does not exist, or moves a
   * `rejected` pass of the same driver back to `submitted` with `attempt` (moving `rejection` into
   * `rejectionHistory`). Throws PassConflictError when the stored pass does not allow that. Writes the audit entry.
   */
  submitPassTx(p: { passId: string; pass: PassWrite; audit: AuditEntry }): Promise<void>
  /**
   * One transaction: re-reads the pass and what a decision depends on (vehicle, contractor, driver), hands them to
   * `plan` (pure; throws HttpsError to refuse, `null` pass = it does not exist), then writes the planned change,
   * appends to `history` and writes the audit entry. Two concurrent decisions on one pass cannot both succeed
   * because the loser's re-read sees the winner's status.
   */
  decidePassTx(p: { passId: string; plan: (ctx: DecisionContext | null) => DecisionPlan }): Promise<DecisionPlan>
  /**
   * One transaction: re-reads the pass, vehicle, contractor and the driver's `users` doc, hands them to `plan` (pure;
   * throws HttpsError to refuse) and applies the plan. Two concurrent check-ins cannot both write: the loser's
   * re-read sees `checked_in`.
   */
  checkInTx(p: { passId: string; plan: (ctx: DecisionContext | null) => CheckInPlan }): Promise<CheckInPlan>
  /**
   * One transaction on `gateEvents/{eventId}`: creates it (+ audit) when it does not exist; otherwise writes nothing
   * and returns the stored event (`created: false`), which makes a retried denial idempotent.
   */
  denyEntryTx(p: { eventId: string; event: GateEventData; audit: AuditEntry }): Promise<{ created: boolean; event: GateEventData }>
  /** Merges the given settings into `tenants/{tenantId}` (+ audit) in one batch. */
  updateTenantSettingsWithAudit(
    tenantId: string,
    patch: {
      passSettings?: PassSettings
      checklist?: ChecklistItemDef[]
      rejectionReasons?: RejectionReasonDef[]
      gates?: GateDef[]
      sla?: SlaSettings
      retentionDays?: number
    },
    audit: AuditEntry,
  ): Promise<void>
  /** Module 6 (read only, Admin SDK, always one tenant). `count()` aggregation: no documents are read. */
  countPasses(q: PassQuery): Promise<number>
  /** At most `limit` passes, reduced to what reports need (no evidence, checklist or capture data). */
  listPasses(q: PassQuery, limit: number): Promise<ReportPass[]>
  countGateEvents(q: GateEventQuery): Promise<number>
  listGateEvents(q: GateEventQuery, limit: number): Promise<ReportEvent[]>
  /** Contractor id -> name for the tenant. */
  listContractorNames(tenantId: string): Promise<Map<string, string>>
  /** Auth uids of every `users` doc of this contractor. */
  listUserIdsByContractor(tenantId: string, contractorId: string): Promise<string[]>
}

export interface StoragePort {
  /** Metadata plus the first bytes of the object, or null when it does not exist. */
  readFile(path: string, headBytes: number): Promise<StoredFile | null>
}

export interface Deps {
  auth: AuthPort
  data: DataPort
  storage: StoragePort
  /** `veh_` + 10 random chars. */
  newVehicleId: () => string
  /** A fresh, non-trivial 8-digit PIN (`generatePin`). */
  newPin: () => string
  /** The PIN_PEPPER secret. Read lazily: only the functions that bind the secret call it. */
  pinPepper: () => string | undefined
  /** Seconds since epoch. */
  now: () => number
}

// ---- Helpers -------------------------------------------------------------------------------

export function parse<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw)
  if (!result.success) throw fail('invalid-argument', 'invalid-input', 'Invalid request')
  return result.data
}

const authErrorCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined


/** The token is only a hint; the caller must also exist, be active, and match the token's role/tenant. */
export async function requireActiveCaller(
  deps: Deps,
  caller: Caller,
  opts: { checkContractor?: boolean } = {},
): Promise<UserData> {
  // Module 12: PIN sessions have a maximum age (driver 90 days, security 16 hours), checked before anything is read.
  if (sessionExpired(caller.role, caller.authTime, deps.now())) {
    throw fail('unauthenticated', 'session-expired', 'Please enter your PIN again')
  }
  const doc = await deps.data.getUser(caller.uid)
  // A reissued PIN signs the person out everywhere at once: older sessions are refused even before their token expires.
  if (doc && isPinRole(caller.role) && typeof doc.sessionsRevokedAt === 'number' && caller.authTime < doc.sessionsRevokedAt) {
    throw fail('unauthenticated', 'session-expired', 'Please enter your PIN again')
  }
  if (
    !doc ||
    doc.status !== 'active' ||
    doc.tenantId !== caller.tenantId ||
    doc.role !== caller.role ||
    doc.contractorId !== caller.contractorId
  ) {
    throw fail('permission-denied', 'caller-not-active', 'Caller is not an active member of this tenant')
  }
  // Tokens outlive a contractor suspension by up to an hour, so contractor users are re-checked on every call.
  if (caller.contractorId !== null && opts.checkContractor !== false) {
    const contractor = await deps.data.getContractor(caller.contractorId)
    if (!contractor || contractor.tenantId !== caller.tenantId || contractor.status !== 'active') {
      throw fail('permission-denied', 'caller-not-active', 'Your contractor is not active')
    }
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

/**
 * Admin: anyone in the tenant EXCEPT other admins and themselves (admin accounts are managed by the platform super admin,
 * Module 10; a tenant admin changes their own password through `changeOwnPassword`).
 * Supervisor: drivers of their own contractor. Everyone else: nobody.
 */
function assertCanManage(caller: Caller, target: UserData): void {
  if (caller.role === 'admin' && target.role !== 'admin') return
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

/** Staff passwords only: drivers and security have server-generated PINs (Module 12). */
function assertPassword(value: string | undefined): string {
  if (value === undefined || !isValidPassword(value)) {
    throw fail('invalid-argument', 'invalid-input', `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  }
  return value
}

/** The pepper, or a typed refusal before anything is created (a deploy without the PIN_PEPPER secret). */
function pepperOf(deps: Deps): string {
  try {
    return assertPepper(deps.pinPepper())
  } catch {
    throw fail('failed-precondition', 'config-missing', 'PIN sign-in is not configured')
  }
}

/** Generated PINs are unique across every tenant: `write` throws PinTakenError on a collision and a new PIN is tried. */
const PIN_ATTEMPTS = 10
async function issueUniquePin(deps: Deps, pepper: string, write: (key: string) => Promise<void>): Promise<string> {
  for (let i = 0; i < PIN_ATTEMPTS; i++) {
    const pin = deps.newPin()
    try {
      await write(pinKey(pin, pepper))
      return pin
    } catch (e) {
      if (!(e instanceof PinTakenError)) throw e
    }
  }
  throw new Error('no free PIN after several attempts')
}

/**
 * A PIN user's Auth account has no email and no password, so no password route exists. Accounts that predate Module 12
 * (synthetic driver email, security email + password) are replaced by a credential-free one with the SAME uid (all
 * Firestore data keys on it), claims re-applied. Safe to re-run: a missing Auth user is simply created.
 */
export async function ensurePinAuthUser(
  auth: AuthPort,
  uid: string,
  p: { displayName: string; disabled: boolean; claims: Claims },
): Promise<'kept' | 'replaced' | 'created'> {
  const existing = await auth.getUser(uid)
  if (existing && !existing.email && !existing.hasPassword) return 'kept'
  if (existing) await auth.deleteUser(uid)
  await auth.createUser({ uid, displayName: p.displayName, disabled: p.disabled })
  await auth.setCustomUserClaims(uid, p.claims)
  return existing ? 'replaced' : 'created'
}

const claimsOf = (u: Pick<UserData, 'role' | 'tenantId' | 'contractorId'>): Claims => ({
  role: u.role,
  tenantId: u.tenantId,
  ...(u.contractorId ? { contractorId: u.contractorId } : {}),
})

/** Optional contact number (drivers and security): normalised, or a typed refusal. */
function contactPhone(raw: string | null | undefined): string | null {
  if (raw === undefined || raw === null || raw.trim() === '') return null
  const phone = normalisePhone(raw)
  if (!phone) throw fail('invalid-argument', 'invalid-input', 'Invalid phone number')
  return phone
}

export async function requireActiveContractor(deps: Deps, caller: Caller, contractorId: string): Promise<void> {
  const contractor = await deps.data.getContractor(contractorId)
  if (!contractor) throw fail('failed-precondition', 'contractor-invalid', 'Contractor not found')
  if (contractor.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'Contractor belongs to a different tenant')
  }
  if (contractor.status !== 'active') {
    throw fail('failed-precondition', 'contractor-invalid', 'Contractor is not active')
  }
}

export { sanitiseMeta }

export const audit = (
  caller: Caller,
  action: string,
  targetId: string,
  meta: AuditEntry['meta'] = {},
  targetType: AuditEntry['targetType'] = 'user',
): AuditEntry => ({
  tenantId: caller.tenantId,
  action,
  actorUid: caller.uid,
  actorRole: caller.role,
  targetType,
  targetId,
  meta: sanitiseMeta(meta),
})

// ---- createUser ----------------------------------------------------------------------------

/**
 * Staff (officer, supervisor) get an email and a password from the caller. Drivers and security (Module 12) get NO
 * email and NO password: the server generates their PIN, stores only its HMAC in `pinIndex` and returns it once.
 */
export async function createUser(deps: Deps, caller: Caller, raw: unknown): Promise<{ uid: string; pin?: string }> {
  const input = parse(createUserSchema, raw)
  await requireActiveCaller(deps, caller)

  // Admin accounts are created by the platform super admin only (`createWorkspace` / `addTenantAdmin`).
  const allowed =
    (caller.role === 'admin' && input.role !== 'admin') || (caller.role === 'supervisor' && input.role === 'driver')
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

  if (input.licenseNo !== undefined && input.role !== 'driver') {
    throw fail('invalid-argument', 'invalid-input', 'Only drivers have a licence number')
  }

  if (isPinRole(input.role)) return createPinUser(deps, caller, input, contractorId)

  const password = assertPassword(input.password)
  if (input.phone !== undefined || input.email === undefined) {
    throw fail('invalid-argument', 'invalid-input', 'Staff require an email only')
  }
  const email = input.email

  let uid: string
  try {
    ;({ uid } = await deps.auth.createUser({ email, password, displayName: input.name }))
  } catch (e) {
    if (authErrorCode(e) === 'auth/email-already-exists') throw fail('already-exists', 'email-exists', 'Email already registered')
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
        email,
        phone: null,
        status: 'active',
        mustChangePassword: true,
        loginType: 'password',
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

async function createPinUser(
  deps: Deps,
  caller: Caller,
  input: { role: Role; name: string; email?: string | undefined; phone?: string | undefined; password?: string | undefined; licenseNo?: string | undefined },
  contractorId: string | null,
): Promise<{ uid: string; pin: string }> {
  if (input.email !== undefined || input.password !== undefined) {
    throw fail('invalid-argument', 'invalid-input', 'Drivers and security sign in with a PIN: no email or password')
  }
  const role = input.role as PinIndexEntry['role']
  const phone = contactPhone(input.phone)
  const pepper = pepperOf(deps)

  let uid: string
  try {
    ;({ uid } = await deps.auth.createUser({ displayName: input.name }))
  } catch {
    throw fail('internal', 'internal', 'Could not create user')
  }

  try {
    const claims: Claims = { role, tenantId: caller.tenantId }
    if (contractorId) claims.contractorId = contractorId
    await deps.auth.setCustomUserClaims(uid, claims)
    const driver: DriverData | undefined =
      role === 'driver' && contractorId
        ? {
            tenantId: caller.tenantId,
            contractorId,
            name: input.name,
            phone,
            status: 'active',
            ...(input.licenseNo ? { licenseNo: input.licenseNo } : {}),
          }
        : undefined
    const data: UserData = {
      tenantId: caller.tenantId,
      role,
      contractorId,
      name: input.name,
      email: null,
      phone,
      status: 'active',
      mustChangePassword: false,
      loginType: 'pin',
      pinVersion: 1,
    }
    const entry: PinIndexEntry = { uid, tenantId: caller.tenantId, role }
    const pin = await issueUniquePin(deps, pepper, (key) =>
      deps.data.createUserWithAudit(
        uid,
        data,
        caller.uid,
        audit(caller, 'user.create', uid, { role, contractorId, pinLogin: true }),
        driver,
        { key, entry },
      ),
    )
    return { uid, pin }
  } catch {
    // Compensation: never leave an Auth user without a users doc (the pinIndex doc is written in the same transaction).
    await deps.auth.deleteUser(uid).catch(() => undefined)
    throw fail('internal', 'internal', 'Could not create user')
  }
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
  const authPatch: { displayName?: string; disabled?: boolean } = {}
  const meta: AuditEntry['meta'] = {}

  const driverPatch: Partial<DriverData> = {}
  if ((input.licenseNo !== undefined || input.photoPath !== undefined) && target.role !== 'driver') {
    throw fail('invalid-argument', 'invalid-input', 'Only drivers have a licence number or photo')
  }

  if (input.name !== undefined && input.name !== target.name) {
    patch.name = input.name
    driverPatch.name = input.name
    authPatch.displayName = input.name
    meta.name = true
  }

  // Drivers and security: an optional contact number (Module 12). It is not a login and need not be unique.
  if (input.phone !== undefined) {
    if (!isPinRole(target.role)) {
      throw fail('invalid-argument', 'invalid-input', 'Only drivers and security have a contact number')
    }
    const phone = contactPhone(input.phone)
    if (phone !== target.phone) {
      patch.phone = phone
      if (target.role === 'driver') driverPatch.phone = phone
      meta.phone = true
    }
  }

  let statusAction: string | null = null
  if (input.status !== undefined && input.status !== target.status) {
    patch.status = input.status
    driverPatch.status = input.status
    authPatch.disabled = input.status === 'disabled'
    statusAction = input.status === 'disabled' ? 'user.disable' : 'user.enable'
  }

  const driverDoc = target.role === 'driver' ? await deps.data.getDriver(input.uid) : null

  if (input.licenseNo !== undefined && (input.licenseNo ?? null) !== (driverDoc?.licenseNo ?? null)) {
    driverPatch.licenseNo = input.licenseNo
    meta.licenseNo = true
  }
  if (input.photoPath !== undefined) {
    // Only the canonical path of this driver's own photo is accepted.
    const expected = `tenants/${target.tenantId}/contractors/${target.contractorId ?? ''}/drivers/${input.uid}.jpg`
    if (!target.contractorId || input.photoPath !== expected) {
      throw fail('invalid-argument', 'photo-path-invalid', 'Invalid photo path')
    }
    if (input.photoPath !== driverDoc?.photoPath) {
      driverPatch.photoPath = input.photoPath
      meta.photo = true
    }
  }

  if (Object.keys(patch).length === 0 && Object.keys(driverPatch).length === 0) return { ok: true }

  try {
    if (Object.keys(authPatch).length > 0) await deps.auth.updateUser(input.uid, authPatch)
  } catch {
    throw fail('internal', 'internal', 'Could not update user')
  }

  if (patch.status === 'disabled') await deps.auth.revokeRefreshTokens(input.uid)

  try {
    // Drivers that predate Module 2 have no `drivers` doc yet: create it from the user doc on first edit.
    const backfill: DriverData | undefined =
      target.role === 'driver' && !driverDoc && target.contractorId
        ? {
            tenantId: target.tenantId,
            contractorId: target.contractorId,
            name: patch.name ?? target.name,
            phone: patch.phone !== undefined ? patch.phone : target.phone,
            status: patch.status ?? target.status,
          }
        : undefined
    await deps.data.updateUserWithAudit(
      input.uid,
      patch,
      audit(caller, statusAction ?? 'user.update', input.uid, meta),
      target.role === 'driver' ? { patch: driverPatch, ...(backfill ? { backfill } : {}) } : undefined,
    )
  } catch {
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
  // Drivers and security have no password (Module 12): a lost PIN is reissued, never reset.
  if (isPinRole(target.role)) {
    throw fail('failed-precondition', 'pin-user', 'This person signs in with a PIN. Use Reissue PIN instead.')
  }
  const newPassword = assertPassword(input.newPassword)

  // Flag first: if the Auth update fails afterwards, the user is merely asked to change a still-valid credential.
  try {
    await deps.data.updateUserWithAudit(
      input.uid,
      { mustChangePassword: true },
      audit(caller, 'user.resetCredential', input.uid),
    )
    await deps.auth.updateUser(input.uid, { password: newPassword })
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
  if (isPinRole(self.role)) {
    throw fail('failed-precondition', 'pin-user', 'You sign in with a PIN. Ask your supervisor for a new one.')
  }

  if (deps.now() - caller.authTime > RECENT_LOGIN_SECONDS) {
    throw fail('failed-precondition', 'recent-login-required', 'Please sign in again to change your password')
  }
  const newPassword = assertPassword(input.newPassword)

  try {
    await deps.auth.updateUser(caller.uid, { password: newPassword })
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


// ---- reissuePin (Module 12) -----------------------------------------------------------------

/**
 * A new PIN for a driver or security user (same permission scope as `resetCredential`). The old `pinIndex` doc is deleted
 * and the new one created in one transaction, so the old PIN stops working at once; `sessionsRevokedAt` and revoked
 * refresh tokens sign the person out on every phone; `knownDevices` is cleared. The PIN is returned once, never stored.
 * An account that predates Module 12 is first given a credential-free Auth user with the same uid.
 */
export async function reissuePin(deps: Deps, caller: Caller, raw: unknown): Promise<{ pin: string }> {
  const input = parse(reissuePinSchema, raw)
  await requireActiveCaller(deps, caller)
  const target = await loadTarget(deps, caller, input.uid)
  assertCanManage(caller, target)
  if (input.uid === caller.uid) throw fail('failed-precondition', 'self-reset', 'You cannot reissue your own PIN')
  if (!isPinRole(target.role)) {
    throw fail('failed-precondition', 'not-pin-user', 'Only drivers and security sign in with a PIN')
  }
  const pepper = pepperOf(deps)

  try {
    await ensurePinAuthUser(deps.auth, input.uid, { displayName: target.name, disabled: target.status === 'disabled', claims: claimsOf(target) })
  } catch {
    throw fail('internal', 'internal', 'Could not reissue the PIN')
  }

  const entry: PinIndexEntry = { uid: input.uid, tenantId: target.tenantId, role: target.role as PinIndexEntry['role'] }
  let pin: string
  try {
    pin = await issueUniquePin(deps, pepper, (key) =>
      deps.data.reissuePinTx({
        uid: input.uid,
        key,
        entry,
        patch: {
          loginType: 'pin',
          mustChangePassword: false,
          pinVersion: (target.pinVersion ?? 1) + 1,
          sessionsRevokedAt: deps.now(),
        },
        audit: audit(caller, 'user.reissuePin', input.uid, { role: target.role }),
      }),
    )
  } catch {
    throw fail('internal', 'internal', 'Could not reissue the PIN')
  }
  // `sessionsRevokedAt` already refuses older sessions; revoking refresh tokens stops them renewing at all.
  await deps.auth.revokeRefreshTokens(input.uid).catch(() => undefined)
  return { pin }
}
