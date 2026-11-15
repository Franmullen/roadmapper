// Roadmapper editor. The .roadmap document holds the board's settings: the root folder, the lane order
// and whether lanes are shown. Everything else is read from the root folder: each subfolder is a
// milestone, its README.md describes it, and each other Markdown file below it is a plan. Front matter
// on a plan gives its status and lane. Every change made on the board is written back to those files,
// and a file watch keeps the board in step with edits made anywhere, by people or agents.

import celbridge from '/assets/celbridge-client/celbridge.js';
import { ContentLoadedReason } from '/assets/celbridge-client/api/document-api.js';
import {
    STATUSES, STATUS_LABELS, agentInstructions, buildColumns, displayName, isOverdue, laneOrder, milestoneTemplate,
    nextMilestoneFolder, normalizeFolder, parseConfig, planTemplate, serializeConfig, setFrontMatter,
    summarizeMarkdown, summarizeMilestone, uniqueFileName, upsertSection,
} from './scan.js';
import { createDragController } from './drag.js';

const client = celbridge;

const TREE_DEPTH = 8;
const RESCAN_DELAY_MS = 250;
const NO_LANE = '';

const boardEl = document.getElementById('board');
const rootInput = document.getElementById('root-input');
const summaryEl = document.getElementById('summary');
const refreshButton = document.getElementById('refresh');
const addMilestoneButton = document.getElementById('add-milestone');
const addLaneButton = document.getElementById('add-lane');
const lanesButton = document.getElementById('toggle-lanes');
const agentButton = document.getElementById('agent-instructions');
const messageEl = document.getElementById('message');
const messageText = document.getElementById('message-text');
const createRootButton = document.getElementById('create-root');

const drag = createDragController({
    onDrop: (payload, target) => applyDrop(payload, target),
    canDrag: () => writable,
    scrollContainer: boardEl,
});

let config = { root: 'plans', lanes: [], showLanes: false };
let documentResource = '';
let writable = true;
let dirty = false;
let watchId = null;
let scanToken = 0;
let rescanTimer = null;
let rootMissing = false;

// The last scan, and the milestone open in the detail view (null for the board).
let columns = [];
let detailFolder = null;

// A render waits while an inline input has focus, so a rescan cannot throw away what is being typed.
let renderDeferred = false;
let pendingScroll = null;

// --- Settings document ---

function applyContent(content) {
    try {
        config = parseConfig(content);
        showMessage('');
    } catch (e) {
        console.warn('[Roadmapper] Could not parse the .roadmap file:', e);
        showMessage('This .roadmap file is not valid JSON, so the default folder "plans" is shown.');
    }
    rootInput.value = config.root;
}

function reportChange() {
    if (!writable) {
        return;
    }
    dirty = true;
    client.document.notifyChanged();
}

async function save() {
    if (!dirty || !writable) {
        return;
    }
    try {
        await client.document.save(serializeConfig(config));
        dirty = false;
    } catch (e) {
        console.error('[Roadmapper] Failed to save:', e);
        await notify('error', 'Roadmapper could not save its settings.');
    }
}

async function changeRoot(value) {
    const root = normalizeFolder(value);
    if (!root || root === config.root) {
        rootInput.value = config.root;
        return;
    }
    config.root = root;
    rootInput.value = root;
    detailFolder = null;
    reportChange();
    await startWatch();
    await scan();
}

// --- Host helpers ---

async function notify(severity, message, action) {
    try {
        await client.dialog.showNotification(severity, message, action);
    } catch (e) {
        console.warn('[Roadmapper] Could not show a notification:', e);
    }
}

async function readFile(resource) {
    const result = JSON.parse(await client.cel.file.read(resource));
    return result.content ?? result.Content ?? '';
}

async function openFile(resource) {
    try {
        await client.cel.document.open(resource, '', false, true);
    } catch (e) {
        console.warn(`[Roadmapper] Could not open ${resource}:`, e);
    }
}

const stripRoot = key => key.replace(/^project:/, '');
const baseName = resource => resource.slice(resource.lastIndexOf('/') + 1);
const parentFolder = resource => resource.slice(0, resource.lastIndexOf('/'));

function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// --- Reading the folder ---

function escapeGlob(text) {
    return text.replace(/[\\*?[\]{},!]/g, ch => `\\${ch}`);
}

