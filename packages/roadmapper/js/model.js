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
//     plans: [{ resource, name, path, milestone, title, status, statusExplicit, lane, done, total }],
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

export const VIEWS = ['pipeline', 'board'];
export const DEFAULT_VIEW = 'pipeline';

export function parseConfig(text) {
    const config = { root: 'plans', lanes: [], showLanes: false, view: DEFAULT_VIEW };
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
    if (VIEWS.includes(raw.view)) config.view = raw.view;
    return config;
}

export function serializeConfig(config) {
    const out = { root: config.root };
    if (config.view !== DEFAULT_VIEW) out.view = config.view;
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

// Reads simple "key: value" front matter. Values are kept as trimmed strings without surrounding quotes.
export function parseFrontMatter(text) {
    const source = (text ?? '').replace(/^﻿/, '');
    const match = source.match(FRONT_MATTER);
    if (!match) {
        return { data: {}, body: source, hasFrontMatter: false };
    }
    const data = {};
    for (const line of match[1].split(/\r?\n/)) {
        const pair = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
        if (!pair) continue;
        let value = pair[2].replace(/\s+#.*$/, '').trim();
        if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
        data[pair[1].toLowerCase()] = value;
    }
    return { data, body: source.slice(match[0].length), hasFrontMatter: true };
}

// Sets or removes front matter keys, leaving every other line of the file as it was.
// A null or empty value removes the key. Front matter is added when the file has none.
export function setFrontMatter(text, updates) {
    const source = (text ?? '').replace(/^﻿/, '');
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const match = source.match(FRONT_MATTER);
    let lines = match ? match[1].split(/\r?\n/) : [];
    const body = match ? source.slice(match[0].length) : source;

    for (const [key, value] of Object.entries(updates)) {
        const index = lines.findIndex(line => new RegExp(`^${key}\\s*:`, 'i').test(line));
        const empty = value === null || value === undefined || String(value).trim() === '';
        if (empty) {
            if (index >= 0) lines.splice(index, 1);
        } else if (index >= 0) {
            lines[index] = `${key}: ${value}`;
        } else {
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

// Builds the columns from a file_get_tree result rooted at the board's folder.
// Markdown files directly in the root go in a leading "Unsorted" column, shown only when it has cards.
// Each subfolder is a milestone column, in natural name order, holding the Markdown files anywhere below it.
// A README.md or _milestone.md directly in a milestone folder (or the root) describes it and is not a card.
export function buildColumns(tree, root) {
    const children = tree?.children ?? [];
    const columns = [];

    const loose = children.filter(node => isMarkdown(node) && !isMilestoneFile(node)).sort(byName);
    if (loose.length > 0) {
        columns.push({
            name: 'Unsorted',
            folder: root,
            unsorted: true,
            metaResource: null,
            cards: loose.map(file => ({ name: file.name, resource: `${root}/${file.name}` })),
        });
    }

    for (const folder of children.filter(isFolder).sort(byName)) {
        const folderKey = `${root}/${folder.name}`;
        const meta = (folder.children ?? []).filter(node => isMarkdown(node) && isMilestoneFile(node)).sort(byName)[0];
        columns.push({
            name: folder.name,
            folder: folderKey,
            unsorted: false,
            truncated: folder.truncated === true,
            metaResource: meta ? `${folderKey}/${meta.name}` : null,
            cards: collectMarkdown(folder, folderKey, true),
        });
    }

    return columns;
}

function collectMarkdown(folder, prefix, topLevel) {
    const cards = [];
    for (const child of [...(folder.children ?? [])].sort(byName)) {
        const key = `${prefix}/${child.name}`;
        if (isFolder(child)) {
            cards.push(...collectMarkdown(child, key, false));
        } else if (isMarkdown(child) && !(topLevel && isMilestoneFile(child))) {
            cards.push({ name: child.name, resource: key });
        }
    }
    return cards;
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

// Builds the project every view draws from. `contents` maps resource keys to file text, for every plan
// and milestone README the tree names.
export function buildProject(tree, root, contents, config) {
    const milestones = buildColumns(tree, root).map(column => {
        const meta = column.metaResource
            ? summarizeMilestone(contents.get(column.metaResource))
            : { title: null, due: null, description: '' };
        const plans = column.cards.map(card => ({
            resource: card.resource,
            name: card.name,
            path: card.resource.slice(column.folder.length + 1),
            milestone: column.folder,
            ...summarizeMarkdown(contents.get(card.resource), card.name),
        }));
        return {
            folder: column.folder,
            name: column.name,
            title: column.unsorted ? 'Unsorted' : (meta.title || displayName(column.name)),
            due: meta.due,
            description: meta.description,
            metaResource: column.metaResource,
            unsorted: column.unsorted,
            truncated: column.truncated === true,
            plans,
            counts: statusCounts(plans),
        };
    });
    const plans = milestones.flatMap(milestone => milestone.plans);
    return { root, milestones, plans, lanes: laneOrder(config.lanes, plans) };
}

// Where the "Today" marker sits in the pipeline: before the first dated milestone due after today (a
// milestone due today sits before the marker), or at the end when every dated one is due by today.
// Null when no milestone has a date.
export function todayMarkerIndex(milestones, today) {
    if (!milestones.some(milestone => milestone.due)) return null;
    const index = milestones.findIndex(milestone => milestone.due && milestone.due > today);
    return index === -1 ? milestones.length : index;
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
