import { LogOut } from 'lucide-react'
import { Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { usePendingCount } from '@/features/passes/usePendingCount'
import { usePendingTitle } from '@/features/passes/usePendingTitle'

/** Desktop-first shell: a slim top bar (name, sign out) over the queue. */
export default function OfficerLayout() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  const { count } = usePendingCount('officer')
  usePendingTitle(count)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-300 bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
          <p className="text-base font-semibold tracking-tight">{strings.officer.topBar}</p>
          <div className="flex items-center gap-3">
            <p className="truncate text-sm font-medium text-slate-800">{profile.name}</p>
            <Button variant="ghost" size="sm" icon={<LogOut aria-hidden className="size-4" />} onClick={() => void signOut()}>
              {strings.common.signOut}
            </Button>
          </div>
        </div>
      </header>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
