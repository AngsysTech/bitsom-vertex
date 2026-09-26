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
- `graded_answers/*.json` — Per-question mid-sem grading for CS F212 and CS F372 from the synthetic `exam_system` connector (Smart Exam grading), one file per student.
- `gap_tags.json` — Canonical gap-tag vocabulary for graded answers: a one-line label per tag plus its kind (`concept`, `presentation`, or `none` for full marks).
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
7. **Meera's mid-sem gaps explain her weak-topic scores question by question.** Meera's graded answers sum exactly to the internal mid-sem marks, and every mark lost on the three weak topics carries a concept gap:
   - `Normalization` 4/12: Q4a 2/4 `partial-dependency-missed`, Q4b 1/4 `transitive-dependency-not-removed`, Q4c 1/4 `bcnf-vs-3nf-confused`.
   - `B+ trees` 3/10: Q5a 2/6 `split-propagation-missed`, Q5b 1/4 `leaf-chain-range-scan-missed`.
   - `CPU scheduling` 5/14: Q4a 3/4 `waiting-vs-turnaround-confused`, Q4b 1/6 `rr-quantum-context-switch-ignored` (the Round Robin Gantt chart that trap 6's CS F372 hint promises for the end-sem), Q4c 1/4 `srtf-preemption-missed`.
   - Meera's CS F212 Q3 `closure-incomplete` is the same mistake as Rohan's Q3b.

## Students
- **Aarav Mehta:** on track, 96 earned units, target role Data Analyst; strong current marks with a softer CS F303 area; the circular means he still needs three more discipline electives after his two completed discipline electives. Graded mid-sem answers: full marks on most questions and one small CS F372 gap (`thread-shared-vs-private-state-confused`); the other lost marks are presentation slips.
- **Meera Nair:** at risk, 78 earned units and two backlog attempts; target role Backend Engineer; weak on high-impact DBMS and OS topics. Graded mid-sem answers break each weak topic down by question (trap 7).
- **Rohan Sen:** 92 earned units, target role ML Engineer; missing CS F351 before planned CS F342 and planning both CS F415 and CS F407 despite the Semester 6 T2 clash. Graded mid-sem answers: one minor CS F212 gap (`closure-incomplete`); the other lost marks are presentation slips.

## Contract note
The source dataset uses the academic term `units` exactly as the build brief requires. The API layer should map source `units` to contract response fields named `credits` where `TranscriptRow` or `CourseRec` requires that property. Record collections retain their `connectorId` envelopes so the adapter can emit `StudentRecords` directly.

`graded_answers/<id>.json` has exactly the `StudentRecords.gradedAnswers` shape from contracts v3.7: `{connectorId, rows: GradedAnswerRow[]}`. Each row's `topic` is a canonical syllabus topic and its `date` is the course's mid-sem date in `exam_calendar.json`. Per student, course and topic, the rows sum to the internal-marks mid-sem row; they explain those numbers and never change them. `gapTag: "none"` marks a full-marks answer, and every other tag resolves in `gap_tags.json`. There, `kind` separates concept gaps from presentation slips (working not shown, unlabelled diagrams, missing units, unstated assumptions).
