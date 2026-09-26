// In-browser mock of the FastAPI backend (MOCK=true). Same endpoints and shapes as contracts.ts.
// Built on the real synthetic dataset (Aarav, Meera, Rohan). Anything a model writes in the real backend
// (handouts, reply text, 1:1 lines, reframes) is canned or templated here — a UI harness, not the product.
// The top bar shows a "Mock data" badge whenever this is in use.
import type {
  ActionItem,
  Agent,
  AgentId,
  CalendarItem,
  Channel,
  Citation,
  ClassChannel,
  Escalation,
  Lecture,
  Message,
  OneOnOne,
  PlanBlock,

  RelevantCard,
  StuckMarker,
  Student,
  StudentState,
  StudyPlanCard,
  Thread,
  Ticket,
  ToolTrace,
  WeakTopic,
  WorkspaceFile,
} from '@/types'
import { ApiError, type Api, type CalendarStatus, type NewLecture, type NewTask } from '../client'
import { build, cannedFor, fmtMMSS, isoLocal, MOCK_COURSES, nextExam, nextSession, reframe, sessionsBetween, type Built } from './companion'
import {
  CONNECTORS,
  course,
  DOCS,
  EXAMS,
  findSection,
  HEAVIEST_MEAN,
  normTopic,
  sampleLecture,
  slug,
  STUDENTS,
  syllabus,
  topicByTitle,
  topicWeight,
  weightFact,
  type DStudent,
} from './dataset'

