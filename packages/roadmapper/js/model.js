// The Roadmapper model: settings, front matter, and how a folder of Markdown becomes a project of
// milestones, plans and lanes, and the templates for new files. This is the only module that knows the
// file conventions (agents.js turns the model into text for AI agents), and it makes no Celbridge calls, so it can be tested with plain Node.
//
// The project every view draws from:
//   {
//     root,                                   // the board's folder
//     ideas: { resource, exists, open: [idea], processed: [idea] },   // <root>/ideas.md; idea: { text, notes, milestone, lane }
//     lanes: ['core', 'ui', ...],             // display order
//     milestones: [{ folder, name, title, due, description, metaResource, unsorted, truncated,
//                    plans: [...], counts: { todo, doing, review, done, blocked } }],
//     plans: [{ resource, name, path, milestone, title, status, statusExplicit, lane, owner, done, total,
//               openTasks: ['text'], followUps: ['text'],  // unticked tasks, and those under ## Follow-ups
//               dependsOn: ['ref'],                       // the raw `depends:` list
//               depends: [{ ref, resource, title, done, status, problem }],  // resolved; problem: missing, ambiguous, later
//               dependents: [resource],                   // plans that depend on this one
//               waitingOn }],                             // how many dependencies are not done yet
//   }

export const STATUSES = ['todo', 'doing', 'review', 'done', 'blocked'];

export const STATUS_LABELS = {
    todo: 'To do',
    doing: 'Doing',
    review: 'Review',
    done: 'Done',
    blocked: 'Blocked',
};

// Files that describe a milestone (or the whole board, at the root) rather than being a plan.
const MILESTONE_FILES = ['readme.md', '_milestone.md'];

// Ideas a person jots down for an agent to turn into plans. The file sits in the root.
export const IDEAS_FILE = 'ideas.md';

// --- Settings (.roadmap file) ---

// `view` only says how the board first opens. Switching views does not write it
// back (the editor keeps that in its own state), so using the board does not churn a shared file.
export function parseConfig(text) {
    const config = { root: 'plans', lanes: [], view: null };
    if (!text || !text.trim()) {
        return config;
    }
    const raw = JSON.parse(text);
    if (typeof raw.root === 'string' && normalizeFolder(raw.root)) {
        config.root = normalizeFolder(raw.root);
    }
    if (Array.isArray(raw.lanes)) {
        config.lanes = [...new Set(raw.lanes.filter(lane => typeof lane === 'string').map(lane => lane.trim()).filter(Boolean))];
    }
    if (typeof raw.view === 'string' && raw.view.trim()) config.view = raw.view.trim();
    return config;
}

export function serializeConfig(config) {
    const out = { root: config.root };
    if (config.view) out.view = config.view;
    if (config.lanes.length > 0) out.lanes = config.lanes;
    return JSON.stringify(out, null, 2) + '\n';
}

