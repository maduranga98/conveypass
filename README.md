# ConvoyPass

Multi-tenant PWA for approving gate passes for third-party contractor vehicles. See `CLAUDE.md` for conventions.

## Local setup

```bash
npm install                      # also installs functions/ deps
cp .env.example .env.local       # fill VITE_FIREBASE_*; set VITE_USE_EMULATORS=true for local work
cp functions/.env.example functions/.env
npm --prefix functions run build
npm run emulators                # auth 9099, firestore 8080, functions 5001, storage 9199, UI 4000
npm run seed:emulator -- --email admin@example.com --password 'ChangeMe123' --tenant-name "Acme"
# or, for a populated demo tenant (admin, officer, 2 supervisors, 4 drivers, 9 vehicles, passes in every state with
# photos; prints the logins and what to try):
npm run seed:demo
npm run dev                      # http://localhost:5173
```

Set `VITE_APP_BASE_URL` in `.env.local` (e.g. `http://localhost:5173`): vehicle QR codes encode `${VITE_APP_BASE_URL}/v/<vehicleId>`. A localhost value shows a red "Dev link: do not print" banner on QR screens; use the production URL (and optionally `VITE_PRODUCTION_HOST`) before printing real labels.

Emulators need Java 21+. `seed:demo` also needs `VITE_FIREBASE_STORAGE_BUCKET` in `.env`/`.env.local` (or `FIREBASE_STORAGE_BUCKET`) to match the bucket the app uses, and `FIREBASE_PROJECT_ID` when the emulators run under a `demo-` project.

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

## Checks

```bash
npm run typecheck && npm run lint && npm run build && npm test
```

## Production bootstrap

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
  npm run seed:prod -- --confirm-production --email you@company.com --password '…' --tenant-name "Company"
```

Deploy: `firebase deploy --only firestore,functions,hosting,storage`.