const clone = <T,>(x: T): T => structuredClone(x)
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DAY = 86_400_000
let seq = 0
const uid = (p: string) => `${p}_${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`
const first = (s: { name: string }) => s.name.split(' ')[0]!
const dayMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const ymd = (d: Date) => isoLocal(d).slice(0, 10)
const dm = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const dowdm = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const mondayOf = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}
const weekLabel = (monday: Date) => `Week of ${monday.toLocaleDateString('en-US', { month: 'short' })} ${monday.getDate()}`
const parse = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00`) : new Date(s))

// ---------------------------------------------------------------------------
// Students, agents, channels

const STUDENT_LIST: Student[] = STUDENTS.map((s) => ({
  id: s.id,
  name: s.name,
  program: s.program,
  semester: s.semester,
  careerGoal: s.careerGoal,
  interests: s.interests,
  avatarEmoji: s.avatarEmoji,
}))

function studentOf(id: string): DStudent {
  const s = STUDENTS.find((x) => x.id === id)
  if (!s) throw new ApiError(`student ${id} not found`, 404)
  return s
}
const registered = (s: DStudent) => s.registrations.rows.filter((r) => r.status === 'registered').map((r) => r.courseCode)

/** Same rules as the backend (records.add_interest / remove_interest); edits live in memory until reload. */
function setInterests(s: DStudent, interests: string[]): string[] {
  s.interests = interests
  const listed = STUDENT_LIST.find((x) => x.id === s.id)
  if (listed) listed.interests = interests
  return clone(interests)
}

const COACH: Agent = {
  id: 'academic_coach',
  kind: 'specialist',
  name: 'Academic Coach',
  emoji: '🎓',
  tagline: 'Listens to your classes, plans your week and reviews it with you',
  scope: DOCS.filter((d) => ['handbook', 'circular', 'catalog', 'syllabus', 'exam_calendar', 'past_papers'].includes(d.kind)).map((d) => d.id),
  starters: ['What should I study this week?', 'Run my weekly review', 'Am I on track?'],
}

/** Short channel suffixes ("cs-f212-dbms"); courses without one use the bare code. */
const SHORT: Record<string, string> = { 'CS F212': 'dbms', 'CS F372': 'os', 'CS F303': 'networks', 'CS F351': 'toc' }

const channelsFor = (s: DStudent): Channel[] => [
  { id: 'announcements', name: 'announcements', kind: 'live', description: 'Circulars from the Academic Office · read-only' },
  ...registered(s).map((code) => ({
    id: `class:${code}`,
    name: SHORT[code] ? `${slug(code)}-${SHORT[code]}` : slug(code),
    kind: 'class' as const,
    description: `${code} ${course(code)?.title ?? ''} · the coach here reads only this course`,
    courseCode: code,
  })),
]

// ---------------------------------------------------------------------------
// In-memory "database"

interface MockLecture {
  lecture: Lecture
  studentId: string
  text?: string
  processStartedAt?: number
  failWith?: string
  built?: Built
  markers: StuckMarker[]
}

const lectures = new Map<string, MockLecture>()
const threads = new Map<string, Thread>()
const states = new Map<string, StudentState>()
const items = new Map<string, CalendarItem>() // stored: plan blocks + accepted actions + the student's own tasks
const statuses = new Map<string, CalendarStatus>() // overlay, like tools/calendar.py
const tickets: Ticket[] = []
const oneOnOnes = new Map<string, OneOnOne>()
const relevant = new Map<string, RelevantCard[]>()
const failedOnce = new Set<string>()

function thread(studentId: string, agentId: AgentId, courseCode?: string): Thread {
  const id = courseCode ? `${studentId}:class:${courseCode}` : `${studentId}:${agentId}`
  let t = threads.get(id)
  if (!t) threads.set(id, (t = { id, studentId, agentId, ...(courseCode ? { courseCode } : {}), messages: [] }))
  return t
}

function push(t: Thread, m: Omit<Message, 'id' | 'threadId' | 'citations' | 'cards' | 'trace'> & Partial<Pick<Message, 'citations' | 'cards' | 'trace'>>): Message {
  const msg: Message = { id: uid('m'), threadId: t.id, citations: [], cards: [], trace: [], ...m }
  t.messages.push(msg)
  t.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return msg
}

const stateOf = (studentId: string) => {
  let st = states.get(studentId)
  if (!st) states.set(studentId, (st = { studentId, updatedAt: new Date().toISOString() }))
  return st
}

/** Cite a section by a verbatim quote (default: its first sentence), like CitationSet.cite_section. */
function cite(id: string, sectionId: string, quote?: string): Citation | undefined {
  const hit = findSection(sectionId)
  if (!hit) return undefined
  const q = quote ?? hit.section.text.split(/(?<=[.!?])\s+/)[0]!
  if (!hit.section.text.includes(q)) return undefined
  return { id, docId: hit.doc.id, docTitle: hit.doc.title, sectionId, sectionHeading: hit.section.heading, quote: q }
}

// ---------------------------------------------------------------------------
// Diagnosis: internal marks × last-3 end-sem papers → impact (0–100), as tools/diagnose.py

function diagnose(s: DStudent): WeakTopic[] {
  const out: WeakTopic[] = []
  for (const code of registered(s)) {
    const sums = new Map<string, { scored: number; max: number }>()
    for (const r of s.internalMarks.rows) {
      if (r.courseCode !== code || !r.topic) continue
      const t = topicByTitle(code, r.topic)
      if (!t) continue
      const a = sums.get(t.title) ?? { scored: 0, max: 0 }
      a.scored += r.scored
      a.max += r.max
      sums.set(t.title, a)
    }
    for (const [topic, { scored, max }] of sums) {
      const w = topicWeight(code, topic)
      if (!w || !max) continue
      const impact = Math.round((100 * w.mean * (1 - scored / max)) / HEAVIEST_MEAN)
      if (impact <= 0) continue
      out.push({ course: code, topic, score: `${scored}/${max}`, examWeight: Math.round(w.mean * 10) / 10, impact: Math.min(100, impact), citationId: w.sectionId })
    }
  }
  return out.sort((a, b) => b.impact - a.impact || b.examWeight - a.examWeight)
}

// ---------------------------------------------------------------------------
// Calendar: timetable + exams + stored items (plan blocks, accepted actions) + status overlay

function classItems(s: DStudent, from: Date, to: Date): CalendarItem[] {
  return sessionsBetween(from, to, registered(s)).map((x) => ({
    id: `class:${slug(x.courseCode)}:${ymd(x.start)}:${hm(x.start)}`,
    studentId: s.id,
    kind: 'class',
    title: `${x.courseCode} ${course(x.courseCode)?.title ?? ''} (${x.room})`,
    courseCode: x.courseCode,
    start: isoLocal(x.start),
    end: isoLocal(x.end),
    source: { type: 'timetable' },
  }))
}

function examItems(s: DStudent, from: Date, to: Date): CalendarItem[] {
  const codes = registered(s)
  return EXAMS.filter((e) => codes.includes(e.courseCode) && parse(e.date) >= new Date(dayMs(from)) && parse(e.date) < to).map((e) => ({
    id: `exam:${e.id}`,
    studentId: s.id,
    kind: e.kind,
    title: e.title,
    courseCode: e.courseCode,
    start: e.date,
    allDay: true,
    source: { type: 'exam_calendar', examId: e.id },
  }))
}

const withStatus = (i: CalendarItem): CalendarItem => (statuses.has(i.id) ? { ...i, status: statuses.get(i.id) } : i)

function calendar(s: DStudent, from: Date, to: Date): CalendarItem[] {
  const stored = [...items.values()].filter((i) => i.studentId === s.id && parse(i.start) >= from && parse(i.start) < to)
  return [...classItems(s, from, to), ...examItems(s, from, to), ...stored]
    .map(withStatus)
    .sort((a, b) => parse(a.start).getTime() - parse(b.start).getTime() || a.kind.localeCompare(b.kind))
}

const EVENING = [18, 22] as const
const DAILY_CAP = 120

/** Busy intervals: classes, stored items, whole days with an exam or quiz. */
function busy(s: DStudent, from: Date, to: Date): [number, number][] {
  const out: [number, number][] = []
  for (const i of [...classItems(s, from, to), ...[...items.values()].filter((x) => x.studentId === s.id)])
    if (i.end && !i.allDay) out.push([parse(i.start).getTime(), parse(i.end).getTime()])
  for (const e of examItems(s, new Date(from.getTime() - DAY), new Date(to.getTime() + DAY))) out.push([parse(e.start).getTime(), parse(e.start).getTime() + DAY])
  return out
}

const studyMinutesOn = (s: DStudent, day: Date) => {
  const lo = dayMs(day)
  let n = 0
  for (const i of items.values())
    // a task counts as study time only when it's tied to a course (like tools/plan.py)
    if (i.studentId === s.id && i.end && !i.allDay && !(i.kind === 'task' && !i.courseCode)) {
      const a = parse(i.start).getTime()
      if (a >= lo && a < lo + DAY) n += (parse(i.end).getTime() - a) / 60000
    }
  return n
}

/**
 * First free evening slot (18:00–22:00, 15-minute steps) of `minutes` in [earliest, latest].
 * Plan placement passes the daily cap and spreads blocks to the least-loaded evening; accepting an
 * action takes the first free slot with no cap, like tools/calendar.find_slot.
 */
function findSlot(s: DStudent, minutes: number, earliest: Date, latest: Date, opts: { cap?: number; spread?: boolean } = {}): [Date, Date] | undefined {
  const len = minutes * 60000
  const taken = busy(s, earliest, latest)
  const days: Date[] = []
  for (let d = new Date(dayMs(earliest)); d.getTime() <= latest.getTime(); d = new Date(d.getTime() + DAY + 3_600_000)) days.push(new Date(dayMs(d)))
  if (opts.spread) days.sort((a, b) => studyMinutesOn(s, a) - studyMinutesOn(s, b) || a.getTime() - b.getTime())
  for (const day of days) {
    if (opts.cap && studyMinutesOn(s, day) + minutes > opts.cap) continue
    let t = Math.max(new Date(day).setHours(EVENING[0], 0, 0, 0), Math.ceil(earliest.getTime() / 900000) * 900000)
    const stop = Math.min(new Date(day).setHours(EVENING[1], 0, 0, 0), latest.getTime())
    while (t + len <= stop) {
      if (taken.every(([a, b]) => t + len <= a || t >= b)) return [new Date(t), new Date(t + len)]
      t += 900000
    }
  }
  return undefined
}

function addPlanBlock(studentId: string, block: PlanBlock, start: Date) {
  const st = stateOf(studentId)
  const plan: StudyPlanCard = st.plan ?? { type: 'study_plan', weeks: [] }
  const label = weekLabel(mondayOf(start))
  let week = plan.weeks.find((w) => w.label === label)
  if (!week) {
    week = { label, blocks: [] }
    plan.weeks.push(week)
    plan.weeks.sort((a, b) => weekStart(a.label) - weekStart(b.label))
  }
  week.blocks.push(block)
  st.plan = plan
  st.updatedAt = new Date().toISOString()
}

function weekStart(label: string) {
  const m = /Week of (\w+) (\d+)/.exec(label)
  if (!m) return 0
  const now = new Date()
  const d = new Date(`${m[1]} ${m[2]} ${now.getFullYear()}`)
  if (d.getTime() - now.getTime() < -180 * DAY) d.setFullYear(now.getFullYear() + 1)
  return d.getTime()
}

function removePlanBlock(studentId: string, blockId: string) {
  const plan = stateOf(studentId).plan
  if (!plan) return
  for (const w of plan.weeks) w.blocks = w.blocks.filter((b) => b.id !== blockId)
  plan.weeks = plan.weeks.filter((w) => w.blocks.length)
}

function examNote(s: DStudent, monday: Date) {
  const end = new Date(monday.getTime() + 7 * DAY)
  const ex = examItems(s, monday, end)
  return ex.length ? ex.map((e) => `${e.title} ${dowdm(parse(e.start))}`).join(' · ') : undefined
}

/** build_study_plan: weak topics × free evenings, placed by code. Carry-over (from a 1:1) goes first. */
function buildPlan(s: DStudent, opts: { asOf?: Date; weeks?: number; carry?: { course: string; topic: string; minutes: number }[] } = {}): { card: StudyPlanCard; placed: number; minutes: number } {
  const now = opts.asOf ?? new Date()
  const weak = diagnose(s)
  const st = stateOf(s.id)
  st.weakTopics = { type: 'weak_topics', items: weak }
  // Drop future, still-planned blocks of the old plan; past blocks keep their status for the 1:1.
  for (const [id, it] of [...items]) {
    if (it.studentId !== s.id || it.source.type !== 'plan_block') continue
    if (parse(it.start) >= now && (statuses.get(id) ?? 'planned') === 'planned') {
      items.delete(id)
      removePlanBlock(s.id, it.source.planBlockId)
    }
  }
  const weeks = opts.weeks ?? 2
  const monday = mondayOf(now)
  const carry = [...(opts.carry ?? [])]
  const picks = weak.filter((w) => w.impact >= 25).slice(0, 4)
  if (!picks.length) picks.push(...weak.slice(0, 2))
  let placed = 0
  let minutes = 0
  for (let w = 0; w < weeks; w++) {
    const ws = new Date(monday.getTime() + w * 7 * DAY)
    const we = new Date(ws.getTime() + 7 * DAY)
    const earliest = new Date(Math.max(ws.getTime(), now.getTime()))
    const queue: { course: string; topic: string; minutes: number; why: string; citationId?: string; carry?: boolean }[] = []
    // Carry-over first, in 50-min pieces; whatever doesn't fit this week spills into the next.
    for (const c of carry.splice(0))
      for (let left = c.minutes; left > 0; left -= 50)
        queue.push({ course: c.course, topic: c.topic, minutes: Math.min(50, left), why: `carry-over from last week (${c.minutes} min missed)`, citationId: topicByTitle(c.course, c.topic)?.id, carry: true })
    for (const p of picks) {
      const per = p.impact >= 60 ? [50, 50] : p.impact >= 40 ? [50, 25] : [50]
      const wt = topicWeight(p.course, p.topic)
      for (const m of per)
        queue.push({ course: p.course, topic: p.topic, minutes: m, why: `impact ${p.impact}; scored ${p.score} in internal marks${wt ? `; ${weightFact(wt)}` : ''}`, citationId: topicByTitle(p.course, p.topic)?.id })
    }
    for (const q of queue) {
      const endSem = EXAMS.find((e) => e.courseCode === q.course && e.component === 'End-sem')
      const latest = new Date(Math.min(we.getTime(), endSem ? parse(endSem.date).getTime() : we.getTime()))
      const slot = findSlot(s, q.minutes, earliest, latest, { cap: DAILY_CAP, spread: true })
      if (!slot) {
        if (q.carry) carry.push({ course: q.course, topic: q.topic, minutes: q.minutes })
        continue
      }
      const block: PlanBlock = { id: uid('pb'), course: q.course, topic: q.topic, minutes: q.minutes, why: q.why, ...(q.citationId ? { citationId: q.citationId } : {}) }
      addPlanBlock(s.id, block, slot[0])
      const id = `plan:${block.id}`
      items.set(id, { id, studentId: s.id, kind: 'study_block', title: `Study: ${q.topic}`, courseCode: q.course, start: isoLocal(slot[0]), end: isoLocal(slot[1]), source: { type: 'plan_block', planBlockId: block.id }, status: 'planned' })
      placed += 1
      minutes += q.minutes
    }
  }
  const plan = st.plan ?? { type: 'study_plan', weeks: [] }
  // The plan card shows this week onwards; past weeks live on in the calendar (and the 1:1 recap).
  plan.weeks = plan.weeks.filter((w) => weekStart(w.label) + 7 * DAY > mondayOf(new Date()).getTime())
  for (const w of plan.weeks) {
    const note = examNote(s, new Date(weekStart(w.label)))
    if (note) w.examNote = note
    else delete w.examNote
  }
  st.plan = plan
  st.updatedAt = new Date().toISOString()
  return { card: clone(plan), placed, minutes }
}

// ---------------------------------------------------------------------------
// Class companion

function advance(ml: MockLecture) {
  const lec = ml.lecture
  if (ml.processStartedAt == null || lec.status === 'ready' || lec.status === 'failed') return
  const t = Date.now() - ml.processStartedAt
  const audio = lec.source !== 'transcript'
  const steps: [number, Lecture['status']][] = audio
    ? [
        [2500, 'transcribing'],
        [5000, 'transcribed'],
        [8000, 'processing'],
      ]
    : [
        [2500, 'transcribed'],
        [6000, 'processing'],
      ]
  if (ml.failWith && t >= (audio ? 3000 : 2500)) return fail(ml, audio ? 'transcribe' : 'handout', ml.failWith)
  const step = steps.find(([until]) => t < until)
  if (step) lec.status = step[1]
  else finish(ml)
}

function fail(ml: MockLecture, step: string, error: string) {
  const lec = ml.lecture
  lec.status = 'failed'
  lec.error = `${step}: ${error}`
  push(thread(ml.studentId, 'academic_coach', lec.courseCode), {
    role: 'system',
    createdAt: new Date().toISOString(),
    text: `Class companion stopped at **${step}** for ${lec.courseCode} (${dm(parse(lec.date))}): ${error}`,
    trace: [{ tool: `class_companion.${step}`, summary: 'step failed; nothing was produced', durationMs: 0, error }],
  })
}

function rebuild(ml: MockLecture, now = new Date()) {
  const s = studentOf(ml.studentId)
  const prev = ml.built
  ml.built = build({
    lectureId: ml.lecture.id,
    courseCode: ml.lecture.courseCode,
    lectureDate: parse(ml.lecture.date),
    transcriptText: ml.text ?? '',
    durationSec: ml.lecture.durationSec,
    markers: ml.markers,
    student: s,
    now,
    prior: prev && {
      handoutId: prev.handout.id,
      sectionIds: prev.handout.sections.map((x) => x.id),
      actionIds: new Map(prev.actions.map((a) => [actionKey(a), a.id])),
      statuses: new Map(prev.actions.map((a) => [a.id, a])),
    },
  })
  ml.markers = ml.built.markers
}

/** Stable key for an action across rebuilds (same one build() uses). */
const actionKey = (a: ActionItem) =>
  a.kind === 'prep'
    ? `prep:${a.why.match(/Lecturer said: "([^"]+)"/)?.[1] ?? a.title}`
    : a.kind === 'study'
      ? `study:${a.topic}`
      : a.provenance.markerId
        ? `stuck:${a.provenance.markerId}`
        : a.why.startsWith('Lecturer said')
          ? `review:${a.topic}`
          : `weak:${a.topic}`

