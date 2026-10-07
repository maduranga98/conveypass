import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage'
import { afterAll, beforeAll, describe, it } from 'vitest'

const A = 'tenantA'
const B = 'tenantB'
const path = (tenant: string, contractor: string, uid: string, ext = 'jpg') =>
  `tenants/${tenant}/contractors/${contractor}/drivers/${uid}.${ext}`

let env: RulesTestEnvironment

const jpeg = (bytes = 1000) => new Uint8Array(bytes).fill(7)
const JPEG = { contentType: 'image/jpeg' }

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-conveypass-rules',
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  })
  await env.withSecurityRulesDisabled(async (ctx) => {
    const storage = ctx.storage()
    for (const p of [path(A, 'c1', 'drvA1'), path(A, 'c1', 'drvA1b'), path(A, 'c2', 'drvA2'), path(B, 'cB', 'drvB1')]) {
      await uploadBytes(ref(storage, p), jpeg(), JPEG)
    }
  })
})
afterAll(async () => {
  await env.cleanup()
})

const as = (uid: string, claims: Record<string, unknown>) => env.authenticatedContext(uid, claims).storage()
const adminA = () => as('adminA', { role: 'admin', tenantId: A })
const supA1 = () => as('supA1', { role: 'supervisor', tenantId: A, contractorId: 'c1' })
const supA2 = () => as('supA2', { role: 'supervisor', tenantId: A, contractorId: 'c2' })
const drvA1 = () => as('drvA1', { role: 'driver', tenantId: A, contractorId: 'c1' })
const officerA = () => as('offA', { role: 'officer', tenantId: A })
const securityA = () => as('secA', { role: 'security', tenantId: A })

describe('driver photos: read', () => {
  it('admin, officer and security read any photo in their tenant', async () => {
    for (const s of [adminA(), officerA(), securityA()]) {
      await assertSucceeds(getBytes(ref(s, path(A, 'c1', 'drvA1'))))
      await assertSucceeds(getBytes(ref(s, path(A, 'c2', 'drvA2'))))
    }
  })
  it('supervisor reads their contractor’s photos only', async () => {
    await assertSucceeds(getBytes(ref(supA1(), path(A, 'c1', 'drvA1b'))))
    await assertFails(getBytes(ref(supA1(), path(A, 'c2', 'drvA2'))))
  })
  it('a driver reads only their own photo', async () => {
    await assertSucceeds(getBytes(ref(drvA1(), path(A, 'c1', 'drvA1'))))
    await assertFails(getBytes(ref(drvA1(), path(A, 'c1', 'drvA1b'))))
    await assertFails(getBytes(ref(drvA1(), path(A, 'c2', 'drvA2'))))
  })
  it('denies cross-tenant and signed-out reads', async () => {
    for (const s of [adminA(), officerA(), supA1(), drvA1()]) await assertFails(getBytes(ref(s, path(B, 'cB', 'drvB1'))))
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path(A, 'c1', 'drvA1'))))
    await assertFails(getBytes(ref(as('x', {}), path(A, 'c1', 'drvA1'))))
  })
})

describe('driver photos: write', () => {
  it('admin and the contractor’s supervisor can upload a JPEG under 1 MB', async () => {
    await assertSucceeds(uploadBytes(ref(adminA(), path(A, 'c1', 'newDrv1')), jpeg(), JPEG))
    await assertSucceeds(uploadBytes(ref(adminA(), path(A, 'c2', 'newDrv2')), jpeg(), JPEG))
    await assertSucceeds(uploadBytes(ref(supA1(), path(A, 'c1', 'newDrv3')), jpeg(), JPEG))
    await assertSucceeds(uploadBytes(ref(supA1(), path(A, 'c1', 'drvA1')), jpeg(), JPEG)) // replace
  })
  it('a supervisor cannot write to another contractor’s folder', async () => {
    await assertFails(uploadBytes(ref(supA2(), path(A, 'c1', 'newDrv4')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(supA1(), path(A, 'c2', 'newDrv5')), jpeg(), JPEG))
  })
  it('nobody else can write, including the driver themselves', async () => {
    for (const s of [officerA(), securityA(), drvA1()]) {
      await assertFails(uploadBytes(ref(s, path(A, 'c1', 'newDrv6')), jpeg(), JPEG))
      await assertFails(uploadBytes(ref(s, path(A, 'c1', 'drvA1')), jpeg(), JPEG))
    }
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), path(A, 'c1', 'newDrv7')), jpeg(), JPEG))
  })
  it('denies cross-tenant writes', async () => {
    await assertFails(uploadBytes(ref(adminA(), path(B, 'cB', 'newDrv8')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(as('adminB', { role: 'admin', tenantId: B }), path(A, 'c1', 'newDrv9')), jpeg(), JPEG))
  })
  it('enforces content type', async () => {
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'ct1')), jpeg(), { contentType: 'image/png' }))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'ct2')), jpeg(), { contentType: 'text/html' }))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'ct3')), jpeg()))
  })
  it('enforces the 1 MB limit', async () => {
    await assertSucceeds(uploadBytes(ref(adminA(), path(A, 'c1', 'size1')), jpeg(1024 * 1024 - 1), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'size2')), jpeg(1024 * 1024), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'size3')), jpeg(2 * 1024 * 1024), JPEG))
  })
  it('enforces the {uid}.jpg file name', async () => {
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'x', 'png')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'x', 'jpeg')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', 'a.b')), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(adminA(), path(A, 'c1', '..%2Fx')), jpeg(), JPEG))
  })
  it('never deletes from the client', async () => {
    await assertFails(deleteObject(ref(adminA(), path(A, 'c1', 'drvA1'))))
    await assertFails(deleteObject(ref(supA1(), path(A, 'c1', 'drvA1'))))
  })
})

describe('everything else stays denied', () => {
  it('other paths, depths and tenants', async () => {
    const s = adminA()
    await assertFails(uploadBytes(ref(s, 'misc/photo.jpg'), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, `tenants/${A}/photo.jpg`), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, `tenants/${A}/contractors/c1/logo.jpg`), jpeg(), JPEG))
    await assertFails(uploadBytes(ref(s, `tenants/${A}/contractors/c1/drivers/sub/x.jpg`), jpeg(), JPEG))
    await assertFails(getBytes(ref(s, 'misc/photo.jpg')))
  })
})