// One watch on the root folder. Any change below it, from Celbridge or outside, schedules a rescan.
async function startWatch() {
    const previous = watchId;
    watchId = null;
    try {
        watchId = await client.document.watchFiles(
            { root: 'project:', include: `${escapeGlob(config.root)}/**` },
            scheduleScan);
    } catch (e) {
        console.warn('[Roadmapper] Could not watch the folder:', e);
    }
    if (previous !== null) {
        try {
            await client.document.unwatchFiles(previous);
        } catch {
            // Ending a watch that already ended is harmless.
        }
    }
}

function scheduleScan() {
    clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scan, RESCAN_DELAY_MS);
}

async function scan() {
    const token = ++scanToken;
    const root = config.root;

    let tree;
    try {
        tree = JSON.parse(await client.cel.file.getTree(root, TREE_DEPTH, '', ''));
    } catch (e) {
        if (token !== scanToken) return;
        console.warn(`[Roadmapper] Could not read "${root}":`, e);
        rootMissing = true;
        columns = [];
        detailFolder = null;
        boardEl.replaceChildren();
        summaryEl.textContent = '';
        showMessage(`The folder "${root}" does not exist yet.`, writable);
        return;
    }
    rootMissing = false;

    const scanned = buildColumns(tree, root);
    const resources = scanned.flatMap(column => [
        ...column.cards.map(card => card.resource),
        ...(column.metaResource ? [column.metaResource] : []),
    ]);

    const contents = new Map();
    if (resources.length > 0) {
        try {
            const result = JSON.parse(await client.cel.file.readMany(JSON.stringify(resources)));
            for (const entry of result.files ?? result.Files ?? []) {
                contents.set(stripRoot(entry.resource ?? entry.Resource ?? ''), entry.content ?? entry.Content ?? '');
            }
        } catch (e) {
            console.warn('[Roadmapper] Could not read the plan files:', e);
        }
    }

    if (token !== scanToken) return;

    for (const column of scanned) {
        const meta = column.metaResource
            ? summarizeMilestone(contents.get(column.metaResource))
            : { title: null, due: null, description: '' };
        column.title = column.unsorted ? 'Unsorted' : (meta.title || displayName(column.name));
        column.due = meta.due;
        column.description = meta.description;
        for (const card of column.cards) {
            Object.assign(card, summarizeMarkdown(contents.get(card.resource), card.name));
        }
        column.doneCards = column.cards.filter(card => card.status === 'done').length;
    }

    columns = scanned;
    showMessage(columns.length === 0
        ? `"${root}" is empty. Add a milestone to start planning.`
        : '');
    render();
}

// --- Changing plans ---

// Writes front matter keys into a plan. The file is read fresh, so an edit made since the last scan is kept.
async function updatePlan(resource, updates) {
    try {
        const content = await readFile(resource);
        await client.cel.file.write(resource, setFrontMatter(content, updates));
        return true;
    } catch (e) {
        console.error('[Roadmapper] Could not update a plan:', e);
        await notify('error', `Could not update ${baseName(resource)}.`);
        return false;
    }
}

async function moveFile(resource, folder) {
    const column = columns.find(c => c.folder === folder);
    const name = baseName(resource);
    if (column?.cards.some(card => card.resource === `${folder}/${name}`)) {
        await notify('warning', `${column.title} already has a file named ${name}.`);
        return false;
    }
    try {
        const result = await client.cel.explorer.move(resource, folder);
        const text = typeof result === 'string' ? result.trim() : JSON.stringify(result);
        if (text !== 'ok' && text !== '"ok"') {
            const failure = JSON.parse(text);
            const reason = failure.failedResources?.[0]?.message ?? 'the move was refused';
            await notify('error', `Could not move ${name}: ${reason}`);
            return false;
        }
        return true;
    } catch (e) {
        console.error('[Roadmapper] Move failed:', e);
        await notify('error', `Could not move ${name}.`);
        return false;
    }
}

// A drop can change a plan's lane and status (front matter) and its milestone (folder). The front matter
// is written before the move, while the file is still where the scan found it.
async function applyDrop(payload, target) {
    const updates = {};
    if (target.lane !== undefined && target.lane !== payload.lane) {
        updates.lane = target.lane || null;
    }
    if (target.status && target.status !== payload.status) {
        updates.status = target.status;
    }
    if (Object.keys(updates).length > 0) {
        await updatePlan(payload.resource, updates);
    }
    if (target.folder && target.folder !== payload.from) {
        await moveFile(payload.resource, target.folder);
    }
    await scan();
    if (renderDeferred) render();
}