function companionTrace(ml: MockLecture): ToolTrace[] {
  const b = ml.built!
  const file = sampleLecture(ml.lecture.courseCode)?.file
  return [
    { tool: 'class_companion.transcribe', summary: ml.lecture.source === 'transcript' ? `pasted transcript → ${b.segments.length} segments (~40 words, synthetic timestamps)` : `mock: dataset transcript ${file} stands in for STT → ${b.segments.length} segments`, durationMs: 2500 },
    { tool: 'class_companion.handout', summary: `${b.handout.sections.length} sections; every segment id checked against the transcript`, durationMs: 2500 },
    { tool: 'class_companion.coverage', summary: `${b.coverage.unit}: ${b.coverage.covered.length} covered, ${b.coverage.missed.length} missed, ${b.coverage.emphasized.length} emphasized (quotes verbatim)${b.markers.length ? `; ${b.markers.length} stuck marker(s) resolved to sections` : ''}`, durationMs: 1500 },
    { tool: 'class_companion.commitments', summary: `${b.commitments.length} commitments; dates from timetable.json and exam_calendar.json`, durationMs: 700 },
    { tool: 'class_companion.actions', summary: `${b.actions.length} actions; marks and dates computed from past_papers.json, exam_calendar.json, internal marks`, durationMs: 800 },
  ]
}

function readyMessage(ml: MockLecture, at: string) {
  const b = ml.built!
  const lec = ml.lecture
  const citations: Citation[] = []
  for (const m of b.coverage.missed) {
    const c = cite(`C${citations.length + 1}`, m.syllabusSectionId)
    if (c) citations.push(c)
  }
  const s1 = `Your handout for **${lec.courseCode} · ${b.handout.title}** (${dowdm(parse(lec.date))}) is ready: ${b.handout.sections.length} sections.`
  // we don't grade the lecture: other unit topics are framed as what to study next (same wording as the backend)
  const s2 = b.coverage.missed.length
    ? `It maps to ${b.coverage.unit}. Also on that unit's syllabus: ${b.coverage.missed.map((m, i) => `**${m.topic}**${citations[i] ? ` [${citations[i]!.id}]` : ''}`).join(', ')}, on your actions list to study.`
    : `It maps to ${b.coverage.unit}.`
  const s2b = b.coverage.confusion.length ? ` You flagged ${b.coverage.confusion.length === 1 ? 'one moment' : `${b.coverage.confusion.length} moments`} — marked in the handout.` : ''
  const firstA = b.actions[0]
  const s3 = firstA ? `I've proposed ${b.actions.length} actions; the first, “${firstA.title}”, is due ${firstA.dueBy ? dowdm(parse(firstA.dueBy)) : 'soon'}.` : 'Nothing in this lecture needs a follow-up action.'
  push(thread(ml.studentId, 'academic_coach', lec.courseCode), { role: 'system', createdAt: at, text: `Handout ready · ${b.handout.title}` })
  push(thread(ml.studentId, 'academic_coach', lec.courseCode), {
    role: 'agent',
    agentId: 'academic_coach',
    createdAt: new Date(parse(at).getTime() + 1000).toISOString(),
    text: `${s1} ${s2}${s2b} ${s3}`,
    citations,
    cards: [clone(b.coverage), { type: 'actions', lectureId: lec.id, commitments: clone(b.commitments), items: clone(b.actions) }],
    trace: companionTrace(ml),
  })
}

function finish(ml: MockLecture, at = new Date()) {
  try {
    rebuild(ml, new Date())
  } catch (e) {
    return fail(ml, 'handout', e instanceof Error ? e.message : String(e))
  }
  const lec = ml.lecture
  lec.status = 'ready'
  lec.durationSec ??= Math.round(ml.built!.segments.at(-1)?.endSec ?? 0)
  lec.title ??= ml.built!.handout.title
  readyMessage(ml, at.toISOString())
}

function lectureOf(id: string): MockLecture {
  const ml = lectures.get(id)
  if (!ml) throw new ApiError(`lecture ${id} not found`, 404)
  advance(ml)
  return ml
}

async function audioDuration(blob: Blob): Promise<number | undefined> {
  const url = URL.createObjectURL(blob)
  try {
    const d = await new Promise<number>((res) => {
      const a = new Audio()
      a.preload = 'metadata'
      a.onloadedmetadata = () => res(a.duration)
      a.onerror = () => res(NaN)
      a.src = url
      setTimeout(() => res(NaN), 2500)
    })
    if (Number.isFinite(d) && d > 0) return Math.round(d)
    // MediaRecorder's webm has no duration header; decode it instead (small files only).
    if (blob.size < 30_000_000) {
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      void ctx.close()
      return Math.round(buf.duration)
    }
  } catch {
    // unknown duration is fine: the transcript's own timing is used
  } finally {
    URL.revokeObjectURL(url)
  }
  return undefined
}

function accept(a: ActionItem, s: DStudent) {
  const now = new Date()
  const due = a.dueBy ? parse(a.dueBy) : undefined
  const minutes = a.minutes ?? 45
  const week = due && due.getTime() - now.getTime() > 7 * DAY ? mondayOf(new Date(due.getTime() - 7 * DAY)) : mondayOf(now)
  const earliest = new Date(Math.max(now.getTime(), week.getTime()))
  const latest = due && due > earliest ? new Date(Math.min(due.getTime(), week.getTime() + 7 * DAY)) : new Date(week.getTime() + 7 * DAY)
  const slot = findSlot(s, minutes, earliest, latest) ?? (due && due > now ? findSlot(s, minutes, now, due) : findSlot(s, minutes, earliest, new Date(earliest.getTime() + 14 * DAY)))
  if (!slot) throw new ApiError(`no free evening slot of ${minutes} min before ${a.dueBy ? dowdm(parse(a.dueBy)) : 'the next two weeks'}`, 400)
  const block: PlanBlock = { id: uid('pb'), course: a.course, topic: a.topic, minutes, why: a.why, ...(a.provenance.syllabusSectionId ? { citationId: a.provenance.syllabusSectionId } : {}) }
  addPlanBlock(s.id, block, slot[0])
  const source = { type: 'action' as const, actionId: a.id, lectureId: a.lectureId }
  const item: CalendarItem =
    a.kind === 'deadline' && a.dueBy
      ? { id: uid('cal'), studentId: s.id, kind: 'deadline', title: a.title, courseCode: a.course, start: a.dueBy.slice(0, 10), allDay: true, source, status: 'planned' }
      : { id: uid('cal'), studentId: s.id, kind: a.kind === 'prep' ? 'prep' : 'action', title: a.title, courseCode: a.course, start: isoLocal(slot[0]), end: isoLocal(slot[1]), source, status: 'planned' }
  items.set(item.id, item)
  a.planBlockId = block.id
  a.calendarItemId = item.id
}

