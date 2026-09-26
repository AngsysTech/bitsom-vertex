// MOCK DATA — UI development only (MOCK=true). Shapes follow contracts.ts exactly.
// Content ported from the original HTML prototype's mock-data.js. Never demo this as real output:
// the top bar shows a "Mock data" badge whenever it is in use.
import type {
  Agent,
  AuditCard,
  Channel,
  Citation,
  Connector,
  CoursesCard,
  Document,
  DocumentKind,
  PicksCard,
  RelevantCard,
  ResourcesCard,
  SkillsGapCard,
  Student,
  StudyPlanCard,
  WeakTopicsCard,
} from '@/types'

const SYN = 'Synthetic data for demo — real sync not built'

export const CONNECTORS: Connector[] = [
  { id: 'lms_moodle', kind: 'lms', name: 'Moodle LMS', status: 'synthetic', provides: ['syllabus', 'past_papers', 'internal_marks'], note: SYN },
  { id: 'erp', kind: 'erp', name: 'Student ERP', status: 'synthetic', provides: ['transcript', 'registrations', 'catalog'], note: SYN },
  { id: 'academic_office', kind: 'academic_office', name: 'Academic Office', status: 'synthetic', provides: ['handbook', 'circular', 'exam_calendar', 'resources'], note: SYN },
  { id: 'placement', kind: 'placement', name: 'Placement Portal', status: 'synthetic', provides: ['role_profiles'], note: SYN },
  { id: 'clubs_portal', kind: 'clubs_portal', name: 'Clubs Portal', status: 'synthetic', provides: ['club_feed', 'events'], note: SYN },
]

