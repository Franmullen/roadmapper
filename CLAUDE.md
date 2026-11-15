# Roadmapper

A Celbridge package (`packages/roadmapper/`) that shows milestone folders of Markdown plans as a board. This repository is also the Celbridge project used to develop it, and it plans its own work with Roadmapper (`roadmapper.roadmap` over `plans/`).

## Development

- `packages/roadmapper/js/model.js` holds the file conventions as pure logic (settings, front matter, statuses, dependencies, the project model from the folder tree, templates). `js/agents.js` turns that model into text for agents: the CLAUDE.md guide and the brief. Keep Celbridge calls out of both, and cover changes with `node --test packages/roadmapper/tests/*.test.mjs`.
- `packages/roadmapper/js/actions.js` makes every read and write through the `celbridge-client` API. Views in `js/views/` (one file each, plus `css/views/<id>.css`, listed in `views/index.js`) only draw; `main.js` handles the document lifecycle, file watch, toolbar and view switching.
- Use pointer events for drag and drop (`js/drag.js`): native HTML5 drag events never fire from a real mouse in Celbridge WebViews.
- Celbridge only discovers packages when a project loads. A change to `package.toml` or `*.editor.toml` needs a project reload. A change to the page's HTML, CSS or JS needs only a reload of the editor (`webview_reload` on the open `.roadmap` document).
- To check the editor in the running app, use the Celbridge MCP tools: `webview_screenshot`, `webview_get_console` and `webview_eval` on the open `.roadmap` document.
- Test write actions on a mock board (`mocks/generated/*.roadmap`, rebuilt by `%run mocks/make_mocks.py`), not on `plans/`.
- After changing the agent guide (`agents.js`), press **Agent guide** on the board to refresh the section below, then check that an agent can still steer by it. Run a restricted agent like `cel.agent.claude()` does, from the repo root, and give it a plain question ("Where does this project stand?") or the conversion task on `mocks/generated/old-game` (built from `mocks/fixtures/old-game`): `claude -p "..." --strict-mcp-config --mcp-config .mcp.json --tools "WebFetch,WebSearch" --allowedTools "mcp__celbridge__*"`.
- Bump `package-version` in `packages/roadmapper/package.toml` with each release, and build the release zip with `python scripts/package.py`.

<!-- roadmapper:start -->
## Roadmap (Roadmapper)

This project plans its work with Roadmapper. The plan is the Markdown under `plans/`. `roadmapper.roadmap` only holds board settings, so do not edit it to change the plan.

### Reading the roadmap

- **The brief:** `temp:roadmapper/roadmapper.md` summarises milestones, work in progress, what is ready to start, what is waiting or blocked, and broken dependencies. The board rewrites it whenever the plans change, so it may be missing or stale while the board is closed.
- **Everything in one search:** `file_grep` for `^(status|lane|owner|depends|due):|^# ` under `plans/` returns every plan's title and front matter.

### The format

- **Milestones** are the folders directly inside `plans/`, ordered by a number prefix (`01-…`, `02-…`). Each has a `README.md` whose `# heading` names it, whose first paragraph describes it, and whose front matter may set `due: YYYY-MM-DD`.
- **Plans** are the other `.md` files in a milestone folder, one per piece of work, with a `# Title` and steps as `- [ ]` checkboxes.
- **Plan front matter:** `status:` (one of `todo`, `doing`, `review`, `done`, `blocked`; without it the checkboxes decide), `lane:` (a parallel workstream; current lanes: `core`, `ui`, `agents`, `community`), `owner:` (who is working on it), and `depends:`.
- **Dependencies:** `depends: other-plan, 02-beta/login` names plans that must be done first, by file name (without `.md`) or by path inside the root. Keep a dependency in the same milestone or an earlier one.
- To **reschedule** a plan, move its file into another milestone folder. Keep file names lower-case with hyphens. The board updates by itself when files change.

A plan, for example `plans/02-beta/search.md`:

```markdown
---
status: todo
lane: core
depends: api
---
# Search

What this delivers, in a sentence or two.

## Tasks

- [ ] Index the records
- [ ] Search box with results
```

### Working from the roadmap

- **Follow-ups come first.** A person reviewing on the board can send a plan back: it returns to `status: todo` with unticked tasks under `## Follow-ups`. Do those before new work, then return the plan to review.
- **Pick work** that is ready: `status: todo` with every dependency done, in the earliest unfinished milestone, in your lane if you were given one.
- **Before you start**, set `status: doing` and `owner:` to your name, so people and other agents can see it is taken.
- **As you go**, tick each checkbox (`- [x]`) when it is finished. Work you discover becomes a new plan file in the milestone where it belongs.
- **When it is all done**, set `status: review` if a person should check it, otherwise `done`. Leave what the person should check as unticked `- [ ] Check: …` tasks; the board shows them to the reviewer. If you cannot continue, set `status: blocked` and add a sentence saying why.

### The queue

`plans/queue.md` holds ideas and requests a person has lined up, as `- [ ]` items. When asked to process the queue (or the inbox, or the todo list), take each unticked item in order:

- Turn it into work on the roadmap: a new plan in the milestone where it belongs, new tasks on an existing plan, or a new milestone if nothing fits. Write tasks a person can check, and set `lane:` and `depends:` where they are clear.
- Then tick the item and add where it went, e.g. `- [x] Dark mode → plans/03-polish/dark-mode.md`.
- If an item is too unclear to plan, leave it unticked and add an indented line under it with your question.

Processing the queue only plans the work. Do the work too only when asked, working from the roadmap as above.

### Presenting or building a roadmap

- **Where do we stand?** Answer from the roadmap: each milestone with its progress and due date, what is in progress, what is ready next, and anything blocked, overdue or broken.
- **Turning older notes into a roadmap** (TODO lists, a ROADMAP.md, a changelog): group the work into milestones in delivery order, write one plan per piece of work with its steps as tasks, mark finished work `done` with its tasks ticked, and add `depends:` where order matters. Propose the milestones before creating files, keep the old notes, and report anything you could not place.
<!-- roadmapper:end -->
