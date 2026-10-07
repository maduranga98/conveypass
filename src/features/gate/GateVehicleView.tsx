import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CircleAlert, CircleCheckBig, CloudUpload, OctagonX, ScanLine, ShieldBan, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageSpinner } from '@/components/ui/Spinner'
import { useSession } from '@/features/auth/useAuth'
import { usePass } from '@/features/passes/usePass'
import { useOnline } from '@/features/passes/useOnline'
import { useToday } from '@/features/passes/useToday'
import { cn } from '@/lib/cn'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { VEHICLE_ID_RE } from '@/lib/vehicleQr'
import type { Vehicle, WithId } from '@/types'
import type { PassWithId } from '@/types/passes'
import { CheckInSuccess, type SuccessInfo } from './CheckInSuccess'
import { DenySheet, type DenyChoice } from './DenySheet'
import { useSoundOn } from './deviceSettings'
import { DriverPhoto } from './DriverPhoto'
import { feedback } from './feedback'
import { FailedQueueBanner } from './GateBanners'
import { GatePicker } from './GatePicker'
import { pendingPassIds, useOfflineQueue } from './gateQueue'
import { canCheckIn, canDeny, computeGateResult, gateTone, type GateResult } from './gateResult'
import { useContractorDoc, useDriverDoc, useVehicleDoc } from './queries'
import { useCheckIn, useDenyEntry } from './useGateActions'
import { useGateRuntime, useGates } from './useGate'

const t = strings.gate

const hhmm = (ms: number | null | undefined): string =>
  ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : strings.common.none

/** Where the guard came from: a list on the gate home (go back there) or a scan (scan the next one). */
interface FromState {
  from?: 'list' | 'scan'
}

function reasonText(r: GateResult): string | null {
  switch (r.kind) {
    case 'approved':
    case 'already_checked_in':
      return null
    case 'rejected':
      return r.reason ? t.reason.rejected(r.reason) : t.reason.rejectedNoReason
    default:
      return t.reason[r.kind]
  }
}

function Banner({ result }: { result: GateResult }) {
  const tone = gateTone(result.kind)
  const Icon = tone === 'green' ? CircleCheckBig : tone === 'amber' ? CircleAlert : result.kind.endsWith('suspended') ? ShieldBan : OctagonX
  const title = tone === 'green' ? t.banner.approved : tone === 'amber' ? t.banner.already_checked_in : t.banner.not_approved
  const reason = reasonText(result)
  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 px-4 py-4',
        tone === 'green' && 'bg-emerald-700 text-white',
        tone === 'amber' && 'bg-amber-400 text-slate-950',
        tone === 'red' && 'bg-red-700 text-white',
      )}
    >
      <Icon aria-hidden className="size-14 shrink-0" strokeWidth={2.5} />
      <div className="min-w-0">
        <h1 className="text-4xl leading-none font-black tracking-tight">{title}</h1>
        {reason && <p className="mt-1.5 text-lg leading-snug font-bold">{reason}</p>}
      </div>
    </section>
  )
}

/** Runs the queue sync and the wake lock for security; renders nothing. */
function SecurityRuntime() {
  useGateRuntime()
  return null
}

/**
 * `/v/:vehicleId` for staff. Security gets the actions (check in, deny); admin, officer and supervisor the same view
 * read-only. Reads are live from Firestore (the pass flips by itself when an officer approves); the one decision
 * about what the guard sees is `computeGateResult`.
 */
