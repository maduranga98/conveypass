import { describe, expect, it } from 'vitest'
import { strings } from '@/lib/strings'
import { buildWhatsAppLink } from './whatsapp'

describe('buildWhatsAppLink', () => {
  const message = strings.drivers.credentials.message('https://app.example.com', '077 123 4567', '482915')

  it('targets the normalised phone and encodes the whole message', () => {
    const link = buildWhatsAppLink('94771234567', message) as string
    expect(link.startsWith('https://wa.me/94771234567?text=')).toBe(true)
    const text = decodeURIComponent(link.split('?text=')[1] as string)
    expect(text).toBe(message)
    expect(text).toContain('https://app.example.com')
    expect(text).toContain('077 123 4567')
    expect(text).toContain('482915')
    expect(text.toLowerCase()).toContain('change your pin')
  })

  it('does not leak raw newlines or spaces into the URL', () => {
    expect(buildWhatsAppLink('94771234567', message)).not.toMatch(/[\s]/)
  })

  it('refuses anything but a normalised mobile number', () => {
    for (const bad of ['0771234567', '+94771234567', '94112345678', '', '9477123456']) {
      expect(buildWhatsAppLink(bad, message)).toBeNull()
    }
  })
})
