import { onCall, HttpsError, type CallableOptions, type CallableRequest } from 'firebase-functions/v2/https'
import { fail } from './errors.js'
import { newVehicleId } from './ids.js'
import { logError, logInfo, logWarn } from './logger.js'
import { firestoreRateLimitPort, enforceRateLimit, enforceIpRateLimit, type IP_RATE_LIMITS } from './rateLimit.js'
import { authPort, dataPort, storagePort } from './ports.js'
import { MIN_INSTANCES } from './config.js'
import type { Deps } from './core.js'
import { ROLES, type Caller, type Role } from './types.js'

/** The caller identity comes from verified token claims only, never from the request payload. */
export function callerFrom(request: CallableRequest<unknown>): Caller {
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

export const deps = (): Deps => ({
  auth: authPort(),
  data: dataPort(),
  storage: storagePort(),
  newVehicleId,
  now: () => Math.floor(Date.now() / 1000),
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Gate calls carry a client UUID; log it (nothing else from the payload) so one call can be followed end to end. */
const requestIdOf = (data: unknown): string | undefined => {
  const id = typeof data === 'object' && data !== null ? (data as { requestId?: unknown }).requestId : undefined
  return typeof id === 'string' && UUID.test(id) ? id : undefined
}

export interface CallableConfig {
  /** Per-uid fixed-window limit (`rateLimits/{uid}_{fn}`), default 30 calls a minute. */
  rateLimit?: boolean
  /** Keep instances warm (latency-sensitive gate callables). Value comes from MIN_INSTANCES. */
  warm?: boolean
  timeoutSeconds?: number
  memory?: CallableOptions['memory']
}

/**
 * Every callable goes through here: caller from claims, optional rate limit, one structured log line per call
 * (fn, uid, tenantId, requestId, outcome, reason). The handlers themselves are unchanged.
 */
export function callable<T>(
  name: string,
  run: (deps: Deps, caller: Caller, data: unknown, meta: { userAgent: string | undefined }) => Promise<T>,
  config: CallableConfig = {},
) {
  const options: CallableOptions = {
    ...(config.timeoutSeconds ? { timeoutSeconds: config.timeoutSeconds } : {}),
    ...(config.memory ? { memory: config.memory } : {}),
    ...(config.warm ? { minInstances: MIN_INSTANCES } : {}),
  }
  return onCall(options, async (request) => {
    const requestId = requestIdOf(request.data)
    let caller: Caller | undefined
    try {
      caller = callerFrom(request)
      if (config.rateLimit) await enforceRateLimit(firestoreRateLimitPort(), caller.uid, name)
      const ua = request.rawRequest?.headers?.['user-agent']
      const result = await run(deps(), caller, request.data, { userAgent: typeof ua === 'string' ? ua : undefined })
      logInfo({ fn: name, uid: caller.uid, tenantId: caller.tenantId, requestId }, 'ok')
      return result
    } catch (e) {
      const ctx = { fn: name, uid: caller?.uid, tenantId: caller?.tenantId, requestId }
      if (e instanceof HttpsError) {
        const reason = (e.details as { reason?: unknown } | undefined)?.reason
        const outcome = e.code === 'resource-exhausted' ? 'rate-limited' : e.code === 'internal' ? 'error' : 'denied'
        const extra = { code: e.code, reason: typeof reason === 'string' ? reason : undefined }
        if (outcome === 'error') logError(ctx, e, extra)
        else logWarn(ctx, outcome, extra)
        throw e
      }
      logError(ctx, e)
      throw new HttpsError('internal', 'Internal error', { reason: 'internal' })
    }
  })
}

/**
 * Unauthenticated callables (workspace setup): no caller, a per-IP rate limit instead, the same one-line log
 * (`fn`, `outcome`, `reason`; never the payload). App Check still applies through the global `enforceAppCheck`.
 * The IP comes from Express (`rawRequest.ip`, behind Google's proxy); only its hash is stored.
 */
export function publicCallable<T>(name: keyof typeof IP_RATE_LIMITS, run: (data: unknown) => Promise<T>) {
  return onCall(async (request) => {
    const ctx = { fn: name }
    try {
      await enforceIpRateLimit(firestoreRateLimitPort(), request.rawRequest?.ip, name)
      const result = await run(request.data)
      logInfo(ctx, 'ok')
      return result
    } catch (e) {
      if (e instanceof HttpsError) {
        const reason = (e.details as { reason?: unknown } | undefined)?.reason
        const outcome = e.code === 'resource-exhausted' ? 'rate-limited' : e.code === 'internal' ? 'error' : 'denied'
        const extra = { code: e.code, reason: typeof reason === 'string' ? reason : undefined }
        if (outcome === 'error') logError(ctx, e, extra)
        else logWarn(ctx, outcome, extra)
        throw e
      }
      logError(ctx, e)
      throw new HttpsError('internal', 'Internal error', { reason: 'internal' })
    }
  })
}
