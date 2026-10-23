// Firestore triggers that cancel a vehicle's approval. Separate from the penalty callables and Module 2's daily
// eligibility job on purpose: both just write their documents, these react. `retry: true` is safe because every
// cancellation is idempotent and ignores causes that happened before the vehicle was last inspected.
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore'
import { REGION } from './config.js'
import { dataPort, toPenalty } from './ports.js'
import { becameExpired, invalidateForDriverExpiry, invalidateForPenalty, invalidateForVehicleExpiry } from './inspectionInvalidation.js'

const TRIGGER_REGION = process.env.FIRESTORE_TRIGGER_REGION || REGION

// Keep one data port per instance: the Firestore client is created lazily on first use.
let port: ReturnType<typeof dataPort> | undefined
const ports = () => (port ??= dataPort())

/** A new penalty (Module 3) against a vehicle or its driver. */
export const invalidateInspectionOnPenalty = onDocumentCreated({ document: 'penalties/{penaltyId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const raw = event.data?.data()
  if (!raw) return
  await invalidateForPenalty(ports(), event.params.penaltyId, toPenalty(raw), Date.now())
})

/** `eligibilityStatus` written by Module 2: the daily job, or a callable that saved an already-expired date. */
export const invalidateInspectionOnVehicleExpiry = onDocumentUpdated({ document: 'vehicles/{vehicleId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const before = event.data?.before.data() as { eligibilityStatus?: string } | undefined
  const after = event.data?.after.data() as { tenantId?: string; eligibilityStatus?: string } | undefined
  if (!after?.tenantId || !becameExpired(before?.eligibilityStatus, after.eligibilityStatus)) return
  await invalidateForVehicleExpiry(ports(), after.tenantId, event.params.vehicleId, Date.parse(event.time), Date.now())
})

export const invalidateInspectionOnDriverExpiry = onDocumentUpdated({ document: 'drivers/{driverId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const before = event.data?.before.data() as { eligibilityStatus?: string } | undefined
  const after = event.data?.after.data() as { tenantId?: string; eligibilityStatus?: string } | undefined
  if (!after?.tenantId || !becameExpired(before?.eligibilityStatus, after.eligibilityStatus)) return
  await invalidateForDriverExpiry(ports(), after.tenantId, event.params.driverId, Date.parse(event.time), Date.now())
})

