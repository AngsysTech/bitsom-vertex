// The API surface the UI uses. Every method maps 1:1 to an endpoint in contracts.ts §10.
import type {
  ActionItem,
  ActionsCard,
  Agent,
  AgentId,
  CalendarItem,
  Channel,
  ClassChannel,
  Connector,
  CoverageCard,
  Document,
  DocumentId,
  Handout,
  Lecture,
  Message,
  OneOnOne,
  RelevantCard,
  StuckMarker,
  Student,
  StudentId,
  StudentState,
  Thread,
  Ticket,
  Transcript,
  WorkspaceFile,
} from '@/types'

export interface Workspace {
  channels: Channel[]
  classes: ClassChannel[]
  agents: Agent[]
  connectors: Connector[]
}

export type CalendarStatus = NonNullable<CalendarItem['status']>

/** POST /lectures: multipart (audio) or JSON (transcriptText). */
export type NewLecture =
  | { studentId: StudentId; courseCode: string; date: string; audio: Blob; filename: string; source: 'recording' | 'upload' }
  | { studentId: StudentId; courseCode: string; date: string; transcriptText: string }

export interface Api {
  getStudents(): Promise<Student[]> // GET  /students
  getWorkspace(studentId: StudentId): Promise<Workspace> // GET  /workspace/:studentId
  getClasses(studentId: StudentId): Promise<ClassChannel[]> // GET  /classes/:studentId
  getStudentState(studentId: StudentId): Promise<StudentState> // GET  /students/:id/state
  getFiles(studentId: StudentId): Promise<WorkspaceFile[]> // GET  /files/:studentId
  getDocument(docId: DocumentId): Promise<Document> // GET  /documents/:docId
  getThread(studentId: StudentId, agentId: AgentId): Promise<Thread> // GET  /threads/:studentId/:agentId
  getClassThread(studentId: StudentId, courseCode: string): Promise<Thread> // GET  /threads/:studentId/class/:courseCode
  chat(body: { studentId: StudentId; agentId: AgentId; text: string; courseCode?: string }): Promise<Message[]> // POST /chat
  getInbox(): Promise<Ticket[]> // GET  /advisor/inbox
  advisorReply(body: { ticketId: string; text: string }): Promise<Ticket> // POST /advisor/reply

  // Class Companion
  createLecture(body: NewLecture): Promise<Lecture> // POST /lectures
  processLecture(lectureId: string): Promise<Lecture> // POST /lectures/:id/process
  getLecture(lectureId: string): Promise<Lecture> // GET  /lectures/:id
  getTranscript(lectureId: string): Promise<Transcript> // GET  /lectures/:id/transcript
  getHandout(lectureId: string): Promise<Handout> // GET  /lectures/:id/handout
  getLectureCards(lectureId: string): Promise<{ coverage: CoverageCard; actions: ActionsCard }> // GET /lectures/:id/cards
  addMarker(lectureId: string, body: { atSec: number; note?: string }): Promise<StuckMarker> // POST /lectures/:id/markers
  getMarkers(lectureId: string): Promise<StuckMarker[]> // GET  /lectures/:id/markers
  getStudentLectures(studentId: StudentId): Promise<Lecture[]> // GET  /students/:id/lectures
  updateAction(actionId: string, status: ActionItem['status']): Promise<ActionItem> // POST /actions/:id

  // Calendar
  getCalendar(studentId: StudentId, q: { from: string; to: string; courseCode?: string }): Promise<CalendarItem[]> // GET /calendar/:studentId
  setCalendarStatus(itemId: string, status: CalendarStatus, studentId: StudentId): Promise<CalendarItem> // POST /calendar/items/:id/status

  // Weekly 1:1
  getOneOnOne(studentId: StudentId): Promise<OneOnOne> // GET  /one-on-one/:studentId/current
  answerOneOnOne(id: string, body: { questionId: string; answer: string }): Promise<OneOnOne> // POST /one-on-one/:id/answer
  completeOneOnOne(id: string, body: { shareWithAdvisor: boolean }): Promise<OneOnOne> // POST /one-on-one/:id/complete

  // Make it Relevant
  makeRelevant(body: { studentId: StudentId; interest?: string; source: NonNullable<RelevantCard['source']> }): Promise<RelevantCard> // POST /relevant
  getRelevant(studentId: StudentId): Promise<RelevantCard[]> // GET  /relevant/:studentId
}

export class ApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}
