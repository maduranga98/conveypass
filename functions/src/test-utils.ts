import { expect } from 'vitest'
// In-memory fakes for the ports, shared by the function tests. Not part of the build (see tsconfig.json).
import { PlateTakenError, VehicleIdTakenError, type Deps } from './core.js'
import { planSubmit } from './passRules.js'
import type {
  AuditEntry,
  Caller,
  Claims,
  ContractorData,
  DriverData,
  GateEventData,
  PassData,
  StoredFile,
  TenantData,
  UserData,
  VehicleData,
} from './types.js'

export const NOW = 1_700_000_000

export const userDoc = (over: Partial<UserData> = {}): UserData => ({
  tenantId: 'T1',
  role: 'driver',
  contractorId: 'C1',
  name: 'Name',
  email: null,
  phone: '94771234567',
  status: 'active',
  mustChangePassword: false,
  ...over,
})

export const driverDoc = (over: Partial<DriverData> = {}): DriverData => ({
  tenantId: 'T1',
  contractorId: 'C1',
  name: 'Name',
  phone: '94771234567',
  status: 'active',
  ...over,
})

export interface World {
  deps: Deps
  users: Map<string, UserData>
  drivers: Map<string, DriverData>
  contractors: Map<string, ContractorData>
  vehicles: Map<string, VehicleData>
  /** `${tenantId}_${plateKey}` -> vehicleId */
  plates: Map<string, string>
  authUsers: Map<string, { email: string; password: string; disabled: boolean; displayName: string }>
  claims: Map<string, Claims>
  tenants: Map<string, TenantData>
  passes: Map<string, PassData>
  gateEvents: Map<string, GateEventData>
  /** Storage objects by full path. */
  files: Map<string, StoredFile>
  audits: AuditEntry[]
  revoked: string[]
  failFirestoreCreate: boolean
  /** Ids handed out by `newVehicleId`, in order. Set to force collisions. */
  idQueue: string[]
  /** Uids whose revokeRefreshTokens should throw. */
  failRevoke: Set<string>
}

