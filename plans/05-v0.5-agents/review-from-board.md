---
status: review
lane: agents
owner: claude
depends: agent-work-loop
---
# Review from the board

Run reviews from the board, then hand what's left back to an agent. A plan in review gets **Approve** (done, remaining tasks ticked) and **Follow up** (new tasks under `## Follow-ups`, back to todo). Sent-back plans head the agent brief, and the guide tells agents to do them first.

## Tasks

- [x] `approveReview` and `addFollowUps` in the model, with the open tasks and follow-ups read into each plan
- [x] Approve and Follow up on the Road, the Board and the milestone view; the milestone view lists what is left to check
- [x] "N follow-ups" chip, a "Sent back from review" section in the brief, and the guide's "follow-ups come first"
- [x] Tried on a mock board: both buttons write the file as expected, and the brief updates
- [x] A Reviews tab (just the reviews, with what approving unblocks) and an Ideas tab (jot ideas, optionally aimed at a milestone or lane; the agent's questions and your replies)
- [x] A proper follow-up box: one follow-up per line, Ctrl+Enter sends
- [x] Tried a restricted agent on mock ideas: it planned two, asked about the unclear one, then used the answer
- [ ] Check: review our own v0.2 to v0.5 plans from the Reviews tab, sending back anything that needs more work
- [ ] Check: jot a few ideas, ask Claude in Celbridge to "process the ideas", then "do the follow-ups"
