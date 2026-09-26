# Dataset audit: `backend/app/data`

Independent review, Sat 26 Sep 2026, ~13:20 IST. Audited commit `e6f257c` ("Companion runs on the generated dataset; data swapped in"). At audit time `backend/app/data` was byte-identical to `backend_dataset/app/data`.

## Scope and method

- **Spec used:** AGENTS.md §5, `contracts.ts` (v3.4 at the time of writing; the enums checked here have not changed since v3.1, and v3.2 renamed `credits` to `units`), and the reviewer checklist.
- **`dataset-prompt.md` does not exist** anywhere in the repo, its git history, or on disk. Without it, the "exact exam-hint sentence" checks compare each transcript against the exact sentences the dataset README promises.
- **`validate.py` was not read or run.** Every check was written from the spec and the data files.
- **Tool:** `backend/scripts/audit_dataset.py`. It uses only the Python standard library. It parses the rules (grade points, 17-unit pace, 25-unit overload, bucket lists, prerequisites) from `handbook.md` itself, so it tests the documents against their own text. It reads both the generated and the older stub file shapes. `--probe-backend` also loads the data through `backend/app/core` (the code that will run the demo).

```bash
python3 backend/scripts/audit_dataset.py                       # text report, exit 1 on any FAIL
python3 backend/scripts/audit_dataset.py --format md           # the table below
backend/.venv/bin/python backend/scripts/audit_dataset.py --probe-backend
```

## Verdict

**28 FAIL · 19 WARN · 62 PASS · 1 INFO** (with `--probe-backend`).

Referential integrity is clean: 400 course-code references, 316 topic strings that match character for character, plus skill tags, club slugs and connectorIds. Every rule sentence the audit needs is quotable, except the prerequisites. The skipped topics really are absent from the transcripts, the exam hints appear verbatim, and deadlocks are deferred. End-sem dates fall inside the window and the Sem 5 timetable has no clashes.

The demo traps are where it breaks. In demo order:

1. **Step 2, audit (P0).** The override cannot fire under the stated rule. Circular 2026-03 has `effectiveDate: 2026-03-15`, which is **earlier** than the handbook's `2026-07-01`. Under "later effectiveDate wins" (AGENTS.md §3, `core/override.py`), the handbook's 4 stays in force.
2. **Step 1, companion (P0 flagship).** The skipped topic "Two-phase locking" has **no past-paper marks**, so the study action's `why` has nothing to cite. The loader now falls back to "part of Transactions and concurrency, which carried 16–18 marks". But those same papers list "ACID properties" separately, so "Transactions and concurrency" there is a sibling topic, not a unit total. The data does not support "part of" (see Backend notes).
3. **Step 5, switch student.** By the handbook's own rule, **Meera is on track**: 78 units over 4 completed semesters is 19.5, which is at least 17. She has also already passed **7 discipline electives**, against on-track Aarav's 2.
4. **Step 7, Course Planner.** Rohan is **registered for CS F351** this semester and has 9 marks rows for it. He has **already passed CS F363**, which requires the CS F342 he is "planning". So the hidden prerequisite gap is neither hidden nor a gap. The Sem 6 clash exists only in the circular: the catalog still has CS F415 in T4, not T2.
5. **Anything on a projector.** The transcripts were generated round-robin (semesters 1,2,3,4,1,2…). That produced Practice School in Sem 1 and Sem 3, 34- and 35-unit semesters, and 29 prerequisite-order violations. Internal marks are identical across the three students (54 shared rows). Quiz 2 marks are recorded for quizzes the exam calendar schedules in October. Every syllabus topic body is the same template sentence ("B+ trees is treated as a named assessable topic…").

**A patch has been prepared and verified but not applied.** `backend/scripts/audit_fixes.patch` passes `git apply --check`. Applied to a scratch copy, it takes the audit from **28 to 5 FAIL** (5 FAIL · 10 WARN · 93 PASS). Of the 5 left, 3 need a contract decision (7.5, 7.9 and probe 8.9, which is the same issue as 7.5). The other 2 are content still to write (6.1, 6.3). With the patch, `topic_weight("CS F212", "Two-phase locking")` returns *"carried 14–18 marks in each of the last 3 end-sems (2023–2025)"*, which is `contracts.ts`'s own example.

## Results

### 0 Inventory

| Check | Result | Evidence |
|---|---|---|
| 0.1 Required files present (AGENTS.md §5 + timetable + lectures) | **PASS** | 11 files + 15 per-entity files |
| 0.2 No stub files | **PASS** | no _stub / stub: true markers |
| 0.3 Every document and record carries a connectorId | **PASS** | all markdown front matter, JSON roots and record envelopes carry one |

### 1 Demo traps

