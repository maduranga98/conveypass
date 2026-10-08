import { MailWarning } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { sendVerificationEmail } from '@/lib/emailActions'
import { cn } from '@/lib/cn'
import { auth } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import { useAuth } from './useAuth'
import { useCooldown } from './useCooldown'

const t = strings.verifyBanner
/** Shells with a fixed navy sidebar on desktop (16rem): the banner starts beside it, not under it. */
const SIDEBAR_SHELL = /^\/(officer|supervisor)(\/|$)/

/**
 * Slim, non-blocking reminder for signed-in STAFF whose email is not verified (a verified email is what makes the
 * password-reset email work). Drivers sign in with a synthetic address and never see it.
 */
export function VerifyEmailBanner() {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const uid = session?.uid
  // `auth.currentUser` is the source of truth; `confirmed` only makes the banner re-render once a check succeeds.
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { remaining, start } = useCooldown(60)
  const verified = confirmed === uid || (auth.currentUser?.emailVerified ?? true)

  if (!session || session.claims.role === 'driver' || verified || pathname === '/change-password') return null

  const resend = async () => {
    const user = auth.currentUser
    if (!user) return
    setBusy(true)
    try {
      await sendVerificationEmail(user)
      toast.success(t.sent)
      start()
    } catch {
      toast.error(t.failed)
    } finally {
      setBusy(false)
    }
  }

  const check = async () => {
    const user = auth.currentUser
    if (!user) return
    setBusy(true)
    try {
      await user.reload()
      await user.getIdToken(true)
      if (auth.currentUser?.emailVerified) setConfirmed(uid ?? null)
      else toast(t.stillNot)
    } catch {
      toast.error(t.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="region" aria-label={t.message} className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-accent/40 bg-warning-soft px-4 py-2 text-sm text-warning-ink', SIDEBAR_SHELL.test(pathname) && 'lg:pl-68')}>
      <p className="flex items-center gap-2">
        <MailWarning aria-hidden className="size-4 shrink-0" />
        {t.message}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => void resend()} disabled={busy || remaining > 0}>
          {remaining > 0 ? t.resendIn(remaining) : t.resend}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void check()} disabled={busy}>
          {t.verified}
        </Button>
      </div>
    </div>
  )
}
