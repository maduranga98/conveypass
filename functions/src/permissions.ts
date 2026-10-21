// The permissions matrix: ONE table of role -> allowed actions. Mirrors src/lib/permissions.ts in the web app
// (functions deploy from this folder only; src/lib/permissions.test.ts fails if the copies differ). Pure: no firebase
// imports. Documented, with scope notes, in docs/permissions.md.
//
// This matrix covers auth and roles (Module 1 of the foundation). Actions of later modules (inspections, penalties,
// trips, ...) are added to the same table when those modules are built, never as scattered role checks.
import type { Role } from './types.js'

/** The Super admin is not a tenant role (it has no tenant); it is listed here so the matrix shows the whole hierarchy. */
export type Principal = Role | 'superadmin'

const ALL_STAFF = ['admin', 'officer', 'supervisor', 'safety'] as const

export const PERMISSIONS = {
  // Platform level: scripts and the /platform console only. A tenant role can never hold these.
  'workspace.create': ['superadmin'],
  'workspace.admin.manage': ['superadmin'],
  // Accounts. Admins are created, reset, disabled by the Super admin only (nobody manages themselves).
  'user.create.admin': ['superadmin'],
  'user.create.officer': ['admin'],
  'user.create.supervisor': ['admin'],
  'user.create.safety': ['admin'],
  'user.create.security': ['admin'],
  'user.create.driver': ['admin', 'supervisor'],
  'user.manage': ['admin', 'supervisor'],
  'user.pin.reissue': ['admin', 'supervisor'],
  // Own account.
  'account.view': ['admin', 'officer', 'supervisor', 'safety', 'security', 'driver'],
  'account.password.change': [...ALL_STAFF],
  // Workspace setup (Company Admin).
  'contractor.manage': ['admin'],
  'settings.manage': ['admin'],
  'audit.view': ['admin'],
  // Areas (route guards): who may open each role's home.
  'area.admin': ['admin'],
  'area.officer': ['officer'],
  'area.supervisor': ['supervisor'],
  'area.safety': ['safety'],
  'area.security': ['security'],
  'area.driver': ['driver'],
} as const satisfies Record<string, readonly Principal[]>

export type Action = keyof typeof PERMISSIONS

export const ACTIONS = Object.keys(PERMISSIONS) as Action[]

export function can(principal: Principal | null | undefined, action: Action): boolean {
  return principal != null && (PERMISSIONS[action] as readonly Principal[]).includes(principal)
}

/** Tenant roles allowed to do `action` (for route guards). The Super admin is not a tenant role and is left out. */
export function rolesFor(action: Action): Role[] {
  return (PERMISSIONS[action] as readonly Principal[]).filter((p): p is Role => p !== 'superadmin')
}

/** May `caller` create an account with role `target`? Scope (own contractor, same tenant) is checked by the caller. */
export function canCreateRole(caller: Principal, target: Role): boolean {
  return can(caller, `user.create.${target}` as Action)
}
