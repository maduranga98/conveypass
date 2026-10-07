import { Check, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import type { PassChecklistItem } from '@/types/passes'

const t = strings.approvals.checklist

/** Every checklist item with its answer. "No" rows are highlighted and show the driver's note. */
export function ChecklistSummary({ items }: { items: readonly PassChecklistItem[] }) {
  const noCount = items.filter((i) => i.answer === 'no').length
  return (
    <section aria-labelledby="checklist-summary-h" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="checklist-summary-h" className="text-base font-semibold">{t.title}</h3>
        {noCount === 0 && <p className="text-sm font-medium text-emerald-800">{t.allYes}</p>}
      </div>
      <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-300 bg-white">
        {items.map((item) => {
          const no = item.answer === 'no'
          return (
            <li key={item.id} data-answer={item.answer} className={cn('flex items-start gap-3 px-4 py-3', no && 'bg-red-50')}>
              <span
                aria-hidden
                className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-full', no ? 'bg-red-700 text-white' : 'bg-emerald-100 text-emerald-800')}
              >
                {no ? <X className="size-4" /> : <Check className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-base', no ? 'font-semibold text-red-900' : 'text-slate-900')}>{item.label}</p>
                {no && item.note && <p className="mt-0.5 text-sm text-red-900">{t.driverNote(item.note)}</p>}
              </div>
              <span className={cn('shrink-0 text-sm font-bold', no ? 'text-red-800' : 'text-emerald-800')}>{no ? t.no : t.yes}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
