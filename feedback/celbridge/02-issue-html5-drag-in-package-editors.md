<!-- GitHub issue (bug report). Status: draft, not posted. Tested with a real mouse on 2026-11-15. -->

# Package editors: an HTML5 drag ends as soon as it starts (dragstart, then dragend with no drop)

**Celbridge version:** 1.7.0

**Operating system:** Windows 11 Home (10.0.26200)

**Steps to reproduce**

1. Open a document in a package editor (a document editor contributed by a package, which runs in a web view).
2. In the page, make an element `draggable="true"` with a `dragstart` handler that sets data, and give another element `dragover` (calling `preventDefault()`) and `drop` handlers.
3. Drag the element onto the target with a real mouse.

**What happened?**

The drag starts, then ends at once. A probe page that logs every event recorded this over four attempts with a real mouse:

| Event | Fired |
|---|---|
| `pointerdown` | 4 |
| `dragstart` (data set, `types: text/plain`) | 4 |
| `pointercancel` | 4 (expected once a native drag begins) |
| `drag` | 0 |
| `dragenter`, `dragover` on the target | 0 |
| `drop` | 0 |
| `dragend` | 4, at once, with `dropEffect: none` |

Because `drag` never fires, the drag ends before the pointer moves at all. So the page sets the drag up correctly, and the native drag session seems to be cancelled straight away between WebView2 and the host window. No drag image follows the pointer.

Expected: the standard HTML5 drag-and-drop events fire and the drop lands, as in Edge or Chrome.

Context: Roadmapper (a package with a kanban-style board) first used HTML5 drag and drop, and dragging cards did nothing with a real mouse. We switched to pointer events, as Celbridge's own `card-list.js` and `splitter.js` do, and that works. If HTML5 drag is unsupported in package web views on purpose, a line in the package or editor guide would save the next package author the investigation.

**A probe to reproduce it:** paste this into a package editor page (or run it with `webview_eval` on an open package document), then drag the blue box onto the dashed box:

```js
(() => {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;padding:10px;background:#fff;border:2px solid #3b82f6';
  box.innerHTML = '<div id="src" draggable="true" style="padding:10px;background:#3b82f6;color:#fff">Drag me</div>'
    + '<div id="dst" style="margin-top:8px;padding:10px;border:2px dashed #888">Drop here</div><pre id="log"></pre>';
  document.body.appendChild(box);
  const seen = {};
  const log = name => { seen[name] = (seen[name] || 0) + 1; box.querySelector('#log').textContent = JSON.stringify(seen); };
  const src = box.querySelector('#src'), dst = box.querySelector('#dst');
  src.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'x'); log('dragstart'); });
  src.addEventListener('drag', () => log('drag'));
  src.addEventListener('dragend', e => log('dragend:' + e.dataTransfer.dropEffect));
  dst.addEventListener('dragover', e => { e.preventDefault(); log('dragover'); });
  dst.addEventListener('drop', e => { e.preventDefault(); log('drop'); });
})()
```

Expected in a browser: `dragstart`, many `drag` and `dragover`, then `drop` and `dragend:move` (or `copy`). In Celbridge 1.7.0 on Windows: `{"dragstart":1,"dragend:none":1}`.

**Where it may come from:** I couldn't find anything in Celbridge that turns drag off on purpose. The web view hosts (`WindowsWebView`, `WebViewBase`) don't handle drag events at all. This is the packaged Windows build (`org.celbridge.Celbridge_1.7.0.0`), which hosts WebView2 through WinUI, so the cause may be in WinUI's WebView2 rather than in Celbridge. If so, this report is mainly worth a note for package authors. Celbridge's own explorer already uses a pointer-driven drag on the Skia heads because built-in drag is unreliable there, and pointer events work well in a package editor too.

**Screenshots and logs:** a log can be attached on request. I haven't tested macOS.
