# Rent Roll — Phone Backup project handoff

Handoff for continuing the phone-backup work in a new chat. Read this top to bottom.

## What this is

A phone-backup system added to Faris's existing **Rent Roll** web app (eqal.rentals):
1. An **Android app** (the Rent Roll site wrapped in a WebView + a native "Phone Backup" screen) that backs up company phones.
2. A **Go backup server** running on Faris's **Contabo VPS** (Windows) that receives and stores the backups.
3. **Admin-only pages** inside Rent Roll to manage phones, view backups, and send restore links.

Backups do NOT go through Vercel storage — they go straight to the VPS to avoid storage costs.

## Repo / hosting

- **GitHub:** `farisqdq/minecraft` (public), working branch **`claude/rental-profit-tracker-p2d5xy`** — this branch auto-deploys to production.
- **Website:** Next.js on Vercel, project **"minecraft"**, team `team_ad4wJqvaRlCSlTEWdBeoWWag` (scope `farisqdqs-projects`). Serves **www.eqal.rentals** (apex eqal.rentals 307-redirects to www). DNS is on Vercel.
- **Admin account:** `fariseqal3@gmail.com` is the built-in site admin (lib/admin.ts). All phone pages 404 for non-admins.
- **All phone-backup code lives under `phone-backup/`** in the repo. `.vercelignore` excludes `phone-backup/` from the Vercel build.

## The VPS backup server

- **URL:** https://backup.eqal.rentals  (A record → **207.180.211.137**, the Contabo VPS; added in Vercel DNS).
- **Shared secret** (server password; also in Vercel env `PHONE_BACKUP_SECRET`):
  `bb496b49cc3a7b82e7449d4952eb4aa4de671f99ba8a597ef248d95be035fc15`
  Keep this private. Admin API auth is `Authorization: Bearer <secret>`.
