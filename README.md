# ConvoyPass

Multi-tenant PWA for approving gate passes for third-party contractor vehicles. A driver fills a pre-trip form (photos
of the GPS device and dashcam, checklist), a supervisor approves, an officer approves, security checks the vehicle in
at the gate. Supervisors and officers are alerted in the app and by web push; admins and officers get a live dashboard,
reports and an audit log. `CLAUDE.md` holds the conventions; `docs/ops.md` is the operations runbook;
`docs/privacy-notes.md` lists what personal data is stored.

## Architecture

```
 browser (React 19 PWA, one service worker)                       Firebase
 ───────────────────────────────────────────                      ──────────────────────────────────────────────
 login · driver · supervisor · officer · admin · security  ──────► Auth (email+password; drivers: phone+PIN)
   TanStack Query, live onSnapshot listeners (passes,      ──────► Firestore  (reads under deny-by-default rules;
   notifications), offline gate queue (IndexedDB)                    tenant + role from custom claims)
   photos straight to Storage (rules check the path)       ──────► Storage    (driver photos, pass evidence)
   every write ───────────────────────────────────────────► Cloud Functions v2 (callables: the only writers)
                                                                   │  validate (zod), re-check the caller, state machine,
                                                                   │  audit entry in the same transaction
                                                                   ▼
                                           Firestore triggers ──► notifications + web push (FCM, data-only)
                                           schedules ───────────► SLA reminders (10 min), evidence retention (daily)
 Hosting: static app + security headers + CSP (report-only first) + /csp-report
```

- **Reads direct, writes through functions.** Clients never write `users`, `vehicles`, `drivers`, `passes`, `gateEvents`,
  `auditLog` or `tenants`. The one client write is `notifications.readAt` on your own notifications.
- **The pass state machine** lives in one file, `functions/src/passTransitions.ts` (mirrored read-only in `src/lib`).
- **Notifications come from Firestore triggers**, so the approval and gate code is untouched. Deterministic ids make
  duplicate deliveries harmless.
- **Multi-tenant**: every query is scoped by the tenant in the caller's token; roles are `admin | officer | supervisor | driver | security`.
- Stack: Vite, React 19, TypeScript (strict), Tailwind v4, react-router, TanStack Query, react-hook-form + zod; Firebase Auth,
  Firestore, Storage, Functions (Node 22), Hosting, FCM, App Check.

## Local setup

```bash
npm install                      # also installs functions/ deps
cp .env.example .env.local       # fill VITE_FIREBASE_*; set VITE_USE_EMULATORS=true for local work
cp functions/.env.example functions/.env
npm --prefix functions run build
npm run emulators                # auth 9099, firestore 8080, functions 5001, storage 9199, UI 4000
npm run create-tenant -- --env emulator --tenant-name "Acme" --email admin@example.com --password 'ChangeMe123'
# or, for a populated demo tenant (every role, passes in every state with photos, notifications, 30 days of history;
# prints the logins and what to try):
npm run seed:demo
npm run dev                      # http://localhost:5173
```

### First-time setup of a workspace (invite link)

New clients are onboarded with a one-time link, not a script run on their behalf. The normal way to make one is the
**operator console** (`/platform`): create your operator account once, sign in with the Staff tab, and use *Invites* to create,
copy, send (WhatsApp or email) and revoke links:

```bash
export APP_BASE_URL=http://localhost:5173      # the public https origin in staging and production
npm run operator:create -- --env emulator --email you@convoypass.test --name "You"   # password (12+ chars) generated and printed once, or pass --password
npm run dev                                    # sign in at /login (Staff tab) -> /platform/invites -> New invite
```

Without the console (fallback), the script makes the same invite:

```bash
export APP_BASE_URL=http://localhost:5173      # the public https origin in staging and production
npm run invite:create -- --env emulator --company "Acme" --lock-email admin@acme.test   # prints /setup#code=... once
# open the link: create the workspace and the first admin (signs in, lands on /admin/dashboard with a checklist)
```

The link creates exactly one tenant and one admin and then stops working; invalid, expired and used links show the same
message. Lost password: *Forgot password?* on the login page (staff, by email), or `npm run admin:reset` for an admin.
Drivers (phone + PIN) are reset by their supervisor. `docs/ops.md` has the full runbook ("Onboarding a new client",
"Admin locked out") and the Firebase console settings for the emails.

