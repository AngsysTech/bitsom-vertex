// App state: data loaded through the API layer (mock or real) plus the UI state of the shell.
// Class Companion flows (recording, marker queue, lecture jobs) live in ./companion.ts and write here.
import { create } from 'zustand'
import { api, type CalendarStatus } from '@/api'
import { DEFAULT_AGENT } from '@/lib/config'
import { navigate, parseHash, routeKey, type Route } from '@/lib/route'
import type {
  ActionItem,
  ActionsCard,
  Agent,
  AgentId,
  CalendarItem,
  Channel,
  Citation,
  ClassChannel,
  Connector,
  CoverageCard,
  Document,
  Handout,
  Lecture,
  Message,
  OneOnOne,
  RelevantCard,
  StuckMarker,
  Student,
  StudentId,
  StudentState,
  Ticket,
  Transcript,
  WorkspaceFile,
} from '@/types'

export type RailId = 'home' | 'dms' | 'calendar' | 'files' | 'agents'

/** A thread key: an agent id for DMs, `class:<courseCode>` for class channels (= ClassChannel.channelId). */
export type ThreadKey = string
export const classKey = (courseCode: string): ThreadKey => `class:${courseCode}`
export const courseOfKey = (key: ThreadKey) => (key.startsWith('class:') ? key.slice(6) : undefined)

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

/** A loadable value: never a silent wait — every consumer can show loading and error rows. */
export type Loadable<T> = { status: 'loading'; value?: T } | { status: 'ready'; value: T } | { status: 'error'; error: string; value?: T }

export interface LectureCards {
  coverage: CoverageCard
  actions: ActionsCard
}

export interface Popover {
  citation: Citation
  x: number
  y: number
  up: boolean
}

/** "I'm stuck" tap, kept locally until the lecture exists and the POST succeeds (posted in order). */
export interface LocalMarker {
  localId: string
  courseCode: string
  atSec: number
  note?: string
  createdAt: string
  state: 'queued' | 'posting' | 'posted' | 'failed'
  error?: string
  attempts: number
  lectureId?: string
  marker?: StuckMarker
  /** Added on the handout timeline after the lecture was processed (no thread row: the coach replies instead). */
  late?: boolean
}

export interface RecordingSession {
  courseCode: string
  startedAt: number
  status: 'starting' | 'recording' | 'stopping'
  /** Local id of the marker whose note field is open. */
  noteFor: string | null
}

/** One lecture going through upload → process → poll, rendered as live rows in its class thread. */
export interface LectureJob {
  id: string
  courseCode: string
  source: Lecture['source']
  /** The picked or dropped file's name (source "upload"), so several clips can be told apart. */
  filename?: string
  createdAt: string
  phase: 'uploading' | 'upload_failed' | 'processing' | 'ready' | 'failed'
  lecture?: Lecture
  error?: string
  /** Last poll failed (network); the job keeps polling and says so. */
  pollError?: string
  lastPollAt?: number
  /** Id of the agent message that carried this lecture's cards, once the thread has it. */
  messageId?: string
  /** Stopped waiting for that message; if it landed in the coach DM instead, its id. */
  messageWaitDone?: boolean
  dmMessageId?: string
}

/** `idle`: the slot is open but there's no interest to reframe through yet (the student adds one inline). */
export type RelevantState = { status: 'idle' | 'loading' | 'ready' | 'error'; interest: string; card?: RelevantCard; error?: string }

export interface CalendarEntry {
  status: 'loading' | 'ready' | 'error'
  items: CalendarItem[]
  error?: string
  version: number
}

export type CanvasId = 'plan' | 'calendar' | 'one_on_one'

interface State {
  route: Route
  boot: { status: 'loading' | 'ready' | 'error'; error?: string }
  students: Student[]
  studentId: StudentId | null
  loadingStudent: boolean
  studentError: string | null
  agents: Agent[]
  channels: Channel[]
  classes: ClassChannel[]
  connectors: Connector[]
  studentState: StudentState | null
  files: WorkspaceFile[]
  threads: Record<ThreadKey, ThreadView>
  docs: Record<string, DocEntry>
  tickets: Ticket[]
  ticketsLoaded: boolean
  ticketsError: string | null

