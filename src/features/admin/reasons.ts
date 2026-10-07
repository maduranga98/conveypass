export const MIN_REASONS = 2
export const MAX_REASONS = 10

/** Ids are generated once, when a reason is added, and never edited: rejected passes keep the code they were rejected with. */
export const newReasonId = (): string => `custom_${Math.random().toString(36).slice(2, 8)}`
export const reasonLabelOk = (label: string): boolean => label.trim().length >= 3 && label.trim().length <= 60
