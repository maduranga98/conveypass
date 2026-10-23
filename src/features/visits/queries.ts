import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, type DocumentData, type QueryConstraint } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { db } from '@/lib/firebase'
import { getDailySummary } from '@/lib/api'
import { useSession } from '@/features/auth/useAuth'
import { useScope, type Scope } from '@/features/shared/scope'
import type { WithId } from '@/types'
import type { Visit } from '@/types/visits'

export const VISIT_LIST_LIMIT = 100
export const ACTIVE_LIMIT = 300

type Status = 'loading' | 'ready' | 'error'

/**
 * Visits that are still checked in, live. One listener for the gate and the yard: the query carries the clauses the rules
 * require (tenant, and for the Yard Officer `status == checked_in`). Longest on site first. Unsubscribes with the screen.
 */
export function useActiveVisits() {
  const { claims } = useSession()
  const [state, setState] = useState<{ items: WithId<Visit>[]; status: Status; error: unknown }>({ items: [], status: 'loading', error: null })
  const [attempt, setAttempt] = useState(0)
  const tenantId = claims.tenantId

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, 'visits'), where('tenantId', '==', tenantId), where('status', '==', 'checked_in'), limit(ACTIVE_LIMIT)),
      (snap) => {
        const items = snap.docs
          .map((d) => ({ ...(d.data() as Visit), id: d.id }))
          .sort((a, b) => a.checkIn.timestamp.toMillis() - b.checkIn.timestamp.toMillis())
        setState({ items, status: 'ready', error: null })
      },
      (error) => setState((s) => ({ ...s, status: 'error', error })),
    )
    return () => unsubscribe()
  }, [tenantId, attempt])

  const retry = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    setAttempt((n) => n + 1)
  }, [])
  return { ...state, retry }
}

const toVisit = (d: { id: string; data: () => DocumentData }): WithId<Visit> => ({ ...(d.data() as Visit), id: d.id })

/** One visit by id (admin and supervisor detail). A supervisor's read of another contractor's visit is refused by the rules, which shows as "not found". */
export function useVisit(visitId: string | undefined) {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['visit', claims.tenantId, visitId],
    enabled: visitId !== undefined,
    staleTime: 15_000,
    queryFn: async (): Promise<WithId<Visit> | null> => {
      try {
        const snap = await getDoc(doc(db, 'visits', visitId as string))
        if (!snap.exists() || snap.data().tenantId !== claims.tenantId) return null
        return toVisit(snap)
      } catch (e) {
        if ((e as { code?: string }).code === 'permission-denied') return null
        throw e
      }
    },
  })
}

/** The latest visits of the company (admin) or of the supervisor's contractor, newest first. */
export function useVisitList(scope: Scope) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useQuery({
    queryKey: ['visits', tenantId, contractorId ?? 'all'],
    enabled: ready,
    staleTime: 30_000,
    queryFn: async (): Promise<WithId<Visit>[]> => {
      const snap = await getDocs(
        query(
          collection(db, 'visits'),
          where('tenantId', '==', tenantId),
          ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
          orderBy('checkIn.timestamp', 'desc'),
          limit(VISIT_LIST_LIMIT),
        ),
      )
      return snap.docs.map(toVisit)
    },
  })
}

/** Recent visits of one vehicle or one driver (the drawers on the vehicle and driver pages). */
export function useSubjectVisits(scope: Scope, field: 'vehicleId' | 'driverId', id: string | undefined) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useQuery({
    queryKey: ['visits', tenantId, contractorId ?? 'all', field, id],
    enabled: ready && id !== undefined,
    staleTime: 15_000,
    queryFn: async (): Promise<WithId<Visit>[]> => {
      const clauses: QueryConstraint[] = [
        where('tenantId', '==', tenantId),
        ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
        where(field, '==', id),
        orderBy('checkIn.timestamp', 'desc'),
        limit(10),
      ]
      return (await getDocs(query(collection(db, 'visits'), ...clauses))).docs.map(toVisit)
    },
  })
}

/** Role-filtered counts for today, computed by the server (`getDailySummary`). Refreshed every minute. */
export function useDailySummary() {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['dailySummary', claims.tenantId, claims.role],
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () => getDailySummary({}),
  })
}