| Check | Result | Evidence |
|---|---|---|
| 1.1 handbook §3.2 has one quotable sentence with the 4-course discipline-elective minimum | **PASS** | `handbook.md:23: "The Discipline Electives requirement is a minimum of 4 courses totaling at least 16 units."` |
| 1.2 circulars/2026-03-* has one quotable sentence with the 5-course minimum | **PASS** | `circulars/2026-03-revised-discipline-elective-minimum.md:12: "The Discipline Electives requirement is a minimum of 5 courses totaling at least 20 units for every student graduating from May 2028 onward."` |
| 1.3 circular 2026-03 effectiveDate is later than the handbook's | **FAIL** | `circulars/2026-03-revised-discipline-elective-minimum.md:3: effectiveDate: 2026-03-15`<br>`handbook.md:4: effectiveDate: 2026-07-01`<br>2026-03-15 is earlier than 2026-07-01: 'later effectiveDate wins' (AGENTS.md §3, core/override.py) keeps the handbook's 4, so the override never fires |
| 1.4 circular supersedes → handbook.3.2 and that section exists | **PASS** | `circulars/2026-03-revised-discipline-elective-minimum.md:4: supersedes: handbook.3.2`<br>`handbook.md:22: ## 3.2 Graduation requirements` |
| 1.5 circular's population ('graduating May 2028 or later') resolvable from student records | **WARN** | `circulars/2026-03-revised-discipline-elective-minimum.md:9: "This circular applies to every B.E. Computer Science student whose expected graduation date is May 2028 or later."`<br>no expectedGraduation/cohort field in students/aarav.json, students/meera.json, students/rohan.json; only inferable (semester 5 in Sep 2026 → Sem 8 ends May 2028) |
| 1.6a CS F212: skipped topic 'Two-phase locking' (and variants) absent from transcript | **PASS** | lectures/cs-f212-2026-09-22-transactions.md: none of (?i)two[\s\-‐-–]*phase, \b2\s*PL\b, (?i)growing phase, (?i)shrinking phase, (?i)lock point occur |
| 1.6b CS F212: exam-hint sentence verbatim, once, as a whole sentence | **PASS** | `lectures/cs-f212-2026-09-22-transactions.md:13: "This part on serializability will definitely be on the end-sem, I'm telling you now."` |
| 1.6c CS F212: 'deadlocks' deferred to a later lecture in the text | **PASS** | `lectures/cs-f212-2026-09-22-transactions.md:21: "we'll come back to deadlocks next week."` |
| 1.7a CS F372: skipped topic 'Multilevel feedback queues' (and variants) absent from transcript | **PASS** | lectures/cs-f372-2026-09-23-scheduling.md: none of (?i)multi[\s\-]*level, \bMLFQ\b, (?i)feedback queue occur |
| 1.7b CS F372: exam-hint sentence verbatim, once, as a whole sentence | **PASS** | `lectures/cs-f372-2026-09-23-scheduling.md:17: "Expect a Gantt-chart question on Round Robin in the end-sem."` |
| 1.7c CS F372: a later-lecture deferral exists and names a syllabus topic | **WARN** | `lectures/cs-f372-2026-09-23-scheduling.md:25: "Next class we will move from these baseline policies toward richer scheduler behavior and then connect scheduling to responsiveness in interactive systems."`<br>the deferral names no syllabus topic, so a next_lecture_topic commitment cannot be normalised to one |
| 1.8a CS F303: skipped topic 'Congestion control' (and variants) absent from transcript | **PASS** | lectures/cs-f303-2026-09-24-transport.md: none of (?i)congestion, \bAIMD\b, (?i)slow[\s\-]*start, \bcwnd\b occur |
| 1.8b CS F303: exam-hint sentence verbatim, once, as a whole sentence | **PASS** | `lectures/cs-f303-2026-09-24-transport.md:11: "I always ask one question on the three-way handshake."` |
| 1.8c CS F303: a later-lecture deferral exists and names a syllabus topic | **WARN** | `lectures/cs-f303-2026-09-24-transport.md:25: "Okay so before next class, redraw the handshake without looking at your notes, then explain each message aloud."`<br>`lectures/cs-f303-2026-09-24-transport.md:25: "Next time we will continue with how TCP adapts its sending behavior under changing network conditions."`<br>the deferral names no syllabus topic, so a next_lecture_topic commitment cannot be normalised to one |
| 1.9 each skipped topic carries ≥14 marks in each of the last three papers (contracts.ts ActionItem.why example) | **FAIL** | past_papers.json: CS F212 'Two-phase locking' appears in none of [2023, 2024, 2025]<br>past_papers.json: CS F372 'Multilevel feedback queues' = {2023: 12, 2024: 14, 2025: 12} (below 14 in some year)<br>past_papers.json: CS F303 'Congestion control' = {2023: 18, 2024: 20, 2025: 18} |
| 1.10 rohan: CS F342 is planned | **PASS** | `students/rohan.json:634: "courseCode": "CS F342",`<br>held under non-contract key 'plannedNextSemester' with status 'planned' |
| 1.11 rohan: CS F351 absent from transcript | **PASS** | students/rohan.json: no transcript row for CS F351 |
| 1.12 rohan: CS F351 absent from registrations | **FAIL** | `students/rohan.json:167: "courseCode": "CS F351",`<br>`students/rohan.json:269: plus 9 internalMarks rows for CS F351`<br>he is taking the prerequisite now, so the 'hidden prerequisite gap' disappears once Sem 5 grades post |
| 1.13 rohan: transcript does not already contain a course that requires CS F342 | **FAIL** | `students/rohan.json:87: "courseCode": "CS F363",  (passed in Sem 3; catalog prereq CS F342)` |
| 1.14 CS F415 and CS F407 share a Semester 6 slot per circular 2 | **PASS** | `circulars/2026-08-sem5-timetable-slot-change.md:12: "CS F415 Data Mining therefore clashes with CS F407 Artificial Intelligence because both are scheduled in slot T2 for Semester 6."` |
| 1.15 CS F415 and CS F407 share a Semester 6 slot per catalog | **FAIL** | `catalog.json:642: "slot": "T4",`<br>`catalog.json:607: "slot": "T2",`<br>catalog was not updated and the circular's supersedes is null, so nothing machine-readable links the circular to the catalog slot |
| 1.16 rohan plans both CS F415 and CS F407 for Semester 6 | **PASS** | students/rohan.json: planned = ['CS F342', 'CS F407', 'CS F415', 'CS F464'] |
| 1.17 meera: weak topics score <40% in internal marks | **PASS** | `students/meera.json:660: "topic": "B+ trees",  → 3/10 = 30.0% over 1 row(s)`<br>`students/meera.json:652: "topic": "Normalization",  → 4/12 = 33.3% over 1 row(s)`<br>`students/meera.json:668: "topic": "CPU scheduling",  → 5/14 = 35.7% over 1 row(s)` |
| 1.18 meera: each weak topic carries ≥14 marks in each of the last three past papers | **PASS** | past_papers.json CS F212 'B+ trees': {2023: 18, 2024: 20, 2025: 18} ✓<br>past_papers.json CS F212 'Normalization': {2023: 20, 2024: 18, 2025: 22} ✓<br>past_papers.json CS F372 'CPU scheduling': {2023: 18, 2024: 20, 2025: 19} ✓ |
| 1.19 meera has a weak topic inside the CS F212 lecture's unit (demo step 5) | **WARN** | lecture unit 'Transactions and concurrency': ['Transactions and concurrency', 'ACID properties', 'Serializability', 'Locking basics', 'Two-phase locking', 'Deadlocks']<br>meera's weak CS F212 topics: ['Normalization', 'B+ trees'] (outside that unit)<br>marks on any topic of that unit, per student: {'aarav': [], 'meera': [], 'rohan': []} — lecture-derived actions (missed + emphasized) will be identical for every student unless the companion adds course-level weak topics |

### 2 Referential integrity

| Check | Result | Evidence |
|---|---|---|
| 2.1 Every course code resolves to catalog.json | **PASS** | 400 references, 36 distinct codes, all in catalog |
| 2.2 Topic strings (internal marks, past papers) match the syllabus character-for-character | **PASS** | 316 topic references, all exact |
| 2.3 Lecture front matter: unit is a syllabus unit and lecturer is the catalog faculty | **PASS** | `lectures/cs-f212-2026-09-22-transactions.md:4: unit: Transactions and concurrency`<br>`lectures/cs-f303-2026-09-24-transport.md:4: unit: Transport layer`<br>`lectures/cs-f372-2026-09-23-scheduling.md:4: unit: CPU scheduling` |
| 2.4 Role-profile skill tags resolve to catalog skill tags | **PASS** | 26 catalog skills; role tags all resolve; catalog-only tags: ['compilers', 'embedded-systems', 'ethics', 'logic', 'problem-solving', 'programming-languages'] |
| 2.5 Every careerGoal is a role in role_profiles.json | **PASS** | goals ['Backend Engineer', 'Data Analyst', 'ML Engineer'] |
| 2.6 Club slugs: events.clubSlug and club_feed headings resolve to clubs.json | **WARN** | `events.json:67: "organiser": "placement_cell",  (event 'Recruiter Talk: Careers in Analytics' has no clubSlug; organiser is a connectorId)` |
| 2.7 Every connectorId resolves to connectors.json | **PASS** | 31 tagged sources → ['academic_office', 'clubs_portal', 'erp_core', 'lms_moodle', 'placement_cell'] |
| 2.8 Each source's connector declares that kind in provides | **WARN** | resources.json: connector 'lms_moodle' does not list 'resources' in provides ['syllabus', 'internal_marks', 'lectures', 'timetable'] |
| 2.9 handbook §4.1 bucket lists match catalog buckets | **PASS** | 10 discipline, 5 open electives agree |
| 2.10 handbook §4.3 prerequisite table matches catalog prereqs | **PASS** | 9 rows agree with catalog |

### 3 Quotability

