---
status: review
lane: ui
depends: dependencies, review-and-cleanup
---
# Map view

## Tasks

- [x] Lanes as horizontal bands, milestones as columns, plans as nodes
- [x] Arrows from each plan to the plans that depend on it; hover a plan to pick out its links
- [x] More detail as you zoom in: coloured blocks, then titles, then task counts
- [x] Built as one new file in `js/views/` (plus its stylesheet), to prove the structure
- [ ] Test: read a real project's dependencies from the map
