import {
  audit,
  parse,
  PlateTakenError,
  requireActiveCaller,
  requireActiveContractor,
  VehicleIdTakenError,
  type Deps,
} from './core.js'
import { fail } from './errors.js'
import { normalisePlate } from './plate.js'
import {
  createVehicleSchema,
  importVehiclesSchema,
  setContractorStatusSchema,
  setVehicleDriversSchema,
  setVehicleStatusSchema,
  updateVehicleSchema,
} from './schemas.js'
import type { AuditEntry, Caller, VehicleData, VehiclePatch } from './types.js'
import { isVehicleType } from './vehicleTypes.js'

const MAX_ID_ATTEMPTS = 3

/** Only admins and supervisors manage vehicles. Callers are already verified against their `users` doc. */
async function requireVehicleManager(deps: Deps, caller: Caller): Promise<void> {
  await requireActiveCaller(deps, caller)
  if (caller.role !== 'admin' && caller.role !== 'supervisor') {
    throw fail('permission-denied', 'forbidden', 'You are not allowed to manage vehicles')
  }
}

/** Admin names the contractor; a supervisor is always forced to their own, whatever the client sent. */
function scopedContractorId(caller: Caller, requested: string | undefined): string {
  const id = caller.role === 'supervisor' ? caller.contractorId : (requested ?? null)
  if (!id) throw fail('invalid-argument', 'invalid-input', 'contractorId is required')
  return id
}

async function loadManagedVehicle(deps: Deps, caller: Caller, vehicleId: string): Promise<VehicleData> {
  const vehicle = await deps.data.getVehicle(vehicleId)
  if (!vehicle) throw fail('not-found', 'vehicle-not-found', 'Vehicle not found')
  if (vehicle.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'Vehicle belongs to a different tenant')
  }
  if (caller.role === 'supervisor' && vehicle.contractorId !== caller.contractorId) {
    throw fail('permission-denied', 'forbidden', 'You are not allowed to manage this vehicle')
  }
  return vehicle
}

/** Every driver must be an active driver of this contractor and tenant. */
async function assertDriversAssignable(
  deps: Deps,
  tenantId: string,
  contractorId: string,
  driverIds: string[],
): Promise<string[]> {
  const unique = [...new Set(driverIds)]
  const found = await deps.data.getDrivers(unique)
  for (const uid of unique) {
    const d = found.get(uid)
    if (!d || d.tenantId !== tenantId || d.contractorId !== contractorId || d.status !== 'active') {
      throw fail('failed-precondition', 'driver-invalid', 'Drivers must be active and belong to the same contractor')
    }
  }
  return unique
}

const plateTaken = () => fail('already-exists', 'plate-exists', 'A vehicle with this plate already exists')

/** Creates the vehicle in one transaction; retries with a fresh id on the (vanishingly rare) id collision. */
async function createVehicleOnce(
  deps: Deps,
  caller: Caller,
  vehicle: Omit<VehicleData, 'status' | 'assignedDriverIds'> & { assignedDriverIds: string[] },
  via: 'manual' | 'import',
): Promise<string> {
  const data: VehicleData = { ...vehicle, status: 'active' }
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const vehicleId = deps.newVehicleId()
    try {
      await deps.data.createVehicleTx({
        vehicleId,
        vehicle: data,
        actorUid: caller.uid,
        audit: audit(
          caller,
          'vehicle.create',
          vehicleId,
          { plateKey: data.plateKey, contractorId: data.contractorId, via },
          'vehicle',
        ),
      })
      return vehicleId
    } catch (e) {
      if (e instanceof VehicleIdTakenError) continue
      throw e
    }
  }
  throw fail('internal', 'internal', 'Could not allocate a vehicle id')
}

// ---- createVehicle -------------------------------------------------------------------------

