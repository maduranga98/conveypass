import { ClipboardCheck, Truck, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { usePendingCount } from '@/features/passes/usePendingCount'
import { useDrivers, useVehicles } from '@/features/shared/queries'

const t = strings.supervisor

function Tile({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="text-slate-400 [&>svg]:size-5">{icon}</span>
      <span className="text-3xl font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="text-sm text-slate-500">{label}</span>
    </Link>
  )
}

const actionClass =
  'inline-flex h-11 flex-1 items-center justify-center rounded-lg px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

export default function SupervisorHome() {
  const { profile } = useSession()
  const { count: pendingCount } = usePendingCount('supervisor')
  const vehicles = useVehicles('supervisor')
  const drivers = useDrivers('supervisor')
  const count = (q: { isPending: boolean; isError: boolean; data?: { items: unknown[] } }): ReactNode =>
    q.isPending ? <Skeleton className="h-9 w-12" /> : q.isError ? strings.common.none : q.data?.items.length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.home.welcome(profile.name)}</h1>

      <section className="grid grid-cols-2 gap-3" aria-label={strings.admin.nav.vehicles}>
        <Tile to="/supervisor/vehicles" icon={<Truck aria-hidden />} label={t.vehicles} value={count(vehicles)} />
        <Tile to="/supervisor/drivers" icon={<Users aria-hidden />} label={t.drivers} value={count(drivers)} />
      </section>

      <section aria-label={t.quickActions} className="flex flex-col gap-2 sm:flex-row">
        <Link to="/supervisor/vehicles?new=1" className={`${actionClass} bg-accent text-white hover:bg-accent-hover`}>
          {strings.vehicles.add}
        </Link>
        <Link to="/supervisor/drivers?new=1" className={`${actionClass} border border-slate-300 bg-white hover:bg-slate-50`}>
          {strings.drivers.add}
        </Link>
      </section>

      <section aria-label={t.approvalsTitle} className="space-y-3 rounded-2xl border-2 border-slate-300 bg-white p-4">
        <div className="flex items-center gap-3">
          <ClipboardCheck aria-hidden className="size-7 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t.homePendingTitle}</h2>
            <p aria-live="polite" className="text-sm text-slate-700">
              {pendingCount === null ? strings.common.loading : t.homePending(pendingCount)}
            </p>
          </div>
          <span className="text-4xl font-extrabold tabular-nums tracking-tight">{pendingCount ?? strings.common.none}</span>
        </div>
        <Link to="/supervisor/approvals" className="flex h-14 items-center justify-center rounded-xl bg-accent text-lg font-bold text-white hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          {t.openApprovals}
        </Link>
      </section>
    </div>
  )
}
