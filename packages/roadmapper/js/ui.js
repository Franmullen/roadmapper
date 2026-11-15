// Small DOM building blocks shared by the views. Nothing here reads or writes files: actions arrive
// through the view context (see main.js).

import { STATUSES, STATUS_LABELS, isComplete, isMilestoneOverdue } from './model.js';

export function el(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

export function icon(name) {
    return el('i', `bi bi-${name}`);
}

export function button(className, content, onClick, title) {
    const element = el('button', className);
    element.type = 'button';
    if (title) element.title = title;
    element.append(...[].concat(content));
    if (onClick) element.addEventListener('click', onClick);
    return element;
}

export function progressBar(done, total, title) {
    const bar = el('div', 'progress');
    bar.title = title ?? `${done} of ${total} done`;
    const fill = el('div', 'progress-fill');
    fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    bar.appendChild(fill);
    return bar;
}

// One bar split into a segment per status, in workflow order.
export function statusBar(counts, total) {
    const bar = el('div', 'status-bar');
    bar.title = STATUSES.filter(s => counts[s]).map(s => `${counts[s]} ${STATUS_LABELS[s].toLowerCase()}`).join(', ') || 'No plans';
    for (const status of STATUSES) {
        if (!counts[status]) continue;
        const segment = el('div', `status-bar-segment status-fill-${status}`);
        segment.style.flexGrow = String(counts[status]);
        bar.appendChild(segment);
    }
    if (!total) bar.classList.add('empty-bar');
    return bar;
}

export function statusDot(status) {
    const dot = el('span', `status-dot status-fill-${status}`);
    dot.title = STATUS_LABELS[status];
    return dot;
}

export function statusChip(status) {
    return el('span', `status-chip status-${status}`, STATUS_LABELS[status]);
}

export function dueChip(milestone, today) {
    if (!milestone.due) return null;
    const overdue = isMilestoneOverdue(milestone, today);
    const chip = el('span', overdue ? 'due-chip overdue' : 'due-chip', overdue ? `Overdue · ${milestone.due}` : `Due ${milestone.due}`);
    chip.prepend(icon('calendar-event'), ' ');
    return chip;
}

// Replaces a button with a text input. Enter (or leaving the field with text in it) submits; Escape
// cancels. Dispatches 'rm-prompt-closed' on the document when the input goes away.
export function inlinePrompt(trigger, placeholder, onSubmit) {
    const input = el('input', 'inline-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.spellcheck = false;
    trigger.replaceWith(input);
    input.focus();

    let finished = false;
    const finish = async submit => {
        if (finished) return;
        finished = true;
        const value = input.value.trim();
        input.replaceWith(trigger);
        document.dispatchEvent(new CustomEvent('rm-prompt-closed'));
        if (submit && value) await onSubmit(value);
    };
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
        }
    });
    input.addEventListener('blur', () => finish(input.value.trim() !== ''));
}

export function addPlanButton(ctx, folder, lane) {
    const trigger = button('add-plan write-only', [icon('plus'), ' Add plan']);
    trigger.addEventListener('click', () =>
        inlinePrompt(trigger, 'Plan title, then Enter', title => ctx.createPlan(folder, lane, title)));
    return trigger;
}

// A milestone's title, plan count, folder, due date and progress. In a list it links to the detail view.
export function milestoneHeader(ctx, milestone, { detail = false } = {}) {
    const header = el('header', 'column-header');

    const titleRow = el('div', 'title-row');
    if (detail) {
        titleRow.appendChild(el('h1', '', milestone.title));
    } else {
        titleRow.appendChild(button('milestone-title', milestone.title,
            () => ctx.showMilestone(milestone.folder), 'Show this milestone in detail'));
    }
    const total = milestone.plans.length;
    titleRow.appendChild(el('span', 'count', total ? `${milestone.counts.done}/${total}` : '0'));
    header.appendChild(titleRow);

    const metaRow = el('div', 'meta-row');
    metaRow.appendChild(button('folder-link', milestone.unsorted ? `${milestone.folder}/` : milestone.name,
        () => ctx.reveal(milestone.folder), 'Show this folder in the Explorer'));
    const due = dueChip(milestone, ctx.today);
    if (due) metaRow.appendChild(due);
    header.appendChild(metaRow);

    if (total > 0) {
        header.appendChild(progressBar(milestone.counts.done, total, `${milestone.counts.done} of ${total} plans done`));
    }
    if (isComplete(milestone)) header.classList.add('complete');
    return header;
}