export const DOCS: Document[] = [
  {
    id: 'handbook', kind: 'handbook', title: 'Academic Handbook 2026–27', connectorId: 'academic_office',
    sections: [
      { id: 'handbook.3.2', heading: '3.2 Graduation requirements', text: 'A student must earn a minimum of 142 units to graduate with a B.E. degree. Units are distributed across Core, Discipline Elective, Open Elective, Humanities and Practice School buckets. All core courses must be cleared with a grade of D or above.' },
      { id: 'handbook.4.1', heading: '4.1 Discipline electives', text: 'Students must complete a minimum of four discipline electives before graduation. The minimum may be revised by circular; where a circular and this handbook disagree, the circular with the later effective date prevails.' },
      { id: 'handbook.4.3', heading: '4.3 Prerequisites', text: 'A course may not be registered unless all listed prerequisites have been passed. CS F342 Compiler Construction requires CS F351 Theory of Computation. CS F213 Object Oriented Programming requires CS F111 Computer Programming.' },
      { id: 'handbook.5.4', heading: '5.4 Unit overload', text: 'Registration above 25 units in a semester requires approval of the Associate Dean and a CGPA of at least 8.0. Requests must be routed through the student’s faculty advisor at least one week before registration.' },
      { id: 'handbook.6.1', heading: '6.1 Attendance', text: 'Students are expected to attend all classes. Attendance below 75% in a course may lead to debarment from the comprehensive examination at the instructor’s discretion.' },
    ],
  },
  {
    id: 'circular-2026-03', kind: 'circular', title: 'Circular 2026-03 · Revised discipline elective minimum', connectorId: 'academic_office', effectiveDate: '2026-08-01',
    sections: [{ id: 'circular-2026-03.1', heading: 'Revision', text: 'With effect from 1 August 2026, the minimum number of discipline electives for B.E. Computer Science students of the 2023 and 2024 batches is raised from 4 to 5. Students of the 2025 batch are not affected. Students already registered for their final semester may petition for an exemption.' }],
  },
  {
    id: 'circular-2026-07', kind: 'circular', title: 'Circular 2026-07 · Library hours during mid-sems', connectorId: 'academic_office', effectiveDate: '2026-10-01',
    sections: [{ id: 'circular-2026-07.1', heading: 'Extended hours', text: 'The central library will remain open until 2:00 AM from 1 to 13 October 2026. Discussion rooms can be booked in 2-hour slots.' }],
  },
  {
    id: 'circular-2026-08', kind: 'circular', title: 'Circular 2026-08 · Practice School II registration', connectorId: 'academic_office', effectiveDate: '2026-10-01',
    sections: [{ id: 'circular-2026-08.1', heading: 'Deadline', text: 'Final-year students who have not registered for Practice School II must do so by 10 October 2026 through the Student ERP.' }],
  },
  {
    id: 'catalog', kind: 'catalog', title: 'Course Catalog — Semester II 2026–27', connectorId: 'erp',
    sections: [
      { id: 'catalog.cs-f415', heading: 'CS F415 Data Mining', text: '3 units. Slot T3 (Tue/Thu 10:00). Instructor: Dr. S. Menon. Counts as a Discipline Elective for Computer Science. Skills: pandas, data mining, clustering. Student feedback: “Project-heavy, light on exams — the Kaggle-style final is the best part.”' },
      { id: 'catalog.bits-f464', heading: 'BITS F464 Machine Learning', text: '3 units. Slot M2 (Mon/Wed 9:00). Instructor: Dr. A. Kulkarni. Counts as a Discipline Elective. Shares slot M2 with CS F301.' },
      { id: 'catalog.cs-f469', heading: 'CS F469 Information Retrieval', text: '3 units. Slot F4 (Fri 14:00). Instructor: Dr. R. Das. Counts as a Discipline Elective.' },
      { id: 'catalog.econ-f211', heading: 'ECON F211 Principles of Economics', text: '3 units. Slot W5 (Wed 16:00). Instructor: Prof. N. Shah. Counts as an Open Elective for all programmes.' },
      { id: 'catalog.cs-f342', heading: 'CS F342 Compiler Construction', text: '4 units. Slot T2 (Tue/Thu 9:00). Prerequisite: CS F351 Theory of Computation.' },
    ],
  },
  {
    id: 'syllabus-cs-f212', kind: 'syllabus', title: 'CS F212 DBMS — Handout & mid-sem blueprint', connectorId: 'lms_moodle',
    sections: [
      { id: 'syllabus-cs-f212.blueprint', heading: 'Mid-semester blueprint', text: 'Normalization (1NF–BCNF) carries 20% and Transactions & concurrency 15% of the mid-semester paper. ER modelling carries 15%, SQL 30%, and Indexing 20%.' },
      { id: 'syllabus-cs-f212.unit5', heading: 'Unit 5 · Indexing and B+ trees', text: 'A B+ tree stores all records in its leaf level; internal nodes hold only keys that route a search. Leaves are linked, which makes range queries efficient.' },
      { id: 'syllabus-cs-f212.readings', heading: 'Readings', text: 'Silberschatz, Korth and Sudarshan, Database System Concepts, 7th edition. Chapters 7, 14, 17 and 18.' },
    ],
  },
  {
    id: 'exam-calendar', kind: 'exam_calendar', title: 'Examination calendar — Semester I 2026–27', connectorId: 'academic_office',
    sections: [
      { id: 'exam-calendar.midsem', heading: 'Mid-semester examinations', text: 'Mid-semester examinations will be held from 6 to 13 October 2026. CS F212 Database Systems is scheduled for 8 October, 2:00–3:30 PM.' },
      { id: 'exam-calendar.compre', heading: 'Comprehensive examinations', text: 'Comprehensive examinations will be held from 1 to 14 December 2026. The detailed timetable will be published by 15 November 2026.' },
    ],
  },
  {
    id: 'past-papers', kind: 'past_papers', title: 'Past papers — topic-wise marks 2023–2025', connectorId: 'lms_moodle',
    sections: [
      { id: 'past-papers.cs-f212', heading: 'CS F212 Database Systems · mid-sem', text: 'BCNF decomposition has appeared in every mid-semester paper since 2023. Marks by topic (2023 / 2024 / 2025): SQL 30 / 28 / 30, Normalization 18 / 20 / 22, Indexing 20 / 22 / 18, Transactions 15 / 14 / 16, ER modelling 17 / 16 / 14.' },
    ],
  },
  {
    id: 'role-profiles', kind: 'role_profiles', title: 'Placement Cell — Role profiles 2026', connectorId: 'placement',
    sections: [
      { id: 'role-profiles.data-analyst', heading: 'Data Analyst', text: 'Recruiters for Data Analyst roles expect SQL, Python (pandas), statistics, dashboarding in Tableau or Power BI, and one end-to-end analytics project.' },
      { id: 'role-profiles.product-analyst', heading: 'Product Analyst', text: 'Product Analyst roles expect SQL, experiment design and A/B testing, product metrics, and clear written communication of findings.' },
      { id: 'role-profiles.backend-engineer', heading: 'Backend Engineer', text: 'Backend roles test data structures, algorithms, operating systems, DBMS and one system design round for final-year students.' },
    ],
  },
  {
    id: 'resources', kind: 'resources', title: 'Academic support & resources', connectorId: 'academic_office',
    sections: [
      { id: 'resources.ta-hours', heading: 'TA hours', text: 'CS F212 Database Systems: TA hours on Tuesday and Thursday, 5–6 PM, Room 2203 (Ananya R.). CS F372 Operating Systems: Monday 4–5 PM, Room 2201.' },
      { id: 'resources.faculty', heading: 'Faculty office hours', text: 'Dr. P. Sharma (CS F212) holds office hours on Wednesday, 3–4 PM, in Chamber 6120. Email ahead for slots outside these hours.' },
      { id: 'resources.library', heading: 'Library', text: 'Mid-semester and comprehensive papers for the last five years are available in the Moodle Question Bank and on the second-floor reference shelf. Six discussion rooms on the ground floor can be booked from the library portal in 2-hour slots.' },
      { id: 'resources.tutoring', heading: 'Peer tutoring', text: 'The Academic Support Cell runs peer tutoring Monday to Friday, 7–9 PM, on the library ground floor. No appointment needed.' },
      { id: 'resources.labs', heading: 'Labs', text: 'The Database Lab (Room 6101) is open for practice from 6 to 10 PM on weekdays.' },
    ],
  },
  {
    id: 'club-feed', kind: 'club_feed', title: 'Clubs & societies feed', connectorId: 'clubs_portal',
    sections: [
      { id: 'club-feed.shutterbugs', heading: 'Shutterbugs (Photography Club)', text: 'Meets Fridays at 7 PM near the Clock Tower. Night photo walks every second Friday. No camera required. Last month’s night walk ended at the mess at 1 AM with forty people and one tripod.' },
      { id: 'club-feed.acm', heading: 'ACM Student Chapter', text: 'Runs a weekly ML reading group on Wednesdays, 6 PM, in Room 6105. One paper per week, presented by members. A second-year presented YOLO last term and got a research internship out of it.' },
      { id: 'club-feed.ds-club', heading: 'Data Science Club', text: 'DS Club ran a Kaggle sprint in August; two members landed analytics internships. The next sprint is on 4 October.' },
      { id: 'club-feed.quiz', heading: 'Quiz Club', text: 'Open quizzes every other Saturday at 8 PM in the Auditorium. Teams of up to three. A first-year team won the pop-culture quiz last year.' },
    ],
  },
  {
    id: 'events', kind: 'events', title: 'Campus events — September & October', connectorId: 'clubs_portal',
    sections: [
      { id: 'events.quiz', heading: 'Open Pop-Culture Quiz', text: 'Saturday 28 September, 8 PM, Auditorium. Teams of up to three. Open to all years.' },
      { id: 'events.kaggle', heading: 'DS Club Kaggle sprint', text: 'Sunday 4 October, 10 AM to 6 PM, CS Lab 2. Beginners are paired with a mentor.' },
      { id: 'events.data-ama', heading: 'Placement Cell: data roles AMA', text: 'Thursday 1 October, 6 PM, LT-1. Alumni from analytics teams answer questions about Data Analyst and Product Analyst roles.' },
    ],
  },
]

