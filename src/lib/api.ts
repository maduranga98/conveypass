import { httpsCallable } from 'firebase/functions'
import type { Role } from './roles'
import { functions } from './firebase'
import type { ChecklistItemDef, PassSettings } from './defaultChecklist'
import type { VehicleType } from './vehicleTypes'
import type { RejectionReasonDef } from './defaultRejectionReasons'
import type { GateDef } from './gates'
import type { ReportRequest, ReportResult, TrendResult } from '@/types/reports'
import type { SlaSettings } from './defaultSla'
import type { CreatedInvite, InviteRow, InviteStatus, OperatorOverview, TenantRow } from '@/types/platform'
import type {
  BulkItemResult,
  CheckInPayload,
  CheckInResult,
  DecidePassPayload,
  DenyEntryPayload,
  PassStatus,
  ResolveResult,
  SubmitPassPayload,
} from '@/types/passes'

export interface CreateUserPayload {
  role: Role
  name: string
  email?: string
  phone?: string
  contractorId?: string
  licenseNo?: string
  password: string
}

export interface UpdateUserPayload {
  uid: string
  name?: string
  phone?: string
  status?: 'active' | 'disabled'
  /** Drivers only. `null` clears it. */
  licenseNo?: string | null
  /** Drivers only: `tenants/{tenantId}/contractors/{contractorId}/drivers/{uid}.jpg`. */
  photoPath?: string
}

const call = <Req, Res>(name: string, timeout?: number) => {
  const fn = httpsCallable<Req, Res>(functions, name, timeout ? { timeout } : undefined)
  return async (payload: Req): Promise<Res> => (await fn(payload)).data
}

export const createUser = call<CreateUserPayload, { uid: string }>('createUser')
export const updateUser = call<UpdateUserPayload, { ok: true }>('updateUser')
export const resetCredential = call<{ uid: string; newPassword: string }, { ok: true }>('resetCredential')
export const changeOwnPassword = call<{ newPassword: string }, { ok: true }>('changeOwnPassword')

export interface VehicleInput {
  plateNo: string
  type: VehicleType
  makeModel?: string
}

export type ImportRowError = 'invalid-plate' | 'invalid-type' | 'invalid-make-model' | 'plate-exists' | 'internal'
export interface ImportRowResult {
  /** 1-based position in the rows that were sent. */
  row: number
  ok: boolean
  vehicleId?: string
  error?: ImportRowError
}

export const createVehicle = call<
  VehicleInput & { contractorId?: string; driverIds?: string[] },
  { vehicleId: string; plateNo: string }
>('createVehicle')
export const updateVehicle = call<Partial<VehicleInput> & { vehicleId: string }, { ok: true }>('updateVehicle')
export const setVehicleStatus = call<{ vehicleId: string; status: 'active' | 'suspended' }, { ok: true }>('setVehicleStatus')
export const setVehicleDrivers = call<{ vehicleId: string; driverIds: string[] }, { ok: true }>('setVehicleDrivers')
export const importVehicles = call<
  { contractorId?: string; rows: VehicleInput[] },
  { results: ImportRowResult[]; created: number }
>('importVehicles', 180_000)
export const setContractorStatus = call<
  { contractorId: string; status: 'active' | 'suspended' },
  { ok: true; revoked: number }
>('setContractorStatus', 120_000)

export const resolveVehicle = call<{ vehicleId: string }, ResolveResult>('resolveVehicle', 30_000)
export const submitPass = call<SubmitPassPayload, { passId: string; status: 'submitted'; attempt: number }>(
  'submitPass',
  60_000,
)
export const updateTenantSettings = call<
  { passSettings?: PassSettings; checklist?: ChecklistItemDef[]; rejectionReasons?: RejectionReasonDef[]; gates?: GateDef[]; sla?: SlaSettings; retentionDays?: number },
  { ok: true }
>('updateTenantSettings')

// Module 4: approvals. The client says what it was looking at (expectedStatus/Attempt); the server decides.
export const decidePass = call<DecidePassPayload, { passId: string; status: PassStatus; attempt: number }>(
  'decidePass',
  30_000,
)
export const bulkApprove = call<{ items: { passId: string; expectedAttempt: number }[] }, { results: BulkItemResult[] }>(
  'bulkApprove',
  120_000,
)
export const revokePass = call<
  { passId: string; reasonCode: string; note?: string; expectedAttempt?: number },
  { passId: string; status: 'rejected' }
>('revokePass', 30_000)

// Module 5: the gate. Reads go straight to Firestore; these are the only writes. Both are idempotent per requestId.
export const checkIn = call<CheckInPayload, CheckInResult>('checkIn', 20_000)
export const denyEntry = call<DenyEntryPayload, { eventId: string; at: number; passStatus: PassStatus | null }>('denyEntry', 20_000)

// Module 6: dashboard trend and reports (admin and officer; read only). Reports can scan a lot of passes, so wait longer.
export const getDashboardTrend = call<{ days: 7 | 14 | 30 }, TrendResult>('getDashboardTrend', 60_000)
export const runReport = call<ReportRequest, ReportResult>('runReport', 300_000)

// Module 7: push devices (caller only). The browser's FCM token goes to the server, never into the page's storage.
export const registerDevice = call<{ deviceId: string; token: string; platform: 'android' | 'ios' | 'desktop' | 'other' }, { ok: true }>(
  'registerDevice',
  20_000,
)
export const unregisterDevice = call<{ deviceId: string }, { ok: true }>('unregisterDevice', 20_000)

// Crash reports (signed-in users only; the server scrubs, truncates and rate limits).
export const reportClientError = call<
  { message: string; stack?: string; route?: string; source: 'boundary' | 'window' | 'promise' | 'gate' | 'form'; appVersion?: string },
  { ok: true }
>('reportClientError', 10_000)

// Module 8: invite-only workspace setup. Both are callable without signing in (the server rate limits per IP).
export const validateSetupInvite = call<{ code: string }, { valid: boolean; companyHint?: string; emailLock?: string }>('validateSetupInvite', 20_000)
export const completeSetup = call<
  { code: string; companyName: string; adminName: string; email: string; password: string; timezone: string },
  { tenantId: string }
>('completeSetup', 60_000)

// Module 9: platform operator console. Operators only (claims { role: 'platform', platformAdmin: true }, no tenant).
// `createSetupInvite` returns the invite code ONCE: the page holds it in component state only (never a query cache).
export const getOperatorProfile = call<Record<string, never>, { name: string; email: string }>('getOperatorProfile', 20_000)
export const getOperatorOverview = call<Record<string, never>, OperatorOverview>('getOperatorOverview', 20_000)
export const createSetupInvite = call<{ companyHint?: string; lockEmail?: string; expiresInDays: number }, CreatedInvite>('createSetupInvite', 30_000)
export const listSetupInvites = call<{ status?: InviteStatus; cursor?: string }, { invites: InviteRow[]; nextCursor: string | null }>('listSetupInvites', 30_000)
export const revokeSetupInvite = call<{ hashPrefix: string }, { ok: true }>('revokeSetupInvite', 30_000)
export const listTenants = call<{ cursor?: string }, { tenants: TenantRow[]; nextCursor: string | null }>('listTenants', 30_000)
