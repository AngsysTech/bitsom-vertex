# INTEGRATION — real-mode UI against the backend, Sat 26 Sep 2026

Frontend `VITE_MOCK=false` (Vite on :5610, `/api` proxied to :8000) against the backend on `main`. Student `meera`, class
channel `cs-f212-dbms`, unless noted. Checked in the Browser pane on real data; every mismatch is in `FIXES.md`.

| Flow | Result | Notes |
|---|---|---|
| 1 Record / upload → handout | **works with fallback** | Paste transcript (`cs-f212-2026-09-22-transactions.md`): ready in **39.7 s**, 3 sections, Coverage missed Two-phase locking + Deadlocks, emphasized quotes at 1:43 and 1:59, the ready message in the class thread with "Worked for 39.7s". Upload `Lecture.mp3` (45.5 MB): upload ~10 s, ready in **300.9 s** end to end (over the 90 s budget). It is a MATH F241 probability lecture, so it gets "couldn't match this lecture to the syllabus", with no coverage and 6 sentence-topic actions (FIXES #22, #23). Record: the Browser pane blocks the microphone ("Permission denied", FIXES #19). The same code path (MediaRecorder → webm → multipart `source=recording` → markers → process) passed with a virtual mic: a 100 s cut of the CMU 15-445 stage clip fed into `getUserMedia`, ready in 46.3 s. A real-mic check is still needed on the demo laptop |
