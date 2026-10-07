import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, orderBy, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Role } from '@/lib/roles'
import type { Contractor, UserDoc, WithId } from '@/types'
import { useSession } from '@/features/auth/useAuth'

/** Every query is scoped by the tenant from the caller's token claims. */
export function useUsers(role: Role | '') {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['users', claims.tenantId, role],
    queryFn: async (): Promise<WithId<UserDoc>[]> => {
      const constraints: QueryConstraint[] = [where('tenantId', '==', claims.tenantId)]
      if (role) constraints.push(where('role', '==', role))
      constraints.push(orderBy('createdAt', 'desc'))
      const snap = await getDocs(query(collection(db, 'users'), ...constraints))
      return snap.docs.map((d) => ({ ...(d.data() as UserDoc), id: d.id }))
    },
  })
}

export function useContractors() {
  const { claims } = useSession()
  return useQuery({
    queryKey: ['contractors', claims.tenantId],
    queryFn: async (): Promise<WithId<Contractor>[]> => {
      const snap = await getDocs(
        query(collection(db, 'contractors'), where('tenantId', '==', claims.tenantId), orderBy('createdAt', 'desc')),
      )
      return snap.docs.map((d) => ({ ...(d.data() as Contractor), id: d.id }))
    },
  })
}
