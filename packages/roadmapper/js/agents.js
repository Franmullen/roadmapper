// Everything Roadmapper says to AI agents, as pure functions over the project model:
//
//   agentInstructions   the Roadmap section of the project's CLAUDE.md: the format and how to work in it
//   nextWork            what is in progress, ready to start, waiting, blocked, or broken
//   roadmapBrief        that, as a short Markdown file an agent reads in one call (written to temp:)
//
// The roadmap steers agents through files alone: the guide says how to read and update it, and the brief
// saves working out the state. Agents launched from Celbridge (cel.agent.claude()) have the Celbridge
// file tools but no shell, so this is all plain text rather than a command to run.

import { IDEAS_FILE, STATUSES, STATUS_LABELS, isComplete } from './model.js';

export const AGENT_SECTION_START = '<!-- roadmapper:start -->';
export const AGENT_SECTION_END = '<!-- roadmapper:end -->';

// Where the board writes its brief: Celbridge's temp: root is local to this machine and never committed.
export function briefResource(roadmapResource) {
    const name = (roadmapResource || 'roadmap').replace(/^project:/, '').replace(/\.roadmap$/i, '').replace(/[\\/]/g, '-');
    return `temp:roadmapper/${name}.md`;
}

// --- What to work on ---

// A plan is ready when it has not started and every dependency it names exists and is done.
export function isReady(plan) {
    return plan.status === 'todo' && plan.depends.every(dep => dep.resource && dep.done);
}

// A plan a reviewer sent back: not started again yet, with unticked tasks under ## Follow-ups.
export function isSentBack(plan) {
    return plan.status === 'todo' && (plan.followUps?.length ?? 0) > 0;
}

// The plans grouped by what can happen next, each list in roadmap order. Sent-back plans come first.
export function nextWork(project) {
    const plans = project.plans;
    return {
        followUps: plans.filter(isSentBack),
        inProgress: plans.filter(plan => plan.status === 'doing' || plan.status === 'review'),
        ready: plans.filter(plan => isReady(plan) && !isSentBack(plan)),
        waiting: plans.filter(plan => plan.status === 'todo' && !isReady(plan) && !isSentBack(plan)),
        blocked: plans.filter(plan => plan.status === 'blocked'),
        problems: plans.flatMap(plan => plan.depends.filter(dep => dep.problem).map(dep => ({ plan, dep }))),
    };
}

// The first milestone, in order, that still has unfinished work.
export function currentMilestone(project) {
    return project.milestones.find(m => !m.unsorted && m.plans.length > 0 && !isComplete(m)) ?? null;
}

// --- The brief ---

const PROBLEM_TEXT = {
    missing: 'no plan has that name',
    ambiguous: 'more than one plan has that name; use its path',
    later: 'it is scheduled in a later milestone',
};

function planLine(plan, extra = '') {
    const facts = [plan.lane && `lane ${plan.lane}`, plan.owner && `owner ${plan.owner}`, plan.total && `${plan.done}/${plan.total} tasks`]
        .filter(Boolean).join(', ');
    return `- ${plan.title} — \`${plan.resource}\`${facts ? ` (${facts})` : ''}${extra}`;
}

