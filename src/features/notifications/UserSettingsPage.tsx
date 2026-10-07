import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useSession } from '@/features/auth/useAuth'
import { cn } from '@/lib/cn'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { readPushEnv } from './push/env'
import { disablePush, enablePush, isPushEnabledHere } from './push/registration'

const t = strings.push

/** `/settings` for every role: alert settings for this device. */
export default function UserSettingsPage() {
  const { uid, claims, profile } = useSession()
  const [env, setEnv] = useState(readPushEnv)
  const [on, setOn] = useState(() => isPushEnabledHere(uid))
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      if (on) {
        await disablePush(uid)
        setOn(false)
      } else {
        const result = await enablePush(uid)
        setOn(result === 'enabled')
        if (result === 'enabled') toast.success(t.enabledToast)
        else toast.error(result === 'denied' ? t.deniedToast : result === 'unsupported' ? t.unsupported : result === 'unconfigured' ? t.needsConfig : t.failedToast)
      }
    } finally {
      setEnv(readPushEnv())
      setBusy(false)
    }
  }

  const installFirst = env.ios === 'needs-install'
  const blocked = env.permission === 'denied'
  const canToggle = !installFirst && env.supported && (on || !blocked) && claims.role !== 'security'
  const permissionText =
    env.permission === 'granted' ? t.permissionGranted : env.permission === 'denied' ? t.permissionDenied : env.permission === 'default' ? t.permissionDefault : t.unsupported

  return (
    <div className="mx-auto min-h-dvh max-w-2xl space-y-6 px-4 py-6">
      <Link to={ROLE_HOME[claims.role]} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-700 hover:underline focus-visible:outline-2 focus-visible:outline-accent">
        <ArrowLeft aria-hidden className="size-4" />
        {strings.userSettings.back}
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{strings.userSettings.title}</h1>

      <section aria-labelledby="alerts-h" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="alerts-h" className="font-semibold">{t.settingsTitle}</h2>
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p id="device-toggle-label" className="text-sm font-medium">{t.deviceTitle}: {t.toggle}</p>
            <p id="device-toggle-status" className="text-sm text-slate-700">{on ? t.statusOn : t.statusOff}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby="device-toggle-label"
            aria-describedby="device-toggle-status"
            disabled={!canToggle || busy}
            onClick={() => void toggle()}
            className={cn(
              'relative inline-flex h-11 w-16 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
              on ? 'border-accent bg-accent' : 'border-slate-400 bg-white',
            )}
          >
            <span aria-hidden className={cn('inline-block size-7 rounded-full transition-transform', on ? 'translate-x-7 bg-white' : 'translate-x-1 bg-slate-500')} />
          </button>
        </div>

        {installFirst ? (
          <div role="note" className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <p className="font-semibold">{t.iosTitle}</p>
            <p>{t.iosBody}</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5">{t.iosSteps.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        ) : (
          <p data-testid="permission-status" className={cn('text-sm', blocked ? 'text-red-800' : 'text-slate-700')}>{permissionText}</p>
        )}
        <p className="text-sm text-slate-600">{t.otherDevices}</p>
      </section>

      <section aria-labelledby="account-h" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="account-h" className="font-semibold">{strings.userSettings.account}</h2>
        <p className="text-sm text-slate-700">{strings.userSettings.signedInAs} {profile.name} ({strings.roles[claims.role]})</p>
      </section>
    </div>
  )
}
