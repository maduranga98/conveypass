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
npm run dev                      # http://localhost:5173
```

Emulators need Java 21+. Sign in as the seeded admin (you will be asked to set a new password), create a contractor, then users.

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