// A short Markdown summary of the whole roadmap, for an agent to read in one call.
export function roadmapBrief(project, { today, roadmapResource }) {
    const work = nextWork(project);
    const current = currentMilestone(project);
    const lines = [
        `# Roadmap brief: ${project.root}/`,
        '',
        `Written by Roadmapper from \`${project.root}/\` (settings: \`${roadmapResource}\`) on ${today}. It is rewritten whenever the plans change, so edit the plans, not this file.`,
        '',
        '## Milestones',
        '',
        '| Milestone | Folder | Due | Plans | ' + STATUSES.map(s => STATUS_LABELS[s]).join(' | ') + ' |',
        '|---|---|---|---|' + STATUSES.map(() => '---').join('|') + '|',
    ];
    for (const m of project.milestones) {
        const marker = m === current ? ' ← current' : isComplete(m) ? ' ✓' : '';
        lines.push(`| ${m.title}${marker} | \`${m.folder}\` | ${m.due ?? ''} | ${m.plans.length} | ${STATUSES.map(s => m.counts[s] || '').join(' | ')} |`);
    }

    const section = (title, plans, note, extra = () => '') => {
        lines.push('', `## ${title}`, '');
        if (note) lines.push(note, '');
        lines.push(...(plans.length ? plans.map(plan => planLine(plan, extra(plan))) : ['- None']));
    };
    section('Sent back from review', work.followUps, 'A person reviewed these and asked for more. Do the follow-ups first.',
        plan => plan.followUps.map(task => `\n  - [ ] ${task}`).join(''));
    section('In progress', work.inProgress, null, plan => (plan.status === 'review' ? ' — in review' : ''));
    section('Ready to start', work.ready, 'Not started, and everything they depend on is done.');
    section('Waiting on dependencies', work.waiting, null, plan => {
        const open = plan.depends.filter(dep => !dep.done).map(dep => (dep.status === 'review' ? `${dep.title} (in review)` : dep.title));
        return open.length ? ` — waits on ${open.join(', ')}` : '';
    });
    section('Blocked', work.blocked);

    const ideas = project.ideas;
    if (ideas?.open.length) {
        lines.push('', '## Ideas', '', `Waiting in \`${ideas.resource}\` to be turned into plans:`, '');
        lines.push(...ideas.open.flatMap(idea => [
            `- [ ] ${idea.text}`,
            ...(idea.milestone ? [`  - Milestone: ${idea.milestone}`] : []),
            ...(idea.lane ? [`  - Lane: ${idea.lane}`] : []),
            ...idea.notes.map(note => `  - ${note}`),
        ]));
    }

    lines.push('', '## Problems', '');
    lines.push(...(work.problems.length
        ? work.problems.map(({ plan, dep }) => `- \`${plan.resource}\` depends on \`${dep.ref}\`, but ${PROBLEM_TEXT[dep.problem]}.`)
        : ['- None']));
    return lines.join('\n') + '\n';
}

// --- The CLAUDE.md section ---

