import { ChevronRight, LogOut, ScanLine } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import { useAuth, useSession } from '@/features/auth/useAuth'
import type { PassStatus } from '@/types/passes'
import { RECENT_PASSES, todayKey, useMyPasses, useMyVehicles, useTenant } from './queries'

const t = strings.driverHome

const TONE: Record<PassStatus | 'none', 'neutral' | 'accent' | 'success' | 'danger'> = {
  none: 'neutral',
  submitted: 'accent',
  supervisor_approved: 'accent',
  officer_approved: 'success',
  checked_in: 'success',
  rejected: 'danger',
}

const Chip = ({ status }: { status: PassStatus | 'none' }) => <Badge tone={TONE[status]}>{t.chips[status]}</Badge>

const day = (dateKey: string): string =>
  new Date(Number(dateKey.slice(0, 4)), Number(dateKey.slice(4, 6)) - 1, Number(dateKey.slice(6, 8))).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function DriverHome() {
  const { claims, uid, profile } = useSession()
  const { signOut } = useAuth()
  const tenant = useTenant(claims.tenantId)
  const vehicles = useMyVehicles(claims.tenantId, uid)
  const passes = useMyPasses(claims.tenantId, uid)
  const today = todayKey(tenant.data)

  const todayPass = (vehicleId: string) => passes.data?.find((p) => p.vehicleId === vehicleId && p.dateKey === today)

  return (
    <div className="mx-auto min-h-dvh max-w-md space-y-6 px-4 py-6">
      <header className="flex items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{strings.home.welcome(profile.name)}</h1>
        <Button variant="ghost" size="icon" className="size-12" aria-label={strings.common.signOut} title={strings.common.signOut} onClick={() => void signOut()}>
          <LogOut aria-hidden className="size-5" />
        </Button>
      </header>

      <section aria-labelledby="how-h" className="flex items-start gap-3 rounded-2xl border border-slate-300 bg-white p-4">
        <ScanLine aria-hidden className="mt-0.5 size-6 shrink-0 text-accent" />
        <div>
          <h2 id="how-h" className="font-semibold">{t.howTitle}</h2>
          <p className="text-base text-slate-700">{t.howBody}</p>
        </div>
      </section>

      <section aria-labelledby="veh-h" className="space-y-3">
        <h2 id="veh-h" className="text-lg font-bold">{t.vehiclesTitle}</h2>
        {vehicles.isPending || passes.isPending ? (
          <div role="status" className="space-y-3">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        ) : vehicles.isError || passes.isError ? (
          <ErrorState message={t.loadFailed} onRetry={() => { void vehicles.refetch(); void passes.refetch() }} />
        ) : vehicles.data.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-400 p-6 text-center text-slate-700">{t.vehiclesEmpty}</p>
        ) : (
          <ul className="space-y-3">
            {vehicles.data.map((v) => {
              const pass = todayPass(v.id)
              const status = pass?.status ?? 'none'
              const body = (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="text-xl font-bold tracking-tight">{v.plateNo}</p>
                    <p className="text-sm text-slate-600">{v.type}</p>
                    {status === 'rejected' && <p className="mt-1 text-sm font-semibold text-red-700">{t.fixNow}</p>}
                  </div>
                  <Chip status={status} />
                  {status === 'rejected' && <ChevronRight aria-hidden className="size-5 text-slate-500" />}
                </>
              )
              // Scanning is the way in. Only a rejected pass opens the vehicle page from here, to fix and resubmit.
              return (
                <li key={v.id}>
                  {status === 'rejected' ? (
                    <Link to={`/v/${v.id}`} className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-red-700 bg-white p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-slate-300 bg-white p-4">{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="rec-h" className="space-y-3">
        <h2 id="rec-h" className="text-lg font-bold">{t.recentTitle}</h2>
        {passes.isPending ? (
          <Skeleton className="h-16 w-full rounded-2xl" />
        ) : passes.isError ? null : passes.data.length === 0 ? (
          <p className="text-slate-600">{t.recentEmpty}</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-300 bg-white">
            {passes.data.slice(0, RECENT_PASSES).map((p) => (
              <li key={p.id} className="flex min-h-14 items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{p.plateNo}</p>
                  <p className="text-sm text-slate-600">{day(p.dateKey)} · {t.attempt(p.attempt)}</p>
                </div>
                <Chip status={p.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
