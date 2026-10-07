import type { ParsedToken } from 'firebase/auth'
import { isRole } from '@/lib/roles'
import type { Claims } from '@/types'

/** Claims come from the verified ID token. Returns null if the account has no valid role/tenant. */
export function parseClaims(token: ParsedToken): Claims | null {
  const { role, tenantId, contractorId } = token as Record<string, unknown>
  if (!isRole(role) || typeof tenantId !== 'string' || !tenantId) return null
  return { role, tenantId, contractorId: typeof contractorId === 'string' && contractorId ? contractorId : null }
}
