import type { Timestamp } from 'firebase/firestore'
import type { ChecklistItemDef, PassSettings } from '@/lib/defaultChecklist'

export type PassStatus = 'submitted' | 'supervisor_approved' | 'officer_approved' | 'checked_in' | 'rejected'

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

export interface PassEvidence {
  gps: EvidenceFile
  dashcam: EvidenceFile
  extra: EvidenceFile[]
}

export interface CaptureMeta {
  method: 'live' | 'file'
  clientCapturedAt: { gps: string; dashcam: string }
  location?: { lat: number; lng: number; accuracy: number }
}

/** `passes/{vehicleId}_{dateKey}`. Read-only for clients; every write goes through Cloud Functions. */
export interface PassDoc {
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
  submittedAt: Timestamp | null
  updatedAt: Timestamp | null
  checklist: PassChecklistItem[]
  evidence: PassEvidence
  captureMeta: CaptureMeta
  /** Written by Module 4. */
  rejection?: { reason: string; byUid: string; byRole: string; at: Timestamp }
  rejectionHistory?: { reason: string; attempt: number; at: Timestamp }[]
}

export interface SubmitPassPayload {
  vehicleId: string
  attempt: number
  checklist: { id: string; answer: 'yes' | 'no'; note?: string }[]
  extraCount: number
  captureMeta: CaptureMeta
}

// ---- resolveVehicle result (mirrors functions/src/passes.ts) --------------------------------

export interface PassSummary {
  passId: string
  plateNo: string
  status: PassStatus
  /** Milliseconds since epoch. */
  submittedAt: number | null
  driverName: string
  /** True when the caller submitted it, so the pass document itself is readable. */
  mine: boolean
}

export interface FormContext {
  vehicle: { id: string; plateNo: string; type: string }
  attempt: number
  checklist: ChecklistItemDef[]
  passSettings: PassSettings
  dateKey: string
}

export type ResolveResult =
  | ({ state: 'can_submit' } & FormContext)
  | ({
      state: 'can_resubmit'
      rejection: { reason: string; at: number }
      previous: { attempt: number; checklist: PassChecklistItem[] }
    } & FormContext)
  | { state: 'pending' | 'approved' | 'checked_in'; pass: PassSummary }
  | { state: 'rejected_locked'; reason: 'other_driver' | 'max_attempts'; pass: PassSummary }
  | { state: 'not_assigned' | 'vehicle_suspended' | 'contractor_suspended' | 'not_found' }
