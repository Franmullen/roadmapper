---
status: done
lane: core
---
# Split into model, actions and views

Views only draw. One module reads the files into a project model, one module makes every file change, and each view is a single file in `js/views/`.

## Tasks

- [x] `model.js`: pure, tested, builds `{ milestones, plans, lanes }` from the folder tree and file contents
- [x] `actions.js`: every Celbridge read and write (load, move, update, create, agent instructions)
- [x] `views/`: board, milestone detail and pipeline, behind one `render(container, project, ctx)` contract
- [x] `main.js`: document lifecycle, toolbar and view switching only
