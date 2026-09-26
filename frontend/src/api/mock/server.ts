// In-browser mock of the FastAPI backend (MOCK=true). Same endpoints and shapes as contracts.ts.
// Replies are canned and keyword-routed — this is a UI harness, not the product.
import type { AgentId, Card, Citation, Escalation, Message, Student, StudentState, Thread, Ticket, WorkspaceFile } from '@/types'
import { ApiError, type Api } from '../client'
import {
  AGENTS, CHANNELS, CONNECTORS, COURSES, DOCS, DOC_UPDATED, PLAN, Q, RELEVANT, STUDENTS, WEAK,
  auditCitations, auditFor, auditText, picksCard, resourcesCard, skillsFor,
} from './data'

type Draft = Pick<Message, 'role' | 'text' | 'citations' | 'cards' | 'trace'> & {
  agentId?: AgentId
  replyToParent?: boolean
  escalation?: Escalation
}
type Reply = { drafts: Draft[]; escalate?: { reason: Escalation['reason']; summary: string; citations: Citation[] } }

const first = (s: Student) => s.name.split(' ')[0]!
const clone = <T,>(x: T): T => structuredClone(x)
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

let seq = 0
const nextId = (p: string) => `${p}-${++seq}`

// ---------------------------------------------------------------------------
// Canned replies