function namesInFolder(folder) {
    const names = ['README.md', '_milestone.md'];
    for (const column of columns) {
        for (const card of column.cards) {
            if (parentFolder(card.resource) === folder) names.push(card.name);
        }
    }
    return names;
}

async function createPlan(folder, lane, title) {
    const resource = `${folder}/${uniqueFileName(namesInFolder(folder), title)}`;
    try {
        await client.cel.file.write(resource, planTemplate({ title, lane }));
    } catch (e) {
        console.error('[Roadmapper] Could not create a plan:', e);
        await notify('error', `Could not create ${baseName(resource)}.`);
    }
    await scan();
}

async function createMilestone(title) {
    const folderNames = columns.filter(c => !c.unsorted).map(c => c.name);
    const folder = `${config.root}/${nextMilestoneFolder(folderNames, title)}`;
    try {
        if (rootMissing) {
            await client.cel.explorer.createFolder(config.root);
        }
        await client.cel.explorer.createFolder(folder);
        await client.cel.file.write(`${folder}/README.md`, milestoneTemplate(title));
    } catch (e) {
        console.error('[Roadmapper] Could not create a milestone:', e);
        await notify('error', `Could not create the milestone "${title}".`);
    }
    await startWatch();
    await scan();
}

async function createMilestoneReadme(column) {
    const resource = `${column.folder}/README.md`;
    try {
        await client.cel.file.write(resource, milestoneTemplate(column.title));
        await openFile(resource);
    } catch (e) {
        console.error('[Roadmapper] Could not create a README:', e);
    }
}

function addLane(name) {
    const lane = name.trim();
    if (lane && !config.lanes.includes(lane)) {
        config.lanes = [...laneOrder(config.lanes, allCards()), lane].filter((l, i, a) => a.indexOf(l) === i);
        reportChange();
    }
    render();
}

async function addAgentInstructions() {
    const section = agentInstructions(
        { ...config, lanes: laneOrder(config.lanes, allCards()) },
        stripRoot(documentResource) || 'the .roadmap file');
    let existing = '';
    try {
        existing = await readFile('CLAUDE.md');
    } catch {
        // No CLAUDE.md yet, so one is created.
    }
    const updated = upsertSection(existing, section);
    const action = { resource: 'project:CLAUDE.md', label: 'Open CLAUDE.md' };
    if (updated === existing) {
        await notify('info', 'The Roadmapper instructions in CLAUDE.md are up to date.', action);
        return;
    }
    try {
        await client.cel.file.write('CLAUDE.md', updated);
        await notify('info', existing ? 'Updated the Roadmapper section in CLAUDE.md.' : 'Created CLAUDE.md with instructions for AI agents.', action);
    } catch (e) {
        console.error('[Roadmapper] Could not write CLAUDE.md:', e);
        await notify('error', 'Could not write CLAUDE.md.');
    }
}

// --- Rendering helpers ---

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function icon(name) {
    return el('i', `bi bi-${name}`);
}

function allCards() {
    return columns.flatMap(column => column.cards);
}

function progressBar(done, total, title) {
    const bar = el('div', 'progress');
    bar.title = title ?? `${done} of ${total} done`;
    const fill = el('div', 'progress-fill');
    fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    bar.appendChild(fill);
    return bar;
}

function statusChip(status) {
    return el('span', `status-chip status-${status}`, STATUS_LABELS[status]);
}

function dueChip(column) {
    if (!column.due) return null;
    const overdue = isOverdue(column.due, today(), column.cards.length > 0 && column.doneCards === column.cards.length);
    const chip = el('span', overdue ? 'due-chip overdue' : 'due-chip', overdue ? `Overdue · ${column.due}` : `Due ${column.due}`);
    chip.prepend(icon('calendar-event'), ' ');
    return chip;
}

