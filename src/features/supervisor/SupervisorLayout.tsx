import { Home, LogOut, QrCode, Truck, Users } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { useContractorList } from '@/features/shared/queries'

const nav = [
  { to: '/supervisor', label: strings.supervisor.nav.home, icon: Home, end: true },
  { to: '/supervisor/vehicles', label: strings.supervisor.nav.vehicles, icon: Truck, end: false },
  { to: '/supervisor/drivers', label: strings.supervisor.nav.drivers, icon: Users, end: false },
  { to: '/supervisor/qr', label: strings.supervisor.nav.qr, icon: QrCode, end: false },
] as const

/** Mobile-first shell: slim top bar, content, fixed bottom navigation. */
export default function SupervisorLayout() {
  const { profile, claims } = useSession()
  const { signOut } = useAuth()
  const contractors = useContractorList('supervisor')

  return (
    <div className="min-h-dvh pb-20 print:pb-0">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">{contractors.data?.[0]?.name ?? strings.app.name}</p>
            <p className="truncate text-xs text-slate-500">{profile.name}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label={strings.common.signOut} title={strings.common.signOut} onClick={() => void signOut()}>
            <LogOut aria-hidden className="size-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:p-0">
        {claims.contractorId ? (
          <Outlet />
        ) : (
          <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            {strings.supervisor.noContractor}
          </p>
        )}
      </main>

      <nav aria-label={strings.supervisor.mainNav} className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] print:hidden">
        <ul className="mx-auto grid max-w-5xl grid-cols-4">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                    isActive ? 'text-accent' : 'text-slate-500 hover:text-slate-900',
                  )
                }
              >
                <Icon aria-hidden className="size-5" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
