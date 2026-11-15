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
- [x] A Reviews tab with a badge: plans to review, the queue for the agent (with its questions and your answers), sent-back plans and blocked plans
- [x] Tried a restricted agent on a mock queue: it planned two items, asked about the unclear one, then used the answer
- [ ] Check: review our own v0.2 to v0.5 plans from the Reviews tab, sending back anything that needs more work
- [ ] Check: queue a few ideas, ask Claude in Celbridge to "process the queue", then "do the follow-ups"
