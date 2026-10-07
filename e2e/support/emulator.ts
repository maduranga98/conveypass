// Test-side wrapper around the Admin SDK helper (a separate process: see admin.ts).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { PLATE, VEHICLE } from './constants.ts'

export * from './constants.ts'

const SEED_FILE = 'e2e/.seed.json'

function admin<T>(command: string, args: Record<string, string> = {}): T {
  const out = execFileSync('npx', ['tsx', 'e2e/support/admin.ts', command, JSON.stringify(args)], { encoding: 'utf8', env: process.env })
  const line = out.split('\n').find((l) => l.startsWith('RESULT '))
  if (!line) throw new Error(`admin ${command}: no result\n${out}`)
  return JSON.parse(line.slice('RESULT '.length)) as T
}

export const seed = (): void => writeFileSync(SEED_FILE, JSON.stringify(admin<Record<string, string>>('seed')))
export const uids = (): Record<string, string> => JSON.parse(readFileSync(SEED_FILE, 'utf8')) as Record<string, string>

/** What `submitPass` leaves behind: the real Firestore trigger then notifies the contractor's supervisors. */
export const writePass = (status: string, vehicleId = VEHICLE, plateNo = PLATE): string =>
  admin<string>('writePass', { status, vehicleId, plateNo, driverId: uids().driver ?? '' })
export const writeSubmittedPass = (vehicleId = VEHICLE, plateNo = PLATE): string => writePass('submitted', vehicleId, plateNo)

export const notificationsFor = (uid: string) => admin<{ id: string; read: boolean }[]>('notificationsFor', { uid })
