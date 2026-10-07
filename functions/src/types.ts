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
  targetType: 'user' | 'vehicle' | 'contractor' | 'tenant' | 'pass'
  targetId: string
  meta: Record<string, string | number | boolean | null>
}

export interface Claims {
  role: Role
  tenantId: string
  contractorId?: string
}

// ---- Module 3: passes ------------------------------------------------------------------------

export type PassStatus = 'submitted' | 'supervisor_approved' | 'officer_approved' | 'checked_in' | 'rejected'

export interface ChecklistItemDef {
  id: string
  label: string
  failBlocks: boolean
}

export interface PassSettings {
  requireLocation: boolean
  maxExtraPhotos: number
}

/** `tenants/{tenantId}`: only the fields functions read or write. Every field is optional on older tenants. */
export interface TenantData {
  timezone?: string
  passSettings?: Partial<PassSettings>
  checklist?: ChecklistItemDef[]
}

export interface EvidenceFile {
  path: string
  size: number
  contentType: string
}

export interface PassChecklistItem {
  id: string
  label: string
  answer: 'yes' | 'no'
  note?: string
}

export interface Evidence {
  gps: EvidenceFile
  dashcam: EvidenceFile
  extra: EvidenceFile[]
}

export interface CaptureMeta {
  method: 'live' | 'file'
  clientCapturedAt: { gps: string; dashcam: string }
  location?: { lat: number; lng: number; accuracy: number }
}

/** Written by Module 4 when a pass is rejected. */
export interface Rejection {
  reason: string
  byUid: string
  byRole: Role
  /** Milliseconds since epoch (converted from a Timestamp by the data port). */
  at: number
}

/** Kept when a rejected pass is resubmitted, with what that attempt looked like. */
export interface RejectionHistoryEntry extends Rejection {
  attempt: number
  checklist: PassChecklistItem[]
  evidence: Evidence
}

/** `passes/{vehicleId}_{dateKey}`. Timestamps are milliseconds here; the data port converts. */
export interface PassData {
  tenantId: string
  contractorId: string
  vehicleId: string
  plateNo: string
  vehicleType: string
  dateKey: string
  driverId: string
  driverName: string
  status: PassStatus
  attempt: number
  submittedAt: number | null
  checklist: PassChecklistItem[]
  evidence: Evidence
  captureMeta: CaptureMeta
  rejection?: Rejection
  rejectionHistory?: RejectionHistoryEntry[]
}

/** What `submitPass` hands the data port; the port adds status, timestamps and history. */
export type PassWrite = Omit<PassData, 'status' | 'submittedAt' | 'rejection' | 'rejectionHistory'>

/** Object metadata read from Storage with the Admin SDK. */
export interface StoredFile {
  contentType: string
  size: number
  /** Milliseconds since epoch. */
  timeCreated: number
  /** First bytes of the object. */
  head: Uint8Array
}
