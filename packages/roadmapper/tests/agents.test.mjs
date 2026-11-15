// Run with: node --test packages/roadmapper/tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProject } from '../js/model.js';
import {
    AGENT_SECTION_END, AGENT_SECTION_START, agentInstructions, briefResource, currentMilestone, isReady, nextWork,
    roadmapBrief, upsertSection,
} from '../js/agents.js';

const file = name => ({ name, type: 'file' });
const folder = (name, children = []) => ({ name, type: 'folder', children });

function sampleProject() {
    const tree = folder('plans', [
        folder('01-alpha', [file('README.md'), file('api.md'), file('docs.md')]),
        folder('02-beta', [file('ui.md'), file('search.md'), file('export.md'), file('later.md')]),
    ]);
    const contents = new Map([
        ['plans/01-alpha/README.md', '---\ndue: 2026-11-01\n---\n# Alpha\n'],
        ['plans/01-alpha/api.md', '---\nstatus: done\nlane: core\n---\n# API\n'],
        ['plans/01-alpha/docs.md', '---\nstatus: doing\nowner: claude\n---\n# Docs\n- [x] a\n- [ ] b\n'],
        ['plans/02-beta/ui.md', '---\ndepends: api\nlane: ui\n---\n# UI\n'],
        ['plans/02-beta/search.md', '---\ndepends: docs\n---\n# Search\n'],
        ['plans/02-beta/export.md', '---\nstatus: blocked\n---\n# Export\n'],
        ['plans/02-beta/later.md', '---\ndepends: nowhere\n---\n# Later\n'],
    ]);
    return buildProject(tree, 'plans', contents, { lanes: [] });
}

test('ready means not started with every dependency done', () => {
    const project = sampleProject();
    const titles = plans => plans.map(plan => plan.title);
    const work = nextWork(project);
    assert.deepEqual(titles(work.inProgress), ['Docs']);
    assert.deepEqual(titles(work.ready), ['UI']);
    assert.deepEqual(titles(work.waiting), ['Later', 'Search']);
    assert.deepEqual(titles(work.blocked), ['Export']);
    assert.deepEqual(work.problems.map(p => p.dep.ref), ['nowhere']);
    assert.equal(isReady(project.plans.find(p => p.title === 'Later')), false);   // a broken link is not done
    assert.equal(currentMilestone(project).title, 'Alpha');
});

test('the brief summarises milestones, work and problems', () => {
    const brief = roadmapBrief(sampleProject(), { today: '2026-11-16', roadmapResource: 'roadmapper.roadmap' });
    assert.match(brief, /^# Roadmap brief: plans\//);
    assert.match(brief, /\| Alpha ← current \| `plans\/01-alpha` \| 2026-11-01 \| 2 \|/);
    assert.match(brief, /## Ready to start\n\nNot started.*\n\n- UI — `plans\/02-beta\/ui.md` \(lane ui\)/);
    assert.match(brief, /- Docs — `plans\/01-alpha\/docs.md` \(owner claude, 1\/2 tasks\)/);
    assert.match(brief, /- Search — .* waits on Docs/);
    assert.match(brief, /`plans\/02-beta\/later.md` depends on `nowhere`, but no plan has that name\./);
});

test('the brief lives in temp:, named after the .roadmap file', () => {
    assert.equal(briefResource('project:roadmapper.roadmap'), 'temp:roadmapper/roadmapper.md');
    assert.equal(briefResource('mocks/a.roadmap'), 'temp:roadmapper/mocks-a.md');
});

test('agent instructions name the root, lanes, brief and work loop', () => {
    const text = agentInstructions({ root: 'plans', lanes: ['core', 'ui'] }, 'roadmapper.roadmap');
    assert.ok(text.startsWith(AGENT_SECTION_START) && text.endsWith(AGENT_SECTION_END));
    assert.match(text, /`plans\/`/);
    assert.match(text, /`core`, `ui`/);
    assert.match(text, /`blocked`/);
    assert.match(text, /temp:roadmapper\/roadmapper\.md/);
    assert.match(text, /`owner:`/);
});

test('upsertSection appends once, then replaces in place', () => {
    const first = upsertSection('# Project\n\nNotes.\n', `${AGENT_SECTION_START}\nv1\n${AGENT_SECTION_END}`);
    assert.equal(first, `# Project\n\nNotes.\n\n${AGENT_SECTION_START}\nv1\n${AGENT_SECTION_END}\n`);
    const second = upsertSection(first + '\nAfter.\n', `${AGENT_SECTION_START}\nv2\n${AGENT_SECTION_END}`);
    assert.equal(second, `# Project\n\nNotes.\n\n${AGENT_SECTION_START}\nv2\n${AGENT_SECTION_END}\n\nAfter.\n`);
    assert.equal(upsertSection('', 'S'), 'S\n');
});

test('plans sent back from review come first, with their follow-ups', () => {
    const tree = folder('plans', [folder('01-alpha', [file('api.md'), file('ui.md')])]);
    const contents = new Map([
        ['plans/01-alpha/api.md', '---\nstatus: todo\nowner: claude\n---\n# API\n- [x] a\n\n## Follow-ups\n\n- [ ] Rename it\n'],
        ['plans/01-alpha/ui.md', '---\nstatus: todo\n---\n# UI\n'],
    ]);
    const project = buildProject(tree, 'plans', contents, { lanes: [] });
    const work = nextWork(project);
    assert.deepEqual(work.followUps.map(p => p.title), ['API']);
    assert.deepEqual(work.ready.map(p => p.title), ['UI']);
    const brief = roadmapBrief(project, { today: '2026-11-16', roadmapResource: 'r.roadmap' });
    assert.match(brief, /## Sent back from review\n\n.*\n\n- API — .*\n  - \[ \] Rename it/);
    assert.match(agentInstructions({ root: 'plans', lanes: [] }, 'r.roadmap'), /Follow-ups come first/);
});
