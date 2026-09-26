# NOTICE: vendored prior code (jury-approved)

This folder holds our prior mind-map component, reused with the jury's approval. The same
notice, together with the audio-to-notes reuse, is in `backend/app/vendored/NOTICE.md`.

## Mind map

We asked the jury whether we could reuse our prior mind-map code as a view over the lecture
handout: the builder in `enstine-core` and the React component in `enstine-notesapp`. The jury
**explicitly approved it on 26 Sep 2026 (~14:20 IST)**. The code **predates the BITSoM Builders
Pitch Fest**. Every copied file was first committed on 24 Sep 2026 and last changed before this
repository's first commit (26 Sep 2026, 11:43 IST).

### Frontend: copied into `frontend/src/vendored/mindmap/`

- **Origin:** `AngsysTech/Enstine-NotesApp` (private). Copied from commit `1cbf01a619e0`
  (HEAD at copy time). The listed files had no uncommitted changes.
- **Copied on:** 26 Sep 2026, ~14:55 IST.

| Vendored file | Origin path | First commit | Last commit | sha256 of original (first 12) |
|---|---|---|---|---|
| `MindMapGraph.jsx` | `src/components/mindmap/MindMapGraph.jsx` | 2026-09-24 `92a6d5f` | 2026-09-26 07:14 `1cbf01a` | `6d329963a51b` |
| `mindMapCanvas.js` | `src/components/mindmap/mindMapCanvas.js` | 2026-09-24 `92a6d5f` | 2026-09-24 `92a6d5f` | `7d198511a92a` |
| `mindMap.css` | `src/components/mindmap/mindMap.css` | 2026-09-24 `92a6d5f` | 2026-09-24 `92a6d5f` | `acc4a39b790c` |
| `mindMap.js` | `src/lib/mindMap.js` | 2026-09-24 `92a6d5f` | 2026-09-26 07:14 `1cbf01a` | `b1a873f38568` |
| `mindMapLayout.js` | `src/lib/mindMapLayout.js` | 2026-09-24 `92a6d5f` | 2026-09-24 `92a6d5f` | `b4b328b41d25` |

What each file does:

- `MindMapGraph.jsx`: the tree renderer. It draws nodes and branches and handles
  collapse/expand, the keyboard, and the zoom and fit controls.
- `mindMapCanvas.js`: the pan/zoom viewport and the node motion.
- `mindMapLayout.js`: the left-to-right tidy-tree layout (pure geometry).
- `mindMap.js`: indexes a flat node/edge projection and provides the expansion and search
  helpers.
- `mindMap.css`: node and branch colours.

Changes made inside that folder (import fixes only):

- `MindMapGraph.jsx`: `@/lib/mindMap` now imports from `./mindMap`, and `@/lib/mindMapLayout`
  from `./mindMapLayout`. `lucide-react` is not a dependency of this app, so its seven icons
  now import from `@/components/LectureMindMapIcons`. That module was written today and maps
  the same seven names to the app's Material Symbols. `@/lib/utils` is unchanged, because this
  app has the same `cn` helper.
- `mindMapCanvas.js`: `@/lib/mindMapLayout` now imports from `./mindMapLayout`.
- `mindMap.css`, `mindMap.js`, `mindMapLayout.js`: unchanged.

To check this, `diff` each file against its origin path above. The only lines that differ are
these imports.

Restyling happens outside the folder. `frontend/src/components/LectureMindMap.tsx` wraps the
component and overrides its colours with scoped CSS: white nodes, slate borders, ink text,
cyan branches, Lato. Nothing inside the folder is forked.

### Backend: nothing copied

We read `enstine-core/mindmap/` (commit `ede722e3af01`) and copied **no files** from it. So
`backend/app/vendored/mindmap/` does not exist. Two reasons:

- The structure-first builder (`projection_builder.py`) needs the materialisation pipeline
  (`candidate_builder`, `features.ingestion.materialization`), the learning-scope model, the
  Postgres repository and the LLM planner. That is about 9k lines across 20 modules. It cannot
  be lifted in five files, or without the pipeline.
- The one self-contained step is the model-free VIRTUAL_GROUP grouper
  (`fallback_grouper.py`). It produces group nodes, and `contracts.ts` v3.9 has no node kind
  for groups (`root | section | point | ghost_missed`).

The tree is built instead by `backend/app/tools/mindmap.py`, written today. The root is the
lecture title, with one node per handout section and one per key point. The coverage, marker
and action overlay is applied in code.

### Not copied

- No retrieval, materialisation, learning-scope or scoped-chat code.
- No S3 or Postgres code, and no auth.
- No Enstine branding, fonts or theme files, and no tests.
- None of `ConceptPanel.jsx`, `MindMapStates.jsx`, `MindMapTab.jsx` or `useMindMap.js`.

### Built today, outside the vendored folders

- `backend/app/tools/mindmap.py`: tree, overlay and cache.
- `backend/app/api/mindmap.py` and `backend/scripts/mindmap_smoke.py`.
- `frontend/src/components/LectureMindMap.tsx`: maps `MindMap` into the component's node
  shape, and adds the overlays, stats strip, hover card and Make it relevant.
- `frontend/src/components/LectureMindMapIcons.tsx`.
- `frontend/src/api/mindmap.ts` and the mock map `frontend/src/api/mock/mindmap.json`.

### Rule

`frontend/src/vendored/mindmap/` is read-only except for import fixes. New logic goes in
`LectureMindMap.tsx`, never there.