export function agentInstructions(config, roadmapResource) {
    const root = config.root;
    const lanes = config.lanes.length > 0 ? config.lanes.map(lane => `\`${lane}\``).join(', ') : 'none defined yet';
    return [
        AGENT_SECTION_START,
        '## Roadmap (Roadmapper)',
        '',
        `This project plans its work with Roadmapper. The plan is the Markdown under \`${root}/\`. \`${roadmapResource}\` only holds board settings, so do not edit it to change the plan.`,
        '',
        '### Reading the roadmap',
        '',
        `- **The brief:** \`${briefResource(roadmapResource)}\` summarises milestones, work in progress, what is ready to start, what is waiting or blocked, and broken dependencies. The board rewrites it whenever the plans change, so it may be missing or stale while the board is closed.`,
        `- **Everything in one search:** \`file_grep\` for \`^(status|lane|owner|depends|due):|^# \` under \`${root}/\` returns every plan's title and front matter.`,
        '',
        '### The format',
        '',
        `- **Milestones** are the folders directly inside \`${root}/\`, ordered by a number prefix (\`01-…\`, \`02-…\`). Each has a \`README.md\` whose \`# heading\` names it, whose first paragraph describes it, and whose front matter may set \`due: YYYY-MM-DD\`.`,
        '- **Plans** are the other `.md` files in a milestone folder, one per piece of work, with a `# Title` and steps as `- [ ]` checkboxes.',
        `- **Plan front matter:** \`status:\` (one of ${STATUSES.map(s => `\`${s}\``).join(', ')}; without it the checkboxes decide), \`lane:\` (a parallel workstream; current lanes: ${lanes}), \`owner:\` (who is working on it), and \`depends:\`.`,
        '- **Dependencies:** `depends: other-plan, 02-beta/login` names plans that must be done first, by file name (without `.md`) or by path inside the root. Keep a dependency in the same milestone or an earlier one.',
        '- To **reschedule** a plan, move its file into another milestone folder. Keep file names lower-case with hyphens. The board updates by itself when files change.',
        '',
        `A plan, for example \`${root}/02-beta/search.md\`:`,
        '',
        '```markdown',
        '---',
        'status: todo',
        `lane: ${config.lanes[0] ?? 'core'}`,
        'depends: api',
        '---',
        '# Search',
        '',
        'What this delivers, in a sentence or two.',
        '',
        '## Tasks',
        '',
        '- [ ] Index the records',
        '- [ ] Search box with results',
        '```',
        '',
        '### Working from the roadmap',
        '',
        '- **Follow-ups come first.** A person reviewing on the board can send a plan back: it returns to `status: todo` with unticked tasks under `## Follow-ups`. Do those before new work, then return the plan to review.',
        '- **Reviews unblock work.** A plan in `review` is not done yet, so plans that depend on it wait. When a person approves it, it becomes `done` and those plans may now be ready, so read the roadmap again before picking work.',
        '- **Pick work** that is ready: `status: todo` with every dependency done, in the earliest unfinished milestone, in your lane if you were given one.',
        '- **Before you start**, set `status: doing` and `owner:` to your name, so people and other agents can see it is taken.',
        '- **As you go**, tick each checkbox (`- [x]`) when it is finished. Work you discover becomes a new plan file in the milestone where it belongs.',
        '- **When it is all done**, set `status: review` if a person should check it, otherwise `done`. Leave what the person should check as unticked `- [ ] Check: …` tasks; the board shows them to the reviewer. Link each file they should read, relative to the plan (`[architecture](../../docs/architecture.md)`), so it opens with one click. If you cannot continue, set `status: blocked` and add a sentence saying why.',
        '',
        '### Ideas',
        '',
        `\`${root}/${IDEAS_FILE}\` holds ideas a person has jotted down, as \`- [ ]\` items. When asked to process the ideas, take each unticked one in order:`,
        '',
        '- Turn it into work on the roadmap: a new plan in the milestone where it belongs, new tasks on an existing plan, or a new milestone if nothing fits. Write tasks a person can check, and set `lane:` and `depends:` where they are clear.',
        '- An indented `- Milestone: …` or `- Lane: …` line under an idea says where the person wants it. Follow it. A milestone that does not exist yet means create it. Without one, decide yourself.',
        '- Then tick the idea and add where it went, e.g. `- [x] Dark mode → plans/03-polish/dark-mode.md`.',
        '- If an idea is too unclear to plan, leave it unticked and add an indented `- Question: …` line under it. The person answers on the board with an indented `- Answer: …` line, so use any answer you find.',
        '',
        'Processing ideas only plans the work. Do the work too only when asked, working from the roadmap as above.',
        '',
        '### Presenting or building a roadmap',
        '',
        '- **Where do we stand?** Answer from the roadmap: each milestone with its progress and due date, what is in progress, what is ready next, and anything blocked, overdue or broken.',
        '- **Turning older notes into a roadmap** (TODO lists, a ROADMAP.md, a changelog): group the work into milestones in delivery order, write one plan per piece of work with its steps as tasks, mark finished work `done` with its tasks ticked, and add `depends:` where order matters. Propose the milestones before creating files, keep the old notes, and report anything you could not place.',
        AGENT_SECTION_END,
    ].join('\n');
}

// Replaces the Roadmapper section in a CLAUDE.md, or appends one.
export function upsertSection(existing, section) {
    const text = existing ?? '';
    const start = text.indexOf(AGENT_SECTION_START);
    const end = text.indexOf(AGENT_SECTION_END);
    if (start >= 0 && end > start) {
        return text.slice(0, start) + section + text.slice(end + AGENT_SECTION_END.length);
    }
    if (!text.trim()) {
        return section + '\n';
    }
    return text.replace(/\s*$/, '') + '\n\n' + section + '\n';
}