| Check | Result | Evidence |
|---|---|---|
| 3.1 Total units (142) — one sentence with the number | **PASS** | `handbook.md:20: "A student must earn 142 units to graduate from the B.E. Computer Science program."` |
| 3.2 Core minimum — one sentence with the number | **PASS** | `handbook.md:23: "The Core requirement is 78 units."` |
| 3.3 Discipline-elective minimum (handbook) — one sentence | **PASS** | `handbook.md:23: "The Discipline Electives requirement is a minimum of 4 courses totaling at least 16 units."` |
| 3.4 Discipline-elective minimum (circular) — one sentence | **PASS** | `circulars/2026-03-revised-discipline-elective-minimum.md:12: "The Discipline Electives requirement is a minimum of 5 courses totaling at least 20 units for every student graduating from May 2028 onward."` |
| 3.5 Open-elective minimum — one sentence | **PASS** | `handbook.md:23: "The Open Electives requirement is a minimum of 3 courses totaling at least 9 units."` |
| 3.6 Humanities minimum — one sentence | **PASS** | `handbook.md:23: "The Humanities requirement is 2 courses totaling at least 6 units."` |
| 3.7 Practice School / Thesis units — one sentence | **PASS** | `handbook.md:23: "The Practice School or Thesis requirement is 20 units."` |
| 3.8 Minimum CGPA — one sentence | **PASS** | `handbook.md:23: "The minimum cumulative grade point average for graduation is 5.0."` |
| 3.9 Overload rule (25 units, CGPA 8.0) — one sentence | **PASS** | `handbook.md:57: "Registering above 25 units in a semester requires Associate Dean approval and a CGPA of at least 8.0."` |
| 3.10 On-track pace (17 units/semester) — one sentence | **PASS** | `handbook.md:60: "A student is on track when the student has earned at least 17 units per completed semester on average."` |
| 3.11 End-sem weight (40%) — one sentence in the circular | **PASS** | `circulars/2026-09-end-sem-schedule.md:12: "The end-semester examination carries 40% weight in every Semester 5 course."` |
| 3.12 Semester 6 clash — one sentence naming both courses and the slot | **PASS** | `circulars/2026-08-sem5-timetable-slot-change.md:12: "CS F415 Data Mining therefore clashes with CS F407 Artificial Intelligence because both are scheduled in slot T2 for Semester 6."` |
| 3.13 Prerequisites — each stated in a quotable prose sentence (not only a table cell) | **FAIL** | CS F342 ← CS F351 (the Rohan trap) exists only as a table row<br>`handbook.md:39: \| CS F211 Data Structures \| CS F111 \|  (table row only)`<br>`handbook.md:40: \| CS F301 Principles of Programming Languages \| CS F211; CS F213 \|  (table row only)`<br>`handbook.md:41: \| CS F342 Compiler Construction \| CS F351 Theory of Computation \|  (table row only)`<br>`handbook.md:42: \| CS F363 Compiler Design Lab \| CS F342 Compiler Construction \|  (table row only)`<br>`handbook.md:43: \| CS F407 Artificial Intelligence \| CS F211; MATH F241 \|  (table row only)`<br>`handbook.md:44: \| CS F415 Data Mining \| CS F212; MATH F241 \|  (table row only)`<br>`handbook.md:45: \| CS F429 Natural Language Processing \| CS F407 \|  (table row only)`<br>`handbook.md:46: \| CS F441 Selected Topics: Cloud Computing \| CS F303; CS F372 \|  (table row only)`<br>`handbook.md:47: \| CS F464 Machine Learning \| MATH F241; CS F211 \|  (table row only)` |
| 3.14 Exam hints — each a single sentence on one line | **PASS** | `lectures/cs-f212-2026-09-22-transactions.md:13: "This part on serializability will definitely be on the end-sem, I'm telling you now."`<br>`lectures/cs-f372-2026-09-23-scheduling.md:17: "Expect a Gantt-chart question on Round Robin in the end-sem."`<br>`lectures/cs-f303-2026-09-24-transport.md:11: "I always ask one question on the three-way handshake."` |
| 3.15 Grade scale and passing grade — one sentence each | **PASS** | `handbook.md:52: "Letter grades are converted to grade points as follows: A = 10, A- = 9, B = 8, B- = 7, C = 6, C- = 5, D = 4, E = 2, F = 0."`<br>`handbook.md:52: "A passing grade for unit credit is D or higher."` |

### 4 Arithmetic

