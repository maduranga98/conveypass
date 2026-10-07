import { Check, ChevronRight, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { PassWithId } from '@/types/passes'
import { EvidenceThumb } from './EvidenceThumb'
import { issueCount, timeAgo, toMs } from './passView'

const t = strings.approvals.card

interface Props {
  pass: PassWithId
  /** Clock for the "5 min ago" label. */
  now: number
  /** Shown for officers and admins; a supervisor only ever sees their own contractor. */
  contractorName?: string
  /** `select` shows a checkbox on passes that can be bulk approved. */
  mode?: 'open' | 'select'
  selected?: boolean
  /** In select mode: whether this pass can be picked. Passes with issues cannot. */
  selectable?: boolean
  /** A line under the photos (the rejection reason, who approved, ...). */
  note?: string
  onOpen: () => void
  onToggle?: () => void
}

/** Summary of one pass: big plate, who and when, two photos, and an issues chip when any answer is No. */
export function PassCard({ pass, now, contractorName, mode = 'open', selected = false, selectable = true, note, onOpen, onToggle }: Props) {
  const issues = issueCount(pass)
  const selecting = mode === 'select'
  const canPick = selecting && selectable
  // In select mode a pickable card toggles; a card with issues still opens, so it can be reviewed.
  const activate = canPick ? onToggle : onOpen

  return (
    <article
      data-testid="pass-card"
      className={cn(
        'flex items-stretch gap-3 rounded-2xl border-2 bg-white p-3',
        selected ? 'border-accent bg-accent-soft' : issues > 0 ? 'border-red-300' : 'border-slate-300',
      )}
    >
      {selecting && (
        <div className="flex w-11 shrink-0 items-start justify-center pt-1">
          {canPick ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={selected}
              aria-label={t.select(pass.plateNo)}
              onClick={onToggle}
              className={cn(
                'grid size-11 place-items-center rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                selected ? 'border-accent bg-accent text-white' : 'border-slate-400 bg-white',
              )}
            >
              {selected && <Check aria-hidden className="size-6" />}
            </button>
          ) : (
            <span aria-hidden className="mt-2 size-6 rounded border-2 border-dashed border-slate-300" />
          )}
        </div>
      )}

      <button
        type="button"
        onClick={activate}
        aria-label={selecting && !canPick ? `${pass.plateNo}: ${t.openToReview}` : undefined}
        className="min-w-0 flex-1 space-y-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-2xl font-extrabold tracking-tight">{pass.plateNo}</p>
            <p className="truncate text-sm text-slate-700">
              {pass.vehicleType} · {pass.driverName}
              {contractorName ? ` · ${contractorName}` : ''}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-slate-800">{timeAgo(toMs(pass.submittedAt), now)}</p>
            {pass.attempt > 1 && <p className="text-xs text-slate-600">{t.attempt(pass.attempt)}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {([['gps', strings.approvals.evidence.gps, pass.evidence.gps.path], ['dashcam', strings.approvals.evidence.dashcam, pass.evidence.dashcam.path]] as const).map(([key, label, path]) => (
            <div key={key} className="aspect-[4/3] overflow-hidden rounded-lg bg-slate-200">
              <EvidenceThumb path={path} alt={t.photoOf(label, pass.plateNo)} />
            </div>
          ))}
        </div>

        <div className="flex min-h-7 flex-wrap items-center gap-2">
          {issues > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-700 px-3 py-1 text-sm font-bold text-white">
              <TriangleAlert aria-hidden className="size-4" />
              {t.issues(issues)}
            </span>
          )}
          {selecting && !canPick && (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-800">
              {t.openToReview}
              <ChevronRight aria-hidden className="size-4" />
            </span>
          )}
        </div>
        {note && <p className="text-sm text-slate-700">{note}</p>}
      </button>
    </article>
  )
}
