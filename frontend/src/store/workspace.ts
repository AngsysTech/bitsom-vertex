// App state: data loaded through the API layer (mock or real) plus the UI state of the shell.
import { create } from 'zustand'
import { api } from '@/api'
import { DEFAULT_AGENT } from '@/lib/config'
import { navigate, parseHash, routeKey, type Route } from '@/lib/route'
import type {
  Agent,
  AgentId,
  Channel,
  Citation,
  Connector,
  Document,
  Message,
  Student,
  StudentId,
  StudentState,
  Ticket,
  WorkspaceFile,
} from '@/types'

export type RailId = 'home' | 'dms' | 'files' | 'agents'

/** A send that failed. Shown as the student's line + an error marker with "try again". */
export interface FailedSend {
  id: string
  afterId: string | null
  text: string
  error: string
}

export interface ThreadView {
  status: 'loading' | 'ready' | 'error'
  error?: string
  messages: Message[]
  /** Optimistic student message while POST /chat is in flight. */
  sending: Message | null
  failed: FailedSend[]
}

export type DocEntry = { status: 'loading' } | { status: 'ready'; doc: Document } | { status: 'error'; error: string }

export interface Popover {
  citation: Citation
  x: number
  y: number
  up: boolean
}

interface State {
  route: Route
  boot: { status: 'loading' | 'ready' | 'error'; error?: string }
  students: Student[]
  studentId: StudentId | null
  loadingStudent: boolean
  studentError: string | null
  agents: Agent[]
  channels: Channel[]
  connectors: Connector[]
  studentState: StudentState | null
  files: WorkspaceFile[]
  threads: Record<string, ThreadView>
  docs: Record<string, DocEntry>
  tickets: Ticket[]
  ticketsLoaded: boolean
  ticketsError: string | null

  rail: RailId
  lastDm: AgentId
  panelOpen: boolean
  panelMode: 'context' | 'citation'
  activeCite: Citation | null
  /** Citation to highlight when a document opens from a source link. */
  focusCite: Citation | null
  tab: 'messages' | 'canvas'
  traceOpen: Record<string, boolean>
  switcherOpen: boolean
  filesFilter: 'all' | 'document' | 'canvas'
  agentsTab: 'agents' | 'connectors'
  advisorSel: string | null
  annRead: Record<string, boolean>
  starred: AgentId[]
  planWeek: number
  pop: Popover | null
}

interface Actions {
  onRoute(route: Route): void
  bootstrap(): Promise<void>
  selectStudent(id: StudentId): Promise<void>
  loadThread(agentId: AgentId): Promise<void>
  refreshThread(agentId: AgentId): Promise<void>
  send(agentId: AgentId, text: string): Promise<void>
  retry(agentId: AgentId, failedId: string): void
  loadDoc(docId: string): void
  loadTickets(): Promise<void>
  replyTicket(ticketId: string, text: string): Promise<void>
  openCitation(c: Citation): void
  showPop(c: Citation, rect: DOMRect): void
  hidePop(): void
  set(patch: Partial<State> | ((s: State) => Partial<State>)): void
}

export type Store = State & Actions

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const emptyThread = (status: ThreadView['status']): ThreadView => ({ status, messages: [], sending: null, failed: [] })

/** Bumped on every student switch; late responses for an older student are dropped. */
let generation = 0

