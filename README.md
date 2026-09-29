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
   - `NEXTAUTH_SECRET` must be at least 32 characters; a production build refuses to start with a short or placeholder one.
   - Signups are open: anyone can create an account and set up their own LLC, and each account only ever sees its own companies. To make it invite-only, set `SIGNUPS=invite-only`; then a `SIGNUP_CODE` you choose, or a join code from an existing team, is needed.
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
3. Add a **private Blob** store from the same Storage tab if you want receipts,
   photos and documents (see below) — the app reads its token as
   `PRIVATE_BLOB_READ_WRITE_TOKEN`.
4. Add the other environment variables:
   - `NEXTAUTH_SECRET` — same as above
   - `NEXTAUTH_URL` — your deployment URL, e.g. `https://your-app.vercel.app`
   - `SIGNUPS=invite-only` and `SIGNUP_CODE` — only if you want to close public signups

   Leave a variable out entirely rather than saving it blank — an empty value
   is not the same as unset and can break the build.
5. Deploy. The build runs migrations (`prisma migrate deploy`) before building,
   so the tables are created or updated automatically without destroying data.

## Site admin

One account runs the site. `fariseqal3@gmail.com` is the first admin: on a
fresh site the account that signs up with that address starts as admin —
only while the site has no admin at all — and the migration flagged the
existing one. After that, admin comes from another admin and from nowhere
else: signups are open and addresses aren't verified, so an address on its
own must never be enough. Admins get an **Admin** tab; for everyone else
that page, and every `/api/admin` route, is a 404.

The panel lists every account and every LLC, with a search box across both,
and lets an admin:

- put someone on any LLC as owner or member, change their role, or take
  them off — with the same two rules the Team page keeps: never the only
  owner while others remain, and never the last person on an LLC (delete the
  LLC instead, which is the honest version of that);
- create an LLC for an account, rename one, or delete one (typed name to
  confirm, everything under it goes for everyone on it);
- delete an account (typed email to confirm). LLCs the account was the only
  member of go with it, because nobody could ever reach them otherwise; on
  LLCs with teammates the account is just taken off, and if it was the only
  owner the longest-standing member becomes one. The panel says exactly
  which before asking;
- sign an account out everywhere, and turn off its two-factor — how a
  landlord who lost their phone gets back in;
- make or unmake admins. Nobody can change their own admin standing or
  delete themselves, and an admin can't be deleted until admin is removed
  from it — so there is always someone who can get in.

Every one of these is written to a log, shown at the bottom of the panel:
who did what, to which account or LLC, when. Emails in the log are frozen
text, because the account they name may be the one that was deleted.

`ADMIN_EMAILS` (comma-separated) replaces the built-in owner address for
that first-admin moment. Links the panel makes (a password reset link) are
built on `SITE_URL`, or the site's own domain when that's unset — never on
the request, whose Host header is whatever the sender says.

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
- Anyone can sign up and create their own LLC. Someone given a join code can
  type it into the optional box on the signup page and lands straight on that
  LLC's team, or sign up first and enter it under "Join with a code" later.
  Account creation is limited to ten per address per fifteen minutes, so the
  open form can't be used to mint accounts in bulk. `SIGNUPS=invite-only`
  closes it again, and a valid join code still gets through then.
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

### Late fees

An LLC can charge late fees automatically, the same way for every tenant,
from the **Team** page:

> If rent is still owed 5 days after the due day, a late fee of 7% of that
> month's rent is charged, then $5 a day until it's paid, up to 12% of that
> month's rent ($120 on $1,000).

The four numbers — grace days, the one-time percentage, the daily amount and
the cap — are the LLC's, and the page reads the policy back in a sentence as
you type. It is off until an owner switches it on.

