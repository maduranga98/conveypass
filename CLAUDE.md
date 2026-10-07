# ConvoyPass: conventions for future sessions

Multi-tenant PWA for approving gate passes for third-party contractor vehicles.
Flow: Driver pre-trip form -> Supervisor approves -> Officer approves -> Security checks in.
**Module 1 (users, roles, auth) is built.** Vehicles, driver profiles, QR codes, passes, approvals, gate check-in and reports come later.

## Stack
Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`) + Tailwind v4, react-router-dom v7, TanStack Query, react-hook-form + zod, sonner, lucide-react.
Firebase modular SDK: Auth, Firestore, Cloud Functions v2 (Node 22, `functions/`), Hosting, emulators. Path alias `@/` -> `src/`.

## Layout
`src/app` (router, providers) · `src/lib` (firebase, strings, credentials, errors, api) · `src/features/{auth,admin}` · `src/components/ui` · `src/types` · `functions/src` · `scripts/seed.ts` · `tests/rules`.

## Rules of the road
- **Roles**: `admin | officer | supervisor | driver | security`. Homes: `/admin /officer /supervisor /driver /security`.
- **Tenancy**: every query and write is tenant-scoped (`where('tenantId','==',claims.tenantId)`). Never trust role/tenant/contractor from client input.
- **Claims** `{ role, tenantId, contractorId? }` are set ONLY by Cloud Functions. After a claim change the client calls `getIdToken(true)`. Roles are never stored in localStorage. UI guards are convenience only; Firestore rules + functions enforce access.
- **Firestore rules** are deny-by-default. `users`, `tenants`, `auditLog` have no client writes. `contractors` are admin-writable with field validation, no delete (suspend instead).
- **Auth**: staff = email + password (min 8). Driver = Sri Lankan mobile + 6-digit PIN, signed in via synthetic email `<94XXXXXXXXX>@drivers.convoypass.com` (constant `DRIVER_EMAIL_DOMAIN`; never shown to drivers, never receives mail). `mustChangePassword` forces `/change-password` before anything else.
- **Callables** (`createUser`, `updateUser`, `resetCredential`, `changeOwnPassword`): zod-validated, caller from `request.auth.token` (and re-checked against the caller's active `users` doc), typed `HttpsError` with `details.reason` that the client maps through `strings.apiErrors`. Never log passwords/PINs. Never allow role/tenant changes after creation.
- **Region**: `FUNCTIONS_REGION` (functions/.env) and `VITE_FUNCTIONS_REGION` (.env) must match; default `asia-south1`.
- **Strings**: all user-facing text in `src/lib/strings.ts` (Sinhala/Tamil later).
- **Shared logic duplicated on purpose**: `src/lib/credentials.ts` and `functions/src/credentials.ts` (functions deploy from their own folder). Change both, plus tests.
- **UI**: minimalist, slate neutrals, single accent (`accent` tokens in `src/index.css`), no gradients, mobile-first (login, driver, supervisor, security); admin = sidebar on desktop, top bar on mobile. Every list needs loading, empty and error states. Accessible: labels, focus rings, keyboard.
- No `any` (lint-enforced). No secrets, project IDs or credentials in code.

## Commands
`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` (unit + functions + rules; rules start the Firestore emulator) · `npm run emulators` · `npm run seed:emulator -- --email … --password …` · `npm run seed:prod -- --confirm-production --email … --password …`
