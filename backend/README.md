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
| transcribe | audio → vendored STT (`core/stt.py`) → ~30 s segments; a video's audio track is extracted locally first (`core/media.py`, ffmpeg); or `transcriptText` → ~40-word segments with synthetic timestamps | code + provider |
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
`GET /lectures/:id/handout` · `GET /lectures/:id/cards` · `GET /lectures/:id/audio` ·
`POST|GET /lectures/:id/markers` · `POST /actions/:id` · `GET /students/:id/lectures` ·
`GET /calendar/:studentId?from&to&courseCode` · `GET /threads/:studentId/:agentId` ·
`GET /threads/:studentId/class/:courseCode`

The lecture-ready message, failures and stuck-marker notes land in the class thread
`<studentId>:class:<courseCode>` (see `core/threads.py`).

Uploads (`audio` in multipart) can be audio (mp3, m4a, wav, webm, ogg, flac, aac…) or a
lecture video (mp4, mov, mkv, avi, m4v…). They are kept on disk under
`data/lectures/<lectureId>/` (gitignored): `audio.<ext>` for audio, or `video.<ext>` plus the
extracted `audio.m4a` (mono 16 kHz AAC, ~20 MB per hour) for video. STT reads the audio
file, and `GET /lectures/:id/audio` serves it. A file with no audio track is refused with a 400.
Video needs `ffmpeg`/`ffprobe` on PATH (`brew install ffmpeg`); without them the video goes
to STT as-is.

Stuck markers (`{atSec, note?}`) are accepted at any status. Code resolves each one to
the segment covering `atSec`, then the section holding that segment (or the nearest
section), then that section's topic. A new pipeline step turns them into
`HandoutSection.stuck`, `CoverageCard.confusion` and a review action with
`provenance.markerId`. A marker added after "ready" is applied at once: the cards
recompute and a short note goes to the class thread. No model call is involved.

### Definition-of-done smoke test

```bash
.venv/bin/python scripts/companion_smoke.py --audio path/to/dbms_clip.mp3   # or --make-audio (macOS `say`)
```

It starts its own server on a temporary database, then runs checks 1–8: the text path,
coverage, commitments, actions, accept → plan + calendar, real STT, and STT key killed.

## Academic Coach: week plan, calendar, weekly 1:1, chat (Feature 2)

LLM reads, code counts, LLM advises. Every number a student sees is computed in Python;
the model picks from closed lists and writes short clauses, and code verifies what it picks.

| Tool / module | What | Code vs model |
|---|---|---|
| `tools/diagnose.py` · `diagnose_performance` | per Sem-5 topic: `scored/max` (sum of internal-mark components naming it) × `examWeight` (mean marks in the last 3 end-sems) → `impact` → `WeakTopicsCard`, written to `StudentState.weakTopics` | code only |
| `tools/plan.py` · `build_study_plan` | per week, minutes per weak topic (+ carry-over from the 1:1) → 25/50-min blocks after the last class of the day, never over a class/quiz/exam, each course before its end-sem, ≤ 120 min/day incl. accepted actions → `StudyPlanCard` + one `CalendarItem` per block (`source.type = "plan_block"`) | model allocates (closed-choice topic/section ids, verified); code places and writes every number in `why` |
| `tools/calendar.py` | `GET /calendar` merge (timetable → class, exam calendar → exam/quiz, plan → study_block, accepted actions → action/prep/deadline); `POST /calendar/items/:id/status` | code |
| `tools/lookback.py` · `weekly_review` | Weekly 1:1: recap from the last 7 days of calendar items; wins/concerns/questions/adjustments; complete → re-plan with carry-over, optional advisor ticket | recap is code; model writes lines, each must cite a recap topic or number and state no other number |
| `agents/academic_coach.py` | `POST /chat`: route (closed tool list) → tool → compose with `[Cn]` markers from verified citations only | model routes and writes; code verifies markers and numbers |
| `core/parser.py`, `core/scope.py`, `core/citations.py` | documents with stable section ids (`handbook.5.4`, `syllabus.cs-f212.1.4`, `exam_calendar.cs-f212`, `past_papers.cs-f212.normalization`); per-agent scope enforced in code; quotes verified verbatim | code |
| `escalation.py` | tickets, advisor inbox, reply lands in the student's DM | code |

**Impact scale.** `impact = examWeight × (1 − scored/max)`, divided by the heaviest end-sem
topic in `past_papers.json` (Normalization, 20 marks) and × 100, so 100 means scoring nothing on
the heaviest topic. The division is monotonic, so the ranking is exactly the ranking of
`examWeight × (1 − scored/max)`. Meera: Normalization 67, B+ trees 65, CPU scheduling 61.

**Exam times.** `exam_calendar.json` has dates only, so exams and quizzes are all-day items and
no study block is placed on those days. No time is invented.

