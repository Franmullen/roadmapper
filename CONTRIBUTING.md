# Contributing to Roadmapper

Thanks for helping. Roadmapper is a [Celbridge](https://www.celbridge.org/) package, and this repository is itself a Celbridge project that plans its own work with Roadmapper.

## Getting set up

1. Install Celbridge (1.7 or later) and Node.js 22 or later (only needed for the tests).
2. Clone this repository and open `Roadmapper.celbridge` in Celbridge. The package in `packages/roadmapper/` loads with the project.
3. Open `roadmapper.roadmap` to see the plan. Each plan in `plans/` describes one piece of work, so pick one that is ready (the Road and Map views show what is waiting on what).

## Making a change

- **The code** is plain JavaScript modules, CSS and HTML, with no build step. `CLAUDE.md` describes how it fits together.
  - `js/model.js` and `js/agents.js` are pure and tested.
  - `js/actions.js` is the only module that reads or writes files.
  - Each view is one file in `js/views/` and one stylesheet in `css/views/`.
- **Trying it:** after changing the page's HTML, CSS or JS, reload the open `.roadmap` editor. After changing `package.toml` or `roadmapper.editor.toml`, reload the project.
- **Mock projects:** the shuffle button in `python.console` runs `mocks/make_mocks.py`, which writes thirty mock projects to `mocks/generated/` (ignored by git). Try write actions there, not on `plans/`.
- **Tests:** run `node --test packages/roadmapper/tests/*.test.mjs`. Logic changes in `model.js` or `agents.js` need a test. The same tests run on every push and pull request.
- **Drag and drop** uses pointer events (`js/drag.js`), because native HTML5 drag events don't reach Celbridge's web views from a real mouse.

## Plans are part of the change

When you start a plan, set its `status: doing` and `owner:`. When you finish, tick its tasks and set `status: review`. Put work you discover into a new plan file rather than a comment. A pull request that changes behaviour should update the plan it delivers and `packages/roadmapper/README.md`.

## Working with AI agents

The Roadmap section of `CLAUDE.md` teaches an agent the plan format and how to work from it, and the board writes a summary for agents to `temp:roadmapper/`. If you change what agents are told (`js/agents.js`), check that a restricted agent can still steer by it. `CLAUDE.md` describes how.

## Releasing

Bump `package-version` in `packages/roadmapper/package.toml`, then run `python scripts/package.py` to build `dist/roadmapper-<version>.zip`. Attach that zip to a GitHub release tagged `v<version>`.

## License

By contributing you agree that your contributions are licensed under the MIT License (see `LICENSE`).
