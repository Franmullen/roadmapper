// Run with: node --test packages/roadmapper/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    scanTree, deriveStatus, displayName, isOverdue,
    laneOrder, milestoneTemplate, nextMilestoneFolder, normalizeFolder, normalizeStatus, parseConfig, parseFrontMatter,
    planTemplate, serializeConfig, setFrontMatter, slugify, summarizeMarkdown, summarizeMilestone, uniqueFileName,
    buildProject, statusCounts, todayMarkerIndex, isMilestoneOverdue, parseList, projectResources, dropChanges, focusProject, planTotal,
    approveReview, addFollowUps, parseQueue, addQueueItems, removeQueueItem, answerQueueItem, folderPaths,
} from '../js/model.js';
import { fitState, zoomAt } from '../js/viewport.js';

const file = name => ({ name, type: 'file' });
const folder = (name, children = []) => ({ name, type: 'folder', children });

// --- Settings ---

test('config defaults, round-trips, and keeps only what is set', () => {
    assert.deepEqual(parseConfig(''), { root: 'plans', lanes: [], view: null });
    assert.equal(parseConfig('{"view":"board"}').view, 'board');
    assert.equal(parseConfig('{"view":" "}').view, null);
    assert.deepEqual(parseConfig('{"root":"project:docs/milestones/"}').root, 'docs/milestones');
    const config = { root: 'a/b', lanes: ['core', 'ui'], view: 'map' };
    assert.deepEqual(parseConfig(serializeConfig(config)), config);
    assert.equal(serializeConfig({ root: 'plans', lanes: [], view: null }), '{\n  "root": "plans"\n}\n');
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
        { title: 'Real Title', done: 2, total: 3, status: 'review', statusExplicit: true, lane: 'ui', owner: '', dependsOn: [], openTasks: ['three'], followUps: [] });
});

