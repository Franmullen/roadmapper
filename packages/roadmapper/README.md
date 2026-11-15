# Roadmapper

A Celbridge package for planning work as milestones. Each milestone is a folder and each plan is a Markdown file inside it. Roadmapper shows them as a board you can organise.

There's no separate database: **your folders and Markdown files are the plan**. Every change on the board is written back to those files, and every change to the files, whether by you, git or an AI agent, shows up on the board straight away.

## Set up

1. Copy this folder into your project's `packages/` folder and reload the project.
2. Create a `.roadmap` file (New File → Roadmap), or write one by hand:

   ```json
   {
     "root": "plans"
   }
   ```

   Optional settings: `"lanes": ["core", "ui"]` sets the lane order (**+ Lane** on the board adds to it). `"view": "road"`, `"board"` or `"map"` and `"showLanes": true` choose how the board first opens; after that, each editor remembers its own view without changing the file.

3. Open it. If the folder is empty, use **+ Milestone** to start.

## How files map to the board

```
plans/
  01-prototype/
    README.md            ← describes the milestone (title, due date, description)
    board-view.md        ← a plan
    design/sketches.md   ← plans can sit in subfolders too
  02-first-release/
    README.md
    status-field.md
  idea.md                ← loose files show in an "Unsorted" column
```

| On the board | In your files |
|---|---|
| Milestone column | A subfolder of the root, ordered by name (`01-`, `02-`… set the order and are hidden from the title) |
| Milestone title, description, due date | The folder's `README.md`: its `# heading`, first paragraph and `due: YYYY-MM-DD` front matter |
| Plan card | Any other `.md` file in the milestone folder |
| Card title | `title:` front matter, else the first `# heading`, else the file name |
| Status | `status:` front matter: `todo`, `doing`, `review`, `done` or `blocked`. Without it, the checkboxes decide: none ticked is To do, some is Doing, all is Done. |
| Lane | `lane:` front matter |
| Owner | `owner:` front matter: who is working on it, a person or an agent |
| Dependencies | `depends:` front matter, naming the plans that must be done first (see below) |
| Task progress | The `- [ ]` / `- [x]` checkboxes |

A plan file looks like this:

```markdown
---
status: doing
lane: ui
---
# Drag cards between lanes

## Tasks

- [x] Drop target per lane cell
- [ ] Write the lane into front matter
```

### Dependencies

`depends:` lists the plans this one needs first, by file name without `.md` (`login`), or by path inside the root (`02-beta/login`) when the name is not unique. Any of these forms works:

```yaml
depends: login, 02-beta/api
depends: [login, 02-beta/api]
depends:
  - login
  - 02-beta/api
```

Cards show what a plan is waiting on. A dependency is flagged in red when no plan has that name, when more than one does, or when it is scheduled in a later milestone than the plan that needs it.

## Views

- **Road** (the default): the milestones as stops along a road, in order. Each stop shows its due date, plans done, a bar split by status, the lanes involved and its plans. A **Today** marker sits between the milestones due before and after today. Overdue stops turn red and finished ones show a tick. Click a plan to open its file, or drag it to another stop to move it there. Click a stop's title to open that milestone.
- **Board**: a column per milestone with its plan cards, or the lanes grid when **Lanes** is on.
- **Map**: the whole project at once. Lanes are bands, milestones are columns and each plan is a node, with arrows from each plan to the plans that depend on it. Hover a plan to pick out its links; click it to open it. Zoomed out, plans become coloured blocks; zoom in for titles and task counts.
- **Milestone**: one milestone's plans grouped by status, with links to each plan's dependencies. Use **Back** or Escape to return.

**Focus:** by default the views show work now and next: the milestones from the first unfinished one through the one after the last with work started, without their finished plans. A "✓ N done" note stands in for finished plans, and on the Road, collapsed stretches stand in for hidden milestones. **Show all** on the toolbar shows everything; the editor remembers which you chose.

Road, Board and Map pan and zoom, so any size of project fits on screen:

