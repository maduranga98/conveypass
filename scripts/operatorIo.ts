// Admin SDK wiring shared by `create-operator.ts` and `disable-operator.ts`. Connects lazily, so a refused production
// call (no --confirm-prod) never initialises the SDK.
import { FieldValue } from 'firebase-admin/firestore'
import { confirmedProd, connect, readJson, targetFrom } from './adminSdk.ts'
import type { Firebaserc } from './envTarget.ts'
import { randomTempPassword, type OperatorIo } from './operatorsCli.ts'

export function operatorIo(argv: string[]): OperatorIo {
  const envFlag = argv.find((_a, i) => argv[i - 1] === '--env')
  let sdk: ReturnType<typeof connect> | undefined
  const get = () =>
    (sdk ??= connect(targetFrom(envFlag, confirmedProd({ 'confirm-prod': argv.includes('--confirm-prod'), 'confirm-production': argv.includes('--confirm-production') }))))
  const audit = (a: unknown) => ({ ...(a as object), createdAt: FieldValue.serverTimestamp() })
  return {
    auth: {
      getUserByEmail: (email) => get().auth.getUserByEmail(email).then((u) => ({ uid: u.uid }), (e: { code?: string }) => (e.code === 'auth/user-not-found' ? null : Promise.reject(e))),
      createUser: async (p) => ({ uid: (await get().auth.createUser(p)).uid }),
      setCustomUserClaims: (uid, claims) => get().auth.setCustomUserClaims(uid, claims),
      deleteUser: (uid) => get().auth.deleteUser(uid),
      disableUser: async (uid) => void (await get().auth.updateUser(uid, { disabled: true })),
      revokeRefreshTokens: (uid) => get().auth.revokeRefreshTokens(uid),
    },
    db: {
      tenantUserExistsWithEmail: async (email) => !(await get().db.collection('users').where('email', '==', email).limit(1).get()).empty,
      getOperator: async (uid) => {
        const x = (await get().db.doc(`operators/${uid}`).get()).data()
        return x ? { status: String(x.status) } : null
      },
      createOperator: async (uid, doc, a) => {
        const db = get().db
        const batch = db.batch()
        batch.create(db.doc(`operators/${uid}`), { ...doc, createdAt: FieldValue.serverTimestamp() })
        batch.create(db.collection('platformAuditLog').doc(), audit(a))
        await batch.commit()
      },
      disableOperator: async (uid, a) => {
        const db = get().db
        const batch = db.batch()
        batch.update(db.doc(`operators/${uid}`), { status: 'disabled', updatedAt: FieldValue.serverTimestamp() })
        batch.create(db.collection('platformAuditLog').doc(), audit(a))
        await batch.commit()
      },
    },
    out: (l) => console.log(l),
    firebaserc: readJson<Firebaserc>('.firebaserc'),
    randomPassword: () => randomTempPassword(20),
  }
}
