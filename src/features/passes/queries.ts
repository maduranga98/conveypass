import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { dateKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { db } from '@/lib/firebase'
import type { Tenant, Vehicle, WithId } from '@/types'
import type { PassDoc } from '@/types/passes'

/** The member's own tenant document (rules allow reading it). */
export function useTenant(tenantId: string) {
  return useQuery({
    queryKey: ['tenant', tenantId],
    queryFn: async (): Promise<Tenant | null> => {
      const snap = await getDoc(doc(db, 'tenants', tenantId))
      return snap.exists() ? (snap.data() as Tenant) : null
    },
  })
}

export const todayKey = (tenant: Tenant | null | undefined): string => dateKey(tenant?.timezone ?? DEFAULT_TIMEZONE)

/** Vehicles assigned to this driver (allowed by the rules because the query asks for exactly that). */
export function useMyVehicles(tenantId: string, uid: string) {
  return useQuery({
    queryKey: ['myVehicles', tenantId, uid],
    staleTime: 0,
    queryFn: async (): Promise<WithId<Vehicle>[]> => {
      const snap = await getDocs(
        query(collection(db, 'vehicles'), where('tenantId', '==', tenantId), where('assignedDriverIds', 'array-contains', uid)),
      )
      return snap.docs
        .map((d) => ({ ...(d.data() as Vehicle), id: d.id }))
        .sort((a, b) => a.plateKey.localeCompare(b.plateKey))
    },
  })
}

export const RECENT_PASSES = 10
/** Enough history to find today's pass for every vehicle, not just the 10 shown. */
const PASS_FETCH = 30

/** This driver's latest passes, newest first. */
export function useMyPasses(tenantId: string, uid: string) {
  return useQuery({
    queryKey: ['myPasses', tenantId, uid],
    staleTime: 0,
    queryFn: async (): Promise<(PassDoc & { id: string })[]> => {
      const snap = await getDocs(
        query(
          collection(db, 'passes'),
          where('tenantId', '==', tenantId),
          where('driverId', '==', uid),
          orderBy('submittedAt', 'desc'),
          limit(PASS_FETCH),
        ),
      )
      return snap.docs.map((d) => ({ ...(d.data() as PassDoc), id: d.id }))
    },
  })
}
