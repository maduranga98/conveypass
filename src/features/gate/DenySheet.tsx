import { useId, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { DENY_OTHER_ID, DENY_REASONS, MAX_DENY_NOTE, MIN_DENY_NOTE } from '@/lib/denyReasons'
import { strings } from '@/lib/strings'

const t = strings.gate

export interface DenyChoice {
  reasonCode: string
  note?: string
}

/** Reason chips, a note (required for "Other"), Confirm. Never changes the pass: it only records the denial. */
export function DenySheet({ open, plateNo, loading, onConfirm, onCancel }: {
  open: boolean
  plateNo: string
  loading: boolean
  onConfirm: (choice: DenyChoice) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  const groupId = useId()
  const noteId = useId()

  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setCode(null)
      setNote('')
      setTried(false)
    }
  }

  const trimmed = note.trim()
  const noteRequired = code === DENY_OTHER_ID
  const noteMissing = noteRequired && trimmed.length < MIN_DENY_NOTE

  const submit = () => {
    setTried(true)
    if (loading || !code || noteMissing) return
    onConfirm({ reasonCode: code, ...(trimmed ? { note: trimmed } : {}) })
  }

  return (
    <Modal
      open={open}
      onClose={() => !loading && onCancel()}
      title={`${t.denyTitle}: ${plateNo}`}
      variant="sheet"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" className="h-14 text-base" disabled={loading} onClick={onCancel}>{strings.common.cancel}</Button>
          <Button variant="danger" className="h-14 text-base font-bold" loading={loading} onClick={submit}>{t.denyConfirm}</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-700">{t.denyIntro}</p>
        <fieldset disabled={loading} className="space-y-2">
          <legend className="text-sm font-semibold text-slate-900">{t.denyReason}</legend>
          <div role="radiogroup" aria-labelledby={groupId} className="flex flex-col gap-2">
            <span id={groupId} className="sr-only">{t.denyReason}</span>
            {DENY_REASONS.map((r) => (
              <label
                key={r.id}
                className={cn(
                  'flex min-h-14 cursor-pointer items-center rounded-xl border-2 px-4 py-2 text-base font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                  code === r.id ? 'border-red-700 bg-red-50 text-red-900' : 'border-slate-300 bg-white text-slate-900',
                )}
              >
                <input type="radio" name={groupId} value={r.id} checked={code === r.id} onChange={() => setCode(r.id)} className="sr-only" />
                {r.label}
              </label>
            ))}
          </div>
          {tried && !code && <p role="alert" className="text-sm font-semibold text-red-700">{t.denyPick}</p>}
        </fieldset>
        {code && (
          <div className="space-y-1.5">
            <label htmlFor={noteId} className="text-sm font-semibold text-slate-900">{noteRequired ? t.denyNoteRequired : t.denyNoteOptional}</label>
            <textarea
              id={noteId}
              value={note}
              rows={3}
              maxLength={MAX_DENY_NOTE}
              disabled={loading}
              aria-invalid={tried && noteMissing ? true : undefined}
              aria-describedby={tried && noteMissing ? `${noteId}-err` : undefined}
              onChange={(e) => setNote(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-accent"
            />
            {tried && noteMissing && <p id={`${noteId}-err`} role="alert" className="text-sm font-semibold text-red-700">{t.denyNoteError}</p>}
          </div>
        )}
      </div>
    </Modal>
  )
}