const R = {
  audit: (s: Student, at: string): Draft => ({
    role: 'agent', agentId: 'academic_coach', text: (auditText[s.id] ?? auditText.s1!)(first(s)),
    citations: auditCitations(s.id), cards: [auditFor(s.id, at)],
    trace: [
      { tool: 'run_degree_audit', summary: 'Extracted rules from Handbook §3–4 + 3 circulars; counted credits per bucket from transcript', durationMs: 2600 },
      { tool: 'resolve_overrides', summary: s.id === 's3' ? 'Circular 2026-03 excludes the 2025 batch — Handbook §4.1 stands' : 'Circular 2026-03 (1 Aug 2026) overrides Handbook §4.1: electives 4 → 5', durationMs: 400 },
    ],
  }),
  weakPlan: (): Draft => ({
    role: 'agent', agentId: 'academic_coach',
    text: 'Focus on **normalization** and **transactions** — together they’re 35% of the paper [C1] and your two weakest quiz scores. BCNF has shown up in every mid-sem since 2023 [C3]. The exam is on 8 October [C2], so I’ve built a two-week plan that front-loads both.',
    citations: [Q.blueprint('C1'), Q.examDate('C2'), Q.bcnfPapers('C3'), Q.blueprintRest('C4')], cards: [clone(WEAK), clone(PLAN)],
    trace: [
      { tool: 'diagnose_performance', summary: '6 DBMS internal marks × 2023–25 topic weights → 4 weak topics ranked by impact', durationMs: 1400 },
      { tool: 'build_study_plan', summary: '8 blocks over 2 weeks to the 8 Oct mid-sem, 490 min total', durationMs: 1300 },
    ],
  }),
  relevant: (): Draft => ({
    role: 'agent', agentId: 'academic_coach',
    text: 'Think of a B+ tree as a **tournament draw**. Every team (record) sits at the bottom level, and the rounds above only tell you which half of the draw to look in [C1]. Side-by-side version in the panel.',
    citations: [Q.btree('C1')], cards: [clone(RELEVANT)],
    trace: [{ tool: 'make_it_relevant', summary: 'Reframed Unit 5 · B+ trees through cricket; facts unchanged', durationMs: 1100 }],
  }),
  overload: (agentId: AgentId): Reply => ({
    drafts: [{
      role: 'agent', agentId,
      text: 'Registering above 25 units needs Associate Dean approval and a CGPA of at least 8.0 [C1]. I can’t approve that myself, so I’ve sent your request to your advisor with a summary of your audit.',
      citations: [Q.overload('C1')], cards: [],
      trace: [{ tool: 'check_policy', summary: 'Found Handbook §5.4 Unit overload', durationMs: 900 }, { tool: 'escalate', summary: 'Opened a ticket for the Human Advisor', durationMs: 500 }],
    }],
    escalate: { reason: 'needs_human', summary: 'Handbook §5.4 caps registration at 25 units without Associate Dean approval and a CGPA of at least 8.0. Needs an advisor recommendation.', citations: [Q.overload('C1'), Q.circ('C2')] },
  }),
  outOfScope: (agentId: AgentId): Reply => ({
    drafts: [{
      role: 'agent', agentId,
      text: 'That’s outside what I can answer — fee extensions and medical cases aren’t covered by the documents I read, and I won’t guess. I’ve opened a ticket with your advisor with your question attached; their reply will land here.',
      citations: [], cards: [],
      trace: [{ tool: 'check_scope', summary: 'No section in scope covers this question', durationMs: 600 }, { tool: 'escalate', summary: 'Opened a ticket for the Human Advisor', durationMs: 400 }],
    }],
    escalate: { reason: 'out_of_scope', summary: 'Out of scope for the agent: no handbook section or circular covers this. Needs a human decision.', citations: [] },
  }),
  courses: (s: Student): Draft => {
    const sk = skillsFor(s.careerGoal, 'C4')
    return {
      role: 'agent', agentId: 'course_planner',
      text: `Three discipline electives fit cleanly. **Data Mining** is the easiest — Tue/Thu mornings, nothing else in T3 [C1]. **Machine Learning** clashes with PoPL in slot M2 [C2], so only take it if you drop PoPL.\n- For your open elective, *ECON F211* counts for every programme [C3]\n- For ${s.careerGoal} roles you’re still missing ${sk.card.missing.join(' and ').toLowerCase()} [C4]`,
      citations: [Q.dm('C1'), Q.ml('C2'), Q.econ('C3'), sk.citation, Q.ir('C5')], cards: [clone(COURSES), sk.card],
      trace: [
        { tool: 'recommend_courses', summary: 'Read audit gap from StudentState; checked slots, prereqs and bucket for each elective', durationMs: 1500 },
        { tool: 'skills_gap', summary: `${s.careerGoal} profile vs skill tags on taken + recommended courses`, durationMs: 900 },
      ],
    }
  },
  skills: (s: Student): Draft => {
    const sk = skillsFor(s.careerGoal, 'C1')
    return {
      role: 'agent', agentId: 'course_planner',
      text: `${s.careerGoal} listings ask for a specific set of skills [C1]. You already cover ${sk.card.covered.map((c) => c.skill).join(', ')}; your planned courses add ${sk.card.coveredAfterPlan.map((c) => c.skill).join(' and ')}. What’s missing is **${sk.card.missing.join('** and **')}**.`,
      citations: [sk.citation], cards: [sk.card],
      trace: [{ tool: 'skills_gap', summary: `${s.careerGoal} profile vs skill tags on taken + recommended courses`, durationMs: 900 }],
    }
  },
  clash: (): Draft => ({
    role: 'agent', agentId: 'course_planner',
    text: 'Yes — **Machine Learning** shares slot M2 with CS F301 PoPL [C1]. **Data Mining** in T3 has no clash with your registered courses [C2].',
    citations: [Q.ml('C1'), Q.dm('C2')], cards: [],
    trace: [{ tool: 'recommend_courses', summary: 'Checked slot M2 against your registrations', durationMs: 800 }],
  }),
  campus: (): Draft => ({
    role: 'agent', agentId: 'campus_guide',
    text: 'For DBMS, TA hours are Tue/Thu 5–6 PM in Room 2203 [C1] and Dr. Sharma’s office hours are Wednesday 3–4 PM [C2]; five years of past papers are in the Moodle Question Bank [C3].\nOn campus: **Shutterbugs** runs night photo walks every second Friday [C4] and the **ACM reading group** meets Wednesdays at 6 [C5]. Wildcard: Saturday’s pop-culture quiz [C6] — nothing to do with your interests, which is the point. I’ve pinged both clubs — replies below.',
    citations: [Q.taDbms('C1'), Q.faculty('C2'), Q.papers('C3'), Q.photo('C4'), Q.acm('C5'), Q.quiz('C6'), Q.tutoring('C7'), Q.lab('C8')],
    cards: [resourcesCard(['C1', 'C2', 'C3', 'C7', 'C8']), picksCard(['C4', 'C5', 'C6'])],
    trace: [
      { tool: 'find_resources', summary: 'Matched 5 resources to your weak topics in CS F212', durationMs: 800 },
      { tool: 'discover', summary: 'Club feed + events vs your interests → 2 picks + 1 wildcard', durationMs: 900 },
    ],
  }),
  resources: (): Draft => ({
    role: 'agent', agentId: 'campus_guide',
    text: 'Five years of mid-sem papers are in the Moodle Question Bank [C3]. TA hours for DBMS are Tue/Thu 5–6 PM in Room 2203 [C1], and the library is open until 2 AM during mid-sems [C4].',
    citations: [Q.taDbms('C1'), Q.faculty('C2'), Q.papers('C3'), Q.libHours('C4'), Q.tutoring('C5'), Q.lab('C6')],
    cards: [resourcesCard(['C1', 'C2', 'C3', 'C5', 'C6'])],
    trace: [{ tool: 'find_resources', summary: 'Matched 5 resources for CS F212', durationMs: 800 }],
  }),
  picks: (): Draft => ({
    role: 'agent', agentId: 'campus_guide',
    text: 'Two solid fits and one wildcard. **Shutterbugs** runs night photo walks every second Friday [C1]; the **ACM reading group** meets Wednesdays at 6 [C2]. The wildcard is Saturday’s pop-culture quiz [C3].',
    citations: [Q.photo('C1'), Q.acm('C2'), Q.quiz('C3')], cards: [picksCard(['C1', 'C2', 'C3'])],
    trace: [{ tool: 'discover', summary: 'Club feed + events vs your interests → 2 picks + 1 wildcard', durationMs: 900 }],
  }),
  clubReplies: (s: Student): Draft[] => [
    { role: 'agent', agentId: 'club:shutterbugs', replyToParent: true, text: `Hey ${first(s)}! Night walks run every second Friday from the Clock Tower [C1] — no camera needed, phones are fine.`, citations: [Q.photo('C1')], cards: [], trace: [] },
    { role: 'agent', agentId: 'club:acm', replyToParent: true, text: 'We meet Wednesdays at 6 PM in Room 6105 [C1] — one paper a week, presented by members. Come by and just listen in the first time.', citations: [Q.acm('C1')], cards: [], trace: [] },
  ],
  generic: (agentId: AgentId): Draft =>
    agentId === 'course_planner'
      ? { role: 'agent', agentId, text: 'ECON F211 fills your open elective and counts for every programme [C1]. It’s Wednesday at 4, so it doesn’t clash with your core.', citations: [Q.econ('C1')], cards: [], trace: [{ tool: 'recommend_courses', summary: 'Filtered open electives', durationMs: 1000 }] }
      : agentId === 'campus_guide'
        ? { role: 'agent', agentId, text: 'The library stays open until 2 AM from 1 to 13 October [C1], and discussion rooms can be booked in 2-hour slots.', citations: [Q.libHours('C1')], cards: [], trace: [{ tool: 'find_resources', summary: 'Checked library circulars', durationMs: 800 }] }
        : { role: 'agent', agentId, text: 'Nothing in that changes your graduation date. The rule that applies is the 142-unit requirement [C1]; your latest audit is in the panel.', citations: [Q.credits('C1')], cards: [], trace: [{ tool: 'run_degree_audit', summary: 'Read cached audit from StudentState', durationMs: 300 }] },
}

