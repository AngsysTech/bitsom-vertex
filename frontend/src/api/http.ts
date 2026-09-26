import { API_URL } from '@/lib/config'
import type { Message, Thread, Ticket } from '@/types'
import { ApiError, type Api } from './client'

// Defensive defaults so a backend that omits an empty array can't crash rendering mid-demo.
const msg = (m: Message): Message => ({ ...m, citations: m.citations ?? [], cards: m.cards ?? [], trace: m.trace ?? [] })
const thread = (t: Thread): Thread => ({ ...t, messages: (t.messages ?? []).map(msg) })
const ticket = (t: Ticket): Ticket => ({ ...t, citations: t.citations ?? [] })

const enc = encodeURIComponent

async function req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(`Can't reach the backend at ${API_URL}`)
  }
  const data = await res.json().catch(() => null)
  // Backend errors are {error: string} with 4xx/5xx (contracts.ts §10).
  if (!res.ok) throw new ApiError(data?.error ?? data?.detail ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const httpApi: Api = {
  getStudents: () => req('GET', '/students'),
  getWorkspace: (studentId) => req('GET', `/workspace/${enc(studentId)}`),
  getStudentState: (studentId) => req('GET', `/students/${enc(studentId)}/state`),
  getFiles: (studentId) => req('GET', `/files/${enc(studentId)}`),
  getDocument: (docId) => req('GET', `/documents/${enc(docId)}`),
  getThread: (studentId, agentId) => req<Thread>('GET', `/threads/${enc(studentId)}/${enc(agentId)}`).then(thread),
  chat: (body) => req<Message[]>('POST', '/chat', body).then((ms) => ms.map(msg)),
  getInbox: () => req<Ticket[]>('GET', '/advisor/inbox').then((ts) => ts.map(ticket)),
  advisorReply: (body) => req<Ticket>('POST', '/advisor/reply', body).then(ticket),
}
