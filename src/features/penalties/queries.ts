import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { useSession } from '@/features/auth/useAuth'
import { useTenant } from '@/features/passes/queries'
import { db } from '@/lib/firebase'
import { DEFAULT_TIMEZONE } from '@/lib/dates'
import type { PenaltyType } from '@/types/penalties'
import type { WithId } from '@/types'

/** The company's penalty types, A to Z. Admin, Safety Officer and supervisors may read them (rules). */
export function usePenaltyTypes() {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['penaltyTypes', claims.tenantId],
    queryFn: async (): Promise<WithId<PenaltyType>[]> => {
      const snap = await getDocs(query(collection(db, 'penaltyTypes'), where('tenantId', '==', claims.tenantId), limit(100)))
      return snap.docs.map((d) => ({ ...(d.data() as PenaltyType), id: d.id })).sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}

/** The company timezone: penalty end dates and all penalty times are shown in it. */
export function useTenantTimezone(): string {
  const { claims } = useSession()
  return useTenant(claims.tenantId).data?.timezone ?? DEFAULT_TIMEZONE
}
