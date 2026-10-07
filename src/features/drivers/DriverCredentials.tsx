import { Check, Copy, MessageCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { appBase } from '@/lib/appUrl'
import { formatPhone } from '@/lib/credentials'
import { strings } from '@/lib/strings'
import { buildWhatsAppLink } from './whatsapp'

const t = strings.drivers.credentials

/** Shown once after a driver is created. Nothing here is persisted. */
export function DriverCredentials({ phone, pin, onDone }: { phone: string; pin: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const appUrl = appBase?.url ?? window.location.origin
  const shown = formatPhone(phone)
  const whatsapp = buildWhatsAppLink(phone, t.message(appUrl, shown, pin))

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t.copyText(appUrl, shown, pin))
      setCopied(true)
      toast.success(t.copied)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(strings.common.somethingWrong)
    }
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">{t.warning}</p>
      <dl className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">{t.phone}</dt>
          <dd className="font-mono">{shown}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <dt className="text-slate-500">{t.pin}</dt>
          <dd className="font-mono text-base tracking-widest">{pin}</dd>
        </div>
      </dl>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="secondary" onClick={() => void copy()} icon={copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}>
          {copied ? strings.common.copied : t.copy}
        </Button>
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <MessageCircle aria-hidden className="size-4" />
            {t.whatsapp}
          </a>
        )}
      </div>
      <Button className="w-full" onClick={onDone}>
        {strings.common.done}
      </Button>
    </div>
  )
}
