/**
 * Recovers a locked-out admin (lost password, mailbox gone). Email reset from the login page comes first; this is the
 * operator fallback.
 *
 *   npm run admin:reset -- --env staging --email admin@acme.test --link
 *   npm run admin:reset -- --env staging --email admin@acme.test --temp-password
 *   npm run admin:reset -- --env prod --confirm-prod --email admin@acme.test --link
 *
 * `--link` prints a password reset link; `--temp-password` sets a random password (printed once, change forced,
 * sessions revoked). Only admins; writes an `admin.recovery` audit entry. Reset links use APP_BASE_URL for the continue URL.
 */
import { FieldValue } from 'firebase-admin/firestore'
import { confirmedProd, connect, loadDotEnv, readJson, targetFrom } from './adminSdk.ts'
import { randomTempPassword, runAdminReset, type AdminResetIo } from './adminResetCli.ts'
import type { Firebaserc } from './envTarget.ts'

loadDotEnv()
const argv = process.argv.slice(2)
const envFlag = argv.find((_a, i) => argv[i - 1] === '--env')

let sdk: ReturnType<typeof connect> | undefined
// Connect lazily: a refused production call never initialises the SDK.
const get = () => (sdk ??= connect(targetFrom(envFlag, confirmedProd({ 'confirm-prod': argv.includes('--confirm-prod'), 'confirm-production': argv.includes('--confirm-production') }))))

const io: AdminResetIo = {
  auth: {
    getUserByEmail: (email) => get().auth.getUserByEmail(email).catch(() => null),
    generatePasswordResetLink: (email, url) => get().auth.generatePasswordResetLink(email, url ? { url } : undefined),
    updatePassword: async (uid, password) => void (await get().auth.updateUser(uid, { password })),
    revokeRefreshTokens: (uid) => get().auth.revokeRefreshTokens(uid),
  },
  db: {
    getUser: async (uid) => (await get().db.doc(`users/${uid}`).get()).data() ?? null,
    requireChangeAtNextLogin: async (uid) => void (await get().db.doc(`users/${uid}`).update({ mustChangePassword: true, updatedAt: FieldValue.serverTimestamp() })),
    writeAudit: async (entry) => void (await get().db.collection('auditLog').doc().create({ ...entry, createdAt: FieldValue.serverTimestamp() })),
  },
  out: (l) => console.log(l),
  firebaserc: readJson<Firebaserc>('.firebaserc'),
  appBaseUrl: process.env.APP_BASE_URL,
  randomPassword: () => randomTempPassword(),
}

runAdminReset(argv, io)
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('admin:reset failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
