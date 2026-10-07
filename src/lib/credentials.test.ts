import { describe, expect, it } from 'vitest'
import { driverEmail, isValidPassword, isValidPin, normalisePhone } from './credentials'

describe('normalisePhone', () => {
  it.each([
    ['0771234567', '94771234567'],
    ['077 123 4567', '94771234567'],
    ['077-123-4567', '94771234567'],
    ['+94771234567', '94771234567'],
    ['+94 77 123 4567', '94771234567'],
  ])('accepts %s', (input, expected) => expect(normalisePhone(input)).toBe(expected))

  it.each(['', '12345', '0111234567', '771234567', '94771234567', '+9477123456', '+947712345678', '0771234abc', '+44771234567', '00771234567'])(
    'rejects %s',
    (input) => expect(normalisePhone(input)).toBeNull(),
  )
})

describe('driverEmail', () => {
  it('builds the synthetic address', () => expect(driverEmail('94771234567')).toBe('94771234567@drivers.convoypass.com'))
})

describe('credential validators', () => {
  it('validates PINs', () => {
    expect(isValidPin('123456')).toBe(true)
    for (const bad of ['12345', '1234567', 'abcdef', '12 456', '']) expect(isValidPin(bad)).toBe(false)
  })
  it('validates passwords', () => {
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('a'.repeat(129))).toBe(false)
  })
})

describe('generators', () => {
  it('generatePin returns valid 6-digit PINs', async () => {
    const { generatePin } = await import('./credentials')
    for (let i = 0; i < 200; i++) expect(isValidPin(generatePin())).toBe(true)
  })
  it('generatePassword returns valid passwords', async () => {
    const { generatePassword } = await import('./credentials')
    for (let i = 0; i < 50; i++) expect(isValidPassword(generatePassword())).toBe(true)
  })
  it('formatPhone groups digits', async () => {
    const { formatPhone } = await import('./credentials')
    expect(formatPhone('94771234567')).toBe('077 123 4567')
  })
})