**Switching it on when rent is already overdue.** Saving applies the policy
at once to every tenant of the LLC and lists, tenant by tenant, what was
charged or exactly why not (paid up, still in the grace period, set to no
late fees, on their own rules, at the month's cap, …). Rent already overdue
that day — this month's, or an earlier month's that is still unpaid — gets
the one-time 7% fee that day. Daily fees count only from the next day; the
days before the policy existed are never backfilled. "Still unpaid" means
after later payments are set against the oldest rent first, so a tenant
who carried a shortfall but has since caught up isn't charged for it. The
12% cap per month holds regardless. **Run late fees now** does the same
thing at any time and never charges twice.

Each tenant's account then says which late fees apply to them, under **What
bills itself**: the LLC's policy (the default), **their own late rules** with
different numbers, or **no late fees** at all. Rules for every month — a lot
fee, pet rent — apply whichever is chosen. A tenant's own late rule can carry
the same daily amount and cap as the policy.

How it accrues, on $1,000 rent due on the 1st with the policy above: nothing
through the 5th; **$70** on the 6th; **$5** on each of the 7th, 8th, 9th…
until the month's rent is paid or the fees reach **$120**, whichever comes
first (ten daily fees). The daily amount stops the day the rent is paid, even
if the fees themselves are still open. A partial payment doesn't reset
anything — the daily fee carries on against what's left — and no fee is ever
bigger than what's still owed, so a $3 shortfall accrues $3 a day, not $5. A
month with no rent (a vacancy, a tenant who has moved out) accrues nothing,
and the percentage is of *that* month's rent, from the rent history, so a
raise in September changes September's fee and not August's. No single
automatic charge can exceed $2,000, whatever the numbers say.

Every fee is an ordinary charge on the tenant's account — "Late fee", "Late
fee (Sep 8)" — that you can see and **delete**, and the tenant sees it on
their portal. Deleting one is final: the app remembers that the day was
charged and never charges it again, and a deleted fee still counts toward the
month's cap. The fees are applied when the policy is saved, by **Run late fees now**, by
the daily job at 13:00 UTC for every LLC whose policy is on (whether or not
its reminders are), and whenever a tenant's statement or portal is opened.
Every one of those writes each fee once. The overview's **Needs attention**
shows the month's late fees in what a tenant owes, and **Mark paid** records
the full amount. Rent-late reminders say what was added ("A $70 late fee was
added; $5/day more until paid, up to $120.").

**Waiving a month's late fee.** When you record rent (**+ Rent** on the
property page, or **+ Record** on the overview) or edit a rent entry, tick
**Waive late fee for this month**. The box only shows when the entry belongs
to one current tenant, and the month is the entry's date's. Saving deletes
every late fee already on that tenant's month (the one-time fee and each
daily one, from the policy or their own late rule) and no late fee is ever
added to it again — not by the daily job, **Run late fees now**, opening the
statement or portal, or the late-fee status check. It covers that one
tenant and that one month only: the LLC's policy and the tenant's late-fee
setting don't change, their other unpaid months keep their fees, next
month's rent is charged as normal, and other tenants are untouched. Anyone
on the LLC's team can do it; who and when is recorded. The statement shows
"Late fee waived by …" on that month's row, the tenant's portal shows "Late
fee waived", and the overview shows it on the property card and in Needs
attention. Rent-late reminders stop mentioning a fee for that month.

