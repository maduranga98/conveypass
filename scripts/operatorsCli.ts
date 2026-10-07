// Platform operators (Module 9), script-only: there is no signup, callable or UI that can create or promote one.
//   npm run operator:create  -- --env staging --email olive@convoypass.com --name "Olive" [--password …]
//   npm run operator:disable -- --env prod --confirm-prod --email olive@convoypass.com
// Logic only; `create-operator.ts` / `disable-operator.ts` wire the Admin SDK to it.
// An operator has custom claims { role: 'platform', platformAdmin: true } and NO tenantId, an `operators/{uid}` doc and no
// `users` doc, so every tenant rule denies them. Output is the only place a generated password ever appears.
import { parseArgs } from 'node:util'
import { isCommonPassword } from '../functions/src/auth/commonPasswords.ts'
import { platformAudit, type PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'
import { randomTempPassword } from './adminResetCli.ts'
import { resolveTarget, type Firebaserc } from './envTarget.ts'

export const OPERATOR_PASSWORD_MIN_LENGTH = 12
export const OPERATOR_CLAIMS = { role: 'platform', platformAdmin: true } as const

export interface OperatorIo {
  auth: {
    getUserByEmail(email: string): Promise<{ uid: string } | null>
    createUser(p: { email: string; password: string; displayName: string; emailVerified: true }): Promise<{ uid: string }>
    setCustomUserClaims(uid: string, claims: typeof OPERATOR_CLAIMS): Promise<void>
    deleteUser(uid: string): Promise<void>
    disableUser(uid: string): Promise<void>
    revokeRefreshTokens(uid: string): Promise<void>
  }
  db: {
    /** Any `users` doc with this email (a tenant account), even when its Auth user is gone. */
    tenantUserExistsWithEmail(email: string): Promise<boolean>
    getOperator(uid: string): Promise<{ status: string } | null>
    createOperator(uid: string, doc: { name: string; email: string; status: 'active' }, audit: PlatformAuditEntry): Promise<void>
    disableOperator(uid: string, audit: PlatformAuditEntry): Promise<void>
  }
  out: (line: string) => void
  firebaserc: Firebaserc
  randomPassword: () => string
}

class UsageError extends Error {}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const COMMON_OPTIONS = {
  env: { type: 'string' },
  'confirm-prod': { type: 'boolean', default: false },
  'confirm-production': { type: 'boolean', default: false },
  email: { type: 'string' },
} as const

const targetOf = (v: { env?: string | undefined; 'confirm-prod'?: boolean | undefined; 'confirm-production'?: boolean | undefined }, io: OperatorIo) => {
  try {
    return resolveTarget({ env: v.env, confirmProduction: Boolean(v['confirm-prod'] || v['confirm-production']), firebaserc: io.firebaserc })
  } catch (e) {
    throw new UsageError(e instanceof Error ? e.message.replace('--confirm-production', '--confirm-prod') : String(e))
  }
}

export function assertOperatorPassword(password: string, email: string): void {
  if (password.length < OPERATOR_PASSWORD_MIN_LENGTH) throw new UsageError(`the password must be at least ${OPERATOR_PASSWORD_MIN_LENGTH} characters`)
  if (password.toLowerCase() === email) throw new UsageError('the password must not be the email address')
  if (isCommonPassword(password)) throw new UsageError('that password is too common')
}

export async function runCreateOperator(argv: string[], io: OperatorIo): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: { ...COMMON_OPTIONS, name: { type: 'string' }, password: { type: 'string' } } })
    // Production is refused here, before anything is read or written.
    const target = targetOf(values, io)
    const email = (values.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) throw new UsageError('--email is required and must be a valid address (use a company mailbox)')
    const name = (values.name ?? '').trim()
    if (name.length < 1 || name.length > 100) throw new UsageError('--name is required (1-100 characters)')
    const generated = values.password === undefined
    const password = values.password ?? io.randomPassword()
    assertOperatorPassword(password, email)

    // Never turn an existing account into an operator: not a tenant user, not another operator, not anyone.
    if (await io.auth.getUserByEmail(email)) throw new UsageError('an account with that email already exists (a tenant user or another account): operators need their own mailbox')
    if (await io.db.tenantUserExistsWithEmail(email)) throw new UsageError('that email belongs to a tenant user: operators need their own mailbox')

    const { uid } = await io.auth.createUser({ email, password, displayName: name, emailVerified: true })
    try {
      await io.auth.setCustomUserClaims(uid, OPERATOR_CLAIMS)
      await io.db.createOperator(uid, { name, email, status: 'active' }, platformAudit('script', 'operator.created', uid, { env: target.env }))
    } catch (e) {
      await io.auth.deleteUser(uid).catch(() => undefined) // no half-made operator
      throw e
    }
    io.out(`operator:create (${target.env}): created ${email}`)
    if (generated) {
      io.out('')
      io.out(`  password: ${password}`)
      io.out('')
      io.out('This password is shown ONCE. Store it in a password manager now, then sign in with the Staff tab and change nothing else.')
    }
    io.out('Recommended before the first paying client: enable MFA through Identity Platform (docs/ops.md).')
    return 0
  } catch (e) {
    io.out(`operator:create: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

export async function runDisableOperator(argv: string[], io: OperatorIo): Promise<number> {
  try {
    const { values } = parseArgs({ args: argv, options: COMMON_OPTIONS })
    const target = targetOf(values, io)
    const email = (values.email ?? '').trim().toLowerCase()
    if (!EMAIL.test(email)) throw new UsageError('--email is required')
    const user = await io.auth.getUserByEmail(email)
    // Only operators: this script must never be a way to lock a tenant user out.
    const operator = user ? await io.db.getOperator(user.uid) : null
    if (!user || !operator) throw new UsageError(`no operator with ${email}`)
    await io.auth.disableUser(user.uid)
    await io.auth.revokeRefreshTokens(user.uid)
    await io.db.disableOperator(user.uid, platformAudit('script', 'operator.disabled', user.uid, { env: target.env }))
    io.out(`operator:disable (${target.env}): ${email} is disabled and signed out everywhere.`)
    return 0
  } catch (e) {
    io.out(`operator:disable: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

export { randomTempPassword }
