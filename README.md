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
4. Push the database schema:
   ```
   npx prisma db push
   ```
5. Run the dev server:
   ```
   npm run dev
   ```
6. Visit `http://localhost:3000` — you'll land on `/signup` to create the first account.

## Deploying to Vercel

1. Import this repository into Vercel.
2. Add a Postgres database from the project's **Storage** tab (or connect an external one like Neon/Supabase) — this sets `DATABASE_URL` automatically, or you can set it yourself under **Settings → Environment Variables**.
3. Add the other environment variables:
   - `NEXTAUTH_SECRET` — same as above
   - `NEXTAUTH_URL` — your deployment URL, e.g. `https://your-app.vercel.app`
   - `SIGNUP_CODE` (optional)
4. Deploy. The build step (`prisma generate && prisma db push && next build`) creates the database tables automatically on first deploy — no separate migration step needed.

Note: `prisma db push` keeps the schema in sync on every deploy, which is
simple and fine for a personal project. If this ever grows into a
multi-developer project, switch to versioned `prisma migrate` files instead.

## How data is scoped

Every property and transaction belongs to the account that created it —
accounts can't see or edit each other's data. There's no admin/shared view;
if you want a partner to see the same properties, share one login rather
than creating a second account.

## Legacy artifact version

`rent-roll/index.html` is an earlier, single-file version of this app built
for Claude Artifacts (no login, no separate backend — data is stored by the
Artifacts platform). It's kept for reference; the Next.js app above is the
one meant for a real deployment.
