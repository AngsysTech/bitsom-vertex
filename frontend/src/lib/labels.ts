import type { AgentId, Card, ConnectorKind, DocumentKind, StudentRecordKind, WorkspaceFile } from '@/types'

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
}

export const CONNECTOR_KIND_LABEL: Record<ConnectorKind, string> = {
  lms: 'Learning management',
  erp: 'Student records',
  academic_office: 'Academic office',
  placement: 'Careers',
  clubs_portal: 'Clubs & events',
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
  one_on_one: 'study_buddy',
}

/** Right-panel order; latest card of each type wins. */
export const CARD_ORDER: Card['type'][] = [
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
