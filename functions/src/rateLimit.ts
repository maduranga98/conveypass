import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { RATE_LIMIT_CALLS, RATE_LIMIT_WINDOW_SECONDS } from './config.js'
import { fail } from './errors.js'

/** Fixed-window counter state for one `rateLimits/{uid}_{fn}` document. */
export interface WindowState {
  windowStart: number
  count: number
}

export interface RateLimitOptions {
  limit: number
  windowMs: number
}

export const DEFAULT_RATE_LIMIT: RateLimitOptions = {
  limit: RATE_LIMIT_CALLS,
  windowMs: RATE_LIMIT_WINDOW_SECONDS * 1000,
}

/** Pure decision: a new window resets the count; inside a window the (limit + 1)th call is refused. */
export function evaluateWindow(
  prev: WindowState | undefined,
  nowMs: number,
  { limit, windowMs }: RateLimitOptions,
): { allowed: boolean; next: WindowState; retryAfterMs: number } {
  const windowStart = Math.floor(nowMs / windowMs) * windowMs
  const retryAfterMs = windowStart + windowMs - nowMs
  if (!prev || prev.windowStart !== windowStart) {
    return { allowed: true, next: { windowStart, count: 1 }, retryAfterMs }
  }
  if (prev.count >= limit) return { allowed: false, next: prev, retryAfterMs }
  return { allowed: true, next: { windowStart, count: prev.count + 1 }, retryAfterMs }
}

/** Storage for window state. `update` must be atomic (a transaction in production). */
export interface RateLimitPort {
  update(key: string, apply: (prev: WindowState | undefined) => WindowState, expireAtMs: (s: WindowState) => number): Promise<void>
}

/**
 * Per-user, per-function fixed window. Throws `resource-exhausted` / `rate-limited` when the window is full.
 * One document per (uid, function): an expired window is overwritten by the next call, so old windows never pile up;
 * `expireAt` lets a Firestore TTL policy remove the documents of users who stop calling.
 */
export async function enforceRateLimit(
  port: RateLimitPort,
  uid: string,
  fnName: string,
  nowMs: number = Date.now(),
  options: RateLimitOptions = DEFAULT_RATE_LIMIT,
): Promise<void> {
  let allowed = true
  let retryAfterMs = 0
  await port.update(
    `${uid}_${fnName}`,
    (prev) => {
      const r = evaluateWindow(prev, nowMs, options)
      allowed = r.allowed
      retryAfterMs = r.retryAfterMs
      return r.next
    },
    (s) => s.windowStart + options.windowMs * 2,
  )
  if (!allowed) {
    throw fail('resource-exhausted', 'rate-limited', `Too many requests. Try again in ${Math.ceil(retryAfterMs / 1000)} s`)
  }
}

export const firestoreRateLimitPort = (): RateLimitPort => {
  const db = getFirestore()
  return {
    update: (key, apply, expireAtMs) =>
      db.runTransaction(async (tx) => {
        const ref = db.doc(`rateLimits/${key}`)
        const snap = await tx.get(ref)
        const data = snap.data() as { windowStart?: number; count?: number } | undefined
        const prev = data && typeof data.windowStart === 'number' && typeof data.count === 'number'
          ? { windowStart: data.windowStart, count: data.count }
          : undefined
        const next = apply(prev)
        if (next !== prev) tx.set(ref, { ...next, expireAt: Timestamp.fromMillis(expireAtMs(next)) })
      }),
  }
}