  // Class Companion
  lectures: Loadable<Lecture[]>
  cards: Record<string, Loadable<LectureCards>>
  handouts: Record<string, Loadable<Handout>>
  transcripts: Record<string, Loadable<Transcript>>
  markers: Record<string, StuckMarker[]>
  jobs: Record<string, LectureJob>
  recording: RecordingSession | null
  recordingError: string | null
  /** Files a pick or drop couldn't add (not audio the pipeline reads, or empty). */
  uploadError: string | null
  localMarkers: LocalMarker[]
  actionBusy: Record<string, boolean>
  actionError: Record<string, string>
  paste: { courseCode: string } | null

  // Calendar (one cache, three placements)
  calendarVersion: number
  calendar: Record<string, CalendarEntry>
  itemIndex: Record<string, CalendarItem>
  freshItems: Record<string, number>
  statusError: string | null

  // Weekly 1:1
  oneOnOne: Loadable<OneOnOne> | null
  oneOnOneBusy: boolean
  oneOnOneNotice: string | null

  // Make it Relevant
  relevant: Record<string, RelevantState>
  relevantHistory: RelevantCard[]

  rail: RailId
  lastDm: AgentId
  panelOpen: boolean
  panelMode: 'context' | 'citation'
  activeCite: Citation | null
  /** Citation to highlight when a document opens from a source link. */
  focusCite: Citation | null
  tab: 'messages' | 'canvas'
  canvas: CanvasId
  traceOpen: Record<string, boolean>
  switcherOpen: boolean
  filesFilter: 'all' | 'document' | 'canvas'
  agentsTab: 'agents' | 'connectors'
  advisorSel: string | null
  annRead: Record<string, boolean>
  starred: string[]
  /** Selected week in the study plan card; null = the current week. */
  planWeek: number | null
  pop: Popover | null
  /** Message to scroll into view once rendered (e.g. the lecture-ready message). */
  scrollTo: string | null
}

interface Actions {
  onRoute(route: Route): void
  bootstrap(): Promise<void>
  selectStudent(id: StudentId): Promise<void>
  loadThread(key: ThreadKey): Promise<void>
  refreshThread(key: ThreadKey): Promise<void>
  send(key: ThreadKey, text: string): Promise<void>
  retry(key: ThreadKey, failedId: string): void
  loadDoc(docId: string): void
  loadTickets(): Promise<void>
  replyTicket(ticketId: string, text: string): Promise<void>
  openCitation(c: Citation): void
  showPop(c: Citation, rect: DOMRect): void
  hidePop(): void
  refreshClasses(): Promise<void>
  refreshStudentData(): void
  loadLectures(): Promise<void>
  loadCards(lectureId: string, quiet?: boolean): Promise<void>
  loadHandout(lectureId: string, quiet?: boolean): Promise<void>
  loadTranscript(lectureId: string): Promise<void>
  loadMarkers(lectureId: string): Promise<void>
  setActionStatus(action: ActionItem, status: ActionItem['status']): Promise<void>
  loadCalendar(key: string, q: { from: string; to: string; courseCode?: string }): Promise<void>
  bumpCalendar(): void
  setItemStatus(item: CalendarItem, status: CalendarStatus): Promise<void>
  loadOneOnOne(quiet?: boolean): Promise<void>
  answerQuestion(questionId: string, answer: string): Promise<void>
  completeOneOnOne(shareWithAdvisor: boolean): Promise<void>
  makeRelevant(key: string, source: NonNullable<RelevantCard['source']>, interest: string): Promise<void>
  /** Saves the interest on the student (backend) and returns the list; throws with the backend's reason. */
  addInterest(interest: string): Promise<string[]>
  removeInterest(interest: string): Promise<void>
  set(patch: Partial<State> | ((s: State) => Partial<State>)): void
}

export type Store = State & Actions

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const emptyThread = (status: ThreadView['status']): ThreadView => ({ status, messages: [], sending: null, failed: [] })

