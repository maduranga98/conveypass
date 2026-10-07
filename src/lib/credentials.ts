// Mirrors functions/src/credentials.ts (functions deploy from their own folder). Keep both copies, and their tests, in sync.
import { z } from 'zod'

export const DRIVER_EMAIL_DOMAIN = 'drivers.convoypass.com'

/** `07XXXXXXXX` or `+947XXXXXXXX` -> `947XXXXXXXX`. Anything else -> null. */
export function normalisePhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-()]/g, '')
  let national: string | null = null
  if (/^07\d{8}$/.test(compact)) national = compact.slice(1)
  else if (/^\+947\d{8}$/.test(compact)) national = compact.slice(3)
  return national ? `94${national}` : null
}

export function driverEmail(normalisedPhone: string): string {
  return `${normalisedPhone}@${DRIVER_EMAIL_DOMAIN}`
}

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export const isValidPin = (v: string): boolean => /^\d{6}$/.test(v)
export const isValidPassword = (v: string): boolean =>
  v.length >= PASSWORD_MIN_LENGTH && v.length <= PASSWORD_MAX_LENGTH

export const staffPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)
export const pinSchema = z.string().regex(/^\d{6}$/)

/** `94771234567` -> `077 123 4567` for display. */
export function formatPhone(normalised: string): string {
  const m = /^94(7\d)(\d{3})(\d{4})$/.exec(normalised)
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : normalised
}

function randomInt(max: number): number {
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x100000000 / max) * max
  do crypto.getRandomValues(buf)
  while ((buf[0] as number) >= limit)
  return (buf[0] as number) % max
}

export const generatePin = (): string => String(randomInt(1_000_000)).padStart(6, '0')

// No look-alike characters (0/O, 1/l/I).
const PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function generatePassword(length = 12): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('')
}
