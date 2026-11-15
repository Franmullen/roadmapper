// Small DOM building blocks shared by the views. Nothing here reads or writes files: actions arrive
// through the view context (see main.js).

import { STATUSES, STATUS_LABELS, isComplete, isMilestoneOverdue, planTotal } from './model.js';

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

// In a focused view, how many finished plans a milestone is not showing.
export function hiddenDoneNote(milestone) {
    if (!milestone.hiddenDone) return null;
    const note = el('span', 'hidden-done', ` ${milestone.hiddenDone} done`);
    note.prepend(icon('check2'));
    note.title = `${milestone.hiddenDone} finished plan${milestone.hiddenDone === 1 ? ' is' : 's are'} hidden. Show all to see them.`;
    return note;
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
    const total = planTotal(milestone);
    titleRow.appendChild(el('span', 'count', total ? `${milestone.counts.done}/${total}` : '0'));
    header.appendChild(titleRow);

    const metaRow = el('div', 'meta-row');
    metaRow.appendChild(button('folder-link', milestone.unsorted ? `${milestone.folder}/` : milestone.name,
        () => ctx.reveal(milestone.folder), 'Show this folder in the Explorer'));
    const due = dueChip(milestone, ctx.today);
    if (due) metaRow.appendChild(due);
    const finished = hiddenDoneNote(milestone);
    if (finished) metaRow.appendChild(finished);
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

// --- Reviews ---

// What is left to check on a plan in review: its unticked tasks.
export function reviewChecks(plan) {
    return plan.openTasks.length ? ['To check:', ...plan.openTasks.map(task => `- ${task}`)].join('\n') : 'Nothing left unticked.';
}

// Approve or send back a plan in review. Compact shows icons only. Clicks here never open or drag the plan.
export function reviewControls(ctx, plan, { compact = false } = {}) {
    if (plan.status !== 'review') return null;
    const controls = el('span', compact ? 'review-controls compact write-only' : 'review-controls write-only');
    for (const type of ['click', 'keydown', 'pointerdown']) controls.addEventListener(type, event => event.stopPropagation());

    const label = text => (compact ? [] : [` ${text}`]);
    const approve = button('review-approve', [icon('check2'), ...label('Approve')], () => ctx.approvePlan(plan.resource),
        `Approve: mark it done and tick its remaining tasks.\n\n${reviewChecks(plan)}`);
    const sendBack = button('review-send-back', [icon('arrow-return-left'), ...label('Follow up')], null,
        'Send it back with follow-ups. They become tasks under "## Follow-ups" and the plan returns to To do, ready for an agent.');
    // On the Road there is no room to write, so Follow up goes to the Reviews tab.
    sendBack.addEventListener('click', () => (compact ? ctx.showView('reviews') : openFollowUpBox(ctx, plan, controls)));
    controls.append(approve, sendBack);
    return controls;
}

// A box for writing follow-ups, one per line, in place of the review buttons. Ctrl+Enter or Send back
// sends them; Escape or Cancel puts the buttons back.
function openFollowUpBox(ctx, plan, controls) {
    const box = el('div', 'follow-up-box');
    const text = el('textarea', 'inline-input follow-up-text');
    text.rows = 4;
    text.placeholder = 'What still needs doing? One follow-up per line.';
    const hint = el('span', 'follow-up-hint', 'Ctrl+Enter to send back');
    const close = () => {
        box.replaceWith(controls);
        document.dispatchEvent(new CustomEvent('rm-prompt-closed'));
    };
    const send = () => {
        const items = text.value.split(/\r?\n/).map(line => line.replace(/^\s*[-*+]\s+(\[ \]\s*)?/, '').trim()).filter(Boolean);
        if (!items.length) return;
        close();
        ctx.sendBackPlan(plan.resource, items);
    };
    const actions = el('div', 'follow-up-actions');
    actions.append(
        button('review-send-back', [icon('arrow-return-left'), ' Send back'], send, 'Send it back to To do with these follow-ups'),
        button('follow-up-cancel', 'Cancel', close),
        hint);
    box.append(text, actions);
    for (const type of ['click', 'pointerdown']) box.addEventListener(type, event => event.stopPropagation());
    box.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            close();
        }
    });
    controls.replaceWith(box);
    text.focus();
}

// A plan sent back from review, waiting for its follow-ups.
export function followUpChip(plan) {
    if (plan.status !== 'todo' || !plan.followUps.length) return null;
    const chip = el('span', 'follow-up-chip');
    chip.append(icon('arrow-return-left'), ` ${plan.followUps.length} follow-up${plan.followUps.length === 1 ? '' : 's'}`);
    chip.title = ['Sent back from review:', ...plan.followUps.map(task => `- ${task}`)].join('\n');
    return chip;
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

export function dragPayload(plan) {
    return { resource: plan.resource, from: plan.milestone, lane: plan.lane, status: plan.status };
}