/** WorkspaceFile.updatedAt for each document (Document itself has no timestamp). */
export const DOC_UPDATED: Record<string, string> = {
  handbook: '2026-07-14', 'circular-2026-03': '2026-07-20', 'circular-2026-07': '2026-09-22', 'circular-2026-08': '2026-09-25',
  catalog: '2026-09-02', 'syllabus-cs-f212': '2026-08-05', 'exam-calendar': '2026-09-10', 'past-papers': '2026-08-12',
  'role-profiles': '2026-08-20', resources: '2026-09-01', 'club-feed': '2026-09-24', events: '2026-09-22',
}

const docIds = (...kinds: DocumentKind[]) => DOCS.filter((d) => kinds.includes(d.kind)).map((d) => d.id)

export const AGENTS: Agent[] = [
  { id: 'academic_coach', kind: 'specialist', name: 'Academic Coach', emoji: '🎓', tagline: 'Degree audit, weak topics and study plans',
    scope: docIds('handbook', 'circular', 'catalog', 'syllabus', 'exam_calendar', 'past_papers'),
    starters: ['Am I on track to graduate on time?', 'I’m struggling in DBMS', 'Can I overload to 28 units next sem?'] },
  { id: 'course_planner', kind: 'specialist', name: 'Course Planner', emoji: '🗓️', tagline: 'Electives, slot clashes and skills for your target role',
    scope: docIds('handbook', 'circular', 'catalog', 'role_profiles'),
    starters: ['What should I take next sem? I want data analyst roles.', 'Does Machine Learning clash with anything?', 'Which skills am I missing for my target role?'] },
  { id: 'campus_guide', kind: 'specialist', name: 'Campus Guide', emoji: '🧭', tagline: 'Help, resources, clubs and events worth your time',
    scope: docIds('resources', 'club_feed', 'events'),
    starters: ['Who can help me with DBMS, and what’s happening on campus?', 'Where can I get DBMS past papers?', 'Surprise me with something new'] },
  { id: 'club:shutterbugs', kind: 'club', name: 'Shutterbugs', emoji: '📷', tagline: 'Photography club', scope: ['club-feed'], starters: [] },
  { id: 'club:acm', kind: 'club', name: 'ACM Student Chapter', emoji: '🤖', tagline: 'ML reading group', scope: ['club-feed'], starters: [] },
]

