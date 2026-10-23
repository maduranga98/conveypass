// Visit lifecycle: one record per vehicle visit with three stages. Security checks a vehicle in (after the combined
// `evaluateEligibility` of the penalty/inspection/document modules, which is CONSUMED here, never re-derived) and out; the
// Yard Officer logs the unloading check. Clients only read `visits` (rules); every write is one of these callables.
//
// The driver is identified by their PIN, typed at the gate: the server resolves it through `pinIndex` (HMAC under the
// PIN_PEPPER), throttles failures per guard and answers every failure with the same generic error, so the gate cannot be
// used to find out which PINs exist. The PIN is never stored, logged, audited or returned.
import { evaluateEligibility, type EligibilityResult } from './checkEligibility.js'
import { audit as makeAudit, parse, requireActiveCaller, type Deps } from './core.js'
import { dateKey as computeDateKey, DEFAULT_TIMEZONE, isValidTimezone } from './dates.js'
import { fail, failWith } from './errors.js'
import { isoFromDateKey } from './expiry.js'
import { gatesOf } from './gates.js'
import { assertPepper, normalisePin, pinKey } from './pin.js'
import { endOfDayMs } from './penaltyLogic.js'
import { can, type Action } from './permissions.js'
import { checkInVisitSchema, checkOutVisitSchema, logUnloadingCheckSchema } from './schemas.js'
import type { AuditEntry, Caller, DriverData, PinIndexEntry, TenantData, UserData, VehicleData, VisitData } from './types.js'
import { dwellLimitHoursOf, summaryMetricsFor, type SummaryMetric } from './visitLogic.js'

// ---- Port (Firestore in production, fakes in tests) ----------------------------------------------

export type VisitRecord = VisitData & { id: string }

/** What the check-in transaction read. */
export interface CheckInContext {
  /** `visits/{visitId}` when it already exists (a retry). */
  existing: VisitRecord | null
  /** A visit of this vehicle that is still checked in (at most one is ever expected). */
  vehicleActive: VisitRecord | null
  driver: DriverData | null
  /** The driver's `users` doc (fallback profile for drivers that predate Module 2). */
  driverUser: UserData | null
}

export type CheckInPlan = { kind: 'replay'; visit: VisitRecord } | { kind: 'write'; visit: VisitData; audit: AuditEntry }

export type CheckOutPlan = { kind: 'replay'; visit: VisitRecord } | { kind: 'write'; checkOut: NonNullable<VisitData['checkOut']>; audit: AuditEntry }

export type UnloadPlan = { unloadingCheck: NonNullable<VisitData['unloadingCheck']>; audit: AuditEntry }

export type SummaryStage = 'checkIn' | 'unloadingCheck' | 'checkOut'

export interface VisitScope {
  tenantId: string
  /** A supervisor sees their own contractor's visits only. */
  contractorId: string | null
}

export interface VisitPort {
  /** `pinIndex/{key}` (the HMAC of a PIN), or null. */
  lookupPin(key: string): Promise<PinIndexEntry | null>
  getVisit(visitId: string): Promise<VisitRecord | null>
  /**
   * ONE transaction: reads the visit id, the vehicle's active visit and the driver (`drivers` + `users`), hands them to
   * `plan` (pure; throws HttpsError to refuse) and writes the visit, `driverOnDutyLock` + `activeVisitId` on the driver
   * and the audit entry together. Two concurrent check-ins of one driver cannot both write.
   */
  checkInTx(p: { visitId: string; tenantId: string; vehicleId: string; driverId: string; plan: (ctx: CheckInContext) => CheckInPlan }): Promise<CheckInPlan>
  /** ONE transaction: re-reads the visit, plans the check-out, flips `status`, clears the driver's lock and audits. `null` visit = missing. */
  checkOutTx(p: { visitId: string; plan: (visit: VisitRecord | null) => CheckOutPlan }): Promise<CheckOutPlan>
  /** ONE transaction: re-reads the visit and writes `unloadingCheck` + audit. */
  unloadTx(p: { visitId: string; plan: (visit: VisitRecord | null) => UnloadPlan }): Promise<UnloadPlan>
  /** Visits whose `stage` happened on `dateKey` (`count()`, no documents read). */
  countStage(scope: VisitScope, stage: SummaryStage, dateKey: string): Promise<number>
  /** Visits still checked in; `awaitingUnload` keeps those without an unloading check. */
  countActive(scope: VisitScope, opts: { awaitingUnload: boolean }): Promise<number>
  /** Visits still checked in that carry the dwell warning, longest first. */
  listDwell(scope: VisitScope, limit: number): Promise<VisitRecord[]>
  /** Penalties issued between the two instants (inclusive), `count()`. */
  countPenaltiesIssued(scope: VisitScope, fromMs: number, toMs: number): Promise<number>
}

