// Module 9: shapes returned by the operator callables. Times are epoch milliseconds. No tenant business data, no codes.
export type InviteStatus = 'unused' | 'claimed' | 'used' | 'expired'

export interface CreatedInvite {
  /** Shown once. Never stored, cached or logged by the client. */
  code: string
  link: string
  hashPrefix: string
  expiresAt: number
}

export interface InviteRow {
  hashPrefix: string
  companyHint: string | null
  lockEmail: string | null
  status: InviteStatus
  createdAt: number
  expiresAt: number
  usedAt: number | null
  tenantId: string | null
  tenantName: string | null
}

export interface TenantRow {
  tenantId: string
  name: string
  createdAt: number
  timezone: string
  adminName: string | null
  adminEmail: string | null
  userCount: number
  vehicleCount: number
}

export interface OperatorOverview {
  invites: Record<InviteStatus, number>
  tenants: number
}
