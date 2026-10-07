import { Check } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { EvidenceThumb } from '@/features/passes/EvidenceThumb'
import { PassStatusBadge } from '@/features/passes/PassStatusBadge'
import { displayStatus, formatTime, issueCount, timeAgo, toMs } from '@/features/passes/passView'
import type { PassWithId } from '@/types/passes'

const t = strings.officer
const c = strings.approvals

interface Props {
  rows: readonly PassWithId[]
  now: number
  today: string
  contractorName: (id: string) => string
  openId: string | null
  onOpen: (pass: PassWithId) => void
  /** Show the checkbox column (Awaiting me). */
  selectable: boolean
  isSelectable: (pass: PassWithId) => boolean
  selected: ReadonlySet<string>
  onToggle: (pass: PassWithId) => void
  onSelectAll: () => void
  onClear: () => void
  /** Show the Revoke action on approved (not yet checked in) passes. */
  revocable: boolean
  onRevoke: (pass: PassWithId) => void
  /** Show the status column (lists that mix statuses). */
  showStatus: boolean
}

/** Dense table for the officer's desktop view. A row opens the review panel; checkboxes and buttons do not. */
export function PassTable({ rows, now, today, contractorName, openId, onOpen, selectable, isSelectable, selected, onToggle, onSelectAll, onClear, revocable, onRevoke, showStatus }: Props) {
  const pickable = rows.filter(isSelectable)
  const allPicked = pickable.length > 0 && pickable.every((p) => selected.has(p.id))

  const rowKey = (p: PassWithId) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onOpen(p)
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-300 bg-white">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
          <tr>
            {selectable && (
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={t.selectAll}
                  className="size-4 accent-indigo-600"
                  checked={allPicked}
                  disabled={pickable.length === 0}
                  onChange={() => (allPicked ? onClear() : onSelectAll())}
                />
              </th>
            )}
            <th scope="col" className="px-3 py-2">{t.columns.plate}</th>
            <th scope="col" className="px-3 py-2">{t.columns.contractor}</th>
            <th scope="col" className="px-3 py-2">{t.columns.driver}</th>
            <th scope="col" className="px-3 py-2">{t.columns.submitted}</th>
            <th scope="col" className="px-3 py-2">{t.columns.supervisor}</th>
            {showStatus && <th scope="col" className="px-3 py-2">{t.columns.status}</th>}
            <th scope="col" className="px-3 py-2">{t.columns.issues}</th>
            <th scope="col" className="px-3 py-2">{t.columns.photos}</th>
            <th scope="col" className="px-3 py-2 text-right">{t.columns.actions}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((p) => {
            const issues = issueCount(p)
            const isOpen = openId === p.id
            return (
              <tr
                key={p.id}
                tabIndex={0}
                aria-selected={isOpen}
                onClick={() => onOpen(p)}
                onKeyDown={rowKey(p)}
                className={cn('cursor-pointer align-middle hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', isOpen && 'bg-accent-soft', selected.has(p.id) && 'bg-accent-soft/60')}
              >
                {selectable && (
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {isSelectable(p) ? (
                      <input
                        type="checkbox"
                        aria-label={t.selectRow(p.plateNo)}
                        className="size-4 accent-indigo-600"
                        checked={selected.has(p.id)}
                        onChange={() => onToggle(p)}
                      />
                    ) : (
                      <span aria-hidden className="block size-4 rounded border border-dashed border-slate-300" />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <p className="text-base font-bold tracking-tight">{p.plateNo}</p>
                  <p className="text-xs text-slate-600">{p.vehicleType}{p.attempt > 1 ? ` · ${c.card.attempt(p.attempt)}` : ''}</p>
                </td>
                <td className="px-3 py-2 text-slate-800">{contractorName(p.contractorId)}</td>
                <td className="px-3 py-2 text-slate-800">{p.driverName}</td>
                <td className="px-3 py-2 whitespace-nowrap" title={formatTime(toMs(p.submittedAt))}>
                  <p className="font-medium">{timeAgo(toMs(p.submittedAt), now)}</p>
                  <p className="text-xs text-slate-600">{formatTime(toMs(p.submittedAt))}</p>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {p.supervisor ? (
                    <>
                      <p className="font-medium">{p.supervisor.name}</p>
                      <p className="text-xs text-slate-600">{formatTime(toMs(p.supervisor.at))}</p>
                    </>
                  ) : (
                    <span className="text-slate-500">{strings.common.none}</span>
                  )}
                </td>
                {showStatus && <td className="px-3 py-2"><PassStatusBadge status={displayStatus(p, today)} /></td>}
                <td className="px-3 py-2">
                  {issues > 0 ? (
                    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-red-700 px-2.5 py-0.5 text-xs font-bold text-white">{c.card.issues(issues)}</span>
                  ) : (
                    <Check aria-label={t.noIssues} className="size-4 text-emerald-700" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1.5">
                    {([[strings.approvals.evidence.gps, p.evidence.gps.path], [strings.approvals.evidence.dashcam, p.evidence.dashcam.path]] as const).map(([label, path]) => (
                      <div key={label} className="size-10 overflow-hidden rounded-md bg-slate-200">
                        <EvidenceThumb path={path} alt={c.card.photoOf(label, p.plateNo)} />
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    {revocable && p.status === 'officer_approved' && (
                      <Button variant="secondary" size="sm" className="border-red-300 text-red-800 hover:bg-red-50" onClick={() => onRevoke(p)}>{t.revoke}</Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => onOpen(p)} aria-label={`${t.review}: ${p.plateNo}`}>{t.review}</Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
