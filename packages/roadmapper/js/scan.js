// Pure functions that turn a folder tree and file contents into board columns.
// No Celbridge calls here, so this file can be tested with plain Node.

// The board's own settings, stored in the .roadmap file as JSON.
export function parseConfig(text) {
    const config = { root: 'plans' };
    if (!text || !text.trim()) {
        return config;
    }
    const raw = JSON.parse(text);
    if (typeof raw.root === 'string') {
        config.root = normalizeFolder(raw.root);
    }
    return config;
}

export function serializeConfig(config) {
    return JSON.stringify({ root: config.root }, null, 2) + '\n';
}

// "project:plans/" and "/plans" both become "plans".
export function normalizeFolder(folder) {
    return folder.trim().replace(/^project:/, '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function isFolder(node) {
    return node.type === 'folder' || Array.isArray(node.children);
}

function isMarkdown(node) {
    return !isFolder(node) && /\.md$/i.test(node.name);
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

// Builds the columns from a file_get_tree result rooted at the board's folder.
// Markdown files directly in the root go in a leading "Unsorted" column, shown only when it has cards.
// Each subfolder is a milestone column, in natural name order, holding the Markdown files anywhere below it.
export function buildColumns(tree, root) {
    const children = tree?.children ?? [];
    const columns = [];

    const loose = children.filter(isMarkdown).sort(byName);
    if (loose.length > 0) {
        columns.push({
            name: 'Unsorted',
            folder: root,
            unsorted: true,
            cards: loose.map(file => ({ name: file.name, resource: `${root}/${file.name}` })),
        });
    }

    for (const folder of children.filter(isFolder).sort(byName)) {
        const folderKey = `${root}/${folder.name}`;
        columns.push({
            name: folder.name,
            folder: folderKey,
            unsorted: false,
            truncated: folder.truncated === true,
            cards: collectMarkdown(folder, folderKey),
        });
    }

    return columns;
}

function collectMarkdown(folder, prefix) {
    const cards = [];
    for (const child of [...(folder.children ?? [])].sort(byName)) {
        const key = `${prefix}/${child.name}`;
        if (isFolder(child)) {
            cards.push(...collectMarkdown(child, key));
        } else if (isMarkdown(child)) {
            cards.push({ name: child.name, resource: key });
        }
    }
    return cards;
}

// What a card shows, read from its Markdown: the first "# " heading (front matter skipped), and a
// count of task-list checkboxes, so files with "- [x]" items show progress with no extra convention.
export function summarizeMarkdown(content, fileName) {
    const text = (content ?? '').replace(/^﻿/, '');
    const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

    const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m);
    const title = heading ? heading[1] : fileName.replace(/\.md$/i, '');

    const done = (body.match(/^\s*[-*+]\s+\[[xX]\]/gm) ?? []).length;
    const open = (body.match(/^\s*[-*+]\s+\[ \]/gm) ?? []).length;

    return { title, done, total: done + open };
}

// Display name for a milestone folder: "02-first-release" reads as "First release",
// keeping the folder name itself visible underneath for reference.
export function displayName(folderName) {
    const stripped = folderName.replace(/^\d+[\s._-]*/, '').replace(/[_-]+/g, ' ').trim();
    const text = stripped || folderName;
    // Version names keep their lower-case "v": "v0.1 basics", not "V0.1 basics".
    if (/^v\d/i.test(text)) {
        return text;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
}
