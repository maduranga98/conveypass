import { initializeApp } from 'firebase-admin/app'
import { setGlobalOptions } from 'firebase-functions/v2'
import { onCall, onRequest } from 'firebase-functions/v2/https'
import { ENFORCE_APP_CHECK, REGION } from './config.js'
import * as approvals from './approvals.js'
import * as clientErrors from './clientErrors.js'
import * as core from './core.js'
import { handleCspReport } from './cspReport.js'
import * as devices from './devices.js'
import * as gate from './gate.js'
import * as passes from './passes.js'
import * as reportsApi from './reportsApi.js'
import { devicePort } from './notifyPorts.js'
import { operatorCallable, callable, publicCallable, runOperatorCall } from './runtime.js'
import { APP_BASE_URL, IN_EMULATOR } from './config.js'
import { createPlatformApi } from './platform/platform.js'
import { platformPort } from './platform/platformPort.js'
import { createWorkspaceApi } from './platform/workspaces.js'
import { workspaceAuthPort, workspacePort } from './platform/workspacesPort.js'
import { generateTempPassword } from './auth/tempPassword.js'
import { supportedTimezones } from './setup.js'
import { enforceRateLimit, firestoreRateLimitPort } from './rateLimit.js'
import { newTenantId } from './tenants/tenantDefaults.js'
import * as setup from './setup.js'
import { newClaimId, setupPort } from './setupPort.js'
import { authPort } from './ports.js'
import * as vehicles from './vehicles.js'

initializeApp()
// `enforceAppCheck` applies to callables only (ENFORCE_APP_CHECK=true in functions/.env.<alias>, never in the emulator).
setGlobalOptions({ region: REGION, maxInstances: 10, enforceAppCheck: ENFORCE_APP_CHECK })

// Sensitive callables are rate limited per user (`rateLimit: true`); latency-sensitive ones stay warm (`warm: true`).
export const createUser = callable('createUser', core.createUser, { rateLimit: true })
export const updateUser = callable('updateUser', core.updateUser)
export const resetCredential = callable('resetCredential', core.resetCredential, { rateLimit: true })
// One callable for everyone's own password. A super admin (platform claims, no tenant) goes to the platform API (verified
// email, active operators profile, sign-in within 5 minutes, audit in platformAuditLog); everyone else takes the unchanged
// workspace path.
const changeTenantOwnPassword = callable('changeOwnPassword', core.changeOwnPassword)
export const changeOwnPassword = onCall((request) => {
  const token = request.auth?.token as Record<string, unknown> | undefined
  if (request.auth && token && (token.role === 'platform' || token.platformAdmin === true)) {
    return runOperatorCall('changeOwnPassword', { uid: request.auth.uid, token }, request.data, (a, d) => platformApi().changeOwnPassword(a, d))
  }
  return changeTenantOwnPassword.run(request)
})

export const createVehicle = callable('createVehicle', vehicles.createVehicle)
export const updateVehicle = callable('updateVehicle', vehicles.updateVehicle)
export const setVehicleStatus = callable('setVehicleStatus', vehicles.setVehicleStatus)
export const setVehicleDrivers = callable('setVehicleDrivers', vehicles.setVehicleDrivers)
// 200 rows, one transaction each.
export const importVehicles = callable('importVehicles', vehicles.importVehicles, { timeoutSeconds: 180, rateLimit: true })
export const setContractorStatus = callable('setContractorStatus', vehicles.setContractorStatus, { timeoutSeconds: 120 })

export const resolveVehicle = callable('resolveVehicle', passes.resolveVehicle, { warm: true })
export const submitPass = callable('submitPass', passes.submitPass, { warm: true })
export const updateTenantSettings = callable('updateTenantSettings', passes.updateTenantSettings)

export const decidePass = callable('decidePass', approvals.decidePass)
// 50 items, one transaction each.
export const bulkApprove = callable('bulkApprove', approvals.bulkApprove, { timeoutSeconds: 120, rateLimit: true })
export const revokePass = callable('revokePass', approvals.revokePass)

// Module 5: the gate. Security reads directly from Firestore; these are its only writes.
export const checkIn = callable('checkIn', gate.checkIn, { warm: true })
export const denyEntry = callable('denyEntry', gate.denyEntry)

// Module 6: dashboard trend and reports (admin and officer, read only).
export const getDashboardTrend = callable('getDashboardTrend', reportsApi.getDashboardTrend, { timeoutSeconds: 60 })
export const runReport = callable('runReport', (d, c, data) => reportsApi.runReport(d, c, data), { timeoutSeconds: 300, memory: '1GiB' })

