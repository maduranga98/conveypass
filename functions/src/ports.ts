import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { AuthPort, DataPort } from './core.js'
import type { ContractorData, UserData } from './types.js'

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
    createUserWithAudit: async (uid, data, actorUid, audit) => {
      const batch = db.batch()
      batch.create(db.doc(`users/${uid}`), {
        ...data,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      })
      batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
    updateUserWithAudit: async (uid, patch, audit) => {
      const batch = db.batch()
      batch.update(db.doc(`users/${uid}`), { ...patch, updatedAt: FieldValue.serverTimestamp() })
      batch.create(db.collection('auditLog').doc(), { ...audit, createdAt: FieldValue.serverTimestamp() })
      await batch.commit()
    },
  }
}
