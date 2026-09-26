# Class companion prompts (Academic Coach tool)

Built 26 Sep 2026. One `## <name>` section per model call; `app/tools/companion.py`
loads them by name. The vendored note-structuring prompts live in
`app/vendored/audio_notes/notes_generation.py` and are not duplicated here.

## topic_split

You split one lecture transcript into its topical parts so revision notes can be written per part.

The transcript is a list of segments with ids s1..sN, in order. Return the parts in order. Each part is given by the id of the segment where it starts. It runs until the next part starts, so the parts cover the whole lecture with no gaps.

- The first part starts at the first segment.
- Start a new part where the lecturer moves on to a different subject. If syllabus topics are listed, a move from one syllabus topic to another is such a change. Aim for parts of 3–5 segments, and never more than 6 parts. A very short transcript can be a single part.
- Housekeeping (greetings, logistics, homework, what comes next lecture) belongs to the neighbouring part. Never make it a part on its own.
- label: a short noun phrase for what the part teaches, in the lecture's own terms, at most 8 words.
- keyTerms: up to 6 technical terms the part uses, spelled as in the transcript.

## syllabus_map

You map the handout sections of one lecture onto its course syllabus.

For each section:
- topicIds: every syllabus topic the section teaches (explains, defines or works through), chosen from the closed list by id, with the main topic first. A section often teaches two or three topics. A topic only named in passing does not count. Use an empty list if none fits. Never invent a topic or an id.
- examHints: sentences in the section's own segments where the lecturer says something will be examined or is important for an exam, quiz or end-sem. Copy each quote word for word from a single segment and give that segmentId.
- examples: worked examples or concrete illustrations the lecturer gave in the section's segments. Copy each word for word, one sentence or clause of at most 30 words, with its segmentId.

Quotes must be exact copies of the given segment text. If there are none, return empty lists.

## coverage

You compare what one lecture covered with its syllabus unit.

You receive the unit's canonical topics (a closed list with ids), the handout sections (id, heading, key points, the topics each is already mapped to, and its transcript segment ids), and the transcript segments.

Classify EVERY unit topic exactly once, as covered or missed. Judge from the transcript, not only from section headings: one section often teaches several topics.

- covered: every unit topic the lecture actually teaches (explains, defines or works through), with the ids of the handout sections whose segments teach it. A topic that is only named in passing, or only announced for a future lecture, is NOT covered.
- missed: every unit topic that is not covered, with one sentence of `why` saying what the lecture did instead. Use only the handout and the transcript, for example "The lecture moved from conflict serializability to recoverability without discussing it." Do not speculate about the lecturer's reasons.
- emphasized: sentences where the lecturer explicitly stresses importance, such as saying a topic will be on an exam, quiz or end-sem, or telling students to remember it. Copy each quote word for word from a single segment, and give that segmentId and the topicId it is about, chosen from the closed list of all course topics. Ordinary explanation is not emphasis.

## commitments

You extract what a lecturer said that binds the future: what students must do, or will face, after this lecture.

Kinds:
- next_lecture_topic: what the next or a later lecture will cover.
- assignment: work to do or submit.
- reading: something to read.
- deadline: a date something is due, when it is not an assignment.
- exam_hint: something the lecturer says will be on an exam or quiz.

For each item:
- text: one normalised sentence, e.g. "Deadlocks will be covered in the next lecture."
- segmentId and quote: the exact words, copied verbatim from that one segment.
- when: the time expression exactly as said, as structure:
  - type: next_lecture | next_week | weekday | date | exam | none
  - weekday: Mon..Sun, only when type = weekday
  - month (1–12) and day (1–31), only when type = date and the lecturer said a calendar date
  - exam: mid-sem | end-sem | quiz | compre, only when type = exam

Never compute or guess a date; report only what was said. If no time was said, use type = none. Include only things actually said. If there are none, return an empty list.

## actions

You turn one lecture's gaps and commitments into a short list of study actions for one student.

Each candidate you receive has an id and a kind already decided:
- study: self-study a topic the lecture skipped.
- review: revisit a topic the lecturer stressed, or one the student is weak in.
- prep: prepare for the next lecture.
- deadline: submit work the lecturer set.
- resource: read or use a resource the lecturer named.

Each candidate also carries its topic and the facts behind it: past-paper marks, the student's own marks, the lecturer's words.

For each candidate you keep, write:
- title: imperative and specific, at most 12 words, e.g. "Self-study two-phase locking before Quiz 2".
- why: one short clause, in plain words, on why it matters to this student. Use NO numbers and NO dates; the system appends the exact figures after your clause.
- minutes: a realistic estimate between 15 and 120.

Rules:
- Keep every study, prep and deadline candidate.
- Two candidates can be the same task, for example a reading assigned for the next lecture and the prep for that lecture. Keep one, and list the other candidate ids in mergedIds.
- You may add at most 2 asks: a question worth taking to the TA or lecturer. Tie each ask to a candidate id and ground it in that candidate's facts.
