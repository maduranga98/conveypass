import { Outlet } from 'react-router-dom'
import { FailedQueueBanner } from './GateBanners'
import { GateTopBar } from './GateTopBar'
import { useGateRuntime } from './useGate'

/** Mobile-first shell for every `/security` screen: the top bar, the rejected-items banner, the sync loop. */
export default function SecurityLayout() {
  useGateRuntime()
  return (
    <div className="min-h-dvh bg-slate-50">
      <GateTopBar />
      <FailedQueueBanner />
      <Outlet />
    </div>
  )
}