- **Source:** `phone-backup/server/main.go` (Go, single Windows exe, serves its own HTTPS via Let's Encrypt/autocert). Data stored in `C:\PhoneBackups\devices\<deviceId>\{Photos,Files,Contacts,Calls,Texts,Apps}`.
- **Build the exe:** `cd phone-backup/server && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ../dist/rentroll-backup.exe .`
- **Deploy/update:** Faris (or a chat with VPS access) runs this in an **Administrator PowerShell on the VPS**:
  ```
  [Net.ServicePointManager]::SecurityProtocol='Tls12'; iwr 'https://raw.githubusercontent.com/farisqdq/minecraft/claude/rental-profit-tracker-p2d5xy/phone-backup/dist/install-backup-server.ps1' -OutFile "$env:TEMP\rr-install.ps1" -UseBasicParsing; powershell -ExecutionPolicy Bypass -File "$env:TEMP\rr-install.ps1" -Secret 'bb496b49cc3a7b82e7449d4952eb4aa4de671f99ba8a597ef248d95be035fc15'
  ```
  It downloads the newest exe from GitHub, writes config, and restarts the scheduled task. ~30s downtime during restart (that's the "failed to connect" blip).
- **Check it live:** `curl https://backup.eqal.rentals/health` → `{"ok":true}`.
  Summary: `curl https://backup.eqal.rentals/api/admin/summary -H "Authorization: Bearer <secret>"`.
- **Server API:** device side (`/api/pair`, `/api/device/{check,upload,report,location,me}`), admin side (`/api/admin/summary`, `/api/admin/devices` [POST add], `/devices/{id}/{code,request,command}`, PATCH rename, DELETE, `/list`), signed `/dl` downloads. Resumable chunked uploads; `/check` matches by path+size so duplicates aren't re-uploaded and deleted-from-phone files are kept. Snapshot folders (Contacts/Calls/Texts/Apps) keep newest 30 *top-level* files; subfolders (e.g. Texts/media) are NOT pruned.

### IMPORTANT: server redeploy pending
The running VPS server has the **version-capture** build (shows app version). The newest exe in `phone-backup/dist/rentroll-backup.exe` ALSO adds: remote-command endpoints (`/command`, lock/wipe/locate — dormant until v1.6 UI), `/device/location`, and the snapshot-prune fix for message attachments. **Faris needs to re-run the install command once more** to pick these up. Until then `/api/admin/devices/{id}/command` returns plain 404.

## The Android app

- **Source:** `phone-backup/android/` (Kotlin, Gradle). Package `rentals.eqal.rentroll`.
- **Current version: v1.5.0 (versionCode 6)** — built, pushed, sent to Faris. `phone-backup/dist/rentroll.apk`.
- **Build:** `cd phone-backup/android && ANDROID_HOME=/opt/android GRADLE_USER_HOME=/opt/gradle-home gradle --no-daemon -g /opt/gradle-home :app:assembleRelease` → `app/build/outputs/apk/release/app-release.apk`. (Android SDK installed at /opt/android; Google Maven mirror used in settings.gradle.kts to dodge Maven 429s.)
- **Signing key:** `/home/claude/keys/rentroll-release.jks`, props in `phone-backup/android/keystore.properties`. **This key lives only in this cloud container — if the session is lost, the key is gone and updates can no longer install over installed copies.** PRIORITY: get this key onto Faris's own storage (have him connect a folder, or commit it somewhere private — NOT the public repo). Without it, a new key = users must uninstall/reinstall.
- **Auto-update:** on app launch, `Updater.kt` fetches `phone-backup/dist/latest.json` from GitHub raw, compares versionCode, downloads the APK, and prompts install. Works from v1.1+. To publish an update: build, copy APK to `phone-backup/dist/rentroll.apk`, bump versionCode+versionName in `app/build.gradle.kts`, update `latest.json`, push. Auto-update needs the phone to have "install unknown apps" allowed (usually after one manual install).
- **What it backs up (all automatic, no toggles as of v1.2):** photos, videos, documents (Download/Documents/WhatsApp/etc. via All-files access), contacts (.vcf), call log + texts (SMS Backup & Restore XML format), installed-app list (HTML). One app icon (Rent Roll); Backup opens from the site's **Settings → Phone backup** (deep link `rentroll://backup`). Notification is generic ("Rent Roll · Backup in progress").

### Key files (android)
- `MainActivity.kt` — WebView of eqal.rentals; sets UA `RentRollApp/<ver>`; runs Updater; handles `rentroll://backup`.
- `BackupActivity.kt` — native Phone Backup screen (WebView of `assets/backup.html` + JS bridge). Pairing, permissions (one "Allow" button → `fixEverything`), All-files access.
- `BackupWorker.kt` — the backup run (WorkManager, 12h periodic + one-off). As of v1.5: **no network/charging constraints** (always runs on any connection). Resumable chunked upload, snapshots, ETA in progress string.
- `HeartbeatWorker.kt` — 15-min check-in; picks up site-triggered "Back up now" and remote commands.
- `Scanner.kt` / `Exporters.kt` — gather media/documents / contacts-calls-texts-apps.
- `RemoteCommands.kt` + `AdminReceiver.kt` + `res/xml/device_admin.xml` — **lock/wipe/locate plumbing, written but DORMANT** (no Device Admin activation UI yet, no location prompt). Finish in v1.6.
- `Api.kt` — talks to the server; sends `User-Agent: RentRollAndroid/<ver>` (how the server reads the app version).

## Website (admin-only) features — all live

- **/dashboard/phones** (`app/dashboard/phones/`) — add phone (setup code), status, **Back up now** (site-triggered via server command + heartbeat), **View backup** (opens the viewer), **Browse files**, **Send restore link** (Copy + Send via share sheet/email), rename, remove, shows app version. Nav entry added to all 4 layouts + Settings page.
- **/dashboard/gallery** (`app/dashboard/gallery/`) — pick a phone, grid of photos/videos (`BackupBrowser.tsx`).
- **PhoneDataViewer.tsx** — the "View backup" modal: tabs Photos&videos (flat gallery w/ lightbox), Texts (chat bubbles), Calls, Contacts, Apps. Parsers: `lib/sms-parse.ts`, `lib/calls-parse.ts`, `lib/contacts-parse.ts`, `lib/apps-parse.ts`.
- **Restore (public, token-gated):** `app/restore/` + `app/api/restore/*`. Admin makes a signed 7-day link; the holder downloads that one phone's backup, no login.
- **lib/phone-backup.ts** — server-side client to the VPS (adds secret, signs `/dl` links, restore tokens). **Env vars** `PHONE_BACKUP_URL=https://backup.eqal.rentals` and `PHONE_BACKUP_SECRET=<secret>` are set in Vercel (Production, both).
- **lib/csp.ts** — CSP; `img-src`/`media-src` allow `https://backup.eqal.rentals` so backup photos/videos load. (Don't remove that or photos go black.)

## Current state / known issues

- **Tara's phone** (Galaxy S24 Ultra, `SM-S928U`) is paired, **~1.1 GB / 316 files backed up**, but was **stuck on app v1.4.0**. v1.4 had a bug: Wi-Fi-only defaulted ON, so on mobile data the backup sat at "Starting…" forever. **v1.5 fixes this** (removed all network/charging constraints) — Faris needs to install v1.5 (auto-update wasn't firing; manual install of the sent APK is the fix). Confirm success when the server shows appVersion 1.5.0 and files start growing.
- **"Features broke after update" (gallery/phones buttons/scanner):** server + all pages verified healthy (200/307, DB up, CSP correct). Diagnosed as **stale cached JS** from many rapid redeploys. Fix = hard refresh (Ctrl/Cmd+Shift+R) on desktop, or clear the Rent Roll app cache. Confirm with Faris whether a hard refresh fixed it; if not, pull Vercel deploy logs.

## Pending work (next up)

1. **Confirm v1.5 installed** and backups flowing (server appVersion → 1.5.0, file count grows).
2. **Re-run the VPS install** to deploy the newest server exe (command/location/prune-fix).
3. **MMS backup (v1.6)** — capture picture/group messages (SMS.Mms provider) + save attachments to `Texts/media/`, show them in the Texts thread. NOTE: **RCS messages and reactions ("likes") CANNOT be captured** — they're in Google Messages' private store, no API. Only SMS/MMS are accessible. Told Faris this.
4. **Lock / Locate / Wipe (v1.6)** — server + app plumbing done (dormant). Still need: Device Admin activation UI in backup.html, location permission prompt, and Locate/Lock/Wipe buttons + last-location display on the Phones page. Wipe = `DevicePolicyManager.wipeData`. Caveat told to Faris: acts on next check-in (~15 min, not instant); recommend Google Find My Device for immediate theft response.
5. **Get the signing key off this container** onto Faris's storage (critical — see above).
6. Consider turning off aggressive WebView caching / adding cache-busting so rapid deploys don't look like breakage.

## Faris's working style (from this session)
- Moves fast, fires many small requests, wants quick ETAs and fast turnarounds. Prefers honest "this isn't possible / here's the limitation" over false promises. Reassure with concrete live data (server checks) when he thinks something broke. Samsung phones: tell him to set Rent Roll Battery = Unrestricted so background backups survive.
