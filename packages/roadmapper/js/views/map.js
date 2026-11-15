// Map view: the whole project at once. Lanes are bands, milestones are columns, each plan is a node, and
// an arrow runs from each plan to the plans that depend on it. Zoomed out, nodes are coloured blocks;
// zoomed in, they show titles and then task counts (CSS, keyed on #board[data-zoom]). Hover a node to
// pick out its dependencies; click it to open the plan; click a milestone heading to open the milestone.
//
// Nodes keep the same size at every zoom level, so the arrows, drawn once after layout, stay attached.

import { STATUS_LABELS, planTotal } from '../model.js';
import { button, describeDependency, dueChip, el, hiddenDoneNote, statusBar, statusDot } from '../ui.js';

const NO_LANE = '';
const SVG = 'http://www.w3.org/2000/svg';
const CURVE_PX = 48;

function node(ctx, plan) {
    const item = button(`map-node status-edge-${plan.status}`, [statusDot(plan.status), el('span', 'map-title', plan.title)],
        () => ctx.open(plan.resource));
    if (plan.total > 0) item.appendChild(el('span', 'map-tasks', `${plan.done}/${plan.total}`));
    if (plan.depends.some(dep => dep.problem)) item.classList.add('has-problem');
    item.dataset.resource = plan.resource;

    const lines = [plan.title, [STATUS_LABELS[plan.status], plan.owner && `owner ${plan.owner}`, plan.path].filter(Boolean).join(' · ')];
    if (plan.total) lines.push(`${plan.done} of ${plan.total} tasks done`);
    if (plan.depends.length) lines.push('', 'Depends on:', ...plan.depends.map(describeDependency));
    if (plan.dependents.length) lines.push('', `Needed by ${plan.dependents.length} plan${plan.dependents.length === 1 ? '' : 's'}`);
    item.title = lines.join('\n');
    return item;
}

function milestoneHead(ctx, milestone) {
    const head = el('div', milestone.unsorted ? 'map-head unsorted' : 'map-head');
    const title = el('div', 'map-head-title');
    title.append(
        button('milestone-title', milestone.title, () => ctx.showMilestone(milestone.folder), `Show ${milestone.title} in detail`),
        el('span', 'count', `${milestone.counts.done}/${planTotal(milestone)}`));
    head.appendChild(title);
    const due = dueChip(milestone, ctx.today);
    const finished = hiddenDoneNote(milestone);
    if (due || finished) {
        const meta = el('div', 'meta-row');
        meta.append(...[due, finished].filter(Boolean));
        head.appendChild(meta);
    }
    head.appendChild(statusBar(milestone.counts, planTotal(milestone)));
    return head;
}

// An arrow between two nodes. Forwards (the usual case) it leaves the dependency's right edge for the
// dependent's left edge. In the same column it bows out to the right, beside the column. Backwards (a
// dependency scheduled later, a problem) it leaves the dependency's left edge for the dependent's right.
function edgePath(from, to) {
    const left = node => node.offsetLeft;
    const right = node => node.offsetLeft + node.offsetWidth;
    const y1 = from.offsetTop + from.offsetHeight / 2;
    const y2 = to.offsetTop + to.offsetHeight / 2;

    if (left(to) >= right(from)) {
        const bend = Math.max(CURVE_PX, (left(to) - right(from)) / 2);
        return `M ${right(from)} ${y1} C ${right(from) + bend} ${y1}, ${left(to) - bend} ${y2}, ${left(to)} ${y2}`;
    }
    if (right(to) <= left(from)) {
        const bend = Math.max(CURVE_PX, (left(from) - right(to)) / 2);
        return `M ${left(from)} ${y1} C ${left(from) - bend} ${y1}, ${right(to) + bend} ${y2}, ${right(to)} ${y2}`;
    }
    const x = Math.max(right(from), right(to));
    const bow = 16 + Math.min(Math.abs(y2 - y1) / 6, 18);  // stays inside the gap between columns
    return `M ${x} ${y1} C ${x + bow} ${y1}, ${x + bow} ${y2}, ${x} ${y2}`;
}

