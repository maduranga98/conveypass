import type { SlaSettings } from './defaultSla.js'
import type { GateDef } from './gates.js'

export const ROLES = ['admin', 'officer', 'supervisor', 'driver', 'security'] as const
export type Role = (typeof ROLES)[number]

export type { GateDef }

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
  targetType: 'user' | 'vehicle' | 'contractor' | 'tenant' | 'pass' | 'gateEvent' | 'notification'
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

export interface RejectionReasonDef {
  id: string
  label: string
}

/** `tenants/{tenantId}`: only the fields functions read or write. Every field is optional on older tenants. */
export interface TenantData {
  timezone?: string
  passSettings?: Partial<PassSettings>
  checklist?: ChecklistItemDef[]
  /** Falls back to DEFAULT_REJECTION_REASONS when absent or empty. */
  rejectionReasons?: RejectionReasonDef[]
  /** Falls back to DEFAULT_GATES when absent or empty. */
  gates?: GateDef[]
  /** Falls back to DEFAULT_SLA. */
  sla?: Partial<SlaSettings>
  /** Evidence retention in days. 0 or absent = keep forever; otherwise 30-3650. */
  retentionDays?: number
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

export type DecisionStage = 'supervisor' | 'officer' | 'revoked'

/** Written by `decidePass` / `revokePass` when a pass is rejected. */
export interface Rejection {
  /** Human readable: the reason label plus the note (the Module 3 resubmit screen shows exactly this). */
  reason: string
  reasonCode: string
  note?: string
  stage: DecisionStage
  byUid: string
  byName: string
  byRole: Role
  /** Milliseconds since epoch (converted from a Timestamp by the data port). */
  at: number
}

/** Who approved at a step. */
export interface ApprovalStamp {
  uid: string
  name: string
  /** Milliseconds since epoch. */
  at: number
}

/** Appended on every decision (and the gate check-in) and never removed, not even on resubmit. */
export interface HistoryEntry {
  action: 'approve' | 'reject' | 'revoke' | 'check_in'
  stage: DecisionStage | 'gate'
  byUid: string
  byName: string
  byRole: Role
  /** Milliseconds since epoch. */
  at: number
  attempt: number
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
  supervisor?: ApprovalStamp
  officer?: ApprovalStamp
  rejection?: Rejection
  rejectionHistory?: RejectionHistoryEntry[]
  history?: HistoryEntry[]
  /** Set once by `checkIn`. There is no check-out. */
  checkIn?: CheckInStamp
  /** Written by the SLA reminder job: which attempt was already reminded for each step (one reminder per step and attempt). */
  slaAlerts?: SlaAlerts
  /** Set by `purgeOldEvidence` (milliseconds here): the photos are gone, the pass and its history stay. */
  evidenceDeletedAt?: number
}

export type SlaStage = 'supervisor' | 'officer'
export type SlaAlerts = Partial<Record<SlaStage, { attempt: number; at: number }>>

/** Who let the vehicle in, where and when. `at` is the server time (milliseconds here; the data port converts). */
export interface CheckInStamp {
  uid: string
  name: string
  at: number
  gateId: string
  gateName: string
  /** Client UUID that makes the call idempotent (retries and the offline queue rely on it). */
  requestId: string
  /** Device time of an offline check-in, ISO string. Bounded on the server but never trusted: shown as unverified. */
  offlineCapturedAt?: string
}

/** `gateEvents/den_{requestId}`: a vehicle turned away at the gate. Never changes the pass. */
export interface GateEventData {
  tenantId: string
  type: 'denied'
  vehicleId: string
  plateNo: string
  contractorId: string
  /** Today's pass for the vehicle, when there is one. */
  passId: string | null
  /** Its status at the moment of the denial, read by the server. */
  passStatus: PassStatus | null
  /** The driver named on that pass, for the gate log. */
  driverName: string | null
  dateKey: string
  reasonCode: string
  note?: string
  gateId: string
  gateName: string
  byUid: string
  byName: string
  /** Milliseconds since epoch (server time). */
  at: number
  requestId: string
}

/** What `submitPass` hands the data port; the port adds status, timestamps and history. */
export type PassWrite = Omit<
  PassData,
  'status' | 'submittedAt' | 'supervisor' | 'officer' | 'rejection' | 'rejectionHistory' | 'history' | 'checkIn'
>

/** Object metadata read from Storage with the Admin SDK. */
export interface StoredFile {
  contentType: string
  size: number
  /** Milliseconds since epoch. */
  timeCreated: number
  /** First bytes of the object. */
  head: Uint8Array
}
