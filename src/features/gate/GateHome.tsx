import { CircleCheckBig, CloudUpload, LogIn, RefreshCw, ScanLine, Search } from 'lucide-react'
import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { useOnline } from '@/features/passes/useOnline'
import { useNow, useToday } from '@/features/passes/useToday'
import { useContractorList, useVehicles } from '@/features/shared/queries'
import { cn } from '@/lib/cn'
import { plateSearchKey } from '@/lib/plate'
import { strings } from '@/lib/strings'
import type { Vehicle, WithId } from '@/types'
import type { PassWithId } from '@/types/passes'
import { OfflineBanner } from './GateBanners'
import { pendingPassIds, useOfflineQueue } from './gateQueue'
import { MIN_SEARCH, searchPlates } from './plateSearch'
import { usePlatePrefixSearch, usePrefetchPassPeople, useTodayGatePasses } from './queries'

const t = strings.gate
const STALE_MS = 60_000

// The camera library is large: load it on its own, but start fetching it as soon as the gate opens (while online),
// so the scanner still opens if the connection drops later in the shift.
const loadScanner = () => import('./QrScanner').then((m) => ({ default: m.QrScanner }))
const QrScanner = lazy(loadScanner)

const hhmm = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : strings.common.none

type Chip = 'approved' | 'checked_in' | 'none' | 'pending'

function StatusChip({ chip }: { chip: Chip }) {
  const label = chip === 'pending' ? t.pendingSync : t.chip[chip]
  const Icon = chip === 'approved' ? CircleCheckBig : chip === 'checked_in' ? LogIn : chip === 'pending' ? CloudUpload : null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-sm font-extrabold',
        chip === 'approved' && 'bg-emerald-700 text-white',
        chip === 'checked_in' && 'bg-slate-200 text-slate-900',
        chip === 'pending' && 'bg-amber-300 text-slate-950',
        chip === 'none' && 'border-2 border-red-700 text-red-800',
      )}
    >
      {Icon && <Icon aria-hidden className="size-4" />}
      {label}
    </span>
  )
}

function Card({ to, plateNo, sub, line, chip }: { to: string; plateNo: string; sub: string; line?: string; chip: Chip }) {
  return (
    <li>
      <Link
        to={to}
        state={{ from: 'list' }}
        className="flex min-h-16 items-center gap-3 rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 hover:border-slate-400 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="min-w-0 flex-1">
          <p className="text-2xl leading-tight font-black tracking-tight text-slate-950">{plateNo}</p>
          <p className="text-sm font-semibold text-slate-700">{sub}</p>
          {line && <p className="text-sm text-slate-700">{line}</p>}
        </div>
        <StatusChip chip={chip} />
      </Link>
    </li>
  )
}