// Who is working on a plan, from its `owner:` (a person, or an agent's name).
export function ownerTag(plan) {
    const tag = el('span', 'owner-tag', plan.owner);
    tag.prepend(icon('person'), ' ');
    tag.title = `${plan.owner} is working on this`;
    return tag;
}

// --- Dependencies ---

const PROBLEMS = {
    missing: 'no plan has this name',
    ambiguous: 'more than one plan has this name',
    later: 'scheduled in a later milestone',
};

export function describeDependency(dep) {
    const state = dep.problem ? PROBLEMS[dep.problem] : dep.done ? 'done' : 'not done yet';
    return `${dep.title} (${state})`;
}

// A plan's dependencies on a card: how many it is waiting on, flagged when one is wrong.
export function dependencyChip(plan) {
    if (plan.depends.length === 0) return null;
    const problems = plan.depends.filter(dep => dep.problem).length;
    const state = problems ? 'problem' : plan.waitingOn ? 'waiting' : 'ready';
    const text = problems ? `${problems} to fix`
        : plan.waitingOn ? `waits on ${plan.waitingOn}`
            : `${plan.depends.length} done`;
    const chip = el('span', `dep-chip dep-${state}`);
    chip.append(icon(problems ? 'exclamation-triangle' : 'diagram-2'), ` ${text}`);
    chip.title = ['Depends on:', ...plan.depends.map(describeDependency)].join('\n');
    return chip;
}

// The dependencies as links to their plans, for the detail view.
export function dependencyLinks(ctx, plan) {
    const list = el('div', 'dep-links');
    list.appendChild(el('span', 'dep-label', 'Depends on'));
    for (const dep of plan.depends) {
        const state = dep.problem ? 'problem' : dep.done ? 'ready' : 'waiting';
        const link = button(`dep-link dep-${state}`, [icon(dep.done ? 'check2' : dep.problem ? 'exclamation-triangle' : 'hourglass-split'), ` ${dep.title}`],
            dep.resource ? () => ctx.open(dep.resource) : null, describeDependency(dep));
        link.disabled = !dep.resource;
        list.appendChild(link);
    }
    return list;
}

// A plan card: status edge and chip, title, lane, file and task progress. Click opens; drag moves.
export function planCard(ctx, plan, { showLane = true } = {}) {
    const item = el('li', `card status-edge-${plan.status}`);
    item.tabIndex = 0;
    item.title = `Open ${plan.resource}`;

    item.appendChild(el('div', 'card-title', plan.title));

    const tags = el('div', 'card-tags');
    tags.appendChild(statusChip(plan.status));
    if (showLane && plan.lane) tags.appendChild(el('span', 'lane-tag', plan.lane));
    if (plan.owner) tags.appendChild(ownerTag(plan));
    const deps = dependencyChip(plan);
    if (deps) tags.appendChild(deps);
    if (plan.total > 0) {
        tags.appendChild(el('span', plan.done === plan.total ? 'card-tasks complete' : 'card-tasks', `${plan.done}/${plan.total}`));
    }
    item.appendChild(tags);

    item.appendChild(el('div', 'card-file', plan.path));
    if (plan.total > 0) {
        item.appendChild(progressBar(plan.done, plan.total, `${plan.done} of ${plan.total} tasks done`));
    }

    item.addEventListener('click', () => ctx.open(plan.resource));
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            ctx.open(plan.resource);
        }
    });
    ctx.drag.makeDraggable(item, dragPayload(plan));
    return item;
}

export function dragPayload(plan) {
    return { resource: plan.resource, from: plan.milestone, lane: plan.lane, status: plan.status };
}
