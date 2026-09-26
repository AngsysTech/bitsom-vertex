// MOCK ONLY — canned Class Companion output for the three dataset lectures (CS F212, CS F372, CS F303).
// The real pipeline (backend/app/tools/companion.py) builds all of this from the transcript with verified
// quotes; here the handouts are hand-written from the transcripts and every quote is checked verbatim
// against the segments at build time, so the mock can't show a quote that isn't in the lecture.
// Actions are computed per student from marks × past papers × exam calendar, like the backend.
import type {
  ActionItem,
  CoverageCard,
  Handout,
  HandoutSection,
  LectureCommitment,
  StuckMarker,
  TranscriptSegment,
} from '@/types'
import { EXAMS, TIMETABLE, normTopic, syllabus, topicByTitle, topicWeight, weightFact, type DStudent } from './dataset'

// ---------------------------------------------------------------------------
// Transcript → ~40-word segments with synthetic timestamps (the backend's text path does the same)

const WPS = 2.5 // 150 words per minute

export function segment(text: string, durationSec?: number): TranscriptSegment[] {
  const out: { text: string; words: number }[] = []
  for (const para of text.split(/\n\s*\n/)) {
    const sentences = para.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean)
    let cur: string[] = []
    let words = 0
    for (const s of sentences) {
      cur.push(s)
      words += s.split(' ').length
      if (words >= 40) {
        out.push({ text: cur.join(' '), words })
        cur = []
        words = 0
      }
    }
    if (cur.length) out.push({ text: cur.join(' '), words })
  }
  const total = out.reduce((n, s) => n + s.words, 0) / WPS
  const k = durationSec && durationSec > 0 ? durationSec / total : 1
  let t = 0
  return out.map((s, i) => {
    const start = t
    t += (s.words / WPS) * k
    return { id: `s${i + 1}`, startSec: Math.round(start * 10) / 10, endSec: Math.round(t * 10) / 10, text: s.text }
  })
}

// ---------------------------------------------------------------------------
// Canned lecture content

interface CannedSection {
  from: string // phrase that opens this section in the transcript
  heading: string
  topic?: string // syllabus topic title
  keyPoints: string[]
  definitions?: { term: string; definition: string }[]
  examples?: string[]
  examHints?: string[] // must be verbatim sentences from the transcript
}

interface Canned {
  courseCode: string
  unit: string
  title: string
  summary: string
  sections: CannedSection[]
  missed: { topic: string; why: string }[]
  emphasized: { topic: string; quote: string }[]
  commitments: { kind: LectureCommitment['kind']; text: string; quote: string; topic: string; due?: 'next_session' }[]
}