/** `/security`: scan, search by plate, and today's live lists. Prefetches what the gate needs to work offline. */
export default function GateHome() {
  const { uid } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const online = useOnline()
  const now = useNow(5_000)
  const today = useToday()
  const searchId = useId()

  useEffect(() => {
    void loadScanner().catch(() => undefined)
  }, [])

  const [scanning, setScanning] = useState(() => Boolean((location.state as { scan?: boolean } | null)?.scan))
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<'awaiting' | 'checkedIn'>('awaiting')

  // Prefetch: vehicles (whole tenant), contractors, today's passes and the people on them, the tenant (useToday).
  const passes = useTodayGatePasses(today)
  usePrefetchPassPeople(passes.items)
  const vehicles = useVehicles('admin') // tenant-wide; the rules allow security to read it
  const contractors = useContractorList('admin')
  const queued = useOfflineQueue(uid)
  const pending = useMemo(() => pendingPassIds(queued), [queued])

  const contractorName = (id: string) => contractors.data?.find((c) => c.id === id)?.name ?? strings.common.none
  const byVehicle = useMemo(() => new Map(passes.items.map((p) => [p.vehicleId, p])), [passes.items])
  const chipFor = (vehicleId: string): Chip => {
    const p = byVehicle.get(vehicleId)
    if (p && pending.has(p.id)) return 'pending'
    return p?.status === 'officer_approved' ? 'approved' : p?.status === 'checked_in' ? 'checked_in' : 'none'
  }

  // Search: the cached list by "contains"; a fleet over the list cap falls back to a server prefix query.
  const key = plateSearchKey(q)
  const large = vehicles.data?.capped ?? false
  const prefix = usePlatePrefixSearch(key, large)
  const matches: WithId<Vehicle>[] = large ? (prefix.data ?? []) : searchPlates(vehicles.data?.items ?? [], q)

  const awaiting = passes.items
    .filter((p) => p.status === 'officer_approved')
    .sort((a, b) => (b.officer?.at?.toMillis() ?? 0) - (a.officer?.at?.toMillis() ?? 0))
  const checkedIn = passes.items
    .filter((p) => p.status === 'checked_in')
    .sort((a, b) => (b.checkIn?.at?.toMillis() ?? 0) - (a.checkIn?.at?.toMillis() ?? 0))
  const shown: PassWithId[] = tab === 'awaiting' ? awaiting : checkedIn

  const stale = online && passes.cacheSince !== null && now - passes.cacheSince > STALE_MS

  const closeScanner = () => {
    setScanning(false)
    void navigate('.', { replace: true, state: null })
  }

  return (
    <>
      <OfflineBanner offline={!online} stale={stale} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-4">
        <button
          type="button"
          onClick={() => setScanning(true)}
          className="flex h-24 w-full items-center justify-center gap-4 rounded-3xl bg-slate-900 text-3xl font-black tracking-tight text-white shadow-sm hover:bg-slate-800 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ScanLine aria-hidden className="size-10" />
          {t.scan}
        </button>

        <section className="space-y-2">
          <label htmlFor={searchId} className="text-base font-bold text-slate-900">{t.searchLabel}</label>
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-6 -translate-y-1/2 text-slate-500" />
            <input
              id={searchId}
              type="search"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t.searchPlaceholder}
              className="h-16 w-full rounded-2xl border-2 border-slate-300 bg-white pr-4 pl-13 text-2xl font-bold tracking-wide uppercase placeholder:text-base placeholder:font-medium placeholder:tracking-normal placeholder:normal-case focus-visible:border-slate-900 focus-visible:outline-none"
            />
          </div>
          {large && <p className="text-sm text-slate-700">{t.searchLarge}</p>}
          {key.length > 0 && key.length < MIN_SEARCH && <p className="text-sm text-slate-700">{t.searchHint}</p>}
          {key.length >= MIN_SEARCH && (
            <div aria-live="polite">
              {large && prefix.isError ? (
                <p role="alert" className="text-sm font-semibold text-red-800">{t.searchFailed}</p>
              ) : matches.length === 0 && !(large && prefix.isPending) && !vehicles.isPending ? (
                <p className="rounded-xl bg-slate-100 px-4 py-3 text-base font-semibold text-slate-800">{t.searchNone}</p>
              ) : (
                <ul className="space-y-2">
                  {matches.map((v) => (
                    <Card key={v.id} to={`/v/${v.id}`} plateNo={v.plateNo} sub={`${v.type} · ${contractorName(v.contractorId)}`} chip={chipFor(v.id)} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section aria-label={t.tabsLabel} className="space-y-3">
          <div role="tablist" aria-label={t.tabsLabel} className="grid grid-cols-2 gap-2">
            {(['awaiting', 'checkedIn'] as const).map((id) => {
              const count = id === 'awaiting' ? awaiting.length : checkedIn.length
              return (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={tab === id}
                  aria-controls="gate-list"
                  onClick={() => setTab(id)}
                  className={cn(
                    'flex h-14 items-center justify-center gap-2 rounded-xl border-2 text-base font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                    tab === id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-900',
                  )}
                >
                  {t.tabs[id]}
                  <span className={cn('rounded-full px-2 text-sm', tab === id ? 'bg-white text-slate-900' : 'bg-slate-200')}>{count}</span>
                </button>
              )
            })}
          </div>

          <p className="flex items-center gap-1.5 text-sm text-slate-700">
            <RefreshCw aria-hidden className="size-4" />
            {passes.lastSyncedAt ? t.lastSynced(hhmm(passes.lastSyncedAt)) : t.notSyncedYet}
          </p>

          <div id="gate-list" role="tabpanel">
            {passes.status === 'error' && passes.items.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <EmptyState
                  title={t.listFailed}
                  action={<button type="button" onClick={passes.retry} className="h-12 rounded-xl border-2 border-slate-300 px-4 font-bold">{strings.common.retry}</button>}
                />
              </div>
            ) : passes.status === 'loading' ? (
              <ListSkeleton rows={3} />
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white">
                <EmptyState
                  title={tab === 'awaiting' ? t.emptyAwaiting : t.emptyCheckedIn}
                  body={tab === 'awaiting' ? t.emptyAwaitingBody : t.emptyCheckedInBody}
                />
              </div>
            ) : (
              <ul className="space-y-2">
                {shown.map((p) => (
                  <Card
                    key={p.id}
                    to={`/v/${p.vehicleId}`}
                    plateNo={p.plateNo}
                    sub={`${p.vehicleType} · ${contractorName(p.contractorId)}`}
                    line={`${p.driverName} · ${
                      p.status === 'checked_in'
                        ? t.checkedInAt(hhmm(p.checkIn?.at?.toMillis()), p.checkIn?.gateName ?? '')
                        : t.approvedAt(hhmm(p.officer?.at?.toMillis()))
                    }`}
                    chip={pending.has(p.id) ? 'pending' : p.status === 'checked_in' ? 'checked_in' : 'approved'}
                  />
                ))}
              </ul>
            )}
            {passes.capped && <p role="status" className="mt-2 text-sm text-slate-700">{t.capNotice}</p>}
          </div>
        </section>
      </div>

      {scanning && (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-black text-lg font-semibold text-white">{t.scanner.starting}</div>}>
          <QrScanner
            onClose={closeScanner}
            onVehicle={(id) => void navigate(`/v/${id}`, { replace: false, state: { from: 'scan' } })}
          />
        </Suspense>
      )}
    </>
  )
}