export const CHANNELS: Channel[] = [
  { id: 'announcements', name: 'announcements', kind: 'live', description: 'Circulars from the Academic Office · read-only' },
  { id: 'dbms-sem5', name: 'dbms-sem5', kind: 'coming_soon', description: 'Course channel' },
  { id: 'placement-cell', name: 'placement-cell', kind: 'coming_soon', description: 'Placement updates' },
  { id: 'data-science-club', name: 'data-science-club', kind: 'coming_soon', description: 'Club channel' },
]

export const STUDENTS: Student[] = [
  { id: 's1', name: 'Aarav Mehta', program: 'B.E. Computer Science', semester: 5, careerGoal: 'Data Analyst', interests: ['cricket', 'photography', 'machine learning'] },
  { id: 's2', name: 'Priya Nair', program: 'B.E. Computer Science · Minor in Finance', semester: 7, careerGoal: 'Product Analyst', interests: ['finance', 'debating', 'badminton'] },
  { id: 's3', name: 'Rohan Iyer', program: 'B.E. Computer Science', semester: 3, careerGoal: 'Backend Engineer', interests: ['football', 'gaming', 'music'] },
]

// ---------------------------------------------------------------------------
// Citations — verified against DOCS at build time, like the backend does.

export function cite(id: string, docId: string, sectionId: string, quote: string): Citation {
  const d = DOCS.find((x) => x.id === docId)
  const s = d?.sections.find((x) => x.id === sectionId)
  if (!d || !s || !s.text.includes(quote)) throw new Error(`Mock citation does not verify: ${docId}/${sectionId} “${quote}”`)
  return { id, docId, docTitle: d.title, sectionId, sectionHeading: s.heading, quote }
}

