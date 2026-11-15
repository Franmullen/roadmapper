// Run with: node --test packages/roadmapper/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AGENT_SECTION_END, AGENT_SECTION_START, agentInstructions, buildColumns, deriveStatus, displayName, isOverdue,
    laneOrder, milestoneTemplate, nextMilestoneFolder, normalizeFolder, normalizeStatus, parseConfig, parseFrontMatter,
    planTemplate, serializeConfig, setFrontMatter, slugify, summarizeMarkdown, summarizeMilestone, uniqueFileName,
    upsertSection,
} from '../js/scan.js';

const file = name => ({ name, type: 'file' });
const folder = (name, children = []) => ({ name, type: 'folder', children });

// --- Settings ---

test('config defaults, round-trips, and keeps only what is set', () => {
    assert.deepEqual(parseConfig(''), { root: 'plans', lanes: [], showLanes: false });
    assert.deepEqual(parseConfig('{"root":"project:docs/milestones/"}').root, 'docs/milestones');
    const config = { root: 'a/b', lanes: ['core', 'ui'], showLanes: true };
    assert.deepEqual(parseConfig(serializeConfig(config)), config);
    assert.equal(serializeConfig({ root: 'plans', lanes: [], showLanes: false }), '{\n  "root": "plans"\n}\n');
    assert.deepEqual(parseConfig('{"lanes":[" ui ","ui","",3]}').lanes, ['ui']);
    assert.throws(() => parseConfig('{not json'));
});

test('normalizeFolder strips prefixes and slashes', () => {
    assert.equal(normalizeFolder(' /plans/ '), 'plans');
    assert.equal(normalizeFolder('project:a\\b'), 'a/b');
});

// --- Front matter ---

test('parseFrontMatter reads simple keys, quotes and comments', () => {
    const { data, body, hasFrontMatter } = parseFrontMatter('---\nStatus: "In Progress"\nlane: ui # the UI lane\n---\n# T\n');
    assert.equal(hasFrontMatter, true);
    assert.deepEqual(data, { status: 'In Progress', lane: 'ui' });
    assert.equal(body, '# T\n');
    assert.equal(parseFrontMatter('# No front matter').hasFrontMatter, false);
});

test('setFrontMatter updates, adds and removes keys and keeps the rest', () => {
    const original = '---\nstatus: todo\nowner: chris\n---\n# Plan\n\nBody\n';
    assert.equal(setFrontMatter(original, { status: 'done' }), '---\nstatus: done\nowner: chris\n---\n# Plan\n\nBody\n');
    assert.equal(setFrontMatter(original, { lane: 'ui' }), '---\nstatus: todo\nowner: chris\nlane: ui\n---\n# Plan\n\nBody\n');
    assert.equal(setFrontMatter(original, { status: null, owner: '' }), '# Plan\n\nBody\n');
    assert.equal(setFrontMatter('# Plan\n', { status: 'doing' }), '---\nstatus: doing\n---\n# Plan\n');
    assert.equal(setFrontMatter('# Plan\n', { lane: null }), '# Plan\n');
});

test('setFrontMatter keeps Windows line endings', () => {
    assert.equal(setFrontMatter('---\r\nstatus: todo\r\n---\r\n# P\r\n', { status: 'done' }), '---\r\nstatus: done\r\n---\r\n# P\r\n');
});

// --- Status ---

test('status words are normalised and unknown words are ignored', () => {
    assert.equal(normalizeStatus('In Progress'), 'doing');
    assert.equal(normalizeStatus('Completed'), 'done');
    assert.equal(normalizeStatus('on hold'), 'blocked');
    assert.equal(normalizeStatus('maybe'), null);
    assert.equal(normalizeStatus(undefined), null);
});

test('status is derived from checkboxes when not set', () => {
    assert.equal(deriveStatus(0, 0), 'todo');
    assert.equal(deriveStatus(0, 3), 'todo');
    assert.equal(deriveStatus(1, 3), 'doing');
    assert.equal(deriveStatus(3, 3), 'done');
});

// --- Reading plans ---

test('summary takes title, tasks, status and lane', () => {
    const md = '---\nstatus: review\nlane: ui\n---\nIntro\n# Real Title #\n- [x] one\n  * [X] two\n- [ ] three\n- not a task\n';
    assert.deepEqual(summarizeMarkdown(md, 'x.md'),
        { title: 'Real Title', done: 2, total: 3, status: 'review', statusExplicit: true, lane: 'ui' });
});

test('summary falls back to the file name and derived status', () => {
    assert.deepEqual(summarizeMarkdown('', 'auth-flow.md'),
        { title: 'auth-flow', done: 0, total: 0, status: 'todo', statusExplicit: false, lane: '' });
    assert.equal(summarizeMarkdown('- [x] a\n- [x] b', 'a.MD').status, 'done');
    assert.equal(summarizeMarkdown('---\nstatus: weird\n---\n- [x] a\n- [ ] b', 'a.md').status, 'doing');
});

test('milestone summary reads heading, due date and first paragraph', () => {
    const md = '---\ndue: 2026-11-29\n---\n# v0.2 Organise\n\nPlan from the board\nitself.\n\n## More\n';
    assert.deepEqual(summarizeMilestone(md), { title: 'v0.2 Organise', due: '2026-11-29', description: 'Plan from the board itself.' });
    assert.deepEqual(summarizeMilestone('---\ndue: soon\n---\nJust text.'), { title: null, due: null, description: 'Just text.' });
});