function replyFor(agentId: AgentId, text: string, s: Student): Reply {
  const t = text.toLowerCase()
  if (/fee|extension|medical|hostel|refund|scholarship/.test(t)) return R.outOfScope(agentId)
  if (agentId === 'academic_coach') {
    if (/overload|units next/.test(t)) return R.overload(agentId)
    if (/explain|relevant|through|analogy/.test(t)) return { drafts: [R.relevant()] }
    if (/struggl|weak|dbms|study|plan|exam|mid-?sem/.test(t)) return { drafts: [R.weakPlan()] }
    if (/track|graduat|audit|on time|credit/.test(t)) return { drafts: [R.audit(s, new Date().toISOString())] }
    return { drafts: [R.generic(agentId)] }
  }
  if (agentId === 'course_planner') {
    if (/clash/.test(t)) return { drafts: [R.clash()] }
    if (/skill|missing|gap|job|role/.test(t) && !/take|next sem/.test(t)) return { drafts: [R.skills(s)] }
    if (/take|course|elective|next sem|recommend/.test(t)) return { drafts: [R.courses(s)] }
    return { drafts: [R.generic(agentId)] }
  }
  if (agentId === 'campus_guide') {
    const help = /help|resource|\bta\b|library|tutor|lab|paper/.test(t)
    const fun = /happening|club|event|campus|surprise|weekend/.test(t)
    if (help && fun) return { drafts: [R.campus(), ...R.clubReplies(s)] }
    if (help) return { drafts: [R.resources()] }
    if (fun) return { drafts: [R.picks(), ...R.clubReplies(s).slice(0, 1)] }
    return { drafts: [R.generic(agentId)] }
  }
  throw new ApiError(`Unknown agent ${agentId}`)
}

