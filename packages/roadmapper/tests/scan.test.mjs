// Run with: node --test packages/milestone-board/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumns, displayName, normalizeFolder, parseConfig, serializeConfig, summarizeMarkdown } from '../js/scan.js';

const file = name => ({ name, type: 'file' });
const folder = (name, children = []) => ({ name, type: 'folder', children });

test('config defaults to plans and round-trips', () => {
    assert.deepEqual(parseConfig(''), { root: 'plans' });
    assert.deepEqual(parseConfig('{"root":"project:docs/milestones/"}'), { root: 'docs/milestones' });
    assert.deepEqual(parseConfig(serializeConfig({ root: 'a/b' })), { root: 'a/b' });
    assert.throws(() => parseConfig('{not json'));
});

test('normalizeFolder strips prefixes and slashes', () => {
    assert.equal(normalizeFolder(' /plans/ '), 'plans');
    assert.equal(normalizeFolder('project:a\\b'), 'a/b');
});

test('subfolders become milestone columns in natural order', () => {
    const tree = folder('plans', [
        folder('10-launch', [file('ship.md')]),
        folder('2-alpha', [file('b.md'), file('a.md'), file('notes.txt')]),
        folder('1-prototype'),
    ]);
    const columns = buildColumns(tree, 'plans');
    assert.deepEqual(columns.map(c => c.name), ['1-prototype', '2-alpha', '10-launch']);
    assert.deepEqual(columns[1].cards.map(c => c.resource), ['plans/2-alpha/a.md', 'plans/2-alpha/b.md']);
    assert.equal(columns[0].cards.length, 0);
});

test('loose root files form an Unsorted column first, and nested files belong to their milestone', () => {
    const tree = folder('plans', [
        file('idea.md'),
        folder('m1', [folder('design', [file('ui.md')]), file('core.md')]),
    ]);
    const columns = buildColumns(tree, 'plans');
    assert.equal(columns[0].unsorted, true);
    assert.equal(columns[0].folder, 'plans');
    assert.deepEqual(columns[1].cards.map(c => c.resource), ['plans/m1/core.md', 'plans/m1/design/ui.md']);
});

test('no Unsorted column when the root holds no loose files', () => {
    const columns = buildColumns(folder('plans', [folder('m1')]), 'plans');
    assert.equal(columns.some(c => c.unsorted), false);
});

test('summary takes the first heading after front matter, and counts tasks', () => {
    const md = '---\ntitle: ignored\n---\nIntro\n# Real Title #\n- [x] one\n  * [X] two\n- [ ] three\n- not a task\n';
    assert.deepEqual(summarizeMarkdown(md, 'x.md'), { title: 'Real Title', done: 2, total: 3 });
});

test('summary falls back to the file name', () => {
    assert.deepEqual(summarizeMarkdown('', 'auth-flow.md'), { title: 'auth-flow', done: 0, total: 0 });
    assert.deepEqual(summarizeMarkdown(undefined, 'a.MD'), { title: 'a', done: 0, total: 0 });
});

test('displayName drops number prefixes', () => {
    assert.equal(displayName('02-first-release'), 'First release');
    assert.equal(displayName('M3_beta'), 'M3 beta');
    assert.equal(displayName('2024'), '2024');
    assert.equal(displayName('01-v0.1-basics'), 'v0.1 basics');
});
