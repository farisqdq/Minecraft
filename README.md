# Rent Roll

A profit tracker for rental properties: log rent payments and repair/expense
costs per property, and see rent collected, expenses paid, and net profit at
a glance. Ships with email/password login, so each account only sees its own
data — safe to deploy publicly on Vercel.

## Stack

- **Next.js** (App Router) — pages and API routes
- **NextAuth (Auth.js) v4** — email/password authentication, session cookies
- **Prisma + PostgreSQL** — users, properties, and transactions

## Local setup

1. Install dependencies:
   ```
   npm install
   ```
2. Get a Postgres database. Any of these give you a connection string:
   - [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) (easiest if you're deploying to Vercel — it's a one-click add-on in your project's Storage tab)
   - [Neon](https://neon.tech) or [Supabase](https://supabase.com) (both have free tiers)
   - A local Postgres install
3. Copy `.env.example` to `.env` and fill in:
   - `DATABASE_URL` — your Postgres connection string
   - `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
   - `NEXTAUTH_URL` — leave as `http://localhost:3000` for local dev
   - `SIGNUP_CODE` (optional) — set this to require an invite code for new accounts, so random visitors to your deployed URL can't sign themselves up. Leave unset for open signup.
4. Create the database tables:
   ```
   npx prisma migrate deploy
   ```
5. Run the dev server:
   ```
   npm run dev
   ```
6. Visit `http://localhost:3000` — you'll land on `/signup` to create the first account.

## Deploying to Vercel

1. Import this repository into Vercel.
2. Add a Postgres database from the project's **Storage** tab (or connect an external one like Neon/Supabase) — this sets `DATABASE_URL` automatically, or you can set it yourself under **Settings → Environment Variables**.
3. Add **Blob** from the same Storage tab if you want proof photos and receipts
   (see below) — this sets `BLOB_READ_WRITE_TOKEN` automatically.
4. Add the other environment variables:
   - `NEXTAUTH_SECRET` — same as above
   - `NEXTAUTH_URL` — your deployment URL, e.g. `https://your-app.vercel.app`
   - `SIGNUP_CODE` (optional)

   Leave a variable out entirely rather than saving it blank — an empty value
   is not the same as unset and can break the build.
5. Deploy. The build runs migrations (`prisma migrate deploy`) before building,
   so the tables are created or updated automatically without destroying data.

## LLCs and teams

Properties belong to the **LLC** that owns them, not directly to a person.
Each LLC has its own team, so a partner in one LLC sees only that LLC's
houses, ledger, and profit — nothing from your other LLCs.

- The dashboard has a chip for each LLC you're on, plus an **All LLCs** view
  with a per-LLC profit rollup.
- **Owners** can delete the LLC, create join codes, and change teammates'
  roles. **Members** can record rent and expenses but can't manage the team.
- Joining works by **code**: an owner creates one on the Team page (e.g.
  `K7P2-M9X4`) and sends it however they like. The other person signs in,
  enters it under "Join with a code" on the dashboard, and lands on that LLC.
  Each code works once and expires after 7 days.
- A valid join code also satisfies `SIGNUP_CODE`, so gating public signups
  doesn't lock out someone you just handed a code to.
- The last owner can't leave an LLC (that would strand it with nobody able to
  manage it) — either make someone else an owner first, or delete the LLC.

## Deleting an LLC

On the Team page, an owner can delete an LLC. This also deletes its
properties and every ledger entry under it, for everyone on the team, so the
confirmation asks you to type the LLC's name and tells you exactly how much
history would go. Download a backup first if you might want those records.

## Backups

The **Backup** page downloads a single JSON file with every LLC, property,
and ledger entry you can see, and restores one back into the app.

Restoring only ever **adds**. Each LLC in the file comes back as a new LLC you
own; if the name is already taken, the restored copy is renamed (e.g.
`Birchwood Holdings LLC (imported)`) so you can compare the two before
removing either. Nothing is ever overwritten or deleted by an import.

## Your data and app updates

Schema changes ship as versioned migration files in `prisma/migrations`, and
deploys run `prisma migrate deploy` — which only applies those files and never
drops data to force the schema into shape. (An earlier version used
`prisma db push --accept-data-loss`, which could silently destroy records on a
schema change; that's gone.)

`prisma/baseline.js` runs first and handles one specific case: a database
created before migrations existed has no migration history, so it marks the
initial migration as already applied and lets later ones run normally on top.
It no-ops once history exists.

When changing the schema, generate a migration rather than pushing:

```
npx prisma migrate dev --name describe_the_change
```

## Legacy artifact version

`rent-roll/index.html` is an earlier, single-file version of this app built
for Claude Artifacts (no login, no separate backend — data is stored by the
Artifacts platform). It's kept for reference; the Next.js app above is the
one meant for a real deployment.

## Proof photos and receipts

Every rent payment and repair can carry proof — a photo of a check or Venmo
screenshot, a contractor's invoice, a receipt PDF. Attach files when recording
the entry, or add them to any existing row later with "+ Attach proof".
Thumbnails appear in the ledger and open the full file in a new tab.

Photos are shrunk in the browser before upload (long edge 1600px, JPEG), so a
phone photo uploads quickly and stays well under the 4 MB per-file limit. PDFs
upload as-is.

This needs **Vercel Blob** storage:

1. In Vercel, open the project's **Storage** tab.
2. Add **Blob**, connect it to this project, and redeploy.

That sets `BLOB_READ_WRITE_TOKEN` automatically. Until it's connected, the app
works normally and uploads fail with a message saying to set this up —
transactions still save either way.

Backups include links to the proof files rather than the files themselves. The
files live in blob storage, so a restored backup re-links to the same images as
long as that storage still exists.

## Viewing by month

The dashboard opens on the current month: the totals, the per-property figures,
and the ledger all cover that month, and the arrows page back through earlier
months (as far back as your first entry). **All time** switches to lifetime
totals. The rent bar always tracks whichever month you're viewing.
