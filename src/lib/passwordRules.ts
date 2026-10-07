// Staff password rules for new passwords chosen in the app (workspace setup, reset link, account page).
// Mirrors `assertSetupPassword` in functions/src/setup.ts. Drivers use a 6-digit PIN instead (see `pinProblem`).
import { isCommonPassword } from './commonPasswords'
import { isTrivialPin, isValidPin, PASSWORD_MAX_LENGTH } from './credentials'

export const STAFF_PASSWORD_MIN_LENGTH = 10

export interface PasswordChecks {
  length: boolean
  notEmail: boolean
  notCommon: boolean
}

/** `email` may be empty when it is not known; "not your email" then passes. */
export function checkStaffPassword(password: string, email: string = ''): PasswordChecks {
  const e = email.trim().toLowerCase()
  return {
    length: password.length >= STAFF_PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    notEmail: e === '' || password.toLowerCase() !== e,
    // An empty password is not "common"; it simply fails the length rule.
    notCommon: password === '' || !isCommonPassword(password),
  }
}

export const passwordAcceptable = (c: PasswordChecks): boolean => c.length && c.notEmail && c.notCommon

export type PinProblem = 'format' | 'trivial' | null

/** Driver PIN: exactly 6 digits and not one of the Module 2 weak patterns (000000, 123456, 121212 ...). */
export const pinProblem = (pin: string): PinProblem => (!isValidPin(pin) ? 'format' : isTrivialPin(pin) ? 'trivial' : null)
