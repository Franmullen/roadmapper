// Roadmapper editor entry point. Runs the .roadmap document's lifecycle (load, save, reload), the toolbar,
// the file watch, and picks which view draws the project. The parts:
//
//   model.js     the file conventions, as pure functions (folders and Markdown -> project)
//   actions.js   every read and write to the project through Celbridge
//   views/       one file per view (plus css/views/<id>.css); each draws the project and calls back through ctx
//   viewport.js  pan and zoom for views drawn on a canvas
//   drag.js      pointer-based drag and drop
//   ui.js        shared DOM building blocks

import celbridge from '/assets/celbridge-client/celbridge.js';
import { ContentLoadedReason } from '/assets/celbridge-client/api/document-api.js';
import { focusProject, normalizeFolder, parseConfig, serializeConfig, statusCounts } from './model.js';
import { RootMissingError, createActions } from './actions.js';
import { createDragController } from './drag.js';
import { createViewport, createZoomControls } from './viewport.js';
import { button, el, icon, inlinePrompt } from './ui.js';
import { VIEW_LIST, milestoneView } from './views/index.js';

const client = celbridge;
const RESCAN_DELAY_MS = 250;

// Zoom levels a view's CSS can use to show less detail when zoomed out: #board[data-zoom="far"] etc.
const zoomLevel = scale => (scale < 0.45 ? 'far' : scale < 0.8 ? 'mid' : 'near');

const boardEl = document.getElementById('board');
const rootInput = document.getElementById('root-input');
const summaryEl = document.getElementById('summary');
const viewSwitch = document.getElementById('view-switch');
const refreshButton = document.getElementById('refresh');
const addMilestoneButton = document.getElementById('add-milestone');
const showAllButton = document.getElementById('show-all');
const hiddenBadge = showAllButton.querySelector('.toolbar-badge');
const agentGuideButton = document.getElementById('agent-guide');
const messageEl = document.getElementById('message');
const messageText = document.getElementById('message-text');
const createRootButton = document.getElementById('create-root');

// The .roadmap file's settings, and how this editor is showing them. `ui` starts from the file's
// defaults and is then kept with the editor state, not written to the file.
let config = parseConfig('');
// By default the views focus on work now and next (see focusProject); showAll shows everything.
const ui = { view: VIEW_LIST[0].id, showAll: false, milestone: null };

let documentResource = '';
let writable = true;
let dirty = false;
let watchId = null;
let scanToken = 0;
let rescanTimer = null;
let rootMissing = false;
let project = null;
let renderDeferred = false;
let restoreScrollTop = 0;
let uiRestored = false;

// Earlier names for views, still accepted in .roadmap files and saved editor state: views that were
// renamed or removed open as the closest one left.
const VIEW_ALIASES = { pipeline: 'road', board: 'road' };
const viewId = id => VIEW_ALIASES[id] ?? id;
const isView = id => VIEW_LIST.some(view => view.id === viewId(id));

// --- Host helpers ---

async function notify(severity, message, action) {
    try {
        await client.dialog.showNotification(severity, message, action);
    } catch (e) {
        console.warn('[Roadmapper] Could not show a notification:', e);
    }
}

const actions = createActions(client, { notify });

const zoomControls = createZoomControls();
const viewport = createViewport(boardEl, {
    onChange: state => {
        zoomControls.update(state);
        boardEl.dataset.zoom = zoomLevel(state.scale);
    },
});
zoomControls.connect(viewport);

const drag = createDragController({
    onDrop: (payload, target) => act(() => actions.dropPlan(project, payload, target)),
    canDrag: () => writable,
    scrollContainer: boardEl,
    getScale: () => (viewport.isAttached() ? viewport.scale : 1),
    onEdge: (dx, dy) => {
        if (viewport.isAttached()) {
            viewport.panBy(-dx, -dy);
        } else {
            boardEl.scrollLeft += dx;
            boardEl.scrollTop += dy;
        }
    },
});