// ---------------------------------------------------------------------------
// In-memory "database"

const threads = new Map<string, Thread>()
const states = new Map<string, StudentState>()
const tickets: Ticket[] = []
const failedOnce = new Set<string>()

function thread(studentId: string, agentId: AgentId): Thread {
  const id = `${studentId}:${agentId}`
  let t = threads.get(id)
  if (!t) threads.set(id, (t = { id, studentId, agentId, messages: [] }))
  return t
}

function studentOf(id: string): Student {
  const s = STUDENTS.find((x) => x.id === id)
  if (!s) throw new ApiError(`Unknown student ${id}`)
  return s
}

/** Agents write their cards to shared state; other agents read it (AGENTS.md §3). */
function writeState(studentId: string, cards: Card[], at: string) {
  const st = states.get(studentId)
  if (!st) return
  for (const c of cards) {
    if (c.type === 'audit') st.audit = c
    if (c.type === 'weak_topics') st.weakTopics = c
    if (c.type === 'study_plan') st.plan = c
    if (c.type === 'skills_gap') st.skillsGap = c
  }
  st.updatedAt = at
}

/** Append a reply to a thread; opens a ticket when the reply escalates. */
function commit(s: Student, agentId: AgentId, question: string, reply: Reply, at: string, ticketId?: string): Message[] {
  const t = thread(s.id, agentId)
  t.messages.push({ id: nextId('m'), threadId: t.id, role: 'student', createdAt: at, text: question, citations: [], cards: [], trace: [] })
  let parentId: string | undefined
  const out = reply.drafts.map((d, i) => {
    const { replyToParent, ...rest } = d
    const m: Message = { id: nextId('m'), threadId: t.id, createdAt: at, ...rest, replyToId: replyToParent ? parentId : undefined }
    if (i === 0) parentId = m.id
    return m
  })
  if (reply.escalate && out[0]) {
    const tid = ticketId ?? `A-${105 + tickets.length}`
    out[0].escalation = { ticketId: tid, status: 'open', reason: reply.escalate.reason }
    out[0].trace = out[0].trace.map((x) => (x.tool === 'escalate' ? { ...x, summary: `Opened ticket #${tid} for the Human Advisor` } : x))
    tickets.unshift({
      ticketId: tid, studentId: s.id, studentName: s.name, agentId, question,
      agentSummary: `${first(s)} (${s.program}, Sem ${s.semester}) asked this. ${reply.escalate.summary}`,
      citations: reply.escalate.citations, status: 'open', createdAt: at,
    })
  }
  t.messages.push(...out)
  writeState(s.id, out.flatMap((m) => m.cards), at)
  return out
}

function answer(ticketId: string, text: string, at: string): Ticket {
  const tk = tickets.find((x) => x.ticketId === ticketId)
  if (!tk) throw new ApiError(`Unknown ticket ${ticketId}`)
  if (tk.status === 'answered') throw new ApiError(`Ticket #${ticketId} is already answered`)
  tk.status = 'answered'
  tk.reply = { text, at }
  const t = thread(tk.studentId, tk.agentId)
  for (const m of t.messages) if (m.escalation?.ticketId === ticketId) m.escalation.status = 'answered'
  t.messages.push({ id: nextId('m'), threadId: t.id, role: 'advisor', createdAt: at, text, citations: [], cards: [], trace: [] })
  return tk
}

