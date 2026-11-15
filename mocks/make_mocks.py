"""Generate mock planning folders to try the Roadmapper on.

Run it from the Celbridge Python console:

    run mocks/make_mocks.py            # the fixed shapes plus 24 random projects
    run mocks/make_mocks.py 40         # the fixed shapes plus 40 random projects

Everything goes in mocks/generated/, which is deleted and rebuilt on each run, so do not keep
your own files there. Each mock gets a .roadmap file next to its folder: open one to see it.
"""

import random
import shutil
import sys
from pathlib import Path

try:
    HERE = Path(__file__).resolve().parent
except NameError:
    HERE = Path.cwd() / "mocks"

OUT = HERE / "generated"
SEED = 1234

THEMES = {
    "roadmapper": {
        "milestones": ["prototype", "first-release", "status-and-lanes", "dependencies", "timeline-view",
                       "agent-workflow", "workshop-publish", "polish"],
        "items": ["read folder tree", "card per markdown file", "drag to move file", "live refresh",
                  "status front matter", "lanes per workstream", "WIP limit", "depends-on links",
                  "due dates", "overdue warnings", "status view", "filter box", "keyboard navigation",
                  "create card from board", "create milestone folder", "rename milestone",
                  "localize strings", "dark theme pass", "agent prompt for card", "board summary report",
                  "publish to workshop", "README and screenshots", "performance with 500 files"],
    },
    "space-shooter": {
        "milestones": ["vertical-slice", "core-loop", "enemies", "bosses", "audio", "ui", "beta", "launch"],
        "items": ["ship movement", "shooting", "enemy waves", "power-ups", "boss patterns", "score table",
                  "pause menu", "settings screen", "music loop", "sound effects", "particle effects",
                  "controller input", "touch controls", "save high score", "achievements", "trailer",
                  "store page", "playtest round", "balance pass", "bug bash"],
    },
    "recipe-web-app": {
        "milestones": ["discovery", "mvp", "accounts", "search", "sharing", "mobile", "v1"],
        "items": ["data model", "recipe page", "ingredient parser", "sign-up flow", "password reset",
                  "full text search", "tag filters", "shopping list", "share links", "print view",
                  "responsive layout", "offline cache", "analytics", "privacy policy", "load testing",
                  "image uploads", "meal planner"],
    },
    "data-pipeline": {
        "milestones": ["spike", "ingest", "transform", "quality", "orchestration", "reporting"],
        "items": ["source inventory", "csv loader", "api loader", "schema checks", "dedupe step",
                  "currency normalisation", "null handling", "unit tests", "airflow dag", "retry policy",
                  "alerting", "dashboard", "backfill", "cost review", "runbook"],
    },
}

HEADINGS = ["Goal", "Scope", "Approach", "Open questions", "Notes"]


def slug(text):
    return "-".join("".join(ch if ch.isalnum() else " " for ch in text.lower()).split())


def plan_markdown(rng, title, style, depends=()):
    """One plan file. The style decides what conventions the file follows; `depends` names other plans."""
    lines = []
    if style in ("frontmatter", "chris") and (depends or rng.random() < 0.7):
        status = rng.choice(["todo", "doing", "review", "done", "blocked"])
        lines += ["---", f"status: {status}", f"lane: {rng.choice(['core', 'ui', 'infra', 'agent-a', 'agent-b'])}"]
        if depends:
            lines.append(f"depends: {', '.join(depends)}")
        lines += ["---", ""]
    if style != "no-heading":
        lines += [f"# {title[:1].upper() + title[1:]}", ""]
    lines += [f"Plan for {title}.", ""]
    for heading in rng.sample(HEADINGS, rng.randint(1, 3)):
        lines += [f"## {heading}", "", "Details to be written.", ""]
    if rng.random() < 0.75:
        lines += ["## Tasks", ""]
        for i in range(rng.randint(1, 8)):
            mark = "x" if rng.random() < 0.45 else " "
            lines.append(f"- [{mark}] step {i + 1}")
        lines.append("")
    return "\n".join(lines)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_board(name, root):
    write(OUT / f"{name}.roadmap", '{\n  "root": "%s"\n}\n' % root.relative_to(HERE.parent).as_posix())


