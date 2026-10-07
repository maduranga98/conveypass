import { describe, expect, it } from 'vitest'
import { runCreateOperator, runDisableOperator, OPERATOR_CLAIMS, type OperatorIo } from './operatorsCli.ts'
import type { PlatformAuditEntry } from '../functions/src/platform/platformAudit.ts'

const RC = { projects: { default: 'demo', staging: 'conveypass-staging-1', prod: 'conveypass-prod-1' } }
const STRONG = 'Tr0ub4dor&3-horse-staple'

function setup(over: { authUsers?: string[]; tenantEmails?: string[]; operators?: string[]; failOperatorDoc?: boolean } = {}) {
  const lines: string[] = []
  const created: { uid: string; email: string; password: string; emailVerified: boolean }[] = []
  const claims = new Map<string, unknown>()
  const deleted: string[] = []
  const disabled: string[] = []
  const revoked: string[] = []
  const operators = new Map<string, { name: string; email: string; status: string }>(
    (over.operators ?? []).map((e) => [`u-${e}`, { name: 'x', email: e, status: 'active' }]),
  )
  const audits: PlatformAuditEntry[] = []
  const existing = new Map((over.authUsers ?? []).map((e) => [e, `u-${e}`]))
  let touched = 0
  const io: OperatorIo = {
    auth: {
      getUserByEmail: async (e) => { touched++; const uid = existing.get(e); return uid ? { uid } : null },
      createUser: async (p) => { touched++; const uid = `new${created.length + 1}`; created.push({ uid, ...p }); return { uid } },
      setCustomUserClaims: async (uid, c) => void claims.set(uid, c),
      deleteUser: async (uid) => void deleted.push(uid),
      disableUser: async (uid) => void disabled.push(uid),
      revokeRefreshTokens: async (uid) => void revoked.push(uid),
    },
    db: {
      tenantUserExistsWithEmail: async (e) => (over.tenantEmails ?? []).includes(e),
      getOperator: async (uid) => operators.get(uid) ?? null,
      createOperator: async (uid, doc, a) => {
        if (over.failOperatorDoc) throw new Error('firestore down')
        operators.set(uid, doc); audits.push(a)
      },
      disableOperator: async (uid, a) => { operators.set(uid, { ...operators.get(uid)!, status: 'disabled' }); audits.push(a) },
    },
    out: (l) => lines.push(l),
    firebaserc: RC,
    randomPassword: () => 'Gen3rated-Pass-9876',
  }
  return { io, lines, text: () => lines.join('\n'), created, claims, deleted, disabled, revoked, operators, audits, touched: () => touched }
}
const args = (...a: string[]) => ['--env', 'emulator', ...a]

