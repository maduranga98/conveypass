import { initializeApp } from 'firebase-admin/app'
import { onCall, type CallableRequest } from 'firebase-functions/v2/https'
import { setGlobalOptions } from 'firebase-functions/v2'
import { REGION } from './config.js'
import * as approvals from './approvals.js'
import * as core from './core.js'
import { fail } from './errors.js'
import { newVehicleId } from './ids.js'
import * as passes from './passes.js'
import { authPort, dataPort, storagePort } from './ports.js'
import { ROLES, type Caller, type Role } from './types.js'
import * as vehicles from './vehicles.js'

initializeApp()
setGlobalOptions({ region: REGION, maxInstances: 10 })

/** The caller identity comes from verified token claims only, never from the request payload. */
function callerFrom(request: CallableRequest<unknown>): Caller {
  const token = request.auth?.token
  if (!request.auth || !token) throw fail('unauthenticated', 'unauthenticated', 'Sign in required')
  const role = token.role as unknown
  const tenantId = token.tenantId as unknown
  const contractorId = token.contractorId as unknown
  if (
    typeof role !== 'string' ||
    !(ROLES as readonly string[]).includes(role) ||
    typeof tenantId !== 'string' ||
    !tenantId
  ) {
    throw fail('permission-denied', 'forbidden', 'Account is not set up')
  }
  return {
    uid: request.auth.uid,
    role: role as Role,
    tenantId,
    contractorId: typeof contractorId === 'string' && contractorId ? contractorId : null,
    authTime: typeof token.auth_time === 'number' ? token.auth_time : 0,
  }
}

const deps = (): core.Deps => ({
  auth: authPort(),
  data: dataPort(),
  storage: storagePort(),
  newVehicleId,
  now: () => Math.floor(Date.now() / 1000),
})

export const createUser = onCall((request) => core.createUser(deps(), callerFrom(request), request.data))
export const updateUser = onCall((request) => core.updateUser(deps(), callerFrom(request), request.data))
export const resetCredential = onCall((request) =>
  core.resetCredential(deps(), callerFrom(request), request.data),
)
export const changeOwnPassword = onCall((request) =>
  core.changeOwnPassword(deps(), callerFrom(request), request.data),
)

export const createVehicle = onCall((request) => vehicles.createVehicle(deps(), callerFrom(request), request.data))
export const updateVehicle = onCall((request) => vehicles.updateVehicle(deps(), callerFrom(request), request.data))
export const setVehicleStatus = onCall((request) =>
  vehicles.setVehicleStatus(deps(), callerFrom(request), request.data),
)
export const setVehicleDrivers = onCall((request) =>
  vehicles.setVehicleDrivers(deps(), callerFrom(request), request.data),
)
// 200 rows, one transaction each.
export const importVehicles = onCall({ timeoutSeconds: 180 }, (request) =>
  vehicles.importVehicles(deps(), callerFrom(request), request.data),
)
export const setContractorStatus = onCall({ timeoutSeconds: 120 }, (request) =>
  vehicles.setContractorStatus(deps(), callerFrom(request), request.data),
)

export const resolveVehicle = onCall((request) => passes.resolveVehicle(deps(), callerFrom(request), request.data))
export const submitPass = onCall((request) => passes.submitPass(deps(), callerFrom(request), request.data))
export const updateTenantSettings = onCall((request) =>
  passes.updateTenantSettings(deps(), callerFrom(request), request.data),
)

export const decidePass = onCall((request) => approvals.decidePass(deps(), callerFrom(request), request.data))
// 50 items, one transaction each.
export const bulkApprove = onCall({ timeoutSeconds: 120 }, (request) =>
  approvals.bulkApprove(deps(), callerFrom(request), request.data),
)
export const revokePass = onCall((request) => approvals.revokePass(deps(), callerFrom(request), request.data))
