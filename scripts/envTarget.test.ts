import { describe, expect, it } from 'vitest'
import { loopback, resolveTarget } from './envTarget.ts'

const rc = { projects: { default: 'p-default', staging: 'real-staging-1', prod: 'real-prod-1' } }
const placeholders = { projects: { staging: 'REPLACE-ME-conveypass-staging', prod: 'REPLACE-ME-conveypass-prod' } }

describe('resolveTarget', () => {
  it('requires a known environment', () => {
    expect(() => resolveTarget({ env: undefined, confirmProduction: false, firebaserc: rc })).toThrow(/--env/)
    expect(() => resolveTarget({ env: 'live', confirmProduction: true, firebaserc: rc })).toThrow(/--env/)
  })
  it('emulator needs nothing else', () => {
    expect(resolveTarget({ env: 'emulator', confirmProduction: false, firebaserc: {} })).toEqual({ env: 'emulator', projectId: undefined })
  })
  it('staging reads its alias from .firebaserc', () => {
    expect(resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: rc })).toEqual({ env: 'staging', projectId: 'real-staging-1' })
  })
  it('production needs the explicit confirmation flag', () => {
    expect(() => resolveTarget({ env: 'prod', confirmProduction: false, firebaserc: rc })).toThrow(/--confirm-production/)
    expect(resolveTarget({ env: 'prod', confirmProduction: true, firebaserc: rc })).toEqual({ env: 'prod', projectId: 'real-prod-1' })
  })
  it('refuses the placeholders that ship in .firebaserc, and a missing alias', () => {
    expect(() => resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: placeholders })).toThrow(/placeholder/)
    expect(() => resolveTarget({ env: 'prod', confirmProduction: true, firebaserc: placeholders })).toThrow(/placeholder/)
    expect(() => resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: {} })).toThrow(/no project/)
  })
  it('an explicit project id overrides the alias (still checked for placeholders)', () => {
    expect(resolveTarget({ env: 'staging', confirmProduction: false, firebaserc: placeholders, projectOverride: 'my-real-one' }).projectId).toBe('my-real-one')
  })
  it('recognises loopback emulator hosts only', () => {
    expect(loopback('127.0.0.1:8080')).toBe(true)
    expect(loopback('localhost:9099')).toBe(true)
    expect(loopback('firestore.googleapis.com:443')).toBe(false)
    expect(loopback(undefined)).toBe(false)
  })
})