/** Bumped on every student switch; late responses for an older student are dropped. */
let generation = 0
export const currentGeneration = () => generation

/** Relevant cards are keyed by what they came from, so each section / block / topic shows its own. */
export const relevantKey = (src: NonNullable<RelevantCard['source']>) =>
  src.type === 'handout_section' ? `hs:${src.lectureId}:${src.sectionId}` : src.type === 'plan_block' ? `pb:${src.planBlockId}` : `wt:${src.course}:${src.topic}`

const cardsFrom = (m: Message) => {
  const coverage = m.cards.find((c): c is CoverageCard => c.type === 'coverage')
  const actions = m.cards.find((c): c is ActionsCard => c.type === 'actions')
  return { coverage, actions }
}

export const useWS = create<Store>()((set, get) => {
  const patchThread = (key: ThreadKey, fn: (t: ThreadView) => Partial<ThreadView>) =>
    set((s) => {
      const t = s.threads[key] ?? emptyThread('loading')
      return { threads: { ...s.threads, [key]: { ...t, ...fn(t) } } }
    })

  const fetchThread = (studentId: StudentId, key: ThreadKey) => {
    const course = courseOfKey(key)
    return course ? api.getClassThread(studentId, course) : api.getThread(studentId, key as AgentId)
  }

  /** New lecture cards arrived in a thread (ready, or recomputed after a late marker): refetch the authoritative copy. */
  const noticeCards = (before: Message[], after: Message[]) => {
    const seen = new Set(before.map((m) => m.id))
    for (const m of after) {
      if (seen.has(m.id)) continue
      const { coverage, actions } = cardsFrom(m)
      const lectureId = coverage?.lectureId ?? actions?.lectureId
      if (lectureId) {
        void get().loadCards(lectureId, true)
        void get().loadHandout(lectureId, true)
        void get().loadMarkers(lectureId)
      }
    }
  }

  const patchAction = (a: ActionItem) =>
    set((s) => {
      const cur = s.cards[a.lectureId]
      const cards =
        cur?.value && {
          ...s.cards,
          [a.lectureId]: { ...cur, value: { ...cur.value, actions: { ...cur.value.actions, items: cur.value.actions.items.map((x) => (x.id === a.id ? a : x)) } } } as Loadable<LectureCards>,
        }
      // Message snapshots carry the same items: keep them in step so every placement agrees.
      const threads: Record<ThreadKey, ThreadView> = {}
      for (const [k, t] of Object.entries(s.threads)) {
        if (!t.messages.some((m) => m.cards.some((c) => c.type === 'actions' && c.lectureId === a.lectureId))) continue
        threads[k] = {
          ...t,
          messages: t.messages.map((m) => ({
            ...m,
            cards: m.cards.map((c) => (c.type === 'actions' && c.lectureId === a.lectureId ? { ...c, items: c.items.map((x) => (x.id === a.id ? a : x)) } : c)),
          })),
        }
      }
      return { ...(cards ? { cards } : {}), threads: { ...s.threads, ...threads } }
    })

  return {
    route: parseHash(window.location.hash),
    boot: { status: 'loading' },
    students: [],
    studentId: null,
    loadingStudent: true,
    studentError: null,
    agents: [],
    channels: [],
    classes: [],
    connectors: [],
    studentState: null,
    files: [],
    threads: {},
    docs: {},
    tickets: [],
    ticketsLoaded: false,
    ticketsError: null,

    lectures: { status: 'loading' },
    cards: {},
    handouts: {},
    transcripts: {},
    markers: {},
    jobs: {},
    recording: null,
    recordingError: null,
    uploadError: null,
    localMarkers: [],
    actionBusy: {},
    actionError: {},
    paste: null,

    calendarVersion: 1,
    calendar: {},
    itemIndex: {},
    freshItems: {},
    statusError: null,

    oneOnOne: null,
    oneOnOneBusy: false,
    oneOnOneNotice: null,

    relevant: {},
    relevantHistory: [],

    rail: 'home',
    lastDm: DEFAULT_AGENT,
    panelOpen: true,
    panelMode: 'context',
    activeCite: null,
    focusCite: null,
    tab: 'messages',
    canvas: 'plan',
    traceOpen: {},
    switcherOpen: false,
    filesFilter: 'all',
    agentsTab: 'agents',
    advisorSel: null,
    annRead: {},
    starred: [],
    planWeek: null,
    pop: null,
    scrollTo: null,

    set: (patch) => set(patch),

    onRoute(route) {
      const s = get()
      const changed = routeKey(route) !== routeKey(s.route)
      let rail = s.rail
      if (route.view === 'doc' || route.view === 'files') rail = 'files'
      else if (route.view === 'agents') rail = 'agents'
      else if (route.view === 'calendar') rail = 'calendar'
      else if ((route.view === 'dm' || route.view === 'channel' || route.view === 'class') && rail !== 'home' && rail !== 'dms') rail = 'home'
      const patch: Partial<State> = { route, rail, pop: null }
      if (route.view === 'dm') patch.lastDm = route.id
      if (changed) {
        patch.tab = 'messages'
        patch.planWeek = null
        if (route.view === 'dm' || route.view === 'channel' || route.view === 'class') patch.panelMode = 'context'
      }
      if (route.view === 'channel' && s.studentId) patch.annRead = { ...s.annRead, [s.studentId]: true }
      set(patch)
      if (route.view === 'advisor') void get().loadTickets()
      if (route.view === 'class' && s.studentId && !s.loadingStudent) {
        const key = classKey(route.id)
        if (!get().threads[key] || get().threads[key]!.status === 'error') void get().loadThread(key)
      }
    },

    async bootstrap() {
      set({ boot: { status: 'loading' } })
      try {
        const students = await api.getStudents()
        set({ students, boot: { status: 'ready' } })
        const preferred = students.find((x) => x.id === 'meera') ?? students[0]
        if (preferred) void get().selectStudent(preferred.id)
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
        classes: [],
        studentState: null,
        files: [],
        traceOpen: {},
        panelMode: 'context',
        panelOpen: true,
        activeCite: null,
        switcherOpen: false,
        advisorSel: null,
        pop: null,
        lectures: { status: 'loading' },
        cards: {},
        handouts: {},
        transcripts: {},
        markers: {},
        jobs: {},
        localMarkers: [],
        uploadError: null,
        actionBusy: {},
        actionError: {},
        paste: null,
        calendar: {},
        itemIndex: {},
        freshItems: {},
        calendarVersion: s.calendarVersion + 1,
        oneOnOne: null,
        oneOnOneNotice: null,
        relevant: {},
        relevantHistory: [],
        planWeek: null,
        annRead: { ...s.annRead, [id]: !!s.annRead[id] || s.route.view === 'channel' },
      }))
      try {
        const [ws, state, files] = await Promise.all([api.getWorkspace(id), api.getStudentState(id), api.getFiles(id)])
        if (gen !== generation) return
        const dmAgents = ws.agents.filter((a) => a.kind !== 'club')
        set({
          agents: ws.agents,
          channels: ws.channels,
          classes: ws.classes,
          connectors: ws.connectors,
          studentState: state,
          files,
          threads: Object.fromEntries(dmAgents.map((a) => [a.id, emptyThread('loading')])),
        })
        const route = get().route
        const extra = route.view === 'class' ? [classKey(route.id)] : []
        void get().loadLectures()
        void get().loadOneOnOne(true)
        api.getRelevant(id).then((r) => gen === generation && set({ relevantHistory: r }), () => {})
        await Promise.all([...dmAgents.map((a) => get().loadThread(a.id)), ...extra.map((k) => get().loadThread(k))])
      } catch (e) {
        if (gen === generation) set({ studentError: errText(e) })
      } finally {
        if (gen === generation) set({ loadingStudent: false })
      }
    },

    async loadThread(key) {
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      patchThread(key, () => ({ status: 'loading', error: undefined }))
      try {
        const t = await fetchThread(studentId, key)
        if (gen === generation) patchThread(key, () => ({ status: 'ready', messages: t.messages }))
      } catch (e) {
        if (gen === generation) patchThread(key, () => ({ status: 'error', error: errText(e) }))
      }
    },

    async refreshThread(key) {
      const { studentId, threads } = get()
      if (!studentId || !threads[key] || threads[key].sending) return
      const gen = generation
      try {
        const t = await fetchThread(studentId, key)
        const cur = get().threads[key]
        if (gen !== generation || !cur || cur.sending) return
        if (JSON.stringify(cur.messages) !== JSON.stringify(t.messages)) {
          noticeCards(cur.messages, t.messages)
          patchThread(key, () => ({ status: 'ready', messages: t.messages }))
        }
      } catch {
        // Polling is best-effort; the next tick retries.
      }
    },

    async send(key, raw) {
      const text = raw.trim()
      const { studentId, threads } = get()
      if (!text || !studentId || threads[key]?.sending) return
      const gen = generation
      const courseCode = courseOfKey(key)
      const agentId: AgentId = courseCode ? 'academic_coach' : (key as AgentId)
      const optimistic: Message = {
        id: `local-${Date.now()}`,
        threadId: courseCode ? `${studentId}:class:${courseCode}` : `${studentId}:${agentId}`,
        role: 'student',
        createdAt: new Date().toISOString(),
        text,
        citations: [],
        cards: [],
        trace: [],
      }
      patchThread(key, () => ({ sending: optimistic }))
      try {
        const replies = await api.chat({ studentId, agentId, text, ...(courseCode ? { courseCode } : {}) })
        if (gen !== generation) return
        // The server echoes the student's message first; drop our optimistic copy when it does.
        const echoed = replies[0]?.role === 'student'
        patchThread(key, (t) => ({ sending: null, messages: [...t.messages, ...(echoed ? [] : [optimistic]), ...replies] }))
        set({ panelMode: 'context' })
        const oneOnOne = replies.flatMap((m) => m.cards).find((c) => c.type === 'one_on_one')
        if (oneOnOne) set({ oneOnOne: { status: 'ready', value: oneOnOne.oneOnOne } })
        get().refreshStudentData()
        if (replies.some((m) => m.cards.some((c) => c.type === 'study_plan'))) get().bumpCalendar()
      } catch (e) {
        if (gen !== generation) return
        patchThread(key, (t) => ({
          sending: null,
          failed: [...t.failed, { id: `failed-${Date.now()}`, afterId: t.messages.at(-1)?.id ?? null, text, error: errText(e) }],
        }))
      }
    },

    retry(key, failedId) {
      const f = get().threads[key]?.failed.find((x) => x.id === failedId)
      if (!f) return
      patchThread(key, (t) => ({ failed: t.failed.filter((x) => x.id !== failedId) }))
      void get().send(key, f.text)
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
      if (v !== 'dm' && v !== 'channel' && v !== 'class') {
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

    async refreshClasses() {
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      try {
        const classes = await api.getClasses(studentId)
        if (gen === generation && JSON.stringify(classes) !== JSON.stringify(get().classes)) set({ classes })
      } catch {
        // Badges refresh on the next change; the channel list itself came from /workspace.
      }
    },

    refreshStudentData() {
      // Agents may have written to StudentState / produced canvases; refresh both quietly.
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      api.getStudentState(studentId).then((st) => gen === generation && set({ studentState: st }), () => {})
      api.getFiles(studentId).then((f) => gen === generation && set({ files: f }), () => {})
    },

    async loadLectures() {
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      set((s) => ({ lectures: { status: 'loading', value: s.lectures.value } }))
      try {
        const list = await api.getStudentLectures(studentId)
        if (gen === generation) set({ lectures: { status: 'ready', value: list.sort((a, b) => b.date.localeCompare(a.date)) } })
      } catch (e) {
        if (gen === generation) set((s) => ({ lectures: { status: 'error', error: errText(e), value: s.lectures.value } }))
      }
    },

    async loadCards(lectureId, quiet) {
      const gen = generation
      if (!quiet || !get().cards[lectureId]) set((s) => ({ cards: { ...s.cards, [lectureId]: { status: 'loading', value: s.cards[lectureId]?.value } } }))
      try {
        const value = await api.getLectureCards(lectureId)
        if (gen === generation) set((s) => ({ cards: { ...s.cards, [lectureId]: { status: 'ready', value } } }))
      } catch (e) {
        if (gen === generation) set((s) => ({ cards: { ...s.cards, [lectureId]: { status: 'error', error: errText(e), value: s.cards[lectureId]?.value } } }))
      }
    },

    async loadHandout(lectureId, quiet) {
      const gen = generation
      if (!quiet || !get().handouts[lectureId]) set((s) => ({ handouts: { ...s.handouts, [lectureId]: { status: 'loading', value: s.handouts[lectureId]?.value } } }))
      try {
        const value = await api.getHandout(lectureId)
        if (gen === generation) set((s) => ({ handouts: { ...s.handouts, [lectureId]: { status: 'ready', value } } }))
      } catch (e) {
        if (gen === generation) set((s) => ({ handouts: { ...s.handouts, [lectureId]: { status: 'error', error: errText(e), value: s.handouts[lectureId]?.value } } }))
      }
    },

    async loadTranscript(lectureId) {
      const gen = generation
      if (get().transcripts[lectureId]?.status === 'ready') return
      set((s) => ({ transcripts: { ...s.transcripts, [lectureId]: { status: 'loading' } } }))
      try {
        const value = await api.getTranscript(lectureId)
        if (gen === generation) set((s) => ({ transcripts: { ...s.transcripts, [lectureId]: { status: 'ready', value } } }))
      } catch (e) {
        if (gen === generation) set((s) => ({ transcripts: { ...s.transcripts, [lectureId]: { status: 'error', error: errText(e) } } }))
      }
    },

    async loadMarkers(lectureId) {
      const gen = generation
      try {
        const list = await api.getMarkers(lectureId)
        if (gen === generation) set((s) => ({ markers: { ...s.markers, [lectureId]: list } }))
      } catch {
        // Markers also arrive resolved inside the handout (section.stuck) and coverage (confusion).
      }
    },

    async setActionStatus(action, status) {
      const gen = generation
      set((s) => ({ actionBusy: { ...s.actionBusy, [action.id]: true }, actionError: { ...s.actionError, [action.id]: '' } }))
      try {
        const a = await api.updateAction(action.id, status)
        if (gen !== generation) return
        patchAction(a)
        if (a.calendarItemId) set((s) => ({ freshItems: { ...s.freshItems, [a.calendarItemId!]: Date.now() } }))
        get().bumpCalendar()
        void get().refreshClasses()
        get().refreshStudentData()
      } catch (e) {
        if (gen === generation) set((s) => ({ actionError: { ...s.actionError, [action.id]: errText(e) } }))
      } finally {
        if (gen === generation) set((s) => ({ actionBusy: { ...s.actionBusy, [action.id]: false } }))
      }
    },

    async loadCalendar(key, q) {
      const { studentId, calendarVersion } = get()
      if (!studentId) return
      const gen = generation
      set((s) => ({ calendar: { ...s.calendar, [key]: { status: 'loading', items: s.calendar[key]?.items ?? [], version: calendarVersion } } }))
      try {
        const items = await api.getCalendar(studentId, q)
        if (gen !== generation) return
        set((s) => ({
          calendar: { ...s.calendar, [key]: { status: 'ready', items, version: calendarVersion } },
          itemIndex: { ...s.itemIndex, ...Object.fromEntries(items.map((i) => [i.id, i])) },
        }))
      } catch (e) {
        if (gen === generation) set((s) => ({ calendar: { ...s.calendar, [key]: { status: 'error', items: s.calendar[key]?.items ?? [], error: errText(e), version: calendarVersion } } }))
      }
    },

    bumpCalendar() {
      set((s) => ({ calendarVersion: s.calendarVersion + 1 }))
    },

    async setItemStatus(item, status) {
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      const apply = (it: CalendarItem) =>
        set((s) => ({
          calendar: Object.fromEntries(Object.entries(s.calendar).map(([k, e]) => [k, { ...e, items: e.items.map((x) => (x.id === it.id ? it : x)) }])),
          itemIndex: { ...s.itemIndex, [it.id]: it },
        }))
      apply({ ...item, status })
      set({ statusError: null })
      try {
        const saved = await api.setCalendarStatus(item.id, status, studentId)
        if (gen !== generation) return
        apply(saved)
        set((s) => ({ oneOnOne: s.oneOnOne && s.oneOnOne.status === 'ready' && s.oneOnOne.value.status !== 'done' ? { ...s.oneOnOne } : s.oneOnOne }))
      } catch (e) {
        if (gen !== generation) return
        apply(item)
        set({ statusError: `Couldn’t mark “${item.title}” ${status}: ${errText(e)}` })
      }
    },

    async loadOneOnOne(quiet) {
      const { studentId } = get()
      if (!studentId) return
      const gen = generation
      if (!quiet || !get().oneOnOne) set((s) => ({ oneOnOne: { status: 'loading', value: s.oneOnOne?.value } }))
      try {
        const value = await api.getOneOnOne(studentId)
        if (gen === generation) set({ oneOnOne: { status: 'ready', value } })
      } catch (e) {
        if (gen === generation) set((s) => ({ oneOnOne: { status: 'error', error: errText(e), value: s.oneOnOne?.value } }))
      }
    },

    async answerQuestion(questionId, answer) {
      const one = get().oneOnOne?.value
      if (!one) return
      const gen = generation
      const value = await api.answerOneOnOne(one.id, { questionId, answer })
      if (gen === generation) set({ oneOnOne: { status: 'ready', value } })
    },

    async completeOneOnOne(shareWithAdvisor) {
      const one = get().oneOnOne?.value
      if (!one) return
      const gen = generation
      set({ oneOnOneBusy: true, oneOnOneNotice: null })
      try {
        const value = await api.completeOneOnOne(one.id, { shareWithAdvisor })
        if (gen !== generation) return
        set({ oneOnOne: { status: 'ready', value }, oneOnOneNotice: 'Calendar updated' })
        get().bumpCalendar()
        get().refreshStudentData()
        void get().refreshClasses()
        if (shareWithAdvisor) void get().loadTickets()
      } catch (e) {
        if (gen === generation) set({ oneOnOneNotice: `Couldn’t complete the review: ${errText(e)}` })
      } finally {
        if (gen === generation) set({ oneOnOneBusy: false })
      }
    },

    async makeRelevant(key, source, interest) {
      const { studentId } = get()
      if (!studentId) return
      if (!interest) {
        set((s) => ({ relevant: { ...s.relevant, [key]: { status: 'idle', interest: '', card: s.relevant[key]?.card } } }))
        return
      }
      const gen = generation
      set((s) => ({ relevant: { ...s.relevant, [key]: { status: 'loading', interest, card: s.relevant[key]?.card } } }))
      try {
        const card = await api.makeRelevant({ studentId, interest, source })
        if (gen !== generation) return
        set((s) => ({ relevant: { ...s.relevant, [key]: { status: 'ready', interest, card } }, relevantHistory: [...s.relevantHistory, card] }))
      } catch (e) {
        if (gen === generation) set((s) => ({ relevant: { ...s.relevant, [key]: { status: 'error', interest, error: errText(e), card: s.relevant[key]?.card } } }))
      }
    },

    async addInterest(interest) {
      const { studentId } = get()
      if (!studentId) throw new Error('No student selected')
      const interests = await api.addInterest(studentId, interest)
      set((s) => ({ students: s.students.map((x) => (x.id === studentId ? { ...x, interests } : x)) }))
      return interests
    },

    async removeInterest(interest) {
      const { studentId } = get()
      if (!studentId) return
      const interests = await api.removeInterest(studentId, interest)
      set((s) => ({ students: s.students.map((x) => (x.id === studentId ? { ...x, interests } : x)) }))
    },
  }
})
