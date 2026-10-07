import { useQuery } from '@tanstack/react-query'
import { doc, getDoc } from 'firebase/firestore'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import type { Contractor } from '@/types'
import { useAuth, useSession } from './useAuth'

/** Placeholder home for officer / supervisor / driver / security until later modules. */
export default function RolePlaceholder() {
  const { claims, profile } = useSession()
  const { signOut } = useAuth()

  const { data: contractorName } = useQuery({
    queryKey: ['contractor', claims.tenantId, claims.contractorId],
    enabled: claims.contractorId !== null,
    queryFn: async () => {
      const snap = await getDoc(doc(db, 'contractors', claims.contractorId as string))
      return (snap.data() as Contractor | undefined)?.name ?? null
    },
  })

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 py-10">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{strings.home.welcome(profile.name)}</h1>
        <dl className="mt-6 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white text-sm">
          <div className="flex justify-between px-4 py-3">
            <dt className="text-slate-500">{strings.home.role}</dt>
            <dd className="font-medium">{strings.roles[claims.role]}</dd>
          </div>
          {claims.contractorId && (
            <div className="flex justify-between px-4 py-3">
              <dt className="text-slate-500">{strings.home.contractor}</dt>
              <dd className="font-medium">{contractorName ?? strings.common.none}</dd>
            </div>
          )}
        </dl>
        <p className="mt-6 text-sm text-slate-500">{strings.home.placeholder}</p>
      </div>
      <Button variant="secondary" icon={<LogOut aria-hidden className="size-4" />} onClick={() => void signOut()}>
        {strings.common.signOut}
      </Button>
    </main>
  )
}
