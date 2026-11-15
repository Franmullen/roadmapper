// Roadmapper editor entry point. Runs the .roadmap document's lifecycle (load, save, reload), the toolbar,
// the file watch, and picks which view draws the project. The parts:
//
//   model.js     the file conventions, as pure functions (folders and Markdown -> project)
//   actions.js   every read and write to the project through Celbridge
//   views/       one file per view; each draws the project and calls back through ctx
//   viewport.js  pan and zoom for views drawn on a canvas
//   drag.js      pointer-based drag and drop
//   ui.js        shared DOM building blocks

import celbridge from '/assets/celbridge-client/celbridge.js';
import { ContentLoadedReason } from '/assets/celbridge-client/api/document-api.js';
import { normalizeFolder, parseConfig, serializeConfig } from './model.js';
import { RootMissingError, createActions } from './actions.js';
import { createDragController } from './drag.js';
import { createViewport, createZoomControls } from './viewport.js';
import { button, el, icon, inlinePrompt } from './ui.js';
import { VIEW_LIST, milestoneView } from './views/index.js';

const client = celbridge;
const RESCAN_DELAY_MS = 250;

const boardEl = document.getElementById('board');
const rootInput = document.getElementById('root-input');
const summaryEl = document.getElementById('summary');
const viewSwitch = document.getElementById('view-switch');
const refreshButton = document.getElementById('refresh');
const addMilestoneButton = document.getElementById('add-milestone');
const addLaneButton = document.getElementById('add-lane');
const lanesButton = document.getElementById('toggle-lanes');
const agentGuideButton = document.getElementById('agent-guide');
const messageEl = document.getElementById('message');
const messageText = document.getElementById('message-text');
const createRootButton = document.getElementById('create-root');

let config = parseConfig('');
let documentResource = '';
let writable = true;
let dirty = false;
let watchId = null;
let scanToken = 0;
let rescanTimer = null;
let rootMissing = false;

let project = null;
let milestoneFolder = null;
let renderDeferred = false;
let pendingDetailScroll = 0;

// --- Host helpers ---

async function notify(severity, message, action) {
    try {
        await client.dialog.showNotification(severity, message, action);
    } catch (e) {
        console.warn('[Roadmapper] Could not show a notification:', e);
    }
}

const actions = createActions(client, { notify });

const viewport = createViewport(boardEl, { onChange: state => zoomControls.update(state) });
const zoomControls = createZoomControls(viewport);

