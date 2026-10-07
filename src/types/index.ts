import type { Timestamp } from 'firebase/firestore'
import type { Role } from '@/lib/roles'

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
  status: ContractorStatus
  createdAt: Timestamp
  createdBy: string
  updatedAt: Timestamp
}

export type WithId<T> = T & { id: string }

/** Custom claims, read from the ID token. Only Cloud Functions ever set these. */
export interface Claims {
  role: Role
  tenantId: string
  contractorId: string | null
}
