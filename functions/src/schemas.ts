import { z } from 'zod'
import { ROLES } from './types.js'
import { VEHICLE_TYPES } from './vehicleTypes.js'
import { GATE_ID_PATTERN, GATE_NAME_MAX, GATE_NAME_MIN, MAX_GATES, MIN_GATES } from './gates.js'
import { MAX_DENY_NOTE } from './denyReasons.js'
import { SLA_MAX, SLA_MIN } from './defaultSla.js'

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

// ---- Module 3: passes ------------------------------------------------------------------------

export const MAX_ATTEMPTS = 5
export const MAX_CHECKLIST_ITEMS = 12
export const CHECKLIST_ID_PATTERN = /^[a-z0-9_]{2,40}$/

export const resolveVehicleSchema = z.object({ vehicleId: z.string().max(128) })

const isoString = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'invalid date')

export const submitPassSchema = z.object({
  vehicleId,
  attempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  checklist: z
    .array(
      z.object({
        id: z.string().max(60),
        answer: z.enum(['yes', 'no']),
        note: z.string().max(300).optional(),
      }),
    )
    .max(MAX_CHECKLIST_ITEMS),
  extraCount: z.number().int().min(0).max(2),
  captureMeta: z.object({
    method: z.enum(['live', 'file']),
    clientCapturedAt: z.object({ gps: isoString, dashcam: isoString }),
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).max(100_000),
      })
      .optional(),
  }),
})

export const MAX_BULK_ITEMS = 50
export const REASON_ID_PATTERN = /^[a-z0-9_]{2,40}$/
export const MIN_REJECTION_NOTE = 3
export const MAX_REJECTION_NOTE = 200

const passId = z.string().min(1).max(128)
const reasonCode = z.string().max(40)
const rejectionNote = z.string().trim().max(MAX_REJECTION_NOTE)

export const decidePassSchema = z.object({
  passId,
  action: z.enum(['approve', 'reject']),
  expectedStatus: z.enum(['submitted', 'supervisor_approved', 'officer_approved', 'checked_in', 'rejected']),
  expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  reasonCode: reasonCode.optional(),
  note: rejectionNote.optional(),
})

export const bulkApproveSchema = z.object({
  items: z
    .array(z.object({ passId, expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS) }))
    .min(1)
    .max(MAX_BULK_ITEMS),
})

export const revokePassSchema = z.object({
  passId,
  reasonCode,
  note: rejectionNote.optional(),
  /** Optional guard: when given, the pass must still be on this attempt. */
  expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS).optional(),
})

export const updateTenantSettingsSchema = z
  .object({
    passSettings: z
      .object({ requireLocation: z.boolean(), maxExtraPhotos: z.number().int().min(0).max(2) })
      .optional(),
    checklist: z
      .array(
        z.object({
          id: z.string().regex(CHECKLIST_ID_PATTERN),
          label: z.string().trim().min(3).max(60),
          failBlocks: z.boolean(),
        }),
      )
      .min(1)
      .max(MAX_CHECKLIST_ITEMS)
      .optional(),
    rejectionReasons: z
      .array(z.object({ id: z.string().regex(REASON_ID_PATTERN), label: z.string().trim().min(3).max(60) }))
      .min(2)
      .max(10)
      .optional(),
    gates: z
      .array(z.object({ id: z.string().regex(GATE_ID_PATTERN), name: z.string().trim().min(GATE_NAME_MIN).max(GATE_NAME_MAX) }))
      .min(MIN_GATES)
      .max(MAX_GATES)
      .optional(),
    sla: z
      .object({
        supervisorMinutes: z.number().int().min(SLA_MIN).max(SLA_MAX),
        officerMinutes: z.number().int().min(SLA_MIN).max(SLA_MAX),
      })
      .optional(),
  })
  .refine(
    (v) => v.passSettings !== undefined || v.checklist !== undefined || v.rejectionReasons !== undefined || v.gates !== undefined || v.sla !== undefined,
    { message: 'Nothing to update' },
  )

// ---- Module 5: the gate ----------------------------------------------------------------------

/** Client UUID that makes a gate call idempotent. */
const requestId = z.uuid()
const gateId = z.string().min(1).max(40)

export const checkInSchema = z.object({
  passId,
  expectedAttempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  gateId,
  requestId,
  /** Device time of a check-in captured offline. Bounded in core, never trusted beyond that. */
  offlineCapturedAt: isoString.optional(),
})

export const denyEntrySchema = z.object({
  vehicleId,
  reasonCode,
  note: z.string().trim().max(MAX_DENY_NOTE).optional(),
  gateId,
  requestId,
})
