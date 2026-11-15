# Accepted debt

Known risks we have chosen to live with for now, with what would make us act. Architecture audits add to this list and close items.

| ID | What | Impact | Revisit when |
|---|---|---|---|
| D1 | **No UI tests.** Only `model.js` and `agents.js` are tested. Views, `main.js` and `actions.js` are checked by hand in Celbridge | UI regressions reach review unseen; most bugs so far were in the UI | Before going public (plan `ui-tests`) |
| D2 | **`main.js` holds many concerns** (lifecycle, watch, toolbar, render, state, commands) in about 500 lines | Each feature touches it; harder to review | It passes about 600 lines, or a feature needs a second toolbar mode |
| D3 | **Ideas and follow-ups are matched by text.** Removing or answering an idea finds the first unticked item with the same text | Two identical ideas: the wrong one may be removed or answered | People report duplicate ideas |
| D4 | **Approve ticks every remaining task,** not just the `Check:` tasks | A plan approved early looks complete | Reviews start approving partly done work |
| D5 | **The editor is still called "Roadmap Board"** (id `board`), though the Board view is gone | Naming confusion only | The next change to `roadmapper.editor.toml` (needs a project reload to test) |
| D6 | **Rendering rebuilds the whole view** on every scan | Fine at 30 mock projects; may lag on very large roadmaps | A roadmap of a few hundred plans feels slow |
