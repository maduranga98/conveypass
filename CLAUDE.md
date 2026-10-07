# ConvoyPass: conventions for future sessions

Multi-tenant PWA for approving gate passes for third-party contractor vehicles.
Flow: Driver pre-trip form -> Supervisor approves -> Officer approves -> Security checks in.
**Module 1 (users, roles, auth) and Module 2 (contractors, vehicles, driver profiles, vehicle QR) are built.** Passes, the driver pre-trip form, QR scanning, approvals, gate check-in, reports and document-expiry alerts come later.

## Stack
Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`) + Tailwind v4, react-router-dom v7, TanStack Query, react-hook-form + zod, sonner, lucide-react.
Firebase modular SDK: Auth, Firestore, Cloud Functions v2 (Node 22, `functions/`), Hosting, emulators. Path alias `@/` -> `src/`.

## Layout
`src/app` (router, providers) · `src/lib` (firebase, strings, credentials, plate, appUrl, vehicleTypes, errors, api) · `src/features/{auth,admin,vehicles,drivers,qr,supervisor,shared}` · `src/components/ui` · `src/types` · `functions/src` · `scripts/{seed,seed-demo}.ts` · `tests/rules`.

## Rules of the road
- **Roles**: `admin | officer | supervisor | driver | security`. Homes: `/admin /officer /supervisor /driver /security`.
- **Tenancy**: every query and write is tenant-scoped (`where('tenantId','==',claims.tenantId)`). Never trust role/tenant/contractor from client input.
- **Claims** `{ role, tenantId, contractorId? }` are set ONLY by Cloud Functions. After a claim change the client calls `getIdToken(true)`. Roles are never stored in localStorage. UI guards are convenience only; Firestore rules + functions enforce access.
- **Firestore rules** are deny-by-default. `users`, `tenants`, `auditLog` have no client writes. `contractors` are admin-writable with field validation, no delete (suspend instead).
- **Auth**: staff = email + password (min 8). Driver = Sri Lankan mobile + 6-digit PIN, signed in via synthetic email `<94XXXXXXXXX>@drivers.convoypass.com` (constant `DRIVER_EMAIL_DOMAIN`; never shown to drivers, never receives mail). `mustChangePassword` forces `/change-password` before anything else.
- **Callables** (`createUser`, `updateUser`, `resetCredential`, `changeOwnPassword`): zod-validated, caller from `request.auth.token` (and re-checked against the caller's active `users` doc), typed `HttpsError` with `details.reason` that the client maps through `strings.apiErrors`. Never log passwords/PINs. Never allow role/tenant changes after creation.
- **Region**: `FUNCTIONS_REGION` (functions/.env) and `VITE_FUNCTIONS_REGION` (.env) must match; default `asia-south1`.
- **Vehicles** (`vehicles/{vehicleId}`): the doc id **is** the permanent QR id, `veh_` + 10 random `[a-z0-9]`, generated server-side, immutable. The QR encodes only `${VITE_APP_BASE_URL}/v/${vehicleId}`, never names or plates. `assignedDriverIds` on the vehicle is the single source of truth for assignments (many drivers per vehicle, many vehicles per driver); a driver's vehicles are derived from it.
- **Plates**: `plateNo` is the display form (uppercase, single spaces), `plateKey` is uppercase alphanumerics only (4-12). Uniqueness per tenant is guarded by `vehiclePlates/{tenantId}_{plateKey}` (`{ vehicleId }`), reserved and moved inside a Firestore transaction. `normalisePlate` is duplicated on purpose in `src/lib/plate.ts` and `functions/src/plate.ts`; so is the vehicle type allow-list (`vehicleTypes.ts`). Change both, plus tests.
- **Drivers** (`drivers/{uid}`, same id as `users`): tenantId, contractorId, name, phone, licenseNo?, photoPath?, status. name/phone/status mirror `users` (written by `createUser`/`updateUser` in one batch; drivers that predate Module 2 are backfilled on their first edit). Photo path is exactly `tenants/{tenantId}/contractors/{contractorId}/drivers/{uid}.jpg`; `updateUser` rejects anything else.
- **Client writes**: none to `vehicles`, `drivers`, `vehiclePlates`. All mutations are callables (`createVehicle`, `updateVehicle`, `setVehicleStatus`, `setVehicleDrivers`, `importVehicles` (<=200 rows, one transaction per row, per-row results), `setContractorStatus`). Contractors keep admin writes for descriptive fields only (name, contactName, phone, address, notes); a new contractor must start `active` and `status` can only change through `setContractorStatus` (admin only; suspend revokes refresh tokens of every user of that contractor, activate touches the doc only). No hard deletes anywhere: suspend instead.
- **Suspended contractors**: `requireActiveCaller` re-checks the caller's contractor on every call (ID tokens outlive revocation), and `AuthProvider` signs out contractor users while their contractor is suspended.
- **Storage rules**: only the driver photo path is open. Write: admin, or the supervisor of that contractor; `image/jpeg`, under 1 MB; create/update only. Read: admin/officer/security of the tenant, that contractor's supervisor, or the driver themselves. A driver cannot read a vehicle they are not assigned to; Module 3 resolves scans through a callable (do not loosen the rules).
- **Lists**: loaded once per scope (`admin` = tenant, `supervisor` = own contractor; supervisors cannot query `contractors` tenant-wide, rules allow only their own doc), max 1000 docs ordered by plateKey/name, filtered client-side, invalidated after mutations. The same feature components serve both scopes via a `scope` prop. Queries must include the same `where` clauses the rules require.
- **QR**: `VITE_APP_BASE_URL` is required for QR screens (`QrGate`); a localhost/private/non-production host (pin the real domain with `VITE_PRODUCTION_HOST`) shows the red "Dev link: do not print" banner. `qrcode.react`, level `Q`; PNG download is 1024 px via canvas. Label sheets print A4 with 10 mm margins (large 90 mm 2x3, small 50 mm 3x5); app chrome hides itself with `print:` variants.
- **API payloads**: send phone numbers as typed (`07…`); the server normalises them. The `94…` form is not accepted as input.
- **Strings**: all user-facing text in `src/lib/strings.ts` (Sinhala/Tamil later).
- **Shared logic duplicated on purpose**: `src/lib/credentials.ts` and `functions/src/credentials.ts` (functions deploy from their own folder). Change both, plus tests.
- **UI**: minimalist, slate neutrals, single accent (`accent` tokens in `src/index.css`), no gradients, mobile-first (login, driver, supervisor, security); admin = sidebar on desktop, top bar on mobile. Every list needs loading, empty and error states. Accessible: labels, focus rings, keyboard.
- No `any` (lint-enforced). No secrets, project IDs or credentials in code.

## Commands
`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` (unit + functions + rules; functions and rules start the Firestore/Storage emulators) · `npm run emulators` · `npm run seed:emulator -- --email … --password …` · `npm run seed:demo` (emulator only; 2 contractors, 6 vehicles, 4 drivers, prints logins) · `npm run seed:prod -- --confirm-production --email … --password …`
