# AGENTS.md — Student Workspace (BITSoM Builders Pitch Fest, EdTech AI track)

Read this before touching the repo. It is the single source of what we agreed. `contracts.ts` is the source of truth for types and endpoints; if this file and `contracts.ts` disagree, `contracts.ts` wins and this file gets fixed.

Deadline: **5:30pm today (Sat 26 Sep 2026)**. 7-min demo + 3-min Q&A + one slide. Code uploaded to the provided link before the deadline.

---

## 1. What we're building, in one paragraph

Students have seven recurring questions (which courses, how to plan learning, which resources, which opportunities, am I on track, is this relevant for a job, logistics) answered by six different offices, reactively, through PDFs, portals and emails. We're building a **Slack-style student workspace where every student DMs specialist AI agents** that sit on one grounded student layer: official documents plus the student's own records. Every answer is cited to official documents, agents refuse outside their scope, and when the docs run out the question escalates to a human advisor as a pre-cited ticket. We cover six of the seven questions; logistics is out.

Vision (slide only, not built): sits on top of LMS/ERP/placement/club portals via connectors; more agents plug in; a memory layer so agents remember what the student explored and decided.

## 2. Rules we must not break (from the brief)

- **No private pre-existing code.** Nothing from Enstine or any prior private repo is copied in. Patterns and ideas from our heads are fine; files are not. Do not open-source something today to route around this.
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
| `core/parser.py` | Loads synthetic docs into `Document` with stable `DocumentSection.id`s (`handbook.4.2`) |
| `core/scope.py` | Per-agent allowed doc set. Enforced in code, not in the prompt. An agent physically never sees docs outside its scope |
| `core/context.py` | Whole-scope context: the agent's allowed docs fit in context, so no embeddings, no vector DB. Docs are serialised with their section IDs so the model can cite |
| `core/citations.py` | Closed-choice citations. Model emits `[C1]` + `{sectionId, quote}`; we verify the quote exists verbatim in that section. Unverifiable citation → drop it and flag in trace; never invent |
| `core/state.py` | `StudentState` (audit, weak topics, plan, skills gap) in SQLite. Audit agent writes; other agents read. This is the only "coordination" between agents |
| `core/records.py` | `StudentRecords` (transcript, internal marks, registrations) tagged with `connectorId` |
| `core/llm.py` | One provider, env-configured, JSON-mode helper, retries, timing for `ToolTrace` |
| `core/override.py` | Rule conflict resolution: later `effectiveDate` wins (circular overrides handbook). Output carries both citations and a `note` |
| `escalation.py` | Tickets, advisor inbox, reply → appears in student thread |

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
Merges "am I on track", "how am I doing", "how do I plan my learning".
Scope: handbook, circulars, catalog, syllabus, exam_calendar, past_papers.
Tools:
- `run_degree_audit` — LLM extracts requirements/prereqs/buckets from handbook + circulars into JSON with citations → `core/override.py` resolves conflicts → code counts credits from transcript → LLM writes the explanation. Runs automatically on student load and is cached in `StudentState`. Output: `AuditCard`.
- `diagnose_performance` — internal marks × past-paper topic weights → weak topics ranked by `impact`. Output: `WeakTopicsCard`.
- `build_study_plan` — weekly blocks to the exam calendar, weighted by impact, citing syllabus sections. Output: `StudyPlanCard`.
- `make_it_relevant` (P1) — reframes one concept through a student interest; facts unchanged, cited. Output: `RelevantCard`. Rebuilt fresh, prompt-level only.

### 4.2 Course Planner (`course_planner`) — P0
"Which courses" + "is this relevant for a job".
Scope: handbook, circulars, catalog, role_profiles.
Tools:
- `recommend_courses` — reads audit gaps from state; catalog quality blurbs, slot clashes, prereqs, career goal. Output: `CoursesCard`.
- `skills_gap` — role skill profile vs skill tags on taken + recommended courses. Output: `SkillsGapCard`.

