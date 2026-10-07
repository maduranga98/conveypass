import { z } from 'zod'
import { ROLES } from './types.js'
import { VEHICLE_TYPES } from './vehicleTypes.js'

const name = z.string().trim().min(1).max(100)

export const createUserSchema = z.object({
  role: z.enum(ROLES),
  name,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  phone: z.string().trim().max(30).optional(),
  contractorId: z.string().trim().min(1).max(128).optional(),
  licenseNo: z.string().trim().max(30).optional(),
  password: z.string().min(1).max(128),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z
  .object({
    uid: z.string().min(1).max(128),
    name: name.optional(),
    phone: z.string().trim().max(30).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    /** Drivers only. `null` clears it. */
    licenseNo: z.string().trim().max(30).nullable().optional(),
    /** Drivers only. Must equal the canonical Storage path; checked against the target in core. */
    photoPath: z.string().max(300).optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.phone !== undefined ||
      v.status !== undefined ||
      v.licenseNo !== undefined ||
      v.photoPath !== undefined,
    { message: 'Nothing to update' },
  )
export type UpdateUserInput = z.infer<typeof updateUserSchema>

export const resetCredentialSchema = z.object({
  uid: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
})
export type ResetCredentialInput = z.infer<typeof resetCredentialSchema>

export const changeOwnPasswordSchema = z.object({
  newPassword: z.string().min(1).max(128),
})
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordSchema>

// ---- Module 2: vehicles and contractors ------------------------------------------------------

const id = z.string().trim().min(1).max(128)
export const VEHICLE_ID_PATTERN = /^veh_[a-z0-9]{10}$/
const vehicleId = z.string().regex(VEHICLE_ID_PATTERN)
const plateNo = z.string().max(40)
const makeModel = z.string().trim().max(60)
const driverIds = z.array(id).max(50)

export const createVehicleSchema = z.object({
  contractorId: id.optional(),
  plateNo,
  type: z.enum(VEHICLE_TYPES),
  makeModel: makeModel.optional(),
  driverIds: driverIds.optional(),
})

export const updateVehicleSchema = z
  .object({
    vehicleId,
    plateNo: plateNo.optional(),
    type: z.enum(VEHICLE_TYPES).optional(),
    makeModel: makeModel.optional(),
  })
  .refine((v) => v.plateNo !== undefined || v.type !== undefined || v.makeModel !== undefined, {
    message: 'Nothing to update',
  })

export const setVehicleStatusSchema = z.object({ vehicleId, status: z.enum(['active', 'suspended']) })
export const setVehicleDriversSchema = z.object({ vehicleId, driverIds })

export const MAX_IMPORT_ROWS = 200
/** Rows are validated one by one in core so a single bad row never fails the batch; this only bounds the shape. */
export const importVehiclesSchema = z.object({
  contractorId: id.optional(),
  rows: z
    .array(z.object({ plateNo: z.string().max(100), type: z.string().max(100), makeModel: z.string().max(200).nullish() }))
    .min(1)
    .max(MAX_IMPORT_ROWS),
})

export const setContractorStatusSchema = z.object({ contractorId: id, status: z.enum(['active', 'suspended']) })