function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Runs an action that changes files, then rescans so every view shows the result straight away.
async function act(action, { rewatch = false } = {}) {
    await action();
    if (rewatch) await startWatch();
    await scan();
}

// Everything the toolbar and the views can do.
const commands = {
    open: resource => actions.openFile(resource),
    reveal: folder => actions.revealFolder(folder),
    showMilestone: folder => {
        ui.milestone = folder;
        restoreScrollTop = 0;
        render();
    },
    showView: id => {
        ui.view = id;
        ui.milestone = null;
        render();
    },
    toggleShowAll: () => {
        ui.showAll = !ui.showAll;
        render();
    },
    createPlan: (folder, lane, title) => act(() => actions.createPlan(project, folder, lane, title)),
    saveIdeas: (items, target) => act(() => actions.saveIdeas(project, items, target)),
    deleteIdea: item => act(() => actions.deleteIdea(project, item)),
    replyToIdea: (item, answer) => act(() => actions.replyToIdea(project, item, answer)),
    createMilestone: title => act(() => actions.createMilestone(project, config, title, rootMissing), { rewatch: rootMissing }),
    updatePlan: (resource, updates) => act(() => actions.updatePlan(resource, updates)),
    approvePlan: resource => act(() => actions.reviewPlan(resource)),
    sendBackPlan: (resource, followUps) => act(() => actions.reviewPlan(resource, followUps)),
    createMilestoneReadme: milestone => act(() => actions.createMilestoneReadme(milestone)),
    createRoot: () => act(() => actions.createRoot(config), { rewatch: true }),
    writeAgentGuide: () => actions.writeAgentGuide(config, project?.lanes ?? config.lanes, documentResource),
};

// --- Settings document ---

// The file's view only sets where the editor opens, so they apply on the first load and
// only when the editor has no saved state of its own.
function applyContent(content, { firstLoad = false } = {}) {
    try {
        config = parseConfig(content);
        showMessage('');
    } catch (e) {
        console.warn('[Roadmapper] Could not parse the .roadmap file:', e);
        config = parseConfig('');
        showMessage('This .roadmap file is not valid JSON, so the default settings are shown.');
    }
    if (firstLoad && !uiRestored) {
        if (isView(config.view)) ui.view = viewId(config.view);
    }
    rootInput.value = config.root;
}

async function save() {
    if (!dirty || !writable) return;
    try {
        await client.document.save(serializeConfig(config));
        dirty = false;
    } catch (e) {
        console.error('[Roadmapper] Failed to save:', e);
        await notify('error', 'Roadmapper could not save its settings.');
    }
}

function changeSettings(update) {
    if (!writable) return;
    Object.assign(config, update);
    dirty = true;
    client.document.notifyChanged();
    render();
}

async function changeRoot(value) {
    const root = normalizeFolder(value);
    if (!root || root === config.root) {
        rootInput.value = config.root;
        return;
    }
    ui.milestone = null;
    changeSettings({ root });
    rootInput.value = root;
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
            () => {
                clearTimeout(rescanTimer);
                rescanTimer = setTimeout(scan, RESCAN_DELAY_MS);
            });
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

// Never throws: it runs from timers and event handlers, so a failure is shown rather than lost.
async function scan() {
    const token = ++scanToken;
    try {
        const loaded = await actions.loadProject(config);
        if (token !== scanToken) return;
        project = loaded;
        rootMissing = false;
        actions.writeBrief(project, documentResource, today());
        showMessage(project.milestones.length === 0 ? `"${config.root}" is empty. Add a milestone to start planning.` : '');
    } catch (e) {
        if (token !== scanToken) return;
        if (e instanceof RootMissingError) {
            project = null;
            rootMissing = true;
            ui.milestone = null;
            showMessage(`The folder "${config.root}" does not exist yet.`, writable);
        } else {
            // Keep showing the last good project; the next file change or Refresh tries again.
            console.error('[Roadmapper] Could not read the plans:', e);
            showMessage(`Could not read the plans in "${config.root}". Press Refresh to try again.`);
        }
    }
    render();
}

// --- Rendering ---

