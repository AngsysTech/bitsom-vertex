// MOCK ONLY. Reads the synthetic dataset straight from backend/app/data, so the mock can't drift from it,
// and parses it with the same section-id scheme as backend/app/core/parser.py (handbook.3.2,
// syllabus.cs-f212.3.5, past_papers.cs-f212.b-trees, exam_calendar.cs-f212). Nothing here is model output.
import type { Connector, Document, DocumentSection } from '@/types'

const RAW = import.meta.glob<string>(['../../../../backend/app/data/**/*.{json,md}', '!**/AUDIT.md', '!**/README.md'], { eager: true, query: '?raw', import: 'default' })
const ROOT = '/backend/app/data/'

function entries(prefix: string): [string, string][] {
  return Object.entries(RAW)
    .map(([k, v]) => [k.slice(k.indexOf(ROOT) + ROOT.length), v] as [string, string])
    .filter(([rel]) => rel.startsWith(prefix) && !rel.endsWith('README.md'))
    .sort(([a], [b]) => a.localeCompare(b))
}

function file(rel: string): string {
  const hit = entries(rel).find(([k]) => k === rel)
  if (!hit) throw new Error(`Mock dataset: ${rel} not found under backend/app/data (the mock reads the real dataset)`)
  return hit[1]
}

const json = <T,>(rel: string): T => JSON.parse(file(rel)) as T

export const slug = (code: string) => code.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const normTopic = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function frontMatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(text)
  if (!m) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return { meta, body: text.slice(m[0].length) }
}

// ---------------------------------------------------------------------------
// Records

export interface DStudent {
  id: string
  name: string
  program: string
  semester: number
  careerGoal: string
  interests: string[]
  avatarEmoji?: string
  registrations: { connectorId: string; rows: { courseCode: string; semester: number; status: 'registered' | 'waitlisted' }[] }
  internalMarks: { connectorId: string; rows: { courseCode: string; component: string; topic?: string; scored: number; max: number; date: string }[] }
}

export const STUDENTS: DStudent[] = entries('students/').map(([, v]) => JSON.parse(v) as DStudent)

export interface DCourse {
  code: string
  title: string
  units: number
  bucket: string
  slot: string
  faculty: string
}
export const COURSES: DCourse[] = json<{ courses: DCourse[] }>('catalog.json').courses
export const course = (code: string) => COURSES.find((c) => c.code === code)

export interface DSession {
  courseCode: string
  day: string
  start: string
  end: string
  room: string
  kind: string
}
export const TIMETABLE: DSession[] = json<{ rows: DSession[] }>('timetable.json').rows

export interface DExamCourse {
  courseCode: string
  midSemDate: string
  endSemDate: string
  quizDates: string[]
  weightages?: { quizzes: number; midSem: number; endSem: number }
}
export const EXAM_COURSES: DExamCourse[] = json<{ courses: DExamCourse[] }>('exam_calendar.json').courses

export interface DExam {
  id: string
  courseCode: string
  kind: 'quiz' | 'exam'
  component: 'Quiz 1' | 'Quiz 2' | 'Mid-sem' | 'End-sem' | string
  title: string
  date: string // YYYY-MM-DD, all-day: the calendar has dates only, so no time is invented
}
export const EXAMS: DExam[] = EXAM_COURSES.flatMap((c) => {
  const s = slug(c.courseCode)
  const rows: DExam[] = c.quizDates.map((d, i) => ({ id: `${s}-quiz${i + 1}`, courseCode: c.courseCode, kind: 'quiz', component: `Quiz ${i + 1}`, title: `${c.courseCode} Quiz ${i + 1}`, date: d }))
  rows.push({ id: `${s}-midsem`, courseCode: c.courseCode, kind: 'exam', component: 'Mid-sem', title: `${c.courseCode} Mid-sem exam`, date: c.midSemDate })
  rows.push({ id: `${s}-endsem`, courseCode: c.courseCode, kind: 'exam', component: 'End-sem', title: `${c.courseCode} End-sem exam`, date: c.endSemDate })
  return rows
}).sort((a, b) => a.date.localeCompare(b.date))

export const CONNECTORS: Connector[] = json<Connector[]>('connectors.json')

// ---------------------------------------------------------------------------
// Past papers: topic → marks per year (end-sems)

interface DPaperCourse {
  courseCode: string
  papers: { year: number; topicMarks: Record<string, number> }[]
}
const PAPERS: DPaperCourse[] = json<{ courses: DPaperCourse[] }>('past_papers.json').courses

