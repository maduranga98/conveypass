import { logger } from 'firebase-functions/v2'

/**
 * Structured logging. Every line carries `fn`, `outcome` and, when known, `uid`, `tenantId`, `requestId`.
 * Nothing else is free text: extra fields must be short scalars, keys that look sensitive are dropped, and strings
 * that look like URLs, tokens or JWTs are masked, so names, phones, plates, photo URLs and credentials cannot leak
 * through a careless call. Errors are logged as `errorName` / `errorCode` only (messages can echo input).
 */
export type Outcome = 'ok' | 'denied' | 'error' | 'skipped' | 'rate-limited' | 'duplicate'

export interface LogContext {
  fn: string
  uid?: string | undefined
  tenantId?: string | undefined
  requestId?: string | undefined
}

export type LogExtra = Record<string, string | number | boolean | null | undefined>

const SENSITIVE_KEY = /passw|passphrase|pin$|^pin|token|secret|credential|authorization|cookie|url|phone|email|name$|photo|plate|payload|body/i
const MASKABLE = /https?:\/\/|data:|^eyJ|[A-Za-z0-9_-]{40,}/
const MAX_STRING = 120

export interface LogSink {
  info(message: string, fields: Record<string, unknown>): void
  warn(message: string, fields: Record<string, unknown>): void
  error(message: string, fields: Record<string, unknown>): void
}

let sink: LogSink = logger

/** Tests swap the sink; returns a restore function. */
export function setLogSink(next: LogSink): () => void {
  const previous = sink
  sink = next
  return () => {
    sink = previous
  }
}

const cleanString = (value: string): string =>
  MASKABLE.test(value) ? '[masked]' : value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value

/** Keeps short scalars only, drops sensitive keys, masks sensitive-looking strings. */
export function sanitiseExtra(extra: LogExtra = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || SENSITIVE_KEY.test(key)) continue
    out[key] = typeof value === 'string' ? cleanString(value) : value
  }
  return out
}

const fields = (ctx: LogContext, outcome: Outcome, extra?: LogExtra) => ({
  fn: ctx.fn,
  outcome,
  ...(ctx.uid ? { uid: ctx.uid } : {}),
  ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
  ...(ctx.requestId ? { requestId: cleanString(ctx.requestId) } : {}),
  ...sanitiseExtra(extra),
})

export function describeError(e: unknown): { errorName: string; errorCode?: string } {
  const name = e instanceof Error ? e.name : typeof e
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined
  return { errorName: cleanString(name), ...(code ? { errorCode: cleanString(code) } : {}) }
}

export const logInfo = (ctx: LogContext, outcome: Outcome, extra?: LogExtra): void =>
  sink.info(ctx.fn, fields(ctx, outcome, extra))

export const logWarn = (ctx: LogContext, outcome: Outcome, extra?: LogExtra): void =>
  sink.warn(ctx.fn, fields(ctx, outcome, extra))

export const logError = (ctx: LogContext, e: unknown, extra?: LogExtra): void =>
  sink.error(ctx.fn, { ...fields(ctx, 'error', extra), ...describeError(e) })
