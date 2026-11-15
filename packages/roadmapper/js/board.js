// Roadmapper editor. The .roadmap document holds one setting, the root folder. Everything on the
// board is read from that folder: each subfolder is a milestone column and each Markdown file below it
// is a card. Clicking a card opens its file. Dragging a card to another column moves the file into that
// column's folder. A file watch keeps the board in step with edits made anywhere, by people or agents.

import celbridge from '/assets/celbridge-client/celbridge.js';
import { ContentLoadedReason } from '/assets/celbridge-client/api/document-api.js';
import { buildColumns, displayName, normalizeFolder, parseConfig, serializeConfig, summarizeMarkdown } from './scan.js';

const client = celbridge;

const CARD_MIME = 'application/x-roadmapper-card';
const TREE_DEPTH = 8;
const RESCAN_DELAY_MS = 250;

const boardEl = document.getElementById('board');
const rootInput = document.getElementById('root-input');
const summaryEl = document.getElementById('summary');
const refreshButton = document.getElementById('refresh');
const messageEl = document.getElementById('message');
const messageText = document.getElementById('message-text');
const createRootButton = document.getElementById('create-root');

let config = { root: 'plans' };
let writable = true;
let dirty = false;
let watchId = null;
let scanToken = 0;
let rescanTimer = null;
let pendingScrollLeft = 0;

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
        await client.dialog.showNotification('error', 'Roadmapper could not save its settings.');
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
    reportChange();
    await startWatch();
    await scan();
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

const stripRoot = key => key.replace(/^project:/, '');

async function scan() {
    const token = ++scanToken;
    const root = config.root;

    let tree;
    try {
        tree = JSON.parse(await client.cel.file.getTree(root, TREE_DEPTH, '', ''));
    } catch (e) {
        if (token !== scanToken) return;
        console.warn(`[Roadmapper] Could not read "${root}":`, e);
        boardEl.replaceChildren();
        summaryEl.textContent = '';
        showMessage(`The folder "${root}" does not exist yet.`, writable);
        return;
    }

    const columns = buildColumns(tree, root);
    const resources = columns.flatMap(column => column.cards.map(card => card.resource));

    const contents = new Map();
    if (resources.length > 0) {
        try {
            const result = JSON.parse(await client.cel.file.readMany(JSON.stringify(resources)));
            for (const entry of result.files ?? result.Files ?? []) {
                const key = stripRoot(entry.resource ?? entry.Resource ?? '');
                contents.set(key, entry.content ?? entry.Content ?? '');
            }
        } catch (e) {
            console.warn('[Roadmapper] Could not read the plan files:', e);
        }
    }

    if (token !== scanToken) return;

    for (const column of columns) {
        for (const card of column.cards) {
            Object.assign(card, summarizeMarkdown(contents.get(card.resource), card.name));
        }
    }

    showMessage(columns.length === 0
        ? `"${root}" is empty. Add a subfolder for each milestone, and Markdown files inside them.`
        : '');
    render(columns);
}

// --- Rendering ---

function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function progressBar(done, total) {
    const bar = el('div', 'progress');
    bar.title = `${done} of ${total} tasks done`;
    const fill = el('div', 'progress-fill');
    fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    bar.appendChild(fill);
    return bar;
}

function render(columns) {
    const scrollLeft = pendingScrollLeft || boardEl.scrollLeft;
    pendingScrollLeft = 0;

    let cardCount = 0;
    let doneTasks = 0;
    let totalTasks = 0;

    const columnEls = columns.map(column => {
        const section = el('section', column.unsorted ? 'column unsorted' : 'column');
        section.dataset.folder = column.folder;

        const header = el('header', 'column-header');
        const title = el('h2', '', column.unsorted ? 'Unsorted' : displayName(column.name));
        const count = el('span', 'count', String(column.cards.length));
        const folderLink = el('button', 'folder-link', column.unsorted ? `${column.folder}/` : column.name);
        folderLink.type = 'button';
        folderLink.title = 'Show this folder in the Explorer';
        folderLink.addEventListener('click', () => client.cel.explorer.select(column.folder, true).catch(() => { }));
        header.append(title, count, folderLink);
        section.appendChild(header);

        const done = column.cards.reduce((sum, card) => sum + card.done, 0);
        const total = column.cards.reduce((sum, card) => sum + card.total, 0);
        if (total > 0) {
            section.appendChild(progressBar(done, total));
        }
        cardCount += column.cards.length;
        doneTasks += done;
        totalTasks += total;

        const list = el('ol', 'cards');
        for (const card of column.cards) {
            list.appendChild(renderCard(card, column));
        }
        if (column.cards.length === 0) {
            list.appendChild(el('li', 'empty', 'No plans yet'));
        }
        if (column.truncated) {
            list.appendChild(el('li', 'empty', 'Some files are nested too deeply to show'));
        }
        section.appendChild(list);

        wireDropTarget(section, column);
        return section;
    });

    boardEl.replaceChildren(...columnEls);
    boardEl.scrollLeft = scrollLeft;

    const milestones = columns.filter(c => !c.unsorted).length;
    const parts = [`${milestones} milestone${milestones === 1 ? '' : 's'}`, `${cardCount} plan${cardCount === 1 ? '' : 's'}`];
    if (totalTasks > 0) parts.push(`${doneTasks}/${totalTasks} tasks`);
    summaryEl.textContent = parts.join(' · ');
}