describe('operator:create', () => {
  it('creates a verified Auth user with platform claims (no tenantId), an operators doc and an audit entry', async () => {
    const t = setup()
    expect(await runCreateOperator(args('--email', '  Olive@ConvoyPass.test ', '--name', 'Olive', '--password', STRONG), t.io)).toBe(0)
    expect(t.created).toEqual([{ uid: 'new1', email: 'olive@convoypass.test', password: STRONG, displayName: 'Olive', emailVerified: true }])
    expect(t.claims.get('new1')).toEqual({ role: 'platform', platformAdmin: true })
    expect(OPERATOR_CLAIMS).not.toHaveProperty('tenantId')
    expect(t.operators.get('new1')).toEqual({ name: 'Olive', email: 'olive@convoypass.test', status: 'active' })
    expect(t.audits).toEqual([{ actorUid: 'script', action: 'operator.created', targetRef: 'new1', meta: { env: 'emulator' } }])
    expect(t.text()).not.toContain(STRONG) // a password the operator chose is never echoed
    expect(t.text()).toMatch(/MFA/)
  })
  it('generates a strong password when none is given and prints it exactly once', async () => {
    const t = setup()
    expect(await runCreateOperator(args('--email', 'o@convoypass.test', '--name', 'Olive'), t.io)).toBe(0)
    expect(t.created[0]!.password).toBe('Gen3rated-Pass-9876')
    expect(t.text().split('Gen3rated-Pass-9876')).toHaveLength(2)
    expect(JSON.stringify(t.audits)).not.toContain('Gen3rated')
  })
  it('refuses weak passwords: under 12 characters, the email itself, common ones', async () => {
    for (const pw of ['Short-1', '12345678901', 'o@convoypass.test', 'password1234', 'qwertyuiop12'.slice(0, 11)]) {
      const t = setup()
      expect(await runCreateOperator(args('--email', 'o@convoypass.test', '--name', 'O', '--password', pw), t.io), pw).toBe(1)
      expect(t.created).toHaveLength(0)
      expect(t.text()).toMatch(/password/)
    }
    const t = setup()
    expect(await runCreateOperator(args('--email', 'o@convoypass.test', '--name', 'O', '--password', 'Twelve-chars'), t.io)).toBe(0)
  })
  it('refuses an email that already belongs to a tenant user (Auth user or users doc) or any account', async () => {
    const authOnly = setup({ authUsers: ['admin@acme.test'] })
    expect(await runCreateOperator(args('--email', 'admin@acme.test', '--name', 'A', '--password', STRONG), authOnly.io)).toBe(1)
    expect(authOnly.created).toHaveLength(0)
    expect(authOnly.claims.size).toBe(0)
    expect(authOnly.text()).toMatch(/already exists/)
    const docOnly = setup({ tenantEmails: ['sup@acme.test'] })
    expect(await runCreateOperator(args('--email', 'sup@acme.test', '--name', 'S', '--password', STRONG), docOnly.io)).toBe(1)
    expect(docOnly.created).toHaveLength(0)
    expect(docOnly.text()).toMatch(/tenant user/)
  })
  it('refuses production without --confirm-prod, before touching anything; allows it with the flag', async () => {
    const t = setup()
    expect(await runCreateOperator(['--env', 'prod', '--email', 'o@convoypass.test', '--name', 'O', '--password', STRONG], t.io)).toBe(1)
    expect(t.text()).toMatch(/--confirm-prod/)
    expect(t.touched()).toBe(0)
    expect(await runCreateOperator(['--email', 'o@convoypass.test', '--name', 'O', '--password', STRONG], t.io)).toBe(1) // no --env at all
    expect(t.touched()).toBe(0)
    expect(await runCreateOperator(['--env', 'prod', '--confirm-prod', '--email', 'o@convoypass.test', '--name', 'O', '--password', STRONG], t.io)).toBe(0)
    expect(t.audits[0]!.meta).toEqual({ env: 'prod' })
  })
  it('refuses a placeholder project, a bad email and a missing name', async () => {
    expect(await runCreateOperator(['--env', 'staging', '--email', 'o@x.test', '--name', 'O', '--password', STRONG], { ...setup().io, firebaserc: { projects: { staging: 'replace-with-staging-id' } } })).toBe(1)
    expect(await runCreateOperator(args('--email', 'nope', '--name', 'O', '--password', STRONG), setup().io)).toBe(1)
    expect(await runCreateOperator(args('--email', 'o@x.test', '--password', STRONG), setup().io)).toBe(1)
  })
  it('rolls the Auth user back when the operator doc cannot be written', async () => {
    const t = setup({ failOperatorDoc: true })
    expect(await runCreateOperator(args('--email', 'o@x.test', '--name', 'O', '--password', STRONG), t.io)).toBe(1)
    expect(t.deleted).toEqual(['new1'])
  })
})

describe('operator:disable', () => {
  it('disables the Auth user, revokes tokens, marks the doc and audits', async () => {
    const t = setup({ authUsers: ['o@x.test'], operators: ['o@x.test'] })
    expect(await runDisableOperator(args('--email', 'O@x.test'), t.io)).toBe(0)
    expect(t.disabled).toEqual(['u-o@x.test'])
    expect(t.revoked).toEqual(['u-o@x.test'])
    expect(t.operators.get('u-o@x.test')?.status).toBe('disabled')
    expect(t.audits).toEqual([{ actorUid: 'script', action: 'operator.disabled', targetRef: 'u-o@x.test', meta: { env: 'emulator' } }])
  })
  it('refuses anyone who is not an operator (a tenant user is never disabled by this script)', async () => {
    const t = setup({ authUsers: ['admin@acme.test'] })
    expect(await runDisableOperator(args('--email', 'admin@acme.test'), t.io)).toBe(1)
    expect(await runDisableOperator(args('--email', 'ghost@x.test'), t.io)).toBe(1)
    expect(t.disabled).toHaveLength(0)
    expect(t.revoked).toHaveLength(0)
  })
  it('refuses production without --confirm-prod', async () => {
    const t = setup({ authUsers: ['o@x.test'], operators: ['o@x.test'] })
    expect(await runDisableOperator(['--env', 'prod', '--email', 'o@x.test'], t.io)).toBe(1)
    expect(t.touched()).toBe(0)
  })
})
