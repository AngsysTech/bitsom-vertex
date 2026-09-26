// The API surface the UI uses. Every method maps 1:1 to an endpoint in contracts.ts §10.
import type {
  Agent,
  AgentId,
  Channel,
  Connector,
  Document,
  DocumentId,
  Message,
  Student,
  StudentId,
  StudentState,
  Thread,
  Ticket,
  WorkspaceFile,
} from '@/types'

export interface Workspace {
  channels: Channel[]
  agents: Agent[]
  connectors: Connector[]
}

export interface Api {
  getStudents(): Promise<Student[]> // GET  /students
  getWorkspace(studentId: StudentId): Promise<Workspace> // GET  /workspace/:studentId
  getStudentState(studentId: StudentId): Promise<StudentState> // GET  /students/:id/state
  getFiles(studentId: StudentId): Promise<WorkspaceFile[]> // GET  /files/:studentId
  getDocument(docId: DocumentId): Promise<Document> // GET  /documents/:docId
  getThread(studentId: StudentId, agentId: AgentId): Promise<Thread> // GET  /threads/:studentId/:agentId
  chat(body: { studentId: StudentId; agentId: AgentId; text: string }): Promise<Message[]> // POST /chat
  getInbox(): Promise<Ticket[]> // GET  /advisor/inbox
  advisorReply(body: { ticketId: string; text: string }): Promise<Ticket> // POST /advisor/reply
}

export class ApiError extends Error {}
