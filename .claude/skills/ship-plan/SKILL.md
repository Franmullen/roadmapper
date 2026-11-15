---
name: ship-plan
description: How a plan in Roadmapper goes from ready to merged - branch, build, quality gate, fresh-context review, pull request, the owner's acceptance on the Reviews tab, merge. Use when starting or finishing any plan in plans/.
---

# Shipping a plan

The repository owner is the only person on this project. Agents build, the owner accepts. Reviews run locally; there is no paid review in GitHub.

1. **Start.** The plan should be ready (see the brief). Create `git switch -c plan/<plan-file-name>` from an up-to-date `main`. Set the plan's `status: doing` and `owner:`.
2. **Build** the smallest change that does the plan, and add tests for logic in `model.js` and `agents.js`. Keep unrelated changes out. Try UI changes on a mock board in Celbridge (see `CLAUDE.md`).
3. **Gate.** `python scripts/check.py --base main` must pass. Fix what you broke. If a failure was already there, say so.
4. **Review.** Start the `feature-reviewer` subagent with the plan path and `main` as the base. It runs in a fresh context and reads only. Check each finding against the code:
   - fix P0, P1 and justified P2 findings;
   - put P2s you won't fix in the PR under "Review findings deferred", or in `docs/debt.md` if they last;
   - ignore P3s.
   Then run the gate again. **Stop after two review-and-fix rounds.** If a P0 or P1 is still open, set the plan to `blocked` with the reason and tell the owner.
5. **Hand over.** Set the plan to `status: review`, with what the owner should try left as unticked `- [ ] Check: …` tasks. Commit that change, push, and run `gh pr create` using the template. Fill in the plan, what it does, what to check, and the findings. CI runs the same gate.
6. **Acceptance.** The owner reviews it on the Reviews tab, which writes to the plan file on the branch.
   - **Approve** (`status: done`, checks ticked): commit the plan file ("Approved on the board") and push. Then merge with `gh pr merge --squash --delete-branch`, and run `git switch main && git pull`. Main then carries the approval.
   - **Follow up** (back to `todo`, with `## Follow-ups`): commit the plan file, continue on the same branch, and repeat from step 3.
7. **Report** in a few lines: what shipped, the checks you ran and their results, findings fixed and deferred, and any risks left.

Never merge without the owner's approval on the board. Never skip the gate or the hooks.
