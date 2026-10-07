import { httpsCallable } from 'firebase/functions'
import type { Role } from './roles'
import { functions } from './firebase'

export interface CreateUserPayload {
  role: Role
  name: string
  email?: string
  phone?: string
  contractorId?: string
  password: string
}

export interface UpdateUserPayload {
  uid: string
  name?: string
  phone?: string
  status?: 'active' | 'disabled'
}

const call = <Req, Res>(name: string) => {
  const fn = httpsCallable<Req, Res>(functions, name)
  return async (payload: Req): Promise<Res> => (await fn(payload)).data
}

export const createUser = call<CreateUserPayload, { uid: string }>('createUser')
export const updateUser = call<UpdateUserPayload, { ok: true }>('updateUser')
export const resetCredential = call<{ uid: string; newPassword: string }, { ok: true }>('resetCredential')
export const changeOwnPassword = call<{ newPassword: string }, { ok: true }>('changeOwnPassword')
