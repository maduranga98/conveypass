export const ROLES = ['admin', 'officer', 'supervisor', 'driver', 'security'] as const
export type Role = (typeof ROLES)[number]

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v)

export const ROLE_HOME: Record<Role, string> = {
  admin: '/admin',
  officer: '/officer',
  supervisor: '/supervisor',
  driver: '/driver',
  security: '/security',
}

export const STAFF_ROLES: readonly Role[] = ['admin', 'officer', 'supervisor', 'security']
