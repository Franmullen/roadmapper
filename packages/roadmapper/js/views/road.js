// Road view: the high-level view. Each milestone is a stop along one road, showing its due date, how
// many plans are done, a bar split by status, the lanes working in it, and its plans. A "Today" marker
// sits between the stages by due date. Click a plan to open its file, or drag it to another stage to
// move it there; click a stage's title (or its background) to open the milestone.

import { STATUSES, STATUS_LABELS, isComplete, isMilestoneOverdue, planTotal, todayMarkerIndex } from '../model.js';
import {
    button, dependencyChip, dragPayload, dueChip, el, followUpChip, hiddenDoneNote, icon, inlinePrompt, reviewChecks, reviewControls,
    statusBar, statusDot,
} from '../ui.js';

const MAX_LANE_TAGS = 4;

function planRow(ctx, plan) {
    const row = el('li', 'stage-plan');
    row.tabIndex = 0;
    row.title = plan.status === 'review' ? `Open ${plan.path}\n\nIn review. ${reviewChecks(plan)}` : `Open ${plan.path}`;
    row.append(statusDot(plan.status), el('span', 'stage-plan-title', plan.title));
    const deps = dependencyChip(plan);
    if (deps) row.appendChild(deps);
    const followUps = followUpChip(plan);
    if (followUps) row.appendChild(followUps);
    if (plan.total > 0) {
        row.appendChild(el('span', plan.done === plan.total ? 'card-tasks complete' : 'card-tasks', `${plan.done}/${plan.total}`));
    }

    const review = reviewControls(ctx, plan, { compact: true });
    if (review) row.appendChild(review);

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
    const total = planTotal(milestone);
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

    const finished = hiddenDoneNote(milestone);
    if (milestone.plans.length > 0 || finished) {
        const list = el('ol', 'stage-plans');
        for (const plan of milestone.plans) list.appendChild(planRow(ctx, plan));
        if (finished) list.appendChild(el('li', 'stage-plan-more')).appendChild(finished);
        card.appendChild(list);
    }

    // The background of a stage opens it too; its plans and buttons do their own thing.
    card.addEventListener('click', event => {
        if (!event.target.closest('button, .stage-plan')) open();
    });
    ctx.drag.makeDropTarget(card, { folder: milestone.folder });
    return card;
}

// In a focused view, a short stretch of road standing for the milestones left out; click to show all.
function collapsedStretch(ctx, count, kind) {
    const text = kind === 'done' ? `${count} finished` : `${count} later`;
    const stub = button(`road-stub road-stub-${kind}`, [icon(kind === 'done' ? 'check2-all' : 'three-dots'), el('span', '', text)],
        ctx.toggleShowAll, `${count} ${kind === 'done' ? 'finished' : 'later'} milestone${count === 1 ? '' : 's'} hidden. Click to show all.`);
    return stub;
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
        // Today is placed against the whole road, hidden stretches included.
        const hidden = project.hidden;
        const before = hidden?.before.length ?? 0;
        const wholeAt = todayMarkerIndex([...(hidden?.before ?? []), ...stages, ...(hidden?.after ?? [])], ctx.today);
        const markerAt = wholeAt === null ? null : wholeAt - before;   // <0: within the finished stretch

        for (const milestone of loose) {
            line.appendChild(stage(ctx, milestone));
            line.appendChild(el('div', 'road-gap'));
        }
        if (hidden?.done) {
            line.appendChild(collapsedStretch(ctx, hidden.done, 'done'));
            if (markerAt !== null && markerAt < 0) line.appendChild(todayMarker(ctx));
            if (stages.length) line.appendChild(el('div', 'connector'));
        }
        stages.forEach((milestone, index) => {
            if (index > 0) line.appendChild(el('div', 'connector'));
            if (index === markerAt) line.appendChild(todayMarker(ctx));
            line.appendChild(stage(ctx, milestone));
        });
        if (markerAt === stages.length) line.appendChild(todayMarker(ctx));
        if (hidden?.later) {
            if (stages.length) line.appendChild(el('div', 'connector'));
            line.appendChild(collapsedStretch(ctx, hidden.later, 'later'));
            if (markerAt !== null && markerAt > stages.length) line.appendChild(todayMarker(ctx));
        }

        if (stages.length > 0) line.appendChild(el('div', 'connector write-only'));
        const add = button('stage stage-add write-only', [icon('plus-lg'), el('span', '', 'Milestone')]);
        add.addEventListener('click', () => inlinePrompt(add, 'Milestone name, then Enter', ctx.createMilestone));
        line.appendChild(add);

        container.appendChild(line);
    },
};
