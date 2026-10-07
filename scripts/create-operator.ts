/**
 * Creates a super admin (the person who runs ConvoyPass: creates workspaces and admins from /platform).
 *
 *   npm run superadmin:create -- --env staging --email olive@convoypass.com --name "Olive Operator"
 *   npm run superadmin:create -- --env prod --confirm-prod --email olive@convoypass.com --name "Olive" --password "<12+ chars>"
 *
 * Without --password a strong one is generated and printed once. The Auth user is created with a verified email and the
 * claims { role: 'platform', platformAdmin: true } (no tenantId); `operators/{uid}` and a `platformAuditLog` entry are
 * written. Refuses an email that already has any account. Staging and production use Application Default Credentials.
 */
import { runCreateOperator, type OperatorIo } from './operatorsCli.ts'
import { operatorIo } from './operatorIo.ts'

const argv = process.argv.slice(2)
const io: OperatorIo = operatorIo(argv)

runCreateOperator(argv, io)
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('superadmin:create failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
