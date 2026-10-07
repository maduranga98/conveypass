import { strings } from '@/lib/strings'
import type { PassDoc } from '@/types/passes'
import { formatDateTime, toMs } from './passView'

const t = strings.approvals

const VERB = { approve: 'approved', reject: 'rejected', revoke: 'revoked', check_in: 'checked in' } as const

/** Every decision ever made on a pass (never trimmed), plus the reasons of earlier rejections. For admins. */
export function PassHistory({ pass }: { pass: Pick<PassDoc, 'history' | 'rejection' | 'rejectionHistory'> }) {
  const history = pass.history ?? []
  const rejections = [...(pass.rejectionHistory ?? []).map((r) => ({ ...r, current: false })), ...(pass.rejection ? [{ ...pass.rejection, attempt: null, current: true }] : [])]
  return (
    <section aria-labelledby="history-h" className="space-y-3">
      <h3 id="history-h" className="text-base font-semibold">{strings.admin.passes.historyTitle}</h3>
      {history.length === 0 ? (
        <p className="text-sm text-slate-600">{strings.admin.passes.historyEmpty}</p>
      ) : (
        <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
          {history.map((h, i) => (
            <li key={i} className="text-sm">
              <p className="font-medium text-slate-900">
                {t.info.stage[h.stage]}: {VERB[h.action]} · {strings.admin.passes.attemptN(h.attempt)}
              </p>
              <p className="text-slate-600">{h.byName} ({strings.roles[h.byRole as keyof typeof strings.roles] ?? h.byRole}) · {formatDateTime(toMs(h.at))}</p>
            </li>
          ))}
        </ol>
      )}
      {rejections.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t.info.previousRejection}</h4>
          <ul className="space-y-2">
            {rejections.map((r, i) => (
              <li key={i} className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
                <p className="font-medium">{r.reason}</p>
                <p className="text-xs">
                  {t.info.stage[r.stage]} · {r.byName} · {formatDateTime(toMs(r.at))}
                  {r.attempt !== null ? ` · ${strings.admin.passes.attemptN(r.attempt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
