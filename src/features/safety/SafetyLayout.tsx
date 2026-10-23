import { ClipboardCheck, ListChecks, LogOut, RotateCcw, ShieldPlus, UserRound } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { Bell } from '@/features/notifications/Bell'
import { useReinspectionVehicles } from '@/features/inspections/queries'

const t = strings.safety

const iconButton =
  'inline-flex size-11 items-center justify-center rounded-lg hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid'

const nav = [
  { to: '/safety', label: t.nav.penalties, icon: ListChecks, end: true },
  { to: '/safety/penalties/new', label: t.nav.issue, icon: ShieldPlus, end: false },
  { to: '/safety/inspections/new', label: t.nav.inspect, icon: ClipboardCheck, end: false },
  { to: '/safety/reinspection', label: t.nav.reinspection, icon: RotateCcw, end: false },
] as const

/** Safety Officer shell: navy top bar with the penalty screens and the inspection screens (record, re-inspection list). Single column. */
export default function SafetyLayout() {
  const { profile } = useSession()
  const { signOut } = useAuth()
  const reinspection = useReinspectionVehicles()
  const waiting = reinspection.data?.length ?? 0
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 bg-brand text-on-solid print:hidden">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <BrandMark className="size-9 bg-surface" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold tracking-tight">{strings.app.name}</p>
            <p className="truncate text-xs text-slate-300">{profile.name}</p>
          </div>
          <Bell tone="dark" />
          <Link to="/settings" aria-label={t.account} title={t.account} className={cn(iconButton)}>
            <UserRound aria-hidden className="size-5" />
          </Link>
          <button type="button" aria-label={strings.common.signOut} title={strings.common.signOut} onClick={() => void signOut()} className={iconButton}>
            <LogOut aria-hidden className="size-5" />
          </button>
        </div>
        <nav aria-label={t.role} className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 pb-2">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-solid',
                  isActive ? 'bg-accent text-brand' : 'text-slate-300 hover:bg-brand-hover hover:text-on-solid',
                )
              }
            >
              <Icon aria-hidden className="size-5" />
              {label}
              {to === '/safety/reinspection' && waiting > 0 && (
                <span className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-bold text-brand">
                  {waiting}
                  <span className="sr-only"> {strings.inspections.list.count(waiting)}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
