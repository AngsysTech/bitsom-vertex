# DEMO.md — stage runbook from the backend dry run (Sat 26 Sep 2026)

Written from what `backend/scripts/demo_run.py` actually produced against `main` @ `4c8392f` on the local server,
not from the plan:

- `backend/scripts/demo_run_transcript.log`: `--reset --transcript`, the CS F212 text path. **This is the path to demo.**
- `backend/scripts/demo_run.log`: default run on `Lecture.mp3` (audio path, then its automatic text fallback).

Numbers come from these final logs. Where a range is given, it spans both passes of the same script; the first
pass's logs were overwritten by the second. No UI was involved. The UI on `main` does not call `/demo/*`,
`/students/:id/plan`, markers or `/relevant`, so every fallback below is a terminal command. Keep a terminal tab open
on the server machine.

## Read first: two things the dry run changes

1. **`Lecture.mp3` is not the DBMS clip.** It is a 46:28 probability lecture. It matches none of the three lecture
   files: at most 2 of each file's 15 subject words ("transaction", "lock", "serializability" never occur). Its
   most frequent words are experiment, probability and outcome, so by the syllabi it is **MATH F241**. It is a real
   recorded third-party lecture: its handout names Harvard's IQSS and Mosteller. The audio path never reached `ready`
   within 180 s: STT alone took 138–184 s, and 200–253 s end to end. Its handout maps 0 of 20 sections to the
   syllabus, so there is no coverage and no study action. **Run the in-class beat on the CS F212 transcript.** It is
   ready in 36–40 s and shows the planted story every time.
2. **"I'm stuck" markers and Make it Relevant are not on the backend.** `POST /lectures/:id/markers` and
   `POST /relevant` both return 404, so there is no confusion row, no stuck section and no MIR card. Cut beat 2 (MIR)
   and the stuck tap from the live demo, or build them first. Do not show the frontend mock in their place
   (AGENTS §2: no simulated intelligence).

## 1. Pre-demo checklist (T–10 min)

1. Server up, without `--reload` so a file save can't restart it mid-demo. Check it with `curl -s localhost:8000/health` → `{"status":"ok"}`.
   ```bash
   cd backend && .venv/bin/uvicorn app.main:app --port 8000
   ```
2. Reset both students. This clears lectures (and their audio), actions, plan, stored calendar items, 1:1s, tickets,
   the demo clock and the DM threads. Timetable and exams stay.
   ```bash
   curl -s -X POST localhost:8000/demo/reset/meera
   ```
   ```bash
   curl -s -X POST localhost:8000/demo/reset/aarav
   ```
3. Build Meera's plan, then simulate her week. The order matters: right after a reset, `simulate-week` returns
   `400 "no plan blocks in the next 7 days; build a plan first"`. The plan takes 18–25 s.
   ```bash
   curl -s -X POST localhost:8000/students/meera/plan > /dev/null
   ```
   ```bash
   curl -s -X POST localhost:8000/demo/simulate-week/meera
   ```
   Every third block in the next 7 days is marked missed, the rest done (dry run: 7 done / 3 missed, and 12 / 5).
   `clockNow` is now + 7 days (dry run: `2026-10-03T14:37:31+05:30`). From here on
   Meera's clock is a week ahead: "this week" in her plan and 1:1 means the week after today. Say it on stage:
   "last week is pre-marked, disclosed demo setup".
4. Lecture input:
   - CS F212 transcript: `backend/app/data/lectures/cs-f212-2026-09-22-transactions.md`. Course `CS F212`, date = today.
   - `Lecture.mp3`: `backend/Lecture.mp3` (45.5 MB, 46:28). It is MATH F241, not CS F212 (see above).
5. Optional full rehearsal (about 4 min on the text path). It leaves state behind, so repeat steps 2–3 afterwards.
   ```bash
   cd backend && .venv/bin/python scripts/demo_run.py --reset --transcript
   ```

## 2. The sequence (exact inputs, and what came back)

