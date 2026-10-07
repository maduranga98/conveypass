import { describe, expect, it } from 'vitest'
import { changePasswordUrl, loginUrl, safeNext } from './redirect'

describe('safeNext', () => {
  it('keeps same-origin paths, including query and hash', () => {
    expect(safeNext('/v/abc123')).toBe('/v/abc123')
    expect(safeNext('/v/abc?x=1#y')).toBe('/v/abc?x=1#y')
  })
  it.each([null, undefined, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/login', '/login?next=/x'])(
    'rejects %s',
    (v) => expect(safeNext(v)).toBeNull(),
  )
})

describe('urls', () => {
  it('encodes the target', () => {
    expect(loginUrl('/v/abc123?a=b')).toBe('/login?next=%2Fv%2Fabc123%3Fa%3Db')
    expect(changePasswordUrl('/driver')).toBe('/change-password?next=%2Fdriver')
  })
})
