# Rent Roll

A profit tracker for rental properties: log rent payments and repair/expense
costs per property, and see rent collected, expenses paid, and net profit at
a glance. Tenants get their own login to report a problem and watch it get
fixed. Ships with email/password login, so each account only sees its own
data — safe to deploy publicly on Vercel.

## Stack

- **Next.js** (App Router) — pages and API routes
- **NextAuth (Auth.js) v4** — email/password authentication, session cookies
- **Prisma + PostgreSQL** — users, properties, tenants, repairs, transactions
- **Vercel Blob** (optional) — proof photos and receipts

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

Run the tests with:

```
npm test
```

They cover the parts where a quiet mistake costs money: how late rent is
counted, what a place rented for in a given month, how amounts are rounded,
and how the tax CSV is escaped. No test framework is installed — they run on
Node's own test runner in about a second.

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
- **Owners** can delete the LLC, remove properties and units, create join
  codes, and change teammates' roles. **Members** can record and correct rent
  and expenses, add tenants, and edit property details — but can't delete a
  property, a unit, or the LLC, and can't manage the team. Deleting a property
  takes its whole ledger with it, which isn't a member's call to make.
- Joining works by **code**: an owner creates one on the Team page (e.g.
  `K7P2-M9X4`) and sends it however they like. The other person signs in,
  enters it under "Join with a code" on the dashboard, and lands on that LLC.
  Each code works once and expires after 7 days.
- A valid join code also satisfies `SIGNUP_CODE`, so gating public signups
  doesn't lock out someone you just handed a code to.
- The last owner can't leave an LLC (that would strand it with nobody able to
  manage it) — either make someone else an owner first, or delete the LLC.

## Tenants and leases

Each property — or each unit, in a building that has them — can have a
tenant on file: name, phone, email, lease start and end, security deposit,
and the day of the month their rent is due.

That due day is what makes the dashboard able to say **"17 days late"**
rather than just "unpaid", and the phone number puts **Call** and **Text**
next to the amount owed, which is the whole point of storing it. A lease
ending within 60 days — or one that has already run out — shows up in
"Needs attention" alongside the unpaid rent, because a lease nobody noticed
expiring is a vacancy waiting to happen.

Someone who moves out is kept as a **past tenant** rather than deleted, so
their history and their old ledger entries still make sense and the next
tenant is a new record rather than an overwrite.

## The tenant portal

A tenant can be given a login of their own at `/portal`. From their card on a
property page, **Invite to the portal** issues a code (`HKTM-9R4P`) that you
send them however you already talk to them. They redeem it at
`/portal/signup`, pick a password, and they're in.

A code names **one tenant**, is single use, expires in 14 days, and is retired
the moment you issue a replacement. There is no form anywhere that lets
someone choose which unit they live in — the code decides, which is why
self-signup isn't possible.

Signed in, a tenant sees their own place, their lease, their deposit, and
nothing else. Not your other properties, not your ledger, not your contact
details. **Remove** takes the login away without touching their lease,
deposit or ledger history; **Forgot password** kills the old login and hands
you a fresh code, and everything they ever reported is still there when they
sign back in.

### Sign-in throttling

Ten wrong passwords for one account inside fifteen minutes pauses that
account for fifteen minutes; forty wrong passwords from one address inside
fifteen minutes, across any accounts, pauses the address. A right password
clears the account's count. Both signup forms count a bad code against the
address the same way, so a short code can't be walked through.

The pause is enforced inside `authorize()`, where it can't be skipped. The
login page separately asks `/api/auth/lock-status` whether a refusal was a
pause, so someone typing their *right* password sees "Try again in 12
minutes" rather than being told it's wrong. A miss on an email that has no
account is counted too, so the counts can't be used to learn which emails
exist.

Pausing by account is a deliberate trade: someone who knows your email can
pause your sign-in on purpose. The pause is short for exactly that reason,
and the door stays shut to guessing meanwhile, which is the outcome that
matters. A stuck tenant can be handed a fresh code from their card.

### Why tenants are a separate table

`User` is the landlord side: a `User` belongs to companies, and every query in
the app reaches data by walking user → company → property. A tenant must never
touch that walk, so they get `TenantAccount`, their own credentials provider,
and an explicit `kind` on the session token. `getCurrentUserId()` fails
closed — anything that isn't literally `kind: "user"` comes back null — and
`proxy.ts` blocks each side from the other's routes before a request reaches
any handler.

A role column on a shared `User` table would put the two one missed `if`
apart. This way there is no check to miss, because the landlord queries never
join to the tenant table at all.

## Repairs

A tenant reports what's wrong, where it is, how urgent, and up to six photos.
Categories cover storefronts as well as houses — parking lot, signage, common
area — because a laundromat's problems aren't a duplex's.

Each status reads differently on the two sides of the same row. The tenant
sees "Your landlord has seen this"; you see "Seen". Replies and status changes
land in **one timeline** rather than a conversation beside a history, because
the tenant is asking one question: is anyone doing anything.

The **Repairs** tab carries a count of what's waiting, on every page. Open
repairs also head up "Needs attention" on the Overview, above unpaid rent — a
tenant with no hot water outranks a late cheque — and each property page lists
its own.

**Log what it cost** books a finished repair into the ledger against the right
property and unit, marks it done, and records the transaction id so the same
repair can't be booked twice. Your tenant sees that it was fixed and never
what it cost.

