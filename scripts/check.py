"""The quality gate: every check a change must pass, locally (Windows or not) and in CI.

    python scripts/check.py                 # everything
    python scripts/check.py --base main     # also warn about package changes with no plan change

Checks, in order: JavaScript syntax, the tests, the architecture rules below, and the release zip build.
Exits non-zero if any check fails.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = ROOT / 'packages' / 'roadmapper'
JS = PACKAGE / 'js'

IMPORT = re.compile(r"""^\s*import\b[^'"]*['"]([^'"]+)['"]""", re.MULTILINE)

# The architecture, as rules on what each module may import and use. See docs/architecture.md.
PURE = {'model.js', 'agents.js'}                 # pure logic: tested in Node, no browser or Celbridge
PURE_IMPORTS = {'model.js': set(), 'agents.js': {'./model.js'}}
BROWSER_ONLY = re.compile(r'\b(document|window|localStorage|fetch)\b\s*[.(]')
CELBRIDGE_CALL = re.compile(r'\.cel\.|\bclient\.cel\b|call\(\s*[\'"]')


def run(label, command):
    print(f'== {label}', flush=True)
    result = subprocess.run(command, cwd=ROOT)
    if result.returncode != 0:
        print(f'FAILED: {label}')
    return result.returncode == 0


def js_files():
    return sorted(JS.rglob('*.js'))


def syntax():
    ok = True
    for path in js_files():
        result = subprocess.run(['node', '--check', str(path)], cwd=ROOT, capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stderr.strip())
            ok = False
    print(f'== Syntax: {len(js_files())} files {"ok" if ok else "FAILED"}')
    return ok


def code_only(text):
    """The source without comments and strings, so rules only look at code."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    text = re.sub(r'//[^\n]*', '', text)
    return re.sub(r'`(?:\\.|[^`\\])*`|\'(?:\\.|[^\'\\])*\'|"(?:\\.|[^"\\])*"', "''", text)


def architecture():
    problems = []
    for path in js_files():
        rel = path.relative_to(JS).as_posix()
        source = path.read_text(encoding='utf-8')
        imports = IMPORT.findall(source)
        code = code_only(source)

        if rel in PURE:
            extra = set(imports) - PURE_IMPORTS[rel]
            if extra:
                problems.append(f'{rel} is pure and may not import {sorted(extra)}')
            if BROWSER_ONLY.search(code):
                problems.append(f'{rel} is pure and may not use the browser ({BROWSER_ONLY.search(code).group(0)})')
        if rel != 'actions.js' and CELBRIDGE_CALL.search(code):
            problems.append(f'{rel} calls Celbridge tools directly; only actions.js reads or writes files')
        if rel != 'main.js' and any(i.startswith('/assets/') for i in imports):
            problems.append(f'{rel} imports the Celbridge client; only main.js does')
        for i in imports:
            target = i.rsplit('/', 1)[-1]
            if target == 'main.js':
                problems.append(f'{rel} imports main.js; nothing may')
            if rel.startswith('views/') and target == 'actions.js':
                problems.append(f'{rel} imports actions.js; views act through ctx')

    # Every view in the toolbar list has a stylesheet.
    for view in re.findall(r"^import (\w+) from './\w+\.js';", (JS / 'views' / 'index.js').read_text(encoding='utf-8'), re.MULTILINE):
        if not (PACKAGE / 'css' / 'views' / f'{view}.css').exists():
            problems.append(f'views/{view}.js has no css/views/{view}.css')

    for problem in problems:
        print(f'  {problem}')
    print(f'== Architecture rules {"ok" if not problems else "FAILED"}')
    return not problems


def plan_changed(base):
    """A warning, not a failure: a change to the package usually delivers a plan, which should change too."""
    diff = subprocess.run(['git', 'diff', '--name-only', f'{base}...HEAD'], cwd=ROOT, capture_output=True, text=True)
    if diff.returncode != 0:
        print(f'== Plan check skipped (no base {base})')
        return
    files = diff.stdout.split()
    if any(f.startswith('packages/') for f in files) and not any(f.startswith('plans/') for f in files):
        print('== WARNING: the package changed but no plan did. Which plan does this deliver?')
    else:
        print('== Plan check ok')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--base', help='branch or commit to compare against for the plan check')
    args = parser.parse_args()

    results = [
        syntax(),
        run('Tests', ['node', '--test', *[str(p) for p in sorted((PACKAGE / 'tests').glob('*.test.mjs'))]]),
        architecture(),
        run('Release zip', [sys.executable, str(ROOT / 'scripts' / 'package.py')]),
    ]
    if args.base:
        plan_changed(args.base)

    if all(results):
        print('ALL CHECKS PASSED')
        return 0
    print('CHECKS FAILED')
    return 1


if __name__ == '__main__':
    sys.exit(main())
