import { useParams } from 'react-router-dom'
import { useSession } from '@/features/auth/useAuth'
import VehiclePlaceholder from '@/features/auth/VehiclePlaceholder'
import DriverVehicleGate from './DriverVehicleGate'

/** `/v/:vehicleId`: drivers get the pre-trip flow; every other role a placeholder until its own module exists. */
export default function VehicleRoute() {
  const { vehicleId = '' } = useParams()
  const { claims } = useSession()
  return claims.role === 'driver' ? <DriverVehicleGate vehicleId={vehicleId} /> : <VehiclePlaceholder />
}
