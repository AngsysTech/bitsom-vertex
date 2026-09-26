import type { ActionItem, AgentId, CalendarItemKind, Card, ConnectorKind, DocumentKind, LectureCommitment, LectureStatus, StudentRecordKind, WorkspaceFile } from '@/types'

export const DOC_KIND_LABEL: Record<DocumentKind, string> = {
  handbook: 'Handbook',
  circular: 'Circulars',
  catalog: 'Catalog',
  syllabus: 'Syllabus',
  exam_calendar: 'Exam calendar',
  past_papers: 'Past papers',
  resources: 'Resources',
  club_feed: 'Club feed',
  events: 'Events',
  role_profiles: 'Role profiles',
}

export const PROVIDES_LABEL: Record<DocumentKind | StudentRecordKind, string> = {
  ...DOC_KIND_LABEL,
  transcript: 'Transcript',
  internal_marks: 'Internal marks',
  registrations: 'Registrations',
  graded_answers: 'Graded answers',
}

export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  lms: 'Learning management',
  erp: 'Student records',
  academic_office: 'Academic office',
  placement: 'Careers',
  clubs_portal: 'Clubs & events',
  exam_system: 'Exam system',
  manual: 'Seeded by hand',
}

export const DOC_KIND_ICON: Partial<Record<DocumentKind, string>> = {
  circular: 'campaign',
  catalog: 'menu_book',
  exam_calendar: 'event',
  past_papers: 'quiz',
  club_feed: 'groups',
  events: 'celebration',
  role_profiles: 'work',
}

export const fileIcon = (f: WorkspaceFile) =>
  f.kind === 'canvas' ? 'dashboard' : (DOC_KIND_ICON[f.docKind] ?? 'description')

/** Which agent produces each card type — used for canvas attribution and empty states. */
export const CARD_AGENT: Record<Card['type'], AgentId> = {
  audit: 'academic_coach',
  weak_topics: 'academic_coach',
  study_plan: 'academic_coach',
  relevant: 'academic_coach',
  courses: 'course_planner',
  skills_gap: 'course_planner',
  picks: 'campus_guide',
  resources: 'campus_guide',
  one_on_one: 'academic_coach',
  coverage: 'academic_coach',
  actions: 'academic_coach',
}

/** Right-panel order; latest card of each type wins. */
export const CARD_ORDER: Card['type'][] = [
  'coverage',
  'actions',
  'audit',
  'weak_topics',
  'study_plan',
  'courses',
  'skills_gap',
  'picks',
  'resources',
  'relevant',
]

/** Audit bucket status colours (ok / gap / at risk). */
export const STATUS_COLOR = { ok: '#10B981', gap: '#F59E0B', at_risk: '#EF4444' } as const

export const isClubAgent = (id: string) => id.startsWith('club:')

/** Agents that are below the line today: rendered greyed under "coming soon" when /workspace doesn't return them. */
export const COMING_SOON_AGENTS: { id: AgentId; name: string; emoji: string; tagline: string }[] = [
  { id: 'course_planner', name: 'Course Planner', emoji: '📅', tagline: 'Electives, slot clashes and skills for your target role' },
  { id: 'campus_guide', name: 'Campus Guide', emoji: '🧭', tagline: 'Help, resources, clubs and events worth your time' },
]

/** Club agents are below the line too; the Agents page shows them as one "coming soon" card each. */
export const COMING_SOON_CLUBS: { name: string; emoji: string; tagline: string }[] = [
  { name: 'Club agents', emoji: '🎭', tagline: 'Each club answers from its own feed, inside Campus Guide threads' },
]

/** Calendar block styles by kind (brief §5). Cyan is the accent: study blocks and actions only. */
export const KIND_STYLE: Record<CalendarItemKind, { label: string; block: string; dot: string }> = {
  class: { label: 'Class', block: 'border-ink bg-white text-ink', dot: '#0F172A' },
  exam: { label: 'Exam', block: 'border-bad bg-bad-soft text-ink', dot: '#EF4444' },
  quiz: { label: 'Quiz', block: 'border-bad bg-bad-soft text-ink', dot: '#EF4444' },
  study_block: { label: 'Study', block: 'border-cyan bg-cyan-soft text-ink', dot: '#22D3EE' },
  prep: { label: 'Prep', block: 'border-warn bg-warn-soft text-ink', dot: '#F59E0B' },
  deadline: { label: 'Deadline', block: 'border-bad bg-white text-ink', dot: '#EF4444' },
  action: { label: 'Action', block: 'border-cyan bg-white text-ink', dot: '#0891B2' },
  event: { label: 'Event', block: 'border-ink-3 bg-soft text-ink', dot: '#94A3B8' },
  task: { label: 'My task', block: 'border-violet-500 bg-violet-50 text-ink', dot: '#8B5CF6' },
}

export const CALENDAR_KINDS: CalendarItemKind[] = ['class', 'exam', 'quiz', 'study_block', 'prep', 'action', 'deadline', 'event', 'task']

/** Kinds a student can mark done / missed / planned. Classes and exams are read-only. */
export const STUDY_KINDS: CalendarItemKind[] = ['study_block', 'prep', 'action', 'deadline']

/** STUDY_KINDS plus the student's own tasks (v3.12): everything that takes a status. */
export const STATUS_KINDS: CalendarItemKind[] = [...STUDY_KINDS, 'task']

export const ACTION_KIND_LABEL: Record<ActionItem['kind'], string> = {
  study: 'Study',
  review: 'Review',
  ask: 'Ask',
  resource: 'Resource',
  prep: 'Prep',
  deadline: 'Deadline',
}

export const COMMITMENT_LABEL: Record<LectureCommitment['kind'], string> = {
  next_lecture_topic: 'Next lecture',
  assignment: 'Assignment',
  reading: 'Reading',
  deadline: 'Deadline',
  exam_hint: 'Exam hint',
}

export const LECTURE_STATUS_LABEL: Record<LectureStatus, string> = {
  uploaded: 'Uploaded',
  transcribing: 'Transcribing',
  transcribed: 'Transcribed',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
}