export async function createVehicle(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ vehicleId: string; plateNo: string }> {
  const input = parse(createVehicleSchema, raw)
  await requireVehicleManager(deps, caller)

  const contractorId = scopedContractorId(caller, input.contractorId)
  await requireActiveContractor(deps, caller, contractorId)

  const plate = normalisePlate(input.plateNo)
  if (!plate) throw fail('invalid-argument', 'invalid-input', 'Invalid plate number')
  const assignedDriverIds = await assertDriversAssignable(deps, caller.tenantId, contractorId, input.driverIds ?? [])

  try {
    const vehicleId = await createVehicleOnce(
      deps,
      caller,
      {
        tenantId: caller.tenantId,
        contractorId,
        plateNo: plate.plateNo,
        plateKey: plate.plateKey,
        type: input.type,
        ...(input.makeModel ? { makeModel: input.makeModel } : {}),
        assignedDriverIds,
      },
      'manual',
    )
    return { vehicleId, plateNo: plate.plateNo }
  } catch (e) {
    if (e instanceof PlateTakenError) throw plateTaken()
    throw e
  }
}

// ---- updateVehicle -------------------------------------------------------------------------

export async function updateVehicle(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(updateVehicleSchema, raw)
  await requireVehicleManager(deps, caller)
  const vehicle = await loadManagedVehicle(deps, caller, input.vehicleId)

  const patch: VehiclePatch = {}
  const meta: AuditEntry['meta'] = {}
  let plate: { plateNo: string; plateKey: string } | undefined

  if (input.plateNo !== undefined) {
    const next = normalisePlate(input.plateNo)
    if (!next) throw fail('invalid-argument', 'invalid-input', 'Invalid plate number')
    if (next.plateNo !== vehicle.plateNo) {
      patch.plateNo = next.plateNo
      meta.plate = true
      if (next.plateKey !== vehicle.plateKey) plate = next
    }
  }
  if (input.type !== undefined && input.type !== vehicle.type) {
    patch.type = input.type
    meta.type = true
  }
  if (input.makeModel !== undefined && input.makeModel !== (vehicle.makeModel ?? '')) {
    patch.makeModel = input.makeModel === '' ? null : input.makeModel
    meta.makeModel = true
  }
  if (Object.keys(patch).length === 0) return { ok: true }

  try {
    await deps.data.updateVehicleTx({
      vehicleId: input.vehicleId,
      patch,
      ...(plate ? { plate } : {}),
      audit: audit(caller, 'vehicle.update', input.vehicleId, meta, 'vehicle'),
    })
  } catch (e) {
    if (e instanceof PlateTakenError) throw plateTaken()
    throw e
  }
  return { ok: true }
}

// ---- setVehicleStatus ----------------------------------------------------------------------

export async function setVehicleStatus(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(setVehicleStatusSchema, raw)
  await requireVehicleManager(deps, caller)
  const vehicle = await loadManagedVehicle(deps, caller, input.vehicleId)
  if (vehicle.status === input.status) return { ok: true }

  await deps.data.updateVehicleTx({
    vehicleId: input.vehicleId,
    patch: { status: input.status },
    audit: audit(
      caller,
      input.status === 'suspended' ? 'vehicle.suspend' : 'vehicle.activate',
      input.vehicleId,
      {},
      'vehicle',
    ),
  })
  return { ok: true }
}

// ---- setVehicleDrivers ---------------------------------------------------------------------

export async function setVehicleDrivers(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true }> {
  const input = parse(setVehicleDriversSchema, raw)
  await requireVehicleManager(deps, caller)
  const vehicle = await loadManagedVehicle(deps, caller, input.vehicleId)
  const assignedDriverIds = await assertDriversAssignable(deps, vehicle.tenantId, vehicle.contractorId, input.driverIds)

  await deps.data.updateVehicleTx({
    vehicleId: input.vehicleId,
    patch: { assignedDriverIds },
    audit: audit(caller, 'vehicle.setDrivers', input.vehicleId, { count: assignedDriverIds.length }, 'vehicle'),
  })
  return { ok: true }
}

// ---- importVehicles ------------------------------------------------------------------------

export type ImportRowError = 'invalid-plate' | 'invalid-type' | 'invalid-make-model' | 'plate-exists' | 'internal'

