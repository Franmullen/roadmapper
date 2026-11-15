<!-- GitHub issue (bug report). Status: WAITING for a real-mouse test of the probe, then fill in "What happened?". -->

# Package editors: native HTML5 drag and drop does not work with a real mouse

**Celbridge version:** 1.7.0

**Operating system:** Windows 11 Home (10.0.26200)

**Steps to reproduce**

1. Open a document in a package editor (a document editor contributed by a package, which runs in a web view).
2. In the page, make an element `draggable="true"` with a `dragstart` handler that sets data, and give another element `dragover` (calling `preventDefault()`) and `drop` handlers.
3. Drag the element onto the target with a real mouse.

**What happened?**

_TO FILL IN from the probe: which of pointerdown / dragstart / dragenter / dragover / drop / dragend fired._

Expected: the standard HTML5 drag-and-drop events fire and the drop lands, as in Edge or Chrome.

Context: Roadmapper (a package with a kanban-style board) first used HTML5 drag and drop, and dragging cards did nothing with a real mouse. We switched to pointer events, as Celbridge's own `card-list.js` and `splitter.js` do, and that works. If HTML5 drag is unsupported in package web views on purpose, a line in the package or editor guide would save the next package author the investigation.

**Screenshots and logs:** _attach the probe screenshot._
