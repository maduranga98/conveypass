import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { PlateTakenError, VehicleIdTakenError, type AuthPort, type DataPort } from './core.js'
import type { ContractorData, DriverData, UserData, VehicleData } from './types.js'

export const authPort = (): AuthPort => {
  const auth = getAuth()
  return {
    createUser: async (p) => ({ uid: (await auth.createUser(p)).uid }),
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
    createUserWithAudit: async (uid, data, actorUid, audit, driver) => {
      const batch = db.batch()
      batch.create(db.doc(`users/${uid}`), {
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      if (driver) {
        batch.create(db.doc(`drivers/${uid}`), {
          ...driver,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        })
      }
      batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
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

        const { makeModel, ...rest } = patch
        tx.update(vehicleRef, {
          ...rest,
          ...(makeModel !== undefined ? { makeModel: makeModel === null ? FieldValue.delete() : makeModel } : {}),
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
    writeAudit: async (audit) => {
      await db.collection('auditLog').doc().create({ ...audit, createdAt: FieldValue.serverTimestamp() })
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
