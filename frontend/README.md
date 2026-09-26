# Student Workspace — frontend

Vite + React 19 + TypeScript + Tailwind v4 (shadcn-ready). Slack-style shell: rail · sidebar · pane · right panel.
The product is one feature: **a study planner that listens to your classes and adjusts every week** (AGENTS.md §1).

## Run

```bash
cd frontend
npm run dev                  # http://localhost:5173 — mock data by default (Meera opens first)
npm run dev -- --port 5555   # same, on the port the team uses
npm run build                # type-check + production build to dist/
npm run lint                 # oxlint
```

No separate install step: `dev` and `build` run `scripts/ensure-deps.mjs` first, which reinstalls (`npm ci`) whenever
`node_modules` wasn't installed from the current `package-lock.json` with the current Node version.

Needs Node 20+ (tested on 22.11 and 22.22). The toolchain is pinned to Vite 6 on purpose: Vite 7/8 need Node
≥ 22.12, and on older Node npm silently skips their native binding ("Cannot find native binding"). Don't delete
`package-lock.json`, and don't bump Vite past 6 or oxlint past 1.16 unless everyone on the team is on Node ≥ 22.12.

Recording needs a microphone and a secure origin: `localhost` works; a LAN IP over plain http does not (use
Upload audio or Paste transcript from the composer's **+** menu instead).

### Against the real backend

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000     # see backend/README.md
cd frontend && VITE_MOCK=false npm run dev                            # or open http://localhost:5173/?mock=0
```

## Mock vs real backend

| Setting | Effect |
|---|---|
| `VITE_MOCK` unset / `true` | In-browser mock server (`src/api/mock/`). Top bar shows a **Mock data** badge. |
| `VITE_MOCK=false` | Calls the FastAPI backend at `VITE_API_URL` (default `/api`, proxied by Vite to `http://localhost:8000`). |
| `?mock=0` / `?mock=1` in the URL | Overrides the env for a quick flip. |

Set `API_PROXY_TARGET` to proxy `/api` somewhere other than `http://localhost:8000`. Copy `.env.example` to `.env.local` to change the defaults.

**The mock reads the real synthetic dataset** straight from `../backend/app/data` (students Aarav, Meera, Rohan,
catalog, timetable, exam calendar, syllabi, past papers, the three lecture transcripts) with the backend parser's
section ids, so citations and dates line up with real output. Numbers are computed from that data the way the
backend does (impact = marks × past papers; slots around classes and exams). Anything a model writes in the real
backend — handouts, reply text, 1:1 lines, reframes — is canned or templated in the mock. Never demo it as real
output. What it gives you for rehearsal:

- Meera starts with last week's plan pre-marked done/missed (as `POST /demo/simulate-week` would), a processed CS F372
  lecture with one "I'm stuck" flag and two accepted actions, so the Weekly 1:1 dot is lit. Aarav has a processed
  CS F303 lecture; Rohan starts empty.
- Recording, upload and paste all run a fake 8-second pipeline (`transcribing → transcribed → processing → ready`).
  CS F212, CS F372 and CS F303 have canned handouts built from the dataset transcripts; other courses fail on
  purpose, which shows the **Retry / Use transcript instead** path. Flags map onto the transcript by position.
- Type "fail" in any message to see the error marker + retry path.

## Routes (hash)

| Route | View |
|---|---|
| `#/dm/academic_coach` | Coach DM: Messages · Canvas (Study plan · Calendar · Weekly 1:1) |
| `#/class/:courseCode` | Class channel, Messages tab (recording mode lives in its composer) |
| `#/class/:courseCode/lectures[/:lectureId[/:sectionOrSegmentId]]` | Lectures tab / a handout, optionally focused |
| `#/class/:courseCode/schedule` | That course's week in the calendar |
| `#/calendar` | Rail → Calendar (sidebar becomes Today · This week · Rebuild plan) |
| `#/channel/announcements` · `#/files[/:doc[/:section]]` · `#/agents` · `#/advisor` | As before |

Keyboard: **R** starts recording in a class channel, **S** taps "I'm stuck" while recording, **Esc** stops (or closes
the note field first), **⌘K / Ctrl+K** switches student.

## Endpoints the UI calls

One method per endpoint in `contracts.ts` §10 (`src/api/client.ts`). The backend on `main` doesn't serve these yet,
so in real mode their views show an error row with *try again* (never a blank or a stand-in):
`GET /students`, `GET /workspace/:id`, `GET /classes/:id`, `GET /students/:id/state`, `GET /files/:id`,
`GET /threads/:id/class/:courseCode`, `POST|GET /lectures/:id/markers`, `POST /relevant`, `GET /relevant/:id`.
`POST /chat` sends `courseCode` from class channels. Until the backend has class threads, a lecture's ready message
lands in the coach DM, and the lecture row in the class channel links there.

## Layout

```
src/types.ts                 copy of ../contracts.ts v3.5 (npm run sync-types) — the source of truth
src/api/client.ts            Api interface: one method per endpoint in contracts.ts §10
src/api/http.ts              FastAPI client (multipart for audio uploads)
src/api/mock/                dataset.ts (reads backend/app/data) · companion.ts (canned lecture output) · server.ts
src/store/workspace.ts       Zustand store: threads (DMs + class channels), lectures, cards, calendar cache, 1:1, MIR
src/store/companion.ts       recording (MediaRecorder), "I'm stuck" queue (posts in order), lecture jobs + 2 s polling
src/lib/route.ts             hash router
src/components/class/        ClassChannel · RecordingBar · HandoutView · LecturesTab · LectureRows · PasteDialog · ClassContext
src/components/calendar/     CalendarView (week/month, filters, status popover) — Calendar page, Schedule tab, coach canvas
src/components/cards/        one renderer per Card type (CoverageCard, ActionsCard, OneOnOneCanvas, RelevantCard, …)
src/components/relevant/     Make it Relevant trigger + inline slot (interest picker)
src/components/shell/        TopBar · Rail · Sidebar (TodayBlock, Classes) · RightPanel
src/components/views/        DM · Calendar page · channel · files · document reader · agents & tools · advisor desk
src/components/chat/         Messages (timeline) · MessageRow · Composer
```

Notes

- "I'm stuck" taps during a recording are kept locally with their timestamp and posted in tap order right after the
  upload (a lecture only exists once its audio is uploaded), before processing starts. Transient failures back off
  and retry; nothing blocks the recording.
- Citations: `[C1]` in message text renders a pill that previews the quote. Card `citationId`s resolve against the
  carrying message's citations by id or by section id; a bare section id (e.g. `syllabus.cs-f212.3.5`) renders as a
  chip that previews that section and opens it.
- Below-the-line agents (Course Planner, Campus Guide, clubs) render greyed as "Coming soon" and have no mock replies.
- Anything not built has a `data-tip="Coming soon"` tooltip, never a dead click.
