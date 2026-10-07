import type { Timestamp } from 'firebase/firestore'
import type { Role } from '@/lib/roles'
import type { VehicleType } from '@/lib/vehicleTypes'

export type UserStatus = 'active' | 'disabled'
export type ContractorStatus = 'active' | 'suspended'

export interface Tenant {
  name: string
  status: 'active' | 'suspended'
  createdAt: Timestamp
}

export interface UserDoc {
  tenantId: string
  role: Role
  contractorId: string | null
  name: string
  email: string | null
  phone: string | null
  status: UserStatus
  mustChangePassword: boolean
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

export interface Contractor {
  tenantId: string
  name: string
  contactName?: string | null
  phone?: string | null
  address?: string | null
  notes?: string | null
  /** Function-only (setContractorStatus). */
  status: ContractorStatus
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

export type VehicleStatus = 'active' | 'suspended'

/** `vehicles/{vehicleId}`: the document id is the permanent QR id (`veh_` + 10 chars). */
export interface Vehicle {
  tenantId: string
  contractorId: string
  plateNo: string
  plateKey: string
  type: VehicleType
  makeModel?: string
  assignedDriverIds: string[]
  status: VehicleStatus
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

/** `drivers/{uid}`: same id as the Auth uid and the `users` doc. */
export interface Driver {
  tenantId: string
  contractorId: string
  name: string
  phone: string
  licenseNo?: string | null
  photoPath?: string | null
  status: UserStatus
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type WithId<T> = T & { id: string }

/** Custom claims, read from the ID token. Only Cloud Functions ever set these. */
export interface Claims {
  role: Role
  tenantId: string
  contractorId: string | null
}
