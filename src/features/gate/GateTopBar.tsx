import { CloudUpload, LogOut, MapPin, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useAuth, useSession } from '@/features/auth/useAuth'
import { useOnline } from '@/features/passes/useOnline'
import { cn } from '@/lib/cn'
import { strings } from '@/lib/strings'
import { useSoundOn } from './deviceSettings'
import { GatePicker } from './GatePicker'
import { useOfflineQueue } from './gateQueue'
import { useGates } from './useGate'

const t = strings.gate
const iconBtn =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** Gate chip, online state, unsynced count, sound toggle and sign-out, in one row that fits a 360 px phone. */
export function GateTopBar() {
  const { uid } = useSession()
  const { signOut } = useAuth()
  const online = useOnline()
  const { gates, gate, setGate } = useGates()
  const [soundOn, setSoundOn] = useSoundOn()
  const queued = useOfflineQueue(uid)
  const waiting = queued.filter((i) => i.status === 'waiting').length
  const [picking, setPicking] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)

  const leave = () => (queued.length > 0 ? setConfirmOut(true) : void signOut())

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-1.5 px-3">
        <button
          type="button"
          onClick={() => setPicking(true)}
          aria-label={gate ? `${t.gateLabel(gate.name)}. ${t.changeGate}` : t.chooseGate}
          className={cn(
            'inline-flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-full border-2 px-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            gate ? 'border-slate-300 bg-white text-slate-900' : 'border-amber-500 bg-amber-100 text-amber-950',
          )}
        >
          <MapPin aria-hidden className="size-4 shrink-0" />
          <span className="truncate">{gate?.name ?? t.chooseGate}</span>
        </button>

        <span
          role="status"
          className={cn(
            'inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-bold',
            online ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-900 text-white',
          )}
        >
          {online ? <Wifi aria-hidden className="size-4" /> : <WifiOff aria-hidden className="size-4" />}
          {online ? t.online : t.offline}
        </span>

        <Link to="/security/queue" aria-label={`${t.openQueue}: ${t.queueBadge(waiting)}`} className={cn(iconBtn, 'relative')}>
          <CloudUpload aria-hidden className="size-5" />
          {waiting > 0 && (
            <span aria-hidden className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-amber-400 px-1 text-center text-xs font-black text-slate-950">
              {waiting}
            </span>
          )}
        </Link>

        <button type="button" className={iconBtn} aria-pressed={soundOn} aria-label={soundOn ? t.soundOn : t.soundOff} title={soundOn ? t.soundOn : t.soundOff} onClick={() => setSoundOn(!soundOn)}>
          {soundOn ? <Volume2 aria-hidden className="size-5" /> : <VolumeX aria-hidden className="size-5" />}
        </button>

        <button type="button" className={iconBtn} aria-label={strings.common.signOut} title={strings.common.signOut} onClick={leave}>
          <LogOut aria-hidden className="size-5" />
        </button>
      </div>

      <GatePicker
        open={picking}
        gates={gates}
        current={gate?.id ?? null}
        onPick={(id) => {
          setGate(id)
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
      <ConfirmDialog
        open={confirmOut}
        title={t.signOutTitle}
        body={t.signOutPending(queued.length)}
        confirmLabel={strings.common.signOut}
        tone="danger"
        onConfirm={() => void signOut()}
        onCancel={() => setConfirmOut(false)}
      />
    </header>
  )
}
