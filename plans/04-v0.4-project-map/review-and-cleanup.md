---
status: done
lane: core
---
# Architecture review and clean-up

An adversarial review of v0.3 before adding more views, and fixes for what it found.

## Tasks

- [x] One pass over the folder tree (`scanTree`), with no throwaway first build of the project
- [x] One way to call Celbridge tools and report failures (`call`, `attempt` in actions.js)
- [x] Drop decisions as a tested pure function; refuse a colliding move before writing anything
- [x] Scan failures show a message instead of failing silently
- [x] Switching views no longer rewrites the shared `.roadmap` file
- [x] Each view has its own stylesheet, so a view really is its own files
- [x] Front matter keeps block lists intact, and keys match exactly
