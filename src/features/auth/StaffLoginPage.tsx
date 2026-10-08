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
import { authErrorMessage } from '@/lib/errors'
import { auth } from '@/lib/firebase'
import { OPERATOR_HOME, ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { AuthHeading, AuthSplit } from './AuthSplit'
import { nextForRole, safeNext } from './redirect'
import { useAuth } from './useAuth'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const staffSchema = z.object({
  email: z.string().trim().email(strings.auth.invalidEmail),
  password: z.string().min(1, strings.auth.passwordRequired),
})
type StaffValues = z.infer<typeof staffSchema>

/**
 * `/login/staff`: email and password for office staff (admin, officer, supervisor) and the Super admin. Drivers and
 * security use the PIN screen at `/login` (Module 12); this form never mentions it.
 */
export default function StaffLoginPage() {
  const { status, session, operator, notice, clearNotice } = useAuth()
  const [params] = useSearchParams()
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
    <AuthSplit className="justify-center">
      <AuthHeading title={strings.auth.staffTitle} subtitle={strings.auth.staffIntro} />

      <div className="mt-8 space-y-4">
        {message && <NotificationBanner tone="error">{message}</NotificationBanner>}
        <StaffForm onSubmit={signIn} />
      </div>

      <footer className="mt-8 flex flex-wrap justify-center gap-x-2 text-center lg:justify-start lg:text-left">
        <Link
          to={params.get('next') ? `/login?next=${encodeURIComponent(params.get('next') ?? '')}` : '/login'}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-700 underline underline-offset-4 hover:text-brand focus-visible:outline-2 focus-visible:outline-focus lg:-ml-3"
        >
          {strings.auth.back}
        </Link>
        <Link
          to="/privacy"
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-700 underline underline-offset-4 hover:text-brand focus-visible:outline-2 focus-visible:outline-focus"
        >
          {strings.privacy.link}
        </Link>
      </footer>
    </AuthSplit>
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
    <form onSubmit={handleSubmit((v) => onSubmit(v.email, v.password))} className="space-y-5" noValidate>
      <Input
        className="h-12 rounded-xl text-base"
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
        className="h-12 rounded-xl pr-12 text-base"
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
      <Button type="submit" className="h-12 w-full rounded-xl text-base" loading={isSubmitting}>
        {isSubmitting ? strings.auth.signingIn : strings.auth.signIn}
      </Button>
      <p className="text-center lg:text-left">
        <Link
          to="/forgot-password"
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-slate-700 underline underline-offset-4 hover:text-brand focus-visible:outline-2 focus-visible:outline-focus lg:-ml-3"
        >
          {strings.auth.forgotPassword}
        </Link>
      </p>
    </form>
  )
}
