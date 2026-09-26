// =====================================================================
// STUDENT-FACING CONTRACT — buildathon  (v3.9)
// Frontend mocks against these shapes; backend returns exactly these.
// Backend is FastAPI returning plain JSON. No streaming, no auth.
//
// v2 changes: Slack-style workspace sections, connector/source layer
// (LMS/ERP/etc. — all "synthetic" for the demo, no real integration),
// student records, Files (documents + generated canvases), Weekly 1:1,
// Activity feed.
// v3 changes: Class Companion (audio → handout → coverage → actions) as P0;
// CoverageCard + ActionsCard in the Card union.
// v3.9: MindMap over the handout (jury-approved reuse), GET /lectures/:id/mindmap.
// v3.8: OneOnOne recap fields as built (blocksMissed, prepMet/Missed, movementNote, window); direct
// /diagnose and /plan tool endpoints; simulate-week semantics as built (moves the student's clock).
// v3.7: GradedAnswerRow (exam-system feedback, synthetic), WeakTopic.gaps, MIR source "gap".
// v3.6: campus discovery as a calendar source (Pick.status/suggestedCalendarItem, CalendarItem source "event", /discover, /picks).
// v3.5: class channels (ClassChannel, Channel.kind "class", per-course threads, chat courseCode scope),
// calendar courseCode filter, GET /classes.
// v3.4: StuckMarker (tap-to-flag in class), confusion in Coverage, MIR sources.
// v3.3: ToolTrace.error/dropped; POST /demo/simulate-week.
// v3.2: units replaces credits everywhere (dataset truth); calendar item status.
// v3.1: LectureCommitment (next-lecture prep, assignments, deadlines), prep/deadline
// action kinds, CalendarItem + GET /calendar merging timetable, exams, plan, actions.
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
  id: string;                 // "announcements", "class:CS F212"
  name: string;               // "announcements", "cs-f212-dbms"
  kind: "live" | "coming_soon" | "class";
  description: string;
  // "live" channels are read-only feeds in the demo (e.g. circulars land in #announcements)
  // "class" channels: one per enrolled course; the Academic Coach inside is scoped to that course
  courseCode?: string;        // kind === "class"
}

// Sidebar "Classes" group — one per registered course. The coach in a class
// channel reads only that course's syllabus, lectures, past papers and exam dates.
export interface ClassChannel {
  channelId: string;          // "class:CS F212"
  courseCode: string;
  title: string;              // "Database Systems"
  faculty: string;
  slot: string;               // "T1"
  nextSessionAt?: string;     // ISO, from timetable
  nextSessionRoom?: string;
  examAt?: string;            // next exam (quiz/mid/end) ISO
  examKind?: "quiz" | "mid_sem" | "end_sem";
  pendingActions: number;     // proposed, not yet accepted/dismissed
  prepDue: number;            // accepted prep items due before nextSessionAt
  latestLecture?: { lectureId: string; date: string; status: LectureStatus };
  weakTopicCount: number;     // topics for this course with impact ≥ 50
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
  | "exam_system"   // per-question graded answers with rubric feedback
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
export type StudentRecordKind = "transcript" | "internal_marks" | "registrations" | "graded_answers";

export interface TranscriptRow {
  courseCode: string; title: string; units: number; grade: string; semester: number;
  bucket?: string;            // "Core" | "Data electives" — resolved by audit
}
export interface InternalMarkRow {
  courseCode: string; component: string; // "Mid-sem", "Quiz 1"
  topic?: string; scored: number; max: number; date: string;
}
export interface RegistrationRow {
  courseCode: string; semester: number; status: "registered" | "waitlisted";
}
// Per-question grading output from an exam-grading system (synthetic here).
// This is where "why you lost marks" comes from; the diagnosis attaches it to weak topics.
export interface GradedAnswerRow {
  courseCode: string; exam: string;         // "Mid-sem"
  question: string;                         // "Q3b"
  topic: string;                            // canonical syllabus topic
  scored: number; max: number;
  rubricFeedback: string;                   // one sentence, what was missing/wrong
  gapTag: string;                           // canonical, e.g. "transitive-dependency-not-removed"
  date: string;
}

export interface StudentRecords {
  studentId: StudentId;
  transcript:     { connectorId: ConnectorId; rows: TranscriptRow[] };
  internalMarks:  { connectorId: ConnectorId; rows: InternalMarkRow[] };
  registrations:  { connectorId: ConnectorId; rows: RegistrationRow[] };
  gradedAnswers?: { connectorId: ConnectorId; rows: GradedAnswerRow[] }; // connector kind "exam_system"
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
  summary: string;            // "Read handbook §4 + circular 2026-03, counted 14/18 elective units"
  durationMs: number;
  error?: string;             // set when the step failed; the message then carries a system line
  dropped?: string[];         // citation/segment ids that failed verification (never silently kept)
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
  id: string;                 // `${studentId}:${agentId}` for DMs; `${studentId}:class:${courseCode}` for class channels
  studentId: StudentId;
  agentId: AgentId;
  courseCode?: string;        // set for class-channel threads: scope is that course only
  messages: Message[];
}

// ---------------------------------------------------------------------
// 4. Right-panel cards
// ---------------------------------------------------------------------

export type Card =
  | AuditCard | WeakTopicsCard | StudyPlanCard | RelevantCard
  | CoursesCard | SkillsGapCard | PicksCard | ResourcesCard
  | OneOnOneCard | CoverageCard | ActionsCard;

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
  gaps?: {                                  // from GradedAnswerRow, when present
    tag: string;                            // "transitive-dependency-not-removed"
    evidence: string;                       // "Q3b mid-sem: decomposed to 3NF without removing the transitive dependency"
    marksLost: number;
    citationId: string;                     // the graded-answer row
  }[];
}
export interface WeakTopicsCard { type: "weak_topics"; items: WeakTopic[]; }

