# Architecture

Roadmapper is a Celbridge package: a custom editor for `.roadmap` files, written as plain JavaScript modules, CSS and HTML, with no build step. It runs in a Celbridge web view, and reads and writes the project's files only through the `celbridge-client` API. Line counts below are as of v0.5 (about 2,900 lines of JS).

## Modules

| Module | Role | May import |
|---|---|---|
| `js/model.js` (666) | The file conventions as pure functions: settings, front matter, statuses, the folder tree to a project of milestones and plans, dependencies, focus, reviews, ideas, templates | nothing |
| `js/agents.js` (200) | Text for agents: the CLAUDE.md guide and the brief. Pure | `model.js` |
| `js/actions.js` (223) | Every read and write, through `cel.*` tools. Reports its own failures and never throws, except `loadProject` | `model.js`, `agents.js` |
| `js/main.js` (502) | The entry point: document lifecycle (load, save, state), file watch and rescan, toolbar, view switching, the `commands` that views call | everything, plus the Celbridge client |
| `js/ui.js` (269) | Shared DOM pieces (status, chips, review controls, inline prompt) | `model.js` |
| `js/views/*.js` | One view each (Road, Map, Reviews, Ideas, and the Milestone detail), with `css/views/<id>.css` | `model.js`, `ui.js` |
| `js/viewport.js`, `js/drag.js` | Pan and zoom; pointer-event drag and drop | nothing |

`scripts/check.py` enforces the rules that matter:
- `model.js` and `agents.js` stay pure, with no browser and no Celbridge, so Node can test them.
- Only `actions.js` calls Celbridge tools.
- Only `main.js` imports the Celbridge client.
- Nothing imports `main.js`.
- Views never import `actions.js`.
- Every view has a stylesheet.

## Data flow

- **Read:** the file watch (or Refresh) calls `scan()`. That calls `actions.loadProject`, which runs `file.getTree`, then `file.readMany` on the READMEs, plans and `ideas.md`, then `model.buildProject`. Then `render()` hands the project, or `focusProject(project)`, and a `ctx` to the current view, which rebuilds its DOM from scratch.
- **Write:** a view calls a `ctx` command, such as `ctx.approvePlan`. `main.js` runs the action through `act()`, which writes the file and rescans at once. The watch also fires, so writes from elsewhere (git, an agent, an editor) show up the same way.
- **Agents:** after every scan, `actions.writeBrief` writes `temp:roadmapper/<name>.md`, but only when the text changed. **Agent guide** writes the guide section into `CLAUDE.md`.
- **Settings:** the `.roadmap` file holds only `root`, `lanes` and the first-open `view`. Per-editor state (view, show all, zoom, open milestone) lives in Celbridge's editor state, not in the file.

## Invariants

- The files are the source of truth. The model is rebuilt from them on every scan, and nothing is cached across scans except the last good project.
- Writes read the file fresh and change only what they mean to (`setFrontMatter` keeps other lines, `addIdeas` appends), so concurrent edits by agents survive.
- `render()` waits while an inline input is focused or a drag is in progress. Fields marked `data-keep-focus` keep their text across renders.

## Decisions

- **No build step, no npm dependencies.** Packages are copied as folders, and plain modules load directly in the web view. The trade-off is that there's no TypeScript or linting beyond `node --check`.
- **Front matter, not Celbridge `.cel` sidecars,** so plans stay portable and readable in git.
- **Pointer events for drag and drop,** because native HTML5 drag never fires from a real mouse in Celbridge web views.
- **Agents steer through files** (the guide, the brief, `ideas.md`, plan statuses), because packages cannot launch agents or run commands.
- **The person in the loop works on two tabs:** Reviews (acceptance) and Ideas (intake). Code quality is checked separately, by `scripts/check.py` and a fresh-context reviewer (see `CLAUDE.md`).

Known debt is in [debt.md](debt.md).