function unaccept(a: ActionItem) {
  const lec = lectures.get(a.lectureId)
  if (a.planBlockId && lec) removePlanBlock(lec.studentId, a.planBlockId)
  if (a.calendarItemId) items.delete(a.calendarItemId)
  delete a.planBlockId
  delete a.calendarItemId
}

function findAction(id: string): { ml: MockLecture; a: ActionItem } {
  for (const ml of lectures.values()) {
    const a = ml.built?.actions.find((x) => x.id === id)
    if (a) return { ml, a }
  }
  throw new ApiError(`action ${id} not found`, 404)
}

// ---------------------------------------------------------------------------
// Classes (sidebar group + Today block)

function classesFor(s: DStudent): ClassChannel[] {
  const now = new Date()
  const weak = stateOf(s.id).weakTopics?.items ?? diagnose(s)
  return registered(s).map((code) => {
    const c = course(code)
    const next = nextSession(code, now)
    const nextLecture = nextSession(code, now, true)
    const exam = nextExam(code, now)
    const lecs = [...lectures.values()].filter((l) => l.studentId === s.id && l.lecture.courseCode === code)
    lecs.forEach(advance)
    lecs.sort((a, b) => b.lecture.date.localeCompare(a.lecture.date) || b.lecture.id.localeCompare(a.lecture.id))
    const acts = lecs.flatMap((l) => l.built?.actions ?? [])
    const latest = lecs[0]?.lecture
    return {
      channelId: `class:${code}`,
      courseCode: code,
      title: c?.title ?? code,
      faculty: c?.faculty ?? '',
      slot: c?.slot ?? '',
      ...(next ? { nextSessionAt: isoLocal(next.start), nextSessionRoom: next.room } : {}),
      ...(exam ? { examAt: exam.date, examKind: exam.kind === 'quiz' ? ('quiz' as const) : exam.component === 'Mid-sem' ? ('mid_sem' as const) : ('end_sem' as const) } : {}),
      pendingActions: acts.filter((a) => a.status === 'proposed').length,
      prepDue: acts.filter((a) => a.kind === 'prep' && a.status === 'accepted' && a.dueBy && parse(a.dueBy) >= now && (!nextLecture || parse(a.dueBy) <= nextLecture.start)).length,
      ...(latest ? { latestLecture: { lectureId: latest.id, date: latest.date, status: latest.status } } : {}),
      weakTopicCount: weak.filter((w) => w.course === code && w.impact >= 50).length,
    }
  })
}

// ---------------------------------------------------------------------------
// Weekly 1:1: recap computed from the last 7 days of study items; lines are templates over the recap

const STUDY = ['study_block', 'action', 'prep', 'deadline']

function currentOneOnOne(s: DStudent): OneOnOne {
  const now = new Date()
  const start = new Date(now.getTime() - 7 * DAY)
  const rows = calendar(s, start, now).filter((i) => STUDY.includes(i.kind) && i.end)
  const id = `ooo_${s.id}_${ymd(mondayOf(now)).replace(/-/g, '')}`
  const minutesOf = (i: CalendarItem) => (parse(i.end!).getTime() - parse(i.start).getTime()) / 60000
  const topicOf = (i: CalendarItem) => i.title.replace(/^Study: /, '').replace(/^(Self-study|Revisit|Review|Practise|Read ahead on) /, '')
  const done = rows.filter((i) => i.status === 'done')
  const missed = rows.filter((i) => i.status === 'missed')
  const doneTopics = [...new Set(done.map(topicOf))]
  const missedTopics = [...new Set(missed.map(topicOf))]
  // Streak: consecutive days back from today with a done block; a day with nothing scheduled neither
  // extends nor breaks it (as lookback.recap).
  let streak = 0
  for (let d = 0; d <= 7; d++) {
    const day = dayMs(new Date(now.getTime() - d * DAY))
    const onDay = rows.filter((i) => dayMs(parse(i.start)) === day)
    if (!onDay.length) continue
    if (!onDay.some((i) => i.status === 'done')) break
    streak += 1
  }
  const flagged = new Map<string, number>()
  for (const ml of lectures.values())
    if (ml.studentId === s.id)
      for (const m of ml.markers) if (m.topic && parse(m.createdAt) >= start) flagged.set(m.topic, (flagged.get(m.topic) ?? 0) + 1)
  const recap: OneOnOne['recap'] = {
    plannedMinutes: rows.reduce((n, i) => n + minutesOf(i), 0),
    doneMinutes: done.reduce((n, i) => n + minutesOf(i), 0),
    blocksPlanned: rows.length,
    blocksDone: done.length,
    completedTopics: doneTopics,
    skippedTopics: missedTopics,
    weakTopicMovement: [],
    flaggedTopics: [...flagged].map(([topic, times]) => ({ topic, times })),
    blocksMissed: missed.length,
    prepMet: rows.filter((i) => i.kind === 'prep' && i.status === 'done').length,
    prepMissed: rows.filter((i) => i.kind === 'prep' && i.status === 'missed').length,
    window: { from: isoLocal(start), to: isoLocal(now) },
    streakDays: streak,
  }
  const existing = oneOnOnes.get(id)
  if (existing && (existing.status !== 'ready' || (existing.recap.blocksDone === recap.blocksDone && existing.recap.blocksPlanned === recap.blocksPlanned))) return existing
  const one: OneOnOne = { id, studentId: s.id, weekLabel: `Week of ${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}`, status: 'ready', recap, wins: [], concerns: [], questions: [], proposedAdjustments: [], shareWithAdvisor: false }
  if (!rows.length) return one // nothing to review; not stored (like lookback.build_current)
  const byTopic = (list: CalendarItem[], t: string) => list.filter((i) => topicOf(i) === t)
  for (const t of doneTopics) {
    const d = byTopic(done, t)
    if (d.length >= 2) one.wins.push(`${d.length} sessions on ${t} (${d.reduce((n, i) => n + minutesOf(i), 0)} min)`)
  }
  if (!one.wins.length && done.length) one.wins.push(`${done.length} of ${rows.length} blocks done (${recap.doneMinutes} min)`)
  if (streak >= 2) one.wins.push(`${streak}-day streak going into this week`)
  for (const t of missedTopics) {
    const m = byTopic(missed, t)
    const c = m[0]?.courseCode ?? ''
    const w = c ? topicWeight(c, t) : undefined
    one.concerns.push(`${t} missed ${m.length === 1 ? 'once' : `${m.length} times`} (${m.map((i) => parse(i.start).toLocaleDateString('en-GB', { weekday: 'short' })).join(', ')})${w ? `; it ${weightFact(w)}` : ''}`)
  }
  for (const f of recap.flaggedTopics) one.concerns.push(`You flagged ${f.topic} ${f.times === 1 ? 'once' : `${f.times} times`} in class this week`)
  if (missedTopics[0]) one.questions.push({ id: 'q1', prompt: `What got in the way of the ${missedTopics[0]} blocks?` })
  if (recap.flaggedTopics[0]) one.questions.push({ id: `q${one.questions.length + 1}`, prompt: `Is ${recap.flaggedTopics[0].topic} still unclear after the review item?` })
  one.questions.push({ id: `q${one.questions.length + 1}`, prompt: 'Which evenings worked best for studying this week?' })
  for (const t of missedTopics) {
    const mins = byTopic(missed, t).reduce((n, i) => n + minutesOf(i), 0)
    const c = byTopic(missed, t)[0]?.courseCode
    const ex = c ? nextExam(c, now) : undefined
    one.proposedAdjustments.push({ change: 'move', detail: `Carry ${mins} min of ${t} into this week${ex ? `, before ${ex.title.replace(`${c} `, '')} on ${dowdm(parse(ex.date))}` : ''}` })
  }
  for (const f of recap.flaggedTopics.slice(0, 1)) one.proposedAdjustments.push({ change: 'add', detail: `Add a 25-min ${f.topic} review early in the week` })
  if (recap.blocksPlanned && recap.blocksDone / recap.blocksPlanned < 0.5) one.proposedAdjustments.push({ change: 'resize', detail: 'Use 25-min blocks on busy days instead of 50' })
  oneOnOnes.set(id, one)
  return one
}