**Prompts:** `prompts/plan_allocate.md`, `lookback.md`, `academic_coach_route.md`,
`academic_coach_answer.md` (evidence for `answer_from_docs`), `academic_coach_compose.md`.
`run_degree_audit` is a stub that answers "audit not available yet" until Feature 3 lands.

### Endpoints

`POST /chat {studentId, agentId: "academic_coach", text, courseCode?}` · `POST /calendar/items/:id/status {status}` ·
`GET /one-on-one/:studentId/current` · `POST /one-on-one/:id/answer {questionId, answer}` ·
`POST /one-on-one/:id/complete {shareWithAdvisor}` · `GET /advisor/inbox` · `POST /advisor/reply {ticketId, text}` ·
`GET /documents/:docId` · `GET /documents/:docId/sections/:secId` ·
`POST /students/:id/diagnose` (→ WeakTopicsCard) · `POST /students/:id/plan` (→ StudyPlanCard) ·
`POST /relevant {studentId, interest?, source}` · `GET /relevant/:studentId`.

Workspace boot reads (`app/workspace.py`, `app/api/workspace.py`): `GET /students` · `GET /workspace/:id` ·
`GET /classes/:id` · `GET /students/:id/state` (weak topics computed on first load; no audit yet) ·
`GET /students/:id/records` · `GET /files/:id` · `GET /connectors`.

**Class channels.** `POST /chat` with `courseCode` writes to the thread `<sid>:class:<courseCode>`
and scopes the coach, in code, to that course's syllabus, exam-calendar entry, past papers and
catalog entry (`core/scope.class_sections`, `prompts/academic_coach_class_route.md`). Anything
about other courses or program rules gets "ask me in my DM"; a class channel never opens tickets.

**Make it Relevant** (`tools/relevant.py`, `prompts/make_it_relevant.md`). Code resolves the
source (handout section, plan block, weak topic, graded-answer gap) to its concept, course,
facts and citations; one LLM call writes `standard` and `reframed` from those facts only. Use it on
a handout section: the synthetic syllabus text is generic, so a bare weak-topic card can say little.

### Demo setup step (disclosed): simulate a week

```bash
curl -X POST localhost:8000/students/meera/plan            # build the plan first
curl -X POST localhost:8000/demo/simulate-week/meera       # then fast-forward one week
```

`POST /demo/simulate-week/:studentId` marks the student's plan blocks and accepted-action items
in the next 7 days done or missed deterministically (every third, in time order, is missed),
then moves that student's clock (`core/clock.py`) forward 7 days, so the Weekly 1:1 has a real
week to review. It changes statuses and the clock only; it writes no text. Say so on stage.
Planning and the 1:1 read time from `core/clock.py`; message timestamps stay on the wall
clock, and the class companion's own date logic stays on the wall clock too.

### Definition-of-done smoke test

```bash
.venv/bin/python scripts/feature2_smoke.py                 # check 3 runs the class companion
.venv/bin/python scripts/feature2_smoke.py --no-companion  # check 3 inserts one action directly
```

It starts its own server on a temporary database and runs checks 1–7: diagnose, plan
placement, the merged calendar with an accepted companion action, simulate week → 1:1 →
complete with an advisor ticket, and three `/chat` routes (`build_study_plan`, `escalate`,
`answer_from_docs`). Expectations come from the dataset files, not from the app.

## Dataset (`app/data/`)

This folder holds the generated synthetic dataset, copied from `backend_dataset/app/data`
on 26 Sep. See `app/data/README.md` for its planted demo traps. To check it, run
`python app/data/validate.py`.

The companion reads these files. Each loader accepts the generated shape, and also a
simpler flat shape (`sessions[]`, `exams[]`, `papers[].topics[]`) for hand-written test
data:

- `syllabus/<course-slug>.md`, e.g. `cs-f212.md`: `## Unit N: Title`, then one
  `### Topic` per topic (or `- N.M Topic`). Section ids come out as
  `syllabus.<slug>.N.M`, and topic strings are the closed list every model call picks from.
- `timetable.json`: `rows: [{courseCode, day: "Monday", start, end, room, kind}]`. Course
  titles come from `catalog.json`.
- `exam_calendar.json`: `courses: [{courseCode, midSemDate, endSemDate, quizDates[]}]`.
  These have dates only, so exams are all-day and no time is invented.
- `past_papers.json`: `courses: [{courseCode, papers: [{year, topicMarks}]}]`, all
  end-sem. When a syllabus topic has no marks of its own (Two-phase locking), the action
  cites its unit topic instead: "part of Transactions and concurrency, which carried
  16–18 marks…".
- `students/<id>.json`: the profile plus `{transcript, internalMarks, registrations}`
  envelopes of the form `{connectorId, rows}`.
- `lectures/*.md`: transcripts. Front matter and `#` headings are stripped before
  segmenting.

## Storage

`data/app.db` (gitignored) is one `docs` table of JSON bodies keyed by `(kind, id)`. See
`core/db.py`. `StudentState` is stored under kind `state` through `core/state.py`, so the
audit and the planner should read and write it there too.