/** Counts failed PINs per guard. Over the limit the guard waits; a wrong PIN counts, a right one does not. */
export interface PinThrottle {
  isLocked(uid: string, nowMs: number): Promise<boolean>
  recordFailure(uid: string, nowMs: number): Promise<void>
}

export const PIN_FAILURE_LIMIT = 8
export const PIN_FAILURE_WINDOW_MS = 15 * 60_000

// ---- Shared helpers -----------------------------------------------------------------------

const timezoneOf = (tenant: TenantData | null): string =>
  tenant?.timezone && isValidTimezone(tenant.timezone) ? tenant.timezone : DEFAULT_TIMEZONE

function requireCan(caller: Caller, action: Action): void {
  if (!can(caller.role, action)) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
}

/** Another tenant's visit looks exactly like a missing one. */
function ownVisit(visit: VisitRecord | null, tenantId: string): VisitRecord {
  if (!visit || visit.tenantId !== tenantId) throw fail('not-found', 'visit-not-found', 'Visit not found')
  return visit
}

/** The same refusal for every PIN failure: wrong, unknown, another company, not a driver, disabled, not on this vehicle. */
const pinInvalid = () => fail('unauthenticated', 'pin-invalid', 'That PIN didn’t work for this vehicle')

// ---- checkInVisit ----------------------------------------------------------------------------

export type CheckInVisitResult =
  | { outcome: 'checked_in'; visitId: string; at: number; driverName: string; plateNo: string }
  /** Entry refused by the shared eligibility check: `eligibility` is its output, unchanged (documents, penalties, clearance). */
  | { outcome: 'blocked'; driverName: string; plateNo: string; eligibility: EligibilityResult }

interface PlanInput {
  caller: Caller
  actorName: string
  visitId: string
  requestId: string
  vehicle: VehicleData & { id: string }
  driverId: string
  gate: { id: string; name: string } | null
  dateKey: string
  nowMs: number
}

/** Pure: decides a check-in from what the transaction read. Throws HttpsError to refuse. */
export function planVisitCheckIn(i: PlanInput, ctx: CheckInContext): CheckInPlan {
  const { caller, vehicle } = i
  if (ctx.existing) {
    // A retry of a call that already went through: same id, same guard, same vehicle. Anything else is a clash.
    const e = ctx.existing
    if (e.tenantId === caller.tenantId && e.checkIn.securityUserId === caller.uid && e.vehicleId === i.vehicle.id && e.driverId === i.driverId) {
      return { kind: 'replay', visit: e }
    }
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }
  const driver = ctx.driver && ctx.driver.tenantId === caller.tenantId ? ctx.driver : null
  const profileName = driver?.name ?? ctx.driverUser?.name
  const contractorId = driver?.contractorId ?? ctx.driverUser?.contractorId
  if (!profileName || !contractorId) throw fail('failed-precondition', 'driver-inactive', 'This driver is disabled')
  // The duty lock is enforced here, inside the transaction: the UI cannot be the only guard.
  if (driver?.driverOnDutyLock === true) {
    throw failWith('failed-precondition', 'driver-on-duty', 'This driver is already on a visit', {
      visitId: driver?.activeVisitId ?? null,
    })
  }
  if (ctx.vehicleActive) {
    throw failWith('failed-precondition', 'vehicle-on-site', 'This vehicle is already checked in', {
      byName: ctx.vehicleActive.checkIn.securityUserName,
      at: ctx.vehicleActive.checkIn.timestamp,
    })
  }
  const visit: VisitData = {
    tenantId: caller.tenantId,
    vehicleId: vehicle.id,
    driverId: i.driverId,
    contractorId: vehicle.contractorId,
    plateNo: vehicle.plateNo,
    driverName: profileName,
    checkIn: {
      timestamp: i.nowMs,
      dateKey: i.dateKey,
      securityUserId: caller.uid,
      securityUserName: i.actorName,
      gateId: i.gate?.id ?? null,
      gateLocation: i.gate?.name ?? null,
      requestId: i.requestId,
    },
    unloadingCheck: null,
    checkOut: null,
    status: 'checked_in',
    driverOnDutyLock: true,
    dwellWarning: false,
  }
  return {
    kind: 'write',
    visit,
    audit: makeAudit(caller, 'visit.checkIn', i.visitId, { vehicleId: vehicle.id, driverId: i.driverId, gateId: i.gate?.id ?? null }, 'visit'),
  }
}

