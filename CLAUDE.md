# Roadmapper

A Celbridge package (`packages/roadmapper/`) that shows milestone folders of Markdown plans as a board. This repository is also the Celbridge project used to develop it, and it plans its own work with Roadmapper (`roadmapper.roadmap` over `plans/`).

## Development

- `packages/roadmapper/js/scan.js` holds all pure logic (settings, front matter, folder tree to columns, templates, agent instructions). Keep Celbridge calls out of it, and cover changes with `node --test packages/roadmapper/tests/`.
- `packages/roadmapper/js/board.js` is the editor page: document lifecycle, file watch, rendering, drag and drop, and every write to plan files, all through the `celbridge-client` API.
- Celbridge only discovers packages when a project loads. A change to `package.toml` or `*.editor.toml` needs a project reload. A change to the page's HTML, CSS or JS needs only a reload of the editor (`webview_reload` on the open `.roadmap` document).
- To check the editor in the running app, use the Celbridge MCP tools: `webview_screenshot`, `webview_get_console` and `webview_eval` on the open `.roadmap` document.
- Test write actions on a mock board (`mocks/generated/*.roadmap`, rebuilt by `%run mocks/make_mocks.py`), not on `plans/`.
- Bump `package-version` in `packages/roadmapper/package.toml` with each release.

<!-- roadmapper:start -->
## Roadmap (Roadmapper)

This project plans its work with Roadmapper. The plan is the Markdown under `plans/`. `roadmapper.roadmap` only holds board settings, so do not edit it to change the plan.

- **Milestones** are the folders directly inside `plans/`, ordered by a number prefix (`01-…`, `02-…`). To add one, create the next numbered folder with a `README.md` whose `# heading` names it, whose first paragraph describes it, and whose front matter may set `due: YYYY-MM-DD`.
- **Plans** are the other `.md` files in a milestone folder, one per piece of work. Start each with a `# Title` and list steps as `- [ ]` checkboxes.
- **Front matter** on a plan sets `status:` (one of `todo`, `doing`, `review`, `done`, `blocked`) and `lane:` (a parallel workstream; current lanes: `core`, `ui`, `agents`, `community`).
- **When you work on a plan**, set `status: doing`, tick each checkbox (`- [x]`) as you finish it, and set `status: done` when all of it is complete. Use `status: blocked` with a sentence saying why.
- **To reschedule** a plan, move its file into another milestone folder. Keep file names lower-case with hyphens.
- The board updates by itself when these files change.
<!-- roadmapper:end -->