export const useWS = create<Store>()((set, get) => {
  const patchThread = (agentId: AgentId, fn: (t: ThreadView) => Partial<ThreadView>) =>
    set((s) => {
      const t = s.threads[agentId] ?? emptyThread('loading')
      return { threads: { ...s.threads, [agentId]: { ...t, ...fn(t) } } }
    })

  const refreshStudentData = (gen: number, studentId: StudentId) => {
    // Agents may have written to StudentState / produced canvases; refresh both quietly.
    api.getStudentState(studentId).then((st) => gen === generation && set({ studentState: st }), () => {})
    api.getFiles(studentId).then((f) => gen === generation && set({ files: f }), () => {})
  }

  return {
    route: parseHash(window.location.hash),
    boot: { status: 'loading' },
    students: [],
    studentId: null,
    loadingStudent: true,
    studentError: null,
    agents: [],
    channels: [],
    connectors: [],
    studentState: null,
    files: [],
    threads: {},
    docs: {},
    tickets: [],
    ticketsLoaded: false,
    ticketsError: null,

    rail: 'home',
    lastDm: DEFAULT_AGENT,
    panelOpen: true,
    panelMode: 'context',
    activeCite: null,
    focusCite: null,
    tab: 'messages',
    traceOpen: {},
    switcherOpen: false,
    filesFilter: 'all',
    agentsTab: 'agents',
    advisorSel: null,
    annRead: {},
    starred: [],
    planWeek: 0,
    pop: null,

    set: (patch) => set(patch),

    onRoute(route) {
      const s = get()
      const changed = routeKey(route) !== routeKey(s.route)
      let rail = s.rail
      if (route.view === 'doc' || route.view === 'files') rail = 'files'
      else if (route.view === 'agents') rail = 'agents'
      else if ((route.view === 'dm' || route.view === 'channel') && rail !== 'home' && rail !== 'dms') rail = 'home'
      const patch: Partial<State> = { route, rail, pop: null }
      if (route.view === 'dm') patch.lastDm = route.id
      if (changed) {
        patch.tab = 'messages'
        patch.planWeek = 0
        if (route.view === 'dm' || route.view === 'channel') patch.panelMode = 'context'
      }
      if (route.view === 'channel' && s.studentId) patch.annRead = { ...s.annRead, [s.studentId]: true }
      set(patch)
      if (route.view === 'advisor') void get().loadTickets()
    },

    async bootstrap() {
      set({ boot: { status: 'loading' } })
      try {
        const students = await api.getStudents()
        set({ students, boot: { status: 'ready' } })
        if (students[0]) void get().selectStudent(students[0].id)
        else set({ loadingStudent: false, studentError: 'No students returned by GET /students' })
      } catch (e) {
        set({ boot: { status: 'error', error: errText(e) } })
      }
    },

    async selectStudent(id) {
      const gen = ++generation
      set((s) => ({
        studentId: id,
        loadingStudent: true,
        studentError: null,
        threads: {},
        studentState: null,
        files: [],
        traceOpen: {},
        panelMode: 'context',
        panelOpen: true,
        activeCite: null,
        switcherOpen: false,
        advisorSel: null,
        pop: null,
        annRead: { ...s.annRead, [id]: !!s.annRead[id] || s.route.view === 'channel' },
      }))
      try {
        const [ws, state, files] = await Promise.all([api.getWorkspace(id), api.getStudentState(id), api.getFiles(id)])
        if (gen !== generation) return
        const dmAgents = ws.agents.filter((a) => a.kind !== 'club')
        set({
          agents: ws.agents,
          channels: ws.channels,
          connectors: ws.connectors,
          studentState: state,
          files,
          threads: Object.fromEntries(dmAgents.map((a) => [a.id, emptyThread('loading')])),
        })
        await Promise.all(dmAgents.map((a) => get().loadThread(a.id)))
      } catch (e) {
        if (gen === generation) set({ studentError: errText(e) })
      } finally {
        if (gen === generation) set({ loadingStudent: false })
      }
    },

    async loadThread(agentId) {
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      patchThread(agentId, () => ({ status: 'loading', error: undefined }))
      try {
        const t = await api.getThread(studentId, agentId)
        if (gen === generation) patchThread(agentId, () => ({ status: 'ready', messages: t.messages }))
      } catch (e) {
        if (gen === generation) patchThread(agentId, () => ({ status: 'error', error: errText(e) }))
      }
    },

    async refreshThread(agentId) {
      const { studentId, threads } = get()
      if (!studentId || !threads[agentId] || threads[agentId].sending) return
      const gen = generation
      try {
        const t = await api.getThread(studentId, agentId)
        const cur = get().threads[agentId]
        if (gen !== generation || !cur || cur.sending) return
        if (JSON.stringify(cur.messages) !== JSON.stringify(t.messages)) patchThread(agentId, () => ({ messages: t.messages }))
      } catch {
        // Polling is best-effort; the next tick retries.
      }
    },

    async send(agentId, raw) {
      const text = raw.trim()
      const { studentId, threads } = get()
      if (!text || !studentId || threads[agentId]?.sending) return
      const gen = generation
      const optimistic: Message = {
        id: `local-${Date.now()}`,
        threadId: `${studentId}:${agentId}`,
        role: 'student',
        createdAt: new Date().toISOString(),
        text,
        citations: [],
        cards: [],
        trace: [],
      }
      patchThread(agentId, () => ({ sending: optimistic }))
      try {
        const replies = await api.chat({ studentId, agentId, text })
        if (gen !== generation) return
        patchThread(agentId, (t) => ({ sending: null, messages: [...t.messages, optimistic, ...replies] }))
        set({ panelMode: 'context' })
        refreshStudentData(gen, studentId)
      } catch (e) {
        if (gen !== generation) return
        patchThread(agentId, (t) => ({
          sending: null,
          failed: [...t.failed, { id: `failed-${Date.now()}`, afterId: t.messages.at(-1)?.id ?? null, text, error: errText(e) }],
        }))
      }
    },

    retry(agentId, failedId) {
      const f = get().threads[agentId]?.failed.find((x) => x.id === failedId)
      if (!f) return
      patchThread(agentId, (t) => ({ failed: t.failed.filter((x) => x.id !== failedId) }))
      void get().send(agentId, f.text)
    },

    loadDoc(docId) {
      const cur = get().docs[docId]
      if (cur && cur.status !== 'error') return
      set((s) => ({ docs: { ...s.docs, [docId]: { status: 'loading' } } }))
      api.getDocument(docId).then(
        (doc) => set((s) => ({ docs: { ...s.docs, [docId]: { status: 'ready', doc } } })),
        (e) => set((s) => ({ docs: { ...s.docs, [docId]: { status: 'error', error: errText(e) } } })),
      )
    },

    async loadTickets() {
      try {
        const tickets = await api.getInbox()
        tickets.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        if (JSON.stringify(tickets) !== JSON.stringify(get().tickets)) set({ tickets })
        if (get().ticketsError || !get().ticketsLoaded) set({ ticketsError: null, ticketsLoaded: true })
      } catch (e) {
        set({ ticketsError: errText(e), ticketsLoaded: true })
      }
    },

    async replyTicket(ticketId, text) {
      // Pin the selection: otherwise "first open ticket" auto-selection jumps away once this one is answered.
      set({ advisorSel: ticketId })
      const t = await api.advisorReply({ ticketId, text })
      set((s) => ({ tickets: s.tickets.map((x) => (x.ticketId === t.ticketId ? t : x)) }))
    },

    openCitation(c) {
      const v = get().route.view
      set({ pop: null })
      if (v !== 'dm' && v !== 'channel') {
        set({ focusCite: c })
        navigate(`/files/${c.docId}/${c.sectionId}`)
        return
      }
      set({ panelOpen: true, panelMode: 'citation', activeCite: c })
      get().loadDoc(c.docId)
    },

    showPop(c, r) {
      const below = r.bottom < window.innerHeight - 170
      set({ pop: { citation: c, x: Math.max(8, Math.min(r.left, window.innerWidth - 332)), y: below ? r.bottom + 6 : r.top - 6, up: !below } })
    },

    hidePop() {
      if (get().pop) set({ pop: null })
    },
  }
})
