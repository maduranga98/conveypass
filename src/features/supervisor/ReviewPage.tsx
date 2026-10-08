import { ArrowLeft, SearchX } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Skeleton } from '@/components/ui/Skeleton'
import { strings } from '@/lib/strings'
import { useSession } from '@/features/auth/useAuth'
import { DecisionBar } from '@/features/passes/DecisionBar'
import { PassChangedBanner } from '@/features/passes/PassChangedBanner'
import { PassReview } from '@/features/passes/PassReview'
import { isExpired } from '@/features/passes/passView'
import { useRejectionReasons } from '@/features/passes/queries'
import { RejectSheet, type RejectChoice } from '@/features/passes/RejectSheet'
import { useDecisions } from '@/features/passes/useDecisions'
import { useReviewLock } from '@/features/passes/useReviewLock'
import { usePass } from '@/features/passes/usePass'
import { usePassQueue } from '@/features/passes/usePassQueue'
import { useToday } from '@/features/passes/useToday'
import type { PassWithId } from '@/types/passes'
import { NotificationBanner } from '@/components/ui/NotificationBanner'

const t = strings.supervisor.approvals
const a = strings.approvals

/** The review step for one pass. Remounted per pass id, so what the reviewer "saw" always starts fresh. */
function Review({ pass, today }: { pass: PassWithId; today: string | null }) {
  const navigate = useNavigate()
  const { claims } = useSession()
  const reasons = useRejectionReasons(claims.tenantId)
  const decisions = useDecisions()
  const pending = usePassQueue({ scope: 'supervisor', status: 'submitted', ...(today ? { dateKey: today } : {}), enabled: today !== null })

  const [rejecting, setRejecting] = useState(false)
  const [rejectError, setRejectError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const busy = decisions.busyOf(pass.id)
  const lock = useReviewLock(pass, busy)
  const changed = lock.changed
  const expired = today !== null && isExpired(pass, today)
  const decidable = pass.status === 'submitted' && !expired
  const locked = changed || !decidable

  const queueIds = useMemo(() => pending.items.filter((p) => !decisions.isHidden(p)).map((p) => p.id), [pending.items, decisions])
  const position = queueIds.indexOf(pass.id)

  const goNext = () => {
    lock.leave()
    const next = pending.items.find((p) => p.id !== pass.id && !decisions.isHidden(p))
    void navigate(next ? `/supervisor/approvals/${next.id}` : '/supervisor/approvals', { replace: true })
  }

  const approve = async () => {
    const res = await decisions.approve(pass)
    if (res.outcome === 'ok') goNext()
  }

  const confirmReject = async (choice: RejectChoice) => {
    setSending(true)
    setRejectError(null)
    const res = await decisions.reject(pass, choice, { inline: true })
    setSending(false)
    if (res.outcome === 'ok') {
      setRejecting(false)
      goNext()
    } else if (res.outcome === 'changed') setRejecting(false)
    else setRejectError(res.message ?? strings.common.somethingWrong)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link to="/supervisor/approvals" className="inline-flex h-12 items-center gap-2 rounded-lg px-1 text-base font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <ArrowLeft aria-hidden className="size-5" />
          {t.review.back}
        </Link>
        {position >= 0 && <p className="text-sm font-medium text-slate-700">{t.review.position(position + 1, queueIds.length)}</p>}
      </div>

      {changed && <PassChangedBanner onAcknowledge={lock.acknowledge} />}
      {!changed && expired && <p role="status" className="rounded-xl bg-slate-200 px-4 py-3 text-base font-medium">{a.decision.expired}</p>}
      {!changed && !expired && !decidable && <p role="status" className="rounded-xl bg-slate-200 px-4 py-3 text-base font-medium">{t.review.alreadyDecided}</p>}
      {!changed && decidable && pass.checklist.some((c) => c.answer === 'no') && (
        <NotificationBanner tone="error" role="note" size="lg">{a.decision.issuesWarning}</NotificationBanner>
      )}

      <PassReview pass={pass} today={today} />

      {decidable && (
        <DecisionBar
          className="-mx-4"
          busy={busy}
          disabled={locked}
          onApprove={() => void approve()}
          onReject={() => { setRejectError(null); setRejecting(true) }}
        />
      )}

      <RejectSheet
        open={rejecting}
        reasons={reasons}
        loading={sending}
        error={rejectError}
        onConfirm={(c) => void confirmReject(c)}
        onCancel={() => setRejecting(false)}
      />
    </div>
  )
}

export default function ReviewPage() {
  const { passId = '' } = useParams()
  const state = usePass(passId)
  const today = useToday()
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => window.scrollTo?.({ top: 0 }), [passId])

  if (state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" className="space-y-4">
        <span className="sr-only">{strings.common.loading}</span>
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }
  if (state.status === 'error') return <ErrorState message={a.decision.loadFailed} onRetry={() => setRetryKey((k) => k + 1)} />
  if (state.status === 'missing') {
    return (
      <EmptyState
        icon={<SearchX aria-hidden />}
        title={a.decision.notFound}
        action={<Link to="/supervisor/approvals" className="inline-flex h-12 items-center rounded-lg border border-slate-300 bg-surface px-5 text-base font-semibold">{t.review.back}</Link>}
      />
    )
  }
  return <Review key={`${state.pass.id}-${retryKey}`} pass={state.pass} today={today} />
}
