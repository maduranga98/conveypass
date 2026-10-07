# ConvoyPass operations runbook

Everything an operator needs for staging and production. Commands assume the repository root, the Firebase CLI
(`npm i -g firebase-tools` or `npx firebase-tools`) and `gcloud` signed in to the right project. Replace
`PROJECT` with the project id (`staging` / `prod` aliases are in `.firebaserc`) and `LOCATION` with the Firestore
location (`asia-south2` in `firebase.json`).

> **What is tested and what is not.** The code, rules, CI and the emulator-based drills below are tested in this
> repository. The `gcloud` and console steps (backups, restore, TTL, App Check, budgets, uptime) touch a real
> Google Cloud project and can only be proven there: each has an expected result and a sign-off box so the first
> person who runs it in staging can record that it worked.

Contents: [Environments](#environments) · [Deploy](#deploy) · [Rollback](#rollback) · [Tenants and admins](#tenants-and-admins) ·
[Backups and restore](#backups-and-restore) · [TTL policies](#ttl-policies) · [Evidence retention and Storage](#evidence-retention-and-storage-lifecycle) ·
[App Check rollout](#app-check-rollout) · [Content Security Policy](#content-security-policy) · [Warm instances and cost](#warm-instances-minimum-instances-and-cost) ·
[Push notifications](#push-notifications) · [Budget alerts and uptime](#budget-alerts-and-uptime-check) · [Incident checklist](#incident-checklist) · [GitHub setup](#github-setup)

## Environments

| Alias | Project | Used for | Deployed by |
|---|---|---|---|
| (emulators) | `demo-conveypass-*` | local work, tests, e2e | `npm run emulators` |
| `staging` | `.firebaserc` `projects.staging` | pre-production, restore drills, App Check monitoring | pushing a `v*` tag (automatic) |
| `prod` | `.firebaserc` `projects.prod` | live | the same tag, after a manual approval |

`.firebaserc` ships with `REPLACE-ME-…` placeholders: put the real project ids in before the first deploy. The scripts
refuse to run against a placeholder.

Per-environment function settings live in `functions/.env.<alias>` (the deploy writes them from GitHub environment
variables; locally copy `functions/.env.example`):

| Variable | Meaning | Staging | Production |
|---|---|---|---|
| `FUNCTIONS_REGION` | region of every callable (must equal `VITE_FUNCTIONS_REGION`) | `asia-south1` | `asia-south1` |
| `APP_BASE_URL` | public https origin (push links) | staging URL | production URL |
| `ENFORCE_APP_CHECK` | reject callables without an App Check token | `false`, then `true` | `false`, then `true` |
| `MIN_INSTANCES` | warm instances for `checkIn`, `resolveVehicle`, `submitPass` | `0` | `1` |
| `RATE_LIMIT_CALLS`, `RATE_LIMIT_WINDOW_SECONDS` | per-user limit on sensitive callables | `30` / `60` | `30` / `60` |
| `FIRESTORE_TRIGGER_REGION` | only if the deploy rejects the trigger region (see below) | – | – |

**First deploy of a new project**

1. Blaze plan (scheduled functions need Cloud Scheduler and Pub/Sub; Storage rules and functions need it too).
2. Enable APIs: Cloud Functions, Cloud Run, Cloud Build, Artifact Registry, Eventarc, Cloud Scheduler, Pub/Sub, Firebase Cloud Messaging.
3. Storage rules read Firestore (`firestore.get`): the first deploy asks to grant the cross-service role. Say yes
   (`gcloud projects add-iam-policy-binding PROJECT --member=serviceAccount:service-PROJECT_NUMBER@gcp-sa-firebasestorage.iam.gserviceaccount.com --role=roles/firebaserules.firestoreServiceAgent` if it is skipped).
4. Firestore triggers (`onPassWritten`, `onGateEventCreated`) are deployed in `FUNCTIONS_REGION` by default. If Firebase
   rejects that region because the database lives elsewhere (`asia-south2`), set `FIRESTORE_TRIGGER_REGION=asia-south2`
   in `functions/.env.<alias>`.
5. `hosting` rewrites `/csp-report` to the `cspReport` function in region `asia-south1`: change the region in `firebase.json` if you use another.
6. Create the first tenant ([below](#tenants-and-admins)), then do the console steps in this document (TTL, backups, budget, uptime, App Check).

## Deploy

**Normal release.** Merge to the main branch, then tag:

```sh
git tag v1.4.0 && git push origin v1.4.0
```

`deploy.yml` runs the same checks as CI (`ci.yml`), then deploys **staging** automatically, then waits for approval
before **production** (the GitHub environment `production` with *Required reviewers*). Within each environment the
order is fixed, so the web app never meets an older backend:

1. Firestore rules, indexes and Storage rules (`firebase deploy --only firestore:rules,firestore:indexes,storage`)
2. Functions (`--only functions`; predeploy builds `functions/`)
3. Hosting (`--only hosting`, after `npm run build` with the environment's public `VITE_*` values)

New composite indexes build in the background; a query that needs one fails until it is ready (`firebase firestore:indexes` or the console shows progress). Check before approving production.

**Manual deploy** (break glass; same order): `npm run build` then
`npx firebase deploy --only firestore:rules,firestore:indexes,storage --project prod`, then `--only functions`, then `--only hosting`.

**Verifying a release** (staging, before approving production): sign in as each role, submit a pass as a driver, watch the supervisor's bell, approve through both steps, check in at the gate, open `/admin/audit`.

## Rollback

| What | How |
|---|---|
| **Hosting** (instant) | Console > Hosting > Release history > the previous version > *Rollback*. CLI: `firebase hosting:clone PROJECT@VERSION_ID PROJECT:live --project prod` (version ids from `firebase hosting:releases:list`). Installed PWAs fetch the restored shell on their next start (the service worker updates itself). |
| **Functions** | Redeploy the previous tag: `git checkout v1.3.2 && npx firebase deploy --only functions --project prod`. For an instant switch, route traffic to the previous Cloud Run revision: `gcloud run services update-traffic FUNCTION_NAME_LOWERCASE --to-revisions=REVISION=100 --region asia-south1`. Callable names are lowercase Cloud Run services. |
| **Rules** | `git checkout v1.3.2 -- firestore.rules storage.rules && npx firebase deploy --only firestore:rules,storage --project prod` |
| **Indexes** | Indexes are only added by deploys. Leave them: unused indexes are harmless. |
| **A bad data change** | Do not edit by hand: [restore](#backups-and-restore). |

Roll **back hosting and functions together** when a release changed a callable's input or output: the web app of version N only talks to functions of version N or N+1 (callables are additive by convention).

## Tenants and admins

**Create a tenant and its first admin** (emulator, staging or production; production needs `--confirm-production`):

```sh
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/convoypass-staging-admin.json   # or: gcloud auth application-default login
npm run create-tenant -- --env staging --tenant-name "Acme Quarry" --email admin@acme.example --password '<temporary password>' [--timezone Asia/Colombo] [--tenant-id acme]
npm run create-tenant -- --env prod --confirm-production --tenant-name "Acme Quarry" --email admin@acme.example   # password from CREATE_TENANT_ADMIN_PASSWORD
```

The admin must change the password at first login. The script refuses an existing tenant id or email and placeholder projects.

**Reset an admin** (lost password, locked out): `npm run reset-admin -- --env prod --confirm-production --email admin@acme.example`
(password from `--password` or `RESET_ADMIN_PASSWORD`). It sets a temporary password, forces a change at next login, revokes sessions and writes an audit entry. It only touches users that are admins. For any other role, an admin uses *Users > Reset credential*.

## Backups and restore

Firestore holds everything that matters (passes, users, audit log, settings). Storage holds photos (see retention below).

**Enable once per project** (staging and prod):

```sh
# Daily backups kept 7 days, weekly kept 14 weeks
gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=7d --project=PROJECT
gcloud firestore backups schedules create --database='(default)' --recurrence=weekly --day-of-week=SUNDAY --retention=14w --project=PROJECT
gcloud firestore backups schedules list --database='(default)' --project=PROJECT

# Point-in-time recovery (restore to any minute of the last 7 days)
gcloud firestore databases update --database='(default)' --enable-pitr --project=PROJECT
gcloud firestore databases describe --database='(default)' --project=PROJECT | grep -i pitr   # pointInTimeRecoveryEnablement: POINT_IN_TIME_RECOVERY_ENABLED
```

- [ ] staging: schedules listed, PITR enabled (date, who)
- [ ] prod: schedules listed, PITR enabled (date, who)

**Restore drill (do this in staging at least quarterly, and once before go-live).** A restore always goes into a
*new* database; the live one is never overwritten by the drill.

```sh
# 1. Pick a backup (or use PITR in step 1b)
gcloud firestore backups list --location=LOCATION --project=PROJECT
# 1a. Restore a backup into a new database
gcloud firestore databases restore --source-backup=projects/PROJECT/locations/LOCATION/backups/BACKUP_ID \
  --destination-database=restore-drill --project=PROJECT
# 1b. ...or clone the live database as it was at a moment (PITR; the time must be within the last 7 days, whole minutes)
gcloud firestore databases clone --source-database=projects/PROJECT/databases/'(default)' \
  --snapshot-time=2026-03-10T08:00:00Z --destination-database=restore-drill --project=PROJECT

# 2. Wait until it is READY
gcloud firestore databases describe --database=restore-drill --project=PROJECT | grep -E 'state|name'

# 3. Verify: document counts per collection against the live database (the script prints a table and exits 1 on a mismatch you did not expect)
npm run verify-restore -- --env staging --database restore-drill

# 4. Spot check in the console (Firestore > database restore-drill): a recent pass, a user, an audit entry.

# 5. Clean up
gcloud firestore databases delete --database=restore-drill --project=PROJECT
```

Expected: step 3 prints every collection (`tenants`, `users`, `contractors`, `vehicles`, `drivers`, `vehiclePlates`, `passes`, `gateEvents`, `auditLog`, `notifications`) with equal counts for a backup taken moments ago, and counts that differ only by the writes since the snapshot otherwise.

- [ ] staging drill passed on (date, who, backup id, time taken)

**Rehearsal that needs no cloud project** (tested in this repository, proves the data survives an export and import and that `verify-restore` detects loss):

```sh
npm run drill:restore        # starts the emulators, seeds demo data, exports, wipes, imports, verifies
```

**A real disaster** (data deleted or corrupted in production):

1. Stop the damage: ask people to stop using the app if needed ([incident checklist](#incident-checklist)); deploy deny-all rules if data is still being corrupted.
2. Restore a backup or PITR clone into a new database (steps 1 to 3 above, name it `restore-YYYYMMDD`).
3. Move the good data back. The app reads the `(default)` database, so export from the restored database and import into the live one. Import **overwrites documents with the same id and does not delete extra ones**; for a clean slate, delete the affected collections first (after a fresh backup):
   ```sh
   gcloud firestore export gs://PROJECT-restore/export-YYYYMMDD --database=restore-YYYYMMDD --collection-ids=passes,users,... --project=PROJECT
   gcloud firestore import gs://PROJECT-restore/export-YYYYMMDD --database='(default)' --project=PROJECT
   ```
   (create the bucket first, in the same location; the Firestore service agent needs `roles/storage.admin` on it).
4. Run `npm run verify-restore` against `(default)`, then re-enable access. Re-issue notifications are not needed (they expire after 30 days anyway).
5. Write the incident up (what, when, how much data, how long).

Authentication users are **not** in Firestore backups: they are recreated from the console export (`firebase auth:export users.json --project PROJECT`, run it weekly and keep the file somewhere private) or via *Users > Create user* in the app.

## TTL policies

Notifications expire 30 days after creation (`expireAt`) and rate-limit windows expire shortly after use. Firestore deletes expired documents for free once a TTL policy exists. This is a console or `gcloud` step, not code:

```sh
gcloud firestore fields ttls update expireAt --collection-group=notifications --enable-ttl --database='(default)' --project=PROJECT
gcloud firestore fields ttls update expireAt --collection-group=rateLimits --enable-ttl --database='(default)' --project=PROJECT
gcloud firestore fields ttls list --database='(default)' --project=PROJECT   # both listed, state ACTIVE
```

Deletion happens within about 24 hours of expiry. Until the policy exists nothing is deleted, but nothing breaks: the app only reads the latest notifications.

- [ ] staging TTL active · [ ] prod TTL active

## Evidence retention and Storage lifecycle

**In the app (default off).** *Admin > Settings > Evidence retention*: keep forever (default) or remove photos after
30 to 3650 days. `purgeOldEvidence` runs daily at 02:30 Colombo time. When a tenant sets a value, it deletes the Storage
folders of passes older than the limit (200 passes per run per tenant; a backlog clears over several nights), stamps
`evidenceDeletedAt` on the pass, and writes one audit entry (`evidence.purge`) per tenant and run. Pass documents and
their history are kept, and screens show *Evidence removed per retention policy*. **Deletion is permanent and cannot be
restored from a Firestore backup** (photos are in Storage, which has no backups here). Turning it on deletes photos that
are already past the limit: the admin sees a confirmation.

**Storage lifecycle (optional safety net).** Retention is per tenant and in the app; a bucket lifecycle rule is a blunt
global backstop. If you want one (for example "nothing older than 4 years, ever"), tenants share a prefix per tenant id,
so a rule matches `tenants/` as a whole:

```json
{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 1460, "matchesPrefix": ["tenants/"] } } ] }
```
```sh
gcloud storage buckets update gs://PROJECT.appspot.com --lifecycle-file=lifecycle.json
gcloud storage buckets describe gs://PROJECT.appspot.com --format='default(lifecycle_config)'
```
Do not enable object versioning on the evidence bucket (deleted photos would linger). Driver photos live under the same prefix (`.../drivers/<uid>.jpg`) and are covered by the same rule: set the age longer than any retention you promise.

## App Check rollout

App Check (reCAPTCHA Enterprise) proves a request comes from the real web app. It is rolled out in four steps; **never
skip to enforcement**, because every installed phone must first be running a version that sends tokens.

1. **Create the key.** Google Cloud > reCAPTCHA Enterprise > *Create key* (Web, your domains incl. `localhost` for debug only if you want it). Firebase console > App Check > Apps > your web app > *reCAPTCHA Enterprise* > paste the key id.
2. **Ship the web app with the site key** (`VITE_APP_CHECK_SITE_KEY` as a GitHub environment variable), deploy. Do **not** set `ENFORCE_APP_CHECK` yet (leave `false`). The app now attaches tokens; nothing is rejected.
3. **Monitor.** Firebase console > App Check > each product (Firestore, Storage, Cloud Functions) shows verified vs unverified requests. Wait at least a week and until unverified traffic is only expected sources (scripts, old cached app versions). Roll a release so old service-worker caches update.
4. **Enforce, one product at a time, staging first.**
   - Functions: set `ENFORCE_APP_CHECK=true` (GitHub environment variable → `functions/.env.<alias>`) and redeploy functions. Callables then reject requests without a valid token (`unauthenticated`). Check: `curl -s -X POST https://asia-south1-PROJECT.cloudfunctions.net/getDashboardTrend -H 'Content-Type: application/json' -d '{"data":{"days":7}}'` is rejected, while the app keeps working.
   - Firestore and Storage: console > App Check > *Enforce*. Immediate; reversible with *Unenforce*.

**Rollback** (any step): Firestore/Storage: *Unenforce* in the console (immediate). Functions: set `ENFORCE_APP_CHECK=false`, redeploy `--only functions`. Unenforcing never loses data.

**Debug tokens** (local development and CI): the emulators skip App Check. To run a real build against a real project from a laptop or a CI job, set `VITE_APP_CHECK_DEBUG_TOKEN=true`, open the app, copy the token printed in the browser console, and register it in console > App Check > Apps > *Manage debug tokens*. Then set `VITE_APP_CHECK_DEBUG_TOKEN=<that token>` (a secret in CI). The debug token is ignored in production builds. Revoke tokens you no longer use.

## Content Security Policy

`firebase.json` sends `Content-Security-Policy-Report-Only` (nothing is blocked). Browsers POST violations to `/csp-report`
(the `cspReport` function), which logs one line per violation: directive, blocked host and path, page path. View them in
Cloud Logging: `resource.type="cloud_run_revision" jsonPayload.fn="cspReport"`.

**Promote to enforcing** only after a full run in staging (every role, camera capture, photo upload, QR scan, sign-in, push opt-in) shows no violations for a few days:

```sh
npm run config:csp      # regenerates firebase.enforce-csp.json from firebase.json (one header renamed)
npx firebase deploy --only hosting --project staging --config firebase.enforce-csp.json
```

To make it permanent, rename the header in `firebase.json` (`Content-Security-Policy-Report-Only` → `Content-Security-Policy`) and delete `firebase.enforce-csp.json`. To go back, deploy with the default `firebase.json`. If a legitimate request is blocked, add its host to the right directive in `firebase.json`, run `npm run config:csp`, and redeploy.

The policy allows only the app's own origin, Firebase/Google APIs (Auth, Firestore, Storage, Functions, FCM, App Check), reCAPTCHA, `data:`/`blob:` images and camera canvases, and same-origin plus `blob:` workers. There are no Google Fonts, no inline scripts and no CDN code (image compression runs on the main thread for that reason).

## Warm instances (minimum instances) and cost

`checkIn`, `resolveVehicle` and `submitPass` are what people wait for at a gate or on a phone, so production keeps one instance warm
(`MIN_INSTANCES=1`); staging runs `0`. A warm instance is billed while idle (a reduced CPU rate plus memory, around the clock). At the default
256 MiB size that is roughly **USD 3 to 10 per function per month** depending on region pricing: three functions, about USD 10 to 30 a month.
Confirm in the [pricing calculator](https://cloud.google.com/products/calculator) for your region; set `MIN_INSTANCES=0` to remove the cost (cold starts then add
roughly 1 to 3 seconds to the first request after quiet periods). Change it in `functions/.env.prod` (or the GitHub environment variable) and redeploy functions.

## Push notifications

- Web push needs the VAPID key pair: Firebase console > Project settings > Cloud Messaging > Web Push certificates > *Generate key pair*; the public key is `VITE_FIREBASE_VAPID_KEY`.
- Notifications are created by Firestore triggers; pushes are data-only and drawn by the service worker. Approval pushes are collapsed per person (tag `pending-<role>-<contractor|tenant>`).
- **SLA reminders** run every 10 minutes (`slaReminders`) and need Cloud Scheduler. Locally they only run when you trigger them: `npm run sla:check`.
- Dead tokens are deleted automatically when FCM reports them unregistered or invalid. A failing push never fails a business call.
- iOS: web push works only for an installed web app (Add to Home Screen, iOS 16.4+). The app says so on iPhones and iPads.
- Logs: `jsonPayload.fn="onPassWritten"` (counts created, duplicates, pushed per event).

## Budget alerts and uptime check

**Budget** (Billing > Budgets & alerts, or):

```sh
gcloud billing budgets create --billing-account=BILLING_ACCOUNT_ID --display-name="ConvoyPass monthly" \
  --budget-amount=100USD --filter-projects=projects/PROJECT_NUMBER \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```
Add an email recipient (the project owner and a second person). Pick the amount from the first two months of real spend. A budget alerts, it does not stop spending.

**Uptime check** on the app URL (Cloud Monitoring > Uptime checks > *Create*): HTTPS, host = your domain, path `/`, every 5 minutes, from at least three regions, alert policy to email or chat after 2 failed checks. CLI (verify flags with `gcloud monitoring uptime create --help`):

```sh
gcloud monitoring uptime create convoypass-prod --resource-type=uptime-url \
  --resource-labels=host=app.example.com,project_id=PROJECT --protocol=https --path=/ --period=5 --project=PROJECT
```
The check proves hosting is up. For the backend, also alert on the log-based metric `severity=ERROR jsonPayload.outcome="error"` (every function logs `fn`, `outcome`, `uid`, `tenantId`).

- [ ] budget created · [ ] uptime check and alert policy created

## Incident checklist

1. **Decide the blast radius** and write the time down. Check the uptime check, Cloud Logging (`severity>=ERROR`), and the status of Firebase/Google Cloud.
2. **A contractor is involved** (stolen phones, ended contract): *Admin > Contractors > Suspend*. This revokes the sessions of every user of that contractor and blocks their callables immediately. Reactivate later with *Activate*.
3. **One person** (lost phone, leaver, suspected misuse): *Admin > Users > Disable*. It revokes their sessions. To end sessions without disabling (a password was shared): *Users > Reset credential* (also revokes).
4. **Revoke a token by hand** (when the app is not available): `node -e "require('firebase-admin').initializeApp({projectId:'PROJECT'});require('firebase-admin').auth().revokeRefreshTokens('UID').then(()=>console.log('revoked'))"` with `GOOGLE_APPLICATION_CREDENTIALS` set. Note that an ID token already issued stays valid for up to an hour on Firestore reads; function calls re-check the account on every call.
5. **Bots or abuse**: confirm App Check enforcement ([rollout](#app-check-rollout)); the per-user rate limit already returns `resource-exhausted`. Look at `jsonPayload.outcome="rate-limited"`.
6. **Bad deploy**: [rollback](#rollback).
7. **Data damage**: [restore](#backups-and-restore).
8. **Hard stop**: deploy deny-all rules (`rules_version='2'; service cloud.firestore { match /databases/{d}/documents { match /{x=**} { allow read, write: if false; } } }`) with `firebase deploy --only firestore:rules`, then restore the previous rules from git.
9. **After**: audit log (`/admin/audit`) for who did what, a short written timeline, and one improvement.

## GitHub setup

Repository **Settings > Environments**: create `staging` and `production`. On `production` add **Required reviewers** (the manual approval) and optionally a wait timer and a branch/tag rule (`v*`).
Per environment add:

| Kind | Name | Notes |
|---|---|---|
| Secret | `FIREBASE_SERVICE_ACCOUNT` | JSON key of a deployment service account for that project |
| Variables | `FUNCTIONS_REGION`, `APP_BASE_URL`, `ENFORCE_APP_CHECK`, `MIN_INSTANCES` | see [Environments](#environments) |
| Variables | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_VAPID_KEY`, `VITE_APP_CHECK_SITE_KEY` | public web config, not secrets |

**Deployment service account**: create one per project with the roles *Firebase Admin* is too broad; use *Cloud Functions Admin*, *Firebase Rules Admin*, *Firebase Hosting Admin*, *Cloud Datastore Index Admin* (`roles/datastore.indexAdmin`), *Service Account User*, *Artifact Registry Writer*, *Cloud Build Editor*, *Cloud Scheduler Admin*, *Eventarc Admin*, *Storage Admin* on the project as needed by your first deploy errors.

> **Workload identity federation is preferable to a stored key.** A JSON key is a long-lived secret that can leak and must be rotated by hand.
> With [Workload Identity Federation](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account),
> GitHub Actions exchange their short-lived OIDC token for Google credentials and no key is stored. To switch: create a pool and provider for the repository,
> grant it the roles above, give the workflow `permissions: id-token: write`, and replace `credentials_json` in `.github/actions/deploy/action.yml` with
> `workload_identity_provider` and `service_account`. Until then keep the key in an environment secret, rotate it every 90 days, and delete it when you migrate.
