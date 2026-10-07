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
  | 'internal'

/** Typed error: `code` is the gRPC-style code, `details.reason` is a stable key the client maps to a string. */
export const fail = (code: FunctionsErrorCode, reason: Reason, message: string): HttpsError =>
  new HttpsError(code, message, { reason })
