import { CircleCheckBig, OctagonX, ScanLine, WifiOff } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { NotificationBanner } from '@/components/ui/NotificationBanner'
import { useGates } from '@/features/gate/useGate'
import { useOnline } from '@/features/passes/useOnline'
import { useSession } from '@/features/auth/useAuth'
import { checkInVisit } from '@/lib/api'
import { apiErrorMessage, apiErrorReason } from '@/lib/errors'
import { db } from '@/lib/firebase'
import { newVisitId } from '@/lib/ids'
import { newRequestId } from '@/lib/requestId'
import { strings } from '@/lib/strings'
import type { Vehicle } from '@/types'
import type { CheckInVisitResult } from '@/types/visits'
import { DRIVER_PIN_LENGTH, PinKeypad } from './PinKeypad'
import { deniedReasons } from './reasons'
import { clock } from './time'

const t = strings.visits.checkIn
const QrScanner = lazy(() => import('@/features/scan/QrScanner').then((m) => ({ default: m.QrScanner })))

type Step =
  | { kind: 'scan' }
  | { kind: 'pin'; vehicleId: string; plateNo: string }
  | { kind: 'sending'; vehicleId: string; plateNo: string }
  | { kind: 'result'; plateNo: string; result: CheckInVisitResult }
  /** A refusal that is not about the PIN (driver already on a visit, vehicle already on site, suspended...). */
  | { kind: 'refused'; plateNo: string; title: string; body: string }

/** Reasons that mean "the driver typed it fine, but this visit cannot start". They end the attempt; a wrong PIN does not. */
const REFUSAL_TITLES: Partial<Record<NonNullable<ReturnType<typeof apiErrorReason>>, string>> = {
  'driver-on-duty': t.dutyTitle,
  'vehicle-on-site': t.siteTitle,
  'vehicle-suspended': t.suspendedTitle,
  'contractor-suspended': t.suspendedTitle,
  'driver-inactive': t.suspendedTitle,
}

/**
 * Security: scan the vehicle, the driver types their PIN, the server runs the shared eligibility check and either lets
 * the vehicle in (and locks the driver) or says exactly why not. Needs the internet: the PIN is checked on the server.
 */
