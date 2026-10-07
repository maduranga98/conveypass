import { useParams } from 'react-router-dom'
import { strings } from '@/lib/strings'

/** Protected target of vehicle QR codes; real content arrives in a later module. */
export default function VehiclePlaceholder() {
  const { vehicleId = '' } = useParams()
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.vehicle.title}</h1>
      <p className="mt-2 text-sm text-slate-500">{strings.vehicle.placeholder(vehicleId)}</p>
    </main>
  )
}
