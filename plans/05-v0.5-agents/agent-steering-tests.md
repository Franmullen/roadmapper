---
status: done
lane: agents
depends: agent-work-loop
---
# Test that agents can steer by the roadmap

Run the same restricted agent `cel.agent.claude()` launches (Celbridge tools only), with no hints in the prompt.

## Tasks

- [x] "Where does this project stand?": read the brief first and answered correctly in 4 turns, and noticed work no plan covered
- [x] Turn `mocks/generated/old-game`'s notes into a roadmap: 4 milestones, 18 plans, dependencies from the notes' wording, finished work marked done; checked its own result on the board
- [x] A fixture for the conversion test (`mocks/fixtures/old-game`), and the recipe in CLAUDE.md
- [x] Test: in Celbridge, ask Claude to take the next ready plan and see it claim it on the board