// ---------------------------------------------------------------------------
// Chat — the Academic Coach only (Course Planner / Campus Guide are below the line: no mock replies)

type Reply = { message: Omit<Message, 'id' | 'threadId' | 'createdAt'>; escalate?: { reason: Escalation['reason']; summary: string } }
const agentMsg = (text: string, extra: Partial<Reply['message']> = {}): Reply['message'] => ({ role: 'agent', agentId: 'academic_coach', text, citations: [], cards: [], trace: [], ...extra })

const OUT_OF_SCOPE = /\b(fee|fees|extension|medical|hostel|refund|scholarship|leave|attendance|mess|visa|loan)\b/i

function planReply(s: DStudent): Reply {
  const t0 = performance.now()
  const res = buildPlan(s)
  const weak = stateOf(s.id).weakTopics!
  const top = weak.items.slice(0, 3)
  const citations = top.map((w, i) => cite(`C${i + 1}`, w.citationId)).filter((c): c is Citation => !!c)
  const accepted = [...items.values()].filter((i) => i.studentId === s.id && i.source.type === 'action' && parse(i.start) >= new Date()).length
  const text =
    `This week, put your time on ${top.map((w, i) => `**${w.topic}** (impact ${w.impact})${citations[i] ? ` [${citations[i]!.id}]` : ''}`).join(', ')}. ` +
    `I've placed ${res.placed} blocks (${res.minutes} min over two weeks) in free evenings around your classes — none on exam or quiz days, never more than 2 hours a day` +
    (accepted ? `, next to the ${accepted} action${accepted > 1 ? 's' : ''} you accepted from class` : '') +
    `. Open **Canvas → Calendar** to see the week.`
  return {
    message: agentMsg(text, {
      citations,
      cards: [clone(weak), res.card],
      trace: [
        { tool: 'diagnose_performance', summary: `internal marks × last-3 end-sem past papers → ${weak.items.length} topics; top: ${top.map((w) => `${w.topic} ${w.impact}`).join(', ')}`, durationMs: Math.round(performance.now() - t0) + 40 },
        { tool: 'build_study_plan', summary: `${res.placed} blocks, ${res.minutes} min; placed by code in 18:00–22:00 gaps, ≤ ${DAILY_CAP} min/day, none on exam days`, durationMs: 1650 },
        { tool: 'compose', summary: `reply with ${citations.length} verified citations`, durationMs: 900 },
      ],
    }),
  }
}

function reviewReply(s: DStudent): Reply {
  const one = currentOneOnOne(s)
  const r = one.recap
  if (!r.blocksPlanned)
    return { message: agentMsg('There’s nothing to review yet — no study blocks were scheduled in the last 7 days. Ask me what to study this week and I’ll build a plan first.', { trace: [{ tool: 'weekly_review', summary: 'nothing to review: no study blocks in the last 7 days; 1:1 not stored', durationMs: 60 }] }) }
  const text =
    `${one.weekLabel}: you did **${r.doneMinutes} of ${r.plannedMinutes} min** — ${r.blocksDone} of ${r.blocksPlanned} blocks.` +
    (r.skippedTopics.length ? ` **${r.skippedTopics.join('**, **')}** got skipped.` : ' Nothing was skipped.') +
    (r.flaggedTopics.length ? ` You flagged ${r.flaggedTopics.map((f) => f.topic).join(' and ')} in class.` : '') +
    ` I've put ${one.questions.length} question${one.questions.length === 1 ? '' : 's'} in your Weekly 1:1 — answer them and complete it, and I'll re-plan next week around what you tell me.`
  return {
    message: agentMsg(text, {
      cards: [{ type: 'one_on_one', oneOnOne: clone(one) }],
      trace: [
        { tool: 'weekly_review.recap', summary: `${r.blocksPlanned} blocks in the last 7 days: ${r.blocksDone} done, ${r.doneMinutes}/${r.plannedMinutes} min, streak ${r.streakDays}`, durationMs: 80 },
        { tool: 'weekly_review.reflect', summary: `${one.wins.length} wins, ${one.concerns.length} concerns, ${one.questions.length} questions, ${one.proposedAdjustments.length} adjustments grounded in the recap`, durationMs: 1400 },
      ],
    }),
  }
}

function diagnoseReply(s: DStudent, courseCode?: string): Reply {
  const all = diagnose(s)
  stateOf(s.id).weakTopics = { type: 'weak_topics', items: all }
  const list = courseCode ? all.filter((w) => w.course === courseCode) : all
  const top = list.slice(0, 3)
  const citations = top.map((w, i) => cite(`C${i + 1}`, w.citationId)).filter((c): c is Citation => !!c)
  const text = top.length
    ? `Your marks are costing you most on ${top.map((w, i) => `**${w.topic}** (${w.course}, ${w.score}, impact ${w.impact})${citations[i] ? ` [${citations[i]!.id}]` : ''}`).join(', ')}. Impact is your internal-marks gap × what the topic carried in the last three end-sems.`
    : `Nothing stands out${courseCode ? ` in ${courseCode}` : ''} — every topic with past-paper weight is at or above your average.`
  return {
    message: agentMsg(text, {
      citations,
      cards: [{ type: 'weak_topics', items: list }],
      trace: [{ tool: 'diagnose_performance', summary: `internal marks × last-3 end-sem past papers → ${list.length} topics`, durationMs: 45 }],
    }),
  }
}

function topicAnswer(courseCodes: string[], text: string): Reply | undefined {
  const t = normTopic(text)
  for (const code of courseCodes)
    for (const topic of syllabus(code)?.topics ?? []) {
      if (!t.includes(normTopic(topic.title)) || normTopic(topic.title).length < 3) continue
      const c1 = cite('C1', topic.id)
      const w = topicWeight(code, topic.title)
      const c2 = w ? cite('C2', w.sectionId) : undefined
      const citations = [c1, c2].filter((c): c is Citation => !!c)
      return {
        message: agentMsg(`**${topic.title}** is in ${topic.unitTitle} of ${code}${c1 ? ' [C1]' : ''}${w ? ` and ${weightFact(w)}${c2 ? ' [C2]' : ''}` : ', with no past-paper marks of its own'}.`, {
          citations,
          trace: [{ tool: 'answer_from_docs', summary: `${citations.length} verified quotes from the ${code} syllabus${w ? ' and past papers' : ''}`, durationMs: 1200 }],
        }),
      }
    }
  return undefined
}

