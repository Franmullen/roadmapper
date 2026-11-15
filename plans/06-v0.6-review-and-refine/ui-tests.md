---
status: todo
lane: core
depends: quality-system
---
# UI tests

Debt D1: the views and main.js are only checked by hand. Load the real page in a headless browser with a fake Celbridge client over a fixture folder, so CI can catch UI regressions.

## Tasks

- [ ] A fake `celbridge-client` (file tree, read, write, watch) over an in-memory fixture
- [ ] Playwright smoke tests: each tab renders; approve, follow up and add an idea write the right files
- [ ] Run them in CI as part of the gate