const CANNED: Canned[] = [
  {
    courseCode: 'CS F212',
    unit: 'Unit 3: Transactions and concurrency',
    title: 'Transactions, serializability and locking',
    summary:
      'Why a database needs transaction guarantees, starting from two students paying the same invoice at once. ACID properties, then serial versus concurrent schedules and when an interleaving is equivalent to a serial order. Conflict serializability via precedence graphs, flagged for the end-sem. The lecture closed on the basic lock model; deadlocks come next week.',
    sections: [
      {
        from: 'Okay so today we are staying with transactions',
        heading: 'Why transactions need guarantees: ACID',
        topic: 'ACID properties',
        keyPoints: [
          'Atomicity: a transaction is all or nothing.',
          'Consistency: it takes the database from one valid state to another, assuming the transaction logic is correct.',
          'Isolation: concurrent work behaves as if transactions were separated appropriately.',
          'Durability: once a commit is acknowledged, a crash should not erase it.',
        ],
        definitions: [
          { term: 'Atomicity', definition: 'All or nothing — no half-applied transaction survives.' },
          { term: 'Durability', definition: 'An acknowledged commit survives a crash.' },
        ],
        examples: ['Two students paying the same fee invoice at nearly the same moment: half of each update surviving leaves numbers that look valid but a wrong state.'],
      },
      {
        from: 'Now, student question',
        heading: 'Schedules: serial versus concurrent',
        topic: 'Transactions and concurrency',
        keyPoints: [
          'Isolation does not mean one user at a time — that would be safe but useless.',
          'A serial schedule runs one transaction completely, then the next; a concurrent schedule interleaves operations.',
          'What matters is whether a concurrent schedule is equivalent to some serial order.',
        ],
        definitions: [{ term: 'Schedule', definition: 'An ordering of the operations of several transactions.' }],
      },
      {
        from: 'That takes us to Serializability',
        heading: 'Conflict serializability and precedence graphs',
        topic: 'Serializability',
        keyPoints: [
          'Conflicting operations touch the same item and at least one of them is a write.',
          'Draw a precedence graph: one node per transaction, an edge for each conflicting pair in the order they happen.',
          'A cycle means the schedule is not conflict serializable; no cycle means a topological order gives an equivalent serial order.',
        ],
        definitions: [{ term: 'Precedence graph', definition: 'Transactions as nodes; directed edges from the order of conflicting operations.' }],
        examples: ['Practise drawing the graph from a schedule — that is where people lose marks.'],
        examHints: ["This part on serializability will definitely be on the end-sem, I'm telling you now."],
      },
      {
        from: 'Let me do the lock intuition',
        heading: 'Locking basics: shared and exclusive locks',
        topic: 'Locking basics',
        keyPoints: [
          'A shared lock lets compatible readers in together; an exclusive lock protects a write from competing reads or writes.',
          'The lock manager tracks who holds what; a transaction that can’t get a lock waits.',
          'Locks are only a mechanism — the protocol for acquiring and releasing them decides the guarantee.',
        ],
        definitions: [
          { term: 'Shared lock', definition: 'Permits compatible readers at the same time.' },
          { term: 'Exclusive lock', definition: 'Protects a write from competing reads or writes.' },
        ],
        examples: ['Read, write, conflict, wait, proceed — the basic mental model for today.'],
      },
      {
        from: 'Also, notice the connection between isolation and anomalies',
        heading: 'Isolation anomalies',
        topic: 'Transactions and concurrency',
        keyPoints: [
          'Reading data another transaction is halfway through changing exposes a state the application never intended.',
          'Overwriting a value based on a stale read can make one update disappear.',
          'For an anomaly question, translate it back to which operations were allowed to interleave.',
        ],
        examples: ['After class: take one schedule with three transactions and draw its precedence graph; label each edge with its conflicting pair.'],
      },
    ],
    missed: [{ topic: 'Two-phase locking', why: 'Listed in Unit 3 right after locking basics; the lecture stopped at the basic lock model and never named the two-phase protocol' }],
    emphasized: [{ topic: 'Serializability', quote: "This part on serializability will definitely be on the end-sem, I'm telling you now." }],
    commitments: [
      { kind: 'next_lecture_topic', text: 'Deadlocks will be covered next week', quote: "we'll come back to deadlocks next week.", topic: 'Deadlocks', due: 'next_session' },
      { kind: 'assignment', text: 'After class: draw the precedence graph for one three-transaction schedule', quote: 'For now, after class, take one schedule with three transactions and try the precedence graph yourself.', topic: 'Serializability' },
      { kind: 'exam_hint', text: 'Serializability will be on the end-sem', quote: "This part on serializability will definitely be on the end-sem, I'm telling you now.", topic: 'Serializability' },
    ],
  },
  {
    courseCode: 'CS F372',
    unit: 'Unit 2: CPU scheduling',
    title: 'CPU scheduling: FCFS, SJF and Round Robin',
    summary:
      'What the scheduler chooses and the measures it is judged by. FCFS and the convoy effect, Shortest Job First and why it needs burst estimates, then preemptive Round Robin and the quantum trade-off, with a Gantt-chart question promised for the end-sem. Closed on waiting vs turnaround vs response time; richer schedulers come next class.',
    sections: [
      {
        from: 'Okay so today is CPU scheduling',
        heading: 'What the scheduler optimises',
        topic: 'CPU scheduling',
        keyPoints: ['When several ready processes could run, the OS chooses which runs next.', 'Measures: waiting time, turnaround time and response time.', 'The best policy depends on the workload and the system goal.'],
      },
      {
        from: 'First, FCFS scheduling',
        heading: 'FCFS and the convoy effect',
        topic: 'FCFS scheduling',
        keyPoints: ['Processes run in arrival order, from a simple queue.', 'A long CPU-bound job arriving first makes short jobs wait behind it — the convoy effect.', 'Fair by arrival order is not automatically good performance.'],
        definitions: [{ term: 'Convoy effect', definition: 'Short processes stuck waiting behind one long process.' }],
      },
      {
        from: 'Now Shortest Job First',
        heading: 'Shortest Job First',
        topic: 'Shortest Job First',
        keyPoints: ['Picking the shortest available burst minimises average waiting time for that set of jobs.', 'Real systems don’t know the next burst — they estimate it from past behaviour.', 'On ties, use the rule in the question; otherwise arrival order, and state the assumption.'],
      },
      {
        from: 'Then Round Robin',
        heading: 'Round Robin and the Gantt-chart workflow',
        topic: 'Round Robin',
        keyPoints: [
          'Round Robin is preemptive: each ready process gets up to one time quantum, then unfinished work goes to the back of the ready queue.',
          'A tiny quantum improves responsiveness but adds context-switch overhead; a huge quantum behaves like FCFS.',
          'On the Gantt chart, update the ready queue after every arrival and every quantum expiry.',
        ],
        definitions: [{ term: 'Time quantum', definition: 'The longest slice a process runs before it is preempted.' }],
        examples: ['Table of arrival and burst times → mark the clock → pick by the rule → draw the interval → update remaining burst and arrivals → repeat.'],
        examHints: ['Expect a Gantt-chart question on Round Robin in the end-sem.'],
      },
      {
        from: 'Why do operating systems keep several policies',
        heading: 'Waiting, turnaround and response time',
        topic: 'CPU scheduling',
        keyPoints: ['Turnaround = completion − arrival.', 'Waiting = turnaround − CPU service time (in the simple model).', 'Response = arrival until first CPU service. Three different numbers.'],
        examples: ['Practice: four processes with staggered arrivals under FCFS, SJF and Round Robin; if answers look too similar, check Round Robin is preemptive.'],
      },
    ],
    missed: [{ topic: 'Multilevel feedback queues', why: 'Listed in Unit 2 after Round Robin; the lecture stopped at the baseline policies and left richer schedulers for next class' }],
    emphasized: [{ topic: 'Round Robin', quote: 'Expect a Gantt-chart question on Round Robin in the end-sem.' }],
    commitments: [
      {
        kind: 'next_lecture_topic',
        text: 'Richer scheduler behaviour and responsiveness next class',
        quote: 'Next class we will move from these baseline policies toward richer scheduler behavior and then connect scheduling to responsiveness in interactive systems.',
        topic: 'Multilevel feedback queues',
        due: 'next_session',
      },
      { kind: 'assignment', text: 'Compare FCFS, SJF and Round Robin on four processes', quote: 'For practice, take four processes with staggered arrivals and compare FCFS, Shortest Job First and Round Robin.', topic: 'Round Robin' },
      { kind: 'exam_hint', text: 'A Round Robin Gantt chart will be on the end-sem', quote: 'Expect a Gantt-chart question on Round Robin in the end-sem.', topic: 'Round Robin' },
    ],
  },
  {
    courseCode: 'CS F303',
    unit: 'Unit 2: Transport layer',
    title: 'TCP: handshake, flow control and UDP',
    summary:
      'What TCP gives an application over a network that loses, delays and reorders packets. The three-way handshake step by step — a question on it every year — then flow control through the advertised receive window with a worked byte example. UDP as a different contract, not a worse TCP. How TCP adapts to network conditions comes next time.',
    sections: [
      {
        from: 'Okay so today we are on the Transport layer',
        heading: 'What TCP gives the application',
        keyPoints: ['The network can lose, delay, duplicate or reorder packets.', 'TCP provides a reliable byte stream.', 'It uses sequence numbers, acknowledgements, retransmission and connection state at both ends.'],
      },
      {
        from: 'We start with the TCP three-way handshake',
        heading: 'The three-way handshake',
        topic: 'TCP three-way handshake',
        keyPoints: [
          'The client sends SYN with its initial sequence number.',
          'The server replies SYN-ACK: it acknowledges the client and sends its own initial sequence number.',
          'The client’s final ACK confirms it received the server’s sequence number; both sides are now in sync.',
        ],
        examples: ['Draw client and server as two vertical lifelines; label SYN, SYN-ACK and ACK with sequence and acknowledgement values.'],
        examHints: ['I always ask one question on the three-way handshake.'],
      },
      {
        from: 'Now flow control',
        heading: 'Flow control and the receive window',
        topic: 'Flow control',
        keyPoints: [
          'Flow control protects the receiver from a sender that transmits faster than the receiving application consumes.',
          'The receiver advertises a window; the sender limits unacknowledged data to it.',
          'With a 4,000-byte window and 1,500 bytes unacknowledged, 2,500 more bytes can be sent.',
        ],
        definitions: [{ term: 'Receive window', definition: 'How much more data the receiver can currently accept.' }],
      },
      {
        from: 'Another student question: is UDP just bad TCP?',
        heading: 'UDP is a different contract',
        topic: 'UDP',
        keyPoints: ['UDP does not set up a reliable byte stream.', 'Lower overhead suits applications that tolerate loss or value timeliness.', 'Protocol choice follows application needs.'],
      },
      {
        from: 'For the exam, be able to explain the handshake',
        heading: 'Exam focus and practice',
        topic: 'TCP three-way handshake',
        keyPoints: ['Explain the handshake as a sequence.', 'Reason about a small receiver-window example.', 'Connect the transport service back to what the application needs.'],
        examples: ['Before next class: redraw the handshake without notes and explain each message aloud.'],
      },
    ],
    missed: [{ topic: 'Congestion control', why: 'Listed in Unit 2; the lecture deferred how TCP adapts its sending behaviour to next time' }],
    emphasized: [{ topic: 'TCP three-way handshake', quote: 'I always ask one question on the three-way handshake.' }],
    commitments: [
      { kind: 'next_lecture_topic', text: 'How TCP adapts to changing network conditions, next time', quote: 'Next time we will continue with how TCP adapts its sending behavior under changing network conditions.', topic: 'Congestion control', due: 'next_session' },
      { kind: 'assignment', text: 'Redraw the handshake from memory and explain each message aloud', quote: 'Okay so before next class, redraw the handshake without looking at your notes, then explain each message aloud.', topic: 'TCP three-way handshake', due: 'next_session' },
      { kind: 'exam_hint', text: 'One question on the three-way handshake', quote: 'I always ask one question on the three-way handshake.', topic: 'TCP three-way handshake' },
    ],
  },
]

