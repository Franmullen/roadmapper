// Road view: the high-level view. Each milestone is a stop along one road, showing its due date, how
// many plans are done, a bar split by status, the lanes working in it, and its plans. A "Today" marker
// sits between the stages by due date. Click a plan to open its file, or drag it to another stage to
// move it there; click a stage's title (or its background) to open the milestone.

import { STATUSES, STATUS_LABELS, isComplete, isMilestoneOverdue, todayMarkerIndex } from '../model.js';
import { button, dependencyChip, dragPayload, dueChip, el, icon, inlinePrompt, statusBar, statusDot } from '../ui.js';

const MAX_LANE_TAGS = 4;

function planRow(ctx, plan) {
    const row = el('li', 'stage-plan');
    row.tabIndex = 0;
    row.title = `Open ${plan.path}`;
    row.append(statusDot(plan.status), el('span', 'stage-plan-title', plan.title));
    const deps = dependencyChip(plan);
    if (deps) row.appendChild(deps);
    if (plan.total > 0) {
        row.appendChild(el('span', plan.done === plan.total ? 'card-tasks complete' : 'card-tasks', `${plan.done}/${plan.total}`));
    }

    const open = event => {
        event.stopPropagation();
        ctx.open(plan.resource);
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', event => {
        if (event.key === 'Enter') open(event);
    });
    ctx.drag.makeDraggable(row, dragPayload(plan));
    return row;
}

function stage(ctx, milestone) {
    const total = milestone.plans.length;
    const classes = ['stage'];
    if (milestone.unsorted) classes.push('unsorted');
    if (isComplete(milestone)) classes.push('complete');
    if (isMilestoneOverdue(milestone, ctx.today)) classes.push('overdue');
    if (milestone.counts.blocked) classes.push('has-blocked');

    const card = el('section', classes.join(' '));
    const open = () => ctx.showMilestone(milestone.folder);

    const head = el('div', 'stage-head');
    head.appendChild(button('stage-title', milestone.title, open, `Show ${milestone.title} in detail`));
    if (isComplete(milestone)) head.appendChild(icon('check-circle-fill'));
    card.appendChild(head);
    card.appendChild(el('div', 'stage-folder', milestone.unsorted ? `${milestone.folder}/` : milestone.name));

    const due = dueChip(milestone, ctx.today);
    if (due) card.appendChild(due);

    const figure = el('div', 'stage-figure');
    figure.append(el('span', 'stage-done', String(milestone.counts.done)), el('span', 'stage-total', ` / ${total} done`));
    card.appendChild(figure);
    card.appendChild(statusBar(milestone.counts, total));

    const counts = el('div', 'stage-counts');
    for (const status of STATUSES.filter(s => s !== 'done' && milestone.counts[s])) {
        counts.appendChild(el('span', `stage-count status-${status}`, `${milestone.counts[status]} ${STATUS_LABELS[status].toLowerCase()}`));
    }
    if (counts.childElementCount) card.appendChild(counts);

    const lanes = [...new Set(milestone.plans.map(plan => plan.lane).filter(Boolean))];
    if (lanes.length) {
        const tags = el('div', 'stage-lanes');
        for (const lane of lanes.slice(0, MAX_LANE_TAGS)) tags.appendChild(el('span', 'lane-tag', lane));
        if (lanes.length > MAX_LANE_TAGS) tags.appendChild(el('span', 'lane-more', `+${lanes.length - MAX_LANE_TAGS}`));
        card.appendChild(tags);
    }

    if (total > 0) {
        const list = el('ol', 'stage-plans');
        for (const plan of milestone.plans) list.appendChild(planRow(ctx, plan));
        card.appendChild(list);
    }

    // The background of a stage opens it too; its plans and buttons do their own thing.
    card.addEventListener('click', event => {
        if (!event.target.closest('button, .stage-plan')) open();
    });
    ctx.drag.makeDropTarget(card, { folder: milestone.folder });
    return card;
}

function todayMarker(ctx) {
    const marker = el('div', 'today-marker');
    marker.title = `Today, ${ctx.today}`;
    marker.append(el('span', 'today-label', 'Today'), el('span', 'today-line'));
    return marker;
}

export default {
    id: 'road',
    label: 'Road',
    icon: 'signpost-2',
    zoomable: true,
    fitAlign: 'center',
    render(container, project, ctx) {
        const line = el('div', 'road');
        const loose = project.milestones.filter(m => m.unsorted);
        const stages = project.milestones.filter(m => !m.unsorted);
        const markerAt = todayMarkerIndex(stages, ctx.today);

        for (const milestone of loose) {
            line.appendChild(stage(ctx, milestone));
            line.appendChild(el('div', 'road-gap'));
        }
        stages.forEach((milestone, index) => {
            if (index > 0) line.appendChild(el('div', 'connector'));
            if (index === markerAt) line.appendChild(todayMarker(ctx));
            line.appendChild(stage(ctx, milestone));
        });
        if (markerAt === stages.length) line.appendChild(todayMarker(ctx));

        if (stages.length > 0) line.appendChild(el('div', 'connector write-only'));
        const add = button('stage stage-add write-only', [icon('plus-lg'), el('span', '', 'Milestone')]);
        add.addEventListener('click', () => inlinePrompt(add, 'Milestone name, then Enter', ctx.createMilestone));
        line.appendChild(add);

        container.appendChild(line);
    },
};
