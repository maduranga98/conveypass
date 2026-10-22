// Live eligibility: the documents of Module 2 (insurance, registration, licence) combined with this module's penalties.
// ONE service: the `checkEligibility` callable, the gate's check-in and the vehicle-driver assignment all call
// `evaluateEligibility`, so the rule never exists twice. `blocked` overrides everything else. Dates and penalties are read
// live (the denormalised `eligibilityStatus` is up to a day old and is not used here).
import { eligibilityContext, parse, requireActiveCaller, type Deps } from './core.js'
import { fail } from './errors.js'
import { computeEligibility, type EligibilityStatus } from './expiry.js'
import { can } from './permissions.js'
import { blockingPenalties, combineStatus, type CombinedStatus } from './penaltyLogic.js'
import { checkEligibilitySchema } from './schemas.js'
import type { Caller } from './types.js'

/** What the caller may know about a blocking penalty: its type and when it ends. Never the reason, issuer or photo. */
export interface BlockingPenaltyInfo {
  id: string
  typeName: string
  permanent: boolean
  /** Last millisecond of the final day; null for a permanent penalty. */
  endDate: number | null
}

export interface SubjectEligibility {
  id: string
  /** Worst document status, computed now from the stored dates and the company's warning window. */
  documentStatus: EligibilityStatus
  blocked: boolean
  penalties: BlockingPenaltyInfo[]
}

export interface EligibilityResult {
  /** `blocked` when anything blocks; otherwise the worst document status. */
  status: CombinedStatus
  blocked: boolean
  vehicle: SubjectEligibility | null
  driver: SubjectEligibility | null
  /** Milliseconds, server time. */
  checkedAt: number
}

/** A driver as the penalty module needs to see one: the Module 2 profile, or for a driver that predates it the `users` record. */
export interface DriverRef {
  name: string
  contractorId: string
  licenseExpiry?: string | null | undefined
}

/**
 * Drivers created before Module 2 have no `drivers` doc until their first edit, but they can sign in, hold passes and
 * be let in at the gate, so they must be penalisable and checkable too: fall back to their `users` record (a driver of
 * this tenant). Another tenant's driver, a non-driver and a missing one are all `null`.
 */
export async function resolveDriver(deps: Deps, tenantId: string, uid: string): Promise<DriverRef | null> {
  const profile = await deps.data.getDriver(uid)
  if (profile) return profile.tenantId === tenantId ? profile : null
  const user = await deps.data.getUser(uid)
  return user && user.tenantId === tenantId && user.role === 'driver' && user.contractorId ? { name: user.name, contractorId: user.contractorId } : null
}

/**
 * Evaluates a vehicle and/or a driver of one tenant. A record of another tenant is reported as not found, so nothing about
 * it leaks. Pure reads: nothing is written.
 */
export async function evaluateEligibility(
  deps: Deps,
  tenantId: string,
  ref: { vehicleId?: string | undefined; driverId?: string | undefined },
): Promise<EligibilityResult> {
  const nowMs = deps.now() * 1000
  const [ctx, vehicle, driver, active] = await Promise.all([
    eligibilityContext(deps, tenantId),
    ref.vehicleId ? deps.data.getVehicle(ref.vehicleId) : Promise.resolve(null),
    ref.driverId ? resolveDriver(deps, tenantId, ref.driverId) : Promise.resolve(null),
    deps.data.listActivePenalties({ tenantId, vehicleId: ref.vehicleId, driverId: ref.driverId }),
  ])
  if (ref.vehicleId && (!vehicle || vehicle.tenantId !== tenantId)) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  if (ref.driverId && !driver) throw fail('not-found', 'user-not-found', 'Driver not found')

  const subject = (id: string, scope: { vehicleId?: string; driverId?: string }, dates: (string | null | undefined)[]): SubjectEligibility => {
    const penalties = blockingPenalties(active, scope, nowMs)
    return {
      id,
      documentStatus: computeEligibility(dates, ctx.today, ctx.warningDays),
      blocked: penalties.length > 0,
      penalties: penalties.map((p) => ({
        id: p.id,
        typeName: p.typeName,
        permanent: p.duration.kind === 'permanent',
        endDate: p.duration.kind === 'fixed' ? p.duration.endDate : null,
      })),
    }
  }
  // A penalty on "both" appears on each side, but a penalty that names only the vehicle never blocks an unrelated driver.
  const v = vehicle && ref.vehicleId ? subject(ref.vehicleId, { vehicleId: ref.vehicleId }, [vehicle.insuranceExpiry, vehicle.registrationExpiry]) : null
  const d = driver && ref.driverId ? subject(ref.driverId, { driverId: ref.driverId }, [driver.licenseExpiry]) : null
  const blocked = (v?.blocked ?? false) || (d?.blocked ?? false)
  return {
    status: combineStatus(blocked, [v?.documentStatus, d?.documentStatus]),
    blocked,
    vehicle: v,
    driver: d,
    checkedAt: nowMs,
  }
}

/**
 * `checkEligibility({ vehicleId?, driverId? })`. Admin, officer, Safety Officer and security see the whole company; a
 * supervisor only their own contractor's vehicles and drivers (anything else looks like a missing record).
 */
export async function checkEligibility(deps: Deps, caller: Caller, raw: unknown): Promise<EligibilityResult> {
  const input = parse(checkEligibilitySchema, raw)
  if (!can(caller.role, 'eligibility.check')) throw fail('permission-denied', 'forbidden', 'You are not allowed to do that')
  await requireActiveCaller(deps, caller)
  if (caller.role === 'supervisor') {
    const [vehicle, driver] = await Promise.all([
      input.vehicleId ? deps.data.getVehicle(input.vehicleId) : Promise.resolve(null),
      input.driverId ? resolveDriver(deps, caller.tenantId, input.driverId) : Promise.resolve(null),
    ])
    if (input.vehicleId && vehicle?.contractorId !== caller.contractorId) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
    if (input.driverId && driver?.contractorId !== caller.contractorId) throw fail('not-found', 'user-not-found', 'Driver not found')
  }
  return evaluateEligibility(deps, caller.tenantId, input)
}
