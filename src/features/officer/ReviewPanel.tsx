import { ChevronDown, ChevronUp, Keyboard, X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { strings } from '@/lib/strings'
import { DecisionBar } from '@/features/passes/DecisionBar'
import { PassChangedBanner } from '@/features/passes/PassChangedBanner'
import { PassReview } from '@/features/passes/PassReview'
import { isExpired } from '@/features/passes/passView'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useReviewShortcuts } from '@/features/passes/shortcuts'
import type { useDecisions } from '@/features/passes/useDecisions'
import { useReviewLock } from '@/features/passes/useReviewLock'
import type { RejectionReasonDef } from '@/lib/defaultRejectionReasons'
import type { PassWithId } from '@/types/passes'

const t = strings.officer.panel
const a = strings.approvals

interface Props {
  /** The live version of the pass. */
  pass: PassWithId
  today: string | null
  contractorName: string
  reasons: readonly RejectionReasonDef[]
  decisions: ReturnType<typeof useDecisions>
  /** Position in the current list, for J/K and the "3 of 12" label. */
  position: { index: number; total: number }
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
  /** Called after a successful decision so the list can move on. */
  onDecided: () => void
  /** Shortcuts stand down while another dialog (bulk confirm, revoke) is open. */
  suspendShortcuts: boolean
}

/**
 * Right-side review panel. Remounted per pass (`key={pass.id}`) so what was "seen" starts fresh. Officers approve or
 * reject passes that a supervisor approved, from today. Everything else is read only.
 */
export function ReviewPanel({ pass, today, contractorName, reasons, decisions, position, onNext, onPrevious, onClose, onDecided, suspendShortcuts }: Props) {
  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  const busy = decisions.busyOf(pass.id)
  const lock = useReviewLock(pass, busy)

  const expired = today !== null && isExpired(pass, today)
  const decidable = pass.status === 'supervisor_approved' && !expired
  const locked = lock.changed || !decidable

  const approve = async () => {
    if (locked) return
    const res = await decisions.approve(pass)
    if (res.outcome === 'ok') {
      lock.leave()
      onDecided()
    }
  }

  const confirmReject = async (choice: RejectChoice) => {
    setSending(true)
    setRejectError(null)
    const res = await decisions.reject(pass, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'ok') {
      lock.leave()
      setRejecting(false)
      onDecided()
    } else if (res.outcome === 'changed') setRejecting(false)
    else setRejectError(res.message ?? strings.common.somethingWrong)
  }

  useReviewShortcuts(!suspendShortcuts && !rejecting && !viewerOpen, {
    next: onNext,
    previous: onPrevious,
    close: onClose,
    approve: () => void approve(),
    reject: () => {
      if (!locked && busy === null) {
        setRejectError(null)
        setRejecting(true)
      }
    },
  })

  return (
    <aside aria-label={t.title} className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-slate-300 px-4 py-3">
        <h2 className="flex-1 text-base font-semibold">{t.title}</h2>
        <p className="text-sm text-slate-600">{t.position(position.index + 1, position.total)}</p>
        <Button variant="ghost" size="icon" aria-label={t.previous} disabled={position.index <= 0} onClick={onPrevious}><ChevronUp aria-hidden className="size-5" /></Button>
        <Button variant="ghost" size="icon" aria-label={t.next} disabled={position.index >= position.total - 1} onClick={onNext}><ChevronDown aria-hidden className="size-5" /></Button>
        <Button variant="ghost" size="icon" aria-label={t.close} onClick={onClose}><X aria-hidden className="size-5" /></Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {lock.changed && <PassChangedBanner onAcknowledge={lock.acknowledge} />}
        {!lock.changed && expired && <p role="status" className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium">{a.decision.expired}</p>}
        {!lock.changed && !expired && !decidable && <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{t.readOnly}</p>}
        {!lock.changed && decidable && pass.checklist.some((x) => x.answer === 'no') && (
          <p role="note" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900">{a.decision.issuesWarning}</p>
        )}
        <PassReview pass={pass} today={today} contractorName={contractorName} layout="wide" onViewerOpenChange={setViewerOpen} />
      </div>

      <footer className="space-y-2 border-t border-slate-300 bg-white p-3">
        {decidable && (
          <DecisionBar layout="inline" busy={busy} disabled={locked} onApprove={() => void approve()} onReject={() => { setRejectError(null); setRejecting(true) }} className="border-0 p-0" />
        )}
        <p className="flex items-center gap-2 text-xs text-slate-600">
          <Keyboard aria-hidden className="size-4" />
          <span className="font-medium">{t.shortcuts}:</span> {t.shortcutsHint}
        </p>
      </footer>

      <RejectSheet open={rejecting} reasons={reasons} loading={sending} error={rejectError} onConfirm={(c) => void confirmReject(c)} onCancel={() => setRejecting(false)} />
    </aside>
  )
}