export const pastPapersSectionId = (code: string, topic: string) => `past_papers.${slug(code)}.${normTopic(topic).replace(/ /g, '-')}`

export interface TopicWeight {
  marks: { year: number; marks: number }[]
  mean: number
  min: number
  max: number
  sectionId: string
}

export function topicWeight(code: string, topic: string): TopicWeight | undefined {
  const c = PAPERS.find((p) => p.courseCode === code)
  if (!c) return undefined
  const marks = c.papers
    .map((p) => ({ year: p.year, marks: Object.entries(p.topicMarks).find(([t]) => normTopic(t) === normTopic(topic))?.[1] ?? 0 }))
    .sort((a, b) => a.year - b.year)
    .slice(-3)
  if (!marks.some((m) => m.marks > 0)) return undefined
  const vals = marks.map((m) => m.marks)
  return { marks, mean: vals.reduce((a, b) => a + b, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals), sectionId: pastPapersSectionId(code, topic) }
}

/** "carried 16–18 marks in the last 3 end-sems" (same wording as the backend's weight facts). */
export const weightFact = (w: TopicWeight) => `carried ${w.min === w.max ? w.min : `${w.min}–${w.max}`} marks in the last ${w.marks.length} end-sems`

/** The heaviest topic across every course; impact is scaled to it (0–100), like tools/diagnose.py. */
export const HEAVIEST_MEAN = Math.max(
  ...PAPERS.flatMap((c) => Object.keys(c.papers[0]?.topicMarks ?? {}).map((t) => topicWeight(c.courseCode, t)?.mean ?? 0)),
)

// ---------------------------------------------------------------------------
// Syllabus

export interface DTopic {
  id: string // syllabus.cs-f212.3.5
  title: string
  unitTitle: string // "Unit 3: Transactions and concurrency"
  unitNumber: string
  text: string
}
export interface DSyllabus {
  courseCode: string
  docId: string
  title: string
  connectorId: string
  effectiveDate?: string
  topics: DTopic[]
}

export const SYLLABI: DSyllabus[] = entries('syllabus/').map(([rel, text]) => {
  const { meta, body } = frontMatter(text)
  const code = meta.courseCode ?? rel
  const docId = `syllabus.${slug(code)}`
  const topics: DTopic[] = []
  let unit: { number: string; title: string; count: number } | null = null
  let current: DTopic | null = null
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const h2 = /^##\s+(.*)$/.exec(line)
    if (h2 && !line.startsWith('###')) {
      const title = h2[1]!.trim()
      unit = { number: /\bunit\s+(\d+)/i.exec(title)?.[1] ?? '0', title, count: 0 }
      current = null
      continue
    }
    const h3 = /^###\s+(.*)$/.exec(line)
    if (h3 && unit) {
      unit.count += 1
      current = { id: `${docId}.${unit.number}.${unit.count}`, title: h3[1]!.trim(), unitTitle: unit.title, unitNumber: unit.number, text: '' }
      topics.push(current)
      continue
    }
    if (line && current) current.text = current.text ? `${current.text} ${line}` : line
  }
  return { courseCode: code, docId, title: meta.title ?? `${code} syllabus`, connectorId: meta.connectorId ?? 'lms_moodle', effectiveDate: meta.effectiveDate, topics }
})

export const syllabus = (code: string) => SYLLABI.find((s) => s.courseCode === code)
export const topicByTitle = (code: string, title: string) => syllabus(code)?.topics.find((t) => normTopic(t.title) === normTopic(title))

// ---------------------------------------------------------------------------
// Lecture transcripts (the text fallback path)

export interface DLecture {
  file: string
  courseCode: string
  date: string
  unit: string
  lecturer: string
  text: string
}
export const LECTURES: DLecture[] = entries('lectures/').map(([rel, text]) => {
  const { meta, body } = frontMatter(text)
  return {
    file: rel.replace('lectures/', ''),
    courseCode: meta.courseCode ?? '',
    date: meta.date ?? '',
    unit: meta.unit ?? '',
    lecturer: meta.lecturer ?? '',
    text: body
      .split('\n')
      .filter((l) => !l.startsWith('#'))
      .join('\n')
      .trim(),
  }
})
export const sampleLecture = (code: string) => LECTURES.find((l) => l.courseCode === code)

// ---------------------------------------------------------------------------
// Documents (citation targets) — the same set the backend parser loads

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  const dt = new Date(y, m - 1, d)
  return `${DOW[dt.getDay()]} ${d} ${MON[m - 1]} ${y}`
}

