import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import {
  PenaltyTypeExistsError,
  PenaltyTypeInUseError,
  PenaltyTypeLimitError,
  PinTakenError,
  PlateTakenError,
  VehicleIdTakenError,
  type AuthPort,
  type DataPort,
  type DecisionContext,
  type GateEventQuery,
  type PassQuery,
  type PenaltyPlan,
  type StoragePort,
} from './core.js'
import { planSubmit } from './passRules.js'
import type { ReportEvent, ReportPass } from './reports/types.js'
import type { ContractorData, DriverData, GateEventData, PassData, PenaltyData, PenaltyTypeData, TenantData, UserData, VehicleData } from './types.js'

const ts = (ms: number): Timestamp => Timestamp.fromMillis(ms)

/** Firestore Timestamp (or anything with toMillis) -> milliseconds. */
const millis = (v: unknown): number | null =>
  typeof v === 'object' && v !== null && 'toMillis' in v && typeof v.toMillis === 'function'
    ? (v.toMillis() as number)
    : null

/** Stored gate event -> GateEventData with `at` in milliseconds. */
const toGateEvent = (raw: Record<string, unknown>): GateEventData =>
  ({ ...raw, at: millis(raw.at) ?? 0 }) as unknown as GateEventData

/** A new document in the audit log: the one place (with `writeAudit`) that names the collection, so every entry is built the same way. */
export const newAuditDoc = (db: FirebaseFirestore.Firestore): FirebaseFirestore.DocumentReference => db.collection('auditLog').doc()

/** Stored penalty -> PenaltyData with every timestamp as milliseconds. */
export function toPenalty(raw: Record<string, unknown>): PenaltyData {
  const data = raw as unknown as Omit<PenaltyData, 'issuedAt' | 'duration' | 'revocation' | 'expiredAt' | 'verification'> & {
    duration: { kind: 'fixed'; endDate: unknown } | { kind: 'permanent' }
    revocation?: { at: unknown }
    verification: { verifiedAt: unknown }
  }
  const { duration, revocation, verification, ...rest } = data
  return {
    ...rest,
    issuedAt: millis(raw.issuedAt) ?? 0,
    duration: duration.kind === 'fixed' ? { kind: 'fixed', endDate: millis(duration.endDate) ?? 0 } : { kind: 'permanent' },
    ...(revocation ? { revocation: { ...revocation, at: millis(revocation.at) ?? 0 } } : {}),
    ...(millis(raw.expiredAt) !== null ? { expiredAt: millis(raw.expiredAt) as number } : {}),
    verification: { ...verification, verifiedAt: millis(verification.verifiedAt) },
  } as PenaltyData
}

/** The stored form of a patch: milliseconds become Timestamps. */
export function penaltyPatchToStored(patch: PenaltyPlan['patch']): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.status !== undefined) out.status = patch.status
  if (patch.expiredAt !== undefined) out.expiredAt = ts(patch.expiredAt)
  if (patch.revocation) out.revocation = { ...patch.revocation, at: ts(patch.revocation.at) }
  if (patch.verification) {
    out.verification = { ...patch.verification, verifiedAt: patch.verification.verifiedAt === null ? null : ts(patch.verification.verifiedAt) }
  }
  return out
}

/** Reads what a pass decision depends on, inside the transaction. `null` when the pass does not exist. */
async function readDecisionContext(
  db: FirebaseFirestore.Firestore,
  tx: FirebaseFirestore.Transaction,
  ref: FirebaseFirestore.DocumentReference,
): Promise<{ ctx: DecisionContext | null; history: unknown[] }> {
  const snap = await tx.get(ref)
  if (!snap.exists) return { ctx: null, history: [] }
  const raw = snap.data() as Record<string, unknown>
  const pass = toPass(raw)
  const [vehicle, contractor, driver] = await tx.getAll(
    db.doc(`vehicles/${pass.vehicleId}`),
    db.doc(`contractors/${pass.contractorId}`),
    db.doc(`users/${pass.driverId}`),
  )
  return {
    ctx: {
      pass,
      vehicle: vehicle?.exists ? (vehicle.data() as VehicleData) : null,
      contractor: contractor?.exists ? (contractor.data() as ContractorData) : null,
      driver: driver?.exists ? (driver.data() as UserData) : null,
    },
    history: Array.isArray(raw.history) ? (raw.history as unknown[]) : [],
  }
}

