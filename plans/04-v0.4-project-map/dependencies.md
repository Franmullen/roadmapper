---
status: done
lane: core
---
# Dependencies between plans

A `depends:` list naming other plan files. Flag a plan whose dependency is unfinished or scheduled in a later milestone.

## Tasks

- [x] `depends:` as `a, b`, `[a, b]` or a block list, by file name or path inside the root
- [x] Flag dependencies that are missing, ambiguous, or scheduled in a later milestone
- [x] "Waits on" chip on cards and on the Road; links to each dependency in the milestone view
- [x] The agent guide explains `depends:`
- [x] Test: add a dependency by hand and by asking Claude