### 4.3 Campus Guide (`campus_guide`) — P0-lite
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

**P0 (must ship):** dataset · shared layer · Academic Coach (audit + diagnosis + plan) · Course Planner (recs + skills gap) · Campus Guide (resources + discover) · escalation + advisor view · Slack-style shell with right panel and student switcher · Files page with document reader (citation target)

**P1 (only if P0 runs clean by ~3:00):** Make it Relevant · club agents · clickable citations scrolling to section · Agents & tools page with connectors · coming-soon channels · Study Buddy timer · Weekly 1:1

**P2 (only if everything above is done by ~4:00):** Activity feed · `#ask-anything` router · streaming

**Cut (not today):** logistics checklist · auth · real-time messaging · calls/huddles · mind maps · quizzes · vector DB · memory layer · real connector sync

**Cutoffs:**
- 12:15 — dataset done, shared layer scaffolded, UI shell up on mocks
- 1:30 — audit end-to-end with the circular override; diagnosis working
- 2:30 — study plan + Course Planner
- 3:30 — Campus Guide + escalation round trip
- 4:15 — P1 only if all P0 runs twice without a manual fix
- 4:30 — **feature freeze.** Slide, push, rehearse twice
- 5:00 — code pushed

**Kill rule:** if the audit is not demoing at 1:30, everything after it in P0 waits and both people work on the audit.

## 7. Demo script (7 minutes)

1. **Audit** — "Am I on track?" → override caught, both docs cited, progress bars in the right panel.
2. **Plan next sem** — "What should I take next sem? I want data analyst roles." → Course Planner already knows the gap from state; clash handled; skills gap shown.
3. **Study** — "I'm struggling in DBMS." → weak topics from marks × past papers; weekly plan; (P1) "explain B+ trees through cricket".
4. **Campus** — "Who can help me with DBMS, and what's happening on campus?" → TA hours, one wildcard pick with an anecdote; (P1) club agent replies in-thread.
5. **Escalate** — "Can I get a fee extension for a medical issue?" → out of scope, ticket opened; switch to Advisor view, reply, reply lands in DM.
6. **Switch student** — same first question, different answer. Proves nothing is hardcoded.
7. **Architecture, 30s** — connectors (synthetic, disclosed) → shared student layer → agents. Tool trace expanded once.
8. **Next** — Study Buddy + Weekly 1:1, memory layer, real connectors, `#ask-anything`, more agents.

**Slide:** "7 recurring student questions, 6 offices, zero personalisation. A Slack-style workspace where every student has specialist agents over one grounded student layer. 6 of 7 questions covered, every answer cited to official documents, humans in the loop when the docs run out. Assumptions: single program, English docs, synthetic connectors."

**Q&A prep:**
- *Why not ChatGPT with PDFs?* Personal records + deterministic audit + rule-conflict resolution + verified citations + refusal/escalation.
- *What if extraction is wrong?* Every rule is cited; an advisor reviews extracted rules once per semester, not per student.
- *How does it scale?* Rules extracted once per program; audit is cheap code; per-agent scope keeps context small; retrieval becomes hybrid at university scale.
- *Isn't this a chatbot?* Agents write to shared state and read each other's results; the right panel is structured output, not prose.

## 8. Conventions for anyone (human or AI) coding in this repo

**Backend**
- Every LLM call goes through `core/llm.py` and returns JSON matching a Pydantic model. No free-text parsing.
- Every tool returns `(card, citations, trace)`. The agent composes the message; tools never write prose to the user.
- Citations are verified before a response leaves the server. A response with zero verified citations on a factual claim is a bug, not a fallback.
- No silent fallbacks. If a tool fails, return an `error` in the trace and a `Marker`-style system line; never a plausible-sounding answer.
- Scope is a code boundary. Do not pass out-of-scope docs to a model "just for context".
- The audit is idempotent and cached per student; re-run only on records change or explicit request.
- Keep prompts in `backend/app/prompts/<agent>.md`, one file per agent, versioned in git.

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
