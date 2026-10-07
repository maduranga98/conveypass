// Shared by the operator scripts that talk to a real or emulated project (invites, admin recovery).
// Production needs `--confirm-prod` (the older `--confirm-production` is accepted too); see envTarget.ts.
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'node:fs'
import { loopback, resolveTarget, type Firebaserc, type Target } from './envTarget.ts'

export const readJson = <T,>(path: string): T | Record<string, never> => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return {}
  }
}

/** Loads `.env` for scripts (APP_BASE_URL) without overriding the real environment. Missing file is fine. */
export function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env')
  } catch {
    /* no .env */
  }
}

export const confirmedProd = (values: { 'confirm-prod'?: boolean | undefined; 'confirm-production'?: boolean | undefined }): boolean =>
  Boolean(values['confirm-prod'] || values['confirm-production'])

export function targetFrom(env: string | undefined, confirmProduction: boolean, firebaserc: Firebaserc = readJson<Firebaserc>('.firebaserc')): Target {
  return resolveTarget({ env, confirmProduction, firebaserc, projectOverride: process.env.FIREBASE_PROJECT_ID })
}

/** Points the Admin SDK at the target (emulator hosts from firebase.json, or ADC for a real project) and returns it. */
export function connect(target: Target): { auth: ReturnType<typeof getAuth>; db: ReturnType<typeof getFirestore> } {
  const firebaseJson = readJson<{ emulators?: Record<string, { port?: number }> }>('firebase.json')
  if (target.env === 'emulator') {
    process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.auth?.port ?? 9099}`
    process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${firebaseJson.emulators?.firestore?.port ?? 8080}`
    if (!loopback(process.env.FIREBASE_AUTH_EMULATOR_HOST) || !loopback(process.env.FIRESTORE_EMULATOR_HOST)) {
      throw new Error('emulator hosts must be loopback addresses')
    }
  } else {
    // A real project: make sure no leftover emulator variable redirects the writes.
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST
    delete process.env.FIRESTORE_EMULATOR_HOST
  }
  initializeApp({ projectId: target.projectId ?? readJson<Firebaserc>('.firebaserc').projects?.default ?? 'demo-conveypass' })
  return { auth: getAuth(), db: getFirestore() }
}