// Seed: Aarav and Priya have history; Rohan starts empty (shows the empty state + starters).
function seed() {
  for (const s of STUDENTS) {
    states.set(s.id, { studentId: s.id, audit: auditFor(s.id, minsAgo(200)), updatedAt: minsAgo(200) })
    if (s.id === 's3') continue
    commit(s, 'academic_coach', 'Am I on track to graduate on time?', { drafts: [R.audit(s, minsAgo(190))] }, minsAgo(190))
    if (s.id === 's1') commit(s, 'academic_coach', 'I’m struggling in DBMS', { drafts: [R.weakPlan()] }, minsAgo(172))
    commit(s, 'academic_coach', 'Can I overload to 28 units next sem?', R.overload('academic_coach'), s.id === 's1' ? minsAgo(96) : minsAgo(160), s.id === 's1' ? 'A-104' : 'A-101')
    if (s.id === 's2') answer('A-101', 'Priya — you qualify. I’ve recommended it to the Associate Dean’s office. Submit form AUGSD-7 in the ERP by 3 October and I’ll sign it the same day.', minsAgo(131))
    commit(s, 'course_planner', 'What should I take next sem? I want data analyst roles.', { drafts: [R.courses(s)] }, minsAgo(150))
    commit(s, 'campus_guide', 'Who can help me with DBMS, and what’s happening on campus?', { drafts: [R.campus(), ...R.clubReplies(s)] }, minsAgo(118))
  }
}
seed()

// ---------------------------------------------------------------------------

export const mockApi: Api = {
  async getStudents() {
    await delay(150)
    return clone(STUDENTS)
  },
  async getWorkspace(studentId) {
    await delay(200)
    studentOf(studentId)
    return clone({ channels: CHANNELS, agents: AGENTS, connectors: CONNECTORS })
  },
  async getStudentState(studentId) {
    await delay(250)
    studentOf(studentId)
    return clone(states.get(studentId)!)
  },
  async getFiles(studentId) {
    await delay(200)
    const st = states.get(studentOf(studentId).id)!
    const docs: WorkspaceFile[] = DOCS.map((d) => ({
      kind: 'document', id: d.id, title: d.title, docKind: d.kind, connectorId: d.connectorId,
      effectiveDate: d.effectiveDate, updatedAt: DOC_UPDATED[d.id] ?? '2026-09-01',
    }))
    const canvases: WorkspaceFile[] = []
    if (st.audit) canvases.push({ kind: 'canvas', id: 'canvas-audit', title: 'Degree audit', canvasKind: 'audit_report', cardType: 'audit', updatedAt: st.audit.computedAt })
    if (st.plan) canvases.push({ kind: 'canvas', id: 'canvas-plan', title: 'Study plan', canvasKind: 'study_plan', cardType: 'study_plan', updatedAt: st.updatedAt })
    const cp = thread(studentId, 'course_planner').messages.filter((m) => m.cards.some((c) => c.type === 'courses')).at(-1)
    if (cp) canvases.push({ kind: 'canvas', id: 'canvas-courses', title: 'Next-sem course shortlist', canvasKind: 'course_plan', cardType: 'courses', updatedAt: cp.createdAt })
    return clone([...canvases, ...docs])
  },
  async getDocument(docId) {
    await delay(150)
    const d = DOCS.find((x) => x.id === docId)
    if (!d) throw new ApiError(`Document ${docId} not found`)
    return clone(d)
  },
  async getThread(studentId, agentId) {
    await delay(200)
    studentOf(studentId)
    return clone(thread(studentId, agentId))
  },
  async chat({ studentId, agentId, text }) {
    await delay(1400 + Math.random() * 900)
    const s = studentOf(studentId)
    if (/\b(fail|error)\b/i.test(text) && !failedOnce.has(text)) {
      failedOnce.add(text) // fails once, so "try again" demonstrates recovery
      throw new ApiError('Simulated tool failure (mock) — retry to recover')
    }
    return clone(commit(s, agentId, text, replyFor(agentId, text, s), new Date().toISOString()))
  },
  async getInbox() {
    await delay(150)
    return clone(tickets)
  },
  async advisorReply({ ticketId, text }) {
    await delay(300)
    return clone(answer(ticketId, text, new Date().toISOString()))
  },
}