// "project:plans/" and "/plans" both become "plans".
export function normalizeFolder(folder) {
    return folder.trim().replace(/^project:/, '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

// --- Front matter ---

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

const KEY_LINE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;
// A line that continues the key above it: indented, or a "- item" of a block list.
const CONTINUATION = /^(\s+\S|-\s)/;

const withoutBom = text => (text ?? '').replace(/^﻿/, '');

function unquote(value) {
    return /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
}

// Reads simple "key: value" front matter. Values are trimmed strings without surrounding quotes. A block
// list ("key:" then "- item" lines) reads as its items joined with ", ", the same as an inline list.
export function parseFrontMatter(text) {
    const source = withoutBom(text);
    const match = source.match(FRONT_MATTER);
    if (!match) {
        return { data: {}, body: source, hasFrontMatter: false };
    }
    const data = {};
    let listKey = null;
    for (const line of match[1].split(/\r?\n/)) {
        const item = line.match(/^\s*-\s+(.*)$/);
        if (item && listKey) {
            const value = unquote(item[1].replace(/\s+#.*$/, '').trim());
            data[listKey] = data[listKey] ? `${data[listKey]}, ${value}` : value;
            continue;
        }
        const pair = line.match(KEY_LINE);
        if (!pair) continue;
        const key = pair[1].toLowerCase();
        data[key] = unquote(pair[2].replace(/\s+#.*$/, '').trim());
        listKey = data[key] === '' ? key : null;
    }
    return { data, body: source.slice(match[0].length), hasFrontMatter: true };
}

// "[a, b]", "a, b" and a block list all read as ['a', 'b'].
export function parseList(value) {
    return (value ?? '').replace(/^\[|\]$/g, '').split(',').map(item => unquote(item.trim())).filter(Boolean);
}

// Sets or removes front matter keys, leaving every other line of the file as it was.
// A null or empty value removes the key. Front matter is added when the file has none.
export function setFrontMatter(text, updates) {
    const source = withoutBom(text);
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const match = source.match(FRONT_MATTER);
    let lines = match ? match[1].split(/\r?\n/) : [];
    const body = match ? source.slice(match[0].length) : source;

    for (const [key, value] of Object.entries(updates)) {
        const index = lines.findIndex(line => line.match(KEY_LINE)?.[1].toLowerCase() === key.toLowerCase());
        const empty = value === null || value === undefined || String(value).trim() === '';
        if (index >= 0) {
            // The old value goes, with the items of a block list under it.
            let end = index + 1;
            while (end < lines.length && CONTINUATION.test(lines[end])) end++;
            lines.splice(index, end - index, ...(empty ? [] : [`${key}: ${value}`]));
        } else if (!empty) {
            lines.push(`${key}: ${value}`);
        }
    }

    lines = lines.filter(line => line.trim() !== '');
    if (lines.length === 0) {
        return body;
    }
    return `---${eol}${lines.join(eol)}${eol}---${eol}${body}`;
}

// --- Status ---

const STATUS_WORDS = {
    todo: 'todo', 'to do': 'todo', 'to-do': 'todo', open: 'todo', planned: 'todo', backlog: 'todo',
    doing: 'doing', 'in progress': 'doing', 'in-progress': 'doing', wip: 'doing', started: 'doing', active: 'doing',
    review: 'review', 'in review': 'review', 'in-review': 'review', testing: 'review',
    done: 'done', complete: 'done', completed: 'done', closed: 'done', finished: 'done', shipped: 'done',
    blocked: 'blocked', 'on hold': 'blocked', waiting: 'blocked',
};

export function normalizeStatus(value) {
    return STATUS_WORDS[(value ?? '').trim().toLowerCase()] ?? null;
}

// With no status in the front matter, the checkboxes decide: none ticked is todo, some is doing, all is done.
export function deriveStatus(done, total) {
    if (total > 0 && done === total) return 'done';
    if (done > 0) return 'doing';
    return 'todo';
}

// --- Reading plans and milestones ---

function firstHeading(body) {
    const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m);
    return heading ? heading[1] : null;
}

// What a plan card shows, read from its Markdown.
export function summarizeMarkdown(content, fileName) {
    const { data, body } = parseFrontMatter(content);

    const done = (body.match(/^\s*[-*+]\s+\[[xX]\]/gm) ?? []).length;
    const open = (body.match(/^\s*[-*+]\s+\[ \]/gm) ?? []).length;
    const total = done + open;

    const explicit = normalizeStatus(data.status);
    return {
        title: data.title || firstHeading(body) || fileName.replace(/\.md$/i, ''),
        done,
        total,
        status: explicit ?? deriveStatus(done, total),
        statusExplicit: explicit !== null,
        lane: (data.lane ?? '').trim(),
        owner: (data.owner ?? '').trim(),
        dependsOn: parseList(data.depends),
        ...openTasks(body),
    };
}

// --- Reviews ---
//
// A person reviews a plan in `review` from the board: approve it (done, every task ticked), or send it back
// with follow-ups, which become unticked tasks under a "## Follow-ups" heading while the plan returns to todo.

const OPEN_TASK = /^\s*[-*+]\s+\[ \]\s*(.*)$/;
const FOLLOW_UPS_HEADING = /^##\s+follow-ups?\s*$/i;
const SECTION_HEADING = /^#{1,2}\s/;

// The unticked tasks' text: all of them (what is left to do or check), and those under ## Follow-ups.
function openTasks(body) {
    const tasks = [];
    const followUps = [];
    let inFollowUps = false;
    for (const line of body.split(/\r?\n/)) {
        if (SECTION_HEADING.test(line)) inFollowUps = FOLLOW_UPS_HEADING.test(line.trim());
        const task = line.match(OPEN_TASK);
        if (!task) continue;
        tasks.push(task[1].trim());
        if (inFollowUps) followUps.push(task[1].trim());
    }
    return { openTasks: tasks, followUps };
}

// Approving a review: the plan is done and its remaining tasks (usually the checks) are ticked.
export function approveReview(text) {
    const updated = setFrontMatter(text, { status: 'done' });
    const { body } = parseFrontMatter(updated);
    return updated.slice(0, updated.length - body.length) + body.replace(/^(\s*[-*+]\s+)\[ \]/gm, '$1[x]');
}

// Sending a plan back: each follow-up becomes an unticked task under ## Follow-ups, and the plan is todo again.
export function addFollowUps(text, items) {
    const tasks = items.map(item => item.trim()).filter(Boolean).map(item => `- [ ] ${item}`);
    const source = setFrontMatter(text, { status: 'todo' });
    if (tasks.length === 0) return source;
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = source.split(/\r?\n/);

    const heading = lines.findIndex(line => FOLLOW_UPS_HEADING.test(line.trim()));
    if (heading < 0) {
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        return [...lines, '', '## Follow-ups', '', ...tasks, ''].join(eol);
    }
    // After the section's last line with text, before the next heading.
    let end = lines.findIndex((line, i) => i > heading && SECTION_HEADING.test(line));
    if (end < 0) end = lines.length;
    let last = end - 1;
    while (last > heading && lines[last].trim() === '') last--;
    if (last === heading) lines.splice(heading + 1, 0, '', ...tasks);
    else lines.splice(last + 1, 0, ...tasks);
    return lines.join(eol);
}

// What a milestone header shows, read from the milestone's README.md.
export function summarizeMilestone(content) {
    const { data, body } = parseFrontMatter(content);
    const heading = body.match(/^#\s+.*$/m);
    const afterHeading = heading ? body.slice(heading.index + heading[0].length) : body;
    const paragraph = afterHeading.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !p.startsWith('#'));
    return {
        title: data.title || firstHeading(body) || null,
        due: /^\d{4}-\d{2}-\d{2}$/.test(data.due ?? '') ? data.due : null,
        description: paragraph ? paragraph.replace(/\s*\r?\n\s*/g, ' ') : '',
    };
}

function isFolder(node) {
    return node.type === 'folder' || Array.isArray(node.children);
}

function isMarkdown(node) {
    return !isFolder(node) && /\.md$/i.test(node.name);
}

function isMilestoneFile(node) {
    return MILESTONE_FILES.includes(node.name.toLowerCase());
}

function isIdeasFile(node) {
    return node.name.toLowerCase() === IDEAS_FILE;
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// The shape of the board from a file_get_tree result rooted at the board's folder, before any file is read.
// Markdown files directly in the root form a leading "Unsorted" milestone, present only when there are some.
// Each subfolder is a milestone, in natural name order, holding the Markdown files anywhere below it.
// A README.md or _milestone.md directly in a milestone folder (or the root) describes it and is not a plan.
export function scanTree(tree, root) {
    const children = tree?.children ?? [];
    const milestones = [];

    const loose = children.filter(node => isMarkdown(node) && !isMilestoneFile(node) && !isIdeasFile(node)).sort(byName);
    if (loose.length > 0) {
        milestones.push({
            name: 'Unsorted',
            folder: root,
            unsorted: true,
            truncated: false,
            metaResource: null,
            files: loose.map(file => ({ name: file.name, resource: `${root}/${file.name}` })),
        });
    }

    for (const folder of children.filter(isFolder).sort(byName)) {
        const folderKey = `${root}/${folder.name}`;
        const meta = (folder.children ?? []).filter(node => isMarkdown(node) && isMilestoneFile(node)).sort(byName)[0];
        milestones.push({
            name: folder.name,
            folder: folderKey,
            unsorted: false,
            truncated: folder.truncated === true,
            metaResource: meta ? `${folderKey}/${meta.name}` : null,
            files: collectMarkdown(folder, folderKey, true),
        });
    }
    return milestones;
}

function collectMarkdown(folder, prefix, topLevel) {
    const files = [];
    for (const child of [...(folder.children ?? [])].sort(byName)) {
        const key = `${prefix}/${child.name}`;
        if (isFolder(child)) {
            files.push(...collectMarkdown(child, key, false));
        } else if (isMarkdown(child) && !(topLevel && isMilestoneFile(child))) {
            files.push({ name: child.name, resource: key });
        }
    }
    return files;
}

// Every file buildProject needs the text of: the milestone READMEs and the plans.
export function projectResources(tree, root) {
    const ideas = (tree?.children ?? []).find(node => !isFolder(node) && isIdeasFile(node));
    return [
        ...(ideas ? [`${root}/${ideas.name}`] : []),
        ...scanTree(tree, root).flatMap(m => [...(m.metaResource ? [m.metaResource] : []), ...m.files.map(f => f.resource)]),
    ];
}

// Folder paths in a file_get_tree result for the project, for suggesting a root. Leaves out hidden
// folders and ones that never hold plans.
const NOT_ROOTS = new Set(['packages', 'node_modules', 'dist', 'build', 'bin', 'obj', '__pycache__']);

export function folderPaths(tree, prefix = '') {
    const paths = [];
    for (const node of [...(tree?.children ?? [])].filter(isFolder).sort(byName)) {
        if (node.name.startsWith('.') || NOT_ROOTS.has(node.name.toLowerCase())) continue;
        const path = prefix ? `${prefix}/${node.name}` : node.name;
        paths.push(path, ...folderPaths(node, path));
    }
    return paths;
}

// Display name for a milestone folder: "02-first-release" reads as "First release".
export function displayName(folderName) {
    const stripped = folderName.replace(/^\d+[\s._-]*/, '').replace(/[_-]+/g, ' ').trim();
    const text = stripped || folderName;
    // Version names keep their lower-case "v": "v0.1 basics", not "V0.1 basics".
    if (/^v\d/i.test(text)) {
        return text;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
}

// Lanes in display order: the configured ones first, then any others the plans name, alphabetically.
export function laneOrder(configLanes, cards) {
    const seen = new Set(configLanes);
    const extra = [...new Set(cards.map(card => card.lane).filter(lane => lane && !seen.has(lane)))]
        .sort((a, b) => a.localeCompare(b));
    return [...configLanes, ...extra];
}

export function isOverdue(due, today, allDone) {
    return Boolean(due) && !allDone && due < today;
}

// --- The project ---

export function statusCounts(plans) {
    const counts = Object.fromEntries(STATUSES.map(status => [status, 0]));
    for (const plan of plans) counts[plan.status]++;
    return counts;
}

// A milestone's plan count, from its counts, so it stays whole when a focused view hides finished plans.
export function planTotal(milestone) {
    return STATUSES.reduce((sum, status) => sum + milestone.counts[status], 0);
}

export function isComplete(milestone) {
    const total = planTotal(milestone);
    return total > 0 && milestone.counts.done === total;
}

export function isMilestoneOverdue(milestone, today) {
    return isOverdue(milestone.due, today, isComplete(milestone));
}

// Builds the project every view draws from. `contents` maps resource keys to file text for the files
// projectResources names; a missing entry reads as an empty file.
export function buildProject(tree, root, contents, config) {
    const milestones = scanTree(tree, root).map(scanned => {
        const meta = scanned.metaResource
            ? summarizeMilestone(contents.get(scanned.metaResource))
            : { title: null, due: null, description: '' };
        const plans = scanned.files.map(file => ({
            resource: file.resource,
            name: file.name,
            path: file.resource.slice(scanned.folder.length + 1),
            milestone: scanned.folder,
            ...summarizeMarkdown(contents.get(file.resource), file.name),
        }));
        return {
            folder: scanned.folder,
            name: scanned.name,
            title: scanned.unsorted ? 'Unsorted' : (meta.title || displayName(scanned.name)),
            due: meta.due,
            description: meta.description,
            metaResource: scanned.metaResource,
            unsorted: scanned.unsorted,
            truncated: scanned.truncated,
            plans,
            counts: statusCounts(plans),
        };
    });
    const plans = milestones.flatMap(milestone => milestone.plans);
    linkDependencies(milestones, root);
    const ideasNode = (tree?.children ?? []).find(node => !isFolder(node) && isIdeasFile(node));
    const ideasResource = `${root}/${ideasNode?.name ?? IDEAS_FILE}`;
    const ideas = { resource: ideasResource, exists: Boolean(ideasNode), ...parseIdeas(contents.get(ideasResource) ?? '') };
    return { root, milestones, plans, lanes: laneOrder(config.lanes, plans), ideas };
}

// --- Ideas ---

const IDEA_ITEM = /^\s*[-*+]\s+\[([ xX])\]\s*(.*)$/;

const LIST_LINE = /^\s*[-*+]\s/;
const NOTE_LINE = /^\s+\S/;   // indented under an idea: its target, an agent's question, or a person's answer
const TARGET_NOTE = /^(milestone|lane):\s*(.+)$/i;

// The ideas, as { text, notes, milestone, lane }: unticked ones are waiting for an agent, ticked ones
// have been turned into plans. Notes are the indented lines under an idea, without their bullets; a
// "Milestone: …" or "Lane: …" note says where the person wants it, and is not listed with the others.
export function parseIdeas(text) {
    const open = [];
    const processed = [];
    let current = null;
    for (const line of withoutBom(text ?? '').split(/\r?\n/)) {
        const item = line.match(IDEA_ITEM);
        if (item && !/^\s/.test(line)) {
            current = item[2].trim() ? { text: item[2].trim(), notes: [], milestone: '', lane: '' } : null;
            if (current) (item[1] === ' ' ? open : processed).push(current);
        } else if (current && NOTE_LINE.test(line)) {
            const note = line.trim().replace(/^[-*+]\s+/, '');
            const target = note.match(TARGET_NOTE);
            if (target) current[target[1].toLowerCase()] = target[2].trim();
            else current.notes.push(note);
        } else if (line.trim()) {
            current = null;
        }
    }
    return { open, processed };
}

// The lines of the first unticked item with this text, with its notes: [start, end).
function ideaLines(lines, item) {
    const start = lines.findIndex(line => {
        const match = line.replace(/\r?\n$/, '').match(IDEA_ITEM);
        return match && !/^\s/.test(line) && match[1] === ' ' && match[2].trim() === item;
    });
    if (start < 0) return null;
    let end = start + 1;
    while (end < lines.length && NOTE_LINE.test(lines[end])) end++;
    return [start, end];
}

export function ideasTemplate() {
    return [
        '# Ideas',
        '',
        'Ideas for the agent to bake into the roadmap. Ask it to "process the ideas".',
        '',
    ].join('\n');
}

// Adds ideas to the end of the list, starting one if there is none. A target milestone or lane, when
// given, goes under each idea as a note.
export function addIdeas(text, items, { milestone = '', lane = '' } = {}) {
    const targets = [milestone && `  - Milestone: ${milestone}`, lane && `  - Lane: ${lane}`].filter(Boolean);
    const lines = items.map(item => item.trim().replace(/\s+/g, ' ')).filter(Boolean).flatMap(item => [`- [ ] ${item}`, ...targets]);
    const source = text && text.trim() ? text : ideasTemplate();
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const body = source.replace(/\s*$/, '');
    const lastLine = body.slice(body.lastIndexOf('\n') + 1);
    // Straight after an existing list; otherwise after a blank line.
    return body + eol + (LIST_LINE.test(lastLine) ? '' : eol) + lines.join(eol) + eol;
}

// Removes the first unticked item with this text, with its notes.
export function removeIdea(text, item) {
    const lines = text.split(/(?<=\n)/);
    const range = ideaLines(lines, item);
    if (range) lines.splice(range[0], range[1] - range[0]);
    return lines.join('');
}

// Answers an agent's question on an item: an indented "Answer:" line after its notes.
export function answerIdea(text, item, answer) {
    const reply = answer.trim().replace(/\s+/g, ' ');
    const lines = text.split(/(?<=\n)/);
    const range = ideaLines(lines, item);
    if (!range || !reply) return text;
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const last = range[1] - 1;
    if (!/\n$/.test(lines[last])) lines[last] += eol;
    lines.splice(range[1], 0, `  - Answer: ${reply}${eol}`);
    return lines.join('');
}

// --- Dependencies ---

// A `depends:` entry names another plan by file name ("login") or by path inside the root
// ("02-beta/login"), with or without ".md". A bare file name must be unique to resolve.
function referenceKey(ref, root) {
    let key = ref.trim().replace(/\\/g, '/').replace(/^project:/, '').replace(/^\.?\//, '').replace(/\.md$/i, '');
    if (key.toLowerCase().startsWith(`${root.toLowerCase()}/`)) key = key.slice(root.length + 1);
    return key.toLowerCase();
}

// Resolves each plan's dependsOn into `depends`, and fills `dependents` and `waitingOn`. A dependency
// scheduled in a later milestone than the plan that needs it is a `later` problem.
function linkDependencies(milestones, root) {
    const order = new Map(milestones.map((m, index) => [m.folder, m.unsorted ? null : index]));
    const plans = milestones.flatMap(m => m.plans);
    const byKey = new Map();
    const add = (key, plan) => byKey.set(key, [...(byKey.get(key) ?? []), plan]);
    for (const plan of plans) {
        const full = plan.resource.slice(root.length + 1).replace(/\.md$/i, '').toLowerCase();
        const base = plan.name.replace(/\.md$/i, '').toLowerCase();
        add(full, plan);
        if (base !== full) add(base, plan);
        plan.dependents = [];
    }

    for (const plan of plans) {
        plan.depends = plan.dependsOn.map(ref => {
            const matches = (byKey.get(referenceKey(ref, root)) ?? []).filter(other => other !== plan);
            const target = matches.length === 1 ? matches[0] : null;
            let problem = null;
            if (matches.length === 0) problem = 'missing';
            else if (!target) problem = 'ambiguous';
            else if (order.get(target.milestone) !== null && order.get(plan.milestone) !== null
                && order.get(target.milestone) > order.get(plan.milestone)) problem = 'later';
            if (target) target.dependents.push(plan.resource);
            return {
                ref,
                resource: target?.resource ?? null,
                title: target?.title ?? ref,
                done: target?.status === 'done',
                status: target?.status ?? null,
                problem,
            };
        });
        plan.waitingOn = plan.depends.filter(dep => dep.resource && !dep.done).length;
    }
}

// --- Focus: what is going on now and next ---

// The project as a focused view shows it: the milestones from the first unfinished one through the one
// after the last milestone with work started, without their finished plans. Finished milestones before
// that and untouched ones after it are left out (listed in hidden.before and hidden.after), and so is the
// Unsorted group once it is all done.
// Milestones keep their full counts, so progress still tells the whole story, and each says how many
// finished plans it hides. `hidden` says what was left out, for a "show all" control.
export function focusProject(project) {
    const ordered = project.milestones.filter(m => !m.unsorted);
    const started = m => m.plans.some(plan => plan.status !== 'todo');
    const first = ordered.findIndex(m => !isComplete(m));
    let lastStarted = -1;
    ordered.forEach((m, index) => {
        if (started(m) && !isComplete(m)) lastStarted = index;
    });
    const end = first === -1 ? -1 : Math.min(ordered.length - 1, Math.max(first, lastStarted + 1));
    const visible = new Set(first === -1 ? [] : ordered.slice(first, end + 1));

    const milestones = project.milestones
        .filter(m => visible.has(m) || (m.unsorted && !isComplete(m)))
        .map(m => {
            const plans = m.plans.filter(plan => plan.status !== 'done');
            return { ...m, plans, hiddenDone: m.plans.length - plans.length };
        });
    const plans = milestones.flatMap(m => m.plans);
    return {
        ...project,
        milestones,
        plans,
        hidden: {
            done: first === -1 ? ordered.length : first,
            later: first === -1 ? 0 : ordered.length - 1 - end,
            plans: project.plans.length - plans.length,
            before: first === -1 ? ordered : ordered.slice(0, first),
            after: first === -1 ? [] : ordered.slice(end + 1),
        },
    };
}

// Where the "Today" marker sits on the road: before the first dated milestone due after today (a
// milestone due today sits before the marker), or at the end when every dated one is due by today.
// Null when no milestone has a date.
export function todayMarkerIndex(milestones, today) {
    if (!milestones.some(milestone => milestone.due)) return null;
    const index = milestones.findIndex(milestone => milestone.due && milestone.due > today);
    return index === -1 ? milestones.length : index;
}

// --- Moving plans ---

// What dropping a plan on a target changes. A target may name a milestone folder, a lane ('' for no
// lane) and a status. Returns the front matter updates and the folder to move to (null to stay put).
export function dropChanges(payload, target) {
    const updates = {};
    if (target.lane !== undefined && target.lane !== payload.lane) updates.lane = target.lane || null;
    if (target.status && target.status !== payload.status) updates.status = target.status;
    const moveTo = target.folder && target.folder !== payload.from ? target.folder : null;
    return { updates, moveTo };
}

// --- Creating plans and milestones ---

export function slugify(title) {
    const slug = title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return slug || 'plan';
}

// A file name for a new plan that does not collide with the names already in the folder.
export function uniqueFileName(existingNames, title) {
    const taken = new Set(existingNames.map(name => name.toLowerCase()));
    const base = slugify(title);
    let name = `${base}.md`;
    for (let n = 2; taken.has(name); n++) {
        name = `${base}-${n}.md`;
    }
    return name;
}

// The folder name for a new milestone: the next number after the highest existing prefix, then the title.
export function nextMilestoneFolder(folderNames, title) {
    let highest = 0;
    let width = 2;
    for (const name of folderNames) {
        const prefix = name.match(/^(\d+)/);
        if (prefix) {
            highest = Math.max(highest, Number(prefix[1]));
            width = Math.max(width, prefix[1].length);
        }
    }
    return `${String(highest + 1).padStart(width, '0')}-${slugify(title)}`;
}

export function planTemplate({ title, lane }) {
    const frontMatter = ['---', 'status: todo'];
    if (lane) frontMatter.push(`lane: ${lane}`);
    frontMatter.push('---');
    return [...frontMatter, `# ${title}`, '', '## Goal', '', '', '## Tasks', '', '- [ ] First step', ''].join('\n');
}

export function milestoneTemplate(title) {
    return `# ${title}\n\nWhat this milestone delivers.\n`;
}
