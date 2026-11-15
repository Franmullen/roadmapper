// Board view: the editing view. Milestones as columns of plan cards, or, with lanes on, a grid of lanes
// (rows) by milestones (columns). Dropping a card on a column moves its file; on a lane cell it also
// sets the plan's lane.

import { addPlanButton, el, milestoneHeader, planCard } from '../ui.js';

const NO_LANE = '';

function renderColumns(container, project, ctx) {
    const row = el('div', 'board-columns');
    for (const milestone of project.milestones) {
        const section = el('section', milestone.unsorted ? 'column unsorted' : 'column');
        section.appendChild(milestoneHeader(ctx, milestone));

        const list = el('ol', 'cards');
        for (const plan of milestone.plans) {
            list.appendChild(planCard(ctx, plan));
        }
        if (milestone.plans.length === 0) list.appendChild(el('li', 'empty', 'No plans yet'));
        if (milestone.truncated) list.appendChild(el('li', 'empty', 'Some files are nested too deeply to show'));
        section.appendChild(list);
        section.appendChild(addPlanButton(ctx, milestone.folder, NO_LANE));

        ctx.drag.makeDropTarget(section, { folder: milestone.folder });
        row.appendChild(section);
    }
    container.appendChild(row);
}

function renderLanes(container, project, ctx) {
    const lanes = [...project.lanes, NO_LANE];
    const grid = el('div', 'lanes-grid');
    grid.style.gridTemplateColumns = `var(--rm-lane-label-width) repeat(${project.milestones.length}, var(--rm-column-width))`;

    grid.appendChild(el('div', 'lanes-corner'));
    for (const milestone of project.milestones) {
        const head = el('div', milestone.unsorted ? 'lane-column-head unsorted' : 'lane-column-head');
        head.appendChild(milestoneHeader(ctx, milestone));
        grid.appendChild(head);
    }

    for (const lane of lanes) {
        const lanePlans = project.plans.filter(plan => plan.lane === lane);
        const label = el('div', lane ? 'lane-label' : 'lane-label no-lane');
        label.appendChild(el('div', 'lane-name', lane || 'No lane'));
        const doing = lanePlans.filter(plan => plan.status === 'doing').length;
        label.appendChild(el('div', 'lane-stats',
            `${lanePlans.length} plan${lanePlans.length === 1 ? '' : 's'}${doing ? ` · ${doing} doing` : ''}`));
        grid.appendChild(label);

        for (const milestone of project.milestones) {
            const cell = el('div', 'lane-cell');
            const list = el('ol', 'cards');
            for (const plan of milestone.plans.filter(p => p.lane === lane)) {
                list.appendChild(planCard(ctx, plan, { showLane: false }));
            }
            cell.appendChild(list);
            cell.appendChild(addPlanButton(ctx, milestone.folder, lane));
            ctx.drag.makeDropTarget(cell, { folder: milestone.folder, lane });
            grid.appendChild(cell);
        }
    }
    container.appendChild(grid);
}

export default {
    id: 'board',
    label: 'Board',
    icon: 'kanban',
    zoomable: true,
    fitAlign: 'top',
    render(container, project, ctx) {
        if (ctx.config.showLanes) renderLanes(container, project, ctx);
        else renderColumns(container, project, ctx);
    },
};
