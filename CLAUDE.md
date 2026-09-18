# Working agreements

## Delegation

Use the project's subagents rather than doing this work inline:

- **scout** — searching the codebase. Any time answering a question means
  sweeping files: finding definitions, call sites, config, or whether a pattern
  exists anywhere. Use it instead of running a broad Grep/Glob directly.
- **log-reader** — test, build, lint and CI output. Hand it the output (or the
  log path) after a run rather than reading long output inline, especially when
  something failed.
- **architect** — before starting a change that touches several files. Get the
  plan first; then implement it.

A single obvious edit to one known file does not need any of them.
