// The views Roadmapper can show. A view is one module with a default export, plus an optional
// stylesheet at css/views/<id>.css that main.js loads for it:
//
//   export default {
//       id: 'road',                   // also the stylesheet name, and how the .roadmap "view" names it
//       label: 'Road',                // the toolbar button
//       icon: 'signpost-2',           // a Bootstrap Icons name
//       zoomable: true,               // drawn on the pan-and-zoom canvas, or scrolled normally
//       fitAlign: 'center',           // how "fit to screen" places it: 'center' or 'top'
//       render(container, project, ctx) { },    // build the view's DOM inside container
//       mounted(container, project, ctx) { },   // optional: runs once the DOM is on the page, to measure it
//   };
//
// render() runs again whenever the files or settings change, so it builds from scratch each time.
// ctx (built in main.js) carries the settings (config), how the editor shows them (ui), writability,
// today's date, the drag controller, and what a view may do: open(), reveal(), showMilestone(), and the
// commands that change files (createPlan, createMilestone, updatePlan, createMilestoneReadme).
//
// To add a view: write views/<id>.js (and css/views/<id>.css), and add it to the list below. The
// milestone view is not listed because it is opened from the others rather than chosen on the toolbar.

import road from './road.js';
import map from './map.js';

export const VIEW_LIST = [road, map];

export { default as milestoneView } from './milestone.js';
