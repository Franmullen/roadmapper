---
status: doing
lane: core
owner: claude
---
# Quality system

Fast agent work needs checks that don't depend on anyone remembering them. There is one quality gate, a fresh-context reviewer for every change, an architecture audit each milestone, and pull requests, with the owner's approval on the Reviews tab as the merge signal.

## Tasks

- [x] `scripts/check.py`: JS syntax, tests, architecture rules and the zip build; fails with exit 1 (planted violations caught)
- [x] CI runs the gate on pushes to main and on pull requests; PR template; Dependabot for Actions
- [x] `feature-reviewer` and `architecture-reviewer` subagents (read-only), `ship-plan` and `architecture-audit` skills
- [x] `docs/architecture.md` and `docs/debt.md`; CLAUDE.md points to them
- [x] `scratch/` is ignored, for discussion drafts; the Celbridge feedback drafts moved there
- [ ] Ship this plan through its own flow: review, PR, CI
- [ ] Check: read the `ship-plan` skill and `docs/architecture.md`; do they match how you want to work?
