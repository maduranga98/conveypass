import { NotificationsRoot } from '@/features/notifications/NotificationsProvider'
import { VerifyEmailBanner } from './VerifyEmailBanner'

/** Under the auth guard: the live notification feed, plus the staff "verify your email" reminder above every screen. */
export function AuthedShell() {
  return (
    <>
      <VerifyEmailBanner />
      <NotificationsRoot />
    </>
  )
}
