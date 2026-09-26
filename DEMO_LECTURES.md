# DEMO_LECTURES.md — real lectures that exercise every companion feature (Sat 26 Sep 2026, 16:25)

Public lecture videos matched to the synthetic syllabi, one or more per class channel. Every pick below was
**run through our own pipeline**: its YouTube captions (clip range only) went through `class_companion` on the
text path against an isolated scratch DB, not :8000. "Pipeline said" is that run's actual output, one run each.
Live uploads use AssemblyAI instead of YouTube captions, so wording, section titles and action titles will
differ a little. Unit, missed topics and deferral quotes are the parts to rely on. No media was downloaded.
A–D were re-run for Meera at 16:40 on `1b6e600` (contracts v3.10, Smart Exam gaps). Their "v3.10" lines are
from that run.

Stuck-tap times are **clip-relative** (0:00 = start of the cut), for a live tap or the handout timeline.

## Demo files: upload one and wait (`backend/data/stage/`, gitignored)

Each file is the cut below plus the student's **"I'm stuck" taps saved inside the file as chapter marks**, the
way phone recorders keep bookmarks. On upload the backend (`_import_stuck_chapters` in `tools/companion.py`,
`media.chapters`) turns every chapter titled "I'm stuck: <note>" into a StuckMarker at that second, the same as
a live tap. Processing then flags the handout section, adds a Coverage confusion row and creates the review
action. Nothing else to click. Say it on stage: *"her taps from class are saved in the recording"*. The taps are
demo input, like the pre-marked week; everything computed from them is real.

| File | Upload in (as) | Stuck taps inside | Process time |
|---|---|---|---|
| `A_CS-F212_transactions_CMU-L15.m4a` | `cs-f212` (Meera) | 3:20 lost at the swapping test | **66 s** measured |
| `B_CS-F212_btree_CMU-F23.m4a` (+ `.mp4` video) | `cs-f212` (Meera) | 6:15 why scan along the leaves? · 8:38 split pushes a key into a full parent? | **55 s** measured |
| `C_CS-F212_normalization_NPTEL.m4a` | `cs-f212` (Meera) | 9:50 3NF vs BCNF · 26:20 when does closure stop? | ~2.5 min |
| `D_CS-F372_cpu-scheduling.m4a` | `cs-f372` (Meera) | 18:55 when does SRTF preempt? · 24:40 how is RR waiting time counted? | **112 s** measured |
| `E_CS-F303_tcp-flow-control_Kurose.m4a` | `cs-f303` (Aarav, then Meera) | 1:22 what does the receive window cap? | **54 s** measured |
| `F_CS-F351_automata_MIT-18.404.m4a` | `cs-f351` (Rohan) | 12:49 why are the states pairs? | ~2 min |
| `G_MATH-F241_bayes_Stat110-L5.m4a` | `math-f241` (Aarav) | 9:12 why only 16% after a positive test? | ~1.5 min |
| `H_HSS-F235_ethical-algorithm_Kearns.m4a` | `hss-f235` (any) | 13:49 why reject every qualified orange applicant? | ~1.5 min |

Checked 16:45 with real AssemblyAI uploads on scratch DBs (A, B, D as Meera; E as Aarav). Every tap came back as a
STUCK flag on the right handout section, a Coverage confusion row, and a linked or new review action
("…you flagged it in class at 3:20"). The class channel decides the course, so upload each file in the channel shown. A file without chapter marks
(any other recording) behaves exactly as before. To add or move a tap, write an ffmetadata file with a
`[CHAPTER]` block (`TIMEBASE=1/1000`, `START=<ms>`, `END=<ms>`, `title=I'm stuck: <note>`), then:

```bash
ffmpeg -i in.m4a -i taps.ffmeta -map 0 -map_metadata 1 -map_chapters 1 -c copy out.m4a
```

Check it with `ffprobe -v error -show_chapters out.m4a`.

## Which clip for which demo beat

| Beat | Clip | Why this one |
|---|---|---|
| 1 In class (Meera, CS F212) | **A** CMU L15, 11-min cut | 2PL missed *with the lecturer's own deferral*, 2 verified serializability emphasis quotes, 8 actions |
| 1 alt: stuck on her real mistake | **B** CMU B+Tree | Tap lands on split propagation. The top action, "Revisit your B+ trees gap before the next class", quotes her Smart Exam Q5a: "2/6, B+ tree leaf split not propagated to the full parent" |
| 2 Make it Relevant | stuck section of A or B | Meera: badminton/music/coffee |
| 6 Switch student | **E** Kurose TCP, 5.5 min | Same clip: **only Aarav** gets "Review flow control, 6/12"; both get congestion-control prep for Tue 11:00 |
| Other class channels ("nothing hardcoded") | **D** OS, **F** TOC, **G** Stat 110, **H** ethics | Each maps to a different unit; G replaces `Lecture.mp3` (0/10 mapped) |
| Video upload | **B** as .mp4 | On-screen B+ tree visualisation is worth showing |
| Mind map ghost nodes | any | Every pick has 1–4 missed topics |

## The picks

