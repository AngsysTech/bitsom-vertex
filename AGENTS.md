# AGENTS.md — Student Workspace (BITSoM Builders Pitch Fest, EdTech AI track)

Read this before touching the repo. It is the single source of what we agreed. `contracts.ts` is the source of truth for types and endpoints; if this file and `contracts.ts` disagree, `contracts.ts` wins and this file gets fixed.

Deadline: **5:30pm today (Sat 26 Sep 2026)**. 7-min demo + 3-min Q&A + one slide. Code uploaded to the provided link before the deadline.

---

## 1. What we're building, in one paragraph (refocused 1:15pm after mentor feedback: one feature, at depth)

**A study planner that listens to your classes and adjusts every week.** Inside a Slack-style workspace the student DMs one agent, the Academic Coach. In class: the lecture is recorded, the student taps "I'm stuck" when lost, and the coach produces a handout checked against the syllabus (what was covered, what the lecturer promised, where you got lost, and where to study each part: the university reading list, plus an AI-suggested online page in Make it Relevant). We don't grade the lecture (§9.10). After class: those become actions with exam weight behind them, placed into a weekly plan and a merged calendar around classes and exams. Every week: a 1:1 lookback reviews what got done, asks about what didn't, and adjusts the plan. Any concept — a stuck section, a plan block, a weak topic — can be reframed through the student's own interest (Make it Relevant). Every claim is cited to syllabus, past papers or the lecture itself; when the docs run out, it escalates to a human advisor. This answers "how do I plan my learning" and "what should I do differently based on my performance" at depth, and "manage their time" directly.

Below the line (built only if the planner demos cleanly): course recommender, degree audit, clubs/social, buddy timer. Vision on the slide: more agents on the same grounded student layer, real LMS/ERP connectors, a memory layer, ink/Outlook export of markers and plans.

## 2. Rules we must not break (from the brief)

- **No private pre-existing code, with one disclosed exception.** The jury explicitly approved reusing two pieces of our prior code: the **audio-to-notes pipeline** (asked ~12:30) for the class companion, and the **mind-map builder + mind-map React component** (asked ~14:20) as a view over the lecture handout. That code lives **only** in `backend/app/vendored/{audio_notes,mindmap}/` and `frontend/src/vendored/mindmap/`, each with a `NOTICE.md` stating what was ported, that it predates the challenge, and that the jury approved it. It is named on the slide, in the README and in Q&A. Nothing else from Enstine or any prior private repo is copied, ported, paraphrased or "mimicked" in, by a human or a coding agent — the syllabus coverage step, the actions step, the audit, the planner, the UI and the shared layer are all clean-room, built today from this file and `contracts.ts`.
- **Synthetic data only.** No real student data. Every dataset file is generated today and lives in `backend/app/data/`.
- **No simulated intelligence.** Hardcoding is fine for setup, routing and supporting functions. It is not fine for any response content, recommendation, or reasoning that makes the AI look smarter than it is. If a feature can't be done for real, it goes on the "next" slide, never faked. This applies to club-agent chat especially.
- **Assumptions stated.** Single program, English documents, synthetic connectors. Say it on the slide.
- **Max 2 people, no outside help.** AI tools are allowed.
- **Frozen after submission.** Nothing after 5:00pm push counts.

## 3. Architecture

```
frontend/   Vite + React 19 + TS + Tailwind v4 + shadcn (Slack-style shell)
backend/    FastAPI + SQLite, plain JSON, no streaming, no auth
contracts.ts   shared types + endpoint list (copied to frontend/src/types.ts)
```

**Shared layer (built once, everything rides on it):**

