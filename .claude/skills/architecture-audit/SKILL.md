---
name: architecture-audit
description: Run a whole-repository architecture audit of Roadmapper with the read-only architecture-reviewer, and feed its results back into the docs and the roadmap. Use at the end of each milestone, or after a change to module boundaries, file conventions or data flow.
---

# Architecture audit

1. Run `python scripts/check.py` and note the result.
2. Start the `architecture-reviewer` subagent. It runs in a fresh context and reads only. Tell it the milestone just finished and the date of the last audit (from `git log -- docs/debt.md`).
3. Check its findings against the code yourself, and drop any without evidence.
4. On a `plan/architecture-audit-<milestone>` branch:
   - apply the doc edits you agree with to `docs/architecture.md` and `docs/debt.md`;
   - add each improvement worth doing to the roadmap's `ideas.md` as an idea, under `- Milestone:` if it belongs somewhere specific. The owner sees them on the Ideas tab, and they go through the normal loop.
5. Open a PR for the doc changes (see the `ship-plan` skill). Don't refactor anything as part of the audit.