function coachReply(s: DStudent, text: string, courseCode?: string): Reply {
  const t = text.toLowerCase()
  if (courseCode) {
    const others = registered(s).filter((c) => c !== courseCode)
    const other = others.find((c) => t.includes(c.toLowerCase()) || t.includes((course(c)?.title ?? '#').toLowerCase()) || (SHORT[c] && new RegExp(`\\b${SHORT[c]}\\b`).test(t)))
    if (OUT_OF_SCOPE.test(t) || other)
      return {
        message: agentMsg(`That’s not about ${courseCode}${other ? ` — it’s ${other}` : ''}. In this channel I only read ${courseCode}’s syllabus, lectures, past papers and exam dates — ask me in my DM and I’ll pick it up there.`, {
          trace: [{ tool: 'check_scope', summary: `outside the ${courseCode} channel scope`, durationMs: 300 }],
        }),
      }
    if (/miss|skip|didn.?t cover/.test(t)) {
      const ml = [...lectures.values()].filter((l) => l.studentId === s.id && l.lecture.courseCode === courseCode && l.built).sort((a, b) => b.lecture.date.localeCompare(a.lecture.date))[0]
      if (!ml) return { message: agentMsg(`No lecture recorded for ${courseCode} yet — hit **Record lecture** at the start of class and I’ll check it against the syllabus.`) }
      const m = ml.built!.coverage.missed[0]
      const c = m && cite('C1', m.syllabusSectionId)
      return {
        message: agentMsg(
          m ? `Next on your ${courseCode} syllabus after your last lecture (${dowdm(parse(ml.lecture.date))}): **${m.topic}**${c ? ' [C1]' : ''}. It’s on your actions list as self-study.` : `Your last ${courseCode} lecture maps to ${ml.built!.coverage.unit}.`,
          { citations: c ? [c] : [], trace: [{ tool: 'class_companion.coverage', summary: `read the coverage of ${ml.lecture.id}`, durationMs: 200 }] },
        ),
      }
    }
    if (/exam|quiz|mid|end.?sem|when/.test(t)) {
      const ex = nextExam(courseCode, new Date())
      const c = cite('C1', `exam_calendar.${slug(courseCode)}`, ex ? `${courseCode} ${ex.component}` : undefined)
      return {
        message: agentMsg(ex ? `Next up for ${courseCode}: **${ex.component} on ${dowdm(parse(ex.date))}**${c ? ' [C1]' : ''}.` : `No more ${courseCode} exams on the calendar this semester.`, {
          citations: c ? [c] : [],
          trace: [{ tool: 'answer_from_docs', summary: 'exam calendar', durationMs: 300 }],
        }),
      }
    }
    if (/weak|struggl|how am i|marks/.test(t)) return diagnoseReply(s, courseCode)
    return topicAnswer([courseCode], text) ?? { message: agentMsg(`I only answer from ${courseCode}’s syllabus, lectures, past papers and exam calendar, and I didn’t find that in them. Try a topic from the syllabus.`, { trace: [{ tool: 'answer_from_docs', summary: 'no section in scope covers this', durationMs: 700 }] }) }
  }
  if (OUT_OF_SCOPE.test(t))
    return {
      message: agentMsg('That’s outside what I can answer — fee extensions and medical cases aren’t covered by the documents I read, and I won’t guess. I’ve opened a ticket with your advisor with your question attached; their reply will land here.', {
        trace: [
          { tool: 'route', summary: 'escalate: no document in scope covers fees or medical circumstances', durationMs: 600 },
          { tool: 'escalate', summary: 'Opened a ticket for the Human Advisor', durationMs: 300 },
        ],
      }),
      escalate: { reason: 'out_of_scope', summary: 'Out of scope for the coach: no handbook section, circular or syllabus covers this. Needs a human decision.' },
    }
  if (/review|1:1|one.on.one|how did (my|the) week|lookback/.test(t)) return reviewReply(s)
  if (/study|plan|this week|what should i|schedule|rebuild/.test(t)) return planReply(s)
  if (/weak|struggl|how am i doing|marks|losing/.test(t)) return diagnoseReply(s)
  if (/track|graduat|audit|units|degree/.test(t))
    return {
      message: agentMsg('The degree audit isn’t available yet, so I can’t tell you whether you’re on track to graduate. It’s the next tool on this layer. For this semester, ask me what to study this week or run your weekly review.', {
        trace: [{ tool: 'run_degree_audit', summary: 'audit not available yet', durationMs: 0, error: 'the degree audit (Feature 3) is not built yet' }],
      }),
    }
  return (
    topicAnswer(registered(s), text) ?? {
      message: agentMsg('I couldn’t find that in the documents I read — syllabus, lectures, past papers, exam calendar, handbook and circulars — so I won’t guess. Try naming a course or topic, or ask your advisor.', {
        trace: [{ tool: 'answer_from_docs', summary: 'no section in scope covers this', durationMs: 800 }],
      }),
    }
  )
}

function commit(s: DStudent, question: string, reply: Reply, at: string, courseCode?: string): Message[] {
  const t = thread(s.id, 'academic_coach', courseCode)
  push(t, { role: 'student', createdAt: at, text: question })
  const m = push(t, { ...reply.message, createdAt: new Date(parse(at).getTime() + 1).toISOString() })
  if (reply.escalate) {
    const tid = `A-${101 + tickets.length}`
    m.escalation = { ticketId: tid, status: 'open', reason: reply.escalate.reason }
    m.trace = m.trace.map((x) => (x.tool === 'escalate' ? { ...x, summary: `Opened ticket #${tid} for the Human Advisor` } : x))
    tickets.unshift({ ticketId: tid, studentId: s.id, studentName: s.name, agentId: 'academic_coach', question, agentSummary: `${first(s)} (${s.program}, Sem ${s.semester}) asked this. ${reply.escalate.summary}`, citations: [], status: 'open', createdAt: at })
  }
  return [m] // like the backend: the student's line is stored, only the reply comes back
}

function answerTicket(ticketId: string, text: string, at: string): Ticket {
  const tk = tickets.find((x) => x.ticketId === ticketId)
  if (!tk) throw new ApiError(`ticket ${ticketId} not found`, 404)
  if (tk.status === 'answered') throw new ApiError(`Ticket #${ticketId} is already answered`, 400)
  tk.status = 'answered'
  tk.reply = { text, at }
  const t = thread(tk.studentId, tk.agentId)
  for (const m of t.messages) if (m.escalation?.ticketId === ticketId) m.escalation.status = 'answered'
  push(t, { role: 'advisor', createdAt: at, text })
  return tk
}

// ---------------------------------------------------------------------------
// Seed: last week's plan (pre-marked, as POST /demo/simulate-week would) and one processed lecture each
// for Meera (CS F372, one stuck marker) and Aarav (CS F303). Rohan starts empty.

function lastLectureDay(code: string, before: Date) {
  const s = sessionsBetween(new Date(before.getTime() - 8 * DAY), before, [code]).filter((x) => x.kind === 'lecture')
  return s.at(-1)?.start
}

function seedLecture(s: DStudent, code: string, marker?: { fraction: number; note: string }) {
  const sample = sampleLecture(code)
  if (!sample) return
  const when = lastLectureDay(code, new Date(Date.now() - DAY)) ?? parse(sample.date)
  const id = uid('lec')
  const ml: MockLecture = {
    studentId: s.id,
    text: sample.text,
    markers: [],
    lecture: { id, studentId: s.id, courseCode: code, date: ymd(when), title: undefined, source: 'recording', durationSec: 50 * 60, status: 'ready', connectorId: 'lms_moodle' },
  }
  lectures.set(id, ml)
  const recorded = new Date(when.getTime() + 51 * 60000)
  push(thread(s.id, 'academic_coach', code), { role: 'system', createdAt: recorded.toISOString(), text: `Lecture recorded · ${dm(when)} · 50 min` })
  if (marker) ml.markers.push({ id: uid('mk'), lectureId: id, atSec: Math.round(50 * 60 * marker.fraction), note: marker.note, createdAt: new Date(when.getTime() + marker.fraction * 50 * 60000).toISOString() })
  rebuild(ml, new Date())
  ml.lecture.title = ml.built!.handout.title
  readyMessage(ml, new Date(recorded.getTime() + 3 * 60000).toISOString())
  return ml
}

function seedWeek(s: DStudent) {
  const asOf = new Date(Date.now() - 7 * DAY)
  buildPlan(s, { asOf, weeks: 3 })
  // Mark the blocks that fell in the last 7 days: every third missed, in time order (the demo fixture rule).
  const past = [...items.values()].filter((i) => i.studentId === s.id && i.source.type === 'plan_block' && parse(i.start) < new Date()).sort((a, b) => a.start.localeCompare(b.start))
  past.forEach((i, n) => statuses.set(i.id, n % 3 === 2 ? 'missed' : 'done'))
}

function seed() {
  for (const s of STUDENTS) stateOf(s.id).weakTopics = { type: 'weak_topics', items: diagnose(s) }
  const meera = STUDENTS.find((s) => s.id === 'meera')
  const aarav = STUDENTS.find((s) => s.id === 'aarav')
  if (meera) {
    seedWeek(meera)
    const ml = seedLecture(meera, 'CS F372', { fraction: 0.66, note: 'lost at the quantum choice' })
    for (const a of ml?.built?.actions ?? []) if (a.kind === 'prep' || a.provenance.markerId) (accept(a, meera), (a.status = 'accepted'))
  }
  if (aarav) {
    seedWeek(aarav)
    seedLecture(aarav, 'CS F303')
  }
}
seed()

// ---------------------------------------------------------------------------

function relevantFor(s: DStudent, interest: string, source: NonNullable<RelevantCard['source']>): RelevantCard {
  let concept = ''
  let heading: string | undefined
  let courseCode = ''
  let standard: string[] = []
  let citationIds: string[] = []
  const handoutPoints = (code: string, topic: string) => {
    for (const ml of [...lectures.values()].filter((l) => l.studentId === s.id && l.lecture.courseCode === code && l.built).reverse()) {
      const sec = ml.built!.handout.sections.find((x) => x.syllabusTopic && normTopic(x.syllabusTopic) === normTopic(topic))
      if (sec) return sec
    }
    return undefined
  }
  const facts = (code: string, topic: string) => {
    const t = topicByTitle(code, topic)
    const w = topicWeight(code, topic)
    return { lines: [t ? `${t.title} is in ${t.unitTitle} of the ${code} syllabus.` : `${topic} (${code}).`, ...(w ? [`It ${weightFact(w)}.`] : [])], ids: [t?.id, w?.sectionId].filter((x): x is string => !!x) }
  }
  if (source.type === 'handout_section') {
    const ml = lectureOf(source.lectureId)
    const sec = ml.built?.handout.sections.find((x) => x.id === source.sectionId)
    if (!sec) throw new ApiError(`section ${source.sectionId} not found in ${source.lectureId}`, 404)
    concept = sec.syllabusTopic ?? sec.heading
    heading = sec.heading
    courseCode = ml.lecture.courseCode
    standard = sec.keyPoints.slice(0, 3)
    citationIds = sec.syllabusSectionId ? [sec.syllabusSectionId] : []
  } else {
    const found =
      source.type === 'plan_block'
        ? stateOf(s.id).plan?.weeks.flatMap((w) => w.blocks).find((b) => b.id === source.planBlockId)
        : { course: source.course, topic: source.topic }
    if (!found) throw new ApiError(`plan block ${source.type === 'plan_block' ? source.planBlockId : ''} not found`, 404)
    concept = found.topic
    courseCode = found.course
    const sec = handoutPoints(found.course, found.topic)
    const f = facts(found.course, found.topic)
    standard = sec ? sec.keyPoints.slice(0, 3) : f.lines
    heading = sec?.heading
    citationIds = sec?.syllabusSectionId ? [sec.syllabusSectionId, ...f.ids.filter((x) => x !== sec.syllabusSectionId)] : f.ids
  }
  const canned = heading ? reframe(heading, interest) : undefined
  return {
    type: 'relevant',
    concept,
    course: `${courseCode} ${course(courseCode)?.title ?? ''}`.trim(),
    interest,
    standard: standard.map((x) => `- ${x}`).join('\n'),
    reframed: canned
      ? canned.map((x) => `- ${x}`).join('\n')
      : `- (mock) No canned ${interest} version of ${concept} — the real /relevant call writes it with one model call from the same facts.`,
    citationIds,
    source,
  }
}

