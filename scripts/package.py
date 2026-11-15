"""Build the release zip of the Roadmapper package: dist/roadmapper-<version>.zip.

The zip holds one folder, roadmapper/, ready to drop into a Celbridge project's packages/ folder.
Tests are left out. Run from the repository root, or from the Celbridge console with
%run scripts/package.py
"""

import re
import sys
import zipfile
from pathlib import Path

try:
    REPO = Path(__file__).resolve().parent.parent
except NameError:
    REPO = Path.cwd()

PACKAGE = REPO / "packages" / "roadmapper"
DIST = REPO / "dist"
LEAVE_OUT = {"tests"}


def package_version():
    text = (PACKAGE / "package.toml").read_text(encoding="utf-8")
    match = re.search(r'^package-version\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        sys.exit("package.toml has no package-version")
    return match.group(1)


def main():
    version = package_version()
    DIST.mkdir(exist_ok=True)
    target = DIST / f"roadmapper-{version}.zip"
    files = sorted(path for path in PACKAGE.rglob("*")
                   if path.is_file() and not LEAVE_OUT & set(path.relative_to(PACKAGE).parts))
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, Path("roadmapper") / path.relative_to(PACKAGE))
    print(f"Wrote {target.relative_to(REPO)} with {len(files)} files (version {version}).")


main()