export const Q = {
  circ: (id: string) => cite(id, 'circular-2026-03', 'circular-2026-03.1', 'the minimum number of discipline electives for B.E. Computer Science students of the 2023 and 2024 batches is raised from 4 to 5'),
  circ25: (id: string) => cite(id, 'circular-2026-03', 'circular-2026-03.1', 'Students of the 2025 batch are not affected'),
  hbElectives: (id: string) => cite(id, 'handbook', 'handbook.4.1', 'Students must complete a minimum of four discipline electives before graduation'),
  credits: (id: string) => cite(id, 'handbook', 'handbook.3.2', 'A student must earn a minimum of 142 units to graduate'),
  prereqCompiler: (id: string) => cite(id, 'handbook', 'handbook.4.3', 'CS F342 Compiler Construction requires CS F351 Theory of Computation'),
  prereqOop: (id: string) => cite(id, 'handbook', 'handbook.4.3', 'CS F213 Object Oriented Programming requires CS F111 Computer Programming'),
  overload: (id: string) => cite(id, 'handbook', 'handbook.5.4', 'Registration above 25 units in a semester requires approval of the Associate Dean and a CGPA of at least 8.0'),
  ps2: (id: string) => cite(id, 'circular-2026-08', 'circular-2026-08.1', 'must do so by 10 October 2026'),
  blueprint: (id: string) => cite(id, 'syllabus-cs-f212', 'syllabus-cs-f212.blueprint', 'Normalization (1NF–BCNF) carries 20% and Transactions & concurrency 15% of the mid-semester paper'),
  blueprintRest: (id: string) => cite(id, 'syllabus-cs-f212', 'syllabus-cs-f212.blueprint', 'ER modelling carries 15%, SQL 30%, and Indexing 20%'),
  examDate: (id: string) => cite(id, 'exam-calendar', 'exam-calendar.midsem', 'CS F212 Database Systems is scheduled for 8 October'),
  bcnfPapers: (id: string) => cite(id, 'past-papers', 'past-papers.cs-f212', 'BCNF decomposition has appeared in every mid-semester paper since 2023'),
  dm: (id: string) => cite(id, 'catalog', 'catalog.cs-f415', 'Slot T3 (Tue/Thu 10:00)'),
  dmSkills: (id: string) => cite(id, 'catalog', 'catalog.cs-f415', 'Skills: pandas, data mining, clustering'),
  ml: (id: string) => cite(id, 'catalog', 'catalog.bits-f464', 'Shares slot M2 with CS F301'),
  ir: (id: string) => cite(id, 'catalog', 'catalog.cs-f469', 'Slot F4 (Fri 14:00)'),
  econ: (id: string) => cite(id, 'catalog', 'catalog.econ-f211', 'Counts as an Open Elective for all programmes'),
  analyst: (id: string) => cite(id, 'role-profiles', 'role-profiles.data-analyst', 'SQL, Python (pandas), statistics, dashboarding in Tableau or Power BI, and one end-to-end analytics project'),
  productAnalyst: (id: string) => cite(id, 'role-profiles', 'role-profiles.product-analyst', 'SQL, experiment design and A/B testing, product metrics'),
  backend: (id: string) => cite(id, 'role-profiles', 'role-profiles.backend-engineer', 'data structures, algorithms, operating systems, DBMS and one system design round'),
  taDbms: (id: string) => cite(id, 'resources', 'resources.ta-hours', 'TA hours on Tuesday and Thursday, 5–6 PM, Room 2203'),
  faculty: (id: string) => cite(id, 'resources', 'resources.faculty', 'office hours on Wednesday, 3–4 PM, in Chamber 6120'),
  papers: (id: string) => cite(id, 'resources', 'resources.library', 'papers for the last five years are available in the Moodle Question Bank'),
  tutoring: (id: string) => cite(id, 'resources', 'resources.tutoring', 'peer tutoring Monday to Friday, 7–9 PM'),
  lab: (id: string) => cite(id, 'resources', 'resources.labs', 'open for practice from 6 to 10 PM on weekdays'),
  libHours: (id: string) => cite(id, 'circular-2026-07', 'circular-2026-07.1', 'remain open until 2:00 AM from 1 to 13 October 2026'),
  photo: (id: string) => cite(id, 'club-feed', 'club-feed.shutterbugs', 'Night photo walks every second Friday'),
  acm: (id: string) => cite(id, 'club-feed', 'club-feed.acm', 'weekly ML reading group on Wednesdays, 6 PM, in Room 6105'),
  quiz: (id: string) => cite(id, 'events', 'events.quiz', 'Saturday 28 September, 8 PM, Auditorium'),
  btree: (id: string) => cite(id, 'syllabus-cs-f212', 'syllabus-cs-f212.unit5', 'internal nodes hold only keys that route a search'),
}

// ---------------------------------------------------------------------------
// Cards

