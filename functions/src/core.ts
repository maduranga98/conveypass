import { z } from 'zod'
import {
  driverEmail,
  isValidPassword,
  isValidPin,
  normalisePhone,
  PASSWORD_MIN_LENGTH,
} from './credentials.js'
import type { SlaSettings } from './defaultSla.js'
import type { ReportEvent, ReportPass } from './reports/types.js'
import { fail } from './errors.js'
import {
  changeOwnPasswordSchema,
  createUserSchema,
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
  createUser(p: { email: string; password: string; displayName: string }): Promise<{ uid: string }>
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
  /** Atomically writes the user doc (+ createdAt/createdBy/updatedAt), the optional `drivers` doc and the audit entry. */
  createUserWithAudit(
    uid: string,
    data: UserData,
    actorUid: string,
    audit: AuditEntry,
    driver?: DriverData,
  ): Promise<void>
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
  const doc = await deps.data.getUser(caller.uid)
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

/**
 * Audit `meta` is short scalars only. Whatever a caller passes, secrets never reach the log: values under keys that
 * name a credential keep only their type (booleans and numbers), and strings that look like URLs, data URIs, JWTs
 * or long blobs (photo URLs, file contents) are replaced. Nothing here is expected to trigger; it is the net under
 * the redaction test (`audit.redaction.test.ts`).
 */
const SECRET_KEY = /passw|passphrase|pin$|^pin|token|secret|credential|apikey|authorization|dataurl|base64|content|bytes/i
const SECRET_VALUE = /https?:\/\/|data:|^eyJ|[A-Za-z0-9+/_-]{60,}/

export function sanitiseMeta(meta: AuditEntry['meta']): AuditEntry['meta'] {
  const out: AuditEntry['meta'] = {}
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'string' && (SECRET_KEY.test(key) || SECRET_VALUE.test(value) || value.length > 200)) {
      out[key] = '[redacted]'
    } else {
      out[key] = value
    }
  }
  return out
}

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
  if (input.licenseNo !== undefined && input.role !== 'driver') {
    throw fail('invalid-argument', 'invalid-input', 'Only drivers have a licence number')
  }

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
    const driver: DriverData | undefined =
      input.role === 'driver' && contractorId && docPhone
        ? {
            tenantId: caller.tenantId,
            contractorId,
            name: input.name,
            phone: docPhone,
            status: 'active',
            ...(input.licenseNo ? { licenseNo: input.licenseNo } : {}),
          }
        : undefined
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
      driver,
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

  let previousAuthEmail: string | null = null
  if (input.phone !== undefined) {
    if (target.role !== 'driver') {
      throw fail('invalid-argument', 'invalid-input', 'Only drivers have a phone number')
    }
    const phone = normalisePhone(input.phone)
    if (!phone) throw fail('invalid-argument', 'invalid-input', 'Invalid phone number')
    if (phone !== target.phone) {
      patch.phone = phone
      driverPatch.phone = phone
      authPatch.email = driverEmail(phone) // the synthetic email is the driver's login identity
      previousAuthEmail = target.phone ? driverEmail(target.phone) : null
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
  } catch (e) {
    if (authErrorCode(e) === 'auth/email-already-exists') {
      throw fail('already-exists', 'phone-exists', 'Phone number already registered')
    }
    throw fail('internal', 'internal', 'Could not update user')
  }

  if (patch.status === 'disabled') await deps.auth.revokeRefreshTokens(input.uid)

  try {
    // Drivers that predate Module 2 have no `drivers` doc yet: create it from the user doc on first edit.
    const backfill: DriverData | undefined =
      target.role === 'driver' && !driverDoc && target.contractorId && (patch.phone ?? target.phone)
        ? {
            tenantId: target.tenantId,
            contractorId: target.contractorId,
            name: patch.name ?? target.name,
            phone: (patch.phone ?? target.phone) as string,
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

