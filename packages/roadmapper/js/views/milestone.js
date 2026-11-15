// Milestone view: one milestone in detail. Its description, due date and progress, then its plans
// grouped by status. Change a plan's status from its dropdown, or drag it to another status group.
// Opened from the other views; ctx.milestone names which milestone to show.

import { STATUSES, STATUS_LABELS } from '../model.js';
import {
    addPlanButton, button, dependencyChip, dependencyLinks, dragPayload, el, followUpChip, icon, inlinePrompt, milestoneHeader, ownerTag,
    reviewControls,
    statusChip,
} from '../ui.js';

const NEW_LANE = '\u0000new';

// A plan's lane (swimlane on the Map): pick one of the lanes in use, none, or start a new one.
function laneSelect(ctx, plan, lanes) {
    const select = el('select', plan.lane ? 'lane-select' : 'lane-select no-lane');
    select.title = 'Lane: the swimlane this plan sits in on the Map';
    select.disabled = !ctx.writable;
    const choices = [['', 'No lane'], ...lanes.map(lane => [lane, lane]), [NEW_LANE, 'New lane…']];
    for (const [value, label] of choices) {
        const option = el('option', '', label);
        option.value = value;
        option.selected = value === plan.lane;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        if (select.value !== NEW_LANE) {
            ctx.updatePlan(plan.resource, { lane: select.value });
            return;
        }
        select.value = plan.lane;
        inlinePrompt(select, 'Lane name, then Enter', name => ctx.updatePlan(plan.resource, { lane: name.trim().toLowerCase().replace(/\s+/g, '-') }));
    });
    return select;
}

function planRow(ctx, plan, lanes) {
    const row = el('li', 'detail-row');

    row.appendChild(button('detail-title', plan.title, () => ctx.open(plan.resource), `Open ${plan.resource}`));

    const meta = el('div', 'detail-meta');
    meta.appendChild(laneSelect(ctx, plan, lanes));
    if (plan.owner) meta.appendChild(ownerTag(plan));
    meta.appendChild(el('span', 'card-file', plan.path));
    if (plan.total > 0) {
        meta.appendChild(el('span', plan.done === plan.total ? 'card-tasks complete' : 'card-tasks', `${plan.done}/${plan.total} tasks`));
    }
    const deps = dependencyChip(plan);
    if (deps) meta.appendChild(deps);
    if (plan.dependents.length) {
        meta.appendChild(el('span', 'derived', `needed by ${plan.dependents.length} plan${plan.dependents.length === 1 ? '' : 's'}`));
    }
    if (!plan.statusExplicit) meta.appendChild(el('span', 'derived', 'status from checkboxes'));
    row.appendChild(meta);
    const followUps = followUpChip(plan);
    if (followUps) meta.appendChild(followUps);
    if (plan.depends.length) row.appendChild(dependencyLinks(ctx, plan));
    if (plan.status === 'review') row.appendChild(reviewPanel(ctx, plan));

    const select = el('select', 'status-select');
    select.title = 'Change status';
    select.disabled = !ctx.writable;
    for (const status of STATUSES) {
        const option = el('option', '', STATUS_LABELS[status]);
        option.value = status;
        option.selected = status === plan.status;
        select.appendChild(option);
    }
    select.addEventListener('change', () => ctx.updatePlan(plan.resource, { status: select.value }));
    row.appendChild(select);

    ctx.drag.makeDraggable(row, dragPayload(plan));
    return row;
}

// For a plan in review: what is left to check, and approve or send it back.
function reviewPanel(ctx, plan) {
    const panel = el('div', 'review-panel');
    if (plan.openTasks.length) {
        panel.appendChild(el('div', 'review-label', 'To check'));
        const list = el('ul', 'review-checks');
        for (const task of plan.openTasks) list.appendChild(el('li', '', task));
        panel.appendChild(list);
    }
    panel.appendChild(reviewControls(ctx, plan));
    return panel;
}

export default {
    id: 'milestone',
    label: 'Milestone',
    icon: 'card-list',
    zoomable: false,
    render(container, project, ctx) {
        const milestone = project.milestones.find(m => m.folder === ctx.milestone);
        const page = el('div', 'detail');

        page.appendChild(button('back-button', [icon('arrow-left'), ' Back'], () => ctx.showMilestone(null)));
        page.appendChild(milestoneHeader(ctx, milestone, { detail: true }));
        if (milestone.description) page.appendChild(el('p', 'description', milestone.description));

        const actions = el('div', 'detail-actions');
        if (!milestone.unsorted) {
            if (milestone.metaResource) {
                actions.appendChild(button('toolbar-button', [icon('file-earmark-text'), ' Open milestone README'],
                    () => ctx.open(milestone.metaResource)));
            } else {
                actions.appendChild(button('toolbar-button write-only', [icon('file-earmark-plus'), ' Add milestone README'],
                    () => ctx.createMilestoneReadme(milestone)));
            }
        }
        actions.appendChild(addPlanButton(ctx, milestone.folder, ''));
        page.appendChild(actions);

        const groups = el('div', 'status-groups');
        for (const status of STATUSES) {
            const plans = milestone.plans.filter(plan => plan.status === status);
            const group = el('section', `status-group status-group-${status}`);
            const heading = el('h2');
            heading.append(statusChip(status), el('span', 'count', String(plans.length)));
            group.appendChild(heading);

            const list = el('ul', 'detail-list');
            for (const plan of plans) list.appendChild(planRow(ctx, plan, project.lanes));
            if (plans.length === 0) list.appendChild(el('li', 'empty', 'None'));
            group.appendChild(list);

            ctx.drag.makeDropTarget(group, { status });
            groups.appendChild(group);
        }
        page.appendChild(groups);
        container.appendChild(page);
    },
};
