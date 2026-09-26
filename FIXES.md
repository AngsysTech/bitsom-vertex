# FIXES — frontend ↔ backend integration, Sat 26 Sep 2026

Every break found while wiring the UI (`VITE_MOCK=false`) to the backend on `:8000`, checked against
`contracts.ts` v3.9. Evidence comes from the browser (the Browser pane, real mode) plus an API-level contract check
that calls every endpoint the way `frontend/src/api/http.ts` does. Owner: `backend` = the backend session that owns
the endpoint, `frontend` = this integration pass, `contract` = `contracts.ts` (edited by the user only).

Status: **fixed** (commit named), **open**, **env** (the test setup, not the product).

| # | Flow | Endpoint | Field | Expected (v3.9) | Actual | Owner | Status |
|---|---|---|---|---|---|---|---|
| 1 | boot | `GET /students` | — | `Student[]` | 404: real mode could not boot at all | backend (Feature 2) | fixed `6798f48` |
| 2 | boot | `GET /workspace/:id` | — | `{channels, classes, agents, connectors}` | 404 | backend (Feature 2) | fixed `6798f48` |
| 3 | boot | `GET /classes/:id` | — | `ClassChannel[]` | 404 | backend (Feature 2) | fixed `6798f48` |
| 4 | boot | `GET /students/:id/state` | — | `StudentState` | 404 | backend (Feature 2) | fixed `6798f48` |
| 5 | boot | `GET /files/:id` | — | `WorkspaceFile[]` | 404 | backend (Feature 2) | fixed `6798f48` |
| 6 | 1 | `GET /threads/:sid/class/:courseCode` | — | `Thread` with the lecture-ready message | 404; the ready message went to the `academic_coach` DM | backend (Companion) | fixed `f654ecc` |
| 7 | 2 | `POST /lectures/:id/markers`, `GET …/markers` | — | `StuckMarker`, `StuckMarker[]` | 404 | backend (Companion) | fixed `f654ecc` |
| 8 | 1 | `GET /lectures/:id/cards` (and the card in the thread) | `coverage.confusion` | `[]` when nothing is flagged (required) | field missing. `http.ts` already defaults it to `[]`, so nothing broke | backend (Companion) | fixed `f654ecc` (always present now) |
| 9 | 4 | `GET /calendar/:sid?courseCode=CS F212` | `courseCode` | only that course's items | ignored: 68 items across 7 courses | backend (Companion) | fixed `f654ecc` |
| 10 | 4 | `POST /chat {courseCode}` | `courseCode` | scoped to the course; both messages in `<sid>:class:<courseCode>` | ignored; replies went to the DM | backend (Feature 2) | fixed `c766256` |
| 11 | 4 | `GET /one-on-one/:sid/current` | `recap.window` | `{from, to}` | `windowStart` / `windowEnd` | backend (Feature 2) | fixed `9bece55` |
| 12 | 4 | `GET /one-on-one/:sid/current` | `recap.flaggedTopics` | `[{topic, times}]` (required) | missing | backend (Feature 2) | fixed `9bece55` |
| 13 | 4 | `GET /one-on-one/:sid/current` | `recap.weakTopicMovement[]` | `{topic, from, to}` | extra `course` field | backend (Feature 2) | fixed `9bece55` |
| 14 | — | `POST /demo/simulate-week/:sid` | `updated` | `{updated, clockNow}` | no `updated` (FINDINGS.md) | backend (Feature 2) | fixed `9bece55` |
| 15 | 5 | `POST /relevant`, `GET /relevant/:sid` | — | `RelevantCard`, `RelevantCard[]` | 404 | backend (Feature 2) | fixed `b7182dd` |
| 16 | 4 | `GET /discover/:sid`, `POST /picks/:id` | — | `PicksCard`, `Pick` | 404: discovery is not merged. Step 4.5 is skipped | backend (discovery) | open |
| 17 | 4 | `POST /chat` "What should I study this week?" | latency | ≤ 10 s | 24.1 s on the first ask after a reset (one ~18 s plan allocation). Running `POST /students/meera/plan` in demo prep brings it to ~5 s (Feature 2) | backend (Feature 2) | open: demo prep |
| 18 | 1 | contract §10, "when a lecture reaches ready" | thread | — | the text still says the `academic_coach` thread; the backend now posts to the class thread | contract | open (user) |
| 19 | 1 | record path in the Browser pane | `getUserMedia` | recording starts | "Microphone unavailable (Permission denied). Upload a recording instead, or paste a transcript from the + menu." The pane blocks the mic | env | env: see INTEGRATION.md for the virtual-mic run |
| 20 | all | `frontend/src/types.ts` | — | exact copy of `contracts.ts` | it was the v3.5 copy | frontend | fixed (this pass) |
| 21 | 3 | `frontend/src/api/mindmap.ts` | types | from `@/types` | local v3.9 copies, and `ApiError` dropped the HTTP status | frontend | fixed (this pass) |
| 22 | 1 | `POST /lectures` + `/process` with `Lecture.mp3` | latency | ≤ 90 s processing | 300.9 s end to end (46:29 of audio; transcription alone is most of it) | backend (Companion) | open: demo with the transcript or the 14:45 stage clip (`backend/data/stage/dbms_demo.mp3`) |
| 23 | 1 | `GET /lectures/:id/cards` for `Lecture.mp3` in CS F212 | `coverage.unit`, `actions.items[].topic` | a CS F212 unit, and topics from the syllabus | `unit: ""`, nothing covered or missed; 6 actions whose topics are sentences from a probability lecture ("The multiplication rule result for sampl…", "Some of Newton's work…"). `Lecture.mp3` is MATH F241, not CS F212 (FINDINGS #2) | backend (Companion) | open |
| 24 | 2 | `GET /lectures/:id/cards` (virtual-mic recording) | prep `why` | the next CS F212 session (Mon/Thu 09:00) | "next CS F212 lecture: Tue 29 Sep, 00:00": the lecturer's "Tuesday next week" became midnight and was labelled as a CS F212 session | backend (Companion) | open |
| 25 | 3 | `GET /lectures/:id/handout` before ready | UI copy | a not-ready state | "Couldn't load the handout: handout for … not ready (status processing) — try again". The Handout / Mind map toggle only shows once the handout loads, so the map's own not-ready line can't be reached. The behaviour is right; the wording reads as an error | frontend | open (copy; renderers are frozen for this pass) |
| 26 | 5 | `POST /relevant` with a `weak_topic` / `plan_block` source (also a ghost node) | `standard` | lecture-grounded facts | Correct but generic: the synthetic syllabus has one stock line per topic ("a named assessable topic … definitions, worked examples…") plus the marks. Handout-section sources explain the lecture content well | backend data | open: demo MIR on a handout section (Feature 2's advice too) |
| 27 | 4, 6 | `POST /chat` "What should I study this week?" (Aarav) | `trace[].error` | no error on a reply that succeeded | `build_study_plan.place: "1 blocks unplaced"` (FINDINGS #5), so the "Worked for 28.4s" row gets a red error icon on stage. Latency 28.4 s (allocation alone 24.7 s) | backend (Feature 2) | open |
| 28 | 6 | `POST /lectures` + `/process` with `Lecture.mp3` (Aarav) | latency | ≤ 90 s | 116.6 s (Meera's run of the same file took 300.9 s) | backend (Companion) | open (same root cause as #22) |
| 29 | all | `:8000` | env | one stable server during verification | my server on `:8000` was SIGTERM'd, then SIGKILL'd; a `uvicorn --reload` from a VS Code terminal took the port, and peer backend edits restart it mid-flow (one reload interrupted a UI step). A `--reload` restart also kills any lecture still processing | env | open: run the demo server without `--reload` (DEMO.md §1) |