export interface ImportRowResult {
  /** 1-based position in the submitted `rows`. */
  row: number
  ok: boolean
  vehicleId?: string
  error?: ImportRowError
}

/** Each row is its own transaction: one bad row never fails the batch. */
export async function importVehicles(
  deps: Deps,
  caller: Caller,
  raw: unknown,
): Promise<{ results: ImportRowResult[]; created: number }> {
  const input = parse(importVehiclesSchema, raw)
  await requireVehicleManager(deps, caller)
  const contractorId = scopedContractorId(caller, input.contractorId)
  await requireActiveContractor(deps, caller, contractorId)

  const results: ImportRowResult[] = []
  for (const [i, row] of input.rows.entries()) {
    const result = (error: ImportRowError): ImportRowResult => ({ row: i + 1, ok: false, error })
    const plate = normalisePlate(row.plateNo)
    if (!plate) {
      results.push(result('invalid-plate'))
      continue
    }
    const type = row.type.trim()
    if (!isVehicleType(type)) {
      results.push(result('invalid-type'))
      continue
    }
    const makeModel = (row.makeModel ?? '').trim()
    if (makeModel.length > 60) {
      results.push(result('invalid-make-model'))
      continue
    }
    try {
      const vehicleId = await createVehicleOnce(
        deps,
        caller,
        {
          tenantId: caller.tenantId,
          contractorId,
          plateNo: plate.plateNo,
          plateKey: plate.plateKey,
          type,
          ...(makeModel ? { makeModel } : {}),
          assignedDriverIds: [],
        },
        'import',
      )
      results.push({ row: i + 1, ok: true, vehicleId })
    } catch (e) {
      results.push(result(e instanceof PlateTakenError ? 'plate-exists' : 'internal'))
    }
  }

  const created = results.filter((r) => r.ok).length
  await deps.data
    .writeAudit(
      audit(caller, 'vehicle.import', contractorId, { rows: input.rows.length, created, failed: results.length - created }, 'contractor'),
    )
    .catch(() => undefined) // the per-vehicle entries are already written; the summary is best-effort
  return { results, created }
}

// ---- setContractorStatus -------------------------------------------------------------------

export async function setContractorStatus(deps: Deps, caller: Caller, raw: unknown): Promise<{ ok: true; revoked: number }> {
  const input = parse(setContractorStatusSchema, raw)
  await requireActiveCaller(deps, caller)
  if (caller.role !== 'admin') throw fail('permission-denied', 'forbidden', 'Only admins can change a contractor status')

  const contractor = await deps.data.getContractor(input.contractorId)
  if (!contractor) throw fail('not-found', 'contractor-not-found', 'Contractor not found')
  if (contractor.tenantId !== caller.tenantId) {
    throw fail('permission-denied', 'tenant-mismatch', 'Contractor belongs to a different tenant')
  }

  const changed = contractor.status !== input.status
  // Activating changes the doc only: users who were disabled individually stay disabled.
  if (!changed && input.status === 'active') return { ok: true, revoked: 0 }

  if (changed) {
    try {
      await deps.data.setContractorStatusWithAudit(
        input.contractorId,
        input.status,
        audit(
          caller,
          input.status === 'suspended' ? 'contractor.suspend' : 'contractor.activate',
          input.contractorId,
          {},
          'contractor',
        ),
      )
    } catch {
      throw fail('internal', 'internal', 'Could not update contractor')
    }
  }
  if (input.status === 'active') return { ok: true, revoked: 0 }

  // Suspending (also when it was already suspended, so a partly failed revoke can be retried).
  const uids = await deps.data.listUserIdsByContractor(caller.tenantId, input.contractorId)
  const outcomes = await Promise.allSettled(uids.map((uid) => deps.auth.revokeRefreshTokens(uid)))
  const failures = outcomes.filter((o) => o.status === 'rejected').length
  if (failures > 0) throw fail('internal', 'internal', 'Contractor suspended, but some sessions could not be revoked. Retry.')
  return { ok: true, revoked: uids.length }
}