| Check | Result | Evidence |
|---|---|---|
| 4.1 Recomputed units, CGPA, per-semester load and buckets (from transcript rows) | **INFO** | aarav: earned 96 units (latest-attempt rule: 96); CGPA 8.38 all attempts / 8.38 latest attempt; attempted per sem {1: 22, 2: 23, 3: 34, 4: 17}; 4 completed sems → 24.00 units/sem; buckets {'Core': (13, 50), 'Open Electives': (5, 15), 'Humanities': (1, 3), 'Practice School or Thesis': (1, 20), 'Discipline Electives': (2, 8)}<br>meera: earned 78 units (latest-attempt rule: 74); CGPA 6.10 all attempts / 6.42 latest attempt; attempted per sem {1: 22, 2: 19, 3: 23, 4: 22}; 4 completed sems → 19.50 units/sem; buckets {'Core': (8, 32), 'Open Electives': (5, 15), 'Humanities': (1, 3), 'Discipline Electives': (7, 28)}<br>rohan: earned 92 units (latest-attempt rule: 92); CGPA 7.61 all attempts / 7.61 latest attempt; attempted per sem {1: 35, 2: 20, 3: 19, 4: 18}; 4 completed sems → 23.00 units/sem; buckets {'Core': (11, 44), 'Open Electives': (3, 9), 'Humanities': (1, 3), 'Discipline Electives': (4, 16), 'Practice School or Thesis': (1, 20)} |
| 4.2 README's earned-unit figures match the recomputation | **PASS** | aarav: README 96 = computed 96<br>meera: README 78 = computed 78<br>rohan: README 92 = computed 92 |
| 4.3 aarav has exactly 2 discipline electives (handbook §4.1 list) | **PASS** | students/aarav.json: ['CS F320', 'CS F330'] → 2 courses, 8 units |
| 4.4 17-units/semester rule classifies aarav on track | **PASS** | students/aarav.json: 96 earned / 4 completed semesters = 24.00 → on track<br>`handbook.md:60: "...at least 17 units per completed semester on average."` |
| 4.5 17-units/semester rule classifies meera at risk | **FAIL** | students/meera.json: 78 earned / 4 completed semesters = 19.50 → on track; latest-attempt rule gives 18.50 → on track<br>`handbook.md:60: "...at least 17 units per completed semester on average."` |
| 4.6 Bucket counts against handbook §3.2/§4.1 (Sem 5 registrations excluded) | **WARN** | meera ('at risk') has already completed 7 discipline electives — more than the circular's 5 and more than on-track aarav<br>aarav: Core 13 courses / 50 units (needs 78 units); Discipline Electives 2 courses / 8 units (needs 4 courses / 16 units (circular: 5 courses / 20 units)); Humanities 1 courses / 3 units (needs 2 courses / 6 units); Open Electives 5 courses / 15 units (needs 3 courses / 9 units); Practice School or Thesis 1 courses / 20 units (needs 20 units)<br>meera: Core 8 courses / 32 units (needs 78 units); Discipline Electives 7 courses / 28 units (needs 4 courses / 16 units (circular: 5 courses / 20 units)); Humanities 1 courses / 3 units (needs 2 courses / 6 units); Open Electives 5 courses / 15 units (needs 3 courses / 9 units)<br>rohan: Core 11 courses / 44 units (needs 78 units); Discipline Electives 4 courses / 16 units (needs 4 courses / 16 units (circular: 5 courses / 20 units)); Humanities 1 courses / 3 units (needs 2 courses / 6 units); Open Electives 3 courses / 9 units (needs 3 courses / 9 units); Practice School or Thesis 1 courses / 20 units (needs 20 units) |
| 4.7 No transcript semester exceeds the 25-unit overload threshold | **FAIL** | students/aarav.json: Sem 3 carries 34 units (> 25 needs Associate Dean approval, handbook §5.4)<br>students/rohan.json: Sem 1 carries 35 units (> 25 needs Associate Dean approval, handbook §5.4) |
| 4.8 Practice School / Thesis not completed before its offered semesters | **FAIL** | `students/aarav.json:115: "courseCode": "PS F401",  (Sem 3; offered in [7, 8])`<br>`students/rohan.json:129: "courseCode": "PS F401",  (Sem 1; offered in [7, 8])` |
| 4.9 Transcripts respect catalog prerequisites (prereq passed in an earlier semester) | **FAIL** | students/aarav.json: 8 — CS F241 (Sem 1) before CS F111 (Sem 1); CS F301 (Sem 2) before CS F211 (Sem 2); CS F301 (Sem 2) before CS F213 (Sem 3); CS F222 (Sem 1) before CS F241 (Sem 1); CS F225 (Sem 2) before CS F213 (Sem 3); ECON F212 (Sem 4) before ECON F211 (Sem 4) …<br>students/meera.json: 12 — CS F241 (Sem 1) before CS F111 (Sem 1); CS F301 (Sem 2) before CS F211 (Sem 2); CS F301 (Sem 2) before CS F213 (Sem 3); CS F342 (Sem 3) before CS F351 (never passed); CS F407 (Sem 1) before CS F211 (Sem 2); CS F407 (Sem 1) before MATH F241 (never passed) …<br>students/rohan.json: 9 — CS F241 (Sem 1) before CS F111 (Sem 1); CS F301 (Sem 2) before CS F211 (Sem 2); CS F301 (Sem 2) before CS F213 (Sem 3); CS F363 (Sem 3) before CS F342 (never passed); CS F429 (Sem 4) before CS F407 (never passed); CS F432 (Sem 1) before MATH F241 (never passed) … |
| 4.10 Transcript rows fall in the catalog's offeredIn semesters | **WARN** | students/aarav.json: 19/22 rows — MATH F211 S2∉[1], MATH F213 S3∉[2], ECON F211 S4∉[2, 6], HSS F221 S1∉[2, 6], CS F213 S3∉[2], CS F214 S4∉[3] …<br>students/meera.json: 20/23 rows — MATH F211 S2∉[1], MATH F213 S3∉[2], ECON F211 S4∉[2, 6], HSS F221 S1∉[2, 6], CS F213 S3∉[2], CS F214 S4∉[3] …<br>students/rohan.json: 16/20 rows — MATH F211 S2∉[1], MATH F213 S3∉[2], ECON F211 S4∉[2, 6], HSS F221 S1∉[2, 6], CS F213 S3∉[2], CS F214 S4∉[3] … |
| 4.11 Repeat attempts are coherent (no pass followed by a later failed retake) | **FAIL** | students/meera.json:73,171: CS F241 C (Sem 1) then F (Sem 4) — retaken after passing, then failed |
| 4.12 Catalog offers enough Core units to meet the Core requirement | **FAIL** | catalog core courses total 70 units; handbook §3.2 Core requirement is 78<br>`handbook.md:23: "The Core requirement is 78 units."` |
| 4.13 A nominal Sems 1–4 plan can reach the on-track benchmark (pace × 4) | **FAIL** | units first offered in Sems 1–4 = {1: 8, 2: 21, 3: 16, 4: 19} → 64 total vs benchmark 68 (handbook §6.1)<br>a student taking every course the catalog offers in Sems 1–4 is 'at risk'; the on-track persona needs off-semester or extra courses |
| 4.14 Every catalog prerequisite is offered in an earlier semester than the course | **FAIL** | `catalog.json:570: "offeredIn": [  CS F363 offered [6] requires CS F342 offered [6]`<br>`catalog.json:1006: "offeredIn": [  CS F222 offered [3] requires CS F241 offered [3]` |
| 4.15 Past-paper topic marks sum to the paper total | **FAIL** | `past_papers.json:22: "year": 2024,  CS F212 2024: topic marks sum to 103 (expected 100)`<br>`past_papers.json:36: "year": 2025,  CS F212 2025: topic marks sum to 102 (expected 100)` |
| 4.16 Assessment weightages sum to 100 with end-sem 40% (circular 2026-09) | **PASS** | 6 courses: quizzes 20 + mid 40 + end 40 |
| 4.17 The same assessment has the same maximum marks for every student | **FAIL** | CS F212 Mid-sem: max marks per student {'aarav': 18, 'meera': 40, 'rohan': 18}<br>CS F303 Mid-sem: max marks per student {'aarav': 30, 'meera': 18, 'rohan': 18}<br>CS F372 Mid-sem: max marks per student {'aarav': 18, 'meera': 32, 'rohan': 18}<br>CS F212 Mid-sem: component spelled ['Mid-sem', 'Mid-sem topic total']<br>CS F303 Mid-sem: component spelled ['Mid-sem', 'Mid-sem topic total']<br>CS F372 Mid-sem: component spelled ['Mid-sem', 'Mid-sem topic total']<br>`students/aarav.json:644: "component": "Mid-sem topic total",`<br>`students/meera.json:651: "component": "Mid-sem topic total",` |

### 5 Calendar sanity

