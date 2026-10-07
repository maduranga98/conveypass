import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { auth, db } from '@/lib/firebase'
import { queryClient } from '@/lib/queryClient'
import { strings } from '@/lib/strings'
import type { UserDoc } from '@/types'
import { parseClaims } from './claims'
import { AuthContext, type AuthContextValue, type Session } from './useAuth'

interface State {
  status: AuthContextValue['status']
  session: Session | null
  notice: string | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading', session: null, notice: null })
  const generation = useRef(0)

  const endSession = useCallback(async (notice: string) => {
    setState((s) => ({ ...s, notice }))
    await fbSignOut(auth)
  }, [])

  useEffect(() => {
    let unsubProfile: (() => void) | null = null

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      const gen = ++generation.current
      unsubProfile?.()
      unsubProfile = null

      if (!user) {
        queryClient.clear() // never leak one account's cached data into the next session
        setState((s) => ({ status: 'signedOut', session: null, notice: s.notice }))
        return
      }

      setState((s) => ({ ...s, status: 'loading' }))
      void (async () => {
        let claims = parseClaims((await user.getIdTokenResult()).claims)
        if (gen !== generation.current) return
        if (!claims) {
          await endSession(strings.authErrors.accountMissing)
          return
        }

        unsubProfile = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            if (gen !== generation.current) return
            const data = snap.data() as UserDoc | undefined
            if (!data) {
              void endSession(strings.authErrors.accountMissing)
              return
            }
            if (data.status === 'disabled') {
              void endSession(strings.authErrors.accountDisabled)
              return
            }
            if (claims && (data.role !== claims.role || data.tenantId !== claims.tenantId)) {
              // Stale token: pick up the new claims.
              void user.getIdTokenResult(true).then((r) => {
                const fresh = parseClaims(r.claims)
                if (fresh) claims = fresh
                else void endSession(strings.authErrors.accountMissing)
              })
              return
            }
            if (!claims) return
            setState({
              status: 'signedIn',
              notice: null,
              session: { uid: user.uid, claims, profile: { ...data, id: snap.id } },
            })
          },
          () => {
            if (gen === generation.current) void endSession(strings.authErrors.sessionEnded)
          },
        )
      })().catch(() => void endSession(strings.authErrors.sessionEnded))
    })

    return () => {
      unsubAuth()
      unsubProfile?.()
    }
  }, [endSession])

  const refreshClaims = useCallback(async () => {
    const user = auth.currentUser
    if (!user) return
    const claims = parseClaims((await user.getIdTokenResult(true)).claims)
    if (!claims) return endSession(strings.authErrors.accountMissing)
    setState((s) => (s.session ? { ...s, session: { ...s.session, claims } } : s))
  }, [endSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      clearNotice: () => setState((s) => ({ ...s, notice: null })),
      signOut: () => fbSignOut(auth),
      refreshClaims,
    }),
    [state, refreshClaims],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
