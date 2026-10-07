import { LogOut } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { usePendingCount } from '@/features/passes/usePendingCount'
import { usePendingTitle } from '@/features/passes/usePendingTitle'

const NAV = [
  { to: '/officer', label: strings.officer.nav.queue, end: true },
  { to: '/officer/overview', label: strings.officer.nav.overview, end: false },
  { to: '/officer/reports', label: strings.officer.nav.reports, end: false },
]

/** Desktop-first shell: a slim top bar (name, sign out) over the queue. */
export default function OfficerLayout() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  const { count } = usePendingCount('officer')
  usePendingTitle(count)

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-300 bg-white print:hidden">
        <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-6">
            <p className="hidden text-base font-semibold tracking-tight sm:block">{strings.officer.topBar}</p>
            <nav aria-label={strings.officer.topBar} className="flex gap-1">
              {NAV.map(({ to, label, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    cn(
                      'flex h-9 items-center rounded-lg px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent',
                      isActive ? 'bg-accent-soft text-accent' : 'text-slate-700 hover:bg-slate-100',
                    )
                  }
                >
                  {label}
                </NavLink>
              ))}
            </nav>
          </div>
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
