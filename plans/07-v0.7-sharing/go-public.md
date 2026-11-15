---
status: todo
lane: community
depends: celbridge-feedback, ui-tests
---
# Go public

Make the repository public, so it can be shared and contributed to, and so branch protection and code scanning are free.

## Tasks

- [ ] Decide what goes public: `plans/` (shows Roadmapper planning itself) and `CLAUDE.md`
- [ ] Remove anything private from the history. The Celbridge feedback drafts were committed before they moved to `scratch/`, so rewrite the history or publish a fresh repository
- [ ] Make it public, then protect `main`: require the Checks workflow, no force pushes
- [ ] Turn on CodeQL code scanning and secret scanning
