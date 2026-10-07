import { z } from 'zod'
import { normalisePlate } from '@/lib/plate'
import { strings } from '@/lib/strings'
import { VEHICLE_TYPES } from '@/lib/vehicleTypes'

const e = strings.vehicles.errors

/** One schema for the add/edit form and for every CSV row. Mirrors the server-side rules in functions/src/schemas.ts. */
export const vehicleFieldsSchema = z.object({
  plateNo: z.string().refine((v) => normalisePlate(v) !== null, e.plate),
  type: z.enum(VEHICLE_TYPES, { error: e.type }),
  makeModel: z.string().trim().max(60, e.makeModel),
})
export type VehicleFields = z.infer<typeof vehicleFieldsSchema>
