import { ClipboardCheck, Home, LogOut, QrCode, Truck, Users } from 'lucide-react'
import { NavLink, Outlet, useMatch } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { usePendingCount } from '@/features/passes/usePendingCount'
import { Bell } from '@/features/notifications/Bell'
import { PushOptInCard } from '@/features/notifications/PushOptInCard'
import { useContractorList } from '@/features/shared/queries'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const nav = [
  { to: '/supervisor', label: strings.supervisor.nav.home, icon: Home, end: true },
  { to: '/supervisor/approvals', label: strings.supervisor.nav.approvals, icon: ClipboardCheck, end: false },
  { to: '/supervisor/vehicles', label: strings.supervisor.nav.vehicles, icon: Truck, end: false },
  { to: '/supervisor/drivers', label: strings.supervisor.nav.drivers, icon: Users, end: false },
  { to: '/supervisor/qr', label: strings.supervisor.nav.qr, icon: QrCode, end: false },
] as const

/** Mobile-first shell: slim top bar, content, fixed bottom navigation. */
export default function SupervisorLayout() {
  const { profile, claims } = useSession()
  const { signOut } = useAuth()
  const contractors = useContractorList('supervisor')
  const { count } = usePendingCount('supervisor')
  // The review screen has its own sticky Approve/Reject bar where the bottom navigation would be.
  const reviewing = useMatch('/supervisor/approvals/:passId') !== null

  return (
    <div className={cn('min-h-dvh print:pb-0', reviewing ? 'pb-0' : 'pb-20')}>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-surface print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">{contractors.data?.[0]?.name ?? strings.app.name}</p>
            <p className="truncate text-xs text-slate-500">{profile.name}</p>
          </div>
          <div className="flex items-center">
            <Bell />
            <Button variant="ghost" size="icon" className="size-11" aria-label={strings.common.signOut} title={strings.common.signOut} onClick={() => void signOut()}>
              <LogOut aria-hidden className="size-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:p-0">
        {/* Not while reviewing: the pass itself has to be the first thing on screen. */}
        {!reviewing && <div className="pb-4 empty:hidden print:hidden"><PushOptInCard /></div>}
        {claims.contractorId ? (
          <Outlet />
        ) : (
          <NotificationBanner tone="warning" role="alert">{strings.supervisor.noContractor}</NotificationBanner>
        )}
      </main>

      {!reviewing && <nav aria-label={strings.supervisor.mainNav} className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-surface pb-[env(safe-area-inset-bottom)] print:hidden">
        <ul className="mx-auto grid max-w-5xl grid-cols-5">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                    isActive ? 'text-brand' : 'text-slate-500 hover:text-brand',
                  )
                }
              >
                <span className="relative">
                  <Icon aria-hidden className="size-5" />
                  {to === '/supervisor/approvals' && count !== null && count > 0 && (
                    <span
                      aria-label={strings.supervisor.homePending(count)}
                      className="absolute -right-3 -top-2 grid min-w-5 place-items-center rounded-full bg-danger-strong px-1 text-[11px] font-bold leading-5 text-on-solid"
                    >
                      {count >= 100 ? '99+' : count}
                    </span>
                  )}
                </span>
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>}
    </div>
  )
}
