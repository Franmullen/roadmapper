// Pan and zoom for views that draw a canvas. The container clips; the content is moved and scaled with
// one CSS transform. Ctrl+wheel (and trackpad pinch) zooms at the pointer, the wheel pans, and dragging
// the background pans. Until the user moves it, the view keeps fitting itself to the container.
//
// The math is in pure functions (zoomAt, fitState) so it can be tested without a browser.

export const MIN_SCALE = 0.15;
export const MAX_SCALE = 2.5;
const PAN_THRESHOLD_PX = 4;
const FIT_PADDING_PX = 24;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Zooms by a factor, keeping the content point under (px, py) where it is on screen.
export function zoomAt(state, factor, px, py, min = MIN_SCALE, max = MAX_SCALE) {
    const scale = clamp(state.scale * factor, min, max);
    const ratio = scale / state.scale;
    return { scale, x: px - (px - state.x) * ratio, y: py - (py - state.y) * ratio };
}

// The state that shows all of a content box in a container, never enlarging past 100%.
// `align` is 'center' (both axes) or 'top' (centred across, from the top).
export function fitState(contentWidth, contentHeight, containerWidth, containerHeight,
    { padding = FIT_PADDING_PX, align = 'center', min = MIN_SCALE } = {}) {
    if (!contentWidth || !contentHeight || !containerWidth || !containerHeight) {
        return { scale: 1, x: padding, y: padding };
    }
    const scale = clamp(Math.min(
        (containerWidth - 2 * padding) / contentWidth,
        (containerHeight - 2 * padding) / contentHeight,
        1), min, 1);
    const x = (containerWidth - contentWidth * scale) / 2;
    const y = align === 'top' ? padding : (containerHeight - contentHeight * scale) / 2;
    return { scale, x: Math.max(x, padding), y: Math.max(y, padding) };
}

// Elements a press starts something on, rather than a pan.
const NO_PAN = 'input, select, textarea, .rm-draggable, .rm-zoom';

export function createViewport(container, { onChange = () => { } } = {}) {
    let content = null;
    let state = { scale: 1, x: 0, y: 0 };
    let align = 'center';
    let userMoved = false;
    let pending = null;
    let panning = null;
    let suppressClick = false;

    function apply() {
        if (content) {
            content.style.transformOrigin = '0 0';
            content.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
        }
        onChange(state);
    }

    function set(next, byUser = true) {
        state = next;
        if (byUser) userMoved = true;
        apply();
    }

    function fit() {
        if (!content) return;
        state = fitState(content.offsetWidth, content.offsetHeight, container.clientWidth, container.clientHeight, { align });
        userMoved = false;
        apply();
    }

    function zoomBy(factor, px = container.clientWidth / 2, py = container.clientHeight / 2) {
        set(zoomAt(state, factor, px, py));
    }

    // Zoom is remembered per key (one per view), so switching views and back returns to where you were.
    const memory = new Map();
    let key = null;

    // Shows new content (a re-render) at that key's zoom, or fitted if the user has not moved that view.
    function attach(element, options = {}) {
        const nextKey = options.key ?? null;
        if (nextKey !== key) {
            if (key !== null) memory.set(key, { state, userMoved });
            const saved = memory.get(nextKey);
            state = saved ? saved.state : { scale: 1, x: 0, y: 0 };
            userMoved = saved ? saved.userMoved : false;
            key = nextKey;
        }
        content = element;
        align = options.align ?? 'center';
        if (userMoved) apply();
        else fit();
    }

    // For saving with the editor's view state: only views the user has moved are worth keeping.
    function exportMemory() {
        const all = new Map(memory);
        if (key !== null) all.set(key, { state, userMoved });
        return Object.fromEntries([...all].filter(([, value]) => value.userMoved).map(([k, value]) => [k, value.state]));
    }

    function importMemory(saved) {
        for (const [k, value] of Object.entries(saved ?? {})) {
            if (value && Number.isFinite(value.scale) && Number.isFinite(value.x) && Number.isFinite(value.y)) {
                memory.set(k, { state: value, userMoved: true });
            }
        }
    }

    function detach() {
        content = null;
    }

    container.addEventListener('wheel', event => {
        if (!content) return;
        event.preventDefault();
        const rect = container.getBoundingClientRect();
        if (event.ctrlKey || event.metaKey) {
            zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top);
        } else {
            const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
            const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
            set({ ...state, x: state.x - dx, y: state.y - dy });
        }
    }, { passive: false });

    container.addEventListener('pointerdown', event => {
        if (!content || event.button !== 0 || event.target.closest(NO_PAN)) return;
        pending = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    });

    window.addEventListener('pointermove', event => {
        if (pending && !panning) {
            if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < PAN_THRESHOLD_PX) return;
            panning = { lastX: pending.x, lastY: pending.y };
            pending = null;
            container.classList.add('rm-panning');
        }
        if (!panning) return;
        set({ ...state, x: state.x + event.clientX - panning.lastX, y: state.y + event.clientY - panning.lastY });
        panning.lastX = event.clientX;
        panning.lastY = event.clientY;
    });

    const endPan = () => {
        pending = null;
        if (!panning) return;
        panning = null;
        container.classList.remove('rm-panning');
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
    };
    window.addEventListener('pointerup', endPan);
    window.addEventListener('pointercancel', endPan);

    // The click that ends a pan would otherwise open whatever the pointer was released over.
    container.addEventListener('click', event => {
        if (suppressClick) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    new ResizeObserver(() => {
        if (content && !userMoved) fit();
    }).observe(container);

    return {
        attach,
        detach,
        exportMemory,
        importMemory,
        isAttached: () => content !== null,
        fit,
        zoomBy,
        panBy: (dx, dy) => set({ ...state, x: state.x + dx, y: state.y + dy }),
        getState: () => ({ ...state }),
        hasUserMoved: () => userMoved,
        get scale() { return state.scale; },
    };
}

// The floating zoom controls: minus, percentage (click to reset to 100%), plus, fit. Made before the
// viewport (whose onChange updates them) and connected to it after.
export function createZoomControls() {
    let viewport = null;
    const box = document.createElement('div');
    box.className = 'rm-zoom';

    const button = (iconName, title, onClick) => {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'cel-icon-button';
        element.title = title;
        element.setAttribute('aria-label', title);
        element.innerHTML = `<i class="bi bi-${iconName}"></i>`;
        element.addEventListener('click', () => viewport && onClick());
        return element;
    };

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'rm-zoom-label';
    label.title = 'Zoom to 100%';
    label.addEventListener('click', () => viewport?.zoomBy(1 / viewport.scale));

    box.append(
        button('dash-lg', 'Zoom out (-)', () => viewport.zoomBy(1 / 1.25)),
        label,
        button('plus-lg', 'Zoom in (+)', () => viewport.zoomBy(1.25)),
        button('arrows-angle-contract', 'Fit to screen (0)', () => viewport.fit()),
    );

    return {
        element: box,
        connect: target => { viewport = target; },
        update: state => { label.textContent = `${Math.round(state.scale * 100)}%`; },
    };
}
