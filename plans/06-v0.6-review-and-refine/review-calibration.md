---
status: todo
lane: core
depends: quality-system
---
# Review calibration

Prove the reviewer is worth trusting, on throwaway branches that are never merged.

## Tasks

- [ ] A planted correctness bug (e.g. `addFollowUps` dropping a line) gets a P1 or P2
- [ ] A clean, tested change gets no significant findings
- [ ] A style-only change doesn't set off a refactor
- [ ] A view that writes files directly is caught by the gate, not just the reviewer
- [ ] Record the results in `docs/quality.md`, and tune the reviewer's instructions
