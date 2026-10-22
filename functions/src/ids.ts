import { randomInt } from 'node:crypto'

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** `veh_` + 10 random chars [a-z0-9]. Permanent: it is the vehicle's Firestore id and the content of its QR code. */
export const newVehicleId = (): string =>
  `veh_${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`

/** The id of a penalty is chosen by the issuing browser (it needs it to upload the evidence photo first); the server only checks the shape and creates the document with `create()`. */
export const PENALTY_ID_PATTERN = /^pen_[a-z0-9]{10}$/

/** `pty_` + 10 random chars: the id of a penalty type. */
export const newPenaltyTypeId = (): string =>
  `pty_${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`
