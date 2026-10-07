import { CheckCheck, ClipboardCheck, ListChecks } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { BulkResultsDialog } from '@/features/passes/BulkResultsDialog'
import { isBulkSelectable, useBulkSelection } from '@/features/passes/bulk'
import { PassCard } from '@/features/passes/PassCard'
import { useDecisions } from '@/features/passes/useDecisions'
import { QUEUE_LIMIT, usePassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import type { BulkItemResult, PassStatus, PassWithId } from '@/types/passes'

const t = strings.supervisor.approvals
const a = strings.approvals

type Tab = 'pending' | 'approved' | 'rejected'
const TABS: readonly Tab[] = ['pending', 'approved', 'rejected']
const isTab = (v: string | null): v is Tab => v === 'pending' || v === 'approved' || v === 'rejected'

const STATUSES: Record<Tab, PassStatus[]> = {
  pending: ['submitted'],
  // Passes this supervisor approved today stay listed while they move on to the officer and the gate.
  approved: ['supervisor_approved', 'officer_approved', 'checked_in'],
  rejected: ['rejected'],
}

/** The line shown under an Approved/Rejected card. */
const noteFor = (tab: Tab, p: PassWithId): string | undefined =>
  tab === 'approved' ? a.status[p.status === 'supervisor_approved' ? 'supervisor_approved' : p.status] : tab === 'rejected' ? p.rejection?.reason : undefined

export default function ApprovalsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'pending'
  const today = useToday()
  const now = useNow()
  const decisions = useDecisions()

  const enabled = today !== null
  const day = today ? { dateKey: today } : {}
  // Pending is also what the nav badge counts, so it is always on and shared; the other tabs load when opened.
  const pending = usePassQueue({ scope: 'supervisor', status: STATUSES.pending, ...day, enabled })
  const approved = usePassQueue({ scope: 'supervisor', status: STATUSES.approved, ...day, enabled: enabled && tab === 'approved' })
  const rejected = usePassQueue({ scope: 'supervisor', status: STATUSES.rejected, ...day, enabled: enabled && tab === 'rejected' })
  const queue = { pending, approved, rejected }[tab]

  const visible = useMemo(() => queue.items.filter((p) => !decisions.isHidden(p)), [queue.items, decisions])
  const pendingVisible = useMemo(() => pending.items.filter((p) => !decisions.isHidden(p)), [pending.items, decisions])
  const sel = useBulkSelection(pendingVisible, today)

  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ results: BulkItemResult[]; passes: PassWithId[] } | null>(null)

  // Select mode only exists on the Pending tab.
  useEffect(() => {
    if (tab !== 'pending' && sel.active) sel.exit()
  }, [tab, sel])

  const setTab = (next: Tab) => setParams(next === 'pending' ? {} : { tab: next }, { replace: true })
  const open = (p: PassWithId) => void navigate(`/supervisor/approvals/${p.id}`)

  const runBulk = async () => {
    setSending(true)
    const passes = sel.chosen
    const res = await decisions.approveMany(passes)
    setSending(false)
    setConfirming(false)
    if (res) {
      setResults({ results: res, passes })
      sel.clear()
      if (res.every((r) => r.ok)) sel.exit()
    }
  }

  const selectingNow = sel.active && tab === 'pending'
  const selectableCount = today ? pendingVisible.filter((p) => isBulkSelectable(p, today)).length : 0

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        {tab === 'pending' && pendingVisible.length > 0 && (
          <Button
            variant={selectingNow ? 'secondary' : 'primary'}
            className="h-12 px-5 text-base"
            icon={<ListChecks aria-hidden className="size-5" />}
            onClick={selectingNow ? sel.exit : sel.enter}
          >
            {selectingNow ? a.bulk.done : a.bulk.select}
          </Button>
        )}
      </div>

      <div role="tablist" aria-label={t.tabsLabel} className="grid grid-cols-3 gap-1 rounded-xl bg-slate-200 p-1">
        {TABS.map((id) => (
          <button
            key={id}
            role="tab"
            id={`tab-${id}`}
            aria-selected={tab === id}
            aria-controls="approvals-panel"
            onClick={() => setTab(id)}
            className={cn(
              'flex h-12 items-center justify-center gap-2 rounded-lg text-base font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700 hover:bg-slate-100',
            )}
          >
            {t.tabs[id]}
            {id === 'pending' && pendingVisible.length > 0 && (
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{pendingVisible.length >= QUEUE_LIMIT ? `${QUEUE_LIMIT - 1}+` : pendingVisible.length}</span>
            )}
          </button>
        ))}
      </div>

      <div id="approvals-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="space-y-3">
        {queue.isError && queue.items.length === 0 ? (
          <ErrorState message={a.queue.loadFailed} onRetry={queue.retry} />
        ) : queue.isLoading || !today ? (
          <div role="status" aria-busy="true" className="space-y-3">
            <span className="sr-only">{strings.common.loading}</span>
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-full rounded-2xl" />)}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={tab === 'pending' ? <CheckCheck aria-hidden /> : <ClipboardCheck aria-hidden />}
            title={{ pending: t.pendingEmptyTitle, approved: t.approvedEmptyTitle, rejected: t.rejectedEmptyTitle }[tab]}
            body={{ pending: t.pendingEmptyBody, approved: t.approvedEmptyBody, rejected: t.rejectedEmptyBody }[tab]}
          />
        ) : (
          <>
            {queue.isError && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{a.queue.loadFailed}</p>}
            <ul className="space-y-3">
              {visible.map((p) => {
                const pickable = today !== null && isBulkSelectable(p, today)
                const note = noteFor(tab, p)
                return (
                  <li key={p.id}>
                    <PassCard
                      pass={p}
                      now={now}
                      mode={selectingNow ? 'select' : 'open'}
                      selectable={pickable}
                      selected={sel.selected.has(p.id)}
                      {...(note ? { note } : {})}
                      onOpen={() => open(p)}
                      onToggle={() => sel.toggle(p)}
                    />
                  </li>
                )
              })}
            </ul>
            {queue.capped && <p role="status" className="text-center text-sm text-slate-600">{a.queue.capNotice}</p>}
          </>
        )}
      </div>

      {selectingNow && (
        <div className="fixed inset-x-0 bottom-16 z-20 border-t border-slate-300 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <p aria-live="polite" className="flex-1 text-base font-semibold">{a.bulk.selectedCount(sel.selected.size)}</p>
            {sel.selected.size > 0 ? (
              <Button variant="secondary" className="h-14 px-4 text-base" onClick={sel.clear}>{a.bulk.clear}</Button>
            ) : (
              selectableCount > 0 && <Button variant="secondary" className="h-14 px-4 text-base" onClick={sel.selectAll}>{`${strings.common.all} (${selectableCount})`}</Button>
            )}
            <Button
              className="h-14 bg-emerald-700 px-6 text-lg font-bold hover:bg-emerald-800"
              disabled={sel.selected.size === 0}
              onClick={() => setConfirming(true)}
            >
              {a.bulk.approveN(sel.selected.size)}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={a.bulk.confirmTitle(sel.selected.size)}
        body={a.bulk.confirmBody}
        confirmLabel={a.bulk.approveN(sel.selected.size)}
        loading={sending}
        onConfirm={() => void runBulk()}
        onCancel={() => !sending && setConfirming(false)}
      />
      <BulkResultsDialog results={results?.results ?? null} passes={results?.passes ?? []} onClose={() => setResults(null)} />
    </div>
  )
}
