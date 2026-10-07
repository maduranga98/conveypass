import { describe, expect, it } from 'vitest'
import * as fn from '../../functions/src/passTransitions'
import { DEFAULT_REJECTION_REASONS as fnReasons } from '../../functions/src/defaultRejectionReasons'
import { DEFAULT_REJECTION_REASONS } from './defaultRejectionReasons'
import * as web from './passTransitions'
import type { Role } from './roles'
import type { PassStatus } from '@/types/passes'

describe('passTransitions mirror', () => {
  it('has the same transition table as the functions copy', () => {
    expect(web.TRANSITIONS).toEqual(fn.TRANSITIONS)
  })
  it('agrees on stages and on every (role, status, action, stage) combination', () => {
    const roles: Role[] = ['admin', 'officer', 'supervisor', 'driver', 'security']
    const statuses: PassStatus[] = ['submitted', 'supervisor_approved', 'officer_approved', 'checked_in', 'rejected']
    for (const role of roles) {
      expect(web.reviewStageOf(role)).toBe(fn.reviewStageOf(role))
      for (const stage of ['supervisor', 'officer'] as const) expect(web.statusForStage(stage)).toBe(fn.statusForStage(stage))
      for (const status of statuses) {
        for (const action of ['approve', 'reject', 'revoke'] as const) {
          for (const stage of ['supervisor', 'officer', 'revoked'] as const) {
            expect(web.canTransition(role, status, action, stage)).toBe(fn.canTransition(role, status, action, stage))
          }
        }
      }
    }
  })
  it('never lets admin approve or reject', () => {
    expect(web.reviewStageOf('admin')).toBeNull()
    expect(web.canTransition('admin', 'officer_approved', 'revoke', 'revoked')).toBe(true)
    expect(web.canTransition('admin', 'supervisor_approved', 'approve', 'officer')).toBe(false)
  })
  it('keeps the default rejection reasons in sync, ending with "other"', () => {
    expect(DEFAULT_REJECTION_REASONS).toEqual(fnReasons)
    expect(DEFAULT_REJECTION_REASONS.at(-1)?.id).toBe('other')
  })
})