| Piece | Responsibility |
|---|---|
| `core/parser.py` | Markdown headings → `DocumentSection`s with stable IDs (`handbook.4.2`); JSON files load as-is. **No PDF, no OCR, no document AI today** — connectors deliver structured content (markdown/JSON). Disclosed on the slide; PDF ingestion is a separate layer we'd add later |
| `core/scope.py` | Per-agent allowed doc set. Enforced in code, not in the prompt. An agent physically never sees docs outside its scope |
| `core/context.py` | Whole-scope context: the agent's allowed docs fit in context, so no embeddings, no vector DB. Docs are serialised with their section IDs so the model can cite |
| `core/citations.py` | Closed-choice citations. Model emits `[C1]` + `{sectionId, quote}`; we verify the quote exists verbatim in that section. Unverifiable citation → drop it and flag in trace; never invent |
| `core/state.py` | `StudentState` (audit, weak topics, plan, skills gap) in SQLite. Audit agent writes; other agents read. This is the only "coordination" between agents |
| `core/records.py` | `StudentRecords` (transcript, internal marks, registrations) tagged with `connectorId` |
| `core/llm.py` | One provider, env-configured, JSON-mode helper, retries, timing for `ToolTrace` |
| `core/override.py` | Rule conflict resolution: later `effectiveDate` wins (circular overrides handbook). Output carries both citations and a `note` |
| `escalation.py` | Tickets, advisor inbox, reply → appears in student thread |
| `vendored/audio_notes/` | **Jury-approved prior code.** Audio → timestamped transcript → structured notes. Wrapped by `tools/companion.py`, which adapts its output into `Handout` (contracts §9b). The vendored schema never leaks into the API. Has its own `NOTICE.md` |

**Rule of the shared layer:** LLM reads, code counts, LLM advises. Any arithmetic (credits, prereq satisfaction, exam weights, impact scores) is done in Python from LLM-extracted structured data, never by the model in prose.

## 4. Agents

All agents are thin: a system prompt + a scope + one to three tools + a card renderer contract. If an agent needs new infra, it drops a priority level.

**The bar every agent must clear before it ships:**
1. Reads `StudentState` and `StudentRecords` for the current student
2. Answers only from its scoped docs, with verified citations
3. Refuses out-of-scope questions explicitly and offers escalation (never answers vaguely)
4. Returns at least one right-panel `Card`
5. Returns a `ToolTrace` for every tool it called

### 4.1 Academic Coach (`academic_coach`) — P0, flagship
Merges "am I on track", "how am I doing", "how do I plan my learning". Story: **the coach follows you through the semester** — where am I (audit), what did I miss in today's class (companion), what do I study this week (plan).
Scope: handbook, circulars, catalog, syllabus, exam_calendar, past_papers, lectures.
Tools:
- `class_companion` (P0, 12:20 decision) — audio (or text transcript fallback) → **transcription + handout** via the jury-approved vendored pipeline, adapted into `Handout` with `segmentIds` provenance (verified) → **Coverage** vs the syllabus unit (`covered / missed / emphasized`, quotes verified verbatim) → **Actions** (missed + emphasized × past-paper weights × exam calendar → `ActionItem`s; accepting one adds a `PlanBlock` to state). Types in `contracts.ts` §9b. Coverage and Actions are new code, built today; they are the part that makes this more than note-taking.
- `run_degree_audit` — LLM extracts requirements/prereqs/buckets from handbook + circulars into JSON with citations → `core/override.py` resolves conflicts → code counts credits from transcript → LLM writes the explanation. Runs automatically on student load and is cached in `StudentState`. Output: `AuditCard`.
- `diagnose_performance` — internal marks × past-paper topic weights → weak topics ranked by `impact`. Output: `WeakTopicsCard`.
- `build_study_plan` — weekly blocks to the exam calendar, weighted by impact, citing syllabus sections. Output: `StudyPlanCard`.
- `stuck_markers` (P0, 1:15 decision) — tap-to-flag during recording (timestamp + optional ≤60-char note, no extra audio; the mic is already on the lecture). Backend resolves each marker to a segment, a handout section and a canonical topic. Handout sections get `stuck`, Coverage gets `confusion`, Actions get `review` items with `provenance.markerId`, the lookback recap gets `flaggedTopics`. Markers can also be added on the handout timeline afterwards (demo safety). Types: `StuckMarker`, contracts §9b.
- `lecture_mind_map` (P1, 2:25 decision, 60-min box, in the demo only if green by 3:30) — a view over the handout: nodes = handout sections and key points (built with the jury-approved mind-map code), overlay in code = stuck flags, exam hints (ghost nodes for skipped syllabus topics are built but hidden in the UI since §9.10). Lives behind a `Handout | Mind map` toggle in the class channel's Lectures tab. Types: `MindMap`, contracts v3.9. Never a source of new facts.
- `make_it_relevant` (P0, 1:15 decision) — one LLM call: same facts through the student's interest, no new facts, citations from the source it's attached to (handout section, stuck section, plan block or weak topic). Output: `RelevantCard` with `source`. Offered automatically on stuck sections and on the top weak topic. Rebuilt fresh, prompt-level only.