export function auditFor(studentId: string, computedAt: string): AuditCard {
  if (studentId === 's2')
    return {
      type: 'audit', onTrack: false, headline: 'One elective short of graduating in May 2027', computedAt,
      buckets: [
        { name: 'Core courses', done: 18, required: 18, status: 'ok', citationIds: ['C2'] },
        { name: 'Discipline electives', done: 4, required: 5, status: 'gap', note: 'Minimum raised from 4 to 5 by Circular 2026-03 — overrides Handbook §4.1', citationIds: ['C1', 'C3'] },
        { name: 'Open electives', done: 3, required: 3, status: 'ok', citationIds: [] },
        { name: 'Humanities', done: 2, required: 2, status: 'ok', citationIds: [] },
        { name: 'Practice School II', done: 0, required: 1, status: 'at_risk', note: 'Not registered — deadline 10 Oct per Circular 2026-08', citationIds: ['C4'] },
      ],
      unmetPrereqs: [],
    }
  if (studentId === 's3')
    return {
      type: 'audit', onTrack: true, headline: 'On track — no gaps yet', computedAt,
      buckets: [
        { name: 'Core courses', done: 8, required: 18, status: 'ok', citationIds: ['C2'] },
        { name: 'Discipline electives', done: 0, required: 4, status: 'ok', note: 'Circular 2026-03 does not apply to the 2025 batch — Handbook §4.1 minimum of 4 stands', citationIds: ['C1', 'C3'] },
        { name: 'Open electives', done: 0, required: 3, status: 'ok', citationIds: [] },
        { name: 'Humanities', done: 1, required: 2, status: 'ok', citationIds: [] },
      ],
      unmetPrereqs: [{ course: 'CS F213 Object Oriented Programming', missing: 'CS F111 Computer Programming (grade pending)', citationId: 'C4' }],
    }
  return {
    type: 'audit', onTrack: true, headline: 'On track for May 2028 — plan one extra elective', computedAt,
    buckets: [
      { name: 'Core courses', done: 14, required: 18, status: 'ok', citationIds: ['C2'] },
      { name: 'Discipline electives', done: 2, required: 5, status: 'gap', note: 'Minimum raised from 4 to 5 by Circular 2026-03 — overrides Handbook §4.1', citationIds: ['C1', 'C3'] },
      { name: 'Open electives', done: 1, required: 3, status: 'ok', citationIds: [] },
      { name: 'Humanities', done: 2, required: 2, status: 'ok', citationIds: [] },
    ],
    unmetPrereqs: [{ course: 'CS F342 Compiler Construction', missing: 'CS F351 Theory of Computation', citationId: 'C4' }],
  }
}

export const auditCitations = (studentId: string) =>
  studentId === 's2'
    ? [Q.circ('C1'), Q.credits('C2'), Q.hbElectives('C3'), Q.ps2('C4')]
    : studentId === 's3'
      ? [Q.circ25('C1'), Q.credits('C2'), Q.hbElectives('C3'), Q.prereqOop('C4')]
      : [Q.circ('C1'), Q.credits('C2'), Q.hbElectives('C3'), Q.prereqCompiler('C4')]

export const auditText: Record<string, (first: string) => string> = {
  s1: (n) => `**Mostly yes, ${n}.** You’ve earned **96 of 142** units [C2]. One gap: the handbook sets the discipline-elective minimum at four [C3], but Circular 2026-03 raised it to **5** for your batch [C1] — the later circular wins, so you need one more elective than your plan assumed.\n- Add one discipline elective next semester — *CS F415 Data Mining* fits your slots\n- CS F342 Compilers still needs CS F351 first [C4]`,
  s2: (n) => `**Not quite, ${n}.** You’ve earned **128 of 142** units [C2]. Two gaps before May 2027: Circular 2026-03 raised the discipline-elective minimum from four [C3] to **5** [C1], and Practice School II isn’t registered yet.\n- Add one discipline elective in your final semester\n- Register for PS-II in the ERP before 10 Oct [C4]`,
  s3: (n) => `**Yes, ${n}.** You’ve earned **52 of 142** units [C2] and every bucket is on pace. Circular 2026-03 doesn’t apply to the 2025 batch [C1], so the handbook minimum of four electives stands [C3].\n- CS F213 needs CS F111 cleared first — your grade is still pending [C4]`,
}

