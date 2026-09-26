# E2E.md — one real lecture video, every feature, as Meera (Sat 26 Sep 2026)

The trial run before the stage demo: upload one recorded lecture to one class channel and walk every feature on
live data. Clip choices, cut points and stuck-tap times are in `DEMO_LECTURES.md`; stage timings are in `DEMO.md`
(its "Read first" note is out of date: markers and Make it Relevant are on the backend now).

## The classes (dataset) and where the Smart Exam flag fires

Meera is registered in six class channels. Every channel gets handout, coverage, mind map, actions and calendar.
The "revisit this first" flag needs a graded mid-sem (`graded_answers/meera.json`, the synthetic Smart Exam
connector) where she scored at most half on a topic:

| Channel | Meera's Smart Exam weak spots | A lecture that fires the flag |
|---|---|---|
| CS F212 Database Systems | Normalization 4/12 (Q4a–c), B+ trees 3/10 (Q5a–b) | B+ trees, hash indexing, normalization (clips B, C) |
| CS F372 Operating Systems | CPU scheduling 5/14 (Q4a–c) | any CPU scheduling lecture: FCFS, SJF, RR, MLFQ (clip D) |
| CS F303, MATH F241, CS F351, HSS F235 | none | no flag; everything else works |

Aarav and Rohan have no weak Smart Exam topics, so they never get the flag. That is the student-switch contrast.

**How the flag is decided (code, no model):** a topic the lecture taught or promised for next class is a
candidate. So is any topic it builds on, per the `Builds on:` lines in `syllabus/*.md`. If the student is weak on a
candidate in the Smart Exam, a review action "Revisit … before …" is added, due at that course's next class. Its
reason quotes the exam questions, e.g. `Smart Exam Mid-sem Q5a (08 Sep): 2/6, B+ tree leaf split not propagated to
the full parent`. The action shows an amber **Smart Exam gap** chip, and the class-thread message names the topic.

**Best clip for this trial: B** (CMU B+Tree Indexes, 0:15:22–0:26:19, about 11 min, upload as .mp4). It covers
B+ trees, so it should produce a review item like "Revisit your B+ trees gap before the next class", due at the
next CS F212 class (Mon 28 Sep 09:00). A stuck tap at 8:38 (split propagation, her Q5a) links to that same review
item, so it shows 🚩 8:38 beside the chip. If the lecturer also stresses B+ trees as exam material, it is still
one revisit item due at the next class. Any other review whose topic isn't built on today (e.g. Normalization on
this clip) reads "… before CS F212 Quiz 2" and is due then. Verified end to end on the planted CS F372 scheduling
transcript ("Revisit your CPU scheduling gap before the next class", due Tue 29 Sep 09:00). The clip-B case has
only a direct test so far: real clip B runs showed a Quiz 2 due date, fixed in `872c73b`, and a re-run is pending.

## 1. Get the file

```bash
brew install yt-dlp
```
Use the command under the pick in `DEMO_LECTURES.md`, which cuts while it downloads. If yt-dlp warns about a
missing JavaScript runtime, run `brew install deno`. Processing takes about 35 s for 3 min of audio, 1.5–2 min for
15 min, and 2–5 min for 45 min.

## 2. Start clean

Run the backend **without `--reload`**. With `--reload`, any backend file save (yours or another session's)
restarts the server and kills a lecture that is still processing.
```bash
cd backend && .venv/bin/uvicorn app.main:app --port 8000
```
```bash
curl -s -X POST localhost:8000/demo/reset/meera
```
Start the frontend with `npm run dev` in `frontend/`. `.env.local` has `VITE_MOCK=false`, so it talks to :8000.

## 3. Walk it

1. **In class.** Open the class channel (CS F212 for clip B). Click **Upload** beside Record, or drag the file
   into the Lectures tab. Wait for the ready message in the channel.
2. **Handout.** In the Lectures tab, click the timeline at the stuck moment, type what lost you, then **Flag**.
   The section turns red, Coverage gets a Confusion row, and the matching review action gets 🚩.
3. **Mind map.** Toggle Handout → Mind map. It shows stuck badges and dashed ghost nodes for the syllabus topics
   the lecture skipped. **Rebuild** picks up flags added later.
4. **Actions.** Look for the amber Smart Exam gap chip ("Revisit … before …"). Accept two actions: each shows
   "Added to plan · <day time>" and appears in the Schedule tab and the rail Calendar.
5. **Make it Relevant.** Use it on the flagged section and pick an interest (Meera: badminton, music, coffee).
6. **After class.** In the Academic Coach DM, ask "What should I study this week?" You get weak topics (with a
   "Smart Exam · where the marks went" box for her weak topics), the week plan, and the calendar. Accepted actions
   and plan blocks never overlap.
7. **A week later (disclosed demo step).** It marks the next 7 days' blocks done or missed (every third missed)
   and moves Meera's clock 7 days ahead. Run it, then reload the page:
   ```bash
   curl -s -X POST localhost:8000/demo/simulate-week/meera
   ```
   In the DM, ask "Run my weekly review". Open the Weekly 1:1, answer a question, turn on "share with advisor",
   then **Complete**. The plan is rebuilt with the missed topics carried over, the calendar re-flows, and a
   ticket lands in the advisor inbox.
8. **Escalate.** Ask "Can I get a fee extension for a medical issue?" The coach refuses and opens a ticket. Reply
   in the Advisor view; the reply lands in the DM.
9. **Switch student.** Press ⌘K → Aarav and upload the same clip. You get different actions and no Smart Exam flag.

## Known limits (say them if asked)

- Lecture audio is public university lectures, credited. Every student record is synthetic.
- A lecture that matches no syllabus unit gets "couldn't match this lecture to the syllabus": no coverage and no
  flag. Upload it to the right class channel.
- Real lecturers rarely say "this is on the exam", so Emphasized is often empty. That is the pipeline refusing to
  invent a hint.
- A prep action can pick up the lecturer's own weekday (e.g. CMU's "Tuesday"), not the class slot.