export const cannedFor = (courseCode: string) => CANNED.find((c) => c.courseCode === courseCode)
export const MOCK_COURSES = CANNED.map((c) => c.courseCode)

// ---------------------------------------------------------------------------
// Dates: timetable sessions and exams (local time)

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const at = (d: Date, hm: string) => {
  const [h, m] = hm.split(':').map(Number) as [number, number]
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m)
}

export interface Session {
  courseCode: string
  start: Date
  end: Date
  room: string
  kind: string
}

export function sessionsBetween(from: Date, to: Date, courses?: string[]): Session[] {
  const out: Session[] = []
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  while (day < to) {
    for (const r of TIMETABLE)
      if (DAYS.indexOf(r.day.toLowerCase()) === day.getDay() && (!courses || courses.includes(r.courseCode))) {
        const s = { courseCode: r.courseCode, start: at(day, r.start), end: at(day, r.end), room: r.room, kind: r.kind }
        if (s.start >= from && s.start < to) out.push(s)
      }
    day.setDate(day.getDate() + 1)
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

export const nextSession = (courseCode: string, after: Date, lectureOnly = false) =>
  sessionsBetween(after, new Date(after.getTime() + 21 * 86_400_000), [courseCode]).find((s) => !lectureOnly || s.kind === 'lecture')

export function nextExam(courseCode: string, after: Date) {
  const day = `${after.getFullYear()}-${String(after.getMonth() + 1).padStart(2, '0')}-${String(after.getDate()).padStart(2, '0')}`
  return EXAMS.find((e) => e.courseCode === courseCode && e.date > day)
}

const iso = (d: Date) => {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${p(off / 60)}:${p(off % 60)}`
}
export { iso as isoLocal }

// ---------------------------------------------------------------------------
// Build: transcript → handout → coverage → commitments → actions

export interface Built {
  segments: TranscriptSegment[]
  handout: Handout
  coverage: CoverageCard
  commitments: LectureCommitment[]
  actions: ActionItem[]
  markers: StuckMarker[]
}

let seq = 0
const uid = (p: string) => `${p}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`

function segmentOf(segments: TranscriptSegment[], quote: string) {
  const s = segments.find((x) => x.text.includes(quote))
  if (!s) throw new Error(`Mock companion: quote not verbatim in any segment: “${quote}”`)
  return s
}

/** Marker → segment covering atSec → handout section holding that segment → its syllabus topic. */
export function resolveMarker(m: StuckMarker, segments: TranscriptSegment[], sections: HandoutSection[]): StuckMarker {
  const seg = segments.find((s) => m.atSec >= s.startSec && m.atSec < s.endSec) ?? segments.at(-1)
  const sec = seg && sections.find((x) => x.segmentIds.includes(seg.id))
  return { ...m, segmentId: seg?.id, handoutSectionId: sec?.id, topic: sec ? (sec.syllabusTopic ?? sec.heading) : undefined }
}

export function build(opts: {
  lectureId: string
  courseCode: string
  lectureDate: Date
  transcriptText: string
  durationSec?: number
  markers: StuckMarker[]
  student: DStudent
  now: Date
  prior?: { handoutId: string; sectionIds: string[]; actionIds: Map<string, string>; statuses: Map<string, ActionItem> }
}): Built {
  const c = cannedFor(opts.courseCode)
  if (!c) throw new Error(`no sample lecture for ${opts.courseCode}`)
  const segments = segment(opts.transcriptText, opts.durationSec)

  // Handout: sections own contiguous segment ranges, starting at their opening phrase.
  const starts = c.sections.map((s) => segments.findIndex((x) => x.text.startsWith(s.from) || x.text.includes(s.from)))
  const sections: HandoutSection[] = c.sections.map((s, i) => {
    const from = starts[i]!
    const to = starts.slice(i + 1).find((n) => n > from) ?? segments.length
    if (from < 0) throw new Error(`Mock companion: section start not found: “${s.from}”`)
    const t = s.topic ? topicByTitle(opts.courseCode, s.topic) : undefined
    for (const h of s.examHints ?? []) segmentOf(segments, h)
    return {
      id: opts.prior?.sectionIds[i] ?? `h${i + 1}`,
      heading: s.heading,
      keyPoints: s.keyPoints,
      definitions: s.definitions ?? [],
      examples: s.examples ?? [],
      examHints: s.examHints ?? [],
      segmentIds: segments.slice(from, to).map((x) => x.id),
      syllabusTopic: t?.title,
      syllabusSectionId: t?.id,
    }
  })

  const markers = opts.markers.map((m) => resolveMarker(m, segments, sections))
  for (const m of markers) {
    const sec = sections.find((s) => s.id === m.handoutSectionId)
    if (!sec) continue
    sec.stuck ??= { markerIds: [], atSec: [] }
    sec.stuck.markerIds.push(m.id)
    sec.stuck.atSec.push(m.atSec)
  }

  const handout: Handout = {
    id: opts.prior?.handoutId ?? uid('ho'),
    lectureId: opts.lectureId,
    courseCode: opts.courseCode,
    title: c.title,
    summary: c.summary,
    sections,
    createdAt: new Date().toISOString(),
  }

  const coverage: CoverageCard = {
    type: 'coverage',
    lectureId: opts.lectureId,
    courseCode: opts.courseCode,
    unit: c.unit,
    covered: [...new Set(sections.flatMap((s) => (s.syllabusTopic ? [s.syllabusTopic] : [])))].map((topic) => ({
      topic,
      handoutSectionIds: sections.filter((s) => s.syllabusTopic === topic).map((s) => s.id),
    })),
    missed: c.missed.flatMap((m) => {
      const t = topicByTitle(opts.courseCode, m.topic)
      return t ? [{ topic: t.title, syllabusSectionId: t.id, why: m.why }] : []
    }),
    emphasized: c.emphasized.map((e) => ({ topic: e.topic, segmentId: segmentOf(segments, e.quote).id, quote: e.quote })),
    confusion: markers.flatMap((m) =>
      m.handoutSectionId ? [{ topic: m.topic ?? '', markerId: m.id, atSec: m.atSec, handoutSectionId: m.handoutSectionId, ...(m.note ? { note: m.note } : {}) }] : [],
    ),
  }

  // When the lecture happened: its timetable session that day, else (a recording on a non-class day) the time
  // it was processed, capped to that day. "Next class" is the first lecture after both that and now.
  const day0 = new Date(opts.lectureDate.getFullYear(), opts.lectureDate.getMonth(), opts.lectureDate.getDate())
  const day1 = new Date(day0.getTime() + 86_400_000)
  const lectureAt = sessionsBetween(day0, day1, [opts.courseCode])[0]?.start ?? new Date(Math.min(Math.max(opts.now.getTime(), day0.getTime()), day1.getTime() - 60_000))
  const after = new Date(Math.max(lectureAt.getTime() + 60_000, opts.now.getTime()))
  const session = nextSession(opts.courseCode, after, true)
  const exam = nextExam(opts.courseCode, opts.now)
  const commitments: LectureCommitment[] = c.commitments.map((cm, i) => ({
    id: `cm_${opts.lectureId}_${i + 1}`,
    lectureId: opts.lectureId,
    kind: cm.kind,
    text: cm.text,
    ...(cm.due === 'next_session' && session ? { dueBy: iso(session.start) } : cm.kind === 'exam_hint' ? { dueBy: EXAMS.find((e) => e.courseCode === opts.courseCode && e.component === 'End-sem')?.date } : {}),
    segmentId: segmentOf(segments, cm.quote).id,
    quote: cm.quote,
  }))

  // Actions: code decides kinds, dates and marks (as in tools/companion.py); titles are templates here.
  const marksFact = (topic: string) => {
    const w = topicWeight(opts.courseCode, topic)
    if (w) return weightFact(w)
    const t = topicByTitle(opts.courseCode, topic)
    const unitTopic = t && topicByTitle(opts.courseCode, t.unitTitle.replace(/^Unit \d+:\s*/, ''))
    const uw = unitTopic && topicWeight(opts.courseCode, unitTopic.title)
    return uw ? `part of ${unitTopic.title}, which ${weightFact(uw)}` : undefined
  }
  const pastPaperId = (topic: string) => topicWeight(opts.courseCode, topic)?.sectionId
  const score = (topic: string) => {
    const rows = opts.student.internalMarks.rows.filter((r) => r.courseCode === opts.courseCode && r.topic && normTopic(r.topic) === normTopic(topic))
    if (!rows.length) return undefined
    const scored = rows.reduce((n, r) => n + r.scored, 0)
    const max = rows.reduce((n, r) => n + r.max, 0)
    return { scored, max, pct: scored / max }
  }
  const examDue = exam?.date
  const examLabel = exam ? `before ${exam.title.replace(`${opts.courseCode} `, '')} on ${new Date(exam.date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''
  const items: ActionItem[] = []
  const seen = new Set<string>()
  const add = (a: Omit<ActionItem, 'id' | 'lectureId' | 'course' | 'status'>, key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    const prev = opts.prior?.actionIds.get(key)
    const kept = prev ? opts.prior?.statuses.get(prev) : undefined
    items.push({
      id: prev ?? uid('act'),
      lectureId: opts.lectureId,
      course: opts.courseCode,
      status: kept?.status ?? 'proposed',
      ...(kept?.planBlockId ? { planBlockId: kept.planBlockId } : {}),
      ...(kept?.calendarItemId ? { calendarItemId: kept.calendarItemId } : {}),
      ...a,
    })
  }
  const why = (...parts: (string | undefined)[]) => parts.filter(Boolean).join('; ')

  for (const cm of c.commitments.filter((x) => x.kind === 'next_lecture_topic' || (x.kind === 'assignment' && x.due))) {
    const commit = commitments.find((x) => x.quote === cm.quote)!
    if (!commit.dueBy) continue
    const t = topicByTitle(opts.courseCode, cm.topic)
    const dt = new Date(commit.dueBy)
    add(
      {
        kind: 'prep',
        title: cm.kind === 'assignment' ? cm.text : `Read ahead on ${cm.topic} before the next class`,
        topic: t?.title ?? cm.topic,
        minutes: 30,
        dueBy: commit.dueBy,
        why: why(`Lecturer said: "${cm.quote}"`, `next ${opts.courseCode} lecture: ${dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`),
        provenance: { segmentId: commit.segmentId, commitmentId: commit.id, ...(t ? { syllabusSectionId: t.id } : {}) },
      },
      `prep:${cm.quote}`,
    )
  }
  for (const m of coverage.missed)
    add(
      {
        kind: 'study',
        title: `Self-study: ${m.topic} (skipped in lecture)`,
        topic: m.topic,
        minutes: 45,
        dueBy: examDue,
        why: why('Skipped in class', marksFact(m.topic), examLabel),
        provenance: { syllabusSectionId: m.syllabusSectionId, ...(pastPaperId(m.topic) ? { pastPapersCitationId: pastPaperId(m.topic) } : {}) },
      },
      `study:${m.topic}`,
    )
  for (const e of coverage.emphasized) {
    const t = topicByTitle(opts.courseCode, e.topic)
    add(
      {
        kind: 'review',
        title: `Practise ${e.topic} — the lecturer flagged it for the end-sem`,
        topic: e.topic,
        minutes: 30,
        dueBy: examDue,
        why: why(`Lecturer said: "${e.quote}"`, marksFact(e.topic)),
        provenance: { segmentId: e.segmentId, ...(t ? { syllabusSectionId: t.id } : {}), ...(pastPaperId(e.topic) ? { pastPapersCitationId: pastPaperId(e.topic) } : {}) },
      },
      `review:${e.topic}`,
    )
  }
  for (const m of coverage.confusion) {
    const sec = sections.find((s) => s.id === m.handoutSectionId)
    add(
      {
        kind: 'review',
        title: `Revisit ${m.topic} — you flagged it at ${fmtMMSS(m.atSec)}`,
        topic: m.topic,
        minutes: 25,
        dueBy: session ? iso(session.start) : examDue,
        why: why(`You tapped "I'm stuck" at ${fmtMMSS(m.atSec)}${m.note ? ` ("${m.note}")` : ''}`, marksFact(m.topic)),
        provenance: { markerId: m.markerId, segmentId: markers.find((x) => x.id === m.markerId)?.segmentId, ...(sec?.syllabusSectionId ? { syllabusSectionId: sec.syllabusSectionId } : {}) },
      },
      `stuck:${m.markerId}`,
    )
  }
  // The student's own weak spots: covered topics they're weak on, then the weakest high-weight topics.
  const weak = (syllabusTopics: string[]) =>
    syllabusTopics
      .map((topic) => ({ topic, s: score(topic), w: topicWeight(opts.courseCode, topic) }))
      .filter((x) => x.s && x.s.pct <= 0.5 && x.w)
      .sort((a, b) => (1 - b.s!.pct) * b.w!.mean - (1 - a.s!.pct) * a.w!.mean)
  const coveredTopics = coverage.covered.map((x) => x.topic)
  for (const x of weak([...new Set([...coveredTopics, ...weightedTopics(opts.courseCode)])]).slice(0, 3)) {
    const t = topicByTitle(opts.courseCode, x.topic)
    add(
      {
        kind: 'review',
        title: `Review ${x.topic} (${x.s!.scored}/${x.s!.max} in internal marks)`,
        topic: x.topic,
        minutes: 45,
        dueBy: examDue,
        why: why(coveredTopics.includes(x.topic) ? 'Covered in this lecture; you are weak on it' : 'Weak in your internal marks (not from this lecture)', `scored ${x.s!.scored}/${x.s!.max}`, weightFact(x.w!)),
        provenance: { ...(t ? { syllabusSectionId: t.id } : {}), pastPapersCitationId: x.w!.sectionId },
      },
      `weak:${x.topic}`,
    )
  }
  const rank: Record<ActionItem['kind'], number> = { prep: 0, deadline: 1, study: 2, review: 3, resource: 4, ask: 5 }
  items.sort((a, b) => (a.dueBy ?? '9999').localeCompare(b.dueBy ?? '9999') || rank[a.kind] - rank[b.kind])
  return { segments, handout, coverage, commitments, actions: items, markers }
}

/** Every syllabus topic of the course that has past-paper marks (weak-topic candidates). */
const weightedTopics = (courseCode: string) => syllabus(courseCode)?.topics.map((t) => t.title).filter((t) => topicWeight(courseCode, t)) ?? []

export const fmtMMSS = (sec: number) => {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Make it Relevant — canned reframes, keyed by handout section heading (one line per key point shown as
// the standard, same facts). Anything else gets an honest "(mock) not canned" line.

const REFRAMES: Record<string, Record<string, string[]>> = {
  'why transactions need guarantees acid': {
    badminton: [
      'Atomicity: a rally counts only when it finishes — the point is awarded or replayed, never half-given.',
      'Consistency: every rally takes the score from one legal state to another, as long as the umpire applies the rules correctly.',
      'Isolation: two courts playing at once never mix up each other’s scores.',
    ],
    cricket: [
      'Atomicity: a run either completes or it doesn’t — the scorer never records half a run.',
      'Consistency: every ball takes the scorecard from one valid total to another, if the scorer follows the laws.',
      'Isolation: two matches on neighbouring grounds never leak into each other’s scorecards.',
    ],
    music: [
      'Atomicity: a take is kept whole or scrapped — no half-recorded take ends up on the album.',
      'Consistency: each take leaves the track playable, assuming the arrangement itself is right.',
      'Isolation: two bands recording in different studios don’t bleed into each other’s tracks.',
    ],
    football: [
      'Atomicity: a goal either stands or is disallowed — never half-counted.',
      'Consistency: every decision leaves a valid scoreline, assuming the referee applies the laws correctly.',
      'Isolation: two matches kicking off at the same time don’t change each other’s scorelines.',
    ],
  },
  'schedules serial versus concurrent': {
    badminton: [
      'Sharing a hall doesn’t mean one match at a time — that’s fair but wastes the courts.',
      'Serial: one match plays to the end, then the next; concurrent: games on different courts overlap.',
      'What matters is that the results come out as if the matches had been played one after another.',
    ],
    cricket: [
      'Sharing the nets doesn’t mean one batter at a time — safe, but slow.',
      'Serial: one batter finishes their session, then the next; concurrent: sessions overlap across lanes.',
      'What matters is that the day ends as if the batters had gone one after another in some order.',
    ],
    music: [
      'Sharing a studio doesn’t mean one musician at a time — safe, but nothing gets recorded.',
      'Serial: one part is recorded start to finish, then the next; concurrent: parts go down in overlapping sessions.',
      'What matters is that the mix sounds as if the parts had been recorded one after another.',
    ],
    football: [
      'Sharing the pitch doesn’t mean one drill at a time — safe, but useless.',
      'Serial: one drill runs to the end, then the next; concurrent: drills overlap on different halves.',
      'What matters is that training ends as if the drills had run one after another in some order.',
    ],
  },
  'isolation anomalies': {
    badminton: [
      'Reading the scoreboard while the umpire is mid-update shows a score that never really existed.',
      'Updating the score from an old reading can wipe out a point someone else just added.',
      'When a score goes wrong, ask which updates were allowed to overlap.',
    ],
    cricket: [
      'Reading the scoreboard while the scorer is mid-update shows a total that never existed.',
      'Adding runs to a stale total can make someone else’s boundary disappear.',
      'When the scorecard is wrong, ask which updates were allowed to overlap.',
    ],
    music: [
      'Listening to a track while it’s being re-edited gives you a version nobody meant to release.',
      'Saving over the mix from an old copy can erase another producer’s change.',
      'When the mix is wrong, ask which edits were allowed to overlap.',
    ],
    football: [
      'Reading the table mid-update shows standings that never existed.',
      'Updating points from an old table can make another result vanish.',
      'When the table is wrong, ask which updates were allowed to overlap.',
    ],
  },
  'what the scheduler optimises': {
    badminton: [
      'One court, several players ready: someone has to pick who plays next.',
      'You judge the pick by how long players wait, how long until they finish, and how soon they first get on court.',
      'The best rota depends on who is playing and what the session is for.',
    ],
    music: [
      'One stage, several acts ready: the stage manager picks who plays next.',
      'You judge the running order by waiting time, time until each act finishes, and how soon each act first goes on.',
      'The best order depends on the lineup and what the night is for.',
    ],
    coffee: [
      'One espresso machine, several orders ready: the barista picks which to make next.',
      'You judge that by how long customers wait, how long until each order is done, and how soon they first get something.',
      'The best order depends on the queue and what the café is optimising for.',
    ],
    cricket: [
      'One set of nets, several batters padded up: the coach picks who bats next.',
      'You judge the pick by waiting time, time until each batter is done, and how soon each first gets a hit.',
      'The best rota depends on the squad and the goal of the session.',
    ],
  },
  'locking basics shared and exclusive locks': {
    badminton: [
      'A shared lock is spectators watching a court together — any number can watch; an exclusive lock is a player booking the court, and nobody else steps on while they play.',
      'The lock manager is the court-booking desk: it knows who holds which court, and if yours is taken you wait on the bench.',
      'Booking courts doesn’t make a fair tournament by itself — the rules for when you book and release them decide that.',
    ],
    music: [
      'A shared lock is the whole band reading the same sheet; an exclusive lock is the arranger rewriting a bar — nobody plays from it mid-edit.',
      'The lock manager is the band manager who knows who has which part; if the part you need is being rewritten, you wait.',
      'Holding the sheets doesn’t guarantee a clean performance — the rules for when parts are taken and handed back decide that.',
    ],
    cricket: [
      'A shared lock is the crowd reading the scoreboard together; an exclusive lock is the scorer updating it, so nobody reads a half-changed total.',
      'The lock manager is the scorer’s log of who holds what; if you need something that’s held, you wait for it.',
      'Holding the ball isn’t the same as following the laws — the protocol for taking and releasing locks decides whether the result stands.',
    ],
    football: [
      'A shared lock is fans reading the team sheet together; an exclusive lock is the manager changing the line-up — nobody reads it mid-edit.',
      'The lock manager is the fourth official’s board: it knows who’s on, and a substitute waits until the slot is free.',
      'Having the board doesn’t make a fair match — the rules for when substitutions happen decide that.',
    ],
  },
  'conflict serializability and precedence graphs': {
    badminton: [
      'Two players clash only when they go for the same shuttle and at least one of them actually hits it.',
      'Draw who-hit-before-whom: one circle per player, an arrow for every clash, in the order it happened.',
      'If the arrows loop back round, no fair turn order explains the rally; if there’s no loop, lining players up along the arrows gives one.',
    ],
    cricket: [
      'Two fielders clash only when they go for the same ball and at least one of them actually throws it.',
      'Draw who-had-it-first: one circle per fielder, an arrow for each clash in the order it happened.',
      'A loop in the arrows means no single order explains the play; no loop means reading along the arrows gives a valid order.',
    ],
    'formula 1': [
      'Two cars conflict only when they go for the same corner and at least one of them commits to the move.',
      'Draw who-was-ahead-of-whom: one node per car, an arrow for every contested corner, in the order it happened.',
      'A cycle means no single running order explains the race; no cycle means following the arrows gives a valid order.',
    ],
    football: [
      'Two players conflict only when they challenge for the same ball and at least one of them actually plays it.',
      'Draw who-got-there-first: one circle per player, an arrow for every challenge, in the order it happened.',
      'A loop means no single passing order explains the move; no loop means following the arrows gives a valid order.',
    ],
  },
  'round robin and the gantt chart workflow': {
    coffee: [
      'One espresso machine: each order gets a fixed slice of the barista’s time, then goes back in the queue if it isn’t done.',
      'Very short slices keep every order moving but waste time switching; very long slices become first-come, first-served.',
      'On the order board, re-check the queue every time a new order arrives and every time a slice ends.',
    ],
    badminton: [
      'One court, a queue of players: each gets a fixed number of minutes, then goes to the back of the queue if they’re not done.',
      'Very short turns keep everyone involved but waste time swapping players; very long turns become first-come, first-served.',
      'On the rota sheet, re-check the queue every time someone arrives and every time a turn ends.',
    ],
    music: [
      'A jam session: each player gets a fixed number of bars to solo, then passes it on and waits for their next turn.',
      'Very short solos keep everyone in but the hand-offs eat time; very long solos turn it into one player’s gig.',
      'On the setlist, update who’s next every time someone joins and every time a solo ends.',
    ],
    cricket: [
      'Net practice with one lane: each batter faces a fixed number of balls, then goes to the back of the line if they want more.',
      'Very short turns keep everyone batting but waste time on changeovers; very long turns mean whoever arrived first bats all session.',
      'On the practice sheet, update the line after every new arrival and every finished turn.',
    ],
  },
  'the three way handshake': {
    cooking: [
      'The waiter tells the kitchen “new table, ticket 41” — that’s the SYN.',
      'The kitchen calls back “got 41, we’re on station 3” — acknowledging and giving its own state (SYN-ACK).',
      'The waiter’s “heard” confirms they got the kitchen’s reply; now both sides are in sync (ACK).',
    ],
    cricket: [
      'The striker calls “yes?” and says where they’re starting from — that’s the SYN.',
      'The non-striker answers “yes — and I’m at my crease”, acknowledging the call and giving their own position (SYN-ACK).',
      'The striker’s “go!” confirms they heard the partner’s position; now both are running in sync (ACK).',
    ],
    'formula 1': [
      'The driver radios “box this lap?” with their lap count — the SYN.',
      'The pit wall replies “box confirmed, we’re ready on lap 32” — acknowledging and giving its own state (SYN-ACK).',
      'The driver’s “copy, boxing” confirms they heard the pit wall; both sides are in sync (ACK).',
    ],
  },
  'flow control and the receive window': {
    cooking: [
      'The pass tells the kitchen not to plate faster than the servers can carry dishes out.',
      'The pass calls how many more plates it can hold; the kitchen keeps what’s waiting within that.',
      'Room for 4,000 bytes with 1,500 still unacknowledged is room for 2,500 more.',
    ],
    cricket: [
      'The batter sets the pace: the bowler can’t deliver faster than the batter can take guard.',
      'The batter signals how much more they can take; the bowler keeps what’s still unplayed within that.',
      'Room for 4,000 bytes with 1,500 still unacknowledged is room for 2,500 more — like a batter ready for four overs with one and a half still coming.',
    ],
    'formula 1': [
      'The pit crew tells the team not to send cars in faster than they can service them.',
      'The crew radios how much room the garage has left; the team keeps cars on the way in within that.',
      'Room for 4,000 bytes with 1,500 already on the way in leaves room for 2,500 more.',
    ],
  },
}

export function reframe(sectionHeading: string, interest: string): string[] | undefined {
  return REFRAMES[normTopic(sectionHeading)]?.[interest.toLowerCase()]
}

// ---------------------------------------------------------------------------
// Weekly 1:1 helpers

export const courseOfTopic = (topic: string, courses: string[]) => courses.find((c) => topicByTitle(c, topic))
