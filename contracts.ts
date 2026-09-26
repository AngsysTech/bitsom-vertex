// =====================================================================
// STUDENT-FACING CONTRACT — buildathon  (v2)
// Frontend mocks against these shapes; backend returns exactly these.
// Backend is FastAPI returning plain JSON. No streaming, no auth.
//
// v2 changes: Slack-style workspace sections, connector/source layer
// (LMS/ERP/etc. — all "synthetic" for the demo, no real integration),
// student records, Files (documents + generated canvases), Weekly 1:1,
// Activity feed.
// =====================================================================

// ---------------------------------------------------------------------
// 0. Workspace IA (mirrors Slack's left rail)
// ---------------------------------------------------------------------

export type WorkspaceSection =
  | "home"          // channels + agent DMs + today strip
  | "dms"           // agent DMs, club agents, advisor
  | "activity"      // nudges, replies, 1:1 due, circular updates
  | "files"         // source documents + generated canvases
  | "agents_tools"; // agent directory + connectors (the platform page)

export interface Channel {
  id: string;                 // "announcements", "dbms-sem5"
  name: string;
  kind: "live" | "coming_soon";
  description: string;
  // "live" channels are read-only feeds in the demo (e.g. circulars land in #announcements)
}

// ---------------------------------------------------------------------
// 1. Connectors / sources  (vision: sits on top of LMS/ERP/etc.
//    reality: every connector is "synthetic" today — say so on stage)
// ---------------------------------------------------------------------

export type ConnectorId = string;
export type ConnectorKind =
  | "lms"           // syllabus, internal marks, course materials
  | "erp"           // transcript, registrations, program rules
  | "academic_office" // handbook, circulars, exam calendar
  | "placement"     // role profiles, opportunities
  | "clubs_portal"  // club feeds, events
  | "manual";       // seeded by hand

export type ConnectorStatus = "synthetic" | "connected" | "available";

export interface Connector {
  id: ConnectorId;            // "lms_moodle", "erp_sap"
  kind: ConnectorKind;
  name: string;               // "Moodle LMS"
  status: ConnectorStatus;    // demo: "synthetic" for all seeded ones
  provides: (DocumentKind | StudentRecordKind)[];
  lastSyncAt?: string;
  note?: string;              // "Synthetic data for demo — real sync not built"
}

// ---------------------------------------------------------------------
// 2. Core entities
// ---------------------------------------------------------------------

export type StudentId = string;
export type AgentId =
  | "academic_coach"
  | "course_planner"
  | "campus_guide"
  | "study_buddy"             // timer + weekly 1:1 (P1)
  | `club:${string}`;         // club agents, e.g. "club:robotics" (P1)

export interface Student {
  id: StudentId;
  name: string;
  program: string;            // "B.Tech CSE"
  semester: number;
  careerGoal: string;         // "Data Analyst"
  interests: string[];        // drives Make it Relevant
  avatarEmoji?: string;
}

// Structured records pulled through connectors (synthetic)
export type StudentRecordKind = "transcript" | "internal_marks" | "registrations";

export interface TranscriptRow {
  courseCode: string; title: string; credits: number; grade: string; semester: number;
  bucket?: string;            // "Core" | "Data electives" — resolved by audit
}
export interface InternalMarkRow {
  courseCode: string; component: string; // "Mid-sem", "Quiz 1"
  topic?: string; scored: number; max: number; date: string;
}
export interface RegistrationRow {
  courseCode: string; semester: number; status: "registered" | "waitlisted";
}

export interface StudentRecords {
  studentId: StudentId;
  transcript:     { connectorId: ConnectorId; rows: TranscriptRow[] };
  internalMarks:  { connectorId: ConnectorId; rows: InternalMarkRow[] };
  registrations:  { connectorId: ConnectorId; rows: RegistrationRow[] };
}

export interface Agent {
  id: AgentId;
  kind: "specialist" | "buddy" | "club";
  name: string;
  tagline: string;
  emoji: string;
  scope: DocumentId[];        // docs this agent may read — shown in right panel + Agents page
  starters: string[];         // 3 suggested first questions
}

export type DocumentId = string;
export type DocumentKind =
  | "handbook" | "circular" | "catalog" | "syllabus" | "exam_calendar"
  | "past_papers" | "resources" | "club_feed" | "events" | "role_profiles";

export interface DocumentSection {
  id: string;                 // "handbook.4.2" — stable, used by citations
  heading: string;
  text: string;
  page?: number;
}

export interface Document {
  id: DocumentId;
  kind: DocumentKind;
  title: string;
  connectorId: ConnectorId;   // where it came from (synthetic today)
  effectiveDate?: string;     // circulars override handbook by date
  sections: DocumentSection[];
}

// ---------------------------------------------------------------------
// 3. Chat
// ---------------------------------------------------------------------

export type Role = "student" | "agent" | "advisor" | "system";

