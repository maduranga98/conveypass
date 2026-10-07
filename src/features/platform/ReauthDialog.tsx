import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { strings } from '@/lib/strings'
import { WrongPassword } from './reauth'

const t = strings.platform.reauth

export function ReauthDialog({ open, onConfirm, onCancel }: { open: boolean; onConfirm: (password: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
      setPassword('')
    } catch (err) {
      setError(err instanceof WrongPassword ? t.wrong : t.failed)
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => {
    setPassword('')
    setError(null)
    onCancel()
  }

  return (
    <Modal open={open} onClose={cancel} title={t.title}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <p className="text-sm text-slate-600">{t.body}</p>
        <Input label={t.password} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel} disabled={busy}>{strings.common.cancel}</Button>
          <Button type="submit" loading={busy} disabled={password.length === 0}>{t.confirm}</Button>
        </div>
      </form>
    </Modal>
  )
}