// Replaces a button with a text input. Enter (or leaving the field with text in it) submits; Escape cancels.
function inlinePrompt(button, placeholder, onSubmit) {
    const input = el('input', 'inline-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.spellcheck = false;
    button.replaceWith(input);
    input.focus();

    let finished = false;
    const finish = async submit => {
        if (finished) return;
        finished = true;
        const value = input.value.trim();
        input.replaceWith(button);
        if (submit && value) {
            await onSubmit(value);
        } else if (renderDeferred) {
            render();
        }
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(input.value.trim() !== ''));
}

function addPlanButton(folder, lane) {
    const button = el('button', 'add-plan write-only');
    button.type = 'button';
    button.append(icon('plus'), ' Add plan');
    button.addEventListener('click', () => inlinePrompt(button, 'Plan title, then Enter', title => createPlan(folder, lane, title)));
    return button;
}

function milestoneHeader(column, { detail = false } = {}) {
    const header = el('header', 'column-header');

    const titleRow = el('div', 'title-row');
    if (detail) {
        titleRow.appendChild(el('h1', '', column.title));
    } else {
        const title = el('button', 'milestone-title', column.title);
        title.type = 'button';
        title.title = 'Show this milestone in detail';
        title.addEventListener('click', () => showDetail(column.folder));
        titleRow.appendChild(title);
    }
    titleRow.appendChild(el('span', 'count', column.cards.length ? `${column.doneCards}/${column.cards.length}` : '0'));
    header.appendChild(titleRow);

    const metaRow = el('div', 'meta-row');
    const folderLink = el('button', 'folder-link', column.unsorted ? `${column.folder}/` : column.name);
    folderLink.type = 'button';
    folderLink.title = 'Show this folder in the Explorer';
    folderLink.addEventListener('click', () => client.cel.explorer.select(column.folder, true).catch(() => { }));
    metaRow.appendChild(folderLink);
    const due = dueChip(column);
    if (due) metaRow.appendChild(due);
    header.appendChild(metaRow);

    if (column.cards.length > 0) {
        header.appendChild(progressBar(column.doneCards, column.cards.length, `${column.doneCards} of ${column.cards.length} plans done`));
    }
    return header;
}

function renderCard(card, column, { showLane }) {
    const item = el('li', `card status-edge-${card.status}`);
    item.tabIndex = 0;
    item.title = `Open ${card.resource}`;

    item.appendChild(el('div', 'card-title', card.title));

    const tags = el('div', 'card-tags');
    tags.appendChild(statusChip(card.status));
    if (showLane && card.lane) tags.appendChild(el('span', 'lane-tag', card.lane));
    if (card.total > 0) {
        tags.appendChild(el('span', card.done === card.total ? 'card-tasks complete' : 'card-tasks', `${card.done}/${card.total}`));
    }
    item.appendChild(tags);

    item.appendChild(el('div', 'card-file', card.resource.slice(column.folder.length + 1)));
    if (card.total > 0) {
        item.appendChild(progressBar(card.done, card.total, `${card.done} of ${card.total} tasks done`));
    }

    item.addEventListener('click', () => openFile(card.resource));
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            openFile(card.resource);
        }
    });
    wireDrag(item, card, column);
    return item;
}

function wireDrag(element, card, column) {
    drag.makeDraggable(element, { resource: card.resource, from: column.folder, lane: card.lane, status: card.status });
}

function wireDropTarget(element, target) {
    drag.makeDropTarget(element, target);
}

// --- Views ---

function render() {
    const active = document.activeElement;
    if (active?.classList.contains('inline-input') || drag.isDragging()) {
        renderDeferred = true;
        return;
    }
    renderDeferred = false;

    const scroll = pendingScroll ?? { left: boardEl.scrollLeft, top: boardEl.scrollTop };
    pendingScroll = null;

    lanesButton.setAttribute('aria-pressed', String(config.showLanes));
    addLaneButton.hidden = !config.showLanes || detailFolder !== null;
    renderSummary();

    const detail = detailFolder !== null ? columns.find(c => c.folder === detailFolder) : null;
    if (detailFolder !== null && !detail) {
        detailFolder = null;
    }

    if (detail) {
        boardEl.className = 'detail-mode';
        boardEl.replaceChildren(renderDetail(detail));
    } else if (config.showLanes) {
        boardEl.className = 'lanes-mode';
        boardEl.replaceChildren(renderLanes());
    } else {
        boardEl.className = 'columns-mode';
        boardEl.replaceChildren(...columns.map(renderColumn));
    }
    boardEl.scrollLeft = scroll.left;
    boardEl.scrollTop = scroll.top;
}

