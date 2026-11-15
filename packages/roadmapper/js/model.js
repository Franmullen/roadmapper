// The Roadmapper model: settings, front matter, and how a folder of Markdown becomes a project of
// milestones, plans and lanes. Also the text Roadmapper writes. This is the only module that knows the
// file conventions, and it makes no Celbridge calls, so it can be tested with plain Node.
//
// The project every view draws from:
//   {
//     root,                                   // the board's folder
//     lanes: ['core', 'ui', ...],             // display order
//     milestones: [{ folder, name, title, due, description, metaResource, unsorted, truncated,
//                    plans: [...], counts: { todo, doing, review, done, blocked } }],
//     plans: [{ resource, name, path, milestone, title, status, statusExplicit, lane, done, total,
//               dependsOn: ['ref'],                       // the raw `depends:` list
//               depends: [{ ref, resource, title, done, problem }],  // resolved; problem: missing, ambiguous, later
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

// --- Settings (.roadmap file) ---

// `view` and `showLanes` only say how the board first opens. Switching on the board does not write them
// back (the editor keeps that in its own state), so using the board does not churn a shared file.
export function parseConfig(text) {
    const config = { root: 'plans', lanes: [], showLanes: false, view: null };
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
    config.showLanes = raw.showLanes === true;
    if (typeof raw.view === 'string' && raw.view.trim()) config.view = raw.view.trim();
    return config;
}

export function serializeConfig(config) {
    const out = { root: config.root };
    if (config.view) out.view = config.view;
    if (config.lanes.length > 0) out.lanes = config.lanes;
    if (config.showLanes) out.showLanes = true;
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
        dependsOn: parseList(data.depends),
    };
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

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// The shape of the board from a file_get_tree result rooted at the board's folder, before any file is read.
// Markdown files directly in the root form a leading "Unsorted" milestone, present only when there are some.
// Each subfolder is a milestone, in natural name order, holding the Markdown files anywhere below it.
// A README.md or _milestone.md directly in a milestone folder (or the root) describes it and is not a plan.
export function scanTree(tree, root) {
    const children = tree?.children ?? [];
    const milestones = [];

    const loose = children.filter(node => isMarkdown(node) && !isMilestoneFile(node)).sort(byName);
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
    return scanTree(tree, root).flatMap(m => [...(m.metaResource ? [m.metaResource] : []), ...m.files.map(f => f.resource)]);
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

export function isComplete(milestone) {
    return milestone.plans.length > 0 && milestone.counts.done === milestone.plans.length;
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
    return { root, milestones, plans, lanes: laneOrder(config.lanes, plans) };
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
                problem,
            };
        });
        plan.waitingOn = plan.depends.filter(dep => dep.resource && !dep.done).length;
    }
}

// Where the "Today" marker sits in the pipeline: before the first dated milestone due after today (a
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

// --- Agent instructions (a section in the project's CLAUDE.md) ---

export const AGENT_SECTION_START = '<!-- roadmapper:start -->';
export const AGENT_SECTION_END = '<!-- roadmapper:end -->';

export function agentInstructions(config, roadmapResource) {
    const lanes = config.lanes.length > 0 ? config.lanes.map(lane => `\`${lane}\``).join(', ') : 'none defined yet';
    return [
        AGENT_SECTION_START,
        '## Roadmap (Roadmapper)',
        '',
        `This project plans its work with Roadmapper. The plan is the Markdown under \`${config.root}/\`. \`${roadmapResource}\` only holds board settings, so do not edit it to change the plan.`,
        '',
        `- **Milestones** are the folders directly inside \`${config.root}/\`, ordered by a number prefix (\`01-…\`, \`02-…\`). To add one, create the next numbered folder with a \`README.md\` whose \`# heading\` names it, whose first paragraph describes it, and whose front matter may set \`due: YYYY-MM-DD\`.`,
        '- **Plans** are the other `.md` files in a milestone folder, one per piece of work. Start each with a `# Title` and list steps as `- [ ]` checkboxes.',
        `- **Front matter** on a plan sets \`status:\` (one of ${STATUSES.map(s => `\`${s}\``).join(', ')}) and \`lane:\` (a parallel workstream; current lanes: ${lanes}).`,
        '- **Dependencies:** `depends: other-plan, 02-beta/login` names plans that must be done first, by file name (without `.md`) or by path inside the root. Keep a dependency in the same milestone or an earlier one.',
        '- **When you work on a plan**, set `status: doing`, tick each checkbox (`- [x]`) as you finish it, and set `status: done` when all of it is complete. Use `status: blocked` with a sentence saying why.',
        '- **To reschedule** a plan, move its file into another milestone folder. Keep file names lower-case with hyphens.',
        '- The board updates by itself when these files change.',
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