/** Stored pass -> PassData with every timestamp as milliseconds. */
export function toPass(raw: Record<string, unknown>): PassData {
  const data = raw as unknown as PassData & {
    supervisor?: { at: unknown }
    officer?: { at: unknown }
    rejection?: { at: unknown }
    rejectionHistory?: { at: unknown }[]
    history?: { at: unknown }[]
    checkIn?: { at: unknown }
  }
  const { supervisor, officer, rejection, rejectionHistory, history, checkIn, ...rest } = data
  return {
    ...rest,
    submittedAt: millis(raw.submittedAt),
    ...(supervisor ? { supervisor: { ...supervisor, at: millis(supervisor.at) ?? 0 } } : {}),
    ...(officer ? { officer: { ...officer, at: millis(officer.at) ?? 0 } } : {}),
    ...(rejection ? { rejection: { ...rejection, at: millis(rejection.at) ?? 0 } } : {}),
    ...(rejectionHistory
      ? { rejectionHistory: rejectionHistory.map((h) => ({ ...h, at: millis(h.at) ?? 0 })) }
      : {}),
    ...(history ? { history: history.map((h) => ({ ...h, at: millis(h.at) ?? 0 })) } : {}),
    ...(checkIn ? { checkIn: { ...checkIn, at: millis(checkIn.at) ?? 0 } } : {}),
  } as PassData
}

/** Only these fields are read for reports: evidence, checklist answers and capture data never leave Firestore. */
const REPORT_PASS_FIELDS = [
  'contractorId', 'vehicleId', 'plateNo', 'vehicleType', 'dateKey', 'driverId', 'driverName', 'status', 'attempt',
  'submittedAt', 'supervisor', 'officer', 'rejection', 'rejectionHistory', 'history', 'checkIn',
] as const

type Q = FirebaseFirestore.Query

function passQuery(db: FirebaseFirestore.Firestore, q: PassQuery): Q {
  let query: Q = db.collection('passes').where('tenantId', '==', q.tenantId)
  if (q.kind === 'checkIn') {
    return query.where('checkIn.at', '>=', ts(q.startMs)).where('checkIn.at', '<', ts(q.endMs))
  }
  // A single day is an equality filter, which `(tenantId, dateKey, status)` serves for the trend counts.
  query = q.fromKey === q.toKey
    ? query.where('dateKey', '==', q.fromKey)
    : query.where('dateKey', '>=', q.fromKey).where('dateKey', '<=', q.toKey)
  if (q.statuses && q.statuses.length === 1) query = query.where('status', '==', q.statuses[0] as string)
  else if (q.statuses && q.statuses.length > 1) query = query.where('status', 'in', [...q.statuses])
  // One equality filter per query (the ones with an index); a second one is applied in memory by `listPasses`.
  if (q.vehicleId) return query.where('vehicleId', '==', q.vehicleId)
  if (q.driverId) return query.where('driverId', '==', q.driverId)
  if (q.contractorId) return query.where('contractorId', '==', q.contractorId)
  return query
}

const eventQuery = (db: FirebaseFirestore.Firestore, q: GateEventQuery): Q =>
  db.collection('gateEvents').where('tenantId', '==', q.tenantId).where('at', '>=', ts(q.startMs)).where('at', '<', ts(q.endMs))

/** Stored pass -> the slim shape reports use, with every timestamp in milliseconds. */
function toReportPass(id: string, raw: Record<string, unknown>): ReportPass {
  const { evidence: _e, checklist: _c, captureMeta: _m, ...pass } = toPass(raw) as PassData & Record<string, unknown>
  void _e
  void _c
  void _m
  const slim: ReportPass = {
    id,
    contractorId: pass.contractorId,
    vehicleId: pass.vehicleId,
    plateNo: pass.plateNo,
    vehicleType: pass.vehicleType,
    dateKey: pass.dateKey,
    driverId: pass.driverId,
    driverName: pass.driverName,
    status: pass.status,
    attempt: pass.attempt,
    submittedAt: pass.submittedAt,
    ...(pass.supervisor ? { supervisor: pass.supervisor } : {}),
    ...(pass.officer ? { officer: pass.officer } : {}),
    ...(pass.rejection ? { rejection: pass.rejection } : {}),
    ...(pass.rejectionHistory
      ? { rejectionHistory: pass.rejectionHistory.map(({ checklist: _k, evidence: _v, ...r }) => (void _k, void _v, r)) }
      : {}),
    ...(pass.history ? { history: pass.history } : {}),
    ...(pass.checkIn ? { checkIn: pass.checkIn } : {}),
  }
  return slim
}

