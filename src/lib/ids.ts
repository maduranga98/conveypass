const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
/** Largest multiple of 36 that fits a byte: bytes at or above it are skipped so every character is equally likely. */
const LIMIT = 252

/** `pen_` + 10 random chars [a-z0-9] (crypto). Chosen by the browser so a penalty photo can be uploaded to its own path first. */
export function newPenaltyId(): string {
  let id = ''
  while (id.length < 10) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < LIMIT && id.length < 10) id += ALPHABET[b % ALPHABET.length]
    }
  }
  return `pen_${id}`
}
