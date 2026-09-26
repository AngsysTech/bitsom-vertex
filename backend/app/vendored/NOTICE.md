# NOTICE: vendored prior code (jury-approved)

This notice covers the two jury-approved reuses of our prior code. Each has its own
section: **Audio to notes** (`audio_notes/`, below) and **Mind map** (at the end). Together
they are the only pre-existing code in this repository.

## Audio to notes (`audio_notes/`)

The `audio_notes/` folder holds code copied from our own private repository. The code **predates the
BITSoM Builders Pitch Fest (26 Sep 2026)**. We disclosed it to the jury, who **explicitly
approved its use on 26 Sep 2026 (~12:30 IST)** for one step only: the class companion's
audio → timestamped transcript → structured notes.

- **Origin:** `AngsysTech/Enstine-Core` (private). Copied from commit `ede722e3af01`
  (HEAD at copy time). The working tree was clean for every file listed below.
- **Copied on:** 26 Sep 2026, ~12:55 IST.
- Every copied file was last changed on or before 24 Sep 2026:

| Vendored file | Origin path | First commit | Last commit | sha256 of original (first 12) |
|---|---|---|---|---|
| `transcription_service.py` | `services/transcription_service.py` | 2026-04-18 | 2026-06-08 `4c900bc` | `ed2f0dc92023` |
| `notes_generation.py` | `study/notes_generation.py` | 2026-04-13 | 2026-05-09 `c3d6760` | `4bc7b71e2811` |
| `study_schemas.py` | `core/study_schemas.py` | 2026-04-01 | 2026-09-24 `2047be7` | `8add0e3ddd48` |
| `schemas.py` | `core/schemas.py` | 2026-03-18 | 2026-09-18 `ec5c94d` | `04e558f56d5d` |
| `utils.py` | `study/utils.py` | 2026-04-01 | 2026-09-18 `ec5c94d` | `e0116feee7a7` |

### What each file does

- `transcription_service.py`: the STT wrapper. It submits to AssemblyAI and polls, or
  calls OpenAI Whisper, and returns text pages plus the raw timestamped payload.
- `notes_generation.py`: the note structuring step. It runs outline → per-topic section
  notes → validation → repair → cross-reference polish, and holds the prompts and JSON
  parsers.
- `study_schemas.py`, `schemas.py`: the Pydantic models the notes code reads and returns.
- `utils.py`: text helpers used by `notes_generation.py`.

### Changes made inside `audio_notes/` (import fixes only)

- `notes_generation.py`: `core.config.get_settings` and `core.llm_client.call_llm` now
  import from `app.tools.companion_bridge`. That is the dependency cut: every model call
  goes through `app/core/llm.py`. `core.study_schemas` now imports from
  `app.vendored.audio_notes.study_schemas`, and `study.utils` from
  `app.vendored.audio_notes.utils`.
- `study_schemas.py`: `core.schemas` now imports from `app.vendored.audio_notes.schemas`.
- `transcription_service.py`, `schemas.py`, `utils.py`: unchanged. The one `core.config`
  import in `transcription_service.py` sits under `TYPE_CHECKING` and never runs.
- `__init__.py`: an empty package marker, added so the folder can be imported.

To check this, `diff` each file against its origin path above. The only lines that
differ are these imports.

### Not copied

We did not copy the ingestion pipeline, the audio v2 semantic stages, retrieval (context
builder, embeddings), workflow, lease or queue infrastructure, schema versioning, S3 or
Postgres code, provider clients (`core/llm_client.py`), settings (`core/config.py`), or
deployment config. Where the notes code expected any of these, the dependency is cut at
the adapter, outside this folder:

- `app/tools/companion_bridge.py` provides `get_settings()` and `call_llm()`, which
  route to `app/core/llm.py`.
- `app/core/stt.py` is the only caller of `transcription_service.py`. It turns the raw
  payload into ~30 s `TranscriptSegment`s.
- `app/tools/companion.py` builds the notes input from transcript segments and adapts
  the notes output into `Handout` (`contracts.ts` §9b). The vendored schema never
  appears in the API.

`notes_generation.py` falls back to deterministic extractive notes when a model call
fails. The adapter drops those sections and records the drop in the `ToolTrace`
(AGENTS.md: no silent fallbacks).

### Built today, outside `audio_notes/`

The adapter, syllabus mapping, coverage, commitments, actions, calendar, provenance
verification and endpoints were all written on 26 Sep 2026.

### Rule

`audio_notes/` is read-only except for import fixes. New logic goes in
`app/tools/companion.py`, never here.

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
