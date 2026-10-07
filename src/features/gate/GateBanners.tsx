import { CloudOff, TriangleAlert, WifiOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useSession } from '@/features/auth/useAuth'
import { strings } from '@/lib/strings'
import { useOfflineQueue } from './gateQueue'

const t = strings.gate

/** Persistent on every security screen while an offline item was refused by the server. */
export function FailedQueueBanner() {
  const { uid } = useSession()
  const failed = useOfflineQueue(uid).filter((i) => i.status === 'failed').length
  if (failed === 0) return null
  return (
    <Link
      to="/security/queue"
      role="alert"
      className="flex min-h-12 items-center gap-2 bg-amber-300 px-4 py-2 text-base font-bold text-slate-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-slate-950"
    >
      <TriangleAlert aria-hidden className="size-5 shrink-0" />
      {t.failedBanner(failed)}
    </Link>
  )
}

/** Offline (or stuck on cached data): the guard must know the screen may be out of date. */
export function OfflineBanner({ offline, stale }: { offline: boolean; stale: boolean }) {
  if (!offline && !stale) return null
  const Icon = offline ? WifiOff : CloudOff
  return (
    <p role="status" className="flex items-center gap-2 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
      <Icon aria-hidden className="size-5 shrink-0" />
      {offline ? t.offlineBanner : t.staleBanner}
    </p>
  )
}
