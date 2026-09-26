# Backend: Student Workspace API

FastAPI + SQLite, plain JSON, no auth, no streaming. Types mirror `../contracts.ts`.

```bash
cd backend
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
cp .env.example .env        # fill in the keys
.venv/bin/uvicorn app.main:app --reload --port 8000
```

## Disclosed prior code

`app/vendored/audio_notes/` holds our prior audio-to-notes code (STT wrapper + note
structuring). It predates the challenge, and the jury approved its use on 26 Sep 2026. It
is read-only except for import fixes, and everything outside that folder was built today.
Its `NOTICE.md` lists the origin, the files copied and the exact changes.

## Class companion (Academic Coach tool, contracts §9b)

`app/tools/companion.py`. Each step is one function, and each writes to SQLite before the
next step starts:

| Step | What | Code vs model |
|---|---|---|
| transcribe | audio → vendored STT (`core/stt.py`) → ~30 s segments; or `transcriptText` → ~40-word segments with synthetic timestamps | code + provider |
| handout | topic split → vendored note structuring → adapter into `Handout` → syllabus mapping (closed list) | model, verified |
| coverage | unit topics vs handout: covered / missed / emphasized | model, verified |
| commitments | next-lecture topics, assignments, readings, deadlines, exam hints | model extracts; code resolves dates |
| actions | candidates from missed + emphasized + commitments + the student's marks → titled actions | code decides kinds, dates and marks; model writes titles and the reason |
| notify | agent message in the `academic_coach` thread with both cards and the trace | code |

Verification: every `segmentId` must exist in the transcript, every quote must appear
verbatim (whitespace-normalised) in its segment, and every syllabus id must exist in the
parsed syllabus. Anything that fails is dropped and counted in the `ToolTrace`. A
failed step sets `Lecture.status = "failed"` with `error`, adds a trace entry with `error`,
and posts a system line in the thread.

Model calls go through `core/llm.py` only, and STT calls through `core/stt.py` only.
Prompts are in `app/prompts/class_companion.md`.

### Endpoints

`POST /lectures` · `POST /lectures/:id/process` · `GET /lectures/:id` · `GET /lectures/:id/transcript` ·
`GET /lectures/:id/handout` · `GET /lectures/:id/cards` · `GET /lectures/:id/audio` · `POST /actions/:id` ·
`GET /students/:id/lectures` · `GET /calendar/:studentId?from&to` · `GET /threads/:studentId/:agentId`

### Definition-of-done smoke test

```bash
.venv/bin/python scripts/companion_smoke.py --audio path/to/dbms_clip.mp3   # or --make-audio (macOS `say`)
```

It starts its own server on a temporary database, then runs checks 1–8: the text path,
coverage, commitments, actions, accept → plan + calendar, real STT, and STT key killed.

## Dataset files the companion reads (`app/data/`)

The files in the repo now are **stubs** (marked `stub`/`_stub`). Replace them with the
generated dataset, keeping these shapes:

- `syllabus/<course-slug>.md`, e.g. `cs-f212.md`. Front matter has `docId`,
  `courseCode`, `title` and `connectorId`. Each unit is `## Unit N: Title`, with its
  topics as `- N.M Topic` lines (or `### N.M Topic`). Section ids come out as
  `<docId>.N.M`.
- `timetable.json`:
  `{connectorId, timezone, term: {start, end}, sessions: [{id, courseCode, title, kind: "lecture"|"tutorial"|"lab", day: "Tue", start: "11:00", end: "12:50", room}]}`
- `exam_calendar.json`:
  `{connectorId, exams: [{id, courseCode, kind: "exam"|"quiz", component: "Mid-sem"|"End-sem"|"Quiz 2", title, date, start, end}]}`
- `past_papers.json`:
  `{connectorId, papers: [{id, courseCode, exam: "End-sem"|"Mid-sem", year, totalMarks, topics: [{topic, marks}]}]}`.
  Topic names must match the syllabus topic strings, or the marks cannot be looked up.
- `students/<id>.json`: `{student: {...}, records: {transcript, internalMarks, registrations}}`.
  Each record is `{connectorId, rows}`, and internal-mark `topic` values use the syllabus
  topic strings.
- `lectures/*.md`: transcripts. Front matter and `#` headings are stripped before
  segmenting.

## Storage

`data/app.db` (gitignored) is one `docs` table of JSON bodies keyed by `(kind, id)`. See
`core/db.py`. `StudentState` is stored under kind `state` through `core/state.py`, so the
audit and the planner should read and write it there too.
