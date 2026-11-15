// Every read and write Roadmapper makes to the project goes through here, using the Celbridge `cel.*`
// tools. Views never touch files: they call these actions through the context main.js hands them.

import {
    agentInstructions, buildProject, milestoneTemplate, nextMilestoneFolder, planTemplate, setFrontMatter,
    uniqueFileName, upsertSection,
} from './model.js';

const TREE_DEPTH = 8;

const stripRoot = key => key.replace(/^project:/, '');
const baseName = resource => resource.slice(resource.lastIndexOf('/') + 1);
const parentFolder = resource => resource.slice(0, resource.lastIndexOf('/'));

export class RootMissingError extends Error { }

export function createActions(client, { notify }) {
    const cel = () => client.cel;

    async function readFile(resource) {
        const result = JSON.parse(await cel().file.read(resource));
        return result.content ?? result.Content ?? '';
    }

    // Reads the board's folder into a project. Throws RootMissingError when the folder does not exist.
    async function loadProject(config) {
        let tree;
        try {
            tree = JSON.parse(await cel().file.getTree(config.root, TREE_DEPTH, '', ''));
        } catch (e) {
            throw new RootMissingError(String(e?.message ?? e));
        }

        // A first pass with no contents names every file the project needs.
        const outline = buildProject(tree, config.root, new Map(), config);
        const resources = [
            ...outline.plans.map(plan => plan.resource),
            ...outline.milestones.filter(m => m.metaResource).map(m => m.metaResource),
        ];

        const contents = new Map();
        if (resources.length > 0) {
            try {
                const result = JSON.parse(await cel().file.readMany(JSON.stringify(resources)));
                for (const entry of result.files ?? result.Files ?? []) {
                    contents.set(stripRoot(entry.resource ?? entry.Resource ?? ''), entry.content ?? entry.Content ?? '');
                }
            } catch (e) {
                console.warn('[Roadmapper] Could not read the plan files:', e);
            }
        }
        return buildProject(tree, config.root, contents, config);
    }

    async function openFile(resource) {
        try {
            await cel().document.open(resource, '', false, true);
        } catch (e) {
            console.warn(`[Roadmapper] Could not open ${resource}:`, e);
        }
    }

    async function revealFolder(folder) {
        try {
            await cel().explorer.select(folder, true);
        } catch (e) {
            console.warn(`[Roadmapper] Could not show ${folder}:`, e);
        }
    }

    // Writes front matter keys into a plan. The file is read fresh, so an edit made since the last scan is kept.
    async function updatePlan(resource, updates) {
        try {
            const content = await readFile(resource);
            await cel().file.write(resource, setFrontMatter(content, updates));
            return true;
        } catch (e) {
            console.error('[Roadmapper] Could not update a plan:', e);
            await notify('error', `Could not update ${baseName(resource)}.`);
            return false;
        }
    }

    async function movePlan(project, resource, folder) {
        const name = baseName(resource);
        const milestone = project.milestones.find(m => m.folder === folder);
        if (project.plans.some(plan => plan.resource === `${folder}/${name}`)) {
            await notify('warning', `${milestone?.title ?? folder} already has a file named ${name}.`);
            return false;
        }
        try {
            const result = await cel().explorer.move(resource, folder);
            const text = typeof result === 'string' ? result.trim() : JSON.stringify(result);
            if (text !== 'ok' && text !== '"ok"') {
                const failure = JSON.parse(text);
                const reason = failure.failedResources?.[0]?.message ?? 'the move was refused';
                await notify('error', `Could not move ${name}: ${reason}`);
                return false;
            }
            return true;
        } catch (e) {
            console.error('[Roadmapper] Move failed:', e);
            await notify('error', `Could not move ${name}.`);
            return false;
        }
    }

    // A drop can change a plan's lane and status (front matter) and its milestone (folder). The front
    // matter is written first, while the file is still where the scan found it.
    async function dropPlan(project, payload, target) {
        const updates = {};
        if (target.lane !== undefined && target.lane !== payload.lane) {
            updates.lane = target.lane || null;
        }
        if (target.status && target.status !== payload.status) {
            updates.status = target.status;
        }
        if (Object.keys(updates).length > 0) {
            await updatePlan(payload.resource, updates);
        }
        if (target.folder && target.folder !== payload.from) {
            await movePlan(project, payload.resource, target.folder);
        }
    }

    function namesInFolder(project, folder) {
        return ['README.md', '_milestone.md', ...project.plans
            .filter(plan => parentFolder(plan.resource) === folder)
            .map(plan => plan.name)];
    }

    async function createPlan(project, folder, lane, title) {
        const resource = `${folder}/${uniqueFileName(namesInFolder(project, folder), title)}`;
        try {
            await cel().file.write(resource, planTemplate({ title, lane }));
        } catch (e) {
            console.error('[Roadmapper] Could not create a plan:', e);
            await notify('error', `Could not create ${baseName(resource)}.`);
        }
    }

    async function createMilestone(project, config, title, rootMissing) {
        const folderNames = project ? project.milestones.filter(m => !m.unsorted).map(m => m.name) : [];
        const folder = `${config.root}/${nextMilestoneFolder(folderNames, title)}`;
        try {
            if (rootMissing) {
                await cel().explorer.createFolder(config.root);
            }
            await cel().explorer.createFolder(folder);
            await cel().file.write(`${folder}/README.md`, milestoneTemplate(title));
        } catch (e) {
            console.error('[Roadmapper] Could not create a milestone:', e);
            await notify('error', `Could not create the milestone "${title}".`);
        }
    }

    async function createMilestoneReadme(milestone) {
        const resource = `${milestone.folder}/README.md`;
        try {
            await cel().file.write(resource, milestoneTemplate(milestone.title));
            await openFile(resource);
        } catch (e) {
            console.error('[Roadmapper] Could not create a README:', e);
        }
    }

    async function createRoot(config) {
        try {
            await cel().explorer.createFolder(config.root);
        } catch (e) {
            console.warn('[Roadmapper] Could not create the folder:', e);
        }
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
            await notify('info', 'The Roadmapper guide in CLAUDE.md is up to date.', action);
            return;
        }
        try {
            await cel().file.write('CLAUDE.md', updated);
            await notify('info', existing ? 'Updated the Roadmapper guide in CLAUDE.md.' : 'Created CLAUDE.md with a guide for AI agents.', action);
        } catch (e) {
            console.error('[Roadmapper] Could not write CLAUDE.md:', e);
            await notify('error', 'Could not write CLAUDE.md.');
        }
    }

    return {
        loadProject, openFile, revealFolder, updatePlan, dropPlan, createPlan, createMilestone,
        createMilestoneReadme, createRoot, writeAgentGuide,
    };
}
