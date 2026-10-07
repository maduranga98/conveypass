import { useQuery } from '@tanstack/react-query'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where, type QueryConstraint } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import type { Contractor, Driver, Vehicle, WithId } from '@/types'
import { useScope, type Scope } from './scope'

/** Lists load once per scope, capped; search and filters run client-side. */
export const LIST_CAP = 1000

export interface ListData<T> {
  items: WithId<T>[]
  /** True when the cap was hit, so more records may exist than are shown. */
  capped: boolean
}

function scoped(tenantId: string, contractorId: string | null, order: string): QueryConstraint[] {
  return [
    where('tenantId', '==', tenantId),
    ...(contractorId ? [where('contractorId', '==', contractorId)] : []),
    orderBy(order),
    limit(LIST_CAP),
  ]
}

async function load<T>(name: string, constraints: QueryConstraint[]): Promise<ListData<T>> {
  const snap = await getDocs(query(collection(db, name), ...constraints))
  return { items: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })), capped: snap.size >= LIST_CAP }
}

export function useVehicles(scope: Scope) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useQuery({
    queryKey: ['vehicles', tenantId, contractorId ?? 'all'],
    enabled: ready,
    queryFn: () => load<Vehicle>('vehicles', scoped(tenantId, contractorId, 'plateKey')),
  })
}

export function useDrivers(scope: Scope) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useQuery({
    queryKey: ['drivers', tenantId, contractorId ?? 'all'],
    enabled: ready,
    queryFn: () => load<Driver>('drivers', scoped(tenantId, contractorId, 'name')),
  })
}

/**
 * Admin: every contractor of the tenant. Supervisor: just their own (rules only allow reading that document,
 * so a tenant-wide query would be denied).
 */
export function useContractorList(scope: Scope) {
  const { tenantId, contractorId, ready } = useScope(scope)
  return useQuery({
    queryKey: ['contractors', tenantId, contractorId ?? 'all'],
    enabled: ready,
    queryFn: async (): Promise<WithId<Contractor>[]> => {
      if (contractorId) {
        const snap = await getDoc(doc(db, 'contractors', contractorId))
        return snap.exists() ? [{ ...(snap.data() as Contractor), id: snap.id }] : []
      }
      const snap = await getDocs(
        query(collection(db, 'contractors'), where('tenantId', '==', tenantId), orderBy('createdAt', 'desc')),
      )
      return snap.docs.map((d) => ({ ...(d.data() as Contractor), id: d.id }))
    },
  })
}

/** Photo URLs are fetched on demand from the stored path and cached. `version` busts the cache after a re-upload. */
export function useDriverPhotoUrl(photoPath: string | null | undefined, version?: number) {
  return useQuery({
    queryKey: ['driverPhotoUrl', photoPath, version ?? 0],
    enabled: Boolean(photoPath),
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
    queryFn: () => getDownloadURL(ref(storage, photoPath as string)),
  })
}
