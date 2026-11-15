// Reviews view: where the person in the loop works. What is waiting for their review (with what to check,
// and Approve or Follow up), the queue of ideas lined up for an agent, what was sent back and is waiting
// on an agent, and what is blocked. It always shows the whole project, not the focused part.

import { button, el, icon, inlinePrompt, ownerTag, reviewControls } from '../ui.js';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function section(title, count, className) {
    const box = el('section', `desk-section ${className}`);
    const heading = el('h2');
    heading.append(el('span', '', title), el('span', 'count', String(count)));
    box.appendChild(heading);
    return box;
}

function planHeading(ctx, plan, milestones) {
    const head = el('div', 'desk-plan-head');
    head.appendChild(button('desk-plan-title', plan.title, () => ctx.open(plan.resource), `Open ${plan.resource}`));
    const meta = el('div', 'desk-plan-meta');
    meta.appendChild(button('folder-link', milestones.get(plan.milestone) ?? plan.milestone,
        () => ctx.showMilestone(plan.milestone), 'Show this milestone'));
    if (plan.lane) meta.appendChild(el('span', 'lane-tag', plan.lane));
    if (plan.owner) meta.appendChild(ownerTag(plan));
    head.appendChild(meta);
    return head;
}

function taskList(tasks, className) {
    const list = el('ul', className);
    for (const task of tasks) list.appendChild(el('li', '', task));
    return list;
}

function reviewSection(ctx, plans, milestones) {
    const box = section('To review', plans.length, 'desk-reviews');
    if (!plans.length) {
        box.appendChild(el('p', 'empty', 'Nothing is waiting for review.'));
        return box;
    }
    const list = el('ul', 'desk-list');
    for (const plan of plans) {
        const item = el('li', 'desk-plan');
        item.appendChild(planHeading(ctx, plan, milestones));
        if (plan.openTasks.length) {
            item.appendChild(el('div', 'review-label', 'To check'));
            item.appendChild(taskList(plan.openTasks, 'review-checks'));
        }
        item.appendChild(reviewControls(ctx, plan));
        list.appendChild(item);
    }
    box.appendChild(list);
    return box;
}

function queueSection(ctx, queue) {
    const box = section('Queue for the agent', queue.open.length, 'desk-queue');
    box.appendChild(el('p', 'desk-hint',
        'Line up ideas and requests here, then ask the agent to "process the queue". It turns each one into plans, and finished work comes back here for review.'));

    const input = el('input', 'queue-input write-only');
    input.type = 'text';
    input.placeholder = 'An idea or request, then Enter';
    input.spellcheck = true;
    input.dataset.keepFocus = 'queue';
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const items = input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        input.value = '';
        if (items.length) ctx.addToQueue(items);
    });
    // A pasted list becomes one item per line.
    input.addEventListener('paste', event => {
        const text = event.clipboardData?.getData('text') ?? '';
        if (!/\n/.test(text.trim())) return;
        event.preventDefault();
        ctx.addToQueue(text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?/, '').trim()).filter(Boolean));
    });
    box.appendChild(input);

    if (queue.open.length) {
        const list = el('ul', 'desk-queue-list');
        for (const item of queue.open) list.appendChild(queueRow(ctx, item));
        box.appendChild(list);
    }
    if (queue.processed.length) {
        const done = el('details', 'desk-processed');
        done.appendChild(el('summary', '', `${plural(queue.processed.length, 'item')} already turned into plans`));
        done.appendChild(taskList(queue.processed.map(item => item.text), 'queue-processed'));
        box.appendChild(done);
    }
    if (queue.exists) {
        box.appendChild(button('folder-link', [icon('file-earmark-text'), ` ${queue.resource}`], () => ctx.open(queue.resource), 'Open the queue file'));
    }
    return box;
}

// An item waiting in the queue, with any question the agent asked about it and the answers given.
function queueRow(ctx, item) {
    const asked = isQuestion(item);
    const row = el('li', asked ? 'queue-item asked' : 'queue-item');
    const line = el('div', 'queue-line');
    line.appendChild(el('span', 'queue-text', item.text));
    if (asked) {
        const reply = button('queue-reply write-only', [icon('reply'), ' Reply'], null, 'Answer the agent');
        reply.addEventListener('click', () => inlinePrompt(reply, 'Your answer, then Enter', answer => ctx.answerInQueue(item.text, answer)));
        line.appendChild(reply);
    }
    line.appendChild(button('queue-remove write-only', icon('x-lg'), () => ctx.removeFromQueue(item.text), 'Remove from the queue'));
    row.appendChild(line);
    for (const note of item.notes) {
        const kind = /^question:/i.test(note) ? 'question' : /^answer:/i.test(note) ? 'answer' : 'note';
        const text = el('div', `queue-note queue-${kind}`);
        text.append(icon(kind === 'question' ? 'robot' : kind === 'answer' ? 'person' : 'dot'), ` ${note.replace(/^(question|answer):\s*/i, '')}`);
        row.appendChild(text);
    }
    return row;
}

function waitingSection(ctx, plans, milestones) {
    const box = section('Sent back, waiting on the agent', plans.length, 'desk-sent-back');
    if (!plans.length) {
        box.appendChild(el('p', 'empty', 'Nothing sent back.'));
        return box;
    }
    const list = el('ul', 'desk-list');
    for (const plan of plans) {
        const item = el('li', 'desk-plan');
        item.appendChild(planHeading(ctx, plan, milestones));
        item.appendChild(el('div', 'review-label', 'Follow-ups'));
        item.appendChild(taskList(plan.followUps, 'review-checks'));
        list.appendChild(item);
    }
    box.appendChild(list);
    return box;
}

function blockedSection(ctx, plans, milestones) {
    const box = section('Blocked', plans.length, 'desk-blocked');
    const list = el('ul', 'desk-list');
    for (const plan of plans) {
        const item = el('li', 'desk-plan');
        item.appendChild(planHeading(ctx, plan, milestones));
        list.appendChild(item);
    }
    box.appendChild(list);
    return box;
}

const isQuestion = item => item.notes.length > 0 && /^question:/i.test(item.notes[item.notes.length - 1]);

// What waits for a person, the badge on the toolbar: plans in review, and agent questions on the queue.
export function waitingForPerson(project) {
    if (!project) return 0;
    return project.plans.filter(plan => plan.status === 'review').length + project.queue.open.filter(isQuestion).length;
}

export default {
    id: 'reviews',
    label: 'Reviews',
    icon: 'inbox',
    zoomable: false,
    unfocused: true,
    badge: waitingForPerson,
    render(container, project, ctx) {
        const milestones = new Map(project.milestones.map(m => [m.folder, m.title]));
        const page = el('div', 'desk');
        page.appendChild(reviewSection(ctx, project.plans.filter(plan => plan.status === 'review'), milestones));
        page.appendChild(queueSection(ctx, project.queue));
        page.appendChild(waitingSection(ctx, project.plans.filter(plan => plan.status === 'todo' && plan.followUps.length), milestones));
        const blocked = project.plans.filter(plan => plan.status === 'blocked');
        if (blocked.length) page.appendChild(blockedSection(ctx, blocked, milestones));
        container.appendChild(page);
    },
};
