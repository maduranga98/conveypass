import { httpsCallable } from 'firebase/functions'
import type { Role } from './roles'
import { functions } from './firebase'
import type { VehicleType } from './vehicleTypes'

export interface CreateUserPayload {
  role: Role
  name: string
  email?: string
  phone?: string
  contractorId?: string
  licenseNo?: string
  password: string
}

export interface UpdateUserPayload {
  uid: string
  name?: string
  phone?: string
  status?: 'active' | 'disabled'
  /** Drivers only. `null` clears it. */
  licenseNo?: string | null
  /** Drivers only: `tenants/{tenantId}/contractors/{contractorId}/drivers/{uid}.jpg`. */
  photoPath?: string
}

const call = <Req, Res>(name: string, timeout?: number) => {
  const fn = httpsCallable<Req, Res>(functions, name, timeout ? { timeout } : undefined)
  return async (payload: Req): Promise<Res> => (await fn(payload)).data
}

export const createUser = call<CreateUserPayload, { uid: string }>('createUser')
export const updateUser = call<UpdateUserPayload, { ok: true }>('updateUser')
export const resetCredential = call<{ uid: string; newPassword: string }, { ok: true }>('resetCredential')
export const changeOwnPassword = call<{ newPassword: string }, { ok: true }>('changeOwnPassword')

export interface VehicleInput {
  plateNo: string
  type: VehicleType
  makeModel?: string
}

export type ImportRowError = 'invalid-plate' | 'invalid-type' | 'invalid-make-model' | 'plate-exists' | 'internal'
export interface ImportRowResult {
  /** 1-based position in the rows that were sent. */
  row: number
  ok: boolean
  vehicleId?: string
  error?: ImportRowError
}

export const createVehicle = call<
  VehicleInput & { contractorId?: string; driverIds?: string[] },
  { vehicleId: string; plateNo: string }
>('createVehicle')
export const updateVehicle = call<Partial<VehicleInput> & { vehicleId: string }, { ok: true }>('updateVehicle')
export const setVehicleStatus = call<{ vehicleId: string; status: 'active' | 'suspended' }, { ok: true }>('setVehicleStatus')
export const setVehicleDrivers = call<{ vehicleId: string; driverIds: string[] }, { ok: true }>('setVehicleDrivers')
export const importVehicles = call<
  { contractorId?: string; rows: VehicleInput[] },
  { results: ImportRowResult[]; created: number }
>('importVehicles', 180_000)
export const setContractorStatus = call<
  { contractorId: string; status: 'active' | 'suspended' },
  { ok: true; revoked: number }
>('setContractorStatus', 120_000)
