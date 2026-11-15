// Pointer-based drag and drop. Native HTML5 drag events do not arrive from a real mouse in Celbridge's
// web views, so, like Celbridge's own card list and splitter, dragging is built from pointer events.
//
// Usage:
//   const drag = createDragController({ onDrop: (payload, target) => ..., canDrag: () => writable,
//                                       scrollContainer: boardEl });
//   drag.makeDraggable(element, payload);        // anything JSON-able
//   drag.makeDropTarget(element, target);        // what a drop here means, passed to onDrop
//
// A press only becomes a drag after the pointer moves a few pixels, so a plain click still clicks.
// The click that ends a drag is swallowed. Escape cancels a drag.

const DRAG_THRESHOLD_PX = 5;
const EDGE_SCROLL_PX = 40;
const EDGE_SCROLL_STEP = 18;

// Options for a zoomed canvas: `getScale` sizes the ghost to match the zoom, and `onEdge(dx, dy)` is called
// instead of scrolling `scrollContainer` while the pointer is near its edge (a viewport pans instead).
export function createDragController({ onDrop, canDrag = () => true, scrollContainer = null, getScale = () => 1, onEdge = null }) {
    const payloads = new WeakMap();
    const targets = new WeakMap();

    let pending = null;
    let active = null;
    let suppressClick = false;

    function makeDraggable(element, payload) {
        payloads.set(element, payload);
        element.classList.add('rm-draggable');
        element.addEventListener('pointerdown', event => {
            if (event.button !== 0 || !canDrag()) return;
            if (event.target.closest('input, select, textarea')) return;
            pending = { element, x: event.clientX, y: event.clientY };
        });
    }

    function makeDropTarget(element, target) {
        targets.set(element, target);
        element.classList.add('rm-drop-zone');
    }

    function isDragging() {
        return active !== null;
    }

    function start() {
        const { element } = pending;
        const rect = element.getBoundingClientRect();
        const scale = getScale() || 1;
        const ghost = element.cloneNode(true);
        ghost.classList.add('rm-drag-ghost');
        ghost.style.width = `${rect.width / scale}px`;
        ghost.style.transform = `scale(${scale}) rotate(1.5deg)`;
        document.body.appendChild(ghost);
        element.classList.add('dragging');
        document.body.classList.add('rm-is-dragging');
        active = { ...pending, ghost, offsetX: pending.x - rect.left, offsetY: pending.y - rect.top, over: null };
        pending = null;
    }

    function dropZoneAt(x, y) {
        let node = document.elementFromPoint(x, y);
        while (node && !targets.has(node)) {
            node = node.parentElement;
        }
        return node;
    }

    function edgeScroll(x, y) {
        if (!scrollContainer) return;
        const rect = scrollContainer.getBoundingClientRect();
        let dx = 0;
        let dy = 0;
        if (x < rect.left + EDGE_SCROLL_PX) dx = -EDGE_SCROLL_STEP;
        else if (x > rect.right - EDGE_SCROLL_PX) dx = EDGE_SCROLL_STEP;
        if (y < rect.top + EDGE_SCROLL_PX) dy = -EDGE_SCROLL_STEP;
        else if (y > rect.bottom - EDGE_SCROLL_PX) dy = EDGE_SCROLL_STEP;
        if (!dx && !dy) return;
        if (onEdge) {
            onEdge(dx, dy);
        } else {
            scrollContainer.scrollLeft += dx;
            scrollContainer.scrollTop += dy;
        }
    }

    function finish(drop) {
        const { element, ghost, over } = active;
        ghost.remove();
        element.classList.remove('dragging');
        over?.classList.remove('drop-target');
        document.body.classList.remove('rm-is-dragging');
        active = null;
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        if (drop && over) {
            onDrop(payloads.get(element), targets.get(over));
        }
    }

    window.addEventListener('pointermove', event => {
        if (pending && !active) {
            if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) < DRAG_THRESHOLD_PX) return;
            start();
        }
        if (!active) return;
        active.ghost.style.left = `${event.clientX - active.offsetX}px`;
        active.ghost.style.top = `${event.clientY - active.offsetY}px`;
        const over = dropZoneAt(event.clientX, event.clientY);
        if (over !== active.over) {
            active.over?.classList.remove('drop-target');
            over?.classList.add('drop-target');
            active.over = over;
        }
        edgeScroll(event.clientX, event.clientY);
    });

    window.addEventListener('pointerup', () => {
        pending = null;
        if (active) finish(true);
    });

    window.addEventListener('pointercancel', () => {
        pending = null;
        if (active) finish(false);
    });

    window.addEventListener('keydown', event => {
        if (event.key === 'Escape' && active) {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }
    }, true);

    // The click that ends a drag would otherwise open the plan that was just dropped.
    document.addEventListener('click', event => {
        if (suppressClick) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    return { makeDraggable, makeDropTarget, isDragging };
}