function viewContext() {
    return { config, ui, writable, today: today(), milestone: ui.milestone, drag, ...commands };
}

function currentView() {
    if (ui.milestone !== null && project?.milestones.some(m => m.folder === ui.milestone)) {
        return milestoneView;
    }
    ui.milestone = null;
    return VIEW_LIST.find(view => view.id === ui.view) ?? VIEW_LIST[0];
}

function render() {
    // Wait while something is being typed or dragged, so a rescan cannot pull it out from under the user.
    if (document.activeElement?.classList.contains('inline-input') || drag.isDragging()) {
        renderDeferred = true;
        return;
    }
    renderDeferred = false;

    const view = currentView();
    renderToolbar(view);
    if (!project) {
        viewport.detach();
        boardEl.className = '';
        boardEl.replaceChildren();
        return;
    }

    // The milestone and Reviews views always show everything; the others focus unless asked to show all.
    const shown = view === milestoneView || view.unfocused || ui.showAll ? project : focusProject(project);
    const ctx = viewContext();
    const content = el('div', 'rm-content');
    view.render(content, shown, ctx);
    const kept = keptInput();

    if (view.zoomable) {
        boardEl.className = `zoomable view-${view.id}`;
        boardEl.replaceChildren(content, zoomControls.element);
        view.mounted?.(content, shown, ctx);
        viewport.attach(content, { key: view.id, align: view.fitAlign });
    } else {
        // A re-render keeps the scroll position; opening a view (or restoring state) sets it.
        const scrollTop = restoreScrollTop ?? boardEl.scrollTop;
        restoreScrollTop = null;
        viewport.detach();
        boardEl.className = `view-${view.id}`;
        boardEl.replaceChildren(content);
        view.mounted?.(content, shown, ctx);
        boardEl.scrollTop = scrollTop;
    }
    restoreInput(kept);
}

// A field marked data-keep-focus (like the ideas box) survives a re-render, so a rescan never loses what
// is being typed into it.
function keptInput() {
    const input = document.activeElement;
    const key = input?.dataset?.keepFocus;
    return key ? { key, value: input.value, start: input.selectionStart, end: input.selectionEnd } : null;
}

function restoreInput(kept) {
    if (!kept) return;
    const input = boardEl.querySelector(`[data-keep-focus="${kept.key}"]`);
    if (!input) return;
    input.value = kept.value;
    input.focus();
    input.setSelectionRange(kept.start, kept.end);
}

function renderToolbar(view) {
    for (const element of viewSwitch.children) {
        element.setAttribute('aria-pressed', String(element.dataset.view === ui.view && view !== milestoneView));
    }
    for (const choice of viewSwitch.children) {
        const badge = choice.querySelector('.toolbar-badge');
        const count = VIEW_LIST.find(v => v.id === choice.dataset.view)?.badge?.(project) ?? 0;
        if (!badge) continue;
        badge.textContent = String(count);
        badge.hidden = !count;
    }
    showAllButton.hidden = !project || view === milestoneView || view.unfocused;
    showAllButton.setAttribute('aria-pressed', String(ui.showAll));
    if (project && !ui.showAll) {
        const { hidden } = focusProject(project);
        const parts = [
            hidden.done && `${hidden.done} finished milestone${hidden.done === 1 ? '' : 's'}`,
            hidden.later && `${hidden.later} later milestone${hidden.later === 1 ? '' : 's'}`,
            hidden.plans && `${hidden.plans} plan${hidden.plans === 1 ? '' : 's'}`,
        ].filter(Boolean);
        showAllButton.title = parts.length ? `Showing work now and next. Hidden: ${parts.join(', ')}.` : 'Nothing is hidden';
        hiddenBadge.textContent = String(hidden.plans);
        hiddenBadge.hidden = !hidden.plans;
    } else {
        showAllButton.title = 'Back to work now and next';
        hiddenBadge.hidden = true;
    }

    if (!project) {
        summaryEl.textContent = '';
        return;
    }
    const counts = statusCounts(project.plans);
    const milestones = project.milestones.filter(m => !m.unsorted).length;
    const parts = [
        `${milestones} milestone${milestones === 1 ? '' : 's'}`,
        `${project.plans.length} plan${project.plans.length === 1 ? '' : 's'}`,
        `${counts.done} done`,
    ];
    if (counts.doing) parts.push(`${counts.doing} doing`);
    if (counts.review) parts.push(`${counts.review} in review`);
    if (counts.blocked) parts.push(`${counts.blocked} blocked`);
    summaryEl.textContent = parts.join(' · ');
}

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

