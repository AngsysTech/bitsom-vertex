# NOTICE: vendored prior code (jury-approved)

This folder holds code copied from our own private repository. The code **predates the
BITSoM Builders Pitch Fest (26 Sep 2026)**. We disclosed it to the jury, who **explicitly
approved its use on 26 Sep 2026 (~12:30 IST)** for one step only: the class companion's
audio → timestamped transcript → structured notes. It is the only pre-existing code in
this repository.

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

## What each file does

- `transcription_service.py`: the STT wrapper. It submits to AssemblyAI and polls, or
  calls OpenAI Whisper, and returns text pages plus the raw timestamped payload.
- `notes_generation.py`: the note structuring step. It runs outline → per-topic section
  notes → validation → repair → cross-reference polish, and holds the prompts and JSON
  parsers.
- `study_schemas.py`, `schemas.py`: the Pydantic models the notes code reads and returns.
- `utils.py`: text helpers used by `notes_generation.py`.

## Changes made inside this folder (import fixes only)

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

## Not copied

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

## Built today, outside this folder

The adapter, syllabus mapping, coverage, commitments, actions, calendar, provenance
verification and endpoints were all written on 26 Sep 2026.

## Rule

This folder is read-only except for import fixes. New logic goes in
`app/tools/companion.py`, never here.
