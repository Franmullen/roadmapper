# Roadmapper

A Celbridge package that shows a folder of Markdown planning files as a board of milestones.

There's no separate database: **your folders and Markdown files are the plan**. Each milestone is a folder and each plan is a `.md` file inside it. The board is a live view over them, so plans stay plain files that people, git and AI agents can all read and edit.

## Use it

1. Copy this folder into your project's `packages/` folder and reload the project.
2. Create a `.roadmap` file (New File → Roadmap), or write one by hand:

   ```json
   {
     "root": "plans"
   }
   ```

3. Lay out your plans:

   ```
   plans/
     01-prototype/
       board-from-folders.md
       drag-to-move.md
     02-first-release/
       status-field.md
     idea.md              ← loose files show in an "Unsorted" column
   ```

| On the board | In your files |
|---|---|
| A column | A subfolder of the root, ordered by name (`01-`, `02-`… prefixes set the order and are hidden from the title) |
| A card | A `.md` file anywhere below that subfolder |
| Card title | The file's first `# heading`, or the file name |
| Progress bar | The `- [ ]` / `- [x]` checkboxes in the file |
| Click a card | Opens the file |
| Drag a card to another column | Moves the file into that folder (Explorer undo reverts it) |
| Click a column's folder name | Shows the folder in the Explorer |

The board updates by itself whenever files under the root change, including edits made by agents or scripts.

## For AI agents

To plan work, create or move Markdown files under the board's root folder. Use one folder per milestone and one file per plan, start each file with a `# Title`, and track steps as `- [ ]` checkboxes. Tick them (`- [x]`) as work completes. Don't edit the `.roadmap` file to change the plan: it only names the root folder.

## Development

- `js/scan.js` is pure logic (folder tree → columns, Markdown → card summary). Test it with `node --test packages/milestone-board/tests/`.
- `js/board.js` is the editor: document lifecycle, file watch, rendering and drag-and-drop, all through the `celbridge-client` API.

## License

MIT