export const storagePort = (): StoragePort => ({
  readFile: async (path, headBytes) => {
    const file = getStorage().bucket().file(path)
    const [exists] = await file.exists()
    if (!exists) return null
    const [meta] = await file.getMetadata()
    const [head] = await file.download({ start: 0, end: Math.max(0, headBytes - 1) })
    return {
      contentType: String(meta.contentType ?? ''),
      size: Number(meta.size ?? 0),
      timeCreated: Date.parse(String(meta.timeCreated ?? '')) || 0,
      head: new Uint8Array(head),
    }
  },
})

export const authPort = (): AuthPort => {
  const auth = getAuth()
  return {
    createUser: async (p) => ({ uid: (await auth.createUser(p)).uid }),
    getUser: async (uid) => {
      try {
        const u = await auth.getUser(uid)
        return { email: u.email ?? null, hasPassword: u.providerData.some((p) => p.providerId === 'password') || Boolean(u.passwordHash), disabled: u.disabled }
      } catch (e) {
        if ((e as { code?: unknown }).code === 'auth/user-not-found') return null
        throw e
      }
    },
    deleteUser: (uid) => auth.deleteUser(uid),
    updateUser: async (uid, p) => {
      await auth.updateUser(uid, p)
    },
    setCustomUserClaims: (uid, claims) => auth.setCustomUserClaims(uid, { ...claims }),
    revokeRefreshTokens: (uid) => auth.revokeRefreshTokens(uid),
  }
}