// --- Wiring ---

// Each view brings its own stylesheet, css/views/<id>.css.
for (const view of [...VIEW_LIST, milestoneView]) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `css/views/${view.id}.css`;
    document.head.appendChild(link);
}

for (const view of VIEW_LIST) {
    const content = [icon(view.icon), el('span', '', view.label)];
    if (view.badge) {
        const badge = el('span', 'toolbar-badge');
        badge.hidden = true;
        content.push(badge);
    }
    const choice = button('toolbar-button view-choice', content, () => commands.showView(view.id), `${view.label} view`);
    choice.dataset.view = view.id;
    viewSwitch.appendChild(choice);
}

// The root field suggests the project's folders as you type.
const rootFolders = document.getElementById('root-folders');
rootInput.addEventListener('focus', async () => {
    const folders = await actions.listFolders();
    rootFolders.replaceChildren(...folders.map(folder => Object.assign(document.createElement('option'), { value: folder })));
});
rootInput.addEventListener('change', () => changeRoot(rootInput.value));
rootInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') rootInput.blur();
    if (event.key === 'Escape') {
        rootInput.value = config.root;
        rootInput.blur();
    }
});
refreshButton.addEventListener('click', () => scan());
addMilestoneButton.addEventListener('click', () =>
    inlinePrompt(addMilestoneButton, 'Milestone name, then Enter', commands.createMilestone));
showAllButton.addEventListener('click', commands.toggleShowAll);
agentGuideButton.addEventListener('click', commands.writeAgentGuide);
createRootButton.addEventListener('click', commands.createRoot);

document.addEventListener('rm-prompt-closed', () => {
    if (renderDeferred) setTimeout(render, 0);
});

document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, select, textarea')) return;
    if (event.key === 'Escape' && ui.milestone !== null) {
        commands.showMilestone(null);
    } else if (viewport.isAttached() && (event.key === '+' || event.key === '=')) {
        viewport.zoomBy(1.25);
    } else if (viewport.isAttached() && event.key === '-') {
        viewport.zoomBy(1 / 1.25);
    } else if (viewport.isAttached() && event.key === '0') {
        viewport.fit();
    } else {
        return;
    }
    event.preventDefault();
});

client.viewState.onChanged(viewState => {
    if (viewState.writable) applyWritable(viewState.writable);
});

try {
    await client.initializeDocument({
        onContent: async (content, metadata) => {
            documentResource = metadata?.resourceKey ?? '';
            applyContent(content, { firstLoad: true });
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
            view: ui.view,
            showAll: ui.showAll,
            milestone: ui.milestone,
            zoom: viewport.exportMemory(),
            scrollTop: viewport.isAttached() ? 0 : boardEl.scrollTop,
        }),

        onRestoreState: stateJson => {
            try {
                const state = JSON.parse(stateJson);
                uiRestored = true;
                if (isView(state?.view)) ui.view = viewId(state.view);
                if (typeof state?.showAll === 'boolean') ui.showAll = state.showAll;
                ui.milestone = typeof state?.milestone === 'string' ? state.milestone : null;
                viewport.importMemory(state?.zoom);
                restoreScrollTop = Number(state?.scrollTop) || 0;
                if (project) render();
            } catch {
                // A malformed snapshot just means the board opens with the file's defaults.
            }
        },
    });

    await startWatch();
    await scan();
} catch (e) {
    console.error('[Roadmapper] Failed to initialize:', e);
    showMessage('Roadmapper could not connect to Celbridge.');
}
