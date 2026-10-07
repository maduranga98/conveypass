// Keep in sync with functions/src/vehicleTypes.ts (functions deploy from their own folder).
export const VEHICLE_TYPES = [
  'Bulk Tanker',
  'Tipper',
  'Flatbed',
  'Container Carrier',
  'Lorry',
  'Cement Bulker',
  'Other',
] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

export const isVehicleType = (v: unknown): v is VehicleType =>
  typeof v === 'string' && (VEHICLE_TYPES as readonly string[]).includes(v)
