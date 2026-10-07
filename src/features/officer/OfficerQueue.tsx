import { CheckCheck, Inbox } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { BulkResultsDialog } from '@/features/passes/BulkResultsDialog'
import { isBulkSelectable, useBulkSelection } from '@/features/passes/bulk'
import { useRejectionReasons } from '@/features/passes/queries'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useDecisions } from '@/features/passes/useDecisions'
import { QUEUE_LIMIT, usePassQueue } from '@/features/passes/usePassQueue'
import { useNow, useToday } from '@/features/passes/useToday'
import { useContractorList } from '@/features/shared/queries'
import type { BulkItemResult, PassStatus, PassWithId } from '@/types/passes'
import { PassTable } from './PassTable'
import { ReviewPanel } from './ReviewPanel'

const t = strings.officer
const a = strings.approvals

type Tab = 'awaiting' | 'approved' | 'rejected' | 'expired'
const TABS: readonly Tab[] = ['awaiting', 'approved', 'rejected', 'expired']
const isTab = (v: string | null): v is Tab => TABS.includes(v as Tab)

const EMPTY: Record<Tab, { title: string; body: string }> = {
  awaiting: { title: t.emptyAwaiting, body: t.emptyAwaitingBody },
  approved: { title: t.emptyApproved, body: t.emptyApprovedBody },
  rejected: { title: t.emptyRejected, body: t.emptyRejectedBody },
  expired: { title: t.emptyExpired, body: t.emptyExpiredBody },
}

const APPROVED: PassStatus[] = ['officer_approved', 'checked_in']
const PENDING: PassStatus[] = ['submitted', 'supervisor_approved']

