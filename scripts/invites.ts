/**
 * Setup invites. One invite = one link = one new workspace and its first admin.
 *
 *   npm run invite:create -- --env emulator --company "Acme Quarry" --lock-email ops@acme.test --expires-days 7
 *   npm run invite:list   -- --env staging
 *   npm run invite:revoke -- --env prod --confirm-prod 1a2b3c4d
 *
 * Needs APP_BASE_URL (the public origin, e.g. https://app.convoypass.com; read from the environment or `.env`).
 * Staging and production use Application Default Credentials. The link is printed once; only its hash is stored.
 */
import { Timestamp } from 'firebase-admin/firestore'
import { confirmedProd, connect, loadDotEnv, readJson, targetFrom } from './adminSdk.ts'
import type { Firebaserc } from './envTarget.ts'
import { runInvitesCli, type InviteStore, type StoredInvite } from './invitesCli.ts'

loadDotEnv()
const argv = process.argv.slice(2)
const envFlag = argv.find((_a, i) => argv[i - 1] === '--env')

const lazyStore = (): InviteStore => {
  // Connect only once the CLI has accepted the target (so a refused production call never initialises anything).
  const { db } = connect(targetFrom(envFlag, confirmedProd({ 'confirm-prod': argv.includes('--confirm-prod'), 'confirm-production': argv.includes('--confirm-production') })))
  const col = db.collection('setupInvites')
  const ms = (v: unknown): number | null => (v instanceof Timestamp ? v.toMillis() : null)
  return {
    create: async (hash, i) => {
      await col.doc(hash).create({
        createdAt: Timestamp.fromMillis(i.createdAtMs),
        expiresAt: Timestamp.fromMillis(i.expiresAtMs),
        ...(i.companyHint ? { companyHint: i.companyHint } : {}),
        ...(i.emailLock ? { emailLock: i.emailLock } : {}),
        claimedAt: null, claimId: null, usedAt: null, tenantId: null,
      })
    },
    list: async () =>
      (await col.get()).docs.map((d): { hash: string; invite: StoredInvite } => {
        const x = d.data()
        return {
          hash: d.id,
          invite: {
            createdAtMs: ms(x.createdAt) ?? 0, expiresAtMs: ms(x.expiresAt) ?? 0, claimedAtMs: ms(x.claimedAt), usedAtMs: ms(x.usedAt),
            tenantId: typeof x.tenantId === 'string' ? x.tenantId : null,
            ...(typeof x.companyHint === 'string' ? { companyHint: x.companyHint } : {}),
            ...(typeof x.emailLock === 'string' ? { emailLock: x.emailLock } : {}),
          },
        }
      }),
    delete: async (hash) => void (await col.doc(hash).delete()),
  }
}

let cached: InviteStore | undefined
const store: InviteStore = {
  create: (h, i) => (cached ??= lazyStore()).create(h, i),
  list: () => (cached ??= lazyStore()).list(),
  delete: (h) => (cached ??= lazyStore()).delete(h),
}

runInvitesCli(argv, {
  store, now: () => Date.now(), out: (l) => console.log(l), appBaseUrl: process.env.APP_BASE_URL, firebaserc: readJson<Firebaserc>('.firebaserc'),
})
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('invites failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