function renderSummary() {
    const cards = allCards();
    const milestones = columns.filter(c => !c.unsorted).length;
    const count = status => cards.filter(card => card.status === status).length;
    const parts = [
        `${milestones} milestone${milestones === 1 ? '' : 's'}`,
        `${cards.length} plan${cards.length === 1 ? '' : 's'}`,
        `${count('done')} done`,
    ];
    if (count('doing')) parts.push(`${count('doing')} doing`);
    if (count('blocked')) parts.push(`${count('blocked')} blocked`);
    summaryEl.textContent = parts.join(' · ');
}

function renderColumn(column) {
    const section = el('section', column.unsorted ? 'column unsorted' : 'column');
    section.appendChild(milestoneHeader(column));

    const list = el('ol', 'cards');
    for (const card of column.cards) {
        list.appendChild(renderCard(card, column, { showLane: true }));
    }
    if (column.cards.length === 0) {
        list.appendChild(el('li', 'empty', 'No plans yet'));
    }
    if (column.truncated) {
        list.appendChild(el('li', 'empty', 'Some files are nested too deeply to show'));
    }
    section.appendChild(list);
    section.appendChild(addPlanButton(column.folder, NO_LANE));

    wireDropTarget(section, { folder: column.folder });
    return section;
}

function renderLanes() {
    const lanes = [...laneOrder(config.lanes, allCards()), NO_LANE];
    const grid = el('div', 'lanes-grid');
    grid.style.gridTemplateColumns = `var(--rm-lane-label-width) repeat(${columns.length}, var(--rm-column-width))`;

    grid.appendChild(el('div', 'lanes-corner'));
    for (const column of columns) {
        const head = el('div', column.unsorted ? 'lane-column-head unsorted' : 'lane-column-head');
        head.appendChild(milestoneHeader(column));
        grid.appendChild(head);
    }

    for (const lane of lanes) {
        const laneCards = allCards().filter(card => card.lane === lane);
        const label = el('div', lane ? 'lane-label' : 'lane-label no-lane');
        label.appendChild(el('div', 'lane-name', lane || 'No lane'));
        const doing = laneCards.filter(card => card.status === 'doing').length;
        label.appendChild(el('div', 'lane-stats', `${laneCards.length} plan${laneCards.length === 1 ? '' : 's'}${doing ? ` · ${doing} doing` : ''}`));
        grid.appendChild(label);

        for (const column of columns) {
            const cell = el('div', 'lane-cell');
            const list = el('ol', 'cards');
            for (const card of column.cards.filter(c => c.lane === lane)) {
                list.appendChild(renderCard(card, column, { showLane: false }));
            }
            cell.appendChild(list);
            cell.appendChild(addPlanButton(column.folder, lane));
            wireDropTarget(cell, { folder: column.folder, lane });
            grid.appendChild(cell);
        }
    }
    return grid;
}

function renderDetail(column) {
    const page = el('div', 'detail');

    const back = el('button', 'back-button');
    back.type = 'button';
    back.append(icon('arrow-left'), ' All milestones');
    back.addEventListener('click', () => showDetail(null));
    page.appendChild(back);

    page.appendChild(milestoneHeader(column, { detail: true }));
    if (column.description) {
        page.appendChild(el('p', 'description', column.description));
    }

    const actions = el('div', 'detail-actions');
    if (!column.unsorted) {
        const readme = el('button', 'toolbar-button');
        readme.type = 'button';
        if (column.metaResource) {
            readme.append(icon('file-earmark-text'), ' Open milestone README');
            readme.addEventListener('click', () => openFile(column.metaResource));
        } else {
            readme.classList.add('write-only');
            readme.append(icon('file-earmark-plus'), ' Add milestone README');
            readme.addEventListener('click', () => createMilestoneReadme(column));
        }
        actions.appendChild(readme);
    }
    actions.appendChild(addPlanButton(column.folder, NO_LANE));
    page.appendChild(actions);

    const groups = el('div', 'status-groups');
    for (const status of STATUSES) {
        const plans = column.cards.filter(card => card.status === status);
        const group = el('section', `status-group status-group-${status}`);
        const heading = el('h2');
        heading.append(statusChip(status), el('span', 'count', String(plans.length)));
        group.appendChild(heading);

        const list = el('ul', 'detail-list');
        for (const card of plans) {
            list.appendChild(renderDetailRow(card, column));
        }
        if (plans.length === 0) {
            list.appendChild(el('li', 'empty', 'None'));
        }
        group.appendChild(list);
        wireDropTarget(group, { status });
        groups.appendChild(group);
    }
    page.appendChild(groups);
    return page;
}