| Check | Result | Evidence |
|---|---|---|
| 5.1 No Semester 5 timetable clashes for any student's registrations | **PASS** | 12 weekly sessions, no overlaps |
| 5.2 Every end-sem date is after 2026-09-26 and inside 2026-11-30…2026-12-10 | **PASS** | CS F212 2026-11-30 (Mon)<br>CS F351 2026-12-02 (Wed)<br>CS F372 2026-12-04 (Fri)<br>CS F303 2026-12-06 (Sun)<br>MATH F241 2026-12-08 (Tue)<br>HSS F235 2026-12-10 (Thu) |
| 5.3 No marks for assessments the exam calendar places after today | **FAIL** | `students/aarav.json:260: "component": "Quiz 2",`<br>`exam_calendar.json:9: "quizDates": [ … "2026-10-12"`<br>18 (student, course) pairs; e.g.<br>aarav CS F212 Quiz 2: marked 2026-09-24 but exam_calendar has it on 2026-10-12<br>aarav CS F303 Quiz 2: marked 2026-09-24 but exam_calendar has it on 2026-10-15<br>aarav CS F351 Quiz 2: marked 2026-09-24 but exam_calendar has it on 2026-10-13<br>aarav CS F372 Quiz 2: marked 2026-09-24 but exam_calendar has it on 2026-10-14<br>aarav HSS F235 Quiz 2: marked 2026-09-24 but exam_calendar has it on 2026-10-17<br>aarav MATH F241 Quiz 2: marked 2026-09-24 but exam_calendar has it on 2026-10-16 |
| 5.4 Internal-mark dates match the exam calendar's date for that assessment | **FAIL** | `students/aarav.json:216: "date": "2026-08-28"  vs exam_calendar.json:10: "2026-08-24",`<br>Mid-sem: 15 mismatched (student, course, date) — aarav CS F212: marks dated 2026-09-10, calendar 2026-09-08; aarav CS F303: marks dated 2026-09-10, calendar 2026-09-11; aarav CS F351: marks dated 2026-09-10, calendar 2026-09-09; aarav HSS F235: marks dated 2026-09-10, calendar 2026-09-13 …<br>Quiz 1: 15 mismatched (student, course, date) — aarav CS F212: marks dated 2026-08-28, calendar 2026-08-24; aarav CS F303: marks dated 2026-08-28, calendar 2026-08-27; aarav CS F351: marks dated 2026-08-28, calendar 2026-08-25; aarav CS F372: marks dated 2026-08-28, calendar 2026-08-26 … |
| 5.5 Each lecture is dated on a day its course meets in timetable.json | **FAIL** | `lectures/cs-f212-2026-09-22-transactions.md:3: date: 2026-09-22 (Tue); CS F212 meets ['Mon', 'Thu']`<br>`lectures/cs-f303-2026-09-24-transport.md:3: date: 2026-09-24 (Thu); CS F303 meets ['Tue', 'Fri']`<br>`lectures/cs-f372-2026-09-23-scheduling.md:3: date: 2026-09-23 (Wed); CS F372 meets ['Tue', 'Fri']` |
| 5.6 The next CS F212 session after 2026-09-22 is resolvable from timetable.json | **PASS** | next session: 2026-09-24 (Thu) 09:00 lecture in A-201<br>'next week' → first session 2026-09-28 (Mon) 09:00 |
| 5.7 No assessments on Sundays | **WARN** | exam_calendar.json CS F303 End-sem 2026-12-06 is a Sunday<br>exam_calendar.json HSS F235 Mid-sem 2026-09-13 is a Sunday |
| 5.8 timetable.json carries term dates (needed to bound weekly rows into CalendarItems) | **WARN** | timetable.json: no term; weekly rows cannot be bounded to the semester; no session ids (the loader synthesises them) |
| 5.9 Events are in the future and avoid the end-sem window | **PASS** | 12 events 2026-09-28 … 2026-12-15 |
| 5.10 Semester 6 catalog slots: the only collision is the planted one | **WARN** | catalog.json Sem 6 slot M2: ['HSS F221', 'EEE F245']<br>catalog.json Sem 6 slot T4: ['CS F415', 'CS F330']<br>(the planted clash moves CS F415 to T2 via circular; by catalog it collides with CS F330 instead) |

### 6 Realism (evidence for judgement)

| Check | Result | Evidence |
|---|---|---|
| 6.1 Catalog feedback blurbs are course-specific (Course Planner reads them as quality signal) | **FAIL** | 84/100 blurbs come from 3 templates shared by ≥5 courses: 28× "Clear structure and useful examples in {title}."; 28× "Workload is steady; weekly practice matters."; 28× "Assignments connect well to the course outcomes."<br>templated discipline electives: ['CS F342', 'CS F363', 'CS F407', 'CS F415', 'CS F429', 'CS F432', 'CS F441', 'CS F464']<br>`catalog.json:54: "blurb": "Clear structure and useful examples in Mathematics I."` |
| 6.2 Catalog descriptions are course-specific | **FAIL** | 22/36 descriptions are "a structured course in {title} with applied exercises and assessed problem solving."<br>`catalog.json:65: "description": "A structured course in mathematics i with applied exercises and assessed problem solving."  (lower-cased roman numeral on screen)` |
| 6.3 Syllabus topic descriptions are real content | **FAIL** | 81/81 syllabus body lines are the same template sentence<br>26 read as plural-subject + 'is' on screen, e.g.<br>`syllabus/cs-f212.md:16: "Functional dependencies is treated"`<br>`syllabus/cs-f212.md:26: "B+ trees is treated"`<br>`syllabus/cs-f212.md:36: "ACID properties is treated"` |
| 6.4 Transcripts look like individual histories (not a round-robin generator) | **FAIL** | students/aarav.json: semesters follow 1,2,3,4,1,2… for 22/22 rows; longest run of one grade = 17<br>students/meera.json: semesters follow 1,2,3,4,1,2… for 21/23 rows; longest run of one grade = 17<br>students/rohan.json: semesters follow 1,2,3,4,1,2… for 20/20 rows; longest run of one grade = 17<br>all 3 transcripts list the same first 10 courses in the same order: ['CS F111', 'MATH F211', 'MATH F213', 'ECON F211', 'HSS F221', 'CS F211', 'CS F213', 'CS F214', 'CS F241', 'CS F301'] |
| 6.5 Internal marks differ between students | **FAIL** | aarav vs meera: 54 identical rows (98% of the smaller set)<br>aarav vs rohan: 54 identical rows (100% of the smaller set)<br>meera vs rohan: 54 identical rows (100% of the smaller set) |
| 6.6 Handbook does not cite documents issued after its own effectiveDate | **FAIL** | `handbook.md:54: "The September 2026 end-semester circular standardizes the current semester's end-semester examination weight at 40 percent in every course."  (handbook effective 2026-07-01)` |
| 6.7 Handbook section numbering has no gaps | **WARN** | present: ['3.1', '3.2', '4.1', '4.3', '5.2', '5.4', '6.1']; missing: ['4.2', '5.1', '5.3'] (AGENTS.md/contracts.ts example id handbook.4.2 does not exist) |
| 6.8 Content text does not announce itself as fictional (disclosure belongs in metadata) | **WARN** | `club_feed.md:35: - 2026-08-25 — Pricing teardown with founders from fictional startup HarborWorks.`<br>`events.json:66: "description": "Northstar Metrics shares its synthetic hiring rubric and project examples.",`<br>`events.json:104: "description": "Fictional founders discuss early customer discovery and pricing.",` |
| 6.9 Circular filenames agree with their titles | **WARN** | circulars/2026-08-sem5-timetable-slot-change.md (filename says sem5) vs circulars/2026-08-sem5-timetable-slot-change.md:2: title: Semester 6 Elective Slot Update |

### 7 Contract fit