- Ctrl+wheel (or pinch) zooms at the pointer; the wheel and dragging the background pan.
- The controls in the corner (or the keys `-`, `+` and `0`) zoom out, zoom in and fit to the screen. Click the percentage to return to 100%.
- A view keeps fitting itself to the window until you move it, and each view remembers its own zoom.

## Using the board

- **Click a card** to open its plan.
- **Drag a card** to another milestone to move its file into that folder. In the lanes view, dragging to another row also changes its `lane:`.
- **+ Add plan** in a column (or a lane cell) creates a plan file from a title.
- **+ Milestone** creates the next numbered folder with a README.
- **Lanes** switches the Board to a grid of lanes (rows) by milestones (columns), for planning parallel work. **+ Lane** adds a lane, and the lane order is saved in the `.roadmap` file.
- **Click a milestone's title** to drill in: its description, due date and progress, and its plans grouped by status. Change a plan's status from its dropdown, or drag it to another status group.
- **Click a folder name** to show that folder in the Explorer.
- A due date turns red once it has passed and the milestone still has work left.

### Reviewing work

A plan in `review` shows two buttons on the Road, the Board and the milestone view. The milestone view also lists what is left to check: the plan's unticked tasks.

- **Approve** sets `status: done` and ticks the remaining tasks.
- **Follow up** asks for what still needs doing (separate several with `;`). Each one becomes an unticked task under a `## Follow-ups` heading in the plan, and the plan goes back to `todo`. The board marks it "N follow-ups", and the agent brief lists it first, so an agent picks it up before new work.

A good loop is to review on the board, send back what needs work, and then ask an agent to "do the follow-ups".

## AI agents

An agent steers by the roadmap through files alone; there is nothing to click.

- **Agent guide** on the toolbar adds a Roadmapper section to the project's `CLAUDE.md`, which Claude Code reads, including when it's launched from Celbridge with `cel.agent.claude()`. The section explains the format, how to read the roadmap, and how to work from it: do any review follow-ups first, pick a ready plan, set `status: doing` and `owner:`, tick tasks as they're done, and finish in `review` with what to check left as unticked tasks. Press it again after changing lanes. Everything outside its `<!-- roadmapper:start -->` / `<!-- roadmapper:end -->` markers is left alone.
- **The brief:** while a board is open, it keeps a short summary in Celbridge's `temp:roadmapper/` folder (local to your machine, never committed). It lists the milestones, plans sent back from review, what's in progress, what's ready to start, what's waiting or blocked, and broken dependencies, so an agent can understand the roadmap in one read.

So you can simply ask an agent things like:

- "Where does this project stand, and what's next?"
- "Take the next ready plan in the ui lane."
- "Plan out the v0.3 milestone."
- "Turn the TODO and ROADMAP notes in this project into a roadmap."

In tests with the restricted agent `cel.agent.claude()` launches, it answered "where do we stand" from the brief in four steps. It also turned a project's scattered TODO, roadmap, changelog and meeting notes into a working roadmap of 4 milestones and 18 plans, with dependencies, in about a minute.

## Development

- `js/agents.js` turns the model into text for agents: the CLAUDE.md section and the brief. It is pure and tested too.
- `js/model.js` is the pure logic: settings, front matter, statuses, dependencies, the project model built from the folder tree, and templates. Test it with `node --test packages/roadmapper/tests/*.test.mjs`.
- `js/actions.js` makes every read and write through the `celbridge-client` API.
- `js/views/` holds one file per view, with its styles in `css/views/<id>.css`. Each exports `{ id, label, icon, zoomable, fitAlign, render(container, project, ctx), mounted? }` and only draws; add a view by adding those two files and listing it in `views/index.js`. `css/roadmapper.css` holds what every view shares.
- `js/viewport.js` (pan and zoom), `js/drag.js` (pointer-event drag and drop; native HTML5 drag doesn't work in Celbridge's WebView) and `js/ui.js` (shared pieces such as cards and chips) are used by the views.
- `js/main.js` is the editor itself: document lifecycle, file watch, toolbar and view switching. Views call back through one `ctx` of commands; they never touch files or editor state directly.

## License

MIT
