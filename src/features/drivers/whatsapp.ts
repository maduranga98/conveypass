/** `https://wa.me/<94XXXXXXXXX>?text=…`. Null unless the phone is a normalised Sri Lankan mobile number. */
export function buildWhatsAppLink(normalisedPhone: string, message: string): string | null {
  if (!/^947\d{8}$/.test(normalisedPhone)) return null
  return `https://wa.me/${normalisedPhone}?text=${encodeURIComponent(message)}`
}
