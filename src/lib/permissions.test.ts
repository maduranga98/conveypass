import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/permissions'
import { ROLE_HOME, ROLES } from './roles'
import * as web from './permissions'

describe('permissions matrix', () => {
  it('is identical in the web and functions copies', () => {
    expect(web.PERMISSIONS).toEqual(fn.PERMISSIONS)
  })

  it('has an area for every role, and only that role may open it', () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role]).toBe(`/${role}`)
      expect(web.rolesFor(`area.${role}` as web.Action)).toEqual([role])
    }
  })

  it('lets only the Super admin create admins and workspaces', () => {
    expect(web.rolesFor('user.create.admin')).toEqual([])
    expect(web.can('superadmin', 'user.create.admin')).toBe(true)
    expect(web.can('admin', 'user.create.admin')).toBe(false)
    expect(web.can('superadmin', 'workspace.create')).toBe(true)
    expect(web.can('admin', 'workspace.create')).toBe(false)
  })

  it('lets admins create every non-admin role and supervisors only drivers', () => {
    for (const target of ROLES.filter((r) => r !== 'admin')) {
      expect(web.canCreateRole('admin', target)).toBe(true)
      expect(web.canCreateRole('supervisor', target)).toBe(target === 'driver')
      for (const caller of ['officer', 'safety', 'security', 'driver'] as const) {
        expect(web.canCreateRole(caller, target)).toBe(false)
      }
    }
    expect(web.canCreateRole('admin', 'admin')).toBe(false)
  })

  it('denies unknown principals', () => {
    expect(web.can(null, 'account.view')).toBe(false)
    expect(web.can(undefined, 'account.view')).toBe(false)
  })

  it('lets admins and supervisors manage vehicles, the Safety Officer only read them', () => {
    expect(web.rolesFor('vehicle.manage')).toEqual(['admin', 'supervisor'])
    expect(web.rolesFor('vehicle.view')).toContain('safety')
    expect(web.can('safety', 'vehicle.manage')).toBe(false)
    for (const role of ['security', 'driver'] as const) expect(web.can(role, 'vehicle.manage')).toBe(false)
    expect(web.rolesFor('driver.view')).not.toContain('driver')
    expect(web.rolesFor('vehicleType.manage')).toEqual(['admin'])
    expect(web.rolesFor('expiry.settings')).toEqual(['admin'])
  })
})
