# FINDINGS — backend demo dry run, Sat 26 Sep 2026 (`main` @ `4c8392f`)

Evidence: `backend/scripts/demo_run_transcript.log` (CS F212 text) and `backend/scripts/demo_run.log` (`Lecture.mp3`); runbook: `DEMO.md`.

Ordered by demo impact.

1. **Markers and MIR break two P0 beats.** `POST /lectures/:id/markers` and `POST /relevant` return 404 on every run. There are no routes and no StuckMarker or RelevantCard models, and neither `coverage.confusion` nor handout `stuck` exists. So the "I'm stuck" tap, the confusion row, the stuck review action and Make it Relevant can't be shown. They were not built here: that is feature work, and this pass only fixed breaks. When markers are built, one CS F212 handout left the 120 s segment out of every section, so resolution needs a nearest-section rule.
2. **`Lecture.mp3` is not the DBMS clip.** It is a real third-party probability lecture: its handout names Harvard's IQSS and Mosteller. It matches at most 2 of 15 subject words of any lecture file and, by the syllabi, is MATH F241. Audio processing misses the 180 s cap every time (STT 138–184 s, 200–253 s end to end). Even its text maps 0 of 20 sections to the syllabus in the final pass, so coverage is skipped with a trace error, no study action is proposed and step 7 fails. An earlier pass mapped 1 of 18 and claimed "Bayes theorem" was covered from a one-line mention. Its actions also include "Review Newton's material", homework "due in a week" comes back with no date, and non-syllabus commitments become whole-sentence plan topics. The CS F212 transcript shows the planted Two-phase locking gap, the end-sem quote and 3 prep actions due Mon 28 Sep 09:00 on every run, in 36–40 s. Use that.
3. **`simulate-week` refuses right after a reset.** It returns 400 "build a plan first", which the Feature 2 session confirmed is intended. Prep is reset → `POST /students/meera/plan` → simulate-week.
4. **Fixed.** Added `POST /demo/reset/:studentId` (`db4a44f`). Ticket ids were count+1, so a per-student reset could reissue an id another student's ticket held and overwrite it; now max+1 (`f329d6b`, `demo-fix:`).
5. **Still wrong on stage (CS F212 path):**
   - The simulated "last week" is really next week's dates. On Sat 26 Sep the calendar already marks today's 15:00 and 16:00 blocks `done`, and the 1:1 asks about "Sun 27 Sep" in the past tense and says the plan was "built on Sat 3 Oct".
   - The recap doesn't add up: 11 planned = 7 done + 3 missed + the accepted prep still `planned`, and `prepMet`/`prepMissed` stay 0.
   - B+ trees and CPU scheduling are listed as both completed and skipped. Every weak-topic movement is flat.
   - The adjusted plan's "week 1" is the stale Week of Sep 21, holding only the accepted prep, so its block count is 1. The audio run also listed the same adjustment twice.
   - Waits: about 3 of the 7 minutes. The plan chat takes 25–29 s, 1:1 complete 24–43 s, a lecture 36–40 s.
   - A plan build logged `ERROR 1 blocks unplaced` in its trace.
   - Action titles are reworded every run (0 identical between Meera and Aarav), so the student difference only shows by topic: Meera alone gets review Normalization and review B+ trees.
   - Contract drift: simulate-week returns no `updated`, the 1:1 recap has no `window`, and `/demo/reset` isn't in contracts §10.