| Beat | Do / type exactly | Wait | What the dry run returned |
|---|---|---|---|
| 1 In class (Meera) | Upload the CS F212 transcript: `POST /lectures {studentId: "meera", courseCode: "CS F212", date: <today>, transcriptText}`, then `POST /lectures/:id/process` | **36–40 s**, talk over it | Handout “Database Transactions and Concurrency Control”, 3 sections: ACID Properties · Serializability and Precedence Graphs · Locking Basics. Coverage: covered 4, missed **Two-phase locking** (planted) and **Deadlocks** ("we'll come back to deadlocks next week"). Exam hint `[1:43]` “This part on serializability will definitely be on the end-sem, I'm telling you now”. 5 commitments, 7 actions: 3 prep due Mon 28 Sep 09:00, study 2PL due Mon 12 Oct (CS F212 Quiz 2), review serializability, and from Meera's marks, review Normalization and review B+ trees |
| 1 "I'm stuck" | Tap at **135 s (2:15)**. The dry run used 120 s | — | **404, not built.** 135 s falls in segment s9 “Locking basics are simple at first…”, inside the Locking Basics section in all 4 handouts built. 120 s falls in s8 (“…Let me do the lock intuition…”), which was inside Serializability in 3 of 4 handouts and in no section in 1 |
| 1 Accept two | Accept the study (2PL) and the first prep | instant | Study → **Mon 05 Oct 18:00–18:45**. Prep → **Sat 26 Sep 18:00**. Both on the calendar, no overlaps (asserted) |
| 2 MIR | — | — | **404, not built.** Move to the "Next" slide |
| 3 After class | `What should I study this week?` | **25–29 s**, talk over it | Route `build_study_plan`, 8 verified citations, cards `study_plan` + `weak_topics`. “Study **Normalization** (150 min), **B+ trees** (150 min), and **CPU scheduling** (125 min) this week… 575 min across 15 blocks”. Calendar after the accept (before this chat): Mon 05 Oct had CS F212 class 09:00, MATH F241 15:00, Study: Normalization 16:30 and the accepted 2PL action 18:00. The chat rebuilds the future blocks, so re-check the day before pointing at it |
| 4 Every week | `Run my weekly review` | ~7 s | Checked separately with curl on a fresh Meera: route `weekly_review`, `one_on_one` card, 3 citations. The run used the 1:1 endpoints. Recap: planned 475 min / 11 blocks, done 325 min / 7 blocks, missed 3, streak 3 days. Concerns name missed B+ trees (Sun 27 Sep) and CPU scheduling (Wed 30 Sep) |
| 4 Answer | Answer q1 (“What got in the way of the B+ trees block on Sun 27 Sep?”): `Ran out of time on Tuesdays` | instant | status `in_progress` |
| 4 Complete | Complete with **Share with advisor ON** | **24–43 s**, talk over it | Adjusted plan moves B+ trees, Relational model and CPU scheduling into the coming week. Ticket **A-101** appears in the advisor inbox |
| 5 Escalate | `Can I get a fee extension for a medical issue?` | ~3 s | Route `escalate`, 0 citations, ticket **A-102**: “…a human advisor will reply in this thread. The documents I can read don't cover fee extensions for medical issues…” |
| 5 Advisor | Advisor view, reply to A-102: `Approved, submit the medical certificate to the Academic Office by Friday.` | instant | The reply lands in Meera's DM as an advisor message, and the original escalation flips to `answered` (asserted) |
| 6 Aarav | Same transcript, then `What should I study this week?` | **40 s + 27 s** | Same planted gaps and exam hint. Actions by kind + topic: Meera alone gets review Normalization and review B+ trees; Aarav alone gets ask Locking basics. Plan top topics: Meera CPU scheduling / Normalization / B+ trees; Aarav Flow control / Random variables / DFA. Titles are reworded every run (0 identical), so compare topics, not titles |

About 3 of the 7 minutes are waiting (40 + 25 + 5 + 24–43 + 3 + 40 + 27 s). To make beat 6 instant, start Aarav's
upload right after Meera's handout is ready. That is real processing started earlier, not a canned result.