### A. CS F212 · Unit 3 Transactions — CMU 15-445 F22 #15 Concurrency Control Theory (Andy Pavlo) · CC BY
https://www.youtube.com/watch?v=W5FFiI5ALTc · **cut 1:01:22–1:12:23 (11:01)**
- Pipeline said: Unit 3; covered Transactions and concurrency, Serializability; **missed ACID, Locking basics,
  Two-phase locking, Deadlocks**. 2PL has the verified deferral: *"Two-phase locking will fix this for us on
  Tuesday next week"* (clip 6:02). Emphasized: *"…this is the gold standard of what you would have in a database
  system"*, *"but I think it's important to understand what serializable is"*. 2 commitments. 8 actions: prep
  ×2 (Mon 28 Sep 09:00; 2PL), study ×3, review serializability plus Meera's Normalization 4/12 and B+ trees 3/10.
- v3.10: the Normalization and B+ trees reviews become "Revisit Normalization / B+ trees before Quiz 2". Each
  has the Smart Exam gap chip, and the why quotes Q4b/Q4c and Q5a/Q5b. Neither is due before the next class,
  because transactions doesn't build on them.
- Stuck tap: **3:20**, the swapping test (*"everyone's eyes are glazing … this probably doesn't make any sense"*).
- The existing `backend/data/stage/dbms_demo.mp3` (1:02:20–1:17:05) also works: ACID covered, 3 missed, 1 emphasis
  quote, stuck ~2:20, 2PL line 5:04. It is on disk already, so it is the zero-effort fallback.
- Since `4d86dfe`: "on Tuesday next week" resolves to CS F212's next session, so the 2PL prep is due **Thu 01 Oct
  09:00**. Checked with a real upload of A at 16:52.

### B. CS F212 · Unit 2 Storage and indexing — CMU 15-445 F23 #08 B+Tree Indexes · CC BY
https://www.youtube.com/watch?v=5gXn5fLkbM0 · **cut 0:15:22–0:26:19 (10:57)**
- Pipeline said (v3.10): Unit 2; covered B+ trees; **missed File organization, Hash indexing**. Prep "deadlocks
  / latching" due Mon 28 Sep 09:00. Study file organization (6 marks) and hash indexing (4–5). **"Revisit your
  B+ trees gap before the next class"**, due Mon 28 Sep 09:00, with the Smart Exam gap chip. Its why reads:
  "you scored 3/10 … Smart Exam Mid-sem Q5a (08 Sep): 2/6, B+ tree leaf split not propagated to the full parent;
  … Q5b (08 Sep): 1/4, Range query answered by repeated searches instead of walking the linked leaves".
- Stuck taps: **8:38**, the leaf split cascading to a full parent: exactly Q5a, which the action above quotes.
  **6:15**, scanning along the leaves vs up and down the tree: exactly Q5b.
- Backup: CMU F22 #08 https://www.youtube.com/watch?v=9QPr8Ufzt5M, 0:18:42–0:29:50. Same coverage result; weaker prep.

### C. CS F212 · Unit 1 Normalization — NPTEL DBMS, Prof. Partha Pratim Das, "Week 4 Lecture 17"
https://www.youtube.com/watch?v=UniP6VJIOZY · **whole video 0:00–31:15** · YouTube licence (credit NPTEL)
- Pipeline said: Unit 1; covered Functional dependencies, Normalization; **missed Relational model, Relational
  algebra** (no deferral). Prep "next module" due Mon 28 Sep 09:00. Study ×2. No exam hints (none were spoken).
  v3.10: **"Revisit your Normalization gap before the next class"** (Mon 28 Sep 09:00, gap chip). Its why quotes
  "4/12 … Smart Exam Mid-sem Q4b: 1/4, Transitive dependency left in 3NF decomposition; Q4c: 1/4, 3NF's
  prime-attribute exception taken as proof of BCNF".
- Stuck taps: **9:50**, 3NF's third condition vs BCNF (Meera's Q4c `bcnf-vs-3nf-confused`). **26:20**, when
  attribute closure stops (`closure-incomplete`).
- Rejected: CMU F17 #05 Normal Forms. It covered all 4 Unit 1 topics, so nothing shows as missed.

### D. CS F372 · Unit 2 CPU scheduling — "Introduction to Operating Systems" #19 CPU Scheduling (xv6 course)
https://www.youtube.com/watch?v=4hCih9eLc7M · **cut 0:04:51–0:38:48 (33:57, ~2.5 min to process)** · YouTube licence
- Pipeline said: Unit 2; covered CPU scheduling, FCFS, SJF, Round Robin; **missed exactly Multilevel feedback
  queues**. This is the planted story, from a real lecture. Commitment *"so next we will see scheduling
  algorithms which are based on priority…"* → prep due **Tue 29 Sep 09:00** (the real CS F372 slot). Study MLFQ
  (12–14 marks). v3.10: **"Revisit CPU scheduling before priority-based scheduling"** (Tue 29 Sep 09:00, gap chip).
  Its why quotes "5/14 … Smart Exam Mid-sem Q4b: 1/6, Round Robin schedule ignores the context-switch cost between
  quanta; Q4c: 1/4, Preemptive SJF (SRTF) scheduled as non-preemptive".