### 4.2 Course Planner (`course_planner`) — P1 (below the line since 1:15)
"Which courses" + "is this relevant for a job".
Scope: handbook, circulars, catalog, role_profiles.
Tools:
- `recommend_courses` — reads audit gaps from state; catalog quality blurbs, slot clashes, prereqs, career goal. Output: `CoursesCard`.
- `skills_gap` — role skill profile vs skill tags on taken + recommended courses. Output: `SkillsGapCard`.

### 4.3 Campus Guide (`campus_guide`) — P2 (below the line since 1:15)
"Which resources" + "which opportunities".
Scope: resources, club_feed, events.
Tools:
- `find_resources` — TAs, faculty hours, library, tutoring, labs; personalised by weak topics. Output: `ResourcesCard`.
- `discover` — club feed anecdotes + events + student profile → 3 picks with reasons plus exactly one `wildcard` outside stated interests. Output: `PicksCard`.
- Club agents (`club:<slug>`, P1) — each club is its own scoped agent over its feed. Campus Guide @mentions it; both replies return in the same `/chat` response (`replyToId` set). Real LLM call or not shipped.

### 4.4 Human Advisor — P0
Not an agent. Escalation inbox. Ticket carries the student's question, the agent's `agentSummary`, and citations. Advisor reply lands in the student's DM. Student thread polls every 3s while a ticket is open.

### 4.5 Study Buddy (`study_buddy`) — P1, held
Pomodoro tied to `PlanBlock.id`, five-mood buddy, one grounded LLM line per session start/complete, Weekly 1:1 built from sessions vs plan. Types are in `contracts.ts` §7. Not in the current UI pass. Do not build until §6 says so.

## 5. Synthetic dataset (`backend/app/data/`)

Generate all of it first, before any agent code. Make it messy and realistic; the demo is only as good as the data.

- `handbook.md` — program handbook: credit buckets, min electives, prereqs, grading, graduation rules
- `circulars/*.md` — 2–3, each with `effectiveDate`; **one must override a handbook rule** (e.g. min electives 4 → 5)
- `catalog.json` — electives: code, title, credits, slot, faculty, prereqs, bucket, 2–3 feedback blurbs, `skills[]`
- `role_profiles.json` — 3–4 roles with required skills (Data Analyst, Backend Engineer, Product Analyst, ML Engineer)
- `syllabus/*.md` — 5–6 courses, unit/topic structure
- `exam_calendar.json` — mid-sem/end-sem dates
- `past_papers.json` — 2–3 years of topic → marks distribution per course
- `resources.json` — TA hours, faculty office hours, library, tutoring, labs
- `clubs.json` + `club_feed.md` — directory plus dated anecdotes ("DS Club ran a Kaggle sprint; two members landed internships")
- `events.json` — dated campus events
- `students/*.json` — 3 profiles: **on track**, **at risk**, **hidden prereq gap**. Each has transcript, internal marks (topic-level), registrations, career goal, interests
- `connectors.json` — LMS, ERP, Academic Office, Placement, Clubs portal; all `status: "synthetic"`