// ---------------------------------------------------------------------------

export const mockApi: Api = {
  async getStudents() {
    await delay(120)
    return clone(STUDENT_LIST)
  },
  async addInterest(studentId, text) {
    await delay(80)
    const s = studentOf(studentId)
    const interest = text.replace(/\s+/g, ' ').trim()
    if (!interest) throw new ApiError('interest is required', 400)
    if (interest.length > 40) throw new ApiError('keep an interest under 40 characters', 400)
    if (s.interests.some((i) => i.toLowerCase() === interest.toLowerCase())) return clone(s.interests)
    if (s.interests.length >= 10) throw new ApiError('at most 10 interests; remove one first', 400)
    return setInterests(s, [...s.interests, interest])
  },
  async removeInterest(studentId, text) {
    await delay(80)
    const s = studentOf(studentId)
    const key = text.replace(/\s+/g, ' ').trim().toLowerCase()
    const kept = s.interests.filter((i) => i.toLowerCase() !== key)
    if (kept.length === s.interests.length) throw new ApiError(`'${text}' is not one of ${studentId}'s interests`, 404)
    return setInterests(s, kept)
  },
  async getWorkspace(studentId) {
    await delay(180)
    const s = studentOf(studentId)
    return clone({ channels: channelsFor(s), classes: classesFor(s), agents: [COACH], connectors: CONNECTORS })
  },
  async getClasses(studentId) {
    await delay(120)
    return clone(classesFor(studentOf(studentId)))
  },
  async getStudentState(studentId) {
    await delay(150)
    studentOf(studentId)
    return clone(stateOf(studentId))
  },
  async getFiles(studentId) {
    await delay(150)
    studentOf(studentId)
    const st = stateOf(studentId)
    const docs: WorkspaceFile[] = DOCS.map((d) => ({ kind: 'document', id: d.id, title: d.title, docKind: d.kind, connectorId: d.connectorId, effectiveDate: d.effectiveDate, updatedAt: d.effectiveDate ?? '2026-08-01' }))
    const canvases: WorkspaceFile[] = []
    if (st.plan) canvases.push({ kind: 'canvas', id: 'canvas-plan', title: 'Study plan', canvasKind: 'study_plan', cardType: 'study_plan', updatedAt: st.updatedAt })
    const one = [...oneOnOnes.values()].find((o) => o.studentId === studentId)
    if (one) canvases.push({ kind: 'canvas', id: 'canvas-one-on-one', title: `Weekly 1:1 · ${one.weekLabel}`, canvasKind: 'one_on_one', cardType: 'one_on_one', updatedAt: new Date().toISOString() })
    return clone([...canvases, ...docs])
  },
  async getDocument(docId) {
    await delay(100)
    const d = DOCS.find((x) => x.id === docId)
    if (!d) throw new ApiError(`document ${docId} not found`, 404)
    return clone(d)
  },
  async getThread(studentId, agentId) {
    await delay(150)
    studentOf(studentId)
    return clone(thread(studentId, agentId))
  },
  async getClassThread(studentId, courseCode) {
    await delay(150)
    studentOf(studentId)
    for (const ml of lectures.values()) if (ml.studentId === studentId && ml.lecture.courseCode === courseCode) advance(ml)
    return clone(thread(studentId, 'academic_coach', courseCode))
  },
  async chat({ studentId, agentId, text, courseCode }) {
    await delay(1200 + Math.random() * 800)
    const s = studentOf(studentId)
    if (agentId !== 'academic_coach') throw new ApiError(`agent '${agentId}' is not available yet; only academic_coach is live`, 400)
    if (/\b(fail|error)\b/i.test(text) && !failedOnce.has(text)) {
      failedOnce.add(text) // fails once, so "try again" demonstrates recovery
      throw new ApiError('Simulated tool failure (mock) — retry to recover', 500)
    }
    return clone(commit(s, text, coachReply(s, text, courseCode), new Date().toISOString(), courseCode))
  },
  async getInbox() {
    await delay(120)
    return clone(tickets)
  },
  async advisorReply({ ticketId, text }) {
    await delay(250)
    return clone(answerTicket(ticketId, text, new Date().toISOString()))
  },

  // ---- Class Companion
  async createLecture(body: NewLecture) {
    await delay(400)
    const s = studentOf(body.studentId)
    if (!body.courseCode || !body.date) throw new ApiError('studentId, courseCode and date are required', 400)
    const id = uid('lec')
    const lecture: Lecture = { id, studentId: s.id, courseCode: body.courseCode, date: body.date.slice(0, 10), source: 'transcript', status: 'uploaded', connectorId: 'lms_moodle' }
    const ml: MockLecture = { lecture, studentId: s.id, markers: [] }
    if ('transcriptText' in body) {
      if (!body.transcriptText.trim()) throw new ApiError('transcriptText is empty', 400)
      ml.text = body.transcriptText
    } else {
      if (!body.audio.size) throw new ApiError('audio file is empty', 400)
      lecture.source = body.source
      lecture.audioUrl = URL.createObjectURL(body.audio)
      lecture.durationSec = await audioDuration(body.audio)
      // Mock "transcription": the dataset transcript for this course stands in for STT.
      ml.text = sampleLecture(body.courseCode)?.text
    }
    lectures.set(id, ml)
    const what = lecture.source === 'transcript' ? 'Transcript added' : lecture.source === 'recording' ? 'Lecture recorded' : 'Audio uploaded'
    const len = lecture.durationSec ? ` · ${Math.max(1, Math.round(lecture.durationSec / 60))} min` : ''
    push(thread(s.id, 'academic_coach', body.courseCode), { role: 'system', createdAt: new Date().toISOString(), text: `${what} · ${dm(parse(lecture.date))}${len}` })
    return clone(lecture)
  },
  async processLecture(id) {
    await delay(200)
    const ml = lectureOf(id)
    if (ml.lecture.status === 'ready') return clone(ml.lecture)
    ml.processStartedAt = Date.now()
    ml.lecture.error = undefined
    ml.failWith = !cannedFor(ml.lecture.courseCode)
      ? `mock mode has sample lectures for ${MOCK_COURSES.join(', ')} only — nothing to build for ${ml.lecture.courseCode}. Open the app with ?mock=0 (or VITE_MOCK=false) to transcribe it on the backend`
      : !ml.text
        ? 'no transcript'
        : undefined
    ml.lecture.status = ml.lecture.source === 'transcript' ? 'transcribed' : 'transcribing'
    return clone(ml.lecture)
  },
  async getLecture(id) {
    await delay(80)
    return clone(lectureOf(id).lecture)
  },
  async getTranscript(id) {
    await delay(120)
    const ml = lectureOf(id)
    if (!ml.built) throw new ApiError(`transcript for ${id} not ready`, 404)
    return clone({ lectureId: id, segments: ml.built.segments })
  },
  async getHandout(id) {
    await delay(150)
    const ml = lectureOf(id)
    if (ml.lecture.status !== 'ready' || !ml.built) throw new ApiError(`handout for ${id} not ready (status ${ml.lecture.status})`, 404)
    return clone(ml.built.handout)
  },
  async getLectureCards(id) {
    await delay(120)
    const ml = lectureOf(id)
    if (ml.lecture.status !== 'ready' || !ml.built) throw new ApiError(`cards for ${id} not ready (status ${ml.lecture.status})`, 404)
    return clone({ coverage: ml.built.coverage, actions: { type: 'actions' as const, lectureId: id, commitments: ml.built.commitments, items: ml.built.actions } })
  },
  async addMarker(id, { atSec, note }) {
    await delay(250)
    const ml = lectureOf(id)
    if (!(atSec >= 0)) throw new ApiError('atSec must be a number ≥ 0', 400)
    if (note && note.length > 60) throw new ApiError('note must be ≤ 60 characters', 400)
    const m: StuckMarker = { id: uid('mk'), lectureId: id, atSec: Math.round(atSec), ...(note?.trim() ? { note: note.trim() } : {}), createdAt: new Date().toISOString() }
    ml.markers.push(m)
    if (ml.lecture.status !== 'ready' || !ml.built) return clone(m)
    // After the handout exists: resolve now, recompute the cards, append a short agent message.
    rebuild(ml, new Date())
    const resolved = ml.markers.find((x) => x.id === m.id)!
    const review = ml.built.actions.find((a) => a.provenance.markerId === m.id)
    push(thread(ml.studentId, 'academic_coach', ml.lecture.courseCode), {
      role: 'agent',
      agentId: 'academic_coach',
      createdAt: new Date().toISOString(),
      text: `Flag added at ${fmtMMSS(resolved.atSec)}${resolved.note ? ` (“${resolved.note}”)` : ''} → **${resolved.topic ?? 'this part'}**. ${review ? `I added a review item: “${review.title}”.` : 'That part already has a review item.'}`,
      cards: [clone(ml.built.coverage), { type: 'actions', lectureId: id, commitments: clone(ml.built.commitments), items: clone(ml.built.actions) }],
      trace: [{ tool: 'stuck_markers', summary: `marker at ${fmtMMSS(resolved.atSec)} → segment ${resolved.segmentId} → section ${resolved.handoutSectionId}; coverage + actions recomputed`, durationMs: 300 }],
    })
    return clone(resolved)
  },
  async getMarkers(id) {
    await delay(100)
    return clone(lectureOf(id).markers)
  },
  async getStudentLectures(studentId) {
    await delay(120)
    studentOf(studentId)
    const list = [...lectures.values()].filter((l) => l.studentId === studentId)
    list.forEach(advance)
    return clone(list.map((l) => l.lecture).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)))
  },
  async updateAction(id, status) {
    await delay(350)
    if (!['accepted', 'dismissed', 'done', 'proposed'].includes(status)) throw new ApiError('status must be one of proposed, accepted, dismissed, done', 400)
    const { ml, a } = findAction(id)
    const s = studentOf(ml.studentId)
    if (status === 'accepted' && a.status !== 'accepted') accept(a, s)
    else if ((status === 'dismissed' || status === 'proposed') && a.status === 'accepted') unaccept(a)
    a.status = status
    return clone(a)
  },

  // ---- Calendar
  async getCalendar(studentId, { from, to, courseCode }) {
    await delay(150)
    const s = studentOf(studentId)
    const list = calendar(s, parse(from), to.length === 10 ? new Date(parse(to).getTime() + DAY) : parse(to))
    return clone(courseCode ? list.filter((i) => i.courseCode === courseCode) : list)
  },
  async addTask(body: NewTask) {
    await delay(200)
    const s = studentOf(body.studentId)
    const title = (body.title ?? '').split(/\s+/).filter(Boolean).join(' ')
    if (!title) throw new ApiError('title is required', 400)
    if (title.length > 80) throw new ApiError('title must be at most 80 characters', 400)
    if (body.courseCode && !registered(s).some((c) => slug(c) === slug(body.courseCode!)))
      throw new ApiError(`${body.courseCode} is not one of this student's registered courses`, 400)
    const allDay = !!body.allDay || body.start.length === 10
    const start = parse(body.start)
    if (Number.isNaN(start.getTime())) throw new ApiError(`'${body.start}' is not an ISO date or datetime`, 400)
    const minutes = Math.round(Number(body.minutes ?? 0))
    if (!allDay && !(minutes > 0)) throw new ApiError('a timed task needs end or minutes (or allDay: true)', 400)
    if (!allDay && minutes > 480) throw new ApiError('a task can be at most 8 hours', 400)
    const it: CalendarItem = {
      id: `task:${uid('t')}`,
      studentId: s.id,
      kind: 'task',
      title,
      ...(body.courseCode ? { courseCode: body.courseCode } : {}),
      ...(allDay ? { start: ymd(start), allDay: true } : { start: isoLocal(start), end: isoLocal(new Date(start.getTime() + minutes * 60000)) }),
      source: { type: 'manual' },
      status: 'planned',
    }
    items.set(it.id, it)
    return clone(it)
  },
  async deleteTask(id) {
    await delay(150)
    const it = items.get(id)
    if (!it || it.source.type !== 'manual') throw new ApiError(`task ${id} not found (only tasks you added can be deleted)`, 404)
    items.delete(id)
    const removed = withStatus(it)
    statuses.delete(id)
    return clone(removed)
  },
  async setCalendarStatus(id, status) {
    await delay(200)
    if (!['planned', 'done', 'missed'].includes(status)) throw new ApiError('status must be one of planned, done, missed', 400)
    if (id.startsWith('class:') || id.startsWith('exam:')) throw new ApiError('status applies to study blocks, actions, prep and deadlines, not classes or exams', 400)
    const it = items.get(id)
    if (!it) throw new ApiError(`calendar item ${id} not found`, 404)
    statuses.set(id, status)
    return clone(withStatus(it))
  },

  // ---- Weekly 1:1
  async getOneOnOne(studentId) {
    await delay(300)
    return clone(currentOneOnOne(studentOf(studentId)))
  },
  async answerOneOnOne(id, { questionId, answer }) {
    await delay(200)
    const one = oneOnOnes.get(id)
    if (!one) throw new ApiError(`1:1 ${id} not found`, 404)
    if (one.status === 'done') throw new ApiError('this 1:1 is already complete', 400)
    const q = one.questions.find((x) => x.id === questionId)
    if (!q) throw new ApiError(`question ${questionId} not found`, 404)
    q.answer = answer
    one.status = 'in_progress'
    return clone(one)
  },
  async completeOneOnOne(id, { shareWithAdvisor }) {
    await delay(1400)
    const one = oneOnOnes.get(id)
    if (!one) throw new ApiError(`1:1 ${id} not found`, 404)
    if (one.status === 'done') return clone(one)
    const s = studentOf(one.studentId)
    const now = new Date()
    const missed = calendar(s, new Date(now.getTime() - 7 * DAY), now).filter((i) => STUDY.includes(i.kind) && i.status === 'missed' && i.courseCode && i.end)
    const carry = new Map<string, { course: string; topic: string; minutes: number }>()
    for (const i of missed) {
      const topic = i.title.replace(/^Study: /, '')
      const k = `${i.courseCode}|${topic}`
      const c = carry.get(k) ?? { course: i.courseCode!, topic, minutes: 0 }
      c.minutes += (parse(i.end!).getTime() - parse(i.start).getTime()) / 60000
      carry.set(k, c)
    }
    const res = buildPlan(s, { carry: [...carry.values()] })
    one.adjustedPlan = res.card
    one.status = 'done'
    one.shareWithAdvisor = shareWithAdvisor
    if (shareWithAdvisor) {
      const tid = `A-${101 + tickets.length}`
      const r = one.recap
      tickets.unshift({
        ticketId: tid,
        studentId: s.id,
        studentName: s.name,
        agentId: 'academic_coach',
        question: `Weekly 1:1 shared for review (${one.weekLabel})`,
        agentSummary: `${first(s)} did ${r.doneMinutes} of ${r.plannedMinutes} planned minutes (${r.blocksDone}/${r.blocksPlanned} blocks).${r.skippedTopics.length ? ` Skipped: ${r.skippedTopics.join(', ')}.` : ''}${r.flaggedTopics.length ? ` Flagged in class: ${r.flaggedTopics.map((f) => f.topic).join(', ')}.` : ''}${one.questions.some((q) => q.answer) ? ` Answers: ${one.questions.filter((q) => q.answer).map((q) => `“${q.answer}”`).join(' ')}` : ''} Adjusted plan moves ${[...carry.values()].map((c) => c.topic).join(', ') || 'nothing'} into the coming week.`,
        citations: [],
        status: 'open',
        createdAt: now.toISOString(),
      })
    }
    return clone(one)
  },

  // ---- Make it Relevant
  async makeRelevant({ studentId, interest, source }) {
    await delay(1100)
    const s = studentOf(studentId)
    const card = relevantFor(s, interest || s.interests[0] || 'everyday life', source)
    const list = relevant.get(studentId) ?? []
    list.push(card)
    relevant.set(studentId, list)
    return clone(card)
  },
  async getRelevant(studentId) {
    await delay(100)
    studentOf(studentId)
    return clone(relevant.get(studentId) ?? [])
  },
}

