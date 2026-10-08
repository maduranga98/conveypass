import { FirebaseError } from 'firebase/app'
import { signInWithCustomToken } from 'firebase/auth'
import type { FunctionsError } from 'firebase/functions'
import { Delete, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { PageSpinner } from '@/components/ui/Spinner'
import { loginWithPin } from '@/lib/api'
import { cn } from '@/lib/cn'
import { deviceId } from '@/lib/deviceId'
import { auth } from '@/lib/firebase'
import { PIN_LENGTH, pinDigits } from '@/lib/pin'
import { OPERATOR_HOME, ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { AuthHeading, AuthSplit } from './AuthSplit'
import { nextForRole, safeNext, STAFF_LOGIN } from './redirect'
import { useAuth } from './useAuth'

const t = strings.pinLogin

type Problem = { kind: 'failed' | 'offline' | 'error' } | { kind: 'locked'; until: number }

/** Reads `details.retryAfterSeconds` from a `loginWithPin` refusal (the throttle path), else null. */
function retryAfterOf(e: unknown): number | null {
  const details = e instanceof FirebaseError ? (e as FunctionsError).details : undefined
  const v = typeof details === 'object' && details !== null ? (details as { retryAfterSeconds?: unknown }).retryAfterSeconds : undefined
  return typeof v === 'number' && v > 0 ? v : null
}

const isNetworkError = (e: unknown): boolean =>
  e instanceof FirebaseError &&
  ['functions/unavailable', 'functions/deadline-exceeded', 'auth/network-request-failed', 'unavailable'].includes(e.code)

/** Wall-clock helpers, kept outside the component (they run in event handlers, never while rendering). */
const clock = () => Date.now()

const mmss = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * `/login`: the PIN screen for drivers and security (Module 12). Logo, "Enter your PIN", eight boxes (4 + 4) and a big
 * keypad. A real keyboard and paste work too. The 8th digit sends at once; the server finds who it is and returns a
 * custom token. Office staff follow the small link to `/login/staff`. A `next` return URL survives both ways.
 */
export default function PinLoginPage() {
  const { status, session, operator, notice } = useAuth()
  const [params] = useSearchParams()
  if (status === 'loading') return <PageSpinner />
  if (operator) return <Navigate to={OPERATOR_HOME} replace />
  if (session) return <Navigate to={nextForRole(session.claims.role, params.get('next')) ?? ROLE_HOME[session.claims.role]} replace />
  const next = safeNext(params.get('next'))
  return <PinScreen notice={notice} staffHref={next ? `${STAFF_LOGIN}?next=${encodeURIComponent(next)}` : STAFF_LOGIN} />
}

export function PinScreen({ notice, staffHref }: { notice: string | null; staffHref: string }) {
  const { clearNotice } = useAuth()
  const [digits, setDigits] = useState('')
  const [reveal, setReveal] = useState(false)
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [shake, setShake] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const messageId = useId()

  const lockedFor = problem?.kind === 'locked' ? problem.until - now : 0
  const locked = lockedFor > 0
  const disabled = sending || locked

  // The lockout countdown ticks every second and frees the keypad when it ends.
  useEffect(() => {
    if (problem?.kind !== 'locked') return
    const timer = setInterval(() => setNow(clock()), 1000)
    return () => clearInterval(timer)
  }, [problem])

  // A keyboard (a laptop at the gate house) can type straight away; on a phone the keypad is used instead.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  const send = async (pin: string) => {
    clearNotice()
    setProblem(null)
    if (!navigator.onLine) {
      setDigits('')
      setProblem({ kind: 'offline' })
      return
    }
    setSending(true)
    try {
      const { token } = await loginWithPin({ pin, deviceId: deviceId() })
      await signInWithCustomToken(auth, token)
      // AuthProvider picks up the new session; this page then redirects to the return URL or the role home.
    } catch (e) {
      setDigits('')
      const retry = retryAfterOf(e)
      if (retry !== null) {
        const at = clock()
        setNow(at)
        const until = at + retry * 1000
        setProblem({ kind: 'locked', until })
      } else if (isNetworkError(e) || !navigator.onLine) {
        setProblem({ kind: 'offline' })
      } else {
        setProblem({ kind: e instanceof FirebaseError && e.code === 'functions/unauthenticated' ? 'failed' : 'error' })
        setShake((n) => n + 1)
      }
    } finally {
      setSending(false)
    }
  }

  const update = (value: string) => {
    if (disabled) return
    const clean = pinDigits(value)
    setDigits(clean)
    if (clean.length > 0 && problem?.kind !== 'locked') setProblem(null)
    if (clean.length === PIN_LENGTH) void send(clean)
  }

  const press = (key: string) => update(key === 'del' ? digits.slice(0, -1) : digits + key)

  const message =
    problem?.kind === 'locked' && locked
      ? t.locked(Math.max(1, Math.ceil(lockedFor / 60_000)))
      : problem?.kind === 'failed'
        ? t.failed
        : problem?.kind === 'offline'
          ? t.offline
          : problem?.kind === 'error'
            ? t.somethingWrong
            : null

  return (
    <AuthSplit className="text-lg">
      <AuthHeading title={t.title} compact />
      <p className="mt-2 hidden text-base text-slate-600 lg:block">{t.subtitle}</p>

      <div className="mt-3 min-h-12 space-y-2 lg:mt-6" aria-live="polite">
        {notice && !problem && <NotificationBanner tone="info" size="lg">{notice}</NotificationBanner>}
        {message && (
          <NotificationBanner tone={problem?.kind === 'offline' ? 'warning' : 'error'} size="lg" role="alert">
            <span id={messageId}>{message}</span>
            {locked && <span className="mt-1 block font-bold tabular-nums">{t.countdown(mmss(lockedFor))}</span>}
          </NotificationBanner>
        )}
      </div>

      {/* The real input: keyboard typing and paste (spaces stripped). The boxes below only draw its value. */}
      <label htmlFor={inputId} className="sr-only">{t.inputLabel}</label>
      <input
        ref={inputRef}
        id={inputId}
        type={reveal ? 'text' : 'password'}
        inputMode="numeric"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        maxLength={PIN_LENGTH + 4}
        value={digits}
        disabled={disabled}
        aria-describedby={message ? messageId : undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => update(e.target.value)}
        className="peer sr-only"
      />

      <div
        key={shake}
        role="img"
        aria-label={`${t.boxesLabel}: ${digits.length} of ${PIN_LENGTH}`}
        className={cn(
          'mt-2 flex w-full items-center gap-1.5 rounded-xl sm:gap-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-focus',
          shake > 0 && 'motion-safe:animate-shake',
        )}
        data-testid="pin-boxes"
      >
        {Array.from({ length: PIN_LENGTH }, (_, i) => {
          const d = digits[i]
          return (
            <span
              key={i}
              data-filled={d !== undefined}
              className={cn(
                'grid h-14 min-w-0 flex-1 place-items-center rounded-xl border-2 text-2xl font-extrabold text-brand transition-colors sm:h-16',
                i === 4 && 'ml-3 sm:ml-4',
                d !== undefined
                  ? 'border-brand bg-surface'
                  : i === digits.length && !disabled
                    ? 'border-accent-hover bg-accent-soft'
                    : 'border-slate-200 bg-slate-100',
              )}
            >
              {d === undefined ? '' : reveal ? d : '•'}
            </span>
          )
        })}
      </div>

      <div className="flex h-14 items-center justify-between gap-3" aria-live="polite">
        <span className="min-w-0 flex-1">
          {sending && (
            <span role="status" className="inline-flex items-center gap-2 font-semibold text-slate-700">
              <Loader2 aria-hidden className="size-5 animate-spin" />
              {t.checking}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          aria-pressed={reveal}
          aria-label={reveal ? t.hide : t.show}
          title={reveal ? t.hide : t.show}
          className="grid size-14 shrink-0 place-items-center rounded-xl text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {reveal ? <EyeOff aria-hidden className="size-6" /> : <Eye aria-hidden className="size-6" />}
        </button>
      </div>

      <div role="group" aria-label={t.keypadLabel} className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((key) =>
          key === '' ? (
            <span key="blank" aria-hidden />
          ) : (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => press(key)}
              aria-label={key === 'del' ? t.delete : key}
              className={cn(
                // Never below 56 px; grows on tall screens, shrinks on short phones so the keypad always fits.
                'grid h-[clamp(3.5rem,9dvh,4.75rem)] place-items-center rounded-2xl text-3xl font-bold transition-transform select-none motion-safe:active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-40',
                key === 'del'
                  ? 'bg-slate-200 text-brand hover:bg-slate-300 active:bg-slate-300'
                  : 'border border-slate-200 bg-surface text-brand shadow-sm hover:bg-slate-50 active:bg-slate-100',
              )}
            >
              {key === 'del' ? <Delete aria-hidden className="size-8" /> : key}
            </button>
          ),
        )}
      </div>

      <p className="mt-auto pt-4 text-center lg:mt-4 lg:text-left">
        <Link
          to={staffHref}
          className="inline-flex min-h-14 items-center rounded-lg px-3 text-base font-medium text-slate-700 underline underline-offset-4 hover:text-brand focus-visible:outline-2 focus-visible:outline-focus lg:-ml-3"
        >
          {t.staffLink}
        </Link>
      </p>
    </AuthSplit>
  )
}
