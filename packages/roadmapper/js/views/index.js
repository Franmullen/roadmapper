// The views Roadmapper can show. A view is one module with a default export:
//
//   export default {
//       id: 'pipeline',               // stored in the .roadmap file as "view"
//       label: 'Pipeline',            // the toolbar button
//       icon: 'arrow-right-square',   // a Bootstrap Icons name
//       zoomable: true,               // drawn on the pan-and-zoom canvas, or scrolled normally
//       fitAlign: 'center',           // how "fit to screen" places it: 'center' or 'top'
//       render(container, project, ctx) { },   // build the view's DOM inside container
//   };
//
// render() is called again whenever the files or settings change, so it builds from scratch each time.
// ctx (built in main.js) carries the settings, writability, today's date, the drag controller, and the
// actions a view may take: open(), reveal(), showMilestone(), and run.* for anything that changes files.
//
// To add a view: write views/<name>.js and add it to the list below. The milestone view is not listed
// because it is opened from the others rather than chosen on the toolbar.

import pipeline from './pipeline.js';
import board from './board.js';

export const VIEW_LIST = [pipeline, board];

export { default as milestoneView } from './milestone.js';