export default function OfficerQueue() {
  const { claims } = useSession()
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'awaiting'
  const openId = params.get('pass')
  const today = useToday()
  const now = useNow()
  const decisions = useDecisions()
  const reasons = useRejectionReasons(claims.tenantId)
  const contractors = useContractorList('admin') // the tenant-wide list; officers may read every contractor
  const [contractorId, setContractorId] = useState('')

  // Every tab keeps a live listener so its badge count is always current.
  const on = today !== null
  const day = today ? { dateKey: today } : {}
  const queues = {
    awaiting: usePassQueue({ scope: 'officer', status: 'supervisor_approved', ...day, enabled: on }),
    approved: usePassQueue({ scope: 'officer', status: APPROVED, ...day, enabled: on }),
    rejected: usePassQueue({ scope: 'officer', status: 'rejected', ...day, enabled: on }),
    expired: usePassQueue({ scope: 'officer', status: PENDING, ...(today ? { before: today } : {}), enabled: on }),
  }
  const queue = queues[tab]

  const nameOf = useCallback(
    (id: string) => contractors.data?.find((c) => c.id === id)?.name ?? strings.common.none,
    [contractors.data],
  )
  const keep = useCallback((p: PassWithId) => (contractorId === '' || p.contractorId === contractorId) && !decisions.isHidden(p), [contractorId, decisions])
  const rows = useMemo(() => queue.items.filter(keep), [queue.items, keep])
  const count = (q: PassWithId[]) => q.filter(keep).length

  const sel = useBulkSelection(useMemo(() => queues.awaiting.items.filter(keep), [queues.awaiting.items, keep]), today)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState<{ results: BulkItemResult[]; passes: PassWithId[] } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<PassWithId | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const selectingAllowed = tab === 'awaiting'
  useEffect(() => {
    if (!selectingAllowed && sel.selected.size > 0) sel.clear()
  }, [selectingAllowed, sel])

  const setParam = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      return next
    }, { replace: true })
  const setTab = (next: Tab) => setParam({ tab: next === 'awaiting' ? null : next, pass: null })

  // ---- the open pass ----
  // The panel keeps showing a pass whose decision is in flight (it is already hidden from the table).
  const open = queue.items.find((p) => p.id === openId)
  const openIndex = rows.findIndex((p) => p.id === openId)
  const go = (index: number) => {
    const target = rows[index]
    if (target) setParam({ pass: target.id })
  }
  const closePanel = () => setParam({ pass: null })
  // After a decision the pass leaves the list: the next one takes its place, or the panel closes.
  const afterDecision = () => {
    const next = rows[openIndex + 1] ?? rows[openIndex - 1]
    setParam({ pass: next ? next.id : null })
  }
  // A pass that left this list altogether (decided elsewhere, wrong tab in a shared link) has nothing to show.
  const gone = Boolean(openId) && !queue.isLoading && !queue.items.some((p) => p.id === openId)
  useEffect(() => {
    if (gone) setParam({ pass: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone])

  const runBulk = async () => {
    setSending(true)
    const passes = sel.chosen
    const res = await decisions.approveMany(passes)
    setSending(false)
    setConfirming(false)
    if (res) {
      setResults({ results: res, passes })
      sel.clear()
    }
  }

  const confirmRevoke = async (choice: RejectChoice) => {
    if (!revokeTarget) return
    setSending(true)
    setRevokeError(null)
    const res = await decisions.revoke(revokeTarget, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'ok' || res.outcome === 'changed') setRevokeTarget(null)
    else setRevokeError(res.message ?? strings.common.somethingWrong)
  }

  const isPickable = useCallback((p: PassWithId) => today !== null && isBulkSelectable(p, today), [today])
  const allCaughtUp = tab === 'awaiting' && rows.length === 0

  return (
    <div className={cn('px-4 py-5 lg:px-6', open && 'lg:pr-[calc(34rem+1.5rem)]')}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="contractor-filter" className="text-sm font-medium text-slate-700">{t.contractor}</label>
          <select
            id="contractor-filter"
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value="">{t.allContractors}</option>
            {(contractors.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      <div role="tablist" aria-label={t.tabsLabel} className="mb-4 flex gap-1 border-b border-slate-300">
        {TABS.map((id) => {
          const n = count(queues[id].items)
          return (
            <button
              key={id}
              role="tab"
              id={`officer-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="officer-panel"
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px flex h-11 items-center gap-2 border-b-2 px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                tab === id ? 'border-accent text-accent' : 'border-transparent text-slate-700 hover:text-slate-900',
              )}
            >
              {t.tabs[id]}
              <span
                aria-label={`${n}`}
                className={cn('min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-bold', id === 'awaiting' && n > 0 ? 'bg-accent text-white' : 'bg-slate-200 text-slate-800')}
              >
                {n >= QUEUE_LIMIT ? `${QUEUE_LIMIT - 1}+` : n}
              </span>
            </button>
          )
        })}
      </div>

      <div id="officer-panel" role="tabpanel" aria-labelledby={`officer-tab-${tab}`} className="space-y-3">
        {tab === 'expired' && rows.length > 0 && <p role="note" className="rounded-lg bg-slate-200 px-3 py-2 text-sm text-slate-800">{t.expiredNote}</p>}
        {tab === 'approved' && rows.length > 0 && <p className="text-sm text-slate-600">{t.revokeNote}</p>}

        {selectingAllowed && sel.selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-accent bg-accent-soft px-4 py-2">
            <p aria-live="polite" className="flex-1 text-sm font-semibold">{a.bulk.selectedCount(sel.selected.size)}</p>
            <Button variant="ghost" size="sm" onClick={sel.clear}>{a.bulk.clear}</Button>
            <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => setConfirming(true)}>{t.approveSelected(sel.selected.size)}</Button>
          </div>
        )}

        {queue.isError && queue.items.length === 0 ? (
          <ErrorState message={a.queue.loadFailed} onRetry={queue.retry} />
        ) : queue.isLoading || !today ? (
          <ListSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-slate-300 bg-white">
            <EmptyState
              icon={allCaughtUp ? <CheckCheck aria-hidden /> : <Inbox aria-hidden />}
              title={contractorId && queue.items.length > 0 ? t.noMatch : EMPTY[tab].title}
              {...(contractorId && queue.items.length > 0 ? {} : { body: EMPTY[tab].body })}
            />
          </div>
        ) : (
          <>
            {queue.isError && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{a.queue.loadFailed}</p>}
            <PassTable
              rows={rows}
              now={now}
              today={today}
              contractorName={nameOf}
              openId={openId}
              onOpen={(p) => setParam({ pass: p.id })}
              selectable={selectingAllowed}
              isSelectable={isPickable}
              selected={sel.selected}
              onToggle={sel.toggle}
              onSelectAll={sel.selectAll}
              onClear={sel.clear}
              revocable={tab === 'approved'}
              onRevoke={(p) => { setRevokeError(null); setRevokeTarget(p) }}
              showStatus={tab !== 'awaiting'}
            />
            {queue.capped && <p role="status" className="text-center text-sm text-slate-600">{a.queue.capNotice}</p>}
          </>
        )}
      </div>

      {open && (
        <div className="fixed bottom-0 right-0 top-14 z-20 w-full max-w-full border-l border-slate-300 shadow-xl lg:w-[34rem]">
          <ReviewPanel
            key={open.id}
            pass={open}
            today={today}
            contractorName={nameOf(open.contractorId)}
            reasons={reasons}
            decisions={decisions}
            position={{ index: openIndex, total: rows.length }}
            onNext={() => go(openIndex + 1)}
            onPrevious={() => go(openIndex - 1)}
            onClose={closePanel}
            onDecided={afterDecision}
            suspendShortcuts={confirming || revokeTarget !== null || results !== null}
          />
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
      <RejectSheet
        open={revokeTarget !== null}
        mode="revoke"
        reasons={reasons}
        loading={sending}
        error={revokeError}
        onConfirm={(c) => void confirmRevoke(c)}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  )
}
