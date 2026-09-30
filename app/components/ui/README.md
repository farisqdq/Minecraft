# UI system

Tokens live in one place: `app/globals.css` (`:root`, plus the dark block
under `prefers-color-scheme` / `[data-theme="dark"]`). CSS modules use only
`var(--token)` — no hex values, no font stacks, no `999px` buttons.

## Tokens

| Group | Names |
| --- | --- |
| Neutrals | `--gray-0 … --gray-950` (zinc) |
| Surfaces / text | `--bg` page, `--surface` cards/inputs, `--surface-2` subtle inset / hover row, `--surface-3` hover fill; `--ink`, `--ink-2`, `--muted`, `--faint`; `--line`, `--line-strong` |
| Accent (one) | `--accent` fill, `--accent-strong` hover, `--accent-soft` tint, `--accent-text` accent as text, `--on-accent` |
| Status | `--success`, `--warning`, `--danger` (+ `--danger-text`), `--neutral`; each has `-soft` (background) and `-line` (border) |
| Focus | `--focus` (outline colour), `--focus-ring` (box-shadow for inputs) |
| Charts | `--chart-in`, `--chart-out`, `--chart-grid`, `--chart-axis`, `--chart-ghost` |
| Elevation | `--shadow-sm` (cards), `--shadow-md` (hovered card), `--shadow-lg` (menus, popovers), `--shadow-overlay` (dialogs), `--scrim` |
| Radius | `--radius-6` badges, `--radius-8` buttons/inputs/menus, `--radius-12` cards/dialogs, `--radius-full` avatars and count dots only |
| Spacing | `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-6` 24 · `-8` 32 · `-12` 48 · `-16` 64 |
| Type | `--font-sans` (Inter), `--text-xs` 12 · `sm` 13 · `base` 14 · `md` 15 · `lg` 16 · `xl` 18 · `2xl` 20 · `3xl` 24 · `kpi` 26; `--tracking-tight`, `--tracking-title` |
| Controls / layout | `--control-h` 36px (44px ≤720px), `--control-h-sm` 32 (40), `--tap` 44, `--sidebar-w` 240, `--sidebar-rail` 64, `--content-max` 1400, `--page-pad` 32 (16 on phones) |

Legacy names still resolve (`--expense` = danger, `--gold` = warning,
`--radius` = 12px, `--radius-sm` = 8px, `--shadow` = md) so old modules keep
working; prefer the semantic names in new code.

## Rules

- **One typeface.** Inter everywhere, tabular numerals are on globally
  (`body`). Titles: 600 weight, `--tracking-title`. No serif, no mono.
- **Colour means something.** `--accent` = primary action, links, focus,
  active nav. Green/red only for signed figures (net, deltas, balances) and
  statuses. Plain totals ("Rent collected") are `--ink`. Zero is `--muted`:
  use `moneyTone(n)` / `owedTone(n)` + `toneClass(styles, tone)` from
  `lib/money-tone.ts` (module needs `.pos/.neg/.zero`).
- **Buttons** — use `dashboard.module.css`: `.btn` (secondary),
  `.btn.primary` (accent; one per view), `.btn.quiet` (no border),
  `.btn.danger`, `.btn.small`. Heights come from `--control-h`, so phones
  get 44px automatically. Radius 8. Never pill-shaped.
- **Cards**: `--surface`, `1px solid var(--line)`, `--radius-12`,
  `--shadow-sm`.
- **Page tops** use `PageHeader` (AppShell renders it from its `title`,
  `tagline`, `back`, `actions`, `titleAction` props). `tagline` is factual
  context only (address, email) — never marketing copy.
- **Row actions**: one visible primary button; everything else in an
  `OverflowMenu`. Destructive items get `destructive: true` and a `confirm`.

## Primitives (`app/components/ui/`)

- `PageHeader({ title, subtitle?, back?: {href,label}, titleAction?, actions?, children? })`
- `StatusBadge({ status: "paid"|"partial"|"late"|"vacant"|"ended"|"neutral"|"info", children?, dot? })`
  — Paid green, Partial amber, Late red, Vacant gray, Lease ended muted.
- `KpiTile({ label, value, delta?, deltaValue?, deltaTone?: "normal"|"inverse"|"neutral", hint?, footer?, href? })`
  and `KpiRow` (responsive grid). Value is ink; only the delta chip is toned.
- `EmptyState({ icon?, title, detail?, action?, compact? })` — icon + one line + action.
- `Skeleton({ variant: "line"|"box"|"rows", width?, height?, rows? })` — shimmer, off for reduced motion.
- `OverflowMenu({ items: MenuItem[], label, align?, trigger?, header? })` —
  `MenuItem = { label, icon?, onSelect?, href?, disabled?, destructive?, confirm? }`;
  `confirm` opens the app's `ConfirmDialog` first. 32px trigger, 44px on phones.
- `IconButton({ icon, label, href?, tone?, tooltip?: "top"|"bottom"|"none" })` — label = aria-label + CSS tooltip.
- `SegmentedControl({ options: {value,label,icon?,hideLabel?}[], value, onChange, label, size? })` — radiogroup (card/table toggle, periods).
- `Table.tsx`: `TableWrap({ stack? })`, `tableStyles` (`.table`, `.num`, `.muted`, `.rowLink`, `.sub`),
  `useSort(rows, columns, initial)`, `SortHeader({ label, col, sort, onSort, numeric?, firstDir? })`.
  Sticky header, 44px rows, right-aligned tabular numbers; on phones rows stack
  into cards using each `<td data-label="…">`. Sorting logic: `lib/sort-table.ts` (tested).
- Icons: `app/components/icons.tsx` — `IconX({ size = 20, strokeWidth = 1.5 })`, Lucide-style.
  Use 16px in buttons/rows, 18–20px in navigation.

See `app/dashboard/properties/PropertiesClient.tsx` for a page built from these.