- Stuck taps, each on one of Meera's CS F372 gaps: **18:55** SRTF preemption (`srtf-preemption-missed`). **24:40**
  Round Robin waiting-time count (`waiting-vs-turnaround-confused`). **26:05** context switches counted
  (`rr-quantum-context-switch-ignored`).
- Shorter: 0:22:18–0:38:48 (16:30), but FCFS then also shows missed. CC BY alternative: NPTEL IIT Bombay
  https://www.youtube.com/watch?v=TGpSBceX36E, 0:06:25–0:21:19 (misses only MLFQ, 1 emphasis quote, no prep).

### E. CS F303 · Unit 2 Transport — Kurose & Ross Ep. 3.5.5 TCP Flow Control & Connection Mgmt (Epic Networks Lab)
https://www.youtube.com/watch?v=iPXaMBu_OLk · **cut 0:00:13–0:05:40 (5:27)** · YouTube licence, Kurose/Ross slides
- Start at 0:13, not 0:00. At 0:10 the speaker says "congestion management" by mistake, which could mark
  congestion control as covered.
- Pipeline said (both students): Unit 2; covered TCP three-way handshake, Flow control; **missed Congestion control
  (deferred: *"in the next video we will start looking at the principles of congestion control…"*) and UDP**.
  Prep due **Tue 29 Sep 11:00** (the real CS F303 slot). Study UDP.
  **Aarav only: "Review flow control … you scored 6/12 … 14–15 marks"**. Meera gets no flow-control review.
- Stuck tap (Aarav): **1:22**, the receive window = free buffer space.

### F. CS F351 · Unit 1 Automata — MIT 18.404J F20 L1 (Michael Sipser) · MIT OCW, CC BY-NC-SA
https://www.youtube.com/watch?v=9syvZr-9xwk · **cut 0:38:51–1:00:34 (21:43)** · for Rohan (CS F351 is the
prerequisite he's missing for Compiler Construction)
- Pipeline said: Unit 1; covered DFA, Regular expressions; **missed NFA**. Emphasis: *"So, make sure you you
  understand that and think about that"*. The reading commitment became a **resource** action (the only clip that
  produces one). Prep for Thursday, study NFA (10–12 marks), review DFA.
- Stuck tap: **12:49**, the product construction (states are pairs).

### G. MATH F241 · Unit 1 Probability — Harvard Stat 110 L5 (Joe Blitzstein) · replaces `Lecture.mp3`
https://www.youtube.com/watch?v=JzDvVgNDxo8 · **cut 0:18:02–0:32:52 (14:50)** · YouTube licence
- Pipeline said: Unit 1; covered Conditional probability, Bayes theorem; **missed Random variables** (15–16 marks).
  **4 verified emphasis quotes**, the most of any pick, e.g. *"these are common mistakes with conditional probability"*.
  Homework hint → commitment. Study random variables, review.
- Stuck tap: **9:12**, why a 95%-accurate test still means only ~16% (base rates). MIR for Aarav: DRS ball-tracking.
- Alt with manual captions: MIT 6.041 L2 https://www.youtube.com/watch?v=TluTv5V0RmE, 0:20:25–0:51:11 (same
  coverage, only 1 action).

### H. HSS F235 · Unit 2 Ethics — PETS 2020 keynote "The Ethical Algorithm" (Michael Kearns, UPenn)
https://www.youtube.com/watch?v=-DLlbPNIW-E · **cut 0:33:09–0:48:52 (15:43)** · YouTube licence
- Pipeline said: Unit 2; covered Privacy, Algorithmic bias; **missed Professional responsibility**. Only 1 action
  (study), because a keynote has no exam talk or "next week". Use it to show a non-CS course, not for actions.
- Stuck tap: **13:49**, why the most accurate classifier rejects every qualified minority applicant.
- Rejected: NPTEL IIT Bombay L64 Data Privacy and Ethics. It covered all 3 topics, so nothing shows as missed.

## Rebuilding the files (only needed on another machine; they are already in `backend/data/stage/`)

`--download-sections` is throttled by YouTube to about 2× real time. Download the full audio instead (seconds),
then cut locally. yt-dlp needs a JavaScript runtime for YouTube; node works: `--js-runtimes node`.

```bash
yt-dlp --js-runtimes node -f "140/bestaudio[ext=m4a]" -o full_A.m4a "https://www.youtube.com/watch?v=W5FFiI5ALTc"
```

```bash
ffmpeg -ss 1:01:22 -to 1:12:23 -i full_A.m4a -vn -c:a copy A.m4a
```

Then add the stuck chapters as above. Same pattern for B–H, using each pick's URL and cut.

## Say on the slide / in Q&A
- Lecture audio is **public university lectures** (CMU 15-445, NPTEL, MIT OCW, Harvard Stat 110, Kurose & Ross,
  PETS), credited. It is not student data. Everything about the students is still synthetic.
- Real lectures rarely say "this is on the exam". When the Emphasized list is empty, that's the pipeline refusing
  to invent one. G is the clip to show when you want emphasis quotes.