export default function GateVehicleView({ vehicleId, readOnly }: { vehicleId: string; readOnly: boolean }) {
  const { uid, claims, profile } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const online = useOnline()
  const today = useToday()
  const [soundOn] = useSoundOn()
  const { gates, gate, setGate } = useGates()
  const queued = useOfflineQueue(uid)
  const from = (location.state as FromState | null)?.from

  const validId = VEHICLE_ID_RE.test(vehicleId)
  // The gate home already holds the tenant's vehicles: use it as a starting point, then read the document itself.
  const listed = queryClient
    .getQueryData<{ items: WithId<Vehicle>[] }>(['vehicles', claims.tenantId, 'all'])
    ?.items.find((v) => v.id === vehicleId)
  const vehicleQ = useVehicleDoc(validId ? vehicleId : null, listed)
  const vehicle = vehicleQ.data ?? null
  const passId = vehicle && today ? `${vehicleId}_${today}` : null
  const passState = usePass(passId)
  const pass: PassWithId | null = passState.status === 'ready' ? passState.pass : null
  const driverQ = useDriverDoc(pass?.driverId ?? null)
  const contractorQ = useContractorDoc(vehicle?.contractorId ?? null)

  const loading =
    validId &&
    (vehicleQ.isPending ||
      (vehicle !== null && (today === null || passState.status === 'loading' || contractorQ.isPending || (pass !== null && driverQ.isPending))))
  const failed = validId && !loading && (vehicleQ.isError || passState.status === 'error')

  const pendingSync = passId !== null && pendingPassIds(queued).has(passId)
  const result = useMemo(
    () =>
      computeGateResult({
        vehicle: validId ? vehicle : null,
        pass,
        driver: driverQ.data ?? null,
        contractor: contractorQ.data ?? null,
        today: today ?? '',
        pendingSync,
      }),
    [validId, vehicle, pass, driverQ.data, contractorQ.data, today, pendingSync],
  )

  const [success, setSuccess] = useState<SuccessInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [denying, setDenying] = useState(false)
  const [picking, setPicking] = useState<null | 'checkIn' | 'deny'>(null)
  const { checkIn, pending: checkingIn } = useCheckIn()
  const { deny, pending: denyingNow } = useDenyEntry()

  // One tone and buzz per result the guard sees (also when it flips by itself, e.g. the officer approves).
  const settled = !loading && !failed
  useEffect(() => {
    if (!readOnly && settled) feedback(result.kind === 'approved' ? 'ok' : 'blocked', soundOn)
    // Only a new result should sound, not a toggle of the sound setting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, settled, result.kind])

  const next = from === 'list' ? 'home' : 'scan'
  const goNext = useCallback(
    () => void navigate('/security', { replace: true, state: next === 'scan' ? { scan: true } : null }),
    [navigate, next],
  )
  const scanNext = () => void navigate('/security', { state: { scan: true } })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['vehicleDoc', vehicleId] })
    if (pass) void queryClient.invalidateQueries({ queryKey: ['driverDoc', pass.driverId] })
    if (vehicle) void queryClient.invalidateQueries({ queryKey: ['contractorDoc', vehicle.contractorId] })
  }

  const doCheckIn = async (g = gate) => {
    if (!pass || !vehicle) return
    if (!g) {
      setPicking('checkIn')
      return
    }
    setError(null)
    const out = await checkIn({ passId: pass.id, attempt: pass.attempt, plateNo: vehicle.plateNo, vehicleId }, g)
    if (out.kind === 'ignored') return
    if (out.kind === 'error') {
      setError(out.message)
      feedback('blocked', soundOn)
      toast.error(out.message)
      refresh()
      return
    }
    feedback('ok', soundOn)
    setSuccess({ plateNo: vehicle.plateNo, atMs: out.atMs, offline: out.kind === 'offline', guardName: profile.name, gateName: g.name })
  }

  const doDeny = async (choice: DenyChoice, g = gate) => {
    if (!vehicle || !g) return
    const out = await deny({ vehicleId, plateNo: vehicle.plateNo }, g, choice)
    if (out.kind === 'ignored') return
    if (out.kind === 'error') {
      toast.error(out.message)
      return
    }
    setDenying(false)
    toast.success(out.kind === 'offline' ? t.deniedOffline(vehicle.plateNo) : t.denied(vehicle.plateNo))
  }

  const openDeny = () => (gate ? setDenying(true) : setPicking('deny'))

  if (success) return <CheckInSuccess info={success} next={next} onNext={goNext} />

  const backTo = readOnly ? ROLE_HOME[claims.role] : '/security'
  const header = (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2">
      <Link to={backTo} className="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-base font-semibold text-slate-900 focus-visible:outline-2 focus-visible:outline-accent">
        <ArrowLeft aria-hidden className="size-5" />
        {t.back}
      </Link>
      {!readOnly && gate && <span className="truncate text-sm font-bold text-slate-700">{gate.name}</span>}
      <span className={cn('inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs font-bold', online ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-900 text-white')}>
        {online ? null : <WifiOff aria-hidden className="size-4" />}
        {online ? t.online : t.offline}
      </span>
    </header>
  )

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col bg-white">
        {!readOnly && <SecurityRuntime />}
        {header}
        <p role="status" className="bg-slate-200 px-4 py-6 text-3xl font-black text-slate-700">{t.banner.loading}</p>
        <PageSpinner />
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex min-h-dvh flex-col bg-white">
        {!readOnly && <SecurityRuntime />}
        {header}
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <CircleAlert aria-hidden className="size-16 text-slate-700" />
          <p className="text-2xl font-extrabold">{t.loadFailed}</p>
          {!online && <p className="text-lg">{t.offlineStrip}</p>}
          <button type="button" onClick={() => { refresh(); void vehicleQ.refetch() }} className="h-14 w-full max-w-xs rounded-xl bg-slate-900 text-lg font-bold text-white">
            {strings.common.retry}
          </button>
        </div>
      </div>
    )
  }

  const driverName = pass?.driverName ?? null
  const contractorName = contractorQ.data?.name ?? strings.common.none
  const checkInStamp = pass?.checkIn

  return (
    <div className="flex min-h-dvh flex-col bg-white">
      {!readOnly && <SecurityRuntime />}
      {!readOnly && <FailedQueueBanner />}
      {header}
      <Banner result={result} />
      {!online && (
        <p role="status" className="flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-bold text-white">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          {t.offlineStrip}
        </p>
      )}

      <main className="mx-auto w-full max-w-lg flex-1 space-y-4 px-4 pt-4 pb-6">
        {vehicle ? (
          <section aria-label={t.plate}>
            <p className="text-5xl leading-none font-black tracking-tight break-words text-slate-950">{vehicle.plateNo}</p>
            <p className="mt-2 text-lg font-semibold text-slate-800">
              {vehicle.type} · {contractorName}
            </p>
          </section>
        ) : (
          <p className="text-lg font-semibold text-slate-800">{t.reason.not_found}</p>
        )}

        {result.kind === 'already_checked_in' && (
          <p className="flex items-start gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-2 text-base font-bold text-slate-950">
            {result.pendingSync ? <CloudUpload aria-hidden className="mt-0.5 size-5 shrink-0" /> : <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />}
            <span>
              {result.pendingSync || !checkInStamp
                ? t.pendingSyncBody
                : t.alreadyBy(hhmm(checkInStamp.at?.toMillis()), checkInStamp.name, checkInStamp.gateName)}
              {!result.pendingSync && checkInStamp?.offlineCapturedAt && (
                <span className="block text-sm font-semibold">{strings.admin.passes.checkInOffline(hhmm(Date.parse(checkInStamp.offlineCapturedAt)))}</span>
              )}
            </span>
          </p>
        )}

        {vehicle && (
          <section aria-label={t.driver} className="flex items-start gap-4">
            {driverName ? (
              <>
                <DriverPhoto driver={driverQ.data ?? null} name={driverName} online={online} />
                <div className="min-w-0 pt-1">
                  <p className="text-sm font-semibold text-slate-600">{t.driver}</p>
                  <p className="text-2xl leading-tight font-extrabold break-words text-slate-950">{driverName}</p>
                </div>
              </>
            ) : (
              <p className="text-base font-semibold text-slate-700">{t.noDriver}</p>
            )}
          </section>
        )}

        {pass && (pass.supervisor || pass.officer) && (
          <section aria-labelledby="approved-by" className="rounded-xl bg-slate-100 px-3 py-2.5 text-base text-slate-900">
            <h2 id="approved-by" className="text-sm font-bold text-slate-700">{t.approvedBy}</h2>
            {pass.supervisor && <p className="font-semibold">{t.supervisorLine(pass.supervisor.name, hhmm(pass.supervisor.at?.toMillis()))}</p>}
            {pass.officer && <p className="font-semibold">{t.officerLine(pass.officer.name, hhmm(pass.officer.at?.toMillis()))}</p>}
          </section>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-base font-bold text-red-800">{error}</p>}
        {readOnly && <p className="text-sm text-slate-600">{t.readOnly}</p>}
      </main>

      {!readOnly && (
        <div className="sticky bottom-0 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg space-y-2">
            {canCheckIn(result) ? (
              <>
                <button
                  type="button"
                  onClick={() => void doCheckIn()}
                  disabled={checkingIn}
                  aria-busy={checkingIn}
                  className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-emerald-700 text-3xl font-black tracking-tight text-white hover:bg-emerald-800 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-emerald-900 disabled:opacity-70"
                >
                  <CircleCheckBig aria-hidden className="size-8" />
                  {checkingIn ? t.checkingIn : online ? t.checkIn : t.checkInOffline}
                </button>
                <button
                  type="button"
                  onClick={openDeny}
                  className="h-12 w-full rounded-xl text-base font-bold text-red-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-red-800"
                >
                  {t.denyLink}
                </button>
              </>
            ) : (
              <div className="flex gap-2">
                {canDeny(result) && (
                  <button
                    type="button"
                    onClick={openDeny}
                    className="h-16 flex-1 rounded-2xl border-2 border-red-700 bg-white text-lg font-extrabold text-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
                  >
                    {t.recordDenied}
                  </button>
                )}
                <button
                  type="button"
                  onClick={scanNext}
                  className="flex h-16 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-900 text-lg font-extrabold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
                >
                  <ScanLine aria-hidden className="size-6" />
                  {t.scanNext}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!readOnly && vehicle && (
        <DenySheet open={denying} plateNo={vehicle.plateNo} loading={denyingNow} onConfirm={(c) => void doDeny(c)} onCancel={() => setDenying(false)} />
      )}
      {!readOnly && (
        <GatePicker
          open={picking !== null}
          gates={gates}
          current={gate?.id ?? null}
          onClose={() => setPicking(null)}
          onPick={(id) => {
            const chosen = gates.find((g) => g.id === id) ?? null
            setGate(id)
            const then = picking
            setPicking(null)
            if (then === 'checkIn') void doCheckIn(chosen)
            if (then === 'deny') setDenying(true)
          }}
        />
      )}
    </div>
  )
}