| Check | Result | Evidence |
|---|---|---|
| 7.1 students/*.json carry the Student fields (id, name, program, semester, careerGoal, interests) | **PASS** | 3 students |
| 7.2 Transcript rows and catalog use 'units' (not 'credits') with the agreed fields | **PASS** | 65 transcript rows and 36 catalog courses use units |
| 7.3 contracts.ts / AGENTS.md agree with the data on 'units' | **WARN** | `` AGENTS.md:98: - `catalog.json` — electives: code, title, credits, slot, faculty, prereqs, bucket, 2–3 feedback blurbs, `skills[]` `` |
| 7.4 InternalMarkRow / RegistrationRow fields, ISO dates and status enum | **PASS** | all rows conform |
| 7.5 No record data outside the StudentRecords contract | **FAIL** | `students/rohan.json:630: "plannedNextSemester": {  status ['planned'] — not in StudentRecords, and RegistrationRow.status is only ['registered', 'waitlisted']` |
| 7.6 timetable.json: parseable weekdays/times; ISO datetimes derivable | **WARN** | 12 rows with weekday + HH:MM; no contract type exists for timetable.json; no term dates, so CalendarItem.start (ISO datetime) needs an assumed range |
| 7.7 exam_calendar.json: ISO dates and an id per exam (CalendarItem.source.examId) | **WARN** | 24 assessments, ISO dates; 24 without an id; the file is per-course (midSemDate/endSemDate/quizDates), not per-exam |
| 7.8 connectors.json: kind/status enums | **PASS** | 5 connectors, all synthetic |
| 7.9 connectors.json: every provides value is a DocumentKind or StudentRecordKind | **FAIL** | `connectors.json:23: "lectures",  (lms_moodle)`<br>`connectors.json:24: "timetable"  (lms_moodle)`<br>`connectors.json:34: "circulars",  (academic_office)`<br>`connectors.json:47: "opportunities"  (placement_cell)`<br>`connectors.json:57: "clubs",  (clubs_portal)` |
| 7.10 resources.json kinds are Resource.kind values | **PASS** | 15 resources ({'ta_hours': 6, 'faculty': 2, 'library': 2, 'tutoring': 3, 'lab': 2}) |
| 7.11 Every date field is ISO 8601 | **PASS** | 227 date values |
| 7.12 Every source file has a contract home (DocumentKind or record type) | **WARN** | lectures/*.md — AGENTS.md §4.1 puts 'lectures' in the Academic Coach scope; DocumentKind has no 'lecture'<br>timetable.json — no DocumentKind / type in contracts.ts<br>clubs.json — no DocumentKind (club agents scope over club_feed) |

### 8 Backend loader probe

| Check | Result | Evidence |
|---|---|---|
| 8.1 academics.exams() reads exam_calendar.json | **PASS** | 24 |
| 8.2 academics.next_exam(CS F212, end) resolves | **PASS** | Exam(id='cs-f212-endsem', course_code='CS F212', kind='exam', component='End-sem', title='CS F212 End-sem exam', start=datetime.datetime(2026, 11, 30, 0, 0, tzinfo=zoneinfo.ZoneInfo(key='Asia/Kolkata')), end=None, all_day=True) |
| 8.3 academics.past_papers() reads past_papers.json | **PASS** | 18 |
| 8.4 academics.topic_weight(CS F212, 'Two-phase locking') is the topic's own marks | **WARN** | TopicWeight(fact='part of Transactions and concurrency, which carried 16–18 marks in each of the last 3 end-sems (2023–2025)', citation_id='past_papers.cs-f212.transactions-and-concurrency', max_marks=18) |
| 8.5 academics.topic_weight(CS F372, 'Multilevel feedback queues') is the topic's own marks | **PASS** | TopicWeight(fact='carried 12–14 marks in each of the last 3 end-sems (2023–2025)', citation_id='past_papers.cs-f372.multilevel-feedback-queues', max_marks=14) |
| 8.6 academics.topic_weight(CS F303, 'Congestion control') is the topic's own marks | **PASS** | TopicWeight(fact='carried 18–20 marks in each of the last 3 end-sems (2023–2025)', citation_id='past_papers.cs-f303.congestion-control', max_marks=20) |
| 8.7 academics.next_session(CS F212) after the lecture | **PASS** | ('2026-09-24T09:00:00+05:30', 'lecture') |
| 8.8 syllabus.load_syllabus(CS F212) finds 'Two-phase locking' | **PASS** | ['syllabus.cs-f212.3.5'] |
| 8.9 records.load_records(rohan) exposes planned Sem 6 courses | **FAIL** | ['internalMarks', 'registrations', 'studentId', 'transcript'] |

## Realism spot-check (judgement)

### `handbook.md`, read end to end

- **The sentences read like a real handbook.** Rules are one crisp sentence each, with rationale around them ("Completing 142 total units does not waive a bucket requirement…"), and the contacts section is plausible. The `.example` email domain is correct for synthetic data.
- **It contradicts itself on dates.**
  - It is effective 2026-07-01, yet §5.2 (line 54) cites "The September 2026 end-semester circular".
  - The March 2026 circular amends "Academic Handbook 2026–27" (circular line 15) four months before that handbook took effect.
- **The totals don't add up.** The buckets sum to 129 units (133 under the circular) against 142 required, and nothing says where the other 13 (or 9) come from. A juror adding the numbers will ask. Add one sentence, e.g. "Remaining units may be earned in any bucket."
- **The Core requirement can't be met.** Core is 78 units, but the catalog's core courses total only 70.
- **The normal load doesn't match the catalog.** §1 says "A normal academic load is 18–22 units". The catalog's nominal semesters carry 8, 21, 16, 19 and 23 units.
- **The numbering looks like sections were deleted.** It runs 3.1, 3.2, 4.1, 4.3, 5.2, 5.4, with no §3 or §4 parent headings. The id used as an example in AGENTS.md and contracts.ts, `handbook.4.2`, does not exist.
- **Prerequisites appear only in a table (§4.3),** so nothing about them can be quoted as a sentence (check 3.13).
- **"B.E." breaks naive sentence splitters.** It sits inside two citation sentences (§3.1 and circular §1), and a naive splitter cuts them at "…from the B.E.". Verbatim-substring verification is unaffected, but sentence-level quote extraction would truncate them.

### `syllabus/cs-f212.md`, read end to end

- **The structure is right.** It has 4 units and 16 topics, and the topic strings agree with the marks, the past papers and the lecture.
- **Every topic body is one template:** *"<Topic> is treated as a named assessable topic in this unit, with definitions, worked examples, and problem-solving practice."* That is 16 of 16 here and 81 of 81 across all six syllabi. Plural topics read ungrammatically: "B+ trees is treated…", "ACID properties is treated…". This is the page the Coverage card's `syllabusSectionId` opens in the Files page, which makes it the most visible document in demo step 1.
- **Unit 3's first topic has the same name as the unit** ("Transactions and concurrency"). The backend's umbrella fallback depends on that coincidence.
- **It is missing what a real BITS course handout has:** a lecture plan with weeks, a textbook, and an evaluation scheme.

### Other things that would look fake on a projector

- **Transcripts:**
  - All three students list the same course order, with semesters cycling 1,2,3,4,1,2… and 17 identical grades in a row.
  - Rohan has Practice School / Thesis in Sem 1, and Aarav in Sem 3.
  - Meera passes CS F241 in Sem 1, then fails it in Sem 4.
- **Internal marks:**
  - Every student scores 3/4 on every quiz topic and 5/6 on every mid-sem topic.
  - The planted rows use a different component name ("Mid-sem topic total"), a different maximum, and a different date from the rest of the same exam. The result is that Meera's DBMS mid-sem is out of 40 while Aarav's is out of 18.
- **Catalog:** 84 of 100 blurbs come from three templates, including every Sem 6 discipline elective the Course Planner would recommend. One description reads "A structured course in mathematics i with…".
- **Content that announces itself:** "founders from fictional startup HarborWorks", "shares its synthetic hiring rubric", "Fictional founders discuss…". The disclosure already lives in `connectors.json` notes.
- **Circular 2:** the filename says `sem5`; the title says "Semester 6".
- **Faculty names:** some share student first names ("Dr. Rohan Dey", "Dr. Mira Kapoor", "Dr. Mira Lal"), which is a small confusion risk while switching students on stage.

## Backend integration notes

- **The loaders now read every generated file.** They were adapted during the audit, and probes 8.1–8.8 read everything.
- **8.4 WARN: the "part of" fallback overstates the data.** `topic_weight("CS F212", "Two-phase locking")` returns "part of Transactions and concurrency, which carried 16–18 marks…" and cites `past_papers.cs-f212.transactions-and-concurrency`. As explained above, that is an inference the data doesn't support, and AGENTS.md §2 rules out claims like it. After patch item F2, the exact path answers and the fallback is never reached.
- **8.9 FAIL: Rohan's plan is invisible.** `records.load_records()` drops `plannedNextSemester`, so neither the audit nor the Course Planner can see his plan through `StudentRecords`.
- **Demo step 5 works only through course-level weak topics.** `tools/companion.py:808–817` adds the student's two weakest high-weight topics in the course, so Meera gets Normalization and B+ trees actions. But no student has marks on any topic in the lecture's own unit (check 1.19), so the actions derived from the lecture itself are identical for everyone.
- **The lecture start time falls back to midnight.** CS F212 doesn't meet on Tuesdays in `timetable.json`, so `lecture_start()` for the 2026-09-22 lecture returns 00:00.
- **The committed stub set had features the generated set lacks.** The stubs in `983a63d` included 2PL past-paper rows (14/18/16), exam ids and times, a term range, and an assignment deadline plus a reading in the CS F212 lecture. That lecture material is the only thing that exercises the `deadline` and `reading` commitment kinds added in v3.1. See `git show 983a63d:backend/app/data/lectures/cs-f212-2026-09-22-transactions.md`.

## Fix list (ordered by demo impact)

Items marked **[patch]** are in `backend/scripts/audit_fixes.patch`. Line numbers refer to the current files.

### F1. Override chronology: demo step 2, P0 [patch] (checks 1.3, 6.6)

| File:line | From | To |
|---|---|---|
| `handbook.md:2` | `title: Academic Handbook 2026–27` | `title: Academic Handbook 2025–26` |
| `handbook.md:4` | `effectiveDate: 2026-07-01` | `effectiveDate: 2025-07-01` |
| `handbook.md:7` | `# Academic Handbook 2026–27` | `# Academic Handbook 2025–26` |
| `circulars/2026-03-revised-discipline-elective-minimum.md:15` | `Academic Handbook 2026–27 Section 3.2` | `Academic Handbook 2025–26 Section 3.2` |
| `handbook.md:54` | `The September 2026 end-semester circular standardizes the current semester's end-semester examination weight at 40 percent in every course.` | `Circulars may fix the component weights for a particular semester.` |

If the handbook title has to stay, there is a one-line alternative: set the circular to `effectiveDate: 2026-08-01` (issued in March, effective from AY 2026–27). The line-54 fix is still needed either way.

### F2. Skipped and emphasized topics carry their own marks; every paper sums to 100: demo step 1, P0 [patch] (checks 1.9, 4.15, probe 8.4)

Replace `topicMarks` for the three `CS F212` papers (`past_papers.json:5–49`). Meera's topics stay at 14 or above:

| Topic | 2023 | 2024 | 2025 |
|---|---|---|---|
| Normalization | 18 | 16 | 20 |
| B+ trees | 16 | 18 | 16 |
| **Two-phase locking** | **14** | **18** | **16** |
| **Serializability** | **12** | **10** | **14** |
| Transactions and concurrency | 6 | 6 | 4 |
| Relational model | 8 | 8 | 6 |
| Relational algebra | 8 | 6 | 8 |
| Functional dependencies | 8 | 8 | 6 |
| File organization | 4 | 4 | 4 |
| Hash indexing | 3 | 3 | 3 |
| ACID properties | 3 | 3 | 3 |
| **Total** | 100 | 100 | 100 |

- Add `"exam": "End-sem", "totalMarks": 100` to every paper. The loader currently assumes end-sem because the README says so.
- In each `CS F372` paper, move 2 marks from `Synchronization` to `Multilevel feedback queues`, making MLFQ 14/16/14 (check 1.9 WARN).

### F3. Real student histories: demo steps 2 and 5, P0 [patch] (checks 4.5, 4.7–4.11, 6.4)

This needs F8's two new Sem 1 core courses. Replace the `transcript.rows` of each student; titles and units come from the catalog.

| Sem | aarav | meera | rohan |
|---|---|---|---|
| 1 | CS F111 A · MATH F211 A- · PHY F111 B · EEE F111 A- | CS F111 B- · MATH F211 C · PHY F111 C- · EEE F111 B- | CS F111 B · MATH F211 B · PHY F111 C · EEE F111 B- |
| 2 | MATH F213 A- · CS F211 A · CS F213 B · MATH F221 A- · HSS F221 B · ECON F211 A | MATH F213 C- · CS F211 C · CS F213 B- · **MATH F221 F** · HSS F221 B · ECON F211 C | MATH F213 B- · CS F211 A- · CS F213 B · MATH F221 A- · HSS F221 C · ECON F211 B |
| 3 | CS F214 B · CS F241 B- · CS F221 A- · CS F222 B | CS F214 D · CS F241 C · CS F221 C- · **CS F222 F** | CS F214 C- · CS F241 B · CS F221 A- · CS F222 B- |
| 4 | CS F301 A- · CS F225 B · ECON F212 A · CS F320 A- · CS F330 A | CS F301 C · CS F225 C- · ECON F212 C · CS F330 C- | CS F301 B · CS F225 B- · ECON F212 B · CS F320 B · CS F330 A- |
| **Result** | 72 units, 18.0/sem, **on track**, exactly 2 DEs, CGPA 8.82 (meets the 8.0 overload bar, so step 4 still escalates) | 61 units, 15.25/sem, **at risk**, backlogs MATH F221 and CS F222, CGPA 5.24, 1 DE | 72 units, 18.0/sem, 2 DEs, CGPA 7.62 |

With these, every prerequisite is passed in an earlier semester, every course sits in an offered semester, and no semester exceeds 21 units. Also add `"expectedGraduation": "2028-05"` after `semester` in each student (check 1.5). `load_student()` filters it out, so the API shape doesn't change.

### F4. Rohan's hidden gap and the Sem 6 clash: demo step 7, and the audit's `unmetPrereqs` [patch] (checks 1.12, 1.13, 1.15, 5.10)

- **`students/rohan.json:166–170`:** delete the `CS F351` registration row.
- **`students/rohan.json:268–339`:** delete the 9 `CS F351` internalMarks rows.
- **Transcript:** replace it as in F3. That drops CS F363, CS F429, CS F432, CS F441 and PS F401.
- **`catalog.json:642`:** change CS F415 `"slot": "T4"` to `"T2"`. The catalog then agrees with circular 2026-08, and the accidental T4 clash with CS F330 goes away.
- **`catalog.json:916`:** change EEE F245 `"slot": "M2"` to `"M3"`, which removes the Sem 6 clash with HSS F221.

### F5. Per-student internal marks, dated by the exam calendar: steps 3 and 5 [patch] (checks 4.17, 5.3, 5.4, 6.5)

- **Delete every `Quiz 2` row.** The calendar puts Quiz 2 on 2026-10-12 to 10-17.
- **Fix the dates.** Quiz 1 takes each course's `quizDates[0]`. Mid-sem takes `midSemDate`.
- **Give every student the same mid-sem structure,** all under the component name `"Mid-sem"`. That is three topics out of 6 each, plus CS F212 Normalization /12 and B+ trees /10, CS F372 CPU scheduling /14, and CS F303 Flow control /12.
- **Use these scores** (Quiz 1 out of 4 per topic | Mid-sem out of 6 per topic | extra mid-sem topics):

| Course | aarav | meera | rohan |
|---|---|---|---|
| CS F212 | 4,3,4 \| 5,6,5 \| Norm 10, B+ 8 | 3,2,3 \| 4,3,4 \| **Norm 4, B+ 3** | 3,3,4 \| 5,4,5 \| Norm 9, B+ 7 |
| CS F351 | 3,3,4 \| 5,4,5 | 2,3,2 \| 3,4,3 | not registered |
| CS F372 | 4,4,3 \| 6,5,5 \| CPU 11 | 3,2,2 \| 4,3,3 \| **CPU 5** | 4,3,3 \| 5,4,5 \| CPU 10 |
| CS F303 | 3,4,3 \| 5,5,4 \| **Flow 6** | 3,3,2 \| 4,4,3 \| Flow 8 | 3,4,4 \| 5,5,5 \| Flow 9 |
| MATH F241 | 4,3,3 \| 5,5,6 | 2,3,3 \| 4,3,4 | 3,**1**,4 \| 5,**2**,5 (Bayes theorem 30%) |
| HSS F235 | 3,4,4 \| 5,6,5 | 3,3,4 \| 5,4,4 | 2,3,3 \| 4,4,3 |

The results:

- **Meera's topics under 40% stay exactly the planted three:** Normalization 33%, B+ trees 30%, CPU scheduling 36%.
- **Aarav's weakest topic is Flow control at 50%,** matching the README.
- **Rohan gets his own weak topic,** Bayes theorem at 30%, which is relevant for an ML Engineer.

### F6. Prerequisites as quotable sentences: steps 2 and 7 [patch] (check 3.13)

Replace the §4.3 table (`handbook.md:37–47`) with nine bullets, each a single sentence, for example:

> - CS F342 Compiler Construction requires CS F351 Theory of Computation.

The other eight follow the same pattern.

### F7. Lecture days match the timetable: step 1 correctness [patch] (checks 5.5, 5.8)

In `timetable.json`:

- `:5–12` CS F212, Monday 09:00–10:00 → Tuesday 10:00–11:00
- `:21–28` CS F372, Tuesday 09:00–10:00 → Wednesday 09:00–10:00
- `:29–36` CS F303, Tuesday 11:00–12:00 → Thursday 11:00–12:00
- Add `"term": {"start": "2026-08-03", "end": "2026-11-27"}`

The lecture files keep their names, because `companion_smoke.py` hardcodes them. The deadlocks "next week" commitment will now resolve to Tue 2026-09-29 10:00 instead of Mon 09-28 09:00. The smoke test computes its expected value from `timetable.json`, so it follows the change.

### F8. Catalog integrity [patch] (checks 4.12, 4.13, 4.14, and part of 6.1/6.2)

- **Add two Sem 1 core courses.** `PHY F111 Mechanics, Oscillations and Waves` (4 units, slot T3, Dr. Meghna Pai) and `EEE F111 Electrical Sciences` (4 units, slot T4, Dr. Sameer Joshi). Core then totals 78 units, and Sems 1–4 can offer 72 units, above the 68-unit benchmark.
- **`catalog.json:570`:** change CS F363 `offeredIn` from `[6]` to `[7]`, so the lab follows CS F342.
- **`catalog.json:1011–1013`:** change CS F222 `prereqs` from `["CS F241"]` to `["CS F111"]`. CS F241 was offered only in the same semester.
- **Rewrite blurbs and descriptions** for the 8 templated discipline electives: CS F342, CS F363, CS F407, CS F415, CS F429, CS F432, CS F441, CS F464. The core courses' blurbs are still templated (P2).

### F9. Connector `provides` values: Agents & tools page [patch, partial] (checks 7.9, 2.8)

- Change `"circulars"` to `"circular"` (`connectors.json:34`).
- Add `"resources"` to `lms_moodle`.
- Drop `"opportunities"` (no file provides it) and `"clubs"`.
- `"lectures"` and `"timetable"` need a contract decision (F12).

### F10. Real syllabus content: demo step 1, Files page [patch, CS F212 only] (check 6.3)

The patch replaces the 16 template bodies in `syllabus/cs-f212.md` with one-line descriptions, e.g. "Two-phase locking: growing and shrinking phases, strict two-phase locking, and why the protocol guarantees conflict serializability." The other five syllabi are still templated.

### F11. Polish [patch] (checks 5.7, 6.8, 4.2)

- **`exam_calendar.json:50`:** move CS F303 end-sem from 2026-12-06 (a Sunday) to 12-07.
- **`exam_calendar.json:77`:** move HSS F235 mid-sem from 2026-09-13 (a Sunday) to 09-14.
- **Remove "fictional" / "synthetic" from content text** at `club_feed.md:35` and `events.json:66` and `:104`.
- **README:** update the per-student figures.
- **`handbook.md:10`:** change "18–22 units" to "16–23 units".

### F12. Contract decisions, not data (for both people)

- **Rohan's planned courses** (checks 7.5, 8.9). Either add `"planned"` to `RegistrationRow.status` and filter `records.registered_courses()` by status, or add a `planned` slot to `StudentRecords`. Until then, the Sem 6 plan never reaches the API.
- **Add `"lecture"` and `"timetable"` to `DocumentKind`** (checks 7.9, 7.12). AGENTS.md §4.1 already puts `lectures` in the Academic Coach scope.
- **`AGENTS.md:98`** still says "credits" (check 7.3); `contracts.ts` v3.2 already says `units`.
- **Optional:**
  - Rename circular 2 to `2026-08-sem6-elective-slot-change.md` (6.9).
  - Fix or label the handbook numbering gaps (6.7).
  - Give the Recruiter Talk event a `clubSlug` or a documented `organiser` field (2.6).
  - Name the deferred topic in the F372 and F303 transcripts (1.7c, 1.8c).
  - Restore an assignment deadline to the F212 lecture, as the stub had, to exercise the `deadline` action kind. For example: "Assignment 3, on testing schedules for conflict serializability, is due on Friday, October 2nd, on Moodle."

## Applying the patch

```bash
git apply --check backend/scripts/audit_fixes.patch
```

```bash
git apply backend/scripts/audit_fixes.patch
```

```bash
python3 backend/scripts/audit_dataset.py
```

After applying, expect `FAIL 5, WARN 10, PASS 93`. The loader probe was run on the patched copy. `backend/scripts/companion_smoke.py` was not run, because it makes LLM calls. Re-run it after applying.

## Outside scope, noticed

The `mock-data.js` roster (`s1` Aarav Mehta, `s2` Priya Nair, `s3` Rohan Iyer in Sem 3) doesn't match the dataset (`aarav`, `meera`, `rohan` Sen). With `MOCK=true`, the student switcher shows different people from the real API.
