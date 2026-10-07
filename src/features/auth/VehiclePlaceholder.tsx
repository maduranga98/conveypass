import { Link } from 'react-router-dom'
import { ROLE_HOME } from '@/lib/roles'
import { strings } from '@/lib/strings'
import { useSession } from './useAuth'

/** Staff view of a vehicle QR. Security's real view arrives in a later module. */
export default function VehiclePlaceholder() {
  const { claims } = useSession()
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{strings.vehicle.title}</h1>
      <p className="mt-2 text-sm text-slate-500">{strings.vehicle.comingSoon}</p>
      <Link to={ROLE_HOME[claims.role]} className="mt-6 inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50">
        {strings.errorPages.goHome}
      </Link>
    </main>
  )
}
