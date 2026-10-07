import { initializeApp } from 'firebase-admin/app'
import { setGlobalOptions } from 'firebase-functions/v2'
import { ENFORCE_APP_CHECK, REGION } from './config.js'
import * as approvals from './approvals.js'
import * as clientErrors from './clientErrors.js'
import * as core from './core.js'
import * as devices from './devices.js'
import * as gate from './gate.js'
import * as passes from './passes.js'
import * as reportsApi from './reportsApi.js'
import { devicePort } from './notifyPorts.js'
import { callable } from './runtime.js'
import * as vehicles from './vehicles.js'

initializeApp()
// `enforceAppCheck` applies to callables only (ENFORCE_APP_CHECK=true in functions/.env.<alias>, never in the emulator).
setGlobalOptions({ region: REGION, maxInstances: 10, enforceAppCheck: ENFORCE_APP_CHECK })

// Sensitive callables are rate limited per user (`rateLimit: true`); latency-sensitive ones stay warm (`warm: true`).
export const createUser = callable('createUser', core.createUser, { rateLimit: true })
export const updateUser = callable('updateUser', core.updateUser)
export const resetCredential = callable('resetCredential', core.resetCredential, { rateLimit: true })
export const changeOwnPassword = callable('changeOwnPassword', core.changeOwnPassword)

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

// Browsers report crashes here: signed-in users only, rate limited per user, scrubbed and truncated, logs only.
export const reportClientError = callable('reportClientError', clientErrors.reportClientError, { rateLimit: true })
