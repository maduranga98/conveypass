import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { PassStatus } from '@/types/passes'

const t = strings.pass.status

/** How many of the 4 steps are complete for a status. A rejected pass has only "Submitted" behind it. */
const stepsDone = (status: PassStatus): number =>
  ({ submitted: 1, supervisor_approved: 2, officer_approved: 3, checked_in: 4, rejected: 1 })[status]

const STEPS = [t.steps.submitted, t.steps.supervisor, t.steps.officer, t.steps.gate] as const

/** Submitted → Supervisor → Officer → Gate. */
export function PassTimeline({ status, tone = 'neutral' }: { status: PassStatus; tone?: 'neutral' | 'success' }) {
  const done = stepsDone(status)
  return (
    <ol aria-label={t.timeline} className="flex w-full items-start">
      {STEPS.map((label, i) => {
        const complete = i < done
        const current = i === done && status !== 'rejected'
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center gap-2 text-center" aria-current={current ? 'step' : undefined}>
            {i > 0 && (
              <span aria-hidden className={cn('absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2', i <= done - 1 ? (tone === 'success' ? 'bg-white' : 'bg-emerald-600') : tone === 'success' ? 'bg-white/40' : 'bg-slate-300')} />
            )}
            <span
              className={cn(
                'relative z-10 grid size-8 place-items-center rounded-full border-2 text-sm font-bold',
                complete
                  ? tone === 'success' ? 'border-white bg-white text-emerald-700' : 'border-emerald-600 bg-emerald-600 text-white'
                  : current
                    ? tone === 'success' ? 'border-white bg-transparent text-white' : 'border-accent bg-white text-accent'
                    : tone === 'success' ? 'border-white/50 text-white/60' : 'border-slate-300 bg-white text-slate-400',
              )}
            >
              {complete ? <Check aria-hidden className="size-4" /> : i + 1}
            </span>
            <span className={cn('text-xs font-semibold', tone === 'success' ? 'text-white' : complete ? 'text-slate-900' : 'text-slate-500')}>
              {label}
              <span className="sr-only">{complete ? ' (done)' : current ? ' (waiting)' : ''}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
