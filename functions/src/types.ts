export const ROLES = ['admin', 'officer', 'supervisor', 'driver', 'security'] as const
export type Role = (typeof ROLES)[number]

export type UserStatus = 'active' | 'disabled'

export interface Caller {
  uid: string
  role: Role
  tenantId: string
  contractorId: string | null
  /** Seconds since epoch of the caller's last sign-in (token `auth_time`). */
  authTime: number
}

export interface UserData {
  tenantId: string
  role: Role
  contractorId: string | null
  name: string
  email: string | null
  phone: string | null
  status: UserStatus
  mustChangePassword: boolean
}

export type ContractorStatus = 'active' | 'suspended'
export type VehicleStatus = 'active' | 'suspended'

export interface ContractorData {
  tenantId: string
  status: ContractorStatus
}

export interface VehicleData {
  tenantId: string
  contractorId: string
  plateNo: string
  plateKey: string
  type: string
  makeModel?: string
  assignedDriverIds: string[]
  status: VehicleStatus
}

/** `null` removes the field. */
export type VehiclePatch = Partial<Omit<VehicleData, 'tenantId' | 'contractorId' | 'plateKey' | 'makeModel'>> & {
  makeModel?: string | null
}

/** `drivers/{uid}`: same id as the `users` doc. name, phone and status mirror `users`. */
export interface DriverData {
  tenantId: string
  contractorId: string
  name: string
  phone: string
  licenseNo?: string | null
  photoPath?: string | null
  status: UserStatus
}

export interface AuditEntry {
  tenantId: string
  action: string
  actorUid: string
  actorRole: Role
  targetType: 'user' | 'vehicle' | 'contractor'
  targetId: string
  meta: Record<string, string | number | boolean | null>
}

export interface Claims {
  role: Role
  tenantId: string
  contractorId?: string
}
