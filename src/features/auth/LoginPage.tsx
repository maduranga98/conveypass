import { zodResolver } from '@hookform/resolvers/zod'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { z } from '@/lib/zod'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageSpinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/cn'
import { driverEmail, isValidPin, normalisePhone } from '@/lib/credentials'
import { authErrorMessage } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { OPERATOR_HOME, ROLE_HOME } from '@/lib/roles'
import { BrandMark } from '@/components/BrandMark'
import { strings } from '@/lib/strings'
import { nextForRole, safeNext } from './redirect'
import { useAuth } from './useAuth'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

type Mode = 'staff' | 'driver'

const staffSchema = z.object({
  email: z.string().trim().email(strings.auth.invalidEmail),
  password: z.string().min(1, strings.auth.passwordRequired),
})
const driverSchema = z.object({
  phone: z.string().refine((v) => normalisePhone(v) !== null, strings.auth.invalidPhone),
  pin: z.string().refine(isValidPin, strings.auth.invalidPin),
})
type StaffValues = z.infer<typeof staffSchema>
type DriverValues = z.infer<typeof driverSchema>

export default function LoginPage() {
  const { status, session, operator, notice, clearNotice } = useAuth()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<Mode>('staff')
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') return <PageSpinner />
  // Operators sign in on the same Staff tab and land on /platform (never on a workspace route).
  if (operator) {
    const next = safeNext(params.get('next'))
    return <Navigate to={next && (next === OPERATOR_HOME || next.startsWith(`${OPERATOR_HOME}/`)) ? next : OPERATOR_HOME} replace />
  }
  if (session) return <Navigate to={nextForRole(session.claims.role, params.get('next')) ?? ROLE_HOME[session.claims.role]} replace />

  const message = error ?? notice

  const signIn = async (email: string, password: string) => {
    clearNotice()
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (e) {
      setError(authErrorMessage(e))
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="mb-3 size-16 rounded-2xl" />
          <h1 className="text-2xl font-semibold tracking-tight">{strings.app.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{strings.app.tagline}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
          <div role="group" aria-label={strings.auth.modeLabel} className="mb-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1">
            {(['staff', 'driver'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => {
                  setMode(m)
                  setError(null)
                }}
                className={cn(
                  'h-11 rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-focus',
                  mode === m ? 'bg-surface text-brand shadow-sm' : 'text-slate-600 hover:text-brand',
                )}
              >
                {m === 'staff' ? strings.auth.staffTab : strings.auth.driverTab}
              </button>
            ))}
          </div>

          {message && (
            <NotificationBanner tone="error" className="mb-4">{message}</NotificationBanner>
          )}

          {mode === 'staff' ? <StaffForm onSubmit={signIn} /> : <DriverForm onSubmit={signIn} />}
        </div>

        <footer className="mt-6 text-center">
          <Link to="/privacy" className="inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline underline-offset-2 hover:text-brand focus-visible:outline-2 focus-visible:outline-focus">
            {strings.privacy.link}
          </Link>
        </footer>
      </div>
    </main>
  )
}

function StaffForm({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [show, setShow] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<StaffValues>({ resolver: zodResolver(staffSchema) })

  return (
    <form onSubmit={handleSubmit((v) => onSubmit(v.email, v.password))} className="space-y-4" noValidate>
      <Input
        label={strings.auth.email}
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        error={errors.email?.message}
        {...register('email')}
      />
      <Input
        label={strings.auth.password}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        error={errors.password?.message}
        trailing={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? strings.auth.hidePassword : strings.auth.showPassword}
          >
            {show ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </Button>
        }
        {...register('password')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {isSubmitting ? strings.auth.signingIn : strings.auth.signIn}
      </Button>
      <p className="text-center">
        <Link to="/forgot-password" className="inline-flex min-h-11 items-center px-3 text-sm text-slate-700 underline underline-offset-2 hover:text-brand focus-visible:outline-2 focus-visible:outline-focus">
          {strings.auth.forgotPassword}
        </Link>
      </p>
    </form>
  )
}

function DriverForm({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DriverValues>({ resolver: zodResolver(driverSchema) })

  return (
    <form
      onSubmit={handleSubmit((v) => {
        const phone = normalisePhone(v.phone)
        // The synthetic email is internal plumbing; drivers only ever see phone + PIN.
        return phone ? onSubmit(driverEmail(phone), v.pin) : undefined
      })}
      className="space-y-4"
      noValidate
    >
      <Input
        label={strings.auth.phone}
        type="tel"
        inputMode="tel"
        autoComplete="username"
        placeholder={strings.auth.phoneHint}
        error={errors.phone?.message}
        {...register('phone')}
      />
      <Input
        label={strings.auth.pin}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={6}
        autoComplete="current-password"
        error={errors.pin?.message}
        {...register('pin')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {isSubmitting ? strings.auth.signingIn : strings.auth.signIn}
      </Button>
      <p className="text-center text-sm text-slate-600">{strings.auth.driverForgotHelp}</p>
    </form>
  )
}
