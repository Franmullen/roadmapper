# Contributing to Roadmapper

Thanks for helping. Roadmapper is a [Celbridge](https://www.celbridge.org/) package, and this repository is a Celbridge project for building it. The maintainer's own roadmap (`plans/`) and agent guide (`CLAUDE.md`) are kept locally, out of git.

## Getting set up

1. Install Celbridge (1.7 or later) and Node.js 22 or later (only needed for the tests).
2. Clone this repository and open `Roadmapper.celbridge` in Celbridge. The package in `packages/roadmapper/` loads with the project.
3. To plan your own work, open `roadmapper.roadmap`; it reads a local `plans/` folder.

## Making a change

- **The code** is plain JavaScript modules, CSS and HTML, with no build step. `docs/architecture.md` describes how it fits together.
  - `js/model.js` and `js/agents.js` are pure and tested.
  - `js/actions.js` is the only module that reads or writes files.
  - Each view is one file in `js/views/` and one stylesheet in `css/views/`.
- **Trying it:** after changing the page's HTML, CSS or JS, reload the open `.roadmap` editor. After changing `package.toml` or `roadmapper.editor.toml`, reload the project.
- **Mock projects:** the shuffle button in `python.console` runs `mocks/make_mocks.py`, which writes thirty mock projects to `mocks/generated/` (ignored by git). Try write actions there.
- **Checks:** run `python scripts/check.py` (syntax, tests, architecture rules, the release zip). Logic changes in `model.js` or `agents.js` need a test. The same checks run on every push and pull request.
- **Drag and drop** uses pointer events (`js/drag.js`), because native HTML5 drag events don't reach Celbridge's web views from a real mouse.

A pull request that changes behaviour should update `packages/roadmapper/README.md`.

## Working with AI agents

**Agent guide** writes a Roadmap section into the project's `CLAUDE.md` that teaches an agent the plan format and how to work from it, and the board writes a summary for agents to `temp:roadmapper/`. If you change what agents are told (`js/agents.js`), check that an agent can still steer by it.

## Releasing

Bump `package-version` in `packages/roadmapper/package.toml`, then run `python scripts/package.py` to build `dist/roadmapper-<version>.zip`. Attach that zip to a GitHub release tagged `v<version>`.

## License

By contributing you agree that your contributions are licensed under the MIT License (see `LICENSE`).