export interface Citation {
  id: string;                 // "C1" — referenced inline in Message.text as [C1]
  docId: DocumentId;
  docTitle: string;
  sectionId: string;
  sectionHeading: string;
  quote: string;              // exact span; backend verifies before returning
}

export interface ToolTrace {
  tool: string;               // "run_degree_audit"
  summary: string;            // "Read handbook §4 + circular 2026-03, counted 14/18 elective credits"
  durationMs: number;
}

export interface Message {
  id: string;
  threadId: string;
  role: Role;
  agentId?: AgentId;
  replyToId?: string;         // club-agent replies inside a thread (P1)
  createdAt: string;
  text: string;               // markdown; citations inline as [C1]
  citations: Citation[];
  cards: Card[];              // right panel; latest wins per type
  trace: ToolTrace[];
  escalation?: Escalation;
}

export interface Thread {
  id: string;                 // `${studentId}:${agentId}`
  studentId: StudentId;
  agentId: AgentId;
  messages: Message[];
}

// ---------------------------------------------------------------------
// 4. Right-panel cards
// ---------------------------------------------------------------------

export type Card =
  | AuditCard | WeakTopicsCard | StudyPlanCard | RelevantCard
  | CoursesCard | SkillsGapCard | PicksCard | ResourcesCard
  | OneOnOneCard;

// ---- Academic Coach --------------------------------------------------

export interface AuditBucket {
  name: string;
  done: number;
  required: number;
  status: "ok" | "gap" | "at_risk";
  note?: string;              // "Min raised from 4 to 5 electives by circular 2026-03"
  citationIds: string[];
}

export interface AuditCard {
  type: "audit";
  onTrack: boolean;
  headline: string;
  buckets: AuditBucket[];
  unmetPrereqs: { course: string; missing: string; citationId: string }[];
  computedAt: string;
}

export interface WeakTopic {
  course: string; topic: string; score: string;
  examWeight: number; impact: number; citationId: string;
}
export interface WeakTopicsCard { type: "weak_topics"; items: WeakTopic[]; }

export interface PlanBlock {
  id: string;                 // used by the timer + 1:1 recap
  course: string; topic: string; minutes: number;
  why: string; citationId?: string;
}
export interface PlanWeek { label: string; examNote?: string; blocks: PlanBlock[]; }
export interface StudyPlanCard { type: "study_plan"; weeks: PlanWeek[]; }

export interface RelevantCard {
  type: "relevant";
  concept: string; course: string; interest: string;
  standard: string; reframed: string; citationIds: string[];
}

// ---- Course Planner --------------------------------------------------

export interface CourseRec {
  code: string; title: string; credits: number; slot: string; faculty: string;
  fillsBucket: string; why: string; clashesWith?: string; citationIds: string[];
}
export interface CoursesCard { type: "courses"; forSemester: number; items: CourseRec[]; }

export interface SkillsGapCard {
  type: "skills_gap";
  role: string;
  covered: { skill: string; via: string }[];
  coveredAfterPlan: { skill: string; via: string }[];
  missing: string[];
  citationIds: string[];
}

// ---- Campus Guide ----------------------------------------------------

export interface Pick {
  kind: "club" | "event" | "opportunity";
  name: string; when?: string; why: string; anecdote?: string;
  wildcard: boolean; clubAgentId?: AgentId; citationIds: string[];
}
export interface PicksCard { type: "picks"; items: Pick[]; }

export interface Resource {
  kind: "ta_hours" | "faculty" | "library" | "tutoring" | "lab";
  name: string; forCourse?: string; when?: string; where?: string; citationId: string;
}
export interface ResourcesCard { type: "resources"; items: Resource[]; }

// ---------------------------------------------------------------------
// 5. Escalation (human advisor)
// ---------------------------------------------------------------------

export interface Escalation {
  ticketId: string;
  status: "open" | "answered";
  reason: "out_of_scope" | "needs_human" | "conflicting_rules";
}

export interface Ticket {
  ticketId: string;
  studentId: StudentId; studentName: string; agentId: AgentId;
  question: string;
  agentSummary: string;       // pre-triage: what the agent found + why it stopped
  citations: Citation[];
  status: "open" | "answered";
  reply?: { text: string; at: string };
  createdAt: string;
}

// ---------------------------------------------------------------------
// 6. Shared student state (agents read; right panel loads from it)
// ---------------------------------------------------------------------

export interface StudentState {
  studentId: StudentId;
  audit?: AuditCard;
  weakTopics?: WeakTopicsCard;
  plan?: StudyPlanCard;
  skillsGap?: SkillsGapCard;
  updatedAt: string;
}

// ---------------------------------------------------------------------
// 7. Study Buddy: timer + Weekly 1:1  (P1 — "manage their time")
// ---------------------------------------------------------------------

export type BuddyMood = "idle" | "focused" | "break" | "celebrating" | "nudging";

