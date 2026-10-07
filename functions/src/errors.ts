import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https'

export type Reason =
  | 'unauthenticated'
  | 'caller-not-active'
  | 'forbidden'
  | 'invalid-input'
  | 'tenant-mismatch'
  | 'user-not-found'
  | 'contractor-invalid'
  | 'email-exists'
  | 'phone-exists'
  | 'self-status'
  | 'self-reset'
  | 'recent-login-required'
  | 'plate-exists'
  | 'vehicle-not-found'
  | 'driver-invalid'
  | 'contractor-not-found'
  | 'photo-path-invalid'
  | 'not-assigned'
  | 'vehicle-suspended'
  | 'contractor-suspended'
  | 'pass-exists'
  | 'attempt-mismatch'
  | 'attempts-exhausted'
  | 'not-resubmitter'
  | 'checklist-invalid'
  | 'checklist-note-required'
  | 'checklist-blocked'
  | 'evidence-missing'
  | 'evidence-invalid'
  | 'evidence-stale'
  | 'location-required'
  | 'pass-not-found'
  | 'pass-changed'
  | 'pass-expired'
  | 'wrong-stage'
  | 'driver-inactive'
  | 'already-checked-in'
  | 'has_issues'
  | 'reason-invalid'
  | 'note-required'
  | 'gate-invalid'
  | 'pass-not-approved'
  | 'pass-checked-in'
  | 'offline-time-future'
  | 'offline-time-stale'
  | 'offline-day-mismatch'
  | 'request-conflict'
  | 'range-invalid'
  | 'range-too-long'
  | 'range-too-large'
  | 'id-required'
  | 'filter-invalid'
  | 'internal'

/** Typed error: `code` is the gRPC-style code, `details.reason` is a stable key the client maps to a string. */
export const fail = (code: FunctionsErrorCode, reason: Reason, message: string): HttpsError =>
  new HttpsError(code, message, { reason })

/** Same as `fail`, with extra details for the client (never secrets or photo URLs). */
export const failWith = (
  code: FunctionsErrorCode,
  reason: Reason,
  message: string,
  extra: Record<string, string | number | null>,
): HttpsError => new HttpsError(code, message, { ...extra, reason })