def make_project(rng, name, theme, n_milestones, items_per, style="plain", loose=0, empty=0, nested=False):
    root = OUT / name
    spec = THEMES[theme]
    milestones = spec["milestones"][:n_milestones]
    pool = list(spec["items"])
    rng.shuffle(pool)

    written = []  # plan names so far, for depends: links back to earlier work
    for index, milestone in enumerate(milestones, start=1):
        folder = root / f"{index:02d}-{milestone}"
        folder.mkdir(parents=True, exist_ok=True)
        if index > n_milestones - empty:
            continue
        if style == "chris":
            write(folder / "README.md", f"# Milestone {index}: {milestone.replace('-', ' ')}\n\nGoal and dates.\n")
        count = items_per if isinstance(items_per, int) else rng.randint(*items_per)
        for i in range(count):
            title = pool[(index * 7 + i) % len(pool)]
            sub = folder
            if nested and rng.random() < 0.4:
                sub = folder / rng.choice(["design", "build", "test"])
            plan_name = f"{slug(title)}-{i + 1}"
            depends = []
            if written and style in ("frontmatter", "chris") and rng.random() < 0.35:
                depends = rng.sample(written, min(len(written), rng.randint(1, 2)))
                if rng.random() < 0.08:
                    depends.append("not-written-yet")  # a broken link, to show how one is flagged
            write(sub / f"{plan_name}.md", plan_markdown(rng, title, style, depends))
            written.append(plan_name)
        if rng.random() < 0.3:
            write(folder / "sketch.txt", "Not a markdown file, so not a card.\n")

    for i in range(loose):
        write(root / f"idea-{i + 1}.md", plan_markdown(rng, f"loose idea {i + 1}", style))

    make_board(name, root)


def main():
    extra = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 24
    rng = random.Random(SEED)

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    # Fixed shapes, each testing one aspect of the layout.
    make_project(rng, "a-tiny", "roadmapper", 3, 2)
    make_project(rng, "b-this-project", "roadmapper", 8, (1, 5), style="frontmatter", loose=2)
    make_project(rng, "c-wide-8", "space-shooter", 8, (0, 3), empty=2)
    make_project(rng, "d-deep-40", "recipe-web-app", 2, 40)
    make_project(rng, "e-chris-style", "data-pipeline", 6, (2, 6), style="chris", nested=True)
    make_project(rng, "f-messy", "space-shooter", 5, (0, 4), style="no-heading", loose=5, empty=1, nested=True)

    # An older project with notes in its own shapes, for trying out turning notes into a roadmap.
    # Its .roadmap points at a plans/ folder that does not exist until someone (or an agent) creates it.
    shutil.copytree(HERE / "fixtures" / "old-game", OUT / "old-game")
    make_board("old-game", OUT / "old-game" / "plans")

    # Random projects, a few dozen variations on the same structure.
    for n in range(1, extra + 1):
        theme = rng.choice(list(THEMES))
        make_project(
            rng, f"r{n:02d}-{theme}", theme,
            n_milestones=rng.randint(2, len(THEMES[theme]["milestones"])),
            items_per=(0, rng.randint(2, 9)),
            style=rng.choice(["plain", "frontmatter", "chris", "no-heading"]),
            loose=rng.choice([0, 0, 0, 1, 3]),
            empty=rng.choice([0, 0, 1]),
            nested=rng.random() < 0.3,
        )

    boards = sorted(OUT.glob("*.roadmap"))
    files = sum(1 for _ in OUT.rglob("*.md"))
    print(f"Wrote {len(boards)} mock boards with {files} plan files to {OUT.relative_to(HERE.parent).as_posix()}/")
    print("Open any .roadmap file in mocks/generated/ to view it.")


main()
