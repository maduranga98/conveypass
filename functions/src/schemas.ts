import { z } from 'zod'
import { ROLES } from './types.js'

const name = z.string().trim().min(1).max(100)

export const createUserSchema = z.object({
  role: z.enum(ROLES),
  name,
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  phone: z.string().trim().max(30).optional(),
  contractorId: z.string().trim().min(1).max(128).optional(),
  password: z.string().min(1).max(128),
})
export type CreateUserInput = z.infer<typeof createUserSchema>

export const updateUserSchema = z
  .object({
    uid: z.string().min(1).max(128),
    name: name.optional(),
    phone: z.string().trim().max(30).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => v.name !== undefined || v.phone !== undefined || v.status !== undefined, {
    message: 'Nothing to update',
  })
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
