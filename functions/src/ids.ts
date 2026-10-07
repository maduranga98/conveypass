import { randomInt } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** `veh_` + 10 random chars [a-z0-9]. Permanent: it is the vehicle's Firestore id and the content of its QR code. */
export const newVehicleId = (): string =>
  `veh_${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`
