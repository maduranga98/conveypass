import type { Timestamp } from 'firebase/firestore'
import type { EligibilityStatus } from '@/lib/expiry'
import type { CombinedStatus, PenaltyStatus, PenaltyTarget } from '@/lib/penaltyLogic'

/** `penaltyTypes/{id}`: the company's own list (no seeded types). Function-written. */
export interface PenaltyType {
  tenantId: string
  name: string
  nameKey: string
  createdBy: string
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type PenaltyDuration = { kind: 'permanent' } | { kind: 'fixed'; endDate: Timestamp }

export interface PenaltyVerification {
  verifiedBy: string | null
  verifiedByName: string | null
  verifiedAt: Timestamp | null
  verificationNote: string | null
}

/** `penalties/{id}`. Function-written; clients only read. A penalty takes effect when it is created. */
export interface Penalty {
  tenantId: string
  contractorId: string
  target: PenaltyTarget
  /** Names at issue time. */
  targetLabels: { driverName: string | null; plateNo: string | null }
  typeId: string
  typeName: string
  duration: PenaltyDuration
  issuedBy: { uid: string; name: string; role: 'admin' | 'safety' }
  issuedAt: Timestamp
  reason: string
  /** Storage path, never a URL. */
  evidencePhotoPath: string | null
  status: PenaltyStatus
  revocation?: { byUid: string; byName: string; at: Timestamp; note: string }
  expiredAt?: Timestamp
  verification: PenaltyVerification
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface IssuePenaltyPayload {
  /** `pen_` + 10 chars chosen by the browser (the photo is uploaded to this id first). */
  penaltyId: string
  driverId?: string
  vehicleId?: string
  typeId: string
  duration: { kind: 'permanent' } | { kind: 'fixed'; endDate: string }
  reason: string
  hasEvidence?: boolean
}

export interface BlockingPenaltyInfo {
  id: string
  typeName: string
  permanent: boolean
  endDate: number | null
}

export interface SubjectEligibility {
  id: string
  documentStatus: EligibilityStatus
  blocked: boolean
  penalties: BlockingPenaltyInfo[]
}

/** What `checkEligibility` returns: documents (Module 2) combined with active penalties. `blocked` overrides everything. */
export interface EligibilityResult {
  status: CombinedStatus
  blocked: boolean
  vehicle: SubjectEligibility | null
  driver: SubjectEligibility | null
  checkedAt: number
}
