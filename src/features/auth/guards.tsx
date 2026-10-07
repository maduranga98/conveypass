import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PageSpinner } from '@/components/ui/Spinner'
import { OPERATOR_HOME, ROLE_HOME, type Role } from '@/lib/roles'
import { ForbiddenPage } from './ErrorPages'
import { changePasswordUrl, loginUrl } from './redirect'
import { useAuth } from './useAuth'

/**
 * Signed-out users go to /login (remembering where they were headed); must-change users go to /change-password.
 * A platform operator has no tenant, so every workspace route is a 403 for them (Module 9).
 */
export function RequireAuth() {
  const { status, session, operator } = useAuth()
  const location = useLocation()
  const here = location.pathname + location.search + location.hash

  if (status === 'loading') return <PageSpinner />
  if (operator) return <ForbiddenPage />
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

/**
 * `/` sends everyone home: workspace users to their role's home, operators to /platform, visitors to /login.
 * It sits outside `RequireAuth` (which refuses operators), so it handles the loading state itself.
 */
export function RoleHomeRedirect() {
  const { status, session, operator } = useAuth()
  if (status === 'loading') return <PageSpinner />
  if (operator) return <Navigate to={OPERATOR_HOME} replace />
  return <Navigate to={session ? ROLE_HOME[session.claims.role] : '/login'} replace />
}

/**
 * UI-level gate for /platform/*: only a platform operator gets in; a workspace user gets a 403 and a visitor goes to
 * /login. The functions re-check everything (claims, verified email, active operators doc) on every call.
 */
export function RequireOperator() {
  const { status, operator, session } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageSpinner />
  if (!operator && !session) return <Navigate to={loginUrl(location.pathname + location.search)} replace />
  if (!operator) return <ForbiddenPage />
  return <Outlet />
}
