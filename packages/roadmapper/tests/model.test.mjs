// Run with: node --test packages/roadmapper/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    AGENT_SECTION_END, AGENT_SECTION_START, agentInstructions, scanTree, deriveStatus, displayName, isOverdue,
    laneOrder, milestoneTemplate, nextMilestoneFolder, normalizeFolder, normalizeStatus, parseConfig, parseFrontMatter,
    planTemplate, serializeConfig, setFrontMatter, slugify, summarizeMarkdown, summarizeMilestone, uniqueFileName,
    upsertSection, buildProject, statusCounts, todayMarkerIndex, isMilestoneOverdue, parseList, projectResources, dropChanges,
} from '../js/model.js';
import { fitState, zoomAt } from '../js/viewport.js';

const file = name => ({ name, type: 'file' });
const folder = (name, children = []) => ({ name, type: 'folder', children });

// --- Settings ---

test('config defaults, round-trips, and keeps only what is set', () => {
    assert.deepEqual(parseConfig(''), { root: 'plans', lanes: [], showLanes: false, view: null });
    assert.equal(parseConfig('{"view":"board"}').view, 'board');
    assert.equal(parseConfig('{"view":" "}').view, null);
    assert.deepEqual(parseConfig('{"root":"project:docs/milestones/"}').root, 'docs/milestones');
    const config = { root: 'a/b', lanes: ['core', 'ui'], showLanes: true, view: 'board' };
    assert.deepEqual(parseConfig(serializeConfig(config)), config);
    assert.equal(serializeConfig({ root: 'plans', lanes: [], showLanes: false, view: null }), '{\n  "root": "plans"\n}\n');
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

test('lists read the same inline, comma-separated or as a block', () => {
    assert.deepEqual(parseList('[a, "b c"]'), ['a', 'b c']);
    assert.deepEqual(parseList('a,b, '), ['a', 'b']);
    assert.deepEqual(parseList(undefined), []);
    const { data } = parseFrontMatter('---\ndepends:\n  - login\n  - "02-beta/api" # soon\nlane: ui\n---\n');
    assert.deepEqual(parseList(data.depends), ['login', '02-beta/api']);
    assert.equal(data.lane, 'ui');
});

test('setFrontMatter replaces a block list whole, and keys match exactly', () => {
    const original = '---\ndepends:\n  - a\n  - b\nstatus: todo\n---\n# P\n';
    assert.equal(setFrontMatter(original, { depends: 'c' }), '---\ndepends: c\nstatus: todo\n---\n# P\n');
    assert.equal(setFrontMatter(original, { depends: null }), '---\nstatus: todo\n---\n# P\n');
    // "status" must not match a key that merely starts with it.
    assert.equal(setFrontMatter('---\nstatusnote: x\n---\n', { status: 'done' }), '---\nstatusnote: x\nstatus: done\n---\n');
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
        { title: 'Real Title', done: 2, total: 3, status: 'review', statusExplicit: true, lane: 'ui', dependsOn: [] });
});

test('summary falls back to the file name and derived status', () => {
    assert.deepEqual(summarizeMarkdown('', 'auth-flow.md'),
        { title: 'auth-flow', done: 0, total: 0, status: 'todo', statusExplicit: false, lane: '', dependsOn: [] });
    assert.equal(summarizeMarkdown('- [x] a\n- [x] b', 'a.MD').status, 'done');
    assert.equal(summarizeMarkdown('---\nstatus: weird\n---\n- [x] a\n- [ ] b', 'a.md').status, 'doing');
});

test('milestone summary reads heading, due date and first paragraph', () => {
    const md = '---\ndue: 2026-11-29\n---\n# v0.2 Organise\n\nPlan from the board\nitself.\n\n## More\n';
    assert.deepEqual(summarizeMilestone(md), { title: 'v0.2 Organise', due: '2026-11-29', description: 'Plan from the board itself.' });
    assert.deepEqual(summarizeMilestone('---\ndue: soon\n---\nJust text.'), { title: null, due: null, description: 'Just text.' });
});

// --- The folder tree ---

test('subfolders become milestones in natural order', () => {
    const tree = folder('plans', [
        folder('10-launch', [file('ship.md')]),
        folder('2-alpha', [file('b.md'), file('a.md'), file('notes.txt')]),
        folder('1-prototype'),
    ]);
    const columns = scanTree(tree, 'plans');
    assert.deepEqual(columns.map(c => c.name), ['1-prototype', '2-alpha', '10-launch']);
    assert.deepEqual(columns[1].files.map(c => c.resource), ['plans/2-alpha/a.md', 'plans/2-alpha/b.md']);
    assert.equal(columns[0].files.length, 0);
});

test('milestone README is metadata, not a card; nested READMEs are still cards', () => {
    const tree = folder('plans', [
        file('README.md'),
        file('idea.md'),
        folder('m1', [file('README.md'), file('core.md'), folder('design', [file('readme.md')])]),
        folder('m2', [file('_milestone.md'), file('x.md')]),
    ]);
    const columns = scanTree(tree, 'plans');
    assert.equal(columns[0].unsorted, true);
    assert.deepEqual(columns[0].files.map(c => c.name), ['idea.md']);
    assert.equal(columns[1].metaResource, 'plans/m1/README.md');
    assert.deepEqual(columns[1].files.map(c => c.resource), ['plans/m1/core.md', 'plans/m1/design/readme.md']);
    assert.equal(columns[2].metaResource, 'plans/m2/_milestone.md');
});

test('no Unsorted milestone when the root holds no loose plans', () => {
    const columns = scanTree(folder('plans', [file('README.md'), folder('m1')]), 'plans');
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

// --- The project ---

test('buildProject joins folders, READMEs and plans into one project', () => {
    const tree = folder('plans', [
        file('idea.md'),
        folder('01-alpha', [file('README.md'), file('a.md'), file('b.md')]),
        folder('02-beta', [file('c.md')]),
    ]);
    const contents = new Map([
        ['plans/01-alpha/README.md', '---\ndue: 2026-12-01\n---\n# Alpha\n\nFirst cut.\n'],
        ['plans/01-alpha/a.md', '---\nstatus: done\nlane: core\n---\n# A\n'],
        ['plans/01-alpha/b.md', '---\nlane: ui\n---\n- [x] one\n- [ ] two\n'],
        ['plans/02-beta/c.md', '---\nstatus: blocked\nlane: agents\n---\n# C\n'],
    ]);
    const project = buildProject(tree, 'plans', contents, { lanes: ['ui'] });

    assert.deepEqual(project.milestones.map(m => m.title), ['Unsorted', 'Alpha', 'Beta']);
    const alpha = project.milestones[1];
    assert.equal(alpha.due, '2026-12-01');
    assert.equal(alpha.description, 'First cut.');
    assert.deepEqual(alpha.counts, { todo: 0, doing: 1, review: 0, done: 1, blocked: 0 });
    assert.deepEqual(alpha.plans.map(p => [p.path, p.milestone, p.status, p.lane]),
        [['a.md', 'plans/01-alpha', 'done', 'core'], ['b.md', 'plans/01-alpha', 'doing', 'ui']]);
    assert.equal(project.plans.length, 4);
    assert.deepEqual(project.lanes, ['ui', 'agents', 'core']);
});

test('projectResources lists the READMEs and plans to read', () => {
    const tree = folder('plans', [file('idea.md'), folder('01-a', [file('README.md'), file('x.md'), folder('d', [file('y.md')])])]);
    assert.deepEqual(projectResources(tree, 'plans'), ['plans/idea.md', 'plans/01-a/README.md', 'plans/01-a/d/y.md', 'plans/01-a/x.md']);
});

test('dependencies resolve by name or path, and flag what is wrong', () => {
    const tree = folder('plans', [
        folder('01-alpha', [file('api.md'), file('login.md')]),
        folder('02-beta', [file('ui.md'), file('login.md')]),
        folder('03-gamma', [file('report.md')]),
    ]);
    const contents = new Map([
        ['plans/01-alpha/api.md', '---\nstatus: done\n---\n# API\n'],
        ['plans/01-alpha/login.md', '---\ndepends: report\n---\n# Login A\n'],
        ['plans/02-beta/ui.md', '---\ndepends: [api, 01-alpha/login.md, login, nothing, ui]\n---\n# UI\n'],
    ]);
    const project = buildProject(tree, 'plans', contents, { lanes: [] });
    const plan = name => project.plans.find(p => p.resource === `plans/${name}`);

    assert.deepEqual(plan('02-beta/ui.md').depends.map(d => [d.ref, d.resource, d.done, d.problem]), [
        ['api', 'plans/01-alpha/api.md', true, null],
        ['01-alpha/login.md', 'plans/01-alpha/login.md', false, null],
        ['login', null, false, 'ambiguous'],
        ['nothing', null, false, 'missing'],
        ['ui', null, false, 'missing'],            // a plan cannot depend on itself
    ]);
    assert.equal(plan('02-beta/ui.md').waitingOn, 1);
    assert.equal(plan('02-beta/ui.md').depends[0].title, 'API');
    assert.deepEqual(plan('01-alpha/api.md').dependents, ['plans/02-beta/ui.md']);
    // Login (milestone 1) depends on Report (milestone 3): scheduled too late.
    assert.equal(plan('01-alpha/login.md').depends[0].problem, 'later');
});

test('dropChanges says what a drop writes and where the file goes', () => {
    const payload = { resource: 'p/a/x.md', from: 'p/a', lane: 'ui', status: 'todo' };
    assert.deepEqual(dropChanges(payload, { folder: 'p/a' }), { updates: {}, moveTo: null });
    assert.deepEqual(dropChanges(payload, { folder: 'p/b' }), { updates: {}, moveTo: 'p/b' });
    assert.deepEqual(dropChanges(payload, { folder: 'p/b', lane: '' }), { updates: { lane: null }, moveTo: 'p/b' });
    assert.deepEqual(dropChanges(payload, { status: 'done' }), { updates: { status: 'done' }, moveTo: null });
    assert.deepEqual(dropChanges(payload, { folder: 'p/a', lane: 'ui', status: 'todo' }), { updates: {}, moveTo: null });
});

test('statusCounts counts every status', () => {
    assert.deepEqual(statusCounts([{ status: 'done' }, { status: 'done' }, { status: 'todo' }]),
        { todo: 1, doing: 0, review: 0, done: 2, blocked: 0 });
});

test('a milestone is overdue only while it has unfinished plans', () => {
    const milestone = (due, statuses) => ({ due, plans: statuses.map(status => ({ status })), counts: statusCounts(statuses.map(status => ({ status }))) });
    assert.equal(isMilestoneOverdue(milestone('2026-11-01', ['done', 'todo']), '2026-11-15'), true);
    assert.equal(isMilestoneOverdue(milestone('2026-11-01', ['done']), '2026-11-15'), false);
    assert.equal(isMilestoneOverdue(milestone('2026-11-01', []), '2026-11-15'), true);
});

test('the Today marker sits before the first milestone due after today', () => {
    const m = due => ({ due });
    assert.equal(todayMarkerIndex([m('2026-11-01'), m('2026-11-20'), m('2026-12-01')], '2026-11-15'), 1);
    assert.equal(todayMarkerIndex([m('2026-11-01'), m(null), m('2026-11-15')], '2026-11-15'), 3);
    assert.equal(todayMarkerIndex([m('2026-11-15'), m('2026-11-29')], '2026-11-15'), 1);
    assert.equal(todayMarkerIndex([m('2026-11-01')], '2026-11-15'), 1);
    assert.equal(todayMarkerIndex([m(null), m(null)], '2026-11-15'), null);
});

// --- Viewport math ---

test('zoomAt keeps the point under the pointer still', () => {
    const next = zoomAt({ scale: 1, x: 0, y: 0 }, 2, 100, 50);
    assert.deepEqual(next, { scale: 2, x: -100, y: -50 });
    // The content point (100, 50) was at screen (100, 50) and still is.
    assert.equal(100 * next.scale + next.x, 100);
    assert.equal(zoomAt({ scale: 2, x: 0, y: 0 }, 10, 0, 0).scale, 2.5);
    assert.equal(zoomAt({ scale: 0.2, x: 0, y: 0 }, 0.1, 0, 0).scale, 0.15);
});

test('fitState shrinks large content to fit and never enlarges small content', () => {
    const big = fitState(2000, 500, 1000, 600, { padding: 0 });
    assert.equal(big.scale, 0.5);
    assert.equal(big.x, 0);
    assert.equal(big.y, (600 - 250) / 2);
    const small = fitState(200, 100, 1000, 600, { padding: 10 });
    assert.equal(small.scale, 1);
    assert.equal(small.x, 400);
    assert.equal(fitState(200, 100, 1000, 600, { padding: 10, align: 'top' }).y, 10);
    assert.equal(fitState(0, 0, 1000, 600).scale, 1);
});
