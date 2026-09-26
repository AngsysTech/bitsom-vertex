import { API_URL } from '@/lib/config'
import type { ActionsCard, Card, CoverageCard, Handout, Message, OneOnOne, Thread, Ticket } from '@/types'
import { ApiError, type Api } from './client'

// Defensive defaults so a backend that omits an empty array can't crash rendering mid-demo.
const coverage = (c: CoverageCard): CoverageCard => ({
  ...c,
  covered: c.covered ?? [],
  missed: c.missed ?? [],
  emphasized: c.emphasized ?? [],
  confusion: c.confusion ?? [],
})
const actions = (a: ActionsCard): ActionsCard => ({ ...a, commitments: a.commitments ?? [], items: a.items ?? [] })
const oneOnOne = (o: OneOnOne): OneOnOne => ({
  ...o,
  recap: {
    ...o.recap,
    completedTopics: o.recap?.completedTopics ?? [],
    skippedTopics: o.recap?.skippedTopics ?? [],
    weakTopicMovement: o.recap?.weakTopicMovement ?? [],
    flaggedTopics: o.recap?.flaggedTopics ?? [],
  },
  wins: o.wins ?? [],
  concerns: o.concerns ?? [],
  questions: o.questions ?? [],
  proposedAdjustments: o.proposedAdjustments ?? [],
})
const card = (c: Card): Card =>
  c.type === 'coverage' ? coverage(c) : c.type === 'actions' ? actions(c) : c.type === 'one_on_one' ? { ...c, oneOnOne: oneOnOne(c.oneOnOne) } : c
const msg = (m: Message): Message => ({ ...m, citations: m.citations ?? [], cards: (m.cards ?? []).map(card), trace: m.trace ?? [] })
const thread = (t: Thread): Thread => ({ ...t, messages: (t.messages ?? []).map(msg) })
const ticket = (t: Ticket): Ticket => ({ ...t, citations: t.citations ?? [] })
const handout = (h: Handout): Handout => ({
  ...h,
  sections: (h.sections ?? []).map((s) => ({
    ...s,
    keyPoints: s.keyPoints ?? [],
    definitions: s.definitions ?? [],
    examples: s.examples ?? [],
    examHints: s.examHints ?? [],
    segmentIds: s.segmentIds ?? [],
  })),
})

const enc = encodeURIComponent

async function req<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response
  const form = body instanceof FormData
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: body === undefined || form ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(`Can't reach the backend at ${API_URL}`)
  }
  const data = await res.json().catch(() => null)
  // Backend errors are {error: string} with 4xx/5xx (contracts.ts §10).
  if (!res.ok) throw new ApiError(data?.error ?? data?.detail ?? `${res.status} ${res.statusText}`, res.status)
  return data as T
}

const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const httpApi: Api = {
  getStudents: () => req('GET', '/students'),
  addInterest: (studentId, interest) => req('POST', `/students/${enc(studentId)}/interests`, { interest }),
  removeInterest: (studentId, interest) => req('DELETE', `/students/${enc(studentId)}/interests/${enc(interest)}`),
  getWorkspace: (studentId) =>
    req<Awaited<ReturnType<Api['getWorkspace']>>>('GET', `/workspace/${enc(studentId)}`).then((w) => ({
      channels: w.channels ?? [],
      classes: w.classes ?? [],
      agents: w.agents ?? [],
      connectors: w.connectors ?? [],
    })),
  getClasses: (studentId) => req('GET', `/classes/${enc(studentId)}`),
  getStudentState: (studentId) => req('GET', `/students/${enc(studentId)}/state`),
  getFiles: (studentId) => req('GET', `/files/${enc(studentId)}`),
  getDocument: (docId) => req('GET', `/documents/${enc(docId)}`),
  getThread: (studentId, agentId) => req<Thread>('GET', `/threads/${enc(studentId)}/${enc(agentId)}`).then(thread),
  getClassThread: (studentId, courseCode) => req<Thread>('GET', `/threads/${enc(studentId)}/class/${enc(courseCode)}`).then(thread),
  chat: (body) => req<Message[]>('POST', '/chat', body).then((ms) => ms.map(msg)),
  getInbox: () => req<Ticket[]>('GET', '/advisor/inbox').then((ts) => ts.map(ticket)),
  advisorReply: (body) => req<Ticket>('POST', '/advisor/reply', body).then(ticket),

  createLecture: (body) => {
    if ('transcriptText' in body) return req('POST', '/lectures', body)
    const f = new FormData()
    f.set('studentId', body.studentId)
    f.set('courseCode', body.courseCode)
    f.set('date', body.date)
    f.set('source', body.source)
    f.set('audio', body.audio, body.filename)
    return req('POST', '/lectures', f)
  },
  processLecture: (id) => req('POST', `/lectures/${enc(id)}/process`),
  getLecture: (id) => req('GET', `/lectures/${enc(id)}`),
  getTranscript: (id) => req('GET', `/lectures/${enc(id)}/transcript`),
  getHandout: (id) => req<Handout>('GET', `/lectures/${enc(id)}/handout`).then(handout),
  getLectureCards: (id) =>
    req<{ coverage: CoverageCard; actions: ActionsCard }>('GET', `/lectures/${enc(id)}/cards`).then((c) => ({
      coverage: coverage(c.coverage),
      actions: actions(c.actions),
    })),
  addMarker: (id, body) => req('POST', `/lectures/${enc(id)}/markers`, body),
  getMarkers: (id) => req('GET', `/lectures/${enc(id)}/markers`),
  getStudentLectures: (studentId) => req('GET', `/students/${enc(studentId)}/lectures`),
  updateAction: (id, status) => req('POST', `/actions/${enc(id)}`, { status }),

  getCalendar: (studentId, q) => req('GET', `/calendar/${enc(studentId)}${qs(q)}`),
  // studentId is optional on the backend; it lets it resolve plan blocks that have no stored item.
  setCalendarStatus: (id, status, studentId) => req('POST', `/calendar/items/${enc(id)}/status`, { status, studentId }),
  addTask: (body) => req('POST', '/calendar/tasks', body),
  deleteTask: (id) => req('DELETE', `/calendar/tasks/${enc(id)}`),

  getOneOnOne: (studentId) => req<OneOnOne>('GET', `/one-on-one/${enc(studentId)}/current`).then(oneOnOne),
  answerOneOnOne: (id, body) => req<OneOnOne>('POST', `/one-on-one/${enc(id)}/answer`, body).then(oneOnOne),
  completeOneOnOne: (id, body) => req<OneOnOne>('POST', `/one-on-one/${enc(id)}/complete`, body).then(oneOnOne),

  makeRelevant: (body) => req('POST', '/relevant', body),
  getRelevant: (studentId) => req('GET', `/relevant/${enc(studentId)}`),
}