function renderCard(card, column) {
    const item = el('li', 'card');
    item.tabIndex = 0;
    item.draggable = writable;
    item.dataset.resource = card.resource;
    item.title = `Open ${card.resource}`;

    item.appendChild(el('div', 'card-title', card.title));

    const meta = el('div', 'card-meta');
    const relative = card.resource.slice(column.folder.length + 1);
    meta.appendChild(el('span', 'card-file', relative));
    if (card.total > 0) {
        meta.appendChild(el('span', card.done === card.total ? 'card-tasks complete' : 'card-tasks', `${card.done}/${card.total}`));
    }
    item.appendChild(meta);
    if (card.total > 0) {
        item.appendChild(progressBar(card.done, card.total));
    }

    item.addEventListener('click', () => openFile(card.resource));
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            openFile(card.resource);
        }
    });
    item.addEventListener('dragstart', event => {
        event.dataTransfer.setData(CARD_MIME, JSON.stringify({ resource: card.resource, from: column.folder, name: card.name }));
        event.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    return item;
}

async function openFile(resource) {
    try {
        await client.cel.document.open(resource, '', false, true);
    } catch (e) {
        console.warn(`[Roadmapper] Could not open ${resource}:`, e);
    }
}

// --- Moving cards between milestones ---

function wireDropTarget(section, column) {
    const accepts = event => writable && event.dataTransfer.types.includes(CARD_MIME);

    section.addEventListener('dragover', event => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        section.classList.add('drop-target');
    });
    section.addEventListener('dragleave', event => {
        if (!section.contains(event.relatedTarget)) {
            section.classList.remove('drop-target');
        }
    });
    section.addEventListener('drop', async event => {
        section.classList.remove('drop-target');
        if (!accepts(event)) return;
        event.preventDefault();
        const drag = JSON.parse(event.dataTransfer.getData(CARD_MIME));
        await moveCard(drag, column);
    });
}

async function moveCard(drag, column) {
    if (drag.from === column.folder) {
        return;
    }

    const destination = `${column.folder}/${drag.name}`;
    if (column.cards.some(card => card.resource === destination)) {
        await client.dialog.showNotification('warning', `${column.name} already has a file named ${drag.name}.`);
        return;
    }

    try {
        const result = await client.cel.explorer.move(drag.resource, column.folder);
        const text = typeof result === 'string' ? result.trim() : JSON.stringify(result);
        if (text !== 'ok' && text !== '"ok"') {
            const failure = JSON.parse(text);
            const reason = failure.failedResources?.[0]?.message ?? 'the move was refused';
            await client.dialog.showNotification('error', `Could not move ${drag.name}: ${reason}`);
        }
    } catch (e) {
        console.error('[Roadmapper] Move failed:', e);
        await client.dialog.showNotification('error', `Could not move ${drag.name}.`);
    }
    await scan();
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
    for (const card of boardEl.querySelectorAll('.card')) {
        card.draggable = writable;
    }
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
createRootButton.addEventListener('click', async () => {
    try {
        await client.cel.explorer.createFolder(config.root);
    } catch (e) {
        console.warn('[Roadmapper] Could not create the folder:', e);
    }
    await startWatch();
    await scan();
});

client.viewState.onChanged(viewState => {
    if (viewState.writable) {
        applyWritable(viewState.writable);
    }
});

try {
    await client.initializeDocument({
        onContent: async content => applyContent(content),

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

        onRequestState: () => JSON.stringify({ scrollLeft: boardEl.scrollLeft }),

        onRestoreState: stateJson => {
            try {
                pendingScrollLeft = JSON.parse(stateJson)?.scrollLeft ?? 0;
                boardEl.scrollLeft = pendingScrollLeft;
            } catch {
                // A malformed snapshot just means the board opens scrolled to the start.
            }
        },
    });

    await startWatch();
    await scan();
} catch (e) {
    console.error('[Roadmapper] Failed to initialize:', e);
    showMessage('Roadmapper could not connect to Celbridge.');
}
