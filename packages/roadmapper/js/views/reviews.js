// Reviews view: the plans waiting for a person, across the whole project. Each shows what to check and
// what approving it would unblock, with Approve (done) and Follow up (send it back with more to do).
// Approving is how a person lets the agent move on: plans that depend on it become ready.

import { button, el, ownerTag, reviewControls } from '../ui.js';

// Plans that wait only on this one, so approving it makes them ready to start.
function unblockedBy(plan, byResource) {
    return plan.dependents
        .map(resource => byResource.get(resource))
        .filter(other => other && other.status === 'todo'
            && other.depends.every(dep => !dep.problem && (dep.done || dep.resource === plan.resource)));
}

function reviewItem(ctx, plan, milestones, byResource) {
    const item = el('li', 'desk-plan');

    const head = el('div', 'desk-plan-head');
    head.appendChild(button('desk-plan-title', plan.title, () => ctx.open(plan.resource), `Open ${plan.resource}`));
    const meta = el('div', 'desk-plan-meta');
    meta.appendChild(button('folder-link', milestones.get(plan.milestone) ?? plan.milestone,
        () => ctx.showMilestone(plan.milestone), 'Show this milestone'));
    if (plan.lane) meta.appendChild(el('span', 'lane-tag', plan.lane));
    if (plan.owner) meta.appendChild(ownerTag(plan));
    head.appendChild(meta);
    item.appendChild(head);

    if (plan.openTasks.length) {
        item.appendChild(el('div', 'review-label', 'To check'));
        const list = el('ul', 'review-checks');
        for (const task of plan.openTasks) list.appendChild(el('li', '', task));
        item.appendChild(list);
    }
    const unblocks = unblockedBy(plan, byResource);
    if (unblocks.length) {
        item.appendChild(el('div', 'desk-unblocks', `Approving lets the agent start: ${unblocks.map(other => other.title).join(', ')}`));
    }
    item.appendChild(reviewControls(ctx, plan));
    return item;
}

export function pendingReviews(project) {
    return project ? project.plans.filter(plan => plan.status === 'review').length : 0;
}

export default {
    id: 'reviews',
    label: 'Reviews',
    icon: 'check2-square',
    zoomable: false,
    unfocused: true,
    badge: pendingReviews,
    render(container, project, ctx) {
        const milestones = new Map(project.milestones.map(m => [m.folder, m.title]));
        const byResource = new Map(project.plans.map(plan => [plan.resource, plan]));
        const reviews = project.plans.filter(plan => plan.status === 'review');

        const page = el('div', 'desk');
        page.appendChild(el('p', 'desk-hint',
            'Approve what is finished, or send it back with what still needs doing. Either way the agent can carry on.'));
        if (!reviews.length) {
            page.appendChild(el('p', 'empty', 'Nothing is waiting for review.'));
        } else {
            const list = el('ul', 'desk-list');
            for (const plan of reviews) list.appendChild(reviewItem(ctx, plan, milestones, byResource));
            page.appendChild(list);
        }
        container.appendChild(page);
    },
};
