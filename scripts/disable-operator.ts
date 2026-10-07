/**
 * Disables a platform operator: Auth user disabled, refresh tokens revoked, `operators/{uid}.status = 'disabled'`,
 * `platformAuditLog` entry. Refuses an email that is not an operator (never a way to lock out a tenant user).
 *
 *   npm run operator:disable -- --env staging --email olive@convoypass.com
 *   npm run operator:disable -- --env prod --confirm-prod --email olive@convoypass.com
 */
import { runDisableOperator, type OperatorIo } from './operatorsCli.ts'
import { operatorIo } from './operatorIo.ts'

const argv = process.argv.slice(2)
const io: OperatorIo = operatorIo(argv)

runDisableOperator(argv, io)
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error('operator:disable failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
