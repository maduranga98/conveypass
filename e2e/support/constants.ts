// Shared by the tests and the Admin SDK helper. No imports: safe to load in the Playwright worker.
export const PROJECT = 'demo-conveypass-e2e'
export const PASSWORD = 'Passw0rd!e2e'
export const PIN = '123456'
export const TENANT = 't1'
export const CONTRACTOR = 'c1'
export const VEHICLE = 'veh_e2etest001'
export const PLATE = 'WP LJ-4821'
export const DRIVER_PHONE = '0771234567'
export const DRIVER_AUTH_EMAIL = '94771234567@drivers.convoypass.com'

export const STAFF = {
  admin: { email: 'admin@e2e.test', name: 'Ann Admin' },
  officer: { email: 'officer@e2e.test', name: 'Olga Officer' },
  supervisor: { email: 'supervisor@e2e.test', name: 'Sue Supervisor' },
  security: { email: 'security@e2e.test', name: 'Sam Security' },
} as const