## 3. Fallbacks that worked in the dry run

| Step | Primary | Fallback that worked | Where |
|---|---|---|---|
| Meera's simulated week | `POST /demo/simulate-week/meera` | 400 after a reset, so `POST /students/meera/plan` first, then retry: 7 done, 3 missed | both logs, step 2 |
| Lecture | Audio `Lecture.mp3` | Not ready at 180 s, so the script reran steps 3–5 on the text path: ready in 82 s (MATH F241 text), 36–40 s (CS F212) | `demo_run.log` step 5 |
| Plan | Chat `What should I study this week?` | `POST /students/meera/plan` builds the plan with the same tool and returns a `study_plan` card in 18–25 s. Then reload the calendar | both logs, step 2 |
| Weekly review | Chat `Run my weekly review` | The 1:1 endpoints directly: `GET /one-on-one/meera/current`, `POST .../answer`, `POST .../complete {shareWithAdvisor: true}` | both logs, step 10 |
| Advisor | Advisor view | `POST /advisor/reply {ticketId, text}`, which lands in the DM | both logs, step 12 |
| Markers, MIR | — | **None.** Both are 404 on every run | steps 4, 13 |

The spec also suggested a pre-built handout id as a fallback. There isn't one: the reset deletes every lecture, and
the dry run didn't exercise processing a lecture before the demo.

## 4. If it hangs

1. **The lecture sits in `processing` past 60 s.**
   - Click: in the terminal, run `curl -s localhost:8000/lectures/<id>`. If the status is `failed`, run
     `curl -s -X POST localhost:8000/lectures/<id>/process` once; a failed lecture reruns. If it is still
     `processing`, it can't be restarted, so keep talking and open the trace when it lands.
   - Say: "It runs five checked steps: transcript, handout, coverage against the syllabus, commitments, actions.
     Each quote is verified against the transcript before it's shown." The dry run's steps: handout 21–23 s,
     coverage 6 s, commitments 4–5 s, actions 4–6 s.
2. **The plan chat passes 40 s or answers with a system line.**
   - Click: in the terminal, run `curl -s -X POST localhost:8000/students/meera/plan > /dev/null` (18–25 s), then
     reload the calendar.
   - Say: "The planner is one model call that spreads ten weak topics over twelve weeks. Code then places every
     block after classes and away from exams. Here it is on the calendar."

## 5. Step timings (seconds, from the logs)

| Step | CS F212 text (`demo_run_transcript.log`) | `Lecture.mp3` (`demo_run.log`) | Talk over it? |
|---|---|---|---|
| reset | 0.0 | 0.0 | — |
| plan + simulate-week (pre-demo) | 18.3 | 25.2 | pre-demo |
| create lecture | 0.0 | 0.1 (45.5 MB upload) | — |
| stuck marker | 404 | 404 | not built |
| process → ready, Meera | **36.1** (handout 21.5, coverage 5.8, commitments 3.9, actions 3.8) | audio not ready at 180 (STT alone 138.6), then the MATH F241 text **82.3** | yes |
| handout, cards, accept, calendar | 0.0 | 0.0 | — |
| `What should I study this week?`, Meera | **24.8** (allocate 20.0, compose 3.2) | **25.4** | yes |
| 1:1 current | 4.8 | 5.2 | — |
| 1:1 complete | **24.1** | **43.3** | yes |
| `Run my weekly review` (separate curl check) | ~7 (route 1.3, reflect 3.1, compose 2.0) | — | — |
| fee-extension chat | 2.7 | 3.0 | — |
| advisor reply → DM | 0.0 | 0.0 | — |
| Make it Relevant | 404 | 404 | not built |
| process → ready, Aarav | **40.2** | **82.5** | yes |
| `What should I study this week?`, Aarav | **27.2** | **29.2** | yes |
| abandoned audio lecture, full pipeline | — | 200 (STT 138, handout 53) | — |

Asserts: 11/11 on the CS F212 text path. On `Lecture.mp3`, 7/7 passed, but step 7 failed for both students because
no study action was proposed (see FINDINGS.md).
