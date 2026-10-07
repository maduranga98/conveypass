import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { APP_BASE_URL, REGION } from './config.js'
import { logInfo } from './logger.js'
import { actorOf, deliver, planDenial, planPassChange, type NotifyDeps } from './notifications.js'
import { messagingPort, notifyPort, slaPort } from './notifyPorts.js'
import { runSlaCheck } from './sla.js'
import type { GateEventData, PassData } from './types.js'

/**
 * Firestore triggers may need to sit next to the database (asia-south2) rather than the callables (asia-south1):
 * set FIRESTORE_TRIGGER_REGION if the deploy rejects the default. See docs/ops.md.
 */
const TRIGGER_REGION = process.env.FIRESTORE_TRIGGER_REGION || REGION

export const notifyDeps = (): NotifyDeps => ({
  data: notifyPort(),
  messaging: messagingPort(),
  now: () => Date.now(),
  baseUrl: APP_BASE_URL,
})

// Triggers run at least once and `retry` re-runs a failed one: every notification id is deterministic and created
// with `create()`, so a repeat creates nothing and pushes nothing.
export const onPassWritten = onDocumentWritten({ document: 'passes/{passId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as PassData) : null
  const after = event.data?.after.exists ? (event.data.after.data() as PassData) : null
  if (!after) return
  const planned = planPassChange(event.params.passId, before, after)
  if (planned.length === 0) return
  await deliver(notifyDeps(), after.tenantId, planned, actorOf(after), { fn: 'onPassWritten', tenantId: after.tenantId })
})

export const onGateEventCreated = onDocumentCreated({ document: 'gateEvents/{eventId}', region: TRIGGER_REGION, retry: true }, async (event) => {
  const data = event.data?.data() as GateEventData | undefined
  if (!data || data.type !== 'denied') return
  await deliver(notifyDeps(), data.tenantId, planDenial(event.params.eventId, data), data.byUid, {
    fn: 'onGateEventCreated',
    tenantId: data.tenantId,
  })
})

export const slaReminders = onSchedule({ schedule: 'every 10 minutes', timeZone: 'UTC' }, async () => {
  const summary = await runSlaCheck(slaPort(), notifyDeps())
  logInfo({ fn: 'slaReminders' }, 'ok', { ...summary })
})
