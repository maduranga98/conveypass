import { CheckCircle2, ClipboardCheck, Clock, Truck, Users, XCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { timeAgo, toMs } from '@/features/passes/passView'
import { QUEUE_LIMIT, usePassQueue, type PassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import { useDrivers, useVehicles } from '@/features/shared/queries'
import { isOverdue, oldestFirst, TAB_STATUSES } from './queue'
import { useSupervisorTarget } from './useSupervisorTarget'

const t = strings.supervisor

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

function Tile({ to, icon, label, value }: { to: string; icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Link to={to} className={cn('flex flex-col gap-3 rounded-xl border border-slate-200 bg-surface p-4 hover:border-slate-300', focusRing)}>
      <span className="text-slate-500 [&>svg]:size-5">{icon}</span>
      <span className="text-3xl font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="text-sm text-slate-500">{label}</span>
    </Link>
  )
}

/** A live count from a pass listener: skeleton while loading, a dash on error, `99+` at the listener cap. */
const queueCount = (q: PassQueue): ReactNode =>
  q.isLoading && q.items.length === 0 ? <Skeleton className="h-9 w-12" /> : q.isError && q.items.length === 0 ? strings.common.none : q.items.length >= QUEUE_LIMIT ? `${QUEUE_LIMIT - 1}+` : q.items.length

const actionClass = cn('inline-flex h-11 w-full items-center sm:w-auto sm:flex-1 justify-center rounded-lg px-4 text-sm font-medium', focusRing)

export default function SupervisorHome() {
  const { profile } = useSession()
  const today = useToday()
  const now = useNow()
  const target = useSupervisorTarget()
  const day = today ? { dateKey: today } : {}
  const enabled = today !== null
  // The same listeners as the Approvals tabs (and the nav badge), so the numbers always agree.
  const pending = usePassQueue({ scope: 'supervisor', status: TAB_STATUSES.pending, ...day, enabled })
  const approved = usePassQueue({ scope: 'supervisor', status: TAB_STATUSES.approved, ...day, enabled })
  const rejected = usePassQueue({ scope: 'supervisor', status: TAB_STATUSES.rejected, ...day, enabled })
  const vehicles = useVehicles('supervisor')
  const drivers = useDrivers('supervisor')
  const listCount = (q: { isPending: boolean; isError: boolean; data?: { items: unknown[] } }): ReactNode =>
    q.isPending ? <Skeleton className="h-9 w-12" /> : q.isError ? strings.common.none : q.data?.items.length

  const loading = !enabled || (pending.isLoading && pending.items.length === 0)
  const waiting = oldestFirst(pending.items)
  const oldest = waiting[0]
  const overdue = waiting.filter((p) => isOverdue(p, now, target)).length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.home.welcome(profile.name)}</h1>

      <section
        aria-label={t.approvalsTitle}
        className={cn('space-y-4 rounded-2xl border-2 bg-surface p-4', overdue > 0 ? 'border-accent' : 'border-slate-300')}
      >
        <div className="flex items-center gap-3">
          <ClipboardCheck aria-hidden className="size-7 shrink-0 text-brand" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{t.homePendingTitle}</h2>
            <p aria-live="polite" className="text-sm text-slate-700">
              {loading ? strings.common.loading : t.homePending(waiting.length)}
            </p>
          </div>
          <span className="text-4xl font-extrabold tabular-nums tracking-tight">{loading ? strings.common.none : queueCount(pending)}</span>
        </div>

        {!loading && oldest && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 text-slate-700">
              <Clock aria-hidden className="size-4" />
              {t.homeOldest(timeAgo(toMs(oldest.submittedAt), now).toLowerCase())}
            </span>
            {overdue > 0 && (
              <span className="rounded-full bg-accent px-2.5 py-0.5 font-bold text-brand">{t.homeOverdue(overdue)}</span>
            )}
          </div>
        )}

        <Link
          to={oldest ? `/supervisor/approvals/${oldest.id}` : '/supervisor/approvals'}
          className={cn('flex h-14 items-center justify-center rounded-xl bg-brand text-lg font-bold text-on-solid hover:bg-brand-hover', focusRing)}
        >
          {oldest ? t.reviewNow : t.openApprovals}
        </Link>
      </section>

      <section aria-labelledby="sup-today" className="space-y-3">
        <h2 id="sup-today" className="text-base font-semibold">{t.todayTitle}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Tile to="/supervisor/approvals?tab=approved" icon={<CheckCircle2 aria-hidden className="text-success-strong" />} label={t.approvedToday} value={queueCount(approved)} />
          <Tile to="/supervisor/approvals?tab=rejected" icon={<XCircle aria-hidden className="text-danger-strong" />} label={t.rejectedToday} value={queueCount(rejected)} />
        </div>
      </section>

      <section aria-labelledby="sup-fleet" className="space-y-3">
        <h2 id="sup-fleet" className="text-base font-semibold">{t.fleetTitle}</h2>
        <div className="grid grid-cols-2 gap-3">
          <Tile to="/supervisor/vehicles" icon={<Truck aria-hidden />} label={t.vehicles} value={listCount(vehicles)} />
          <Tile to="/supervisor/drivers" icon={<Users aria-hidden />} label={t.drivers} value={listCount(drivers)} />
        </div>
        <div aria-label={t.quickActions} role="group" className="flex flex-col gap-2 sm:flex-row">
          <Link to="/supervisor/vehicles?new=1" className={cn(actionClass, 'bg-brand text-on-solid hover:bg-brand-hover')}>
            {strings.vehicles.add}
          </Link>
          <Link to="/supervisor/drivers?new=1" className={cn(actionClass, 'border border-slate-300 bg-surface hover:bg-slate-50')}>
            {strings.drivers.add}
          </Link>
        </div>
      </section>
    </div>
  )
}
