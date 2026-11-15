// Ideas view: jot down ideas for the project. Each can name a milestone or lane, or leave it to the agent.
// Ask an agent to "process the ideas" and it turns them into plans, in existing milestones or new ones.
// It asks about any it can't place; answer with Reply.

import { button, el, icon, inlinePrompt } from '../ui.js';

const NEW = '\u0000new';

// Where the next ideas go. Kept between renders, so it stays set while several ideas are added.
const target = { milestone: '', lane: '' };

const isQuestion = idea => idea.notes.length > 0 && /^question:/i.test(idea.notes[idea.notes.length - 1]);

// A target picker: "Agent decides", what exists, or a new one typed in.
function targetSelect(ctx, kind, label, choices) {
    const select = el('select', 'idea-target');
    select.title = `${label} for new ideas`;
    if (target[kind] && !choices.some(([value]) => value === target[kind])) choices = [...choices, [target[kind], `${target[kind]} (new)`]];
    for (const [value, text] of [['', `Any ${label.toLowerCase()}`], ...choices, [NEW, `New ${label.toLowerCase()}…`]]) {
        const option = el('option', '', value && value !== NEW ? `${label}: ${text}` : text);
        option.value = value;
        option.selected = value === target[kind];
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        if (select.value !== NEW) {
            target[kind] = select.value;
            return;
        }
        select.value = target[kind];
        inlinePrompt(select, `${label} name, then Enter`, name => {
            target[kind] = name.trim();
            ctx.showView('ideas');
        });
    });
    return select;
}

function capture(ctx, project) {
    const box = el('div', 'idea-capture write-only');
    const input = el('input', 'idea-input');
    input.type = 'text';
    input.placeholder = 'New idea…';
    input.spellcheck = true;
    input.dataset.keepFocus = 'ideas';
    const save = items => {
        if (items.length) ctx.saveIdeas(items, { ...target });
    };
    input.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const text = input.value.trim();
        input.value = '';
        save(text ? [text] : []);
    });
    input.addEventListener('paste', event => {
        const text = event.clipboardData?.getData('text') ?? '';
        if (!/\n/.test(text.trim())) return;
        event.preventDefault();
        save(text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s*)?/, '').trim()).filter(Boolean));
    });
    box.appendChild(input);

    const targets = el('div', 'idea-targets');
    targets.appendChild(targetSelect(ctx, 'milestone', 'Milestone',
        project.milestones.filter(m => !m.unsorted).map(m => [m.name, m.title])));
    targets.appendChild(targetSelect(ctx, 'lane', 'Lane', project.lanes.map(lane => [lane, lane])));
    box.appendChild(targets);
    return box;
}

function ideaRow(ctx, idea, project) {
    const asked = isQuestion(idea);
    const row = el('li', asked ? 'idea asked' : 'idea');
    const line = el('div', 'idea-line');
    line.appendChild(el('span', 'idea-text', idea.text));
    if (idea.milestone) {
        const milestone = project.milestones.find(m => m.name === idea.milestone);
        line.appendChild(el('span', 'idea-chip', milestone ? milestone.title : `${idea.milestone} (new)`));
    }
    if (idea.lane) line.appendChild(el('span', 'lane-tag', idea.lane));
    if (asked) {
        const reply = button('idea-reply write-only', [icon('reply'), ' Reply'], null, 'Answer');
        reply.addEventListener('click', () => inlinePrompt(reply, 'Your answer, then Enter', answer => ctx.replyToIdea(idea.text, answer)));
        line.appendChild(reply);
    }
    line.appendChild(button('idea-remove write-only', icon('x-lg'), () => ctx.deleteIdea(idea.text), 'Remove'));
    row.appendChild(line);
    for (const note of idea.notes) {
        const kind = /^question:/i.test(note) ? 'question' : /^answer:/i.test(note) ? 'answer' : 'note';
        const text = el('div', `idea-note idea-${kind}`);
        text.append(icon(kind === 'question' ? 'robot' : kind === 'answer' ? 'person' : 'dot'), ` ${note.replace(/^(question|answer):\s*/i, '')}`);
        row.appendChild(text);
    }
    return row;
}

// Questions from the agent that wait for an answer: the badge on the toolbar.
export function openQuestions(project) {
    return project ? project.ideas.open.filter(isQuestion).length : 0;
}

export default {
    id: 'ideas',
    label: 'Ideas',
    icon: 'lightbulb',
    zoomable: false,
    unfocused: true,
    badge: openQuestions,
    render(container, project, ctx) {
        const { ideas } = project;
        const page = el('div', 'desk');
        page.appendChild(el('p', 'desk-hint',
            'You jot ideas. Ask the agent to "process the ideas" and it bakes them into the roadmap.'));
        page.appendChild(capture(ctx, project));

        if (ideas.open.length) {
            const list = el('ul', 'idea-list');
            for (const idea of ideas.open) list.appendChild(ideaRow(ctx, idea, project));
            page.appendChild(list);
        } else {
            page.appendChild(el('p', 'empty', 'No ideas yet.'));
        }
        if (ideas.processed.length) {
            const done = el('details', 'desk-processed');
            done.appendChild(el('summary', '', `${ideas.processed.length} planned`));
            const list = el('ul', 'idea-processed');
            for (const idea of ideas.processed) list.appendChild(el('li', '', idea.text));
            done.appendChild(list);
            page.appendChild(done);
        }
        if (ideas.exists) {
            page.appendChild(button('folder-link', [icon('file-earmark-text'), ` ${ideas.resource}`], () => ctx.open(ideas.resource), 'Open file'));
        }
        container.appendChild(page);
    },
};