test('summary falls back to the file name and derived status', () => {
    assert.deepEqual(summarizeMarkdown('', 'auth-flow.md'),
        { title: 'auth-flow', done: 0, total: 0, status: 'todo', statusExplicit: false, lane: '', owner: '', dependsOn: [], openTasks: [], followUps: [] });
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

test('focus keeps work now and next, and hides what is finished or far off', () => {
    const plan = (milestone, status) => ({ milestone, status, resource: `${milestone}/${status}-${Math.random()}` });
    const milestone = (name, statuses, unsorted = false) => {
        const plans = statuses.map(status => plan(name, status));
        return { folder: name, name, unsorted, plans, counts: statusCounts(plans) };
    };
    const project = ms => ({ root: 'p', lanes: [], milestones: ms, plans: ms.flatMap(m => m.plans) });

    // done, active, next, later, later
    const full = project([
        milestone('m1', ['done', 'done']),
        milestone('m2', ['done', 'doing', 'todo']),
        milestone('m3', ['todo']),
        milestone('m4', ['todo']),
        milestone('m5', []),
    ]);
    const focused = focusProject(full);
    assert.deepEqual(focused.milestones.map(m => m.name), ['m2', 'm3']);
    assert.deepEqual(focused.milestones[0].plans.map(p => p.status), ['doing', 'todo']);
    assert.equal(focused.milestones[0].hiddenDone, 1);
    assert.equal(planTotal(focused.milestones[0]), 3);           // counts stay whole
    assert.deepEqual([focused.hidden.done, focused.hidden.later, focused.hidden.plans], [1, 2, 4]);
    assert.deepEqual(focused.hidden.after.map(m => m.name), ['m4', 'm5']);
    assert.equal(focused.plans.length, 3);

    // Nothing started yet: just the first milestone.
    assert.deepEqual(focusProject(project([milestone('a', ['todo']), milestone('b', ['todo'])])).milestones.map(m => m.name), ['a']);
    // Everything done: nothing to focus on.
    assert.equal(focusProject(project([milestone('a', ['done'])])).hidden.done, 1);
    // Unsorted plans show while any are unfinished.
    assert.deepEqual(focusProject(project([milestone('Unsorted', ['todo'], true), milestone('a', ['done'])])).milestones.map(m => m.name), ['Unsorted']);
    // A finished milestone between active ones stays, with its plans hidden.
    const between = focusProject(project([milestone('a', ['doing']), milestone('b', ['done']), milestone('c', ['review'])]));
    assert.deepEqual(between.milestones.map(m => [m.name, m.plans.length, m.hiddenDone]), [['a', 1, 0], ['b', 0, 1], ['c', 1, 0]]);
});

test('approving a review marks it done and ticks what was left', () => {
    const text = '---\nstatus: review\nowner: claude\n---\n# A\n\n- [x] build\n- [ ] Check: it works\n';
    assert.equal(approveReview(text), '---\nstatus: done\nowner: claude\n---\n# A\n\n- [x] build\n- [x] Check: it works\n');
    const plan = summarizeMarkdown(text, 'a.md');
    assert.deepEqual(plan.openTasks, ['Check: it works']);
    assert.deepEqual(plan.followUps, []);
});

test('sending a plan back adds follow-ups and returns it to todo', () => {
    const text = '---\nstatus: review\n---\n# A\n\n## Tasks\n\n- [x] build\n\n## Notes\n\nSomething.\n';
    const once = addFollowUps(text, ['Fix the label ', ' ', 'Add a test']);
    assert.equal(once, '---\nstatus: todo\n---\n# A\n\n## Tasks\n\n- [x] build\n\n## Notes\n\nSomething.\n\n## Follow-ups\n\n- [ ] Fix the label\n- [ ] Add a test\n');
    const plan = summarizeMarkdown(once, 'a.md');
    assert.equal(plan.status, 'todo');
    assert.deepEqual(plan.followUps, ['Fix the label', 'Add a test']);

    // A second round goes at the end of the existing section, before any heading after it.
    const twice = addFollowUps(once + '\n## After\n', ['More']);
    assert.match(twice, /- \[ \] Add a test\n- \[ \] More\n\n## After/);
    assert.equal(addFollowUps('# A\r\n\r\n## Follow-ups\r\n', ['x']), '---\r\nstatus: todo\r\n---\r\n# A\r\n\r\n## Follow-ups\r\n\r\n- [ ] x\r\n');
});

test('the queue lists open and processed items, and is not a plan', () => {
    const tree = { name: 'plans', children: [{ name: 'queue.md', type: 'file' }, { name: 'idea.md', type: 'file' }] };
    assert.deepEqual(projectResources(tree, 'plans'), ['plans/queue.md', 'plans/idea.md']);
    const text = '# Queue\n\n- [ ] Dark mode\n- [x] Export → plans/02/export.md\n- [ ]  \n';
    const project = buildProject(tree, 'plans', new Map([['plans/queue.md', text]]), { lanes: [] });
    assert.deepEqual(project.plans.map(p => p.name), ['idea.md']);
    assert.deepEqual(project.queue, {
        resource: 'plans/queue.md', exists: true,
        open: [{ text: 'Dark mode', notes: [] }], processed: [{ text: 'Export → plans/02/export.md', notes: [] }],
    });
    assert.equal(buildProject({ children: [] }, 'plans', new Map(), { lanes: [] }).queue.exists, false);
});

test('adding to and removing from the queue', () => {
    const started = addQueueItems('', ['  Dark   mode ', '']);
    assert.match(started, /^# Queue\n\n.*\n.*\n\n- \[ \] Dark mode\n$/);
    const more = addQueueItems(started, ['Export', 'Search']);
    assert.match(more, /- \[ \] Dark mode\n- \[ \] Export\n- \[ \] Search\n$/);
    assert.deepEqual(parseQueue(removeQueueItem(more, 'Export')).open.map(item => item.text), ['Dark mode', 'Search']);
    assert.equal(removeQueueItem('- [x] Export\n', 'Export'), '- [x] Export\n');   // processed items stay
    assert.equal(addQueueItems('# Q\r\n\r\nNotes.\r\n', ['A']), '# Q\r\n\r\nNotes.\r\n\r\n- [ ] A\r\n');
});

test('an agent asks about a queue item, and the person answers', () => {
    const asked = '- [ ] Search\n  - Question: Which runbooks?\n- [ ] Export\n';
    assert.deepEqual(parseQueue(asked).open, [{ text: 'Search', notes: ['Question: Which runbooks?'] }, { text: 'Export', notes: [] }]);
    const answered = answerQueueItem(asked, 'Search', ' All of   them ');
    assert.equal(answered, '- [ ] Search\n  - Question: Which runbooks?\n  - Answer: All of them\n- [ ] Export\n');
    assert.equal(answerQueueItem('- [ ] Search', 'Search', 'Yes'), '- [ ] Search\n  - Answer: Yes\n');
    assert.equal(answerQueueItem(asked, 'Missing', 'x'), asked);
    assert.equal(removeQueueItem(answered, 'Search'), '- [ ] Export\n');                   // its notes go with it
    assert.equal(addQueueItems(asked.trim(), ['New']), `${asked}- [ ] New\n`);             // no gap after a note
});

test('folderPaths suggests project folders, skipping hidden and package ones', () => {
    const tree = { children: [
        { name: 'plans', type: 'folder', children: [{ name: '01-a', type: 'folder', children: [] }] },
        { name: '.git', type: 'folder', children: [] },
        { name: 'packages', type: 'folder', children: [] },
        { name: 'notes.md', type: 'file' },
    ] };
    assert.deepEqual(folderPaths(tree), ['plans', 'plans/01-a']);
});
