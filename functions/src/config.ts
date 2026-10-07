/** Region for all callables. Keep in sync with VITE_FUNCTIONS_REGION in the web app. */
export const REGION = process.env.FUNCTIONS_REGION || 'asia-south1'

const intFromEnv = (raw: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** True inside the Functions emulator (it sets FUNCTIONS_EMULATOR=true). */
export const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true'

/**
 * App Check enforcement for callables. Off unless `ENFORCE_APP_CHECK=true` (functions/.env.<alias>), and never in
 * the emulator. Roll out in monitoring mode first: see docs/ops.md.
 */
export const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === 'true' && !IN_EMULATOR

/**
 * Warm instances for the latency-sensitive gate callables (`checkIn`, `resolveVehicle`, `submitPass`).
 * Default 0 (staging); production sets MIN_INSTANCES=1 in functions/.env.prod. Costs money: see docs/ops.md.
 */
export const MIN_INSTANCES = intFromEnv(process.env.MIN_INSTANCES, 0, 0, 10)

/** Default per-user rate limit for sensitive callables: calls per window. */
export const RATE_LIMIT_CALLS = intFromEnv(process.env.RATE_LIMIT_CALLS, 30, 1, 10_000)
export const RATE_LIMIT_WINDOW_SECONDS = intFromEnv(process.env.RATE_LIMIT_WINDOW_SECONDS, 60, 1, 3600)

/** Public origin of the web app (https), used for push links. Empty = push messages carry no absolute link. */
export const APP_BASE_URL = (process.env.APP_BASE_URL ?? '').replace(/\/+$/, '')
