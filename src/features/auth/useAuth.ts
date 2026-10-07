import { createContext, useContext } from 'react'
import type { Claims, UserDoc, WithId } from '@/types'

export interface Session {
  uid: string
  claims: Claims
  profile: WithId<UserDoc>
}

export interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn'
  /** Non-null exactly when `status === 'signedIn'`. */
  session: Session | null
  /** Why the user was signed out (disabled, missing profile, …). */
  notice: string | null
  clearNotice: () => void
  signOut: () => Promise<void>
  /** Force-refresh the ID token and re-read claims (`getIdToken(true)`). */
  refreshClaims: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

/** For components rendered below <RequireAuth>, where a session is guaranteed. */
export function useSession(): Session {
  const { session } = useAuth()
  if (!session) throw new Error('useSession requires a signed-in user')
  return session
}