export async function checkInVisit(
  deps: Deps,
  port: VisitPort,
  throttle: PinThrottle,
  caller: Caller,
  raw: unknown,
): Promise<CheckInVisitResult> {
  const input = parse(checkInVisitSchema, raw)
  requireCan(caller, 'visit.checkIn')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)

  // Unknown and foreign vehicles look the same.
  const vehicle = await deps.data.getVehicle(input.vehicleId)
  if (!vehicle || vehicle.tenantId !== caller.tenantId) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  const withId = { ...vehicle, id: input.vehicleId }

  let gate: { id: string; name: string } | null = null
  if (input.gateId !== undefined) {
    gate = gatesOf(tenant).find((g) => g.id === input.gateId) ?? null
    if (!gate) throw fail('invalid-argument', 'gate-invalid', 'Choose a valid gate')
  }

  // A retry of a check-in that already went through answers from the stored visit, with no PIN and no eligibility.
  const existing = await port.getVisit(input.visitId)
  if (existing) {
    if (existing.tenantId === caller.tenantId && existing.checkIn.securityUserId === caller.uid && existing.vehicleId === input.vehicleId) {
      return { outcome: 'checked_in', visitId: input.visitId, at: existing.checkIn.timestamp, driverName: existing.driverName, plateNo: existing.plateNo }
    }
    throw fail('already-exists', 'request-conflict', 'This request was already used')
  }

  // ---- who is driving: PIN -> pinIndex -> driver ----
  if (await throttle.isLocked(caller.uid, nowMs)) {
    throw fail('resource-exhausted', 'pin-throttled', 'Too many wrong PINs. Wait a few minutes and try again')
  }
  const pin = normalisePin(input.pin)
  const entry = pin ? await port.lookupPin(pinKey(pin, assertPepper(deps.pinPepper()))) : null
  const driverUser = entry ? await deps.data.getUser(entry.uid) : null
  const valid =
    entry !== null &&
    entry.role === 'driver' &&
    entry.tenantId === caller.tenantId &&
    driverUser !== null &&
    driverUser.role === 'driver' &&
    driverUser.status === 'active' &&
    driverUser.tenantId === caller.tenantId &&
    vehicle.assignedDriverIds.includes(entry.uid)
  if (!valid || !entry) {
    await throttle.recordFailure(caller.uid, nowMs)
    throw pinInvalid()
  }
  const driverId = entry.uid

  // ---- vehicle, contractor and driver must be active ----
  if (vehicle.status !== 'active') throw fail('failed-precondition', 'vehicle-suspended', 'This vehicle is suspended')
  const contractor = await deps.data.getContractor(vehicle.contractorId)
  if (!contractor || contractor.tenantId !== caller.tenantId || contractor.status !== 'active') {
    throw fail('failed-precondition', 'contractor-suspended', 'This contractor is suspended')
  }

  // ---- eligibility: the combined Module 2-4 check, consumed as it is ----
  const eligibility = await evaluateEligibility(deps, caller.tenantId, { vehicleId: input.vehicleId, driverId })
  if (!eligibility.eligible) {
    await deps.data
      .writeAudit(
        makeAudit(caller, 'visit.checkInBlocked', input.visitId, { vehicleId: input.vehicleId, driverId, status: eligibility.status }, 'visit'),
      )
      .catch(() => undefined)
    return { outcome: 'blocked', driverName: driverUser?.name ?? '', plateNo: vehicle.plateNo, eligibility }
  }

  const dateKey = computeDateKey(timezoneOf(tenant), new Date(nowMs))
  const planned = await port.checkInTx({
    visitId: input.visitId,
    tenantId: caller.tenantId,
    vehicleId: input.vehicleId,
    driverId,
    plan: (ctx) =>
      planVisitCheckIn(
        { caller, actorName: actor.name, visitId: input.visitId, requestId: input.requestId, vehicle: withId, driverId, gate, dateKey, nowMs },
        ctx,
      ),
  })
  const stored = planned.visit
  return { outcome: 'checked_in', visitId: input.visitId, at: stored.checkIn.timestamp, driverName: stored.driverName, plateNo: stored.plateNo }
}

