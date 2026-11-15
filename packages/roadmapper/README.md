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

## Using the board

- **Click a card** to open its plan.
- **Drag a card** to another milestone to move its file into that folder. In the lanes view, dragging to another row also changes its `lane:`.
- **+ Add plan** in a column (or a lane cell) creates a plan file from a title.
- **+ Milestone** creates the next numbered folder with a README.
- **Lanes** switches to a grid of lanes (rows) by milestones (columns), for planning parallel work. **+ Lane** adds a lane, and the lane order is saved in the `.roadmap` file.
- **Click a milestone's title** to drill in: its description, due date and progress, and its plans grouped by status. Change a plan's status from its dropdown, or drag it to another status group.
- **Click a folder name** to show that folder in the Explorer.
- A due date turns red once it has passed and the milestone still has work left.

## AI agents

Press the 🤖 button on the toolbar to add a Roadmapper section to the project's `CLAUDE.md`. Claude Code reads that file, including when it's launched from Celbridge with `cel.agent.claude()`, so agents learn how to add milestones and plans, update statuses, tick tasks and reschedule work. Press it again after changing lanes to refresh the section. Everything outside its `<!-- roadmapper:start -->` / `<!-- roadmapper:end -->` markers is left alone.

## Development

- `js/scan.js` is the pure logic (settings, front matter, columns, templates, agent instructions). Test it with `node --test packages/roadmapper/tests/`.
- `js/board.js` is the editor: document lifecycle, file watch, rendering, drag and drop, and file writes through the `celbridge-client` API.

## License

MIT
