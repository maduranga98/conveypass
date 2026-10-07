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

export interface ContractorData {
  tenantId: string
  status: 'active' | 'suspended'
}

export interface AuditEntry {
  tenantId: string
  action: string
  actorUid: string
  actorRole: Role
  targetType: 'user'
  targetId: string
  meta: Record<string, string | number | boolean | null>
}

export interface Claims {
  role: Role
  tenantId: string
  contractorId?: string
}