function markdownSections(docId: string, body: string): DocumentSection[] {
  const out: DocumentSection[] = []
  let heading: string | null = null
  let lines: string[] = []
  const flush = () => {
    if (heading == null) return
    const num = /^(\d+(?:\.\d+)*)\b/.exec(heading)
    out.push({ id: `${docId}.${num ? num[1] : out.length + 1}`, heading, text: lines.join('\n').trim() || heading })
  }
  for (const raw of body.split('\n')) {
    const h2 = /^##\s+(.*)$/.exec(raw.trim())
    if (h2 && !raw.trim().startsWith('###')) {
      flush()
      heading = h2[1]!.trim()
      lines = []
    } else if (heading != null && !raw.trim().startsWith('# ')) lines.push(raw.trimEnd())
  }
  flush()
  return out
}

function buildDocs(): Document[] {
  const docs: Document[] = []
  const hb = frontMatter(file('handbook.md'))
  docs.push({ id: 'handbook', kind: 'handbook', title: hb.meta.title ?? 'Academic Handbook', connectorId: hb.meta.connectorId ?? 'erp_core', effectiveDate: hb.meta.effectiveDate, sections: markdownSections('handbook', hb.body) })
  for (const [rel, text] of entries('circulars/')) {
    const { meta, body } = frontMatter(text)
    const id = `circular.${rel.replace('circulars/', '').replace(/\.md$/, '')}`
    docs.push({ id, kind: 'circular', title: meta.title ?? id, connectorId: meta.connectorId ?? 'academic_office', effectiveDate: meta.effectiveDate, sections: markdownSections(id, body) })
  }
  docs.push({
    id: 'catalog',
    kind: 'catalog',
    title: 'Course Catalog',
    connectorId: 'erp_core',
    sections: COURSES.map((c) => ({ id: `catalog.${slug(c.code)}`, heading: `${c.code} ${c.title}`, text: `${c.code} ${c.title}: ${c.units} units, ${c.bucket} bucket, slot ${c.slot}, taught by ${c.faculty}.` })),
  })
  for (const s of SYLLABI)
    docs.push({ id: s.docId, kind: 'syllabus', title: `${s.courseCode} ${s.title}`, connectorId: s.connectorId, effectiveDate: s.effectiveDate, sections: s.topics.map((t) => ({ id: t.id, heading: `${t.unitTitle} › ${t.title}`, text: t.text || t.title })) })
  docs.push({
    id: 'exam_calendar',
    kind: 'exam_calendar',
    title: 'Semester 5 Exam Calendar',
    connectorId: 'academic_office',
    sections: EXAM_COURSES.map((c) => {
      const rows = EXAMS.filter((e) => e.courseCode === c.courseCode).map((e) => `${c.courseCode} ${e.component}: ${fmtDay(e.date)} (${e.date}).`)
      const w = c.weightages ? ` Weightage: quizzes ${c.weightages.quizzes}%, mid-sem ${c.weightages.midSem}%, end-sem ${c.weightages.endSem}%.` : ''
      return { id: `exam_calendar.${slug(c.courseCode)}`, heading: `${c.courseCode} ${course(c.courseCode)?.title ?? ''}`.trim(), text: rows.join(' ') + w }
    }),
  })
  docs.push({
    id: 'past_papers',
    kind: 'past_papers',
    title: 'Past papers: topic marks, 2023–2025',
    connectorId: 'academic_office',
    sections: PAPERS.flatMap((c) =>
      Object.keys(c.papers[0]?.topicMarks ?? {}).map((topic) => {
        const spans = c.papers
          .slice()
          .sort((a, b) => a.year - b.year)
          .map((p) => `${p.topicMarks[topic] ?? 0} marks in the ${p.year} end-sem`)
        const listed = spans.length === 1 ? spans[0] : `${spans.slice(0, -1).join(', ')} and ${spans.at(-1)}`
        return { id: pastPapersSectionId(c.courseCode, topic), heading: `${c.courseCode} · ${topic}`, text: `${topic} (${c.courseCode}) carried ${listed}.` }
      }),
    ),
  })
  return docs
}

export const DOCS: Document[] = buildDocs()
export const findSection = (sectionId: string) => {
  for (const d of DOCS) {
    const s = d.sections.find((x) => x.id === sectionId)
    if (s) return { doc: d, section: s }
  }
  return undefined
}
