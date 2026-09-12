# Rent Roll

A single-page profit tracker for rental properties: log rent payments and repair/expense costs per property, and see rent collected, expenses paid, and net profit at a glance.

## Features

- Add multiple rental properties (name, address, monthly rent).
- Record rent payments (tenant, date, amount, note) and repairs/expenses (category, date, amount, note).
- Per-property and portfolio-wide totals: rent collected, expenses paid, net profit.
- A filterable ledger of every transaction, newest first, with delete support.

## Running it

`index.html` is a self-contained page (no build step, no server). Open it directly in a browser.

Data storage: the page uses the Claude Artifacts `db` capability when it's available (i.e. when opened as a published Claude artifact), which saves properties and transactions automatically and keeps them in sync across visits. Opened any other way (e.g. as a plain local file), it falls back to showing example data as a preview — nothing is saved in that mode.
