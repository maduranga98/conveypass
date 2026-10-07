import { SLA_MAX, SLA_MIN, type SlaSettings } from '@/lib/defaultSla'
import { GATE_NAME_MAX, GATE_NAME_MIN } from '@/lib/gates'

export const MIN_REASONS = 2
export const MAX_REASONS = 10

/** Ids are generated once, when a reason is added, and never edited: rejected passes keep the code they were rejected with. */
export const newReasonId = (): string => `custom_${Math.random().toString(36).slice(2, 8)}`
export const reasonLabelOk = (label: string): boolean => label.trim().length >= 3 && label.trim().length <= 60

/** Gate ids are created once, when a gate is added, and never edited: check-ins and denials keep the gate id. */
export const newGateId = (): string => `gate_${Math.random().toString(36).slice(2, 8)}`
export const gateNameOk = (name: string): boolean => name.trim().length >= GATE_NAME_MIN && name.trim().length <= GATE_NAME_MAX

export const minutesOk = (m: number): boolean => Number.isInteger(m) && m >= SLA_MIN && m <= SLA_MAX

export const slaOk = (sla: SlaSettings): boolean => minutesOk(sla.supervisorMinutes) && minutesOk(sla.officerMinutes)