// --- Columns ---

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

test('milestone README is metadata, not a card; nested READMEs are still cards', () => {
    const tree = folder('plans', [
        file('README.md'),
        file('idea.md'),
        folder('m1', [file('README.md'), file('core.md'), folder('design', [file('readme.md')])]),
        folder('m2', [file('_milestone.md'), file('x.md')]),
    ]);
    const columns = buildColumns(tree, 'plans');
    assert.equal(columns[0].unsorted, true);
    assert.deepEqual(columns[0].cards.map(c => c.name), ['idea.md']);
    assert.equal(columns[1].metaResource, 'plans/m1/README.md');
    assert.deepEqual(columns[1].cards.map(c => c.resource), ['plans/m1/core.md', 'plans/m1/design/readme.md']);
    assert.equal(columns[2].metaResource, 'plans/m2/_milestone.md');
});

test('no Unsorted column when the root holds no loose plans', () => {
    const columns = buildColumns(folder('plans', [file('README.md'), folder('m1')]), 'plans');
    assert.equal(columns.some(c => c.unsorted), false);
});

test('displayName drops number prefixes and keeps version names', () => {
    assert.equal(displayName('02-first-release'), 'First release');
    assert.equal(displayName('M3_beta'), 'M3 beta');
    assert.equal(displayName('2024'), '2024');
    assert.equal(displayName('01-v0.1-basics'), 'v0.1 basics');
});

// --- Lanes and dates ---

test('lane order puts configured lanes first, then the rest alphabetically', () => {
    const cards = [{ lane: 'ui' }, { lane: 'agents' }, { lane: '' }, { lane: 'core' }, { lane: 'agents' }];
    assert.deepEqual(laneOrder(['core'], cards), ['core', 'agents', 'ui']);
    assert.deepEqual(laneOrder(['empty'], []), ['empty']);
});

test('overdue only when the date has passed and work remains', () => {
    assert.equal(isOverdue('2026-11-01', '2026-11-15', false), true);
    assert.equal(isOverdue('2026-11-01', '2026-11-15', true), false);
    assert.equal(isOverdue('2026-11-15', '2026-11-15', false), false);
    assert.equal(isOverdue(null, '2026-11-15', false), false);
});

// --- Creating ---

test('slugify makes safe file names', () => {
    assert.equal(slugify('Create plans & milestones!'), 'create-plans-milestones');
    assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
    assert.equal(slugify('!!!'), 'plan');
    assert.ok(slugify('x'.repeat(100)).length <= 60);
});

test('uniqueFileName avoids existing names, ignoring case', () => {
    assert.equal(uniqueFileName([], 'Login'), 'login.md');
    assert.equal(uniqueFileName(['Login.md', 'login-2.md'], 'Login'), 'login-3.md');
});

test('nextMilestoneFolder numbers after the highest prefix', () => {
    assert.equal(nextMilestoneFolder([], 'Prototype'), '01-prototype');
    assert.equal(nextMilestoneFolder(['01-a', '04-b', 'backlog'], 'v0.5 Polish'), '05-v0-5-polish');
    assert.equal(nextMilestoneFolder(['099-x'], 'Y'), '100-y');
});

test('templates read back as the plan and milestone they describe', () => {
    const plan = summarizeMarkdown(planTemplate({ title: 'Lanes', lane: 'ui' }), 'lanes.md');
    assert.equal(plan.title, 'Lanes');
    assert.equal(plan.status, 'todo');
    assert.equal(plan.lane, 'ui');
    assert.equal(summarizeMarkdown(planTemplate({ title: 'X', lane: '' }), 'x.md').lane, '');
    assert.equal(summarizeMilestone(milestoneTemplate('v0.5 Polish')).title, 'v0.5 Polish');
});

// --- Agent instructions ---

test('agent instructions name the root, lanes and statuses', () => {
    const text = agentInstructions({ root: 'plans', lanes: ['core', 'ui'], showLanes: true }, 'roadmapper.roadmap');
    assert.ok(text.startsWith(AGENT_SECTION_START) && text.endsWith(AGENT_SECTION_END));
    assert.match(text, /`plans\/`/);
    assert.match(text, /`core`, `ui`/);
    assert.match(text, /`blocked`/);
});

test('upsertSection appends once, then replaces in place', () => {
    const first = upsertSection('# Project\n\nNotes.\n', `${AGENT_SECTION_START}\nv1\n${AGENT_SECTION_END}`);
    assert.equal(first, `# Project\n\nNotes.\n\n${AGENT_SECTION_START}\nv1\n${AGENT_SECTION_END}\n`);
    const second = upsertSection(first + '\nAfter.\n', `${AGENT_SECTION_START}\nv2\n${AGENT_SECTION_END}`);
    assert.equal(second, `# Project\n\nNotes.\n\n${AGENT_SECTION_START}\nv2\n${AGENT_SECTION_END}\n\nAfter.\n`);
    assert.equal(upsertSection('', 'S'), 'S\n');
});
