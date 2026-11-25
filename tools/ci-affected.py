#!/usr/bin/env python3
"""Which browser suites does a change touch? Used by site-checks.yml to skip suites whose inputs did not change.

  python3 tools/ci-affected.py <base-rev> <suite.js> [<suite.js> ...]
  exit 0 + "run: <reason>"  = run the suites
  exit 3 + "skip: <reason>" = nothing they load changed

A suite's inputs = the import closure of the suite + its harness (lib.js, the dev server and the Pages Functions
it imports) + every page it opens (/charts.html ...) with that page's whole script corpus (the same corpus
tools/build-charts-css.py reads, Vela engine folders included). A changed file only counts when its change is more
than a ?v= / build-number bump. Rule of thumb: when in doubt, RUN.
  - a changed file inside a suite's inputs              -> run
  - a changed file no shipped page or suite can load    -> run (unknown = run all)
  - known-inert files (docs, other suites, the apps, server code no suite imports, another page's own assets) -> skip
CI_RUN_ALL=1, a failing git diff, or a change to this planner / site-checks.yml always runs.
"""
import glob
import importlib.util
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    m = importlib.util.module_from_spec(spec)
    argv, sys.argv = sys.argv, [rel]
    try:
        spec.loader.exec_module(m)
    finally:
        sys.argv = argv
    return m


CHECK = load('check', 'tools/check.py')
CSS = load('build_charts_css', 'tools/build-charts-css.py')
MAX_DIR = 150
HARNESS = ['tools/tests/lib.js', 'tools/tests/chart-dev-server.mjs', 'tools/ci-browser.sh', 'tools/tests/richstub.js']
ALWAYS = {'tools/ci-affected.py', '.github/workflows/site-checks.yml', 'tools/check.py', 'tools/build-charts-css.py'}
# never loaded by a browser suite: docs, the native apps, repo plumbing
INERT = re.compile(r'(\.md$|^docs/|^android/|^desktop/|^\.claude/|^graphify-out/|^\.github/|^bridge/|^tests/|^sitemap\.xml$|^robots\.txt$)')
VNORM = re.compile(r'\?v=\d+|("build":\s*)\d+|(name="stryker-build" content=")\d+')


def git(*a):
    return subprocess.run(['git', *a], capture_output=True, text=True, cwd=ROOT, check=True).stdout


def real_changes(base, head='HEAD'):
    """Changed paths whose diff is more than a version bump."""
    names = git('diff', '--name-only', '--no-renames', base, head).split()
    out = set()
    diff = git('diff', '-U0', '--no-renames', '--no-color', base, head)
    per = {}
    cur = None
    for line in diff.splitlines():
        if line.startswith('diff --git '):
            cur = line.split(' b/', 1)[1] if ' b/' in line else None
            per[cur] = [[], [], False]
        elif cur is None:
            continue
        elif line.startswith('Binary files') or line.startswith('new file') or line.startswith('deleted file'):
            per[cur][2] = True
        elif line.startswith('+') and not line.startswith('+++'):
            per[cur][1].append(VNORM.sub(r'\1\2', line[1:]))
        elif line.startswith('-') and not line.startswith('---'):
            per[cur][0].append(VNORM.sub(r'\1\2', line[1:]))
    for n in names:
        a, b, hard = per.get(n, [[], [], True])
        if hard or sorted(a) != sorted(b):
            out.add(n)
    return out


def pages_of(suite_files):
    pages = set()
    for f in suite_files:
        if f.endswith(('.js', '.mjs')) and os.path.relpath(f, ROOT).startswith('tools/tests/'):   # pages the TEST opens (site code linking pages is navigation, not a load)
            # '/charts.html', 'creator.html', '/creator', '/features/charts?x' (Pages serves /x as x.html)
            for m in re.finditer(r'''["'`/ ]/?([\w-]+(?:/[\w-]+)?)(?:\.html)?(?=["'`?#\s:])''', open(f, encoding='utf-8', errors='replace').read()):
                p = os.path.join(ROOT, m.group(1) + '.html')
                if os.path.isfile(p):
                    pages.add(p)
    return pages


def page_inputs(page):
    files = {page, *CSS.corpus_files(page)}
    html = open(page, encoding='utf-8', errors='replace').read()
    for m in re.finditer(r'''(?:href|src)\s*=\s*["']/?(assets/[^"'?#]+)''', html):   # css, images, json the page names
        files.add(os.path.normpath(os.path.join(ROOT, m.group(1))))
    return files


def inputs(suite):
    seeds = ['tools/tests/' + suite] + HARNESS
    # shortcut: a folder literal with more than MAX_DIR files ('/assets/', 'desktop/') is a URL prefix, not a load; every
    # script a page really loads is in its corpus. Raise MAX_DIR if a suite ever reads a big folder by prefix.
    files = set(CHECK.closure(seeds, MAX_DIR))
    for pg in pages_of(files):
        files |= page_inputs(pg)
    files |= set(CHECK.closure([os.path.relpath(f, ROOT) for f in files if os.path.exists(f)], MAX_DIR))
    return {os.path.relpath(f, ROOT) for f in files}


_SHIPPED = None


def shipped():
    """Every file some page can load: a change there that no suite loads is another page's concern (app-shell audit)."""
    global _SHIPPED
    if _SHIPPED is None:
        s = set()
        for pg in sorted(glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'features', '*.html')) + glob.glob(os.path.join(ROOT, 'indicators', '*.html'))):
            s |= page_inputs(pg)
        _SHIPPED = {os.path.relpath(f, ROOT) for f in s}
    return _SHIPPED


def decide(base, suites):
    if os.environ.get('CI_RUN_ALL') == '1':
        return True, 'CI_RUN_ALL=1'
    try:
        changed = real_changes(base)
    except Exception as e:
        return True, 'git diff failed (%s)' % str(e).strip()[:120]
    if changed & ALWAYS:
        return True, 'planner / workflow changed: ' + ', '.join(sorted(changed & ALWAYS))
    need = set()
    for s in suites:
        need |= inputs(s)
    hit = sorted(changed & need)
    if hit:
        return True, 'inputs changed: ' + ', '.join(hit[:8]) + (' ...' if len(hit) > 8 else '')
    unknown = []
    for f in sorted(changed):
        if INERT.search(f):
            continue
        if f.startswith('tools/tests/') or f.startswith('functions/') or f.startswith('workers/'):
            continue   # another suite or server code this suite does not import (imports are in `need`)
        if f.startswith('tools/') and not f.startswith('tools/ci-'):
            continue   # generators and scripts: their output is what ships, and that output is diffed above
        if f.endswith('.html') or f in shipped():
            continue   # another page or another page's asset
        unknown.append(f)
    if unknown:
        return True, 'unknown change (run all): ' + ', '.join(unknown[:8])
    return False, '%d changed file(s), none loaded by %s' % (len(changed), ' '.join(suites))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(2)
    run, why = decide(sys.argv[1], sys.argv[2:])
    print(('run: ' if run else 'skip: ') + why)
    sys.exit(0 if run else 3)