A tenant replying to a closed report reopens it, because the alternative is a
reply nobody is looking at.

Urgency is two buttons, not a dropdown: how hard it is to claim urgency
decides whether the word keeps any meaning. A line that stays on screen
whether or not the form is open says **fire, a gas smell, or anyone in
danger — call 911**, and the form itself says to call the LLC's line rather
than type for no heat, no water or a lock that won't open. A web form is not
an emergency line and shouldn't pretend to be.

## Rent changes

Rent goes up. The app records what a place rented for **and from when**, so
raising the rent doesn't re-judge months already on the books.

Without that, putting the rent up from $1,450 to $1,550 would make every
month a tenant had paid $1,450 read as $100 short — and the bulk "Mark all
paid" would have offered to collect the difference. Instead, each month is
measured against whatever the rent was *that* month.

Nothing is asked of you: edit the rent as usual and the change is recorded
from the current month. The property page shows the trail beside the rent
("since Sep 2026 · $1,450 at first") so you can see what the app is using.

## Recording, correcting, and clearing a month

- **Mark paid** on a late row logs the full outstanding amount in one tap,
  dated in the month on screen, with the tenant's name on the entry. **Part
  paid** opens the form instead, prefilled.
- **Mark all N paid** and **Log all N bills** clear the whole month at once.
  Both confirm first and name every line, since they write real money into
  the books, and both post one entry per tenant or bill so any single one can
  still be corrected.
- **Edit** on a ledger row corrects an entry in place. Deleting and re-adding
  would throw away the receipt attached to it, which is the one thing worth
  keeping.

## Viewing by month, year, or all time

The dashboard opens on the current month: the totals, the charts, the
per-property figures, and the ledger all cover that period, and the arrows
page back through earlier ones. The switcher next to them changes the unit:

- **Month** — one month at a time, as far back as your first entry.
- **Year** — a whole tax year, with the change shown against the year before.
- **All** — lifetime totals.

Whatever the period, "Needs attention" and the rent-roll meter always describe
one month, because chasing rent is a monthly job.

**Searching.** The ledger's search box deliberately looks across *every*
month, not the period on screen — being told there's nothing in September
when the invoice was in March is the opposite of useful. It matches the
property, description, note, category, date and amount, and shows what the
matches total. Long ledgers render 60 rows at a time with a "Show more".

## Units, categories, recurring expenses, exports

**Units.** A property can be split into units on its own page — a
duplex, triplex, or any building with more than one tenant. Each unit gets
its own rent target and its own progress bar. Leave a property with no units
and it's tracked as a single house, exactly as before.

**Expense categories.** Every expense now picks a category (Repairs,
Insurance, Property Tax, Mortgage Interest, HOA, Utilities, Management Fees,
Supplies, Legal & Professional, Other) — the same buckets a Schedule E uses.

**Who hasn't paid.** The dashboard lists any property or unit that's short
on rent for the month you're viewing, with how much is owed. Mark a
property or unit **vacant** (on its edit form) to leave it out of that list
and hide its rent bar.

**Recurring expenses.** Set up a mortgage, insurance, or HOA payment once on
a property's page — amount, category, and a monthly or yearly
schedule. Nothing posts itself: when one is due, it shows up on the
dashboard for that month with a one-click **Log it** button that creates
the transaction and marks it done for that period.

**Tax-year export.** The **Export** page downloads a CSV for one LLC and
one year — every transaction, a summary totalling rental income and each
expense category, and, when the LLC owns more than one house, the same
breakdown per property. Schedule E is filled in per property, so that last
block is the one an accountant actually wants.

Text going into the CSV is escaped so a note can't become a live formula in
whoever's spreadsheet opens it. Amounts are left alone, so the columns still
add up.

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

## Installing it on a phone

Most of the logging happens standing in a doorway, so the app ships a web
manifest and icons: **Add to Home Screen** gives it a real icon and opens it
without browser chrome. The layout is built for a phone first — a bottom tab
bar in thumb reach, the record form as a sheet that rises from the bottom,
and the ledger as a card per entry rather than a table you scroll sideways.

Dark mode follows the system setting.

## Backups

The **Backup** page downloads a single JSON file with every LLC, property,
unit, tenant, recurring expense, rent change, repair report and ledger entry
you can see, and restores one back into the app. Proof files and repair
photos are referenced by link rather than copied into the file.

Repairs carry their reporter as a **name** rather than an id, because ids from
the old database mean nothing in a fresh one — on restore each repair is
re-linked to the tenant that came back alongside it.

Tenants' portal logins are deliberately **not** in the file. It lands in your
downloads and gets emailed around, and password hashes have no business in
it. After a restore you invite them again from their card, and everything
they reported is already there.

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

## Deleting an LLC

On the Team page, an owner can delete an LLC. This also deletes its
properties and every ledger entry under it, for everyone on the team, so the
confirmation asks you to type the LLC's name and tells you exactly how much
history would go. Download a backup first if you might want those records.

## Legacy artifact version

`rent-roll/index.html` is an earlier, single-file version of this app built
for Claude Artifacts (no login, no separate backend — data is stored by the
Artifacts platform). It's kept for reference; the Next.js app above is the
one meant for a real deployment.