export function makeWorld(): World {
  const w: World = {
    users: new Map(),
    drivers: new Map(),
    contractors: new Map(),
    vehicles: new Map(),
    plates: new Map(),
    authUsers: new Map(),
    claims: new Map(),
    tenants: new Map(),
    passes: new Map(),
    gateEvents: new Map(),
    files: new Map(),
    audits: [],
    revoked: [],
    failFirestoreCreate: false,
    idQueue: [],
    failRevoke: new Set(),
    deps: undefined as unknown as Deps,
  }
  let n = 0
  let idn = 0
  w.deps = {
    now: () => NOW,
    newVehicleId: () => w.idQueue.shift() ?? `veh_${String(++idn).padStart(10, 'a')}`,
    storage: { readFile: async (path) => w.files.get(path) ?? null },
    auth: {
      createUser: async (p) => {
        if ([...w.authUsers.values()].some((u) => u.email === p.email)) {
          throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' })
        }
        const uid = `new${++n}`
        w.authUsers.set(uid, { email: p.email, password: p.password, disabled: false, displayName: p.displayName })
        return { uid }
      },
      deleteUser: async (uid) => void w.authUsers.delete(uid),
      updateUser: async (uid, p) => {
        const u = w.authUsers.get(uid) ?? { email: '', password: '', disabled: false, displayName: '' }
        w.authUsers.set(uid, { ...u, ...p })
      },
      setCustomUserClaims: async (uid, c) => void w.claims.set(uid, c),
      revokeRefreshTokens: async (uid) => {
        if (w.failRevoke.has(uid)) throw new Error('revoke failed')
        w.revoked.push(uid)
      },
    },
    data: {
      getUser: async (uid) => w.users.get(uid) ?? null,
      getContractor: async (id) => w.contractors.get(id) ?? null,
      getDriver: async (uid) => w.drivers.get(uid) ?? null,
      getDrivers: async (uids) => new Map(uids.flatMap((u) => (w.drivers.has(u) ? [[u, w.drivers.get(u) as DriverData] as const] : []))),
      getVehicle: async (id) => w.vehicles.get(id) ?? null,
      createUserWithAudit: async (uid, data, _actor, audit, driver) => {
        if (w.failFirestoreCreate) throw new Error('boom')
        w.users.set(uid, data)
        if (driver) w.drivers.set(uid, driver)
        w.audits.push(audit)
      },
      updateUserWithAudit: async (uid, patch, audit, driver) => {
        w.users.set(uid, { ...(w.users.get(uid) as UserData), ...patch })
        if (driver) {
          const base = w.drivers.get(uid) ?? driver.backfill
          if (base) w.drivers.set(uid, { ...base, ...driver.patch })
        }
        w.audits.push(audit)
      },
      // The fakes below read and write synchronously, which models transaction atomicity.
      createVehicleTx: async ({ vehicleId, vehicle, audit }) => {
        const guard = `${vehicle.tenantId}_${vehicle.plateKey}`
        if (w.plates.has(guard)) throw new PlateTakenError()
        if (w.vehicles.has(vehicleId)) throw new VehicleIdTakenError()
        w.plates.set(guard, vehicleId)
        w.vehicles.set(vehicleId, structuredClone(vehicle))
        w.audits.push(audit)
      },
      updateVehicleTx: async ({ vehicleId, patch, plate, audit }) => {
        const current = w.vehicles.get(vehicleId) as VehicleData
        const next: VehicleData = { ...current }
        const { makeModel, ...rest } = patch
        Object.assign(next, rest)
        if (makeModel === null) delete next.makeModel
        else if (makeModel !== undefined) next.makeModel = makeModel
        if (plate && plate.plateKey !== current.plateKey) {
          const guard = `${current.tenantId}_${plate.plateKey}`
          const owner = w.plates.get(guard)
          if (owner !== undefined && owner !== vehicleId) throw new PlateTakenError()
          w.plates.delete(`${current.tenantId}_${current.plateKey}`)
          w.plates.set(guard, vehicleId)
          next.plateKey = plate.plateKey
        }
        w.vehicles.set(vehicleId, next)
        w.audits.push(audit)
      },
      setContractorStatusWithAudit: async (id, status, audit) => {
        w.contractors.set(id, { ...(w.contractors.get(id) as ContractorData), status })
        w.audits.push(audit)
      },
      getTenant: async (id) => w.tenants.get(id) ?? null,
      getPass: async (id) => structuredClone(w.passes.get(id) ?? null),
      submitPassTx: async ({ passId, pass, audit }) => {
        const existing = w.passes.get(passId) ?? null
        const plan = planSubmit(existing, pass.driverId, pass.attempt)
        if (plan === 'create') {
          w.passes.set(passId, { ...structuredClone(pass), status: 'submitted', submittedAt: NOW * 1000 })
        } else {
          const prev = existing as PassData
          const { rejection, supervisor: _s, officer: _o, ...keep } = prev
          void _s
          void _o
          w.passes.set(passId, {
            ...keep,
            ...structuredClone(pass),
            status: 'submitted',
            submittedAt: NOW * 1000,
            rejectionHistory: [
              ...(prev.rejectionHistory ?? []),
              { ...(rejection as NonNullable<typeof rejection>), attempt: prev.attempt, checklist: prev.checklist, evidence: prev.evidence },
            ],
          })
        }
        w.audits.push(audit)
      },
      decidePassTx: async ({ passId, plan }) => {
        // Synchronous from the read to the write, which models transaction atomicity.
        const pass = w.passes.get(passId)
        const ctx = pass
          ? {
              pass: structuredClone(pass),
              vehicle: w.vehicles.get(pass.vehicleId) ?? null,
              contractor: w.contractors.get(pass.contractorId) ?? null,
              driver: w.users.get(pass.driverId) ?? null,
            }
          : null
        const decision = plan(ctx)
        const { update, audit } = decision
        const { rejection: _old, ...rest } = pass as PassData
        void _old
        w.passes.set(passId, {
          ...rest,
          ...structuredClone(update.supervisor ? { supervisor: update.supervisor } : {}),
          ...structuredClone(update.officer ? { officer: update.officer } : {}),
          ...structuredClone(update.rejection ? { rejection: update.rejection } : {}),
          status: update.status,
          history: [...(rest.history ?? []), structuredClone(update.entry)],
        })
        w.audits.push(audit)
        return decision
      },
      checkInTx: async ({ passId, plan }) => {
        // Synchronous from the read to the write, which models transaction atomicity.
        const pass = w.passes.get(passId)
        const ctx = pass
          ? {
              pass: structuredClone(pass),
              vehicle: w.vehicles.get(pass.vehicleId) ?? null,
              contractor: w.contractors.get(pass.contractorId) ?? null,
              driver: w.users.get(pass.driverId) ?? null,
            }
          : null
        const decision = plan(ctx)
        if (decision.kind === 'write') {
          const current = pass as PassData
          w.passes.set(passId, {
            ...current,
            status: 'checked_in',
            checkIn: structuredClone(decision.checkIn),
            history: [...(current.history ?? []), structuredClone(decision.entry)],
          })
          w.audits.push(decision.audit)
        }
        return decision
      },
      denyEntryTx: async ({ eventId, event, audit }) => {
        const existing = w.gateEvents.get(eventId)
        if (existing) return { created: false, event: structuredClone(existing) }
        w.gateEvents.set(eventId, structuredClone(event))
        w.audits.push(audit)
        return { created: true, event }
      },
      updateTenantSettingsWithAudit: async (id, patch, audit) => {
        w.tenants.set(id, { ...(w.tenants.get(id) as TenantData), ...patch })
        w.audits.push(audit)
      },
      writeAudit: async (audit) => void w.audits.push(audit),
      countPasses: async (q) => (await w.deps.data.listPasses(q, Number.MAX_SAFE_INTEGER)).length,
      listPasses: async (q, limit) =>
        [...w.passes]
          .filter(([, p]) => {
            if (p.tenantId !== q.tenantId) return false
            if (q.kind === 'checkIn') return p.checkIn !== undefined && p.checkIn.at >= q.startMs && p.checkIn.at < q.endMs
            return (
              p.dateKey >= q.fromKey &&
              p.dateKey <= q.toKey &&
              (!q.statuses || q.statuses.includes(p.status)) &&
              (!q.contractorId || p.contractorId === q.contractorId) &&
              (!q.vehicleId || p.vehicleId === q.vehicleId) &&
              (!q.driverId || p.driverId === q.driverId)
            )
          })
          .slice(0, limit)
          .map(([id, p]) => {
            const { evidence: _e, checklist: _c, captureMeta: _m, tenantId: _t, ...rest } = structuredClone(p)
            void _e; void _c; void _m; void _t
            const { rejectionHistory, ...slim } = rest
            return {
              ...slim,
              id,
              ...(rejectionHistory ? { rejectionHistory: rejectionHistory.map(({ checklist: _k, evidence: _v, ...r }) => (void _k, void _v, r)) } : {}),
            }
          }),
      countGateEvents: async (q) => (await w.deps.data.listGateEvents(q, Number.MAX_SAFE_INTEGER)).length,
      listGateEvents: async (q, limit) =>
        [...w.gateEvents]
          .filter(([, e]) => e.tenantId === q.tenantId && e.at >= q.startMs && e.at < q.endMs)
          .slice(0, limit)
          .map(([id, e]) => ({ ...structuredClone(e), id })),
      listContractorNames: async (tenantId) =>
        new Map([...w.contractors].filter(([, c]) => c.tenantId === tenantId).map(([id]) => [id, `Name ${id}`])),
      listUserIdsByContractor: async (tenantId, contractorId) =>
        [...w.users].filter(([, u]) => u.tenantId === tenantId && u.contractorId === contractorId).map(([uid]) => uid),
    },
  }
  w.tenants.set('T1', { timezone: 'Asia/Colombo' })
  w.tenants.set('T2', {})
  w.contractors.set('C1', { tenantId: 'T1', status: 'active' })
  w.contractors.set('C2', { tenantId: 'T1', status: 'active' })
  w.contractors.set('CX', { tenantId: 'T2', status: 'active' })
  w.contractors.set('CS', { tenantId: 'T1', status: 'suspended' })
  w.users.set('admin', userDoc({ role: 'admin', contractorId: null, email: 'a@x.com', phone: null }))
  w.users.set('admin2', userDoc({ role: 'admin', contractorId: null, email: 'a2@x.com', phone: null }))
  w.users.set('sup1', userDoc({ role: 'supervisor', contractorId: 'C1', email: 's1@x.com', phone: null }))
  w.users.set('sup2', userDoc({ role: 'supervisor', contractorId: 'C2', email: 's2@x.com', phone: null }))
  w.users.set('officer', userDoc({ role: 'officer', contractorId: null, email: 'o@x.com', phone: null }))
  w.users.set('sec', userDoc({ role: 'security', contractorId: null, email: 'sec@x.com', phone: null }))
  w.users.set('drv1', userDoc({ contractorId: 'C1' }))
  w.users.set('drv2', userDoc({ contractorId: 'C2', phone: '94770000002' }))
  w.users.set('foreign', userDoc({ tenantId: 'T2', contractorId: 'CX', phone: '94770000009' }))
  // Drivers that went through createUser after Module 2 have a `drivers` doc.
  w.drivers.set('drv1', driverDoc({ contractorId: 'C1' }))
  w.drivers.set('drv1b', driverDoc({ contractorId: 'C1', phone: '94770000011' }))
  w.drivers.set('drv2', driverDoc({ contractorId: 'C2', phone: '94770000002' }))
  w.drivers.set('drvOff', driverDoc({ contractorId: 'C1', phone: '94770000012', status: 'disabled' }))
  w.drivers.set('foreign', driverDoc({ tenantId: 'T2', contractorId: 'CX', phone: '94770000009' }))
  return w
}

export const caller = (
  uid: string,
  role: Caller['role'],
  contractorId: string | null = null,
  over: Partial<Caller> = {},
): Caller => ({ uid, role, tenantId: 'T1', contractorId, authTime: NOW - 10, ...over })

export const admin = () => caller('admin', 'admin')
export const sup1 = () => caller('sup1', 'supervisor', 'C1')
export const sup2 = () => caller('sup2', 'supervisor', 'C2')

export const rejects = (p: Promise<unknown>, code: string, reason?: string) =>
  expect(p).rejects.toMatchObject({ code, ...(reason ? { details: { reason } } : {}) })

export const drv1 = () => caller('drv1', 'driver', 'C1')
export const drv1b = () => caller('drv1b', 'driver', 'C1')