// Module 7: notifications. Triggers (passes, gateEvents) and the SLA schedule live in notificationTriggers.ts.
export { onGateEventCreated, onPassWritten, purgeOldEvidenceDaily as purgeOldEvidence, slaReminders } from './notificationTriggers.js'
export const registerDevice = callable(
  'registerDevice',
  (d, caller, data, meta) => devices.registerDevice(d, devicePort(), caller, data, meta),
  { rateLimit: true },
)
export const unregisterDevice = callable('unregisterDevice', (d, caller, data) => devices.unregisterDevice(d, devicePort(), caller, data))

// Module 8: invite-only workspace setup. No sign-in: per-IP rate limits, uniform errors, codes never logged.
const setupDeps = (): setup.SetupDeps => ({
  auth: authPort(),
  port: setupPort(),
  now: () => Date.now(),
  newTenantId,
  newClaimId,
  timezones: setup.supportedTimezones,
})
export const validateSetupInvite = publicCallable('validateSetupInvite', (data) => setup.validateSetupInvite(setupDeps(), data))
export const completeSetup = publicCallable('completeSetup', (data) => setup.completeSetup(setupDeps(), data))

// Module 9: operator console. Operators have claims { role: 'platform', platformAdmin: true } and no tenant;
// every call goes through requireOperator (verified email, active operators/{uid}, fresh sign-in for mutations).
const platformApi = () =>
  createPlatformApi({
    port: platformPort(),
    now: () => Date.now(),
    rateLimit: (uid, fn) => enforceRateLimit(firestoreRateLimitPort(), uid, fn),
    appBaseUrl: APP_BASE_URL,
    inEmulator: IN_EMULATOR,
  })
export const getOperatorProfile = operatorCallable('getOperatorProfile', (a) => platformApi().getOperatorProfile(a))
export const getOperatorOverview = operatorCallable('getOperatorOverview', (a) => platformApi().getOperatorOverview(a))
export const createSetupInvite = operatorCallable('createSetupInvite', (a, d) => platformApi().createSetupInvite(a, d))
export const listSetupInvites = operatorCallable('listSetupInvites', (a, d) => platformApi().listSetupInvites(a, d))
export const revokeSetupInvite = operatorCallable('revokeSetupInvite', (a, d) => platformApi().revokeSetupInvite(a, d))
// Module 10: the super admin creates workspaces and manages their admins (temporary password returned once).
const workspaceApi = () =>
  createWorkspaceApi({
    port: platformPort(),
    now: () => Date.now(),
    rateLimit: (uid, fn) => enforceRateLimit(firestoreRateLimitPort(), uid, fn),
    appBaseUrl: APP_BASE_URL,
    inEmulator: IN_EMULATOR,
    auth: workspaceAuthPort(),
    workspaces: workspacePort(),
    newTenantId,
    newTempPassword: () => generateTempPassword(),
    timezones: supportedTimezones,
  })
export const createWorkspace = operatorCallable('createWorkspace', (a, d) => workspaceApi().createWorkspace(a, d))
export const addTenantAdmin = operatorCallable('addTenantAdmin', (a, d) => workspaceApi().addTenantAdmin(a, d))
export const resetTenantAdminCredential = operatorCallable('resetTenantAdminCredential', (a, d) => workspaceApi().resetTenantAdminCredential(a, d))
export const setTenantAdminStatus = operatorCallable('setTenantAdminStatus', (a, d) => workspaceApi().setTenantAdminStatus(a, d))
export const updateTenantAdmin = operatorCallable('updateTenantAdmin', (a, d) => workspaceApi().updateTenantAdmin(a, d))
export const getWorkspace = operatorCallable('getWorkspace', (a, d) => workspaceApi().getWorkspace(a, d))
export const listTenants = operatorCallable('listTenants', (a, d) => platformApi().listTenants(a, d))

// Browsers report crashes here: signed-in users only, rate limited per user, scrubbed and truncated, logs only.
export const reportClientError = callable('reportClientError', clientErrors.reportClientError, { rateLimit: true })

// Content-Security-Policy-Report-Only violations (hosting rewrites /csp-report here). Logs only: host, path, directive.
export const cspReport = onRequest({ cors: false, maxInstances: 2, memory: '128MiB' }, (req, res) => handleCspReport(req, res))