Set `VITE_APP_BASE_URL` in `.env.local` (e.g. `http://localhost:5173`): vehicle QR codes encode `${VITE_APP_BASE_URL}/v/<vehicleId>`. A localhost value shows a red "Dev link: do not print" banner on QR screens; use the production URL (and optionally `VITE_PRODUCTION_HOST`) before printing real labels.

Emulators need Java 21+. `seed:demo` also needs `VITE_FIREBASE_STORAGE_BUCKET` in `.env`/`.env.local` (or `FIREBASE_STORAGE_BUCKET`) to match the bucket the app uses, and `FIREBASE_PROJECT_ID` when the emulators run under a `demo-` project.

Web push needs `VITE_FIREBASE_VAPID_KEY` (Firebase console > Cloud Messaging > Web Push certificates); App Check needs `VITE_APP_CHECK_SITE_KEY`. Both are optional locally. The service worker is built and registered in production builds only (`npm run build && npm run preview`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `preview` | Vite dev server, production build (`tsc -b` first), preview of the build |
| `npm run typecheck` | `tsc -b` for the web app, the service worker, scripts and e2e, then the functions |
| `npm run lint` | ESLint, including `jsx-a11y` |
| `npm test` | unit + component (jsdom), function tests and rules tests (both start the emulators) |
| `npm run test:unit` / `test:functions` / `test:rules` | one part of the above |
| `npm run test:e2e` | Playwright against the Auth, Firestore, Functions and Storage emulators and the app (bell fed by the real trigger, opt-in, iOS guidance, axe + 44 px targets, CSP run). Install a browser with `npx playwright install chromium`, or set `PW_CHROMIUM_PATH` |
| `npm run bundle:report [-- --budget]` | gzipped first load per route from the last build; `--budget` fails over the limits (CI) |
| `npm run emulators` | auth, firestore, functions, storage |
| `npm run seed:demo` | demo tenant (emulator only): all roles, passes in every state, notifications, fake push devices, SLA-breaching passes |
| `npm run sla:check` | run the SLA reminder check once on the emulator |
| `npm run operator:create` / `operator:disable` `-- --env … --email …` | platform operators for the `/platform` console (script only; `prod` needs `--confirm-prod`; `create` needs `--name` and a 12+ character `--password`, or generates one) |
| `npm run invite:create` / `invite:list` / `invite:revoke` `-- --env …` | setup invites, fallback to the console (the link is printed once; needs `APP_BASE_URL`; `prod` needs `--confirm-prod`) |
| `npm run admin:reset -- --env … --email … --link\|--temp-password` | recover a locked-out admin (a reset link, or a one-time temporary password) |
| `npm run verify:invite-access` | emulator check that no client role can read or write `setupInvites` |
| `npm run create-tenant -- --env emulator\|staging\|prod` | a tenant and its first admin, chosen by the operator (`prod` needs `--confirm-production`) |
| `npm run verify-restore` / `drill:restore` | compare document counts after a restore / rehearse export and import on the emulator |
| `npm run config:csp` | write `firebase.enforce-csp.json` (the enforcing CSP) from `firebase.json` |
| `npm run seed:emulator` / `seed:prod` | the older single-admin bootstrap |

## Environments

| | Project | Config | Deploy |
|---|---|---|---|
| local | emulators (`demo-*`) | `.env.local`, `functions/.env` | `npm run emulators`, `npm run dev` |
| `staging` | `.firebaserc` alias (placeholder to replace) | `functions/.env.staging`, GitHub environment `staging` | push a `v*` tag: automatic |
| `prod` | `.firebaserc` alias (placeholder to replace) | `functions/.env.prod`, GitHub environment `production` | same tag, after a manual approval |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, function and rules tests on the emulators, the build and
the bundle budget on every pull request. `deploy.yml` deploys rules/indexes/storage rules first, then functions, then hosting.
Setup, rollback, backups, the restore drill, App Check rollout, TTL, budgets and incident steps are in **`docs/ops.md`**.

### Demo the approval chain (Module 4)

1. `npm run emulators`, then `npm run seed:demo`, then `npm run dev`.
2. Driver `0771000001` / PIN `482915` opens the `/v/<id>` link the seed prints for `CAB-1234` and submits a pass.
3. Supervisor `supervisor.lanka@demo.convoypass.test` / `DemoSuper123` sees it appear under **Approvals** (badge goes up) and approves it. Passes with a "No" answer must be opened one by one.
4. Officer `officer@demo.convoypass.test` / `DemoOfficer123` sees it under **Awaiting me**, opens the panel and presses `A`.
5. The driver's screen turns green. Reject at either step instead, and the driver gets a red "Fix and resubmit" card; admin `admin@demo.convoypass.test` / `DemoAdmin123` can view everything under **Passes** and revoke an approval, but never approve or reject. Sign in as the seeded admin (you will be asked to set a new password), create a contractor, then users.

### Demo the gate (Module 5)

1. Same start as above. The seed prints a `/v/<id>` URL for every gate result (approved, already checked in, pending,
   rejected, no pass, and approved passes blocked by a suspended vehicle, disabled driver or suspended contractor).
2. Security `security@demo.convoypass.test` / `DemoGate123`: pick a gate (top bar), then scan, search the last digits
   of a plate (e.g. `7788`) or tap a card under **Awaiting entry**. Green APPROVED offers **CHECK IN**; red and amber
   results offer **Record denied entry** and **Scan next**.
3. Open `250-1234` (waiting for the officer) as security, approve it as the officer in another window: it turns green.
4. Offline: open the gate home, turn the network off (DevTools > Network > Offline), open an approved card and check it
   in ("Saved offline, will sync"). Revoke another queued pass as the officer before reconnecting to see a rejected
   queue item. Back online, the queue syncs by itself (or **Retry now** on `/security/queue`).
5. Admin: **Gate log** lists the day's check-ins and denials; **Settings > Gates** edits the gates. Admin, officer and
   supervisors can open the same `/v/<id>` URLs read only.

**On a real phone:** the camera and `crypto.randomUUID` need a secure context. Either deploy to Hosting
(`npm run build && firebase deploy --only hosting`) and open the https URL, or expose the dev server over https, e.g.
`npx vite --host` behind a tunnel such as `cloudflared tunnel --url http://localhost:5173` (set `VITE_APP_BASE_URL`
to the tunnel URL so printed or on-screen QR codes match). With the emulators, the phone must also reach the emulator
ports, so a deployed test project is usually simpler. Allow the camera when asked; if it was blocked, re-enable it in
the browser's site settings. Test offline with airplane mode after the gate home has loaded once.

### Demo notifications (Module 7)

1. `npm run emulators`, `npm run seed:demo`, `npm run dev`. Every role except security has notifications in the bell (older ones are read).
2. Sign in as the lanka supervisor and, in another window, as driver `0771000001`: submit a pass for `CAB-1234` from `/v/<id>`. The supervisor's bell badge goes up within a second and the tab title shows `(1) ConvoyPass`. Approve it: the officers' bell lights up; approve as the officer: the driver's bell shows "Approved. Show your vehicle at the gate". Reject instead and the driver gets the reason.
3. As security, record a denied entry: officers, admin and the contractor's supervisors get "Entry denied". The bell's **See all** opens `/notifications`; `/settings` shows the per-device alert switch.
4. SLA: two seeded passes are past their target. `npm run sla:check` creates exactly one reminder each (a second run finds nothing new).
5. Push needs a real browser and project (`VITE_FIREBASE_VAPID_KEY`): the opt-in card appears after sign-in, never before a tap. iPhone and iPad outside the installed app see Add to Home Screen steps instead. Locally the seed registers fake devices, so `sla:check` prints what would have been pushed.
6. Admin: **Audit log** (`/admin/audit`) lists, filters and exports the entries; **Settings > Evidence retention** is off by default.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run bundle:report -- --budget
```

## Production bootstrap

See `docs/ops.md` (first deploy of a project, then `npm run create-tenant -- --env prod --confirm-production …`). Deploys go through a version tag; a manual
`firebase deploy` is described there as a break-glass step.