// Weak topics: impact = (1 − score) × exam weight, computed in code (AGENTS.md §3).
export const WEAK: WeakTopicsCard = {
  type: 'weak_topics',
  items: [
    { course: 'DBMS', topic: 'Normalization (3NF / BCNF)', score: '42%', examWeight: 20, impact: 11.6, citationId: 'C1' },
    { course: 'DBMS', topic: 'Transactions & concurrency', score: '51%', examWeight: 15, impact: 7.4, citationId: 'C1' },
    { course: 'DBMS', topic: 'SQL joins & subqueries', score: '78%', examWeight: 30, impact: 6.6, citationId: 'C4' },
    { course: 'DBMS', topic: 'Indexing & B+ trees', score: '70%', examWeight: 20, impact: 6.0, citationId: 'C4' },
  ],
}

export const PLAN: StudyPlanCard = {
  type: 'study_plan',
  weeks: [
    { label: 'Week 1', examNote: 'Mid-sems start 6 Oct', blocks: [
      { id: 'pb-1', course: 'DBMS', topic: 'Normalization: 1NF → 3NF drills', minutes: 60, why: 'Lowest quiz score (42%) and 20% of the paper', citationId: 'C1' },
      { id: 'pb-2', course: 'DBMS', topic: 'BCNF decomposition — 6 past-paper questions', minutes: 45, why: 'Asked every year since 2023', citationId: 'C3' },
      { id: 'pb-3', course: 'DBMS', topic: 'Transactions: schedules & serializability', minutes: 60, why: '15% of the paper, 51% quiz score', citationId: 'C1' },
      { id: 'pb-4', course: 'DBMS', topic: 'Timed mixed set', minutes: 90, why: 'Builds pacing before week 2' },
    ] },
    { label: 'Week 2', examNote: 'DBMS mid-sem on 8 Oct', blocks: [
      { id: 'pb-5', course: 'DBMS', topic: 'Concurrency control: 2PL and deadlocks', minutes: 60, why: 'Follows on from schedules', citationId: 'C1' },
      { id: 'pb-6', course: 'DBMS', topic: 'Indexing & B+ tree insertions', minutes: 45, why: '20% weight, already at 70%', citationId: 'C4' },
      { id: 'pb-7', course: 'DBMS', topic: '2025 mid-sem paper, full timed', minutes: 90, why: 'Closest match to the blueprint', citationId: 'C3' },
      { id: 'pb-8', course: 'DBMS', topic: 'Review mistakes only', minutes: 40, why: 'Day before the exam — no new material', citationId: 'C2' },
    ] },
  ],
}

export const COURSES: CoursesCard = {
  type: 'courses',
  forSemester: 6,
  items: [
    { code: 'CS F415', title: 'Data Mining', credits: 3, slot: 'T3 · Tue/Thu 10:00', faculty: 'Dr. S. Menon', fillsBucket: 'Discipline elective', why: 'Nothing else in T3; covers pandas', citationIds: ['C1'] },
    { code: 'BITS F464', title: 'Machine Learning', credits: 3, slot: 'M2 · Mon/Wed 9:00', faculty: 'Dr. A. Kulkarni', fillsBucket: 'Discipline elective', why: 'Strong fit, but only if you drop PoPL', clashesWith: 'CS F301 PoPL', citationIds: ['C2'] },
    { code: 'CS F469', title: 'Information Retrieval', credits: 3, slot: 'F4 · Fri 14:00', faculty: 'Dr. R. Das', fillsBucket: 'Discipline elective', why: 'Friday afternoon slot, no clashes', citationIds: ['C5'] },
    { code: 'ECON F211', title: 'Principles of Economics', credits: 3, slot: 'W5 · Wed 16:00', faculty: 'Prof. N. Shah', fillsBucket: 'Open elective', why: 'Counts for every programme', citationIds: ['C3'] },
  ],
}

