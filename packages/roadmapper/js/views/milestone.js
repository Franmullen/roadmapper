// Milestone view: one milestone in detail. Its description, due date and progress, then its plans
// grouped by status. Change a plan's status from its dropdown, or drag it to another status group.
// Opened from the other views; ctx.milestone names which milestone to show.

import { STATUSES, STATUS_LABELS } from '../model.js';
import { addPlanButton, button, dependencyChip, dependencyLinks, dragPayload, el, icon, milestoneHeader, statusChip } from '../ui.js';

function planRow(ctx, plan) {
    const row = el('li', 'detail-row');

    row.appendChild(button('detail-title', plan.title, () => ctx.open(plan.resource), `Open ${plan.resource}`));

    const meta = el('div', 'detail-meta');
    if (plan.lane) meta.appendChild(el('span', 'lane-tag', plan.lane));
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
    if (plan.depends.length) row.appendChild(dependencyLinks(ctx, plan));

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
            for (const plan of plans) list.appendChild(planRow(ctx, plan));
            if (plans.length === 0) list.appendChild(el('li', 'empty', 'None'));
            group.appendChild(list);

            ctx.drag.makeDropTarget(group, { status });
            groups.appendChild(group);
        }
        page.appendChild(groups);
        container.appendChild(page);
    },
};