To take it back, untick the box on the rent entry or press **Remove waiver**
on the statement. Late fees then start again **from that day**, as if the
policy had been switched on that day: the one-time fee comes back that day
only if rent for the month is still owed (and never more than what's owed);
$5 a day runs from the next day; the waived days are never billed; and the
month's 12% cap counts only fees charged since. Waiving again removes those
too.

Backups carry the policy, each tenant's choice, every day already charged,
and every waiver (with the day it was taken back, if it was), so a restore
neither forgets a fee, bills it twice, nor revives a waived one.

### Moving out, and the deposit

**Move out** on a tenant's card ends the tenancy properly rather than just
flipping them to past:

- **The last month of rent.** Rent stops after the month you pick. Before
  this, a tenant marked moved out was charged to the end of their lease, so
  leaving three months early read as three months of arrears.
- **Where the deposit goes.** The form shows the deposit held and what they
  owe through that month, and suggests putting the deposit toward that rent.
  Add itemized lines for damage or cleaning. It won't let you keep more than
  you hold, or apply the deposit to rent they don't owe; anything they still
  owe past the deposit stays on their balance.
- **The books.** Every dollar kept is entered as rental income on the
  move-out date — the IRS treats a kept deposit as rent — and a damage line
  is also added to their account as a charge, so their statement reads
  "charged $185.50 for cleaning, paid from the deposit". Money returned never
  touches the ledger, because a deposit held was never income.
- **The deadline.** Most states give 14 to 45 days to return a deposit with
  an itemized list. The return-by date defaults to 30 days; until it's marked
  sent, the deposit waits in **Needs attention**, overdue ones in red.
- **The itemized statement.** A letter-style page with what was held, each
  deduction and what's coming back, laid out to print or save as a PDF and
  send to their forwarding address.

**The empty place.** A move-out that leaves nobody living there marks the
place vacant, from the day rent stops — the later of the day they left and
the end of the last month they were charged for, so a vacancy never counts
days someone paid for. The dashboard then lists it under Needs attention
with how long it's stood empty and the rent it has gone without, prorated by
the day at what the place was asking each month. A vacancy is the costliest
thing on a rent roll and the only one that never shows up in the ledger,
because nothing happens; this is what puts it next to the late rent.
Adding the next tenant ends it. Marking a place vacant by hand on its edit
form asks when it went empty; places marked vacant before this existed have
no date and are shown as vacant without a figure rather than given an
invented one.

**Undo move-out** takes all of it back: the income and charges come out and
they're current again. It's refused if someone else now lives there. The
income and charges can't be deleted on their own from the ledger or the
statement, for the same reason as a mortgage payment's parts.

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

### Forgot password

**Forgot your password?** on the sign-in page asks for the email and, when
the site can send email, sends a one-time link to set a new one. The
answer on screen is the same whether or not the address has an account,
so the form can't be used to find out which emails are signed up.

A link lives an hour, works once, and asking for another retires the old.
Only its hash is stored, so a copy of the database can't be turned into a
way in. Using it signs the account out everywhere — the usual reason for a
reset is not being sure who has the old password — and it never gets past
two-factor: someone with the link and without the phone still can't sign
in. An admin can turn two-factor off from the Admin page if the phone is
really gone.

Asking is limited per address as well as per requester, and a link
younger than five minutes is left standing, so a stranger who knows the
address can't flood it with mail or keep killing the link its owner is
about to click. A password change or a sign-out-everywhere kills any
outstanding link too.

Email needs `RESEND_API_KEY` and `EMAIL_FROM` set (Resend has a free tier;
the sender must be on a domain verified there). Without them the page says
so and points at the admin, who can make a reset link for anyone from the
Admin page and send it however they already talk to that person. Both
routes are the same link; only who hands it over differs.

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

## Owner portal

A property owner or investor who is **not** on your team — someone who put
money into a house and wants to see how it's doing — can be given a
read-only login of their own at `/owners`. From **Team → Property owners**
(`/dashboard/owners`), an owner of the LLC types their email, ticks the
properties they may see, and sends the invite. The link goes by email when
the site can send it; either way it's shown on screen to copy and send
yourself. It works once, for 14 days, and **Resend** retires it for a fresh
one. Only the hash of the link's token is stored, like a password reset.

The invitee sets a name and password at `/owners/accept` and lands on the
portal. Someone who already has an owner login (another LLC invited them,
or you're adding properties) enters that password instead, and the new
properties join what they had. You can **Edit** which of the LLC's
properties each owner sees at any time, and **Remove** takes the access
away — and the login with it, if that leaves them nothing anywhere.

Signed in, an owner sees, for their properties only:

- **Overview** — the rent roll and occupancy. Each unit shows its asking
  rent, whether it's let, the tenant's *first name* and the month their
  lease ends, and how long a vacant place has stood empty. Nothing else
  about a tenant: not a surname, phone, email, deposit, balance or notes.
  Below it, open repairs (title, category, status, when it was opened — no
  reporter, no thread, no vendor or price) and the documents you've ticked
  **Show to property owners** on in the filing cabinet.
- **Income & expenses** — the last twelve months by month and the year to
  date, per property and all together.
- **Statement** — one month's owner statement: rent collected, other income
  (deposit money kept at a move-out), expenses by category, net; per
  property and combined, with **Download PDF**. The PDF is a real text PDF
  (`lib/pdf-text.ts`, base-14 Helvetica, no dependencies).
- **Account** — a switch for a monthly email when each statement is ready
  (goes out on the 2nd via the daily reminders run, once per owner per
  month), and **Sign out everywhere**.

Owners are `PropertyOwner` rows — a third table, a third credentials
provider (`"owner"`) and a third session `kind`, for the same reason
tenants are separate: the landlord's queries never join to it. `proxy.ts`
keeps `/owners` and `/api/owners` to owner sessions and everything else
away from them; `requireOwnerSession()` resolves the session into a list of
property ids and every owner query filters by that list. What an owner may
know about a tenant is one pure function, `occupantForOwner` in
`lib/owners.ts`, with a test that pins its shape. Sign-in throttling and
trusted devices work as for the other two doors. Backups carry owners by
email with their properties by position; a restored owner has no password
and is re-invited from the Property owners page.

### Owner password reset

The owner sign-in has a **Forgot your password?** link (`/owners/forgot`)
that emails a reset link through the same Resend setup as the landlord's,
with the same rules: the link works once, lasts an hour, only its hash is
stored, asking is rate-limited per address and per email, a link younger
than five minutes is left standing, and the page answers the same way
whether or not the email has an owner login. The link opens
`/owners/reset` and, once used, sends them back to the owner sign-in;
setting the new password signs the owner out everywhere else.

Owner links live in their own table (`OwnerPasswordReset`) rather than the
landlord's `PasswordReset`, whose rows are tied to landlord accounts: an
owner's link can only ever reset an owner's password, and a landlord's
link does nothing at `/owners/reset`.

Under **Team → Property owners**, **Send password reset** next to an owner
emails them a link (a few times an hour at most). When the site can't send
email the link is shown on screen to copy and hand over, as invite links
are. Only an owner of the LLC can use it, and only for owners of that
LLC's properties.

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

## Messages

Each tenant has **one conversation** with the company that manages their
place — not with a person. On the dashboard it's the **Messages** tab: an
inbox of every tenant you've written with, newest activity first, with a
count of what you haven't read, and a thread page per tenant with a composer.
Every tenant card on a property page carries a **Messages (n unread)** link
to that thread, so you can write to someone before they have a phone number
on file or a portal login. In the portal it's the **Messages** card under the
notices, with a badge in the bar that jumps to it.

A message is text (up to 4,000 characters) plus up to four photos or PDFs.
Files are checked by their bytes, capped at 4 MB each, kept in private
storage, and served only through `/api/files/message/<id>` after the same
check as every other file: the LLC's team, or the tenant whose thread it's
in. Phone photos are shrunk in the browser before they're sent.

Everything from your side is signed with the **company's name** in the
portal, never a team member's name or email — the same rule as repair
replies. On the dashboard you see who on the team wrote each line.

**Read** means read, not delivered. Each thread keeps two stamps,
`tenantReadAt` and `landlordReadAt`; a message from the other side newer than
your stamp is unread. The stamp moves only after the thread has actually been
on screen for a couple of seconds with the tab in front, so a page you open
and leave doesn't count. One stamp serves the whole team: a tenant is talking
to the company, and one of you reading it is the company reading it.

A new message **emails and pushes the other side** — the tenant, or every
member of the team — through the same once-only log the reminders use, with
the tenant's own reminder switches respected. It's batched: at most one
notification per thread, per side, per half hour, and it says how many
messages are waiting. Thirty lines in a row cost the other person one buzz.

Tenants can only ever reach their own thread: every portal route resolves the
thread from the session, never from an id in the request. A tenant may send
thirty messages an hour. Backups carry each tenant's conversation, with the
read stamps and links to the attachments, the way they carry receipts.

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

**Recurring expenses.** Set up an insurance, HOA or management payment once on
a property's page — amount, category, and a monthly or yearly
schedule. Nothing posts itself: when one is due, it shows up on the
dashboard for that month with a one-click **Log it** button that creates
the transaction and marks it done for that period.

**Mortgages.** A mortgage payment is three kinds of money under one number:
interest (an expense), escrow for property tax and insurance (also expenses,
on their own Schedule E lines), and principal (not an expense — it's equity).
Logging the whole payment as one "Mortgage Interest" bill, which is what this
app used to suggest, overstates the interest deduction by the principal and
escrow every month, understates profit, and gives an interest figure that
won't match the lender's Form 1098.

So a property can carry its loans under **Mortgages**, set up from the figures
on the latest statement: the principal balance going into the next payment,
the rate, the principal-and-interest payment, the monthly escrow, and the due
day. Each payment is then split from the balance at the time — interest into
the ledger as Mortgage Interest, escrow as Property Tax and Insurance, and
principal only off the balance. The dashboard asks for each payment when it's
due, with the split shown before you log it; the property page records one
with the lender's own figures when they differ, and shows the balance, the
payoff date, the interest still to come, and any month never recorded.

The interest and escrow entries a payment wrote belong to it: the ledger won't
change their amount or delete one on its own, because the loan's balance and
the books would then disagree. **Undo** on the payment removes them together.
A new rate or escrow figure applies from the next payment; recorded ones keep
their split. Removing a loan (owners only) keeps the ledger entries — that
interest was really paid. If a property still has a recurring bill filed under
Mortgage Interest, the loan panel offers to pause it so nothing is counted
twice.

Amounts are worked in whole cents, and a 30-year schedule's rounding residual
is folded into the final payment the way lenders do it.

**Depreciation.** The tax code lets a landlord deduct a rental building's
cost over 27.5 years (39 for a commercial building like a storefront), and
the same for improvements to it — a roof, a furnace, a remodel. It's usually
the largest deduction on Schedule E and, because no money moves, no ledger of
payments ever shows it. Each property page has a **Depreciation** section:
add the building (its cost without the land, which never depreciates) and any
improvements, with the month each was first ready to rent. The app works out
each year's deduction by the IRS method for both classes — straight-line with
the mid-month convention — and checks against Publication 946's table in the
tests. Each year is the difference of two rounded running totals, so a
schedule adds up to exactly its basis. It is deliberately not in the
overview's profit, which is money in and out; it is on the tax export.

**Tax-year export.** The **Export** page downloads a CSV for one LLC and
one year — every transaction, a summary totalling rental income and each
expense category, and, when the LLC owns more than one house, the same
breakdown per property. Schedule E is filled in per property, so that last
block is the one an accountant actually wants. A final block lists each mortgage's
interest, escrow and principal for the year and its balance at year end —
the interest line is the one to check against the lender's Form 1098. When anything is being depreciated, the summary
gains a depreciation line (Schedule E line 18) and a net after depreciation,
per property too, and a schedule of each asset's basis, class, year's
deduction and total taken — the running figure an accountant carries forward
and needs again at a sale.

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

This needs a **private Vercel Blob** store:

1. In Vercel, open the project's **Storage** tab.
2. Create a **Blob** store, choose **Private**, connect it to this project,
   and redeploy.
3. Check the project's environment variables for the new store's token. The
   app reads it as `PRIVATE_BLOB_READ_WRITE_TOKEN`; if Vercel named it
   something else, rename it and redeploy.

Until a store is connected, the app works normally and uploads fail with a
message saying to set this up — transactions still save either way.

Files never leave through their storage URL. Every receipt, photo and document
is linked as `/api/files/<kind>/<id>`, which checks the session first: the
landlord team for that property or LLC, the tenant who filed a repair photo,
or the tenant a document was shared with. Anyone else gets a 404.

**Upgrading from the public store:** files uploaded before the private store
existed are still in the old public one, where the exact URL opens them. Go
to **Account → Stored files → Move old files** once: it copies each one into
the private store, re-points the app at the copy and deletes the original.

Backups include links to the files rather than the files themselves, so a
restored backup re-links to the same files as long as the store still exists.
Private links in a backup are signed for the account that exported it: the
same account restoring its own backup gets its files back, but anyone else
importing a copy of it does not.

## The filing cabinet

Every document across your properties lives in one place — the **Files** tab —
and each property has its own drawer at `/dashboard/properties/<id>/files`
(there's a link at the top of the property's Documents section). Filter by
kind (lease, insurance certificate, tax, receipt, statement, notice, photo…)
or by property, search by name, tenant or note, open a file in a new tab,
download it, rename or refile it, and delete it (owners only — it's the only
copy). Documents filed against a tenant can still be shown on their portal.

**Scan** turns paper into a PDF with a phone. Tap Scan, take a photo of each
page (or choose photos already taken), and each one is cleaned up in the
browser before anything is uploaded:

- turned the right way up, from the photo's own orientation tag;
- cropped to the sheet — the paper is whatever's clearly brighter than the
  desk around the edge of the photo, so a shadow across the page doesn't cut
  the crop short (turn "Crop to the page" off for a photo that's already
  tight);
- **Color**: the contrast stretched so grey paper reads white and faint ink
  dark; **Black & white**: each pixel judged against its neighbourhood, so a
  page half in shadow comes out evenly black-on-white;
- shrunk to about 150 dpi and re-encoded until all the pages fit the 4 MB
  upload — a ten-page lease gets roughly 390 KB a page.

Pages can be rotated, reordered and removed before saving. Saving builds the
PDF in the browser (`lib/pdf.ts` writes the file directly — each page is the
JPEG embedded as-is, no library) and files it against the property or tenant
you choose, under the kind you choose, named "Lease – 12 Oak St – Sep 28, 2026"
unless you type something else. Up to 20 pages a scan; a longer document goes
in as two. The picture arithmetic is in `lib/scan.ts` and the PDF writer in
`lib/pdf.ts`, both pure and covered by `tests/scan.test.ts` and
`tests/pdf.test.ts`. What the server receives is an ordinary PDF upload, with
the same type sniffing and size limit as any other document.

## Automatic reminders and phone notifications

Rent Roll can do the chasing for you. Under **Team → Automatic reminders**
(or `/dashboard/reminders`) each LLC has a master switch and five reminder
types, each with its own on/off, timing and channels (email, phone
notification, or both):

- **Rent due soon** — to the tenant, N days before their due day (default 3).
- **Rent late** — to the tenant, once a month, after the grace period. A
  tenant's own late-fee rule sets their grace period; the company figure
  (default 5 days) is for tenants without one. It's also written to their
  portal and the tenant card as a chase, like one sent by hand.
- **Lease ending** — to your team at 60 and 30 days out (editable list), and
  optionally to the tenant.
- **Document expiring** — to your team at 30 and 7 days before anything in
  the filing cabinet with an expiry date runs out.
- **Repair updates** — to the tenant the moment you reply on their request
  or change its status.

**Send test email** and **Send test notification** send you a sample.
"What's gone out" lists every attempt with its result.

Everything runs from one daily job, `/api/cron/reminders`, scheduled in
`vercel.json` at 13:00 UTC (early morning across the US, when the UTC date
and the local date agree). Vercel calls it with `Authorization: Bearer
$CRON_SECRET`; set `CRON_SECRET` in the project's environment variables and
Vercel sends it automatically. Every send is claimed first in the
`ReminderSent` table under a key that names the thing being reminded about
(`rent-due:<tenant>:<month>`, `lease-end:<tenant>:<date>:<60>`, …), unique
per channel and recipient, so a rerun — or two runs landing together — never
messages anyone twice. Reminders are off for a company until an owner turns
them on.

Tenants have their own say: the portal's **Reminders** card lets them switch
email or phone notifications off, and add their phone number. You can also
switch email reminders off for a tenant from their card.

### Phone notifications (web push)

The site is an installable app, and an installed app can receive
notifications. Set three variables in Vercel (generate the keys once with
`npx web-push generate-vapid-keys`):

    VAPID_PUBLIC_KEY=...
    VAPID_PRIVATE_KEY=...
    VAPID_SUBJECT=mailto:you@example.com

Without them push is quietly off and email still goes out. Each person
enables notifications per device — **Reminders** or **Account** in the
dashboard, the **Reminders** card in the portal — and can send themselves a
test. Subscriptions are stored per landlord login and per tenant login
(several devices each) in `PushSubscription`; one the push service reports
gone (404/410) is deleted. The service worker is `public/sw.js`; it only
shows notifications and opens the right page when one is tapped — no caching.

On an **iPhone or iPad** notifications need iOS 16.4 or later and only work
once the site is on the home screen: Safari → Share → Add to Home Screen →
open it from there → Enable notifications. On **Android** Chrome offers a
one-tap Install. A banner explains the right steps on any phone browser that
hasn't installed the app yet (dismissable for 30 days; never shown on a
desktop), and once installed it offers to turn notifications on. The
manifest carries regular and maskable icons at 192 and 512; the portal has
its own manifest (`/portal-manifest.webmanifest`) so a tenant's installed
app opens on the portal, not the landlord sign-in.

A text-message channel isn't wired up; `lib/notify.ts` and the per-type
channel columns are shaped so one could be added without touching the rest.

## Installing it on a phone

Most of the logging happens standing in a doorway, so the app ships a web
manifest and icons: **Add to Home Screen** gives it a real icon and opens it
without browser chrome. The layout is built for a phone first — a bottom tab
bar in thumb reach, the record form as a sheet that rises from the bottom,
and the ledger as a card per entry rather than a table you scroll sideways.

Dark mode follows the system setting.

## Backups

The **Backup** page downloads a single JSON file with every LLC, property,
unit, tenant, recurring expense, mortgage and its payments, rent change,
repair report and ledger entry you can see, and restores one back into the
app. Ledger entries a mortgage payment wrote are re-linked to that payment on
restore, so they stay protected from being edited on their own. Proof files and repair
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

## The database connection

The app runs as many serverless instances, and each opens its own database
connections. A small Postgres allows about a hundred in all; when that runs
out, new connections are refused outright, and the effect is maddening —
pages holding a connection keep working while the overview, which fans out
a dozen queries, fails nearly every time. That was an outage on
2026-09-28, and `FATAL: too many connections for role` was the cause.

Two things keep it from happening again:

- **Use the pooled connection string.** Neon and Vercel Postgres provide one
  (the host contains `-pooler`; Vercel names it `POSTGRES_PRISMA_URL`, and
  the app uses that variable ahead of `DATABASE_URL` when it's set).
  Supabase calls it the transaction pooler, on port 6543, and wants
  `?pgbouncer=true` on the end. A pooler multiplexes thousands of client
  connections onto a few real ones, which removes the limit altogether.
- **Migrations use the direct string.** `DATABASE_POSTGRES_URL` is the
  unpooled connection (the same value as `DATABASE_URL` on a database with
  no pooler); `prisma migrate deploy` at build time goes through it,
  because a pooler in transaction mode can't run a migration safely.
- **One connection per instance.** Unless the URL sets its own
  `connection_limit`, the app uses one, and waits up to twenty seconds for
  it rather than failing the page. Queries on one instance then run one at
  a time — the overview's dozen take about a tenth of a second together.

`/api/health` runs `SELECT 1` and says whether the database is up, which URL
is in use and whether it's pooled, and on failure the Prisma error code and
a message with hosts, users and quoted values stripped out. It's the first
thing to check when every signed-in page is a 500.

Each deploy briefly doubles the open connections while the old instances
drain, so on a direct (unpooled) URL expect a few minutes of errors after
each one, and don't deploy twice in five minutes.

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