// ---- checkOutVisit ---------------------------------------------------------------------------

export interface CheckOutVisitResult {
  visitId: string
  at: number
  /** True when the Yard Officer has not logged the unloading check for this visit (informational only). */
  unloadingMissing: boolean
}

/** Pure: decides a check-out. No eligibility is checked on the way out. */
export function planVisitCheckOut(
  i: { caller: Caller; actorName: string; visitId: string; requestId: string; dateKey: string; nowMs: number },
  visit: VisitRecord | null,
): CheckOutPlan {
  const v = ownVisit(visit, i.caller.tenantId)
  if (v.status === 'checked_out') {
    if (v.checkOut?.requestId === i.requestId) return { kind: 'replay', visit: v }
    throw failWith('already-exists', 'visit-checked-out', 'This vehicle has already left', {
      byName: v.checkOut?.securityUserName ?? null,
      at: v.checkOut?.timestamp ?? null,
    })
  }
  return {
    kind: 'write',
    checkOut: { timestamp: i.nowMs, dateKey: i.dateKey, securityUserId: i.caller.uid, securityUserName: i.actorName, requestId: i.requestId },
    audit: makeAudit(i.caller, 'visit.checkOut', i.visitId, { vehicleId: v.vehicleId, driverId: v.driverId, unloaded: v.unloadingCheck?.unloaded ?? null }, 'visit'),
  }
}

export async function checkOutVisit(deps: Deps, port: VisitPort, caller: Caller, raw: unknown): Promise<CheckOutVisitResult> {
  const input = parse(checkOutVisitSchema, raw)
  requireCan(caller, 'visit.checkOut')
  const actor = await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  const dateKey = computeDateKey(timezoneOf(tenant), new Date(nowMs))
  let unloadingMissing = false
  const planned = await port.checkOutTx({
    visitId: input.visitId,
    plan: (visit) => {
      const p = planVisitCheckOut({ caller, actorName: actor.name, visitId: input.visitId, requestId: input.requestId, dateKey, nowMs }, visit)
      unloadingMissing = visit !== null && visit.unloadingCheck === null
      return p
    },
  })
  const at = planned.kind === 'write' ? planned.checkOut.timestamp : (planned.visit.checkOut?.timestamp ?? nowMs)
  return { visitId: input.visitId, at, unloadingMissing }
}

// ---- logUnloadingCheck (Yard Officer) -----------------------------------------------------------

/** Pure: decides an unloading check on a visit that is still checked in. */
export function planUnloading(
  i: { caller: Caller; actorName: string; visitId: string; unloaded: boolean; unloadLocation: string | null; dateKey: string; nowMs: number },
  visit: VisitRecord | null,
): UnloadPlan {
  const v = ownVisit(visit, i.caller.tenantId)
  if (v.status !== 'checked_in') throw fail('failed-precondition', 'visit-not-active', 'This vehicle has already left')
  return {
    unloadingCheck: {
      performed: true,
      timestamp: i.nowMs,
      dateKey: i.dateKey,
      officerUserId: i.caller.uid,
      officerName: i.actorName,
      unloaded: i.unloaded,
      unloadLocation: i.unloaded ? i.unloadLocation : null,
    },
    audit: makeAudit(
      i.caller,
      v.unloadingCheck ? 'visit.unloadingUpdate' : 'visit.unloadingCheck',
      i.visitId,
      { vehicleId: v.vehicleId, unloaded: i.unloaded },
      'visit',
    ),
  }
}