const drag = createDragController({
    onDrop: (payload, target) => act(() => actions.dropPlan(project, payload, target)),
    canDrag: () => writable,
    scrollContainer: boardEl,
    getScale: () => (viewport.isAttached() ? viewport.scale : 1),
    onEdge: (dx, dy) => { if (viewport.isAttached()) viewport.panBy(-dx, -dy); else { boardEl.scrollLeft += dx; boardEl.scrollTop += dy; } },
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

// --- Settings document ---

function applyContent(content) {
    try {
        config = parseConfig(content);
        showMessage('');
    } catch (e) {
        console.warn('[Roadmapper] Could not parse the .roadmap file:', e);
        config = parseConfig('');
        showMessage('This .roadmap file is not valid JSON, so the default settings are shown.');
    }
    rootInput.value = config.root;
}

function reportChange() {
    if (!writable) return;
    dirty = true;
    client.document.notifyChanged();
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

function changeSetting(update) {
    Object.assign(config, update);
    reportChange();
    render();
}

async function changeRoot(value) {
    const root = normalizeFolder(value);
    if (!root || root === config.root) {
        rootInput.value = config.root;
        return;
    }
    config.root = root;
    rootInput.value = root;
    milestoneFolder = null;
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

async function scan() {
    const token = ++scanToken;
    try {
        const loaded = await actions.loadProject(config);
        if (token !== scanToken) return;
        project = loaded;
        rootMissing = false;
        showMessage(project.milestones.length === 0
            ? `"${config.root}" is empty. Add a milestone to start planning.`
            : '');
    } catch (e) {
        if (token !== scanToken) return;
        if (!(e instanceof RootMissingError)) throw e;
        project = null;
        rootMissing = true;
        milestoneFolder = null;
        showMessage(`The folder "${config.root}" does not exist yet.`, writable);
    }
    render();
}

// --- Rendering ---

function viewContext() {
    return {
        config,
        writable,
        today: today(),
        milestone: milestoneFolder,
        drag,
        open: resource => actions.openFile(resource),
        reveal: folder => actions.revealFolder(folder),
        showMilestone: folder => {
            milestoneFolder = folder;
            pendingDetailScroll = 0;
            render();
        },
        run: {
            createPlan: (folder, lane, title) => act(() => actions.createPlan(project, folder, lane, title)),
            createMilestone: title => act(() => actions.createMilestone(project, config, title, rootMissing), { rewatch: rootMissing }),
            updatePlan: (resource, updates) => act(() => actions.updatePlan(resource, updates)),
            createMilestoneReadme: milestone => act(() => actions.createMilestoneReadme(milestone)),
        },
    };
}

function currentView() {
    if (milestoneFolder !== null && project?.milestones.some(m => m.folder === milestoneFolder)) {
        return milestoneView;
    }
    milestoneFolder = null;
    return VIEW_LIST.find(view => view.id === config.view) ?? VIEW_LIST[0];
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

    const content = el('div', 'rm-content');
    view.render(content, project, viewContext());

    if (view.zoomable) {
        boardEl.className = `zoomable view-${view.id}`;
        boardEl.replaceChildren(content, zoomControls.element);
        const key = view.id === 'board' && config.showLanes ? 'board-lanes' : view.id;
        viewport.attach(content, { key, align: view.fitAlign });
    } else {
        const scrollTop = pendingDetailScroll ?? boardEl.scrollTop;
        pendingDetailScroll = null;
        viewport.detach();
        boardEl.className = `view-${view.id}`;
        boardEl.replaceChildren(content);
        boardEl.scrollTop = scrollTop;
    }
}

function renderToolbar(view) {
    for (const element of viewSwitch.children) {
        element.setAttribute('aria-pressed', String(element.dataset.view === config.view && view !== milestoneView));
    }
    const onBoard = view.id === 'board';
    lanesButton.hidden = !onBoard;
    lanesButton.setAttribute('aria-pressed', String(config.showLanes));
    addLaneButton.hidden = !(onBoard && config.showLanes);

    if (!project) {
        summaryEl.textContent = '';
        return;
    }
    const count = status => project.plans.filter(plan => plan.status === status).length;
    const milestones = project.milestones.filter(m => !m.unsorted).length;
    const parts = [
        `${milestones} milestone${milestones === 1 ? '' : 's'}`,
        `${project.plans.length} plan${project.plans.length === 1 ? '' : 's'}`,
        `${count('done')} done`,
    ];
    if (count('doing')) parts.push(`${count('doing')} doing`);
    if (count('blocked')) parts.push(`${count('blocked')} blocked`);
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

for (const view of VIEW_LIST) {
    const choice = button('toolbar-button view-choice', [icon(view.icon), el('span', '', view.label)], () => {
        milestoneFolder = null;
        if (config.view !== view.id) changeSetting({ view: view.id });
        else render();
    }, `${view.label} view`);
    choice.dataset.view = view.id;
    viewSwitch.appendChild(choice);
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
addMilestoneButton.addEventListener('click', () =>
    inlinePrompt(addMilestoneButton, 'Milestone name, then Enter', title => viewContext().run.createMilestone(title)));
addLaneButton.addEventListener('click', () =>
    inlinePrompt(addLaneButton, 'Lane name, then Enter', name => {
        const lane = name.trim();
        if (lane && project && !config.lanes.includes(lane)) {
            changeSetting({ lanes: [...new Set([...project.lanes, lane])] });
            scan();
        }
    }));
lanesButton.addEventListener('click', () => changeSetting({ showLanes: !config.showLanes }));
agentGuideButton.addEventListener('click', () =>
    actions.writeAgentGuide(config, project?.lanes ?? config.lanes, documentResource));
createRootButton.addEventListener('click', () => act(() => actions.createRoot(config), { rewatch: true }));

document.addEventListener('rm-prompt-closed', () => {
    if (renderDeferred) setTimeout(render, 0);
});

document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target.closest?.('input, select, textarea')) return;
    if (event.key === 'Escape' && milestoneFolder !== null) {
        viewContext().showMilestone(null);
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
            milestone: milestoneFolder,
            zoom: viewport.exportMemory(),
            scrollTop: viewport.isAttached() ? 0 : boardEl.scrollTop,
        }),

        onRestoreState: stateJson => {
            try {
                const state = JSON.parse(stateJson);
                milestoneFolder = typeof state?.milestone === 'string' ? state.milestone : null;
                viewport.importMemory(state?.zoom);
                pendingDetailScroll = Number(state?.scrollTop) || 0;
                if (project) render();
            } catch {
                // A malformed snapshot just means the board opens fitted to the screen.
            }
        },
    });

    await startWatch();
    await scan();
} catch (e) {
    console.error('[Roadmapper] Failed to initialize:', e);
    showMessage('Roadmapper could not connect to Celbridge.');
}
