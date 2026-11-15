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

# Static imports, re-exports (export ... from) and dynamic import('...').
IMPORT = re.compile(r"""^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]""", re.MULTILINE)

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


# A `/` starts a regex literal (not a division) after one of these characters or keywords.
REGEX_BEFORE = set('(,=:[!&|?{};+-*%<>~^')
REGEX_KEYWORDS = ('return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await')


def code_only(text):
    """The source without comments, strings and regex literals, so rules only look at code.

    One left-to-right pass, so a quote inside a regex or a // inside a string can't swallow code.
    Newlines are kept, so the result has as many lines as the source (architecture() checks this).
    Template literal ${...} parts are blanked too, which is fine for these rules.
    """
    out = []
    i, n = 0, len(text)
    last = ''   # the last code character that wasn't whitespace
    while i < n:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < n else ''
        if ch == '/' and nxt == '/':
            end = text.find('\n', i)
            i = n if end < 0 else end
            continue
        if ch == '/' and nxt == '*':
            end = text.find('*/', i + 2)
            end = n if end < 0 else end + 2
            out.append('\n' * text.count('\n', i, end))
            i = end
            continue
        word = re.search(r'(\w+)\s*$', ''.join(out[-20:]))
        starts_regex = ch == '/' and (last in REGEX_BEFORE or last == '' or (word and word.group(1) in REGEX_KEYWORDS and last.isalpha()))
        if ch in '\'"`' or starts_regex:
            j = i + 1
            in_class = False
            while j < n:
                c = text[j]
                if c == '\\':
                    j += 2
                    continue
                if ch == '/':
                    if c == '[':
                        in_class = True
                    elif c == ']':
                        in_class = False
                    elif c == '/' and not in_class:
                        break
                    elif c == '\n':
                        break
                elif c == ch or (c == '\n' and ch != '`'):
                    break
                j += 1
            out.append("''" + '\n' * text.count('\n', i, j))
            i = j + 1
            last = "'"
            continue
        out.append(ch)
        if not ch.isspace():
            last = ch
        i += 1
    return ''.join(out)


def architecture():
    problems = []
    for path in js_files():
        rel = path.relative_to(JS).as_posix()
        source = path.read_text(encoding='utf-8')
        imports = [next(filter(None, groups)) for groups in IMPORT.findall(source)]
        code = code_only(source)
        if code.count('\n') != source.count('\n'):
            problems.append(f'{rel}: the rule checker could not parse this file; fix scripts/check.py code_only()')
            continue

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

    # Every view has a stylesheet: main.js loads css/views/<id>.css, and each view's id is its file name.
    for path in sorted((JS / 'views').glob('*.js')):
        if path.name == 'index.js':
            continue
        if not (PACKAGE / 'css' / 'views' / f'{path.stem}.css').exists():
            problems.append(f'views/{path.name} has no css/views/{path.stem}.css')
        view_id = re.search(r"\bid:\s*'([^']+)'", path.read_text(encoding='utf-8'))
        if view_id and view_id.group(1) != path.stem:
            problems.append(f'views/{path.name} has id {view_id.group(1)!r}; it must match the file name')

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