export async function logUnloadingCheck(deps: Deps, port: VisitPort, caller: Caller, raw: unknown): Promise<{ visitId: string; at: number }> {
  const input = parse(logUnloadingCheckSchema, raw)
  requireCan(caller, 'visit.unloadingCheck')
  const actor = await requireActiveCaller(deps, caller)
  // "Unloaded: yes" needs a place; "no" never has one.
  if (input.unloaded && !input.unloadLocation) throw fail('invalid-argument', 'unload-location-required', 'Say where it was unloaded')
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  const dateKey = computeDateKey(timezoneOf(tenant), new Date(nowMs))
  const planned = await port.unloadTx({
    visitId: input.visitId,
    plan: (visit) =>
      planUnloading(
        { caller, actorName: actor.name, visitId: input.visitId, unloaded: input.unloaded, unloadLocation: input.unloadLocation ?? null, dateKey, nowMs },
        visit,
      ),
  })
  return { visitId: input.visitId, at: planned.unloadingCheck.timestamp }
}

// ---- getDailySummary ---------------------------------------------------------------------------

export interface DwellItem {
  visitId: string
  plateNo: string
  driverName: string
  checkInAt: number
  /** Whole hours on site at the time of the call. */
  hours: number
}

export interface DailySummary {
  /** `YYYYMMDD` in the company's timezone. */
  dateKey: string
  generatedAt: number
  dwellLimitHours: number
  /** Only the tiles this role may see (`summaryMetricsFor`). */
  tiles: Partial<Record<SummaryMetric, number>>
  /** Visits flagged by the dwell job and still on site (only for roles that see `dwellWarnings`). */
  dwell: DwellItem[]
}

const DWELL_LIST_LIMIT = 50

/** `[start, end]` instants (ms, inclusive) of calendar day `dateKey` in `timezone`. */
export function dayBoundsMs(timezone: string, dateKey: string): { from: number; to: number } {
  const iso = isoFromDateKey(dateKey)
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const prev = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
  return { from: endOfDayMs(timezone, prev) + 1, to: endOfDayMs(timezone, iso) }
}

/** Counts only (plus the dwell list), filtered by role on the server: the same function serves every role's screen. */
export async function getDailySummary(deps: Deps, port: VisitPort, caller: Caller): Promise<DailySummary> {
  requireCan(caller, 'visit.summary')
  await requireActiveCaller(deps, caller)
  const nowMs = deps.now() * 1000
  const tenant = await deps.data.getTenant(caller.tenantId)
  const tz = timezoneOf(tenant)
  const today = computeDateKey(tz, new Date(nowMs))
  const scope: VisitScope = { tenantId: caller.tenantId, contractorId: caller.role === 'supervisor' ? caller.contractorId : null }
  if (caller.role === 'supervisor' && !scope.contractorId) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  const metrics = summaryMetricsFor(caller.role)
  const { from, to } = dayBoundsMs(tz, today)

  const counters: Record<SummaryMetric, () => Promise<number>> = {
    checkIns: () => port.countStage(scope, 'checkIn', today),
    unloads: () => port.countStage(scope, 'unloadingCheck', today),
    checkOuts: () => port.countStage(scope, 'checkOut', today),
    onSite: () => port.countActive(scope, { awaitingUnload: false }),
    awaitingUnload: () => port.countActive(scope, { awaitingUnload: true }),
    suspensions: () => port.countPenaltiesIssued(scope, from, to),
    dwellWarnings: async () => 0, // filled from the list below
  }
  const wanted = metrics.filter((m) => m !== 'dwellWarnings')
  const values = await Promise.all(wanted.map((m) => counters[m]()))
  const tiles: DailySummary['tiles'] = {}
  wanted.forEach((m, i) => {
    tiles[m] = values[i] as number
  })

  let dwell: DwellItem[] = []
  if (metrics.includes('dwellWarnings')) {
    const list = await port.listDwell(scope, DWELL_LIST_LIMIT)
    dwell = list.map((v) => ({
      visitId: v.id,
      plateNo: v.plateNo,
      driverName: v.driverName,
      checkInAt: v.checkIn.timestamp,
      hours: Math.floor((nowMs - v.checkIn.timestamp) / 3_600_000),
    }))
    tiles.dwellWarnings = dwell.length
  }
  return { dateKey: today, generatedAt: nowMs, dwellLimitHours: dwellLimitHoursOf(tenant), tiles, dwell }
}
