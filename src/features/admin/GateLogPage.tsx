import { useQuery } from '@tanstack/react-query'
import { collection, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { DoorOpen } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { useSession } from '@/features/auth/useAuth'
import { formatTime, toMs } from '@/features/passes/passView'
import { useTenant } from '@/features/passes/queries'
import { useToday } from '@/features/passes/useToday'
import { useContractorList } from '@/features/shared/queries'
import { dateKey as dayKey, DEFAULT_TIMEZONE } from '@/lib/dates'
import { DENY_REASONS } from '@/lib/denyReasons'
import { db } from '@/lib/firebase'
import { strings } from '@/lib/strings'
import type { GateEventDoc, PassDoc } from '@/types/passes'
import { dayRange } from './gateLog'

const t = strings.admin.gateLog
const LOG_LIMIT = 500

const toInput = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
const fromInput = (v: string): string => v.replaceAll('-', '')

interface Row {
  id: string
  kind: 'checkIn' | 'denied'
  atMs: number
  plateNo: string
  contractorId: string
  driver: string
  gate: string
  guard: string
  reason: string
  /** Device time of an offline check-in: shown, but marked unverified. */
  offlineAt: string | null
}

const denyLabel = (code: string): string => DENY_REASONS.find((r) => r.id === code)?.label ?? code

/**
 * `/admin/gate-log`: check-ins (passes with a `checkIn` block) and denials (`gateEvents`) for one day in the tenant
 * timezone, merged in time order. Read only; no export in this module.
 */
export default function GateLogPage() {
  const { claims } = useSession()
  const tenant = useTenant(claims.tenantId)
  const today = useToday()
  const contractors = useContractorList('admin')
  const [picked, setPicked] = useState<string | null>(null)
  const tz = tenant.data?.timezone ?? DEFAULT_TIMEZONE
  const day = picked ?? today ?? dayKey(tz)

  const log = useQuery({
    queryKey: ['gateLog', claims.tenantId, day, tz],
    enabled: !tenant.isPending,
    queryFn: async (): Promise<{ rows: Row[]; capped: boolean }> => {
      const { start, end } = dayRange(tz, day)
      const [passes, events] = await Promise.all([
        getDocs(
          query(
            collection(db, 'passes'),
            where('tenantId', '==', claims.tenantId),
            where('dateKey', '==', day),
            where('status', '==', 'checked_in'),
            limit(LOG_LIMIT),
          ),
        ),
        getDocs(
          query(
            collection(db, 'gateEvents'),
            where('tenantId', '==', claims.tenantId),
            where('at', '>=', Timestamp.fromMillis(start)),
            where('at', '<', Timestamp.fromMillis(end)),
            orderBy('at', 'desc'),
            limit(LOG_LIMIT),
          ),
        ),
      ])
      const checkIns: Row[] = passes.docs.flatMap((d) => {
        const p = d.data() as PassDoc
        if (!p.checkIn) return []
        return [{
          id: d.id, kind: 'checkIn' as const, atMs: toMs(p.checkIn.at) ?? 0, plateNo: p.plateNo, contractorId: p.contractorId,
          driver: p.driverName, gate: p.checkIn.gateName, guard: p.checkIn.name, reason: '',
          offlineAt: p.checkIn.offlineCapturedAt ?? null,
        }]
      })
      const denials: Row[] = events.docs.map((d) => {
        const e = d.data() as GateEventDoc
        const status = e.passStatus ? t.passStatus(strings.approvals.status[e.passStatus]) : t.noPass
        return {
          id: d.id, kind: 'denied', atMs: toMs(e.at) ?? 0, plateNo: e.plateNo, contractorId: e.contractorId,
          driver: e.driverName ?? strings.common.none, gate: e.gateName, guard: e.byName,
          reason: `${denyLabel(e.reasonCode)}${e.note ? `: ${e.note}` : ''} · ${status}`, offlineAt: null,
        }
      })
      return {
        rows: [...checkIns, ...denials].sort((a, b) => a.atMs - b.atMs),
        capped: passes.size >= LOG_LIMIT || events.size >= LOG_LIMIT,
      }
    },
  })

  const contractorName = useMemo(() => {
    const names = new Map((contractors.data ?? []).map((c) => [c.id, c.name]))
    return (id: string) => names.get(id) ?? strings.common.none
  }, [contractors.data])

  const field = 'h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent'
  const rows = log.data?.rows ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{t.intro}</p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          {t.date}
          <input type="date" value={toInput(day)} onChange={(e) => e.target.value && setPicked(fromInput(e.target.value))} className={field} />
        </label>
        {log.isSuccess && <p role="status" className="pb-2 text-sm text-slate-600">{t.count(rows.length)}</p>}
      </div>

      {log.isError ? (
        <ErrorState message={t.loadFailed} onRetry={() => void log.refetch()} />
      ) : log.isPending ? (
        <ListSkeleton rows={5} />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<DoorOpen aria-hidden />} title={t.emptyTitle} body={t.emptyBody} />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-600 uppercase">
              <tr>
                {(['time', 'type', 'plate', 'contractor', 'driver', 'gate', 'guard', 'reason'] as const).map((c) => (
                  <th key={c} scope="col" className="px-4 py-3">{t.columns[c]}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {formatTime(r.atMs)}
                    {r.offlineAt && <p className="text-xs text-amber-800">{t.offline(formatTime(Date.parse(r.offlineAt)))}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={r.kind === 'checkIn' ? 'success' : 'danger'}>{r.kind === 'checkIn' ? t.checkIn : t.denied}</Badge>
                  </td>
                  <td className="px-4 py-3 font-bold tracking-tight">{r.plateNo}</td>
                  <td className="px-4 py-3">{contractorName(r.contractorId)}</td>
                  <td className="px-4 py-3">{r.driver}</td>
                  <td className="px-4 py-3">{r.gate}</td>
                  <td className="px-4 py-3">{r.guard}</td>
                  <td className="px-4 py-3 text-slate-700">{r.reason || strings.common.none}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.data?.capped && <p role="status" className="text-sm text-slate-600">{t.capNotice}</p>}
    </div>
  )
}