Every document and record carries a `connectorId`.

## 6. Priorities and cutoffs

**P0 (must ship) — the study planner, three rungs, one agent:**
1. **In class**: companion (record/upload → handout → coverage → commitments → actions) + stuck markers + MIR on stuck sections
2. **After class**: diagnosis (marks × past papers) → weekly plan → merged calendar (classes, exams, study blocks, prep, deadlines) → accept actions into it
3. **Every week**: lookback 1:1 (recap in code, questions and adjustments grounded in it) → adjusted plan
Plus: escalation + advisor view, Slack-style shell with right panel, Canvas (handout, calendar, 1:1), student switcher.

**P1 — in flight on isolated branches, each enters the demo only if green and merged by 3:30:** lecture mind map (§9.6) · campus discovery as a calendar source (§9.4) · exam-system gaps in weak topics (§9.5). **P1 — not started, only after those:** degree audit (its citation plumbing is shared) · course recommender + skills gap · clickable citations · Agents & tools polish

**P2:** clubs/social · club agents · Study Buddy timer · Activity feed · `#ask-anything` router

**Cutoffs (revised 1:15):**
- 2:00 — companion `ready` on the real CS F212 transcript; markers resolve; MIR returns a card
- 2:30 — diagnosis + plan + calendar on Meera; accepted action lands on the calendar
- 3:00 — lookback round trip; escalation round trip
- 3:30 — UI wired end to end on real data; **rehearse once**; P1 only after that
- 4:30 — **feature freeze.** Slide, push, rehearse twice
- 5:00 — code pushed

**Kill rule:** if rung 1 isn't demoing at 2:00, both people on it. If rung 2 isn't demoing at 3:00, the lookback shrinks to "recap numbers only, no adjustments" and nothing in P1 is touched.

## 7. Demo script (7 minutes, revised 1:15)