export default function CheckInPage() {
  const online = useOnline()
  const { claims } = useSession()
  const { gate } = useGates()
  const [step, setStep] = useState<Step>({ kind: 'scan' })
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(true)
  // One visit id and request id per attempt: a retry of the same attempt can never create a second visit.
  const attempt = useRef<{ visitId: string; requestId: string } | null>(null)

  const reset = () => {
    attempt.current = null
    setPin('')
    setError(null)
    setStep({ kind: 'scan' })
    setScanning(true)
  }

  const onVehicle = async (vehicleId: string) => {
    setScanning(false)
    setError(null)
    try {
      const snap = await getDoc(doc(db, 'vehicles', vehicleId))
      const v = snap.exists() ? (snap.data() as Vehicle) : null
      if (!v || v.tenantId !== claims.tenantId) {
        setError(strings.visits.unknownQr)
        setStep({ kind: 'scan' })
        return
      }
      attempt.current = { visitId: newVisitId(), requestId: newRequestId() }
      setPin('')
      setStep({ kind: 'pin', vehicleId, plateNo: v.plateNo })
    } catch (e) {
      // permission-denied means the QR is not one of this company's vehicles.
      setError((e as { code?: string }).code === 'permission-denied' ? strings.visits.unknownQr : apiErrorMessage(e))
      setStep({ kind: 'scan' })
    }
  }

  const send = async (digits: string, vehicleId: string, plateNo: string) => {
    const a = attempt.current ?? { visitId: newVisitId(), requestId: newRequestId() }
    attempt.current = a
    setStep({ kind: 'sending', vehicleId, plateNo })
    setError(null)
    try {
      const result = await checkInVisit({ visitId: a.visitId, requestId: a.requestId, vehicleId, pin: digits, ...(gate ? { gateId: gate.id } : {}) })
      setPin('')
      setStep({ kind: 'result', plateNo: result.plateNo, result })
    } catch (e) {
      setPin('')
      const reason = apiErrorReason(e)
      const title = reason ? REFUSAL_TITLES[reason] : undefined
      if (title) {
        setStep({ kind: 'refused', plateNo, title, body: apiErrorMessage(e) })
      } else {
        // A wrong PIN (or a network problem): stay on the keypad with the reason; the same attempt ids are reused.
        setError(reason === 'pin-invalid' ? t.pinWrong : apiErrorMessage(e))
        setStep({ kind: 'pin', vehicleId, plateNo })
      }
    }
  }

  const onPin = (next: string) => {
    setPin(next)
    if (next.length === DRIVER_PIN_LENGTH && (step.kind === 'pin')) void send(next, step.vehicleId, step.plateNo)
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-5">
      <h1 className="text-3xl font-black tracking-tight text-brand">{t.title}</h1>

      {!online && (
        <NotificationBanner tone="warning" size="lg" title={strings.visits.noConnection}>
          <span className="inline-flex items-center gap-2"><WifiOff aria-hidden className="size-5" />{strings.visits.noConnectionBody}</span>
        </NotificationBanner>
      )}
      {error && <NotificationBanner tone="error" size="lg" role="alert">{error}</NotificationBanner>}

      {step.kind === 'scan' && (
        <>
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex h-24 w-full items-center justify-center gap-4 rounded-3xl bg-brand text-3xl font-black tracking-tight text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <ScanLine aria-hidden className="size-10" />
            {t.scan}
          </button>
          <p className="text-lg text-slate-700">{t.scanHint}</p>
        </>
      )}

      {(step.kind === 'pin' || step.kind === 'sending') && (
        <section aria-labelledby="pin-title" className="space-y-4">
          <div className="rounded-2xl border-2 border-slate-200 bg-surface p-4">
            <p className="text-sm font-bold text-slate-700">{strings.visits.checkIn.pinTitle}</p>
            <p className="text-3xl leading-tight font-black tracking-tight text-brand">{step.plateNo}</p>
          </div>
          <h2 id="pin-title" className="text-xl font-bold text-brand">{t.pinHint}</h2>
          <PinKeypad value={pin} onChange={onPin} disabled={step.kind === 'sending' || !online} label={t.pinLabel} />
          <p role="status" className="min-h-6 text-center text-lg font-semibold text-slate-700">{step.kind === 'sending' ? t.checking : ''}</p>
          <button type="button" onClick={reset} disabled={step.kind === 'sending'} className="h-14 w-full rounded-2xl border-2 border-slate-300 text-lg font-bold text-brand focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50">
            {t.back}
          </button>
        </section>
      )}

      {step.kind === 'result' && step.result.outcome === 'checked_in' && (
        <section role="status" className="space-y-4 rounded-3xl bg-success-strong p-6 text-on-solid">
          <CircleCheckBig aria-hidden className="size-16" />
          <p className="text-5xl font-black tracking-tight">{t.allowed}</p>
          <p className="text-4xl leading-tight font-black tracking-tight">{step.plateNo}</p>
          <p className="text-xl font-semibold">{t.allowedBody(step.result.driverName)}</p>
          <p className="text-lg">{t.checkedInAt(clock(step.result.at))}</p>
        </section>
      )}

      {step.kind === 'result' && step.result.outcome === 'blocked' && (
        <section role="alert" className="space-y-4 rounded-3xl bg-danger-strong p-6 text-on-solid">
          <OctagonX aria-hidden className="size-16" />
          <p className="text-5xl font-black tracking-tight">{t.denied}</p>
          <p className="text-4xl leading-tight font-black tracking-tight">{step.plateNo}</p>
          <p className="text-xl font-semibold">{t.allowedBody(step.result.driverName)}</p>
          <div>
            <p className="text-lg font-bold">{t.deniedFor}</p>
            <ul className="mt-1 list-disc space-y-1 pl-6 text-xl font-semibold">
              {deniedReasons(step.result.eligibility).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {step.kind === 'refused' && (
        <section role="alert" className="space-y-3 rounded-3xl bg-danger-strong p-6 text-on-solid">
          <OctagonX aria-hidden className="size-16" />
          <p className="text-4xl font-black tracking-tight">{step.title}</p>
          <p className="text-3xl leading-tight font-black tracking-tight">{step.plateNo}</p>
          <p className="text-xl font-semibold">{step.body}</p>
        </section>
      )}

      {(step.kind === 'result' || step.kind === 'refused') && (
        <button
          type="button"
          onClick={reset}
          className="h-16 w-full rounded-2xl bg-brand text-xl font-black text-on-solid hover:bg-brand-hover focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {t.next}
        </button>
      )}

      <Link to="/security" className="block py-2 text-center text-base font-semibold text-slate-700 underline">{strings.visits.checkOut.cancel}</Link>

      {scanning && step.kind === 'scan' && (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-scrim text-lg font-semibold text-on-solid">{strings.scanner.starting}</div>}>
          <QrScanner onClose={() => setScanning(false)} onVehicle={(id) => void onVehicle(id)} />
        </Suspense>
      )}
    </div>
  )
}
