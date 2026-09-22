# Migration naming

Prisma applies migrations in **lexicographic** order of the directory name,
not numeric order. `10_x` sorts before `2_x`, and `4_tenants` — which every
later table hangs off — sorts after both.

This has bitten this project three times:

1. Prisma's own timestamped names (`20260918182419_rent_history`) sorted
   before `3_units_categories_recurring`.
2. The same again with `20260918124103_tenants`.
3. `10_tenant_notices` sorted second, right after `0_init`, and a fresh
   database died on it because `Tenant` did not exist yet.

Each time the existing production database was fine — it applies only what is
pending, in an order that happens to work — and each time a **fresh or
restored** database could not be created at all. That is the thing to protect:
a backup you cannot restore into a new database is not a backup.

## The rule

`0_` through `9_` are the original ten and are left alone: renaming a
migration that has already been applied makes Prisma treat it as pending.

Everything after them uses a **letter prefix with a zero-padded number**:

    a01_tenant_notices
    a02_tenant_balances
    a03_...

Letters sort after all digits, and the zero padding keeps `a10` after `a09`.
Ninety-nine of these before needing `b01_`.

## Before you push a migration

Replay the whole history into an empty database. It is the only check that
catches this, because the database you developed against already has the
earlier migrations in it:

```
createdb rentroll_scratch
DATABASE_URL=postgresql://…/rentroll_scratch npx prisma migrate deploy
```

Every migration must apply, in order, from nothing.

## Writing them so a rename is survivable

If a migration might ever be renamed, or might meet a database that already
has its objects, write it to be safe to run twice: `CREATE TABLE IF NOT
EXISTS`, `CREATE INDEX IF NOT EXISTS`, and constraints wrapped in

```sql
DO $$ BEGIN
    ALTER TABLE "X" ADD CONSTRAINT "…" …;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

`a01_tenant_notices` is written that way because it was renamed after being
applied in production.