export const dataPort = (): DataPort => {
  const db = getFirestore()
  return {
    getUser: async (uid) => {
      const snap = await db.doc(`users/${uid}`).get()
      return snap.exists ? (snap.data() as UserData) : null
    },
    getContractor: async (id) => {
      const snap = await db.doc(`contractors/${id}`).get()
      return snap.exists ? (snap.data() as ContractorData) : null
    },
    getDriver: async (uid) => {
      const snap = await db.doc(`drivers/${uid}`).get()
      return snap.exists ? (snap.data() as DriverData) : null
    },
    getDrivers: async (uids) => {
      const out = new Map<string, DriverData>()
      if (uids.length === 0) return out
      const snaps = await db.getAll(...uids.map((uid) => db.doc(`drivers/${uid}`)))
      for (const snap of snaps) if (snap.exists) out.set(snap.id, snap.data() as DriverData)
      return out
    },
    getVehicle: async (id) => {
      const snap = await db.doc(`vehicles/${id}`).get()
      return snap.exists ? (snap.data() as VehicleData) : null
    },
    createUserWithAudit: async (uid, data, actorUid, audit, driver, pin) => {
      const write = (w: { create: (ref: FirebaseFirestore.DocumentReference, d: FirebaseFirestore.DocumentData) => unknown }) => {
        w.create(db.doc(`users/${uid}`), {
          ...data,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (driver) {
          w.create(db.doc(`drivers/${uid}`), {
            ...driver,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        w.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      }
      if (!pin) {
        const batch = db.batch()
        write(batch)
        await batch.commit()
        return
      }
      // PIN users: the pinIndex doc is the global uniqueness guard, created in the same transaction as the user.
      const pinRef = db.doc(`pinIndex/${pin.key}`)
      await db.runTransaction(async (tx) => {
        if ((await tx.get(pinRef)).exists) throw new PinTakenError()
        tx.create(pinRef, { ...pin.entry, createdAt: FieldValue.serverTimestamp() })
        write(tx)
      })
    },
    reissuePinTx: async ({ uid, key, entry, patch, audit }) => {
      const pinRef = db.doc(`pinIndex/${key}`)
      await db.runTransaction(async (tx) => {
        const [taken, old] = await Promise.all([tx.get(pinRef), tx.get(db.collection('pinIndex').where('uid', '==', uid))])
        if (taken.exists) throw new PinTakenError()
        for (const d of old.docs) tx.delete(d.ref)
        tx.create(pinRef, { ...entry, createdAt: FieldValue.serverTimestamp() })
        tx.update(db.doc(`users/${uid}`), { ...patch, knownDevices: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    updateUserWithAudit: async (uid, patch, audit, driver) => {
      const batch = db.batch()
      batch.update(db.doc(`users/${uid}`), { ...patch, updatedAt: FieldValue.serverTimestamp() })
      if (driver) {
        const ref = db.doc(`drivers/${uid}`)
        if (driver.backfill) {
          batch.create(ref, {
            ...driver.backfill,
            ...driver.patch,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        } else if (Object.keys(driver.patch).length > 0) {
          batch.update(ref, { ...driver.patch, updatedAt: FieldValue.serverTimestamp() })
        }
      }
      batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
    createVehicleTx: async ({ vehicleId, vehicle, actorUid, audit }) => {
      const vehicleRef = db.doc(`vehicles/${vehicleId}`)
      const guardRef = db.doc(`vehiclePlates/${vehicle.tenantId}_${vehicle.plateKey}`)
      await db.runTransaction(async (tx) => {
        const [guard, existing] = await Promise.all([tx.get(guardRef), tx.get(vehicleRef)])
        if (guard.exists) throw new PlateTakenError()
        if (existing.exists) throw new VehicleIdTakenError()
        tx.create(guardRef, { vehicleId })
        tx.create(vehicleRef, {
          ...vehicle,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: actorUid,
          updatedAt: FieldValue.serverTimestamp(),
        })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    updateVehicleTx: async ({ vehicleId, patch, plate, audit }) => {
      const vehicleRef = db.doc(`vehicles/${vehicleId}`)
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(vehicleRef)
        if (!snap.exists) throw new Error('vehicle disappeared')
        const current = snap.data() as VehicleData

        // Re-read the plate inside the transaction: another change may have landed since core looked.
        const moving = plate !== undefined && plate.plateKey !== current.plateKey
        const oldGuardRef = db.doc(`vehiclePlates/${current.tenantId}_${current.plateKey}`)
        const newGuardRef = plate ? db.doc(`vehiclePlates/${current.tenantId}_${plate.plateKey}`) : null
        if (moving && newGuardRef) {
          const guard = await tx.get(newGuardRef)
          if (guard.exists && (guard.data() as { vehicleId?: string }).vehicleId !== vehicleId) throw new PlateTakenError()
        }

        const { makeModel, insuranceExpiry, registrationExpiry, ...rest } = patch
        const clearable = (v: string | null | undefined) => (v === null ? FieldValue.delete() : v)
        tx.update(vehicleRef, {
          ...rest,
          ...(makeModel !== undefined ? { makeModel: clearable(makeModel) } : {}),
          ...(insuranceExpiry !== undefined ? { insuranceExpiry: clearable(insuranceExpiry) } : {}),
          ...(registrationExpiry !== undefined ? { registrationExpiry: clearable(registrationExpiry) } : {}),
          ...(moving && plate ? { plateKey: plate.plateKey } : {}),
          updatedAt: FieldValue.serverTimestamp(),
        })
        if (moving && newGuardRef) {
          tx.delete(oldGuardRef)
          tx.set(newGuardRef, { vehicleId })
        }
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    setContractorStatusWithAudit: async (contractorId, status, audit) => {
      const batch = db.batch()
      batch.update(db.doc(`contractors/${contractorId}`), { status, updatedAt: FieldValue.serverTimestamp() })
      batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
    getTenant: async (tenantId) => {
      const snap = await db.doc(`tenants/${tenantId}`).get()
      return snap.exists ? (snap.data() as TenantData) : null
    },
    countVehiclesOfType: async (tenantId, type) =>
      (await db.collection('vehicles').where('tenantId', '==', tenantId).where('type', '==', type).count().get()).data().count,
    getPass: async (passId) => {
      const snap = await db.doc(`passes/${passId}`).get()
      return snap.exists ? toPass(snap.data() as Record<string, unknown>) : null
    },
    submitPassTx: async ({ passId, pass, audit }) => {
      const ref = db.doc(`passes/${passId}`)
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const raw = snap.exists ? (snap.data() as Record<string, unknown>) : null
        const plan = planSubmit(raw ? toPass(raw) : null, pass.driverId, pass.attempt)
        const stamps = { status: 'submitted', submittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }
        if (plan === 'create') {
          tx.create(ref, { ...pass, ...stamps })
        } else {
          // Keep the rejection (reason, who, when) plus what that attempt looked like; its photos stay in Storage.
          const previous = raw as { rejection?: object; attempt: number; checklist: unknown; evidence: unknown }
          tx.update(ref, {
            ...pass,
            ...stamps,
            rejection: FieldValue.delete(),
            // A new attempt starts a fresh review; `history` (every decision ever made) is left untouched.
            supervisor: FieldValue.delete(),
            officer: FieldValue.delete(),
            rejectionHistory: FieldValue.arrayUnion({
              ...(previous.rejection ?? {}),
              attempt: previous.attempt,
              checklist: previous.checklist,
              evidence: previous.evidence,
            }),
          })
        }
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    decidePassTx: async ({ passId, plan }) => {
      const ref = db.doc(`passes/${passId}`)
      return db.runTransaction(async (tx) => {
        const { ctx, history: existingHistory } = await readDecisionContext(db, tx, ref)
        const decision = plan(ctx)
        const { update, audit } = decision
        const stamp = (s: { uid: string; name: string; at: number }) => ({ ...s, at: ts(s.at) })
        tx.update(ref, {
          status: update.status,
          updatedAt: FieldValue.serverTimestamp(),
          ...(update.supervisor ? { supervisor: stamp(update.supervisor) } : {}),
          ...(update.officer ? { officer: stamp(update.officer) } : {}),
          ...(update.rejection ? { rejection: { ...update.rejection, at: ts(update.rejection.at) } } : {}),
          history: [...existingHistory, { ...update.entry, at: ts(update.entry.at) }],
        })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
        return decision
      })
    },
    checkInTx: async ({ passId, plan }) => {
      const ref = db.doc(`passes/${passId}`)
      return db.runTransaction(async (tx) => {
        const { ctx, history } = await readDecisionContext(db, tx, ref)
        const decision = plan(ctx)
        if (decision.kind === 'replay') return decision
        tx.update(ref, {
          status: 'checked_in',
          updatedAt: FieldValue.serverTimestamp(),
          checkIn: { ...decision.checkIn, at: ts(decision.checkIn.at) },
          history: [...history, { ...decision.entry, at: ts(decision.entry.at) }],
        })
        tx.create(db.collection('auditLog').doc(), { ...decision.audit, createdAt: FieldValue.serverTimestamp() })
        return decision
      })
    },
    denyEntryTx: async ({ eventId, event, audit }) => {
      const ref = db.doc(`gateEvents/${eventId}`)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (snap.exists) return { created: false, event: toGateEvent(snap.data() as Record<string, unknown>) }
        tx.create(ref, { ...event, at: ts(event.at) })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
        return { created: true, event }
      })
    },
    updateTenantSettingsWithAudit: async (tenantId, patch, audit) => {
      const batch = db.batch()
      batch.update(db.doc(`tenants/${tenantId}`), { ...patch, updatedAt: FieldValue.serverTimestamp() })
      batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
    writeAudit: async (audit) => {
      await db.collection('auditLog').doc().create({ ...audit, createdAt: FieldValue.serverTimestamp() })
    },
    getPenaltyType: async (typeId) => {
      const snap = await db.doc(`penaltyTypes/${typeId}`).get()
      return snap.exists ? (snap.data() as PenaltyTypeData) : null
    },
    createPenaltyTypeTx: async ({ typeId, data, max, audit }) => {
      await db.runTransaction(async (tx) => {
        const mine = db.collection('penaltyTypes').where('tenantId', '==', data.tenantId)
        const [dup, count] = await Promise.all([tx.get(mine.where('nameKey', '==', data.nameKey).limit(1)), tx.get(mine.count())])
        if (!dup.empty) throw new PenaltyTypeExistsError()
        if (count.data().count >= max) throw new PenaltyTypeLimitError()
        tx.create(db.doc(`penaltyTypes/${typeId}`), { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    renamePenaltyTypeTx: async ({ typeId, tenantId, name, nameKey, audit }) => {
      await db.runTransaction(async (tx) => {
        const dup = await tx.get(db.collection('penaltyTypes').where('tenantId', '==', tenantId).where('nameKey', '==', nameKey).limit(2))
        if (dup.docs.some((d) => d.id !== typeId)) throw new PenaltyTypeExistsError()
        tx.update(db.doc(`penaltyTypes/${typeId}`), { name, nameKey, updatedAt: FieldValue.serverTimestamp() })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    deletePenaltyTypeTx: async ({ typeId, tenantId, audit }) => {
      await db.runTransaction(async (tx) => {
        const used = await tx.get(db.collection('penalties').where('tenantId', '==', tenantId).where('typeId', '==', typeId).limit(1))
        if (!used.empty) throw new PenaltyTypeInUseError()
        tx.delete(db.doc(`penaltyTypes/${typeId}`))
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      })
    },
    getPenalty: async (penaltyId) => {
      const snap = await db.doc(`penalties/${penaltyId}`).get()
      return snap.exists ? toPenalty(snap.data() as Record<string, unknown>) : null
    },
    createPenaltyTx: async ({ penaltyId, penalty, audit }) => {
      const ref = db.doc(`penalties/${penaltyId}`)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (snap.exists) return { created: false, penalty: toPenalty(snap.data() as Record<string, unknown>) }
        const { duration, issuedAt, ...rest } = penalty
        tx.create(ref, {
          ...rest,
          issuedAt: ts(issuedAt),
          duration: duration.kind === 'fixed' ? { kind: 'fixed', endDate: ts(duration.endDate) } : { kind: 'permanent' },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        tx.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
        return { created: true, penalty }
      })
    },
    updatePenaltyTx: async ({ penaltyId, plan }) => {
      const ref = db.doc(`penalties/${penaltyId}`)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        const current = snap.exists ? toPenalty(snap.data() as Record<string, unknown>) : null
        const planned = plan(current)
        tx.update(ref, { ...penaltyPatchToStored(planned.patch), updatedAt: FieldValue.serverTimestamp() })
        tx.create(db.collection('auditLog').doc(), { ...planned.audit, createdAt: FieldValue.serverTimestamp() })
        return { ...(current as PenaltyData), ...planned.patch }
      })
    },
    listActivePenalties: async ({ tenantId, vehicleId, driverId }) => {
      const base = db.collection('penalties').where('tenantId', '==', tenantId).where('status', '==', 'active')
      const queries = [
        ...(vehicleId ? [base.where('target.vehicleId', '==', vehicleId)] : []),
        ...(driverId ? [base.where('target.driverId', '==', driverId)] : []),
        ...(!vehicleId && !driverId ? [base.limit(2000)] : []),
      ]
      const found = new Map<string, PenaltyData & { id: string }>()
      for (const snap of await Promise.all(queries.map((q) => q.get()))) {
        for (const d of snap.docs) found.set(d.id, { ...toPenalty(d.data() as Record<string, unknown>), id: d.id })
      }
      return [...found.values()]
    },
    countPasses: async (q) => (await passQuery(db, q).count().get()).data().count,
    listPasses: async (q, limit) => {
      const snap = await passQuery(db, q)
        .select(...REPORT_PASS_FIELDS)
        .orderBy(q.kind === 'checkIn' ? 'checkIn.at' : 'dateKey')
        .limit(limit)
        .get()
      return snap.docs
        .map((d) => toReportPass(d.id, d.data() as Record<string, unknown>))
        .filter(
          (p) =>
            q.kind === 'checkIn' ||
            ((!q.vehicleId || p.vehicleId === q.vehicleId) &&
              (!q.driverId || p.driverId === q.driverId) &&
              (!q.contractorId || p.contractorId === q.contractorId)),
        )
    },
    countGateEvents: async (q) => (await eventQuery(db, q).count().get()).data().count,
    listGateEvents: async (q, limit) => {
      const snap = await eventQuery(db, q).orderBy('at').limit(limit).get()
      return snap.docs.map((d): ReportEvent => ({ ...toGateEvent(d.data() as Record<string, unknown>), id: d.id }))
    },
    listContractorNames: async (tenantId) => {
      const snap = await db.collection('contractors').where('tenantId', '==', tenantId).select('name').get()
      return new Map(snap.docs.map((d) => [d.id, String((d.data() as { name?: unknown }).name ?? d.id)]))
    },
    listUserIdsByContractor: async (tenantId, contractorId) => {
      const snap = await db
        .collection('users')
        .where('tenantId', '==', tenantId)
        .where('contractorId', '==', contractorId)
        .select()
        .get()
      return snap.docs.map((d) => d.id)
    },
  }
}