function renderDetailRow(card, column) {
    const row = el('li', 'detail-row');

    const open = el('button', 'detail-title', card.title);
    open.type = 'button';
    open.title = `Open ${card.resource}`;
    open.addEventListener('click', () => openFile(card.resource));
    row.appendChild(open);

    const meta = el('div', 'detail-meta');
    if (card.lane) meta.appendChild(el('span', 'lane-tag', card.lane));
    meta.appendChild(el('span', 'card-file', card.resource.slice(column.folder.length + 1)));
    if (card.total > 0) {
        meta.appendChild(el('span', card.done === card.total ? 'card-tasks complete' : 'card-tasks', `${card.done}/${card.total} tasks`));
    }
    if (!card.statusExplicit) {
        meta.appendChild(el('span', 'derived', 'status from checkboxes'));
    }
    row.appendChild(meta);

    const select = el('select', 'status-select');
    select.title = 'Change status';
    select.disabled = !writable;
    for (const status of STATUSES) {
        const option = el('option', '', STATUS_LABELS[status]);
        option.value = status;
        option.selected = status === card.status;
        select.appendChild(option);
    }
    select.addEventListener('change', async () => {
        await updatePlan(card.resource, { status: select.value });
        await scan();
    });
    row.appendChild(select);

    wireDrag(row, card, column);
    return row;
}

function showDetail(folder) {
    detailFolder = folder;
    pendingScroll = { left: 0, top: 0 };
    render();
}

// --- Messages, read-only state, wiring ---

function showMessage(text, offerCreate = false) {
    messageText.textContent = text;
    createRootButton.hidden = !offerCreate;
    messageEl.hidden = !text;
}

function applyWritable(state) {
    writable = state === 'Writable';
    rootInput.disabled = !writable;
    document.body.classList.toggle('read-only', !writable);
    render();
}

rootInput.addEventListener('change', () => changeRoot(rootInput.value));
rootInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') rootInput.blur();
    if (event.key === 'Escape') {
        rootInput.value = config.root;
        rootInput.blur();
    }
});
refreshButton.addEventListener('click', () => scan());
addMilestoneButton.addEventListener('click', () => inlinePrompt(addMilestoneButton, 'Milestone name, then Enter', createMilestone));
addLaneButton.addEventListener('click', () => inlinePrompt(addLaneButton, 'Lane name, then Enter', addLane));
lanesButton.addEventListener('click', () => {
    config.showLanes = !config.showLanes;
    detailFolder = null;
    reportChange();
    render();
});
agentButton.addEventListener('click', addAgentInstructions);
createRootButton.addEventListener('click', async () => {
    try {
        await client.cel.explorer.createFolder(config.root);
    } catch (e) {
        console.warn('[Roadmapper] Could not create the folder:', e);
    }
    await startWatch();
    await scan();
});
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && detailFolder !== null && !event.defaultPrevented) {
        showDetail(null);
    }
});

client.viewState.onChanged(viewState => {
    if (viewState.writable) {
        applyWritable(viewState.writable);
    }
});

try {
    await client.initializeDocument({
        onContent: async (content, metadata) => {
            documentResource = metadata?.resourceKey ?? '';
            applyContent(content);
        },

        onRequestSave: save,

        onExternalChange: async () => {
            try {
                const { content } = await client.document.load();
                applyContent(content);
                dirty = false;
                await startWatch();
                await scan();
            } catch (e) {
                console.error('[Roadmapper] Failed to reload:', e);
            }
            client.document.notifyContentLoaded(ContentLoadedReason.ExternalReload);
        },

        onRenamed: metadata => {
            documentResource = metadata?.resourceKey ?? documentResource;
        },

        onRequestState: () => JSON.stringify({
            scrollLeft: boardEl.scrollLeft, scrollTop: boardEl.scrollTop, detailFolder,
        }),

        onRestoreState: stateJson => {
            try {
                const state = JSON.parse(stateJson);
                pendingScroll = { left: state?.scrollLeft ?? 0, top: state?.scrollTop ?? 0 };
                detailFolder = typeof state?.detailFolder === 'string' ? state.detailFolder : null;
                if (columns.length > 0) render();
            } catch {
                // A malformed snapshot just means the board opens at the start.
            }
        },
    });

    await startWatch();
    await scan();
} catch (e) {
    console.error('[Roadmapper] Failed to initialize:', e);
    showMessage('Roadmapper could not connect to Celbridge.');
}