const SKILLS_BY_ROLE: Record<string, Omit<SkillsGapCard, 'type' | 'role' | 'citationIds'> & { cite: (id: string) => Citation }> = {
  'Data Analyst': {
    covered: [{ skill: 'SQL', via: 'CS F212 DBMS' }, { skill: 'Python', via: 'CS F111 Computer Programming' }, { skill: 'Probability & statistics', via: 'MATH F113' }],
    coveredAfterPlan: [{ skill: 'pandas', via: 'CS F415 Data Mining' }, { skill: 'Data mining', via: 'CS F415 Data Mining' }],
    missing: ['Tableau / Power BI', 'End-to-end analytics project'],
    cite: Q.analyst,
  },
  'Product Analyst': {
    covered: [{ skill: 'SQL', via: 'CS F212 DBMS' }, { skill: 'Probability & statistics', via: 'MATH F113' }],
    coveredAfterPlan: [{ skill: 'Economics basics', via: 'ECON F211' }],
    missing: ['A/B testing', 'Product metrics'],
    cite: Q.productAnalyst,
  },
  'Backend Engineer': {
    covered: [{ skill: 'Data structures', via: 'CS F211' }],
    coveredAfterPlan: [{ skill: 'DBMS', via: 'CS F212 DBMS' }],
    missing: ['Operating systems', 'System design'],
    cite: Q.backend,
  },
}

export function skillsFor(role: string, citationId: string): { card: SkillsGapCard; citation: Citation } {
  const s = SKILLS_BY_ROLE[role] ?? SKILLS_BY_ROLE['Data Analyst']!
  const { cite: c, ...rest } = s
  return { card: { type: 'skills_gap', role, ...rest, citationIds: [citationId] }, citation: c(citationId) }
}

/** Citation ids for: TA hours, faculty, library, tutoring, lab. */
export const resourcesCard = ([ta, fac, lib, tut, lab]: string[]): ResourcesCard => ({
  type: 'resources',
  items: [
    { kind: 'ta_hours', name: 'DBMS TA hours — Ananya R.', forCourse: 'CS F212', when: 'Tue & Thu, 5–6 PM', where: 'Room 2203', citationId: ta! },
    { kind: 'faculty', name: 'Dr. P. Sharma — office hours', forCourse: 'CS F212', when: 'Wed, 3–4 PM', where: 'Chamber 6120', citationId: fac! },
    { kind: 'library', name: 'DBMS mid-sem papers, last 5 years', forCourse: 'CS F212', where: 'Moodle › Question Bank', citationId: lib! },
    { kind: 'tutoring', name: 'Peer tutoring — Academic Support Cell', when: 'Mon–Fri, 7–9 PM', where: 'Library ground floor', citationId: tut! },
    { kind: 'lab', name: 'Database Lab practice hours', forCourse: 'CS F212', when: 'Weekdays, 6–10 PM', where: 'Room 6101', citationId: lab! },
  ],
})

/** Citation ids for: Shutterbugs, ACM, quiz. */
export const picksCard = ([photo, acm, quiz]: string[]): PicksCard => ({
  type: 'picks',
  items: [
    { kind: 'club', name: 'Shutterbugs', when: 'Fridays 7 PM · Clock Tower', why: 'Photography, beginner-friendly, no camera needed', anecdote: 'Last month’s night walk ended at the mess at 1 AM with forty people and one tripod.', wildcard: false, clubAgentId: 'club:shutterbugs', citationIds: [photo!] },
    { kind: 'club', name: 'ACM ML Reading Group', when: 'Wednesdays 6 PM · Room 6105', why: 'One paper a week, presented by members', anecdote: 'A second-year presented YOLO last term and got a research internship out of it.', wildcard: false, clubAgentId: 'club:acm', citationIds: [acm!] },
    { kind: 'event', name: 'Open Pop-Culture Quiz', when: 'Sat 28 Sep, 8 PM · Auditorium', why: 'Nothing to do with your interests — that’s the point', anecdote: 'A first-year team won the pop-culture quiz last year.', wildcard: true, citationIds: [quiz!] },
  ],
})

export const RELEVANT: RelevantCard = {
  type: 'relevant',
  concept: 'B+ trees',
  course: 'CS F212 DBMS',
  interest: 'cricket',
  standard: '- A balanced tree where every record lives in the leaf level\n- Internal nodes only hold keys that route a search\n- Leaves are linked, so range queries are fast',
  reframed: '- A tournament draw: every team sits at the bottom level\n- Each round only tells you which half of the draw to look in\n- The points table is the linked leaves — read “teams on 8–12 points” left to right without climbing back up',
  citationIds: ['C1'],
}