export interface PlanBlock {
  id: string;                 // used by the timer + 1:1 recap
  course: string; topic: string; minutes: number;
  why: string; citationId?: string;
}
export interface PlanWeek { label: string; examNote?: string; blocks: PlanBlock[]; }
export interface StudyPlanCard { type: "study_plan"; weeks: PlanWeek[]; }

// Make it Relevant — same facts, reframed through the student's interest.
// Attaches to a handout section (esp. a stuck one), a plan block, or a weak topic.
export interface RelevantCard {
  type: "relevant";
  concept: string; course: string; interest: string;
  standard: string;           // grounded explanation, cites syllabus/handout section
  reframed: string;           // same facts through the interest; no new facts
  citationIds: string[];
  source?: { type: "handout_section"; lectureId: string; sectionId: string; markerId?: string }
         | { type: "plan_block"; planBlockId: string }
         | { type: "weak_topic"; course: string; topic: string }
         | { type: "gap"; course: string; topic: string; tag: string };
}

// ---- Course Planner --------------------------------------------------

export interface CourseRec {
  code: string; title: string; units: number; slot: string; faculty: string;
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

// Campus discovery — "what's happening that's worth your time", grounded in
// events.json / clubs.json / club_feed.md and tied to the student's weak topics,
// career goal or interests. Accepting a pick puts it on the calendar.
export interface Pick {
  id: string;
  kind: "club" | "event" | "opportunity";
  name: string; when?: string; where?: string; why: string; anecdote?: string;
  relatedTo?: { type: "weak_topic"; course: string; topic: string }
            | { type: "career_goal"; role: string }
            | { type: "interest"; interest: string };
  wildcard: boolean;          // exactly one per response, outside stated interests, with a reason
  clubAgentId?: AgentId;
  citationIds: string[];
  suggestedCalendarItem?: { start: string; end?: string; allDay?: boolean }; // resolved from events.json
  status: "proposed" | "accepted" | "dismissed";
  calendarItemId?: string;    // set when accepted
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
    movementNote?: string;                                           // "no new marks this week — movement is 0"
    flaggedTopics: { topic: string; times: number }[];               // stuck markers this week, by topic
    blocksMissed: number;
    prepMet: number; prepMissed: number;                             // accepted prep items met/missed before their session
    window: { from: string; to: string };                            // the 7-day review window (ISO)
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
// 9b. Class Companion — audio → handout → coverage → actions  (P0)
//     Transcription + handout structuring: prior audio-to-notes pipeline,
//     reused with explicit jury approval, vendored under
//     backend/app/vendored/audio_notes/ (see its NOTICE.md). An adapter
//     maps its output into Handout below; the vendored schema never
//     leaks into this API. Coverage + Actions: new, built today.
//     Runs inside the Academic Coach DM: upload/record in the composer,
//     Marker rows while processing, agent message + Canvas handout + two
//     right-panel cards when ready.
// ---------------------------------------------------------------------

export type LectureStatus =
  | "uploaded" | "transcribing" | "transcribed" | "processing" | "ready" | "failed";

export interface Lecture {
  id: string;
  studentId: StudentId;
  courseCode: string;
  date: string;               // ISO
  title?: string;
  source: "upload" | "recording" | "transcript"; // "transcript" = text fallback path
  audioUrl?: string;
  durationSec?: number;
  status: LectureStatus;
  error?: string;
  connectorId: ConnectorId;   // lms_moodle in the demo
}

export interface TranscriptSegment {
  id: string;                 // "s12"
  startSec: number;
  endSec: number;
  text: string;
}

export interface Transcript {
  lectureId: string;
  segments: TranscriptSegment[];
}

// "I'm stuck here" — a tap during class (or a click on the handout timeline
// afterwards). Timestamp + optional five-word note. No audio of its own.
export interface StuckMarker {
  id: string;
  lectureId: string;
  atSec: number;              // elapsed seconds into the lecture
  note?: string;              // "lost at 2PL diagram" — optional, ≤ 60 chars
  createdAt: string;
  segmentId?: string;         // resolved by backend: the segment covering atSec
  handoutSectionId?: string;  // resolved after the handout is built
  topic?: string;             // resolved: canonical syllabus topic of that section
}

export interface HandoutSection {
  id: string;
  heading: string;
  keyPoints: string[];
  definitions: { term: string; definition: string }[];
  examples: string[];
  examHints: string[];        // "this will be on the end-sem" — verified quotes
  segmentIds: string[];       // provenance into the transcript; every id must exist
  syllabusTopic?: string;     // canonical topic string from the syllabus
  syllabusSectionId?: string; // citation into the syllabus document
  stuck?: { markerIds: string[]; atSec: number[] }; // student flagged this part in class
}

export interface Handout {
  id: string;
  lectureId: string;
  courseCode: string;
  title: string;
  summary: string;            // 3–4 sentences
  sections: HandoutSection[];
  createdAt: string;
}

// What the lecture covered vs what the syllabus unit says it should have
export interface CoverageCard {
  type: "coverage";
  lectureId: string;
  courseCode: string;
  unit: string;
  covered:    { topic: string; handoutSectionIds: string[] }[];
  missed:     { topic: string; syllabusSectionId: string; why: string }[];
  emphasized: { topic: string; segmentId: string; quote: string }[]; // quote verified verbatim
  confusion:  { topic: string; markerId: string; atSec: number; handoutSectionId: string; note?: string }[]; // from StuckMarkers
}

export interface ActionItem {
  id: string;
  lectureId: string;
  kind: "study" | "review" | "ask" | "resource" | "prep" | "deadline";
  //   prep     = prerequisite for the next lecture ("we'll do deadlocks next week")
  //   deadline = assignment/submission the lecturer mentioned
  title: string;              // "Self-study: Two-phase locking (skipped in lecture)"
  course: string;
  topic: string;
  minutes?: number;
  dueBy?: string;             // ISO, derived from exam calendar
  why: string;                // "Skipped in class; carried 14–18 marks in last 3 end-sems"
  provenance: { segmentId?: string; syllabusSectionId?: string; pastPapersCitationId?: string; commitmentId?: string; markerId?: string };
  status: "proposed" | "accepted" | "dismissed" | "done";
  planBlockId?: string;       // set when accepted → PlanBlock added to StudentState.plan
  calendarItemId?: string;    // set when accepted → CalendarItem created
}

// Things the lecturer said that bind the future: verified quotes with timestamps
export interface LectureCommitment {
  id: string;
  lectureId: string;
  kind: "next_lecture_topic" | "assignment" | "reading" | "deadline" | "exam_hint";
  text: string;               // normalised: "Deadlocks will be covered next lecture"
  dueBy?: string;             // ISO, resolved from timetable/exam calendar when the lecturer says "next week"/"Friday"
  segmentId: string;
  quote: string;              // verbatim from the segment; verified
}

export interface ActionsCard {
  type: "actions";
  lectureId: string;
  commitments: LectureCommitment[];
  items: ActionItem[];        // derived from missed + emphasized + commitments
}


// ---- Lecture mind map (jury-approved reuse of the Enstine mind-map code) ----
// Structure = handout sections; overlay = coverage, markers, exam hints.
// A view of the same data as the handout, not a new source of facts.

export type MindMapNodeKind = "root" | "section" | "point" | "ghost_missed";

export interface MindMapNode {
  id: string;
  kind: MindMapNodeKind;
  label: string;              // section heading / key point / missed topic
  parentId?: string;
  handoutSectionId?: string;  // section + point nodes
  syllabusSectionId?: string; // section (when mapped) and ghost nodes
  segmentIds?: string[];      // provenance; first one is the "jump to" target
  flags: {
    stuck?: { markerIds: string[]; atSec: number[] };
    emphasized?: { quote: string; segmentId: string };
    missed?: { why: string };                 // ghost nodes only
    reviewActionId?: string;                  // an action already exists for this node
  };
  order: number;
}

export interface MindMap {
  lectureId: string;
  courseCode: string;
  builtAt: string;
  nodes: MindMapNode[];       // tree via parentId; root has none
  stats: { sections: number; points: number; stuck: number; missed: number; emphasized: number };
}

// ---- Calendar: one merged view of classes, exams, study blocks, actions ----

export type CalendarItemKind = "class" | "exam" | "quiz" | "study_block" | "action" | "prep" | "deadline" | "event";

export interface CalendarItem {
  id: string;
  studentId: StudentId;
  kind: CalendarItemKind;
  title: string;
  courseCode?: string;
  start: string;              // ISO datetime
  end?: string;               // ISO datetime; omit for all-day deadlines
  allDay?: boolean;
  source:                     // where it came from — never invented
    | { type: "timetable" }
    | { type: "exam_calendar"; examId: string }
    | { type: "plan_block"; planBlockId: string }
    | { type: "action"; actionId: string; lectureId: string }
    | { type: "event"; pickId: string; eventId?: string; clubSlug?: string }; // accepted campus pick
  status?: "planned" | "done" | "missed";
}

// ---------------------------------------------------------------------
// 10. Endpoints
// ---------------------------------------------------------------------
//
// Workspace
//   GET  /workspace/:studentId             -> { channels: Channel[], classes: ClassChannel[], agents: Agent[], connectors: Connector[] }
//   GET  /classes/:studentId               -> ClassChannel[]   (sidebar group + Today block; recomputed on every call)
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
//   GET  /threads/:studentId/:agentId       -> Thread                  (DM)
//   GET  /threads/:studentId/class/:courseCode -> Thread               (class channel; lecture events + scoped coach)
//   POST /chat  {studentId, agentId, text, courseCode?} -> Message[]   (courseCode ⇒ scope = that course only;
//                                                                       out-of-course questions get "ask me in my DM")
//
// Make it Relevant (P0 — on handout sections, stuck sections, plan blocks, weak topics)
//   POST /relevant {studentId, interest?, source: RelevantCard["source"]} -> RelevantCard
//        (concept + course + citations resolve from the source; interest defaults to the student's first)
//   GET  /relevant/:studentId               -> RelevantCard[]  (history, for the Canvas)
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
// Class Companion (P0)
//   POST /lectures                          multipart {studentId, courseCode, date, audio}
//                                           or JSON {studentId, courseCode, date, transcriptText}
//                                           -> Lecture
//   POST /lectures/:id/process              -> Lecture (status "transcribing"|"processing"; poll GET /lectures/:id every 2s)
//   GET  /lectures/:id                      -> Lecture
//   GET  /lectures/:id/transcript           -> Transcript
//   GET  /lectures/:id/handout              -> Handout       (404 until status "ready")
//   GET  /lectures/:id/cards                -> { coverage: CoverageCard; actions: ActionsCard }
//   GET  /lectures/:id/mindmap              -> MindMap        (404 until "ready"; rebuilt when markers/cards change)
//   POST /lectures/:id/mindmap/rebuild      -> MindMap
//   POST /lectures/:id/markers {atSec, note?} -> StuckMarker   (works while recording, before processing, or after)
//   GET  /lectures/:id/markers              -> StuckMarker[]
//   (markers added after the handout exists are resolved immediately; the coverage/actions
//    cards are recomputed and a short agent Message is appended noting the new review item)
//   POST /actions/:id  {status}             -> ActionItem    ("accepted" adds a PlanBlock to StudentState.plan
//                                                             AND creates a CalendarItem; returns both ids)
//   GET  /calendar/:studentId?from=&to=&courseCode= -> CalendarItem[] (timetable + exams + plan blocks + accepted actions,
//                                                       merged; courseCode filters to one class's Schedule tab)
//   POST /calendar/items/:id/status {status: "done"|"missed"|"planned"} -> CalendarItem  (feeds the weekly lookback)
//   GET  /students/:id/lectures             -> Lecture[]
//   (when a lecture reaches "ready", the backend also appends an agent Message to the
//    academic_coach thread with the handout summary, coverage + actions cards, and trace)
//
// Campus discovery (isolated; enters the demo only if merged by 3:30)
//   GET  /discover/:studentId               -> PicksCard   (3 picks + 1 wildcard; cached per student per day)
//   POST /picks/:id  {status}               -> Pick        ("accepted" creates a CalendarItem kind "event", source {type:"event"})
//
// Coach tools, callable directly (the chat router calls the same functions)
//   POST /students/:id/diagnose             -> WeakTopicsCard   (recomputes and writes StudentState.weakTopics)
//   POST /students/:id/plan                 -> StudyPlanCard    (rebuilds plan + its calendar items; leaves action/event items alone)
//
// Demo setup (disclosed on stage; writes statuses and moves that student's clock, never text)
//   POST /demo/simulate-week/:studentId     -> { updated: number; clockNow: string }
//        (marks the next 7 days' plan blocks done/missed — every third missed — then moves the
//         student's clock forward 7 days so the review has a "last week". Run BEFORE the demo.)
//
// Activity (P2)
//   GET  /activity/:studentId               -> ActivityItem[]
//
// Errors: {error: string} with 4xx/5xx. Frontend shows a Marker row, never a blank bubble.