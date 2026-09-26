// One interface, two implementations: the in-browser mock server (MOCK=true) and the FastAPI client.
import { MOCK } from '@/lib/config'
import type { Api } from './client'
import { httpApi } from './http'

export type { Api, Workspace } from './client'
export { ApiError } from './client'

/** The mock is imported on first use, so real mode never loads (or breaks on) mock code. */
function lazyMock(): Api {
  let mod: Promise<Api> | undefined
  const load = () => (mod ??= import('./mock/server').then((m) => m.mockApi))
  return {
    getStudents: () => load().then((a) => a.getStudents()),
    getWorkspace: (id) => load().then((a) => a.getWorkspace(id)),
    getStudentState: (id) => load().then((a) => a.getStudentState(id)),
    getFiles: (id) => load().then((a) => a.getFiles(id)),
    getDocument: (id) => load().then((a) => a.getDocument(id)),
    getThread: (sid, aid) => load().then((a) => a.getThread(sid, aid)),
    chat: (body) => load().then((a) => a.chat(body)),
    getInbox: () => load().then((a) => a.getInbox()),
    advisorReply: (body) => load().then((a) => a.advisorReply(body)),
  }
}

export const api: Api = MOCK ? lazyMock() : httpApi