function drawEdges(grid, project) {
    const nodes = new Map([...grid.querySelectorAll('.map-node')].map(item => [item.dataset.resource, item]));
    const svg = document.createElementNS(SVG, 'svg');
    svg.classList.add('map-edges');
    svg.setAttribute('width', grid.scrollWidth);
    svg.setAttribute('height', grid.scrollHeight);
    svg.innerHTML = ['ok', 'problem'].map(kind =>
        `<marker id="rm-arrow-${kind}" class="map-arrow-${kind}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z"/></marker>`).join('');

    for (const plan of project.plans) {
        for (const dep of plan.depends) {
            const from = nodes.get(dep.resource);
            const to = nodes.get(plan.resource);
            if (!from || !to) continue;
            const path = document.createElementNS(SVG, 'path');
            const kind = dep.problem ? 'problem' : 'ok';
            path.setAttribute('d', edgePath(from, to));
            path.setAttribute('marker-end', `url(#rm-arrow-${kind})`);
            path.classList.add('map-edge', `map-edge-${kind}`);
            if (dep.done) path.classList.add('map-edge-done');
            path.dataset.from = dep.resource;
            path.dataset.to = plan.resource;
            svg.appendChild(path);
        }
    }
    grid.prepend(svg);
    return svg;
}

// Hovering a node lights it, its arrows and the plans at their other ends, and fades the rest.
function highlightOnHover(grid, svg) {
    const clear = () => {
        grid.classList.remove('map-focus');
        for (const lit of grid.querySelectorAll('.lit')) lit.classList.remove('lit');
    };
    grid.addEventListener('pointerover', event => {
        const item = event.target.closest('.map-node');
        if (!item) return;
        clear();
        const resource = item.dataset.resource;
        item.classList.add('lit');
        for (const path of svg.querySelectorAll('.map-edge')) {
            if (path.dataset.from !== resource && path.dataset.to !== resource) continue;
            path.classList.add('lit');
            const other = path.dataset.from === resource ? path.dataset.to : path.dataset.from;
            grid.querySelector(`.map-node[data-resource="${CSS.escape(other)}"]`)?.classList.add('lit');
        }
        grid.classList.add('map-focus');
    });
    grid.addEventListener('pointerout', event => {
        if (event.target.closest('.map-node') && !event.relatedTarget?.closest?.('.map-node')) clear();
    });
}

export default {
    id: 'map',
    label: 'Map',
    icon: 'diagram-3',
    zoomable: true,
    fitAlign: 'center',
    render(container, project, ctx) {
        const lanes = [...project.lanes];
        if (lanes.length === 0 || project.plans.some(plan => !plan.lane)) lanes.push(NO_LANE);

        const grid = el('div', 'map-grid');
        grid.style.gridTemplateColumns = `var(--rm-map-label-width) repeat(${project.milestones.length}, var(--rm-map-column-width))`;
        grid.appendChild(el('div', 'map-corner'));
        for (const milestone of project.milestones) grid.appendChild(milestoneHead(ctx, milestone));

        for (const lane of lanes) {
            grid.appendChild(el('div', lane ? 'map-lane' : 'map-lane no-lane', lane || 'No lane'));
            for (const milestone of project.milestones) {
                const cell = el('div', 'map-cell');
                for (const plan of milestone.plans.filter(p => p.lane === lane)) cell.appendChild(node(ctx, plan));
                grid.appendChild(cell);
            }
        }
        container.appendChild(grid);
    },
    // Arrows need the laid-out positions of the nodes, so they are drawn once the grid is on the page.
    mounted(container, project) {
        const grid = container.querySelector('.map-grid');
        highlightOnHover(grid, drawEdges(grid, project));
    },
};
