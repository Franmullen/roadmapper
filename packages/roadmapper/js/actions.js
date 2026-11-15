// Every read and write Roadmapper makes to the project goes through here, using the Celbridge `cel.*`
// tools. Views never touch files: they call these actions through the context main.js hands them.
//
// Each action reports its own failures to the user (a notification) and the console, and never throws,
// except loadProject, whose caller decides what an unreadable folder means.

import {
    addFollowUps, addIdeas, answerIdea, approveReview, buildProject, dropChanges, folderPaths, milestoneTemplate, removeIdea, nextMilestoneFolder, planTemplate, projectResources,
    setFrontMatter, uniqueFileName,
} from './model.js';
import { agentInstructions, briefResource, roadmapBrief, upsertSection } from './agents.js';

const TREE_DEPTH = 8;

const stripRoot = key => key.replace(/^project:/, '');
const baseName = resource => resource.slice(resource.lastIndexOf('/') + 1);
const parentFolder = resource => resource.slice(0, resource.lastIndexOf('/'));

export class RootMissingError extends Error { }

export function createActions(client, { notify }) {
    // Calls a cel tool, e.g. call('file.read', 'plans/a.md'). Tools answer with JSON, or a bare "ok".
    async function call(tool, ...args) {
        const [namespace, name] = tool.split('.');
        const result = await client.cel[namespace][name](...args);
        if (typeof result !== 'string') return result;
        try {
            return JSON.parse(result);
        } catch {
            return result.trim();
        }
    }

    // Runs a change, reporting a failure as `message` instead of throwing. Returns whether it worked.
    async function attempt(message, change) {
        try {
            await change();
            return true;
        } catch (e) {
            console.error(`[Roadmapper] ${message}`, e);
            await notify('error', message);
            return false;
        }
    }

    const readFile = async resource => (await call('file.read', resource)).content ?? '';

    // Reads the board's folder into a project. Throws RootMissingError when the folder cannot be listed.
    async function loadProject(config) {
        let tree;
        try {
            tree = await call('file.getTree', config.root, TREE_DEPTH, '', '');
        } catch (e) {
            throw new RootMissingError(String(e?.message ?? e));
        }

        const contents = new Map();
        const resources = projectResources(tree, config.root);
        if (resources.length > 0) {
            const { files = [] } = await call('file.readMany', JSON.stringify(resources));
            for (const file of files) contents.set(stripRoot(file.resource), file.content ?? '');
        }
        return buildProject(tree, config.root, contents, config);
    }

    async function openFile(resource) {
        try {
            await call('document.open', resource, '', false, true);
        } catch (e) {
            console.warn(`[Roadmapper] Could not open ${resource}:`, e);
        }
    }

    async function revealFolder(folder) {
        try {
            await call('explorer.select', folder, true);
        } catch (e) {
            console.warn(`[Roadmapper] Could not show ${folder}:`, e);
        }
    }

    // Writes front matter keys into a plan. The file is read fresh, so an edit made since the last scan is kept.
    function updatePlan(resource, updates) {
        return attempt(`Could not update ${baseName(resource)}.`, async () => {
            await call('file.write', resource, setFrontMatter(await readFile(resource), updates));
        });
    }

    // Finishes a review: approve it (done, tasks ticked), or send it back with follow-up tasks.
    function reviewPlan(resource, followUps = null) {
        return attempt(`Could not update ${baseName(resource)}.`, async () => {
            const text = await readFile(resource);
            await call('file.write', resource, followUps ? addFollowUps(text, followUps) : approveReview(text));
        });
    }

    // Adds ideas to the ideas file, creating it if needed. The file is read fresh, so an agent's ticks are kept.
    function saveIdeas(project, items, target) {
        return attempt('Could not save the idea.', async () => {
            const text = project.ideas.exists ? await readFile(project.ideas.resource) : '';
            await call('file.write', project.ideas.resource, addIdeas(text, items, target));
        });
    }

    function deleteIdea(project, item) {
        return attempt('Could not remove that idea.', async () => {
            await call('file.write', project.ideas.resource, removeIdea(await readFile(project.ideas.resource), item));
        });
    }

    function replyToIdea(project, item, answer) {
        return attempt('Could not save that answer.', async () => {
            await call('file.write', project.ideas.resource, answerIdea(await readFile(project.ideas.resource), item, answer));
        });
    }

    // The project's folders, for choosing the root.
    async function listFolders() {
        try {
            return folderPaths(await call('file.getTree', '', 3, '', ''));
        } catch (e) {
            console.warn('[Roadmapper] Could not list the folders:', e);
            return [];
        }
    }

    // A drop can change a plan's lane and status (front matter) and its milestone (folder). A move that
    // would collide is refused before anything is written; the front matter is written while the file is
    // still where the scan found it, then the file moves.
    async function dropPlan(project, payload, target) {
        const { updates, moveTo } = dropChanges(payload, target);
        const name = baseName(payload.resource);
        if (moveTo && project.plans.some(plan => plan.resource === `${moveTo}/${name}`)) {
            const milestone = project.milestones.find(m => m.folder === moveTo);
            await notify('warning', `${milestone?.title ?? moveTo} already has a file named ${name}.`);
            return;
        }
        if (Object.keys(updates).length > 0 && !await updatePlan(payload.resource, updates)) return;
        if (!moveTo) return;

        await attempt(`Could not move ${name}.`, async () => {
            const result = await call('explorer.move', payload.resource, moveTo);
            if (result !== 'ok') {
                throw new Error(result?.failedResources?.[0]?.message ?? JSON.stringify(result));
            }
        });
    }

    function namesInFolder(project, folder) {
        return ['README.md', '_milestone.md', ...project.plans
            .filter(plan => parentFolder(plan.resource) === folder)
            .map(plan => plan.name)];
    }

    function createPlan(project, folder, lane, title) {
        const resource = `${folder}/${uniqueFileName(namesInFolder(project, folder), title)}`;
        return attempt(`Could not create ${baseName(resource)}.`, () =>
            call('file.write', resource, planTemplate({ title, lane })));
    }

    function createMilestone(project, config, title, rootMissing) {
        const folderNames = project ? project.milestones.filter(m => !m.unsorted).map(m => m.name) : [];
        const folder = `${config.root}/${nextMilestoneFolder(folderNames, title)}`;
        return attempt(`Could not create the milestone "${title}".`, async () => {
            if (rootMissing) await call('explorer.createFolder', config.root);
            await call('explorer.createFolder', folder);
            await call('file.write', `${folder}/README.md`, milestoneTemplate(title));
        });
    }

    async function createMilestoneReadme(milestone) {
        const resource = `${milestone.folder}/README.md`;
        if (await attempt('Could not create the milestone README.', () =>
            call('file.write', resource, milestoneTemplate(milestone.title)))) {
            await openFile(resource);
        }
    }

    function createRoot(config) {
        return attempt(`Could not create the folder "${config.root}".`, () => call('explorer.createFolder', config.root));
    }

    // Adds or refreshes the Roadmapper section in the project's CLAUDE.md.
    async function writeAgentGuide(config, lanes, roadmapResource) {
        const section = agentInstructions({ ...config, lanes }, stripRoot(roadmapResource) || 'the .roadmap file');
        let existing = '';
        try {
            existing = await readFile('CLAUDE.md');
        } catch {
            // No CLAUDE.md yet, so one is created.
        }
        const updated = upsertSection(existing, section);
        const action = { resource: 'project:CLAUDE.md', label: 'Open CLAUDE.md' };
        if (updated === existing) {
            await notify('info', 'Agent guide is up to date.', action);
            return;
        }
        if (await attempt('Could not write CLAUDE.md.', () => call('file.write', 'CLAUDE.md', updated))) {
            await notify('info', existing ? 'Updated the agent guide.' : 'Added the agent guide to CLAUDE.md.', action);
        }
    }

    // Keeps the agent brief (see agents.js) up to date in Celbridge's temp: root, which is local to this
    // machine and never committed. Only writes when the text changes; a failure only costs agents a shortcut.
    let lastBrief = { resource: null, text: null };
    async function writeBrief(project, roadmapResource, today) {
        const resource = briefResource(stripRoot(roadmapResource));
        const text = roadmapBrief(project, { today, roadmapResource: stripRoot(roadmapResource) });
        if (lastBrief.resource === resource && lastBrief.text === text) return;
        try {
            await call('explorer.createFolder', 'temp:roadmapper').catch(() => { });
            await call('file.write', resource, text);
            lastBrief = { resource, text };
        } catch (e) {
            console.warn('[Roadmapper] Could not write the agent brief:', e);
        }
    }

    return {
        loadProject, openFile, revealFolder, updatePlan, reviewPlan, saveIdeas, deleteIdea, replyToIdea, listFolders, dropPlan, createPlan, createMilestone,
        createMilestoneReadme, createRoot, writeAgentGuide, writeBrief,
    };
}