1. **In class** (Meera) — open the `cs-f212-dbms` class channel, start recording the 2-min DBMS clip (`Lecture.mp3` upload is the fallback); tap "I'm stuck" once at the 2PL-adjacent moment. Stop → Marker rows while it works → handout in the Lectures tab with the stuck section flagged and each section's "Study from · university reading list" line (toggle to Mind map if shipped) → Coverage card: covered topics, exam-hint quote with timestamp, confusion point → Actions card: study (the unit's next syllabus topic, past-paper marks in the `why`), review (the stuck part), prep (next lecture's promised topic, due before the next CS F212 session). Accept two.
2. **Make it Relevant** — on the stuck section, one tap → the same concept through cricket, side by side, citations intact, with where to study it: the university reading and one AI-suggested online page (link checked live). 20 seconds, no more.
3. **After class** — "What should I study this week?" → weak topics from marks × past papers → weekly plan → Canvas calendar: classes, exams, the two accepted actions and the plan blocks on the same days, no collisions. Point at one block's `why`.
4. **Every week** — "Run my weekly review" (last week pre-marked, say so) → recap numbers → concern naming a missed topic and a flagged topic → answer one question → complete → the calendar re-flows; ticket appears in the advisor inbox because "share with advisor" was on.
5. **Escalate** — "Can I get a fee extension for a medical issue?" → refuses, ticket; Advisor view → reply → lands in the DM.
6. **Switch student** (Aarav) — same clip, different actions and plan. Nothing hardcoded.
7. **Architecture, 30s** — connectors (synthetic, disclosed) → grounded student layer → agents; audio-to-notes core from before with jury approval, coverage/actions/plan/lookback built today. Expand one tool trace.
8. **Next** — course recommender and degree audit as more tools on the same layer, clubs, buddy timer, memory, real connectors, ink/Outlook export.

**Slide:** "Students sit in class, get lost, forget what the lecturer promised, and plan their week from memory. We built a study planner that listens to your classes and adjusts every week: handout checked against the syllabus, 'I'm stuck' markers, actions with exam weight behind them, a calendar around your classes, and a weekly 1:1 that re-plans. Every claim cited to syllabus, past papers or the lecture; a human when the docs run out. Assumptions: single program, English docs, synthetic connectors. Disclosed: audio-to-notes core and mind-map code reused with jury approval; documents are structured markdown/JSON, no PDF ingestion today; everything else built today."

**Q&A prep:**
- *Why not ChatGPT with PDFs?* Personal records + deterministic audit + rule-conflict resolution + verified citations + refusal/escalation.
- *What if extraction is wrong?* Every rule is cited; an advisor reviews extracted rules once per semester, not per student.
- *How does it scale?* Rules extracted once per program; audit is cheap code; per-agent scope keeps context small; retrieval becomes hybrid at university scale.
- *Isn't this a chatbot?* Agents write to shared state and read each other's results; the right panel is structured output, not prose.
- *Was any of this built before today?* Yes, one part: the audio-to-notes core, disclosed to and approved by the jury before we used it; it sits in `vendored/audio_notes/` with a NOTICE. Everything else — coverage, actions, audit, planner, UI, shared layer — was built today. Offer to show the commit log.
- *Why not Otter / Notion for the lecture notes?* The handout is mapped to the syllabus with the university reading for each part, exam hints are quoted with timestamps, gaps become tasks weighted by past-paper marks, and they land in the same plan the audit feeds. Notes are the byproduct; the actions are the product.

## 8. Conventions for anyone (human or AI) coding in this repo

**Backend**
- Every LLM call goes through `core/llm.py` and returns JSON matching a Pydantic model. No free-text parsing.
- Every tool returns `(card, citations, trace)`. The agent composes the message; tools never write prose to the user.
- Citations are verified before a response leaves the server. A response with zero verified citations on a factual claim is a bug, not a fallback.
- No silent fallbacks. If a tool fails, return an `error` in the trace and a `Marker`-style system line; never a plausible-sounding answer.
- Scope is a code boundary. Do not pass out-of-scope docs to a model "just for context".
- The audit is idempotent and cached per student; re-run only on records change or explicit request.
- Keep prompts in `backend/app/prompts/<agent>.md`, one file per agent, versioned in git.
- `vendored/audio_notes/` is read-only today except for import fixes. New logic goes in `tools/companion.py`, never inside the vendored folder, so the "built before / built today" line stays visible in the diff.

**Frontend**
- Types come from `contracts.ts`. Don't add fields the backend doesn't return.
- Every card type has exactly one renderer in `components/cards/`.
- `MOCK=true` must keep working all day; never break the mock path to make the real one work.
- Palette: ink `#0F172A` for structure, cyan `#22D3EE` for accent only. Slack layout: rail · sidebar · pane · right panel.
- Anything not built shows a "Coming soon" tooltip, never a dead click.

**Both**
- Commit every 30 minutes with a message that says what demos now.
- Do not refactor after 3:30. Do not add features after 4:30.
- If a decision isn't in this file or `contracts.ts`, ask the other person before building it.

## 9. Decisions log since the 1:15 refocus (each already reflected in `contracts.ts`)

9.1 **Class channels (1:25, contracts v3.5).** Sidebar gets a `Classes` group, one channel per registered course (`class:CS F212`). The Academic Coach inside a class channel is hard-scoped to that course; out-of-course questions get "ask me in my DM". Recording, markers, handouts and per-course context live in the class channel; the DM keeps cross-course things (week plan, 1:1, audit). Tabs: Messages · Lectures · Schedule. `GET /classes/:studentId` feeds the sidebar and the Today block.

9.2 **Calendar rail item (1:25).** Rail order: Home · DMs · Calendar · Files · Agents & tools. One calendar component, three placements: full week/month under the rail item, course-filtered Schedule tab in each class channel, and a `Today` block replacing the empty Starred area (next class, next study block, 1:1 ready). Course Planner and Campus Guide render greyed "coming soon"; no mock replies for below-the-line agents.

9.3 **Feature 2 as built (2:05, contracts v3.8).** Impact normalised to the heaviest end-sem topic (ranking unchanged). `POST /demo/simulate-week/:studentId` marks the next 7 days' blocks done/missed (every third missed) **and moves that student's clock forward 7 days** — run it on Meera before the demo, never mid-demo. Exam days get no study blocks. Direct tool endpoints `POST /students/:id/diagnose` and `/plan`. Recap has `blocksMissed`, `prepMet`, `prepMissed`, `movementNote`, `window`. Three model calls per chat reply; the temperature-rejection retry in `llm.py` is to be fixed by remembering the rejection per model.

9.4 **Campus discovery as a calendar source (1:40, contracts v3.6).** Not a fourth agent. `GET /discover/:studentId` returns 3 picks + 1 wildcard tied to weak topics, career goal or interests, with verified anecdotes; accepting a pick creates a `CalendarItem` of kind `event`. UI: a "Worth your time" card on the Calendar page and in the coach DM. Built by an isolated agent (`agents/discover.py`); 3:30 gate.

9.5 **Exam-system gaps (1:50, contracts v3.7).** `graded_answers/<student>.json` (mid-sem, CS F212 + CS F372) with per-question rubric feedback and canonical `gapTag`s, connector `exam_system` (synthetic). `diagnose.py` attaches `gaps[]` to weak topics; plan and action `why` lines may quote the gap label; MIR can target a gap. Per-topic sums must equal the existing internal marks. Sent to the Feature 2 session only after its rung 2 smoke is green.

9.6 **Lecture mind map (2:25, contracts v3.9).** Jury-approved reuse of the Enstine mind-map builder (`enstine-core` → `backend/app/vendored/mindmap/`) and React component (`enstine-notesapp` → `frontend/src/vendored/mindmap/`), each with a NOTICE. A `Handout | Mind map` toggle in the class channel's Lectures tab. Nodes = handout sections and key points; overlay in code = stuck flags, exam hints, and dashed ghost nodes for syllabus topics the lecture skipped. Never a source of new facts. 60-minute box; 3:30 gate.

9.7 **No PDF ingestion (1:30).** Documents are markdown/JSON delivered by connectors; the markdown-heading parser is the only parsing. Disclosed on the slide.

9.8 **Demo dry run (2:15).** `backend/scripts/demo_run.py` walks the demo order against the API using `Lecture.mp3`, checks which course the audio actually matches, and writes `DEMO.md` (exact sequence, fallback per step, timings) and `FINDINGS.md`. `FINDINGS.md` is the fix list for the 3:30 rehearsal; `FIXES.md` tracks owner and status of every break found in integration.

9.9 **Git hygiene.** Root `.gitignore` (`venv/`, `.venv/`, `node_modules/`, `*.db`, `backend/data/lectures/`); one backend agent per folder; commit prefixes `companion:`, `feat2:`, `discover:`, `mindmap:`, `demo-fix:`; contract changes only through `contracts.ts`, announced to every running session in the same minute. Nothing new enters the contract after v3.9 unless a demo step is broken.

9.10 **Study sources, no lecture grading (17:15, contracts v3.13).** The UI no longer shows what a lecture skipped: no Skipped group in Coverage, no ghost nodes or "skipped" count in the mind map, and the class message says "It maps to <unit>. Also on that unit's syllabus: X, on your actions list" (`coverage.missed` stays in the API and still drives study actions, worded as syllabus topics). Each syllabus topic has a `Reading:` line (textbook + chapter, synthetic reading list); handout sections show it as `studyFrom`, looked up on read. Make it Relevant adds `studySources`: that reading plus one AI-suggested online page, kept only if the link loads live (HTTP 200) and the page names the concept (`tools/study_sources.py`); otherwise `studySourcesNote` says why. `scripts/neutral_lecture_wording.py` rewrites the old wording in an existing DB (backs it up first).