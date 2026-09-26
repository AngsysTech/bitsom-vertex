# Synthetic Student Workspace Dataset

Everything here is fictional. Workspace label: **BITS Campus**. Today is fixed at **2026-09-26**.

## Files
- `connectors.json` — Synthetic source registry for all documents and record collections.
- `handbook.md` — Degree rules, elective buckets, prerequisites, grading, overload and standing for the audit.
- `circulars/2026-03-revised-discipline-elective-minimum.md` — Later rule that overrides handbook §3.2 for 2028-and-later cohorts.
- `circulars/2026-08-sem5-timetable-slot-change.md` — Semester 6 Data Mining slot change that creates the CS F415 / CS F407 clash.
- `circulars/2026-09-end-sem-schedule.md` — Confirms the end-sem window and 40% end-sem weight.
- `catalog.json` — Course inventory, buckets, prerequisites, semester offerings, slots, feedback and skills.
- `role_profiles.json` — Career-role skill requirements used by skills-gap analysis.
- `syllabus/*.md` — Canonical Semester 5 units and topic strings for companion, marks and past-paper grounding.
- `timetable.json` — Clash-free current Semester 5 class schedule.
- `exam_calendar.json` — Assessment dates and weights used by planning and companion actions.
- `past_papers.json` — Three years of topic-level end-sem marks used to compute impact.
- `resources.json` — TA, faculty, library, tutoring and lab resources for Campus Guide.
- `clubs.json` — Club directory for discovery and club-agent scopes.
- `club_feed.md` — Recent club anecdotes that Campus Guide can cite.
- `events.json` — Future campus events from 2026-09-28 onward.
- `lectures/*.md` — Synthetic spoken-style lecture transcripts for Class Companion coverage and actions.
- `lectures/README.md` — Human demo recording instructions and transcript fallback notes.
- `students/aarav.json` — On-track synthetic student record for audit and planning.
- `students/meera.json` — At-risk synthetic student with high-impact weak topics.
- `students/rohan.json` — Synthetic student with a hidden prerequisite gap and Semester 6 clash plan.
- `validate.py` — Deterministic cross-file consistency validator.

## Planted demo traps
1. **Elective-minimum override:** handbook §3.2 says, “The Discipline Electives requirement is a minimum of 4 courses totaling at least 16 units.” The 2026-03 circular says, “The Discipline Electives requirement is a minimum of 5 courses totaling at least 20 units for every student graduating from May 2028 onward.”
2. **Hidden prerequisite:** Rohan plans `CS F342 Compiler Construction` but has not completed `CS F351 Theory of Computation`.
3. **Semester 6 slot clash:** the August circular moves `CS F415 Data Mining` to T2, creating a clash with `CS F407 Artificial Intelligence`.
4. **Meera high-impact weak topics:** `Normalization`, `B+ trees`, and `CPU scheduling` are weak in her internal marks and each carries at least 14 marks in every 2023–2025 past paper.
5. **Skipped syllabus topics in lecture transcripts:** CS F212 skips `Two-phase locking`; CS F372 skips `Multilevel feedback queues`; CS F303 skips `Congestion control`.
6. **Exact exam-hint sentences:**
   - “This part on serializability will definitely be on the end-sem, I'm telling you now.”
   - “Expect a Gantt-chart question on Round Robin in the end-sem.”
   - “I always ask one question on the three-way handshake.”

## Students
- **Aarav Mehta:** on track, 96 earned units, target role Data Analyst; strong current marks with a softer CS F303 area; the circular means he still needs three more discipline electives after his two completed discipline electives.
- **Meera Nair:** at risk, 78 earned units and two backlog attempts; target role Backend Engineer; weak on high-impact DBMS and OS topics.
- **Rohan Sen:** 92 earned units, target role ML Engineer; missing CS F351 before planned CS F342 and planning both CS F415 and CS F407 despite the Semester 6 T2 clash.

## Contract note
The source dataset uses the academic term `units` exactly as the build brief requires. The API layer should map source `units` to contract response fields named `credits` where `TranscriptRow` or `CourseRec` requires that property. Record collections retain their `connectorId` envelopes so the adapter can emit `StudentRecords` directly.
