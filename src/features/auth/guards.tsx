import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PageSpinner } from '@/components/ui/Spinner'
import { ROLE_HOME, type Role } from '@/lib/roles'
import { ForbiddenPage } from './ErrorPages'
import { changePasswordUrl, loginUrl } from './redirect'
import { useAuth } from './useAuth'

/** Signed-out users go to /login (remembering where they were headed); must-change users go to /change-password. */
export function RequireAuth() {
  const { status, session } = useAuth()
  const location = useLocation()
  const here = location.pathname + location.search + location.hash

  if (status === 'loading') return <PageSpinner />
  if (!session) return <Navigate to={loginUrl(here)} replace />
  if (session.profile.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to={changePasswordUrl(here)} replace />
  }
  return <Outlet />
}

/** UI-level gate only: Firestore rules and Cloud Functions enforce access independently. */
export function RequireRole({ roles }: { roles: readonly Role[] }) {
  const { session } = useAuth()
  if (!session || !roles.includes(session.claims.role)) return <ForbiddenPage />
  return <Outlet />
}

export function RoleHomeRedirect() {
  const { session } = useAuth()
  return <Navigate to={session ? ROLE_HOME[session.claims.role] : '/login'} replace />
}
