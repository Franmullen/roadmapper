<!-- Forum post on celbridge.discourse.group (feature requests start on the forum). Status: draft, not posted. -->

# Notes from building a package: Roadmapper, a roadmap board over Markdown folders

Hi all. I've been learning Celbridge by building a community package, Roadmapper. It shows a folder of milestone folders and Markdown plan files as a road, a kanban board and a dependency map, writes every change back to the files, and teaches agents the format through CLAUDE.md. _[screenshot or GIF]_

**What made it easy**

- An editor is a manifest and plain HTML/JS/CSS, with no build step. Reloading the web view shows a change.
- `initializeDocument` handles loading, saving, external changes, renames and view state. I only fill in callbacks.
- File tools through `client.cel`, `watchFiles`, the theme tokens, icons and notifications covered everything else.
- The agent server is great for testing a package. An agent can screenshot the editor, read its console and run scripts in it, so I could check every change in the real app.
- `cel.agent.claude()` plus the built-in guides meant a restricted agent could read our roadmap and work from it with no extra setup. In a test it turned an old project's scattered TODO, roadmap and meeting notes into a working roadmap in about a minute.

**Three things that would help package authors** (happy to split these into separate threads):

1. **Packages contributing agent guides.** Guides are built into Celbridge, so a package can't tell agents about the files it owns. Roadmapper writes a section into the project's CLAUDE.md instead, which works for Claude Code but not for other agents. Could a package ship a guide (say a `guides/` folder named in package.toml) that `guides_read` serves and that auto-attaches when an agent first touches that package's file type?
2. **Finding the agent server from outside Celbridge.** I can see the random port is deliberate: it keeps instances from clashing, and the file server's comments guard against a browser page that finds the loopback port. So a fixed port is the wrong ask. But a client registered outside Celbridge (for example `claude mcp add` in an ordinary terminal) has to be re-registered after every restart. Would a small discovery file be reasonable, written to the user's profile with the current port per running instance? Web pages can't read it, and local programs could scan for the port anyway. Or is the intended route to always launch agents from the console with `cel.agent.claude()`?
3. **A minimum Celbridge version for packages.** Projects record `celbridge-version`, but I couldn't find a way for a package to say which version it needs (Roadmapper relies on the 1.7 editor API and tool names). That matters once packages are shared through the Workshop.

Thanks for Celbridge. It's been a fun and productive platform to learn on.
