# Roadmapper

A [Celbridge](https://celbridge.org) package for planning work as milestones. Each milestone is a folder and each plan is a Markdown file in it. Roadmapper shows them as a board.

This repository is also a Celbridge project that plans Roadmapper with Roadmapper: open `Roadmapper.celbridge` in Celbridge, then open `roadmapper.roadmap`.

**Install:** download `roadmapper-<version>.zip` from the latest release, unzip it into your project's `packages/` folder, and reload the project. Or copy `packages/roadmapper/` from this repository. Then create a `.roadmap` file (New File → Roadmap). The [package README](packages/roadmapper/README.md) explains the rest.

- `packages/roadmapper/`: the package
- `plans/`: Roadmapper's own roadmap
- `mocks/make_mocks.py`: generates mock roadmaps for testing (`%run mocks/make_mocks.py` in the Python console)
- `scripts/package.py`: builds the release zip

Want to help? See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT licensed.
