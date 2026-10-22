import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Vehicle, WithId } from '@/types'
import type { Inspection } from '@/types/inspections'
import { useScope, type Scope } from '@/features/shared/scope'
import { REINSPECTION_STATUSES } from './model'

export const HISTORY_LIMIT = 50

/**
 * Every inspection of one vehicle, newest first. The query carries the clauses the rules require: the tenant, and for a
 * supervisor their own contractor. Admin (oversight, read only) and the Safety Officer read the whole company.
 */
export function useVehicleInspections(scope: Scope, vehicleId: string | undefined) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useQuery({
    queryKey: ['inspections', tenantId, contractorId ?? 'all', vehicleId],
    enabled: ready && vehicleId !== undefined,
    // The triggers that cancel a clearance run server side: always re-read when a screen opens.
    staleTime: 0,
    queryFn: async (): Promise<WithId<Inspection>[]> => {
      const snap = await getDocs(
        query(
          collection(db, 'inspections'),
          where('tenantId', '==', tenantId),
          ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
          where('vehicleId', '==', vehicleId),
          orderBy('inspectedAt', 'desc'),
          limit(HISTORY_LIMIT),
        ),
      )
      return snap.docs.map((d) => ({ ...(d.data() as Inspection), id: d.id }))
    },
  })
}

/**
 * The vehicles that need another look: clearance cancelled, or the last inspection rejected. Read straight from the
 * vehicles (they carry a copy of the current clearance), longest waiting first. Refreshed every minute because the
 * cancelling triggers run server side.
 */
export function useReinspectionVehicles() {
  const { tenantId } = useScope('admin')
  return useQuery({
    queryKey: ['reinspection', tenantId],
    refetchInterval: 60_000,
    queryFn: async (): Promise<WithId<Vehicle>[]> => {
      const snap = await getDocs(
        query(collection(db, 'vehicles'), where('tenantId', '==', tenantId), where('clearance.status', 'in', [...REINSPECTION_STATUSES]), limit(500)),
      )
      return snap.docs.map((d) => ({ ...(d.data() as Vehicle), id: d.id })).sort((a, b) => (a.clearance?.at ?? 0) - (b.clearance?.at ?? 0))
    },
  })
}
