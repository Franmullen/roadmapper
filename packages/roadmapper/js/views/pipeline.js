// Pipeline view: the high-level view. Each milestone is a stage in one line, showing its due date, how
// many plans are done, a bar split by status, and the lanes working in it. A "Today" marker sits between
// the stages by due date. Click a stage to open the milestone. It fits on screen at any size.

import { STATUSES, STATUS_LABELS, isComplete, isMilestoneOverdue, todayMarkerIndex } from '../model.js';
import { button, dueChip, el, icon, inlinePrompt, statusBar } from '../ui.js';

const MAX_LANE_TAGS = 4;

function stage(ctx, milestone) {
    const total = milestone.plans.length;
    const classes = ['stage'];
    if (milestone.unsorted) classes.push('unsorted');
    if (isComplete(milestone)) classes.push('complete');
    if (isMilestoneOverdue(milestone, ctx.today)) classes.push('overdue');
    if (milestone.counts.blocked) classes.push('has-blocked');

    const card = el('div', classes.join(' '));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = `Show ${milestone.title} in detail`;

    const head = el('div', 'stage-head');
    head.appendChild(el('div', 'stage-title', milestone.title));
    if (isComplete(milestone)) head.appendChild(icon('check-circle-fill'));
    card.appendChild(head);
    card.appendChild(el('div', 'stage-folder', milestone.unsorted ? `${milestone.folder}/` : milestone.name));

    const due = dueChip(milestone, ctx.today);
    if (due) card.appendChild(due);

    const figure = el('div', 'stage-figure');
    figure.appendChild(el('span', 'stage-done', String(milestone.counts.done)));
    figure.appendChild(el('span', 'stage-total', ` / ${total} done`));
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

    const open = () => ctx.showMilestone(milestone.folder);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            open();
        }
    });
    return card;
}

function todayMarker(ctx) {
    const marker = el('div', 'today-marker');
    marker.title = `Today, ${ctx.today}`;
    marker.append(el('span', 'today-label', 'Today'), el('span', 'today-line'));
    return marker;
}

export default {
    id: 'pipeline',
    label: 'Pipeline',
    icon: 'arrow-right-square',
    zoomable: true,
    fitAlign: 'center',
    render(container, project, ctx) {
        const line = el('div', 'pipeline');
        const loose = project.milestones.filter(m => m.unsorted);
        const stages = project.milestones.filter(m => !m.unsorted);
        const markerAt = todayMarkerIndex(stages, ctx.today);

        for (const milestone of loose) {
            line.appendChild(stage(ctx, milestone));
            line.appendChild(el('div', 'pipeline-gap'));
        }
        stages.forEach((milestone, index) => {
            if (index > 0) line.appendChild(el('div', 'connector'));
            if (index === markerAt) line.appendChild(todayMarker(ctx));
            line.appendChild(stage(ctx, milestone));
        });
        if (markerAt === stages.length) line.appendChild(todayMarker(ctx));

        if (stages.length > 0) line.appendChild(el('div', 'connector write-only'));
        const add = button('stage stage-add write-only', [icon('plus-lg'), el('span', '', 'Milestone')]);
        add.addEventListener('click', () => inlinePrompt(add, 'Milestone name, then Enter', title => ctx.run.createMilestone(title)));
        line.appendChild(add);

        container.appendChild(line);
    },
};