export interface BuddyState {
  studentId: StudentId;
  mood: BuddyMood;
  streakDays: number;
  sessionsToday: number;
  minutesToday: number;
  nextBlock?: PlanBlock;
  line: string;               // one grounded LLM line per event
  offerRelevant?: { concept: string; course: string };
  oneOnOneDue: boolean;       // Activity + Home strip show a "1:1 ready" prompt
}

export interface StudySession {
  id: string;
  studentId: StudentId;
  blockId: string;
  course: string; topic: string;
  plannedMinutes: number;
  startedAt: string; endedAt?: string;
  outcome?: "completed" | "abandoned";
}

// Weekly 1:1 — buddy-led, renders like Slack's "Weekly 1:1" canvas.
// Backend builds it from sessions vs plan + StudentState; student answers
// 2–3 questions; completing it returns the adjusted plan.
export interface OneOnOne {
  id: string;
  studentId: StudentId;
  weekLabel: string;                        // "Week of Sep 21"
  status: "ready" | "in_progress" | "done";
  recap: {
    plannedMinutes: number; doneMinutes: number;
    blocksPlanned: number; blocksDone: number;
    completedTopics: string[]; skippedTopics: string[];
    weakTopicMovement: { topic: string; from: number; to: number }[]; // impact score
    streakDays: number;
  };
  wins: string[];                           // grounded in sessions ("3 sessions on Normalization")
  concerns: string[];                       // grounded ("B+ trees skipped twice; end-sem Oct 18")
  questions: { id: string; prompt: string; answer?: string }[]; // "What blocked B+ trees?"
  proposedAdjustments: { blockId?: string; change: "add" | "move" | "drop" | "resize"; detail: string }[];
  adjustedPlan?: StudyPlanCard;             // set when status === "done"
  shareWithAdvisor: boolean;                // opt-in; creates a Ticket summary if true
}

export interface OneOnOneCard { type: "one_on_one"; oneOnOne: OneOnOne; }

// ---------------------------------------------------------------------
// 8. Files: source documents + generated canvases
// ---------------------------------------------------------------------

export type WorkspaceFile =
  | { kind: "document"; id: DocumentId; title: string; docKind: DocumentKind;
      connectorId: ConnectorId; effectiveDate?: string; updatedAt: string }
  | { kind: "canvas"; id: string; title: string;
      canvasKind: "audit_report" | "study_plan" | "one_on_one" | "course_plan";
      cardType: Card["type"]; updatedAt: string };

// ---------------------------------------------------------------------
// 9. Activity feed (P2 — cheap once the rest exists)
// ---------------------------------------------------------------------

export interface ActivityItem {
  id: string;
  kind: "buddy_nudge" | "advisor_reply" | "one_on_one_ready" | "circular_update" | "escalation_opened";
  text: string;
  at: string;
  link: { section: WorkspaceSection; agentId?: AgentId; fileId?: string; ticketId?: string };
  read: boolean;
}

// ---------------------------------------------------------------------
// 10. Endpoints
// ---------------------------------------------------------------------
//
// Workspace
//   GET  /workspace/:studentId             -> { channels: Channel[], agents: Agent[], connectors: Connector[] }
//   GET  /connectors                        -> Connector[]   (Agents & tools page — all "synthetic")
//
// Students / records / docs
//   GET  /students                          -> Student[]
//   GET  /students/:id/state                -> StudentState  (runs audit on first load if missing)
//   GET  /students/:id/records              -> StudentRecords
//   GET  /files/:studentId                  -> WorkspaceFile[]
//   GET  /documents/:docId                  -> Document
//   GET  /documents/:docId/sections/:secId  -> DocumentSection (citation viewer)
//
// Chat
//   GET  /threads/:studentId/:agentId       -> Thread
//   POST /chat  {studentId, agentId, text}  -> Message[]   (1 normally; 2 when a club agent replies)
//
// Make it Relevant (P1)
//   POST /relevant {studentId, course, concept, interest?} -> RelevantCard
//
// Advisor
//   GET  /advisor/inbox                     -> Ticket[]
//   POST /advisor/reply {ticketId, text}    -> Ticket
//   (student thread polls GET /threads/... every 3s while an escalation is "open")
//
// Study Buddy (P1)
//   GET  /buddy/:studentId                  -> BuddyState
//   POST /sessions/start {studentId, blockId}        -> StudySession
//   POST /sessions/complete {sessionId, outcome}     -> BuddyState
//   GET  /one-on-one/:studentId/current     -> OneOnOne     (builds one if a week has passed / demo flag)
//   POST /one-on-one/:id/answer {questionId, answer} -> OneOnOne
//   POST /one-on-one/:id/complete {shareWithAdvisor} -> OneOnOne (status "done", adjustedPlan set,
//                                                      StudentState.plan updated, Ticket if shared)
//
// Activity (P2)
//   GET  /activity/:studentId               -> ActivityItem[]
//
// Errors: {error: string} with 4xx/5xx. Frontend shows a Marker row, never a blank bubble.
