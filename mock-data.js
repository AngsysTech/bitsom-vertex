// Mock data shaped after the brief (contracts.ts not attached — field names inferred; swap once provided).
window.MOCK = (function () {
  const D = '2026-09-26';
  const at = (h, m) => `${D}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  let n = 0; const uid = p => p + '-' + (++n);

  const students = [
    { id: 's1', name: 'Aarav Mehta', first: 'Aarav', initials: 'AM', program: 'B.E. Computer Science', semester: 5, cgpa: 8.2 },
    { id: 's2', name: 'Priya Nair', first: 'Priya', initials: 'PN', program: 'B.E. Computer Science · Minor in Finance', semester: 7, cgpa: 8.4 },
    { id: 's3', name: 'Rohan Iyer', first: 'Rohan', initials: 'RI', program: 'B.E. Computer Science', semester: 3, cgpa: 7.6 },
  ];

  const agents = [
    { id: 'academic_coach', name: 'Academic Coach', emoji: '🎓', tagline: 'Degree audit, prerequisites and credit rules',
      scope: [{ docId: 'handbook', label: 'Handbook' }, { docId: 'circ-2026-03', label: 'Circulars' }, { docId: 'catalog', label: 'Catalog' }],
      starters: ['Am I on track to graduate on time?', 'Can I overload to 28 units next sem?', 'Which prerequisites am I missing?'] },
    { id: 'exam_prep', name: 'Exam Prep', emoji: '📝', tagline: 'Weak topics, study plans and exam weightage',
      scope: [{ docId: 'syllabus', label: 'DBMS handout' }, { docId: 'circ-2026-05', label: 'Exam circular' }],
      starters: ['What should I focus on for DBMS mid-sems?', 'Make me a 2-week study plan', 'How is the mid-sem paper weighted?'] },
    { id: 'course_planner', name: 'Course Planner', emoji: '🗓️', tagline: 'Electives, slots and timetable clashes',
      scope: [{ docId: 'catalog', label: 'Catalog' }, { docId: 'handbook', label: 'Handbook' }],
      starters: ['Which electives fit my next-sem timetable?', 'Does Machine Learning clash with anything?', 'What fills my open elective?'] },
    { id: 'career', name: 'Career Compass', emoji: '🧭', tagline: 'Skills gaps against real placement roles',
      scope: [{ docId: 'placement', label: 'Role profiles' }, { docId: 'catalog', label: 'Catalog' }],
      starters: ['What am I missing for a data analyst role?', 'Which courses help for SDE roles?', 'When do placement registrations open?'] },
    { id: 'clubs', name: 'Clubs & Events', emoji: '🎭', tagline: 'Clubs, fests and events worth your time',
      scope: [{ docId: 'clubs', label: 'Clubs directory' }],
      starters: ['Any clubs for someone into photography and ML?', "What's happening this weekend?", 'Surprise me with something new'] },
    { id: 'resources', name: 'Library & Resources', emoji: '📚', tagline: 'Books, past papers, labs and study rooms',
      scope: [{ docId: 'library', label: 'Library guide' }, { docId: 'circ-2026-07', label: 'Circulars' }],
      starters: ['Where can I get DBMS past papers?', 'Is the library open late during mid-sems?', 'Book a quiet study room'] },
    { id: 'relevance', name: 'Make it Relevant', emoji: '✨', tagline: 'Explains course concepts through what you love',
      scope: [{ docId: 'syllabus', label: 'DBMS handout' }],
      starters: ['Explain B+ trees through cricket', 'Why does normalization matter?', 'Explain deadlocks through football'] },
  ];

  const docs = [
    { id: 'handbook', kind: 'document', title: 'Academic Handbook 2026–27', connector: 'Moodle LMS', synthetic: true, updatedAt: '2026-07-14', sections: [
      { id: 'credits', heading: '3.2 Graduation requirements', text: 'A student must earn a minimum of 142 units to graduate with a B.E. degree. Units are distributed across Core, Discipline Elective, Open Elective, Humanities and Practice School buckets. All core courses must be cleared with a grade of D or above.' },
      { id: 'electives', heading: '4.1 Discipline electives', text: 'Students must complete the minimum number of discipline electives notified for their batch. The minimum may be revised by circular; the latest circular prevails over this handbook.' },
      { id: 'prereqs', heading: '4.3 Prerequisites', text: 'A course may not be registered unless all listed prerequisites have been passed. CS F342 Compiler Construction requires CS F351 Theory of Computation. CS F213 Object Oriented Programming requires CS F111 Computer Programming.' },
      { id: 'overload', heading: '5.4 Unit overload', text: 'Registration above 25 units in a semester requires approval of the Associate Dean and a CGPA of at least 8.0. Requests must be routed through the student\u2019s faculty advisor at least one week before registration.' },
      { id: 'attendance', heading: '6.1 Attendance', text: 'Students are expected to attend all classes. Attendance below 75% in a course may lead to debarment from the comprehensive examination at the instructor\u2019s discretion.' },
    ] },
    { id: 'catalog', kind: 'document', title: 'Course Catalog — Semester II 2026–27', connector: 'Moodle LMS', synthetic: true, updatedAt: '2026-09-02', sections: [
      { id: 'cs-f415', heading: 'CS F415 Data Mining', text: '3 units. Slot T3 (Tue/Thu 10:00). Instructor: Dr. S. Menon. Counts as a Discipline Elective for Computer Science.' },
      { id: 'bits-f464', heading: 'BITS F464 Machine Learning', text: '3 units. Slot M2 (Mon/Wed 9:00). Instructor: Dr. A. Kulkarni. Counts as a Discipline Elective. Shares slot M2 with CS F301.' },
      { id: 'cs-f469', heading: 'CS F469 Information Retrieval', text: '3 units. Slot F4 (Fri 14:00). Instructor: Dr. R. Das. Counts as a Discipline Elective.' },
      { id: 'econ-f211', heading: 'ECON F211 Principles of Economics', text: '3 units. Slot W5 (Wed 16:00). Instructor: Prof. N. Shah. Counts as an Open Elective for all programmes.' },
      { id: 'cs-f342', heading: 'CS F342 Compiler Construction', text: '4 units. Slot T2 (Tue/Thu 9:00). Prerequisite: CS F351 Theory of Computation.' },
    ] },
    { id: 'syllabus', kind: 'document', title: 'CS F212 DBMS — Handout & mid-sem blueprint', connector: 'Moodle LMS', synthetic: true, updatedAt: '2026-08-05', sections: [
      { id: 'blueprint', heading: 'Mid-semester blueprint', text: 'Normalization (1NF\u2013BCNF) carries 20% and Transactions & concurrency 15% of the mid-semester paper. ER modelling carries 15%, SQL 30%, and Indexing 20%.' },
      { id: 'btrees', heading: 'Unit 5 · Indexing and B+ trees', text: 'A B+ tree stores all records in its leaf level; internal nodes hold only keys that route a search. Leaves are linked, which makes range queries efficient.' },
      { id: 'readings', heading: 'Readings', text: 'Silberschatz, Korth and Sudarshan, Database System Concepts, 7th edition. Chapters 7, 14, 17 and 18.' },
    ] },
    { id: 'placement', kind: 'document', title: 'Placement Cell — Role profiles 2026', connector: 'Moodle LMS', synthetic: true, updatedAt: '2026-08-20', sections: [
      { id: 'analyst', heading: 'Data Analyst', text: 'Recruiters for Data Analyst roles expect SQL, Python (pandas), statistics, dashboarding in Tableau or Power BI, and one end-to-end analytics project.' },
      { id: 'sde', heading: 'Software Development Engineer', text: 'SDE roles test data structures, algorithms, operating systems, DBMS and one system design round for final-year students.' },
      { id: 'dates', heading: 'Registration calendar', text: 'Placement registrations for the 2027 batch open on 1 November 2026 and close on 15 November 2026.' },
    ] },
    { id: 'clubs', kind: 'document', title: 'Clubs & Societies Directory', connector: 'Moodle LMS', synthetic: true, updatedAt: '2026-08-28', sections: [
      { id: 'photo', heading: 'Shutterbugs (Photography Club)', text: 'Meets Fridays at 7 PM near the Clock Tower. Night photo walks every second Friday. No camera required.' },
      { id: 'acm', heading: 'ACM Student Chapter', text: 'Runs a weekly ML reading group on Wednesdays, 6 PM, in Room 6105. One paper per week, presented by members.' },
      { id: 'quiz', heading: 'Quiz Club', text: 'Open quizzes every other Saturday at 8 PM in the Auditorium. Teams of up to three.' },
    ] },
    { id: 'library', kind: 'document', title: 'Library Guide', connector: 'Library Catalog', synthetic: true, updatedAt: '2026-06-30', sections: [
      { id: 'papers', heading: 'Past papers', text: 'Mid-semester and comprehensive papers for the last five years are available in the Moodle Question Bank and on the second-floor reference shelf.' },
      { id: 'rooms', heading: 'Discussion rooms', text: 'Six discussion rooms on the ground floor can be booked from the library portal in 2-hour slots.' },
    ] },
    { id: 'circ-2026-03', kind: 'circular', title: 'Circular 2026-03 · Revised discipline elective minimum', connector: 'Circulars Board', synthetic: true, effectiveDate: '2026-08-01', updatedAt: '2026-07-20', affects: ['s1', 's2'], sections: [
      { id: 'main', heading: 'Revision', text: 'With effect from 1 August 2026, the minimum number of discipline electives for B.E. Computer Science students of the 2023 and 2024 batches is raised from 4 to 5. Students of the 2025 batch are not affected. Students already registered for their final semester may petition for an exemption.' },
    ] },
    { id: 'circ-2026-05', kind: 'circular', title: 'Circular 2026-05 · Mid-semester examination schedule', connector: 'Circulars Board', synthetic: true, effectiveDate: '2026-09-15', updatedAt: '2026-09-10', affects: [], sections: [
      { id: 'main', heading: 'Schedule', text: 'Mid-semester examinations will be held from 6 to 13 October 2026. CS F212 Database Systems is scheduled for 8 October, 2:00\u20133:30 PM.' },
    ] },
    { id: 'circ-2026-07', kind: 'circular', title: 'Circular 2026-07 · Library hours during mid-sems', connector: 'Circulars Board', synthetic: true, effectiveDate: '2026-10-01', updatedAt: '2026-09-22', affects: [], sections: [
      { id: 'main', heading: 'Extended hours', text: 'The central library will remain open until 2:00 AM from 1 to 13 October 2026. Discussion rooms can be booked in 2-hour slots.' },
    ] },
    { id: 'circ-2026-08', kind: 'circular', title: 'Circular 2026-08 · Practice School II registration', connector: 'Circulars Board', synthetic: true, effectiveDate: '2026-10-01', updatedAt: '2026-09-25', affects: ['s2'], sections: [
      { id: 'main', heading: 'Deadline', text: 'Final-year students who have not registered for Practice School II must do so by 10 October 2026 through the Student ERP.' },
    ] },
    { id: 'canvas-audit', kind: 'canvas', title: 'Degree audit', cardType: 'audit', sourceAgent: 'academic_coach', connector: 'Academic Coach', updatedAt: '2026-09-26', sections: [] },
    { id: 'canvas-plan', kind: 'canvas', title: 'DBMS mid-sem study plan', cardType: 'study_plan', sourceAgent: 'exam_prep', connector: 'Exam Prep', updatedAt: '2026-09-26', sections: [] },
    { id: 'canvas-courses', kind: 'canvas', title: 'Next-sem course shortlist', cardType: 'courses', sourceAgent: 'course_planner', connector: 'Course Planner', updatedAt: '2026-09-25', sections: [] },
  ];
  const docById = id => docs.find(d => d.id === id);
  function cite(id, docId, sectionId, quote) {
    const d = docById(docId), s = d.sections.find(x => x.id === sectionId);
    return { id, docId, docTitle: d.title, sectionId, sectionHeading: s.heading, quote };
  }
  const Q = {
    circ: id => cite(id, 'circ-2026-03', 'main', 'the minimum number of discipline electives for B.E. Computer Science students of the 2023 and 2024 batches is raised from 4 to 5'),
    circ25: id => cite(id, 'circ-2026-03', 'main', 'Students of the 2025 batch are not affected'),
    credits: id => cite(id, 'handbook', 'credits', 'A student must earn a minimum of 142 units to graduate'),
    prereqs: id => cite(id, 'handbook', 'prereqs', 'CS F342 Compiler Construction requires CS F351 Theory of Computation'),
    overload: id => cite(id, 'handbook', 'overload', 'Registration above 25 units in a semester requires approval of the Associate Dean and a CGPA of at least 8.0'),
    ps2: id => cite(id, 'circ-2026-08', 'main', 'must do so by 10 October 2026'),
    blueprint: id => cite(id, 'syllabus', 'blueprint', 'Normalization (1NF\u2013BCNF) carries 20% and Transactions & concurrency 15% of the mid-semester paper'),
    examDate: id => cite(id, 'circ-2026-05', 'main', 'CS F212 Database Systems is scheduled for 8 October'),
    dm: id => cite(id, 'catalog', 'cs-f415', 'Slot T3 (Tue/Thu 10:00)'),
    ml: id => cite(id, 'catalog', 'bits-f464', 'Shares slot M2 with CS F301'),
    econ: id => cite(id, 'catalog', 'econ-f211', 'Counts as an Open Elective for all programmes'),
    analyst: id => cite(id, 'placement', 'analyst', 'SQL, Python (pandas), statistics, dashboarding in Tableau or Power BI, and one end-to-end analytics project'),
    placeDates: id => cite(id, 'placement', 'dates', 'open on 1 November 2026'),
    photo: id => cite(id, 'clubs', 'photo', 'Night photo walks every second Friday'),
    acm: id => cite(id, 'clubs', 'acm', 'weekly ML reading group on Wednesdays, 6 PM, in Room 6105'),
    papers: id => cite(id, 'library', 'papers', 'papers for the last five years are available in the Moodle Question Bank'),
    libHours: id => cite(id, 'circ-2026-07', 'main', 'remain open until 2:00 AM from 1 to 13 October 2026'),
    btree: id => cite(id, 'syllabus', 'btrees', 'internal nodes hold only keys that route a search'),
  };

  const audits = {
    s1: { type: 'audit', earned: 96, total: 142, headline: 'On track for May 2028 — plan one extra elective',
      summary: "You've earned **96 of 142** units [C2]. One gap: circular 2026-03 raised the discipline-elective minimum from **4 to 5** [C1], so you need one more elective than your plan assumed.\n- Add one discipline elective next semester — *CS F415 Data Mining* fits your slots\n- CS F342 Compilers still needs CS F351 first [C3]",
      buckets: [
        { id: 'core', name: 'Core courses', done: 14, required: 18, status: 'ok' },
        { id: 'del', name: 'Discipline electives', done: 2, required: 5, status: 'warn', note: 'Min raised from 4 to 5 electives by circular 2026-03', noteCitations: [Q.circ('C1')] },
        { id: 'oel', name: 'Open electives', done: 1, required: 3, status: 'ok' },
        { id: 'hum', name: 'Humanities', done: 2, required: 2, status: 'ok' },
      ], unmetPrereqs: [{ course: 'CS F342 Compiler Construction', needs: 'CS F351 Theory of Computation' }] },
    s2: { type: 'audit', earned: 128, total: 142, headline: 'One elective short of graduating in May 2027',
      summary: "You've earned **128 of 142** units [C2]. Two gaps: circular 2026-03 raised the discipline-elective minimum from **4 to 5** [C1], and Practice School II isn't registered yet.\n- Add one discipline elective in your final semester\n- Register for PS-II in the ERP before 10 Oct [C3]",
      buckets: [
        { id: 'core', name: 'Core courses', done: 18, required: 18, status: 'ok' },
        { id: 'del', name: 'Discipline electives', done: 4, required: 5, status: 'warn', note: 'Min raised from 4 to 5 electives by circular 2026-03', noteCitations: [Q.circ('C1')] },
        { id: 'oel', name: 'Open electives', done: 3, required: 3, status: 'ok' },
        { id: 'hum', name: 'Humanities', done: 2, required: 2, status: 'ok' },
        { id: 'ps', name: 'Practice School II', done: 0, required: 1, status: 'bad', note: 'Not registered — deadline 10 Oct per circular 2026-08', noteCitations: [Q.ps2('C1')] },
      ], unmetPrereqs: [] },
    s3: { type: 'audit', earned: 52, total: 142, headline: 'On track — no gaps yet',
      summary: "Yes. You've earned **52 of 142** units [C2], every bucket is on pace, and circular 2026-03 doesn't apply to the 2025 batch [C1].\n- Keep one discipline elective per semester from Sem 5 to stay comfortable",
      buckets: [
        { id: 'core', name: 'Core courses', done: 8, required: 18, status: 'ok' },
        { id: 'del', name: 'Discipline electives', done: 0, required: 4, status: 'ok', note: 'Circular 2026-03 does not apply to the 2025 batch', noteCitations: [Q.circ25('C1')] },
        { id: 'oel', name: 'Open electives', done: 0, required: 3, status: 'ok' },
        { id: 'hum', name: 'Humanities', done: 1, required: 2, status: 'ok' },
      ], unmetPrereqs: [{ course: 'CS F213 Object Oriented Programming', needs: 'CS F111 Computer Programming (grade pending)' }] },
  };
  const auditCites = sid => sid === 's2' ? [Q.circ('C1'), Q.credits('C2'), Q.ps2('C3')] : sid === 's3' ? [Q.circ25('C1'), Q.credits('C2')] : [Q.circ('C1'), Q.credits('C2'), Q.prereqs('C3')];

  const CARDS = {
    weak: { type: 'weak_topics', topics: [
      { course: 'DBMS', topic: 'Normalization (3NF / BCNF)', score: 42, examWeight: 20, impact: 0.92 },
      { course: 'DBMS', topic: 'Transactions & concurrency', score: 51, examWeight: 15, impact: 0.74 },
      { course: 'OS', topic: 'Page replacement', score: 58, examWeight: 12, impact: 0.51 },
      { course: 'DBMS', topic: 'Indexing', score: 70, examWeight: 20, impact: 0.38 },
      { course: 'CN', topic: 'Subnetting', score: 76, examWeight: 10, impact: 0.2 },
    ] },
    plan: { type: 'study_plan', title: 'DBMS mid-sem · 8 Oct', weeks: [
      { label: 'Week 1', blocks: [
        { day: 'Mon', title: 'Normalization: 1NF → 3NF drills', minutes: 60, why: 'Lowest quiz score (42%) and 20% of the paper' },
        { day: 'Tue', title: 'BCNF decomposition — 6 past-paper questions', minutes: 45, why: 'Asked every year since 2022' },
        { day: 'Thu', title: 'Transactions: schedules & serializability', minutes: 60, why: '15% of the paper, 51% quiz score' },
        { day: 'Sat', title: 'Timed mixed set', minutes: 90, why: 'Builds pacing before week 2' } ] },
      { label: 'Week 2', blocks: [
        { day: 'Mon', title: 'Concurrency control: 2PL and deadlocks', minutes: 60, why: 'Follows on from schedules' },
        { day: 'Wed', title: 'Indexing & B+ tree insertions', minutes: 45, why: '20% weight, already at 70%' },
        { day: 'Fri', title: '2025 mid-sem paper, full timed', minutes: 90, why: 'Closest match to the blueprint' },
        { day: 'Sun', title: 'Review mistakes only', minutes: 40, why: 'Day before the exam — no new material' } ] },
    ] },
    courses: { type: 'courses', courses: [
      { code: 'CS F415', title: 'Data Mining', slot: 'T3 · Tue/Thu 10:00', faculty: 'Dr. S. Menon', fills: 'Discipline elective', credits: 3, clashesWith: null },
      { code: 'BITS F464', title: 'Machine Learning', slot: 'M2 · Mon/Wed 9:00', faculty: 'Dr. A. Kulkarni', fills: 'Discipline elective', credits: 3, clashesWith: 'CS F301 PoPL' },
      { code: 'CS F469', title: 'Information Retrieval', slot: 'F4 · Fri 14:00', faculty: 'Dr. R. Das', fills: 'Discipline elective', credits: 3, clashesWith: null },
      { code: 'ECON F211', title: 'Principles of Economics', slot: 'W5 · Wed 16:00', faculty: 'Prof. N. Shah', fills: 'Open elective', credits: 3, clashesWith: null },
    ] },
    skills: { type: 'skills_gap', role: 'Data Analyst', covered: ['SQL', 'Python', 'Probability & statistics'], afterPlan: ['Data mining', 'pandas'], missing: ['Tableau / Power BI', 'End-to-end analytics project'] },
    picks: { type: 'picks', picks: [
      { kind: 'Club', name: 'Shutterbugs', when: 'Fridays 7 PM · Clock Tower', why: 'Photography, beginner-friendly, no camera needed', anecdote: 'Last month\u2019s night walk ended at the mess at 1 AM with forty people and one tripod.', wildcard: false },
      { kind: 'Reading group', name: 'ACM ML Reading Group', when: 'Wednesdays 6 PM · Room 6105', why: 'One paper a week; October is computer vision', anecdote: 'A second-year presented YOLO last term and got a research internship out of it.', wildcard: false },
      { kind: 'Event', name: 'Open Pop-Culture Quiz', when: 'Sat 28 Sep, 8 PM · Auditorium', why: 'Nothing to do with your interests — that\u2019s the point', anecdote: 'Teams of three. A first-year team won it last year.', wildcard: true },
    ] },
    resources: { type: 'resources', items: [
      { kind: 'paper', name: 'DBMS mid-sem papers 2021–2025', forCourse: 'CS F212', where: 'Moodle › Question Bank' },
      { kind: 'book', name: 'Database System Concepts, 7e', forCourse: 'CS F212', where: 'Reference shelf 2B · 4 copies' },
      { kind: 'room', name: 'Discussion Room 3', forCourse: '', where: 'Open until 2 AM, 1–13 Oct' },
      { kind: 'video', name: 'NPTEL lectures 14–17: Normalization', forCourse: 'CS F212', where: 'Online' },
    ] },
    relevant: { type: 'relevant', concept: 'B+ trees', interest: 'cricket',
      standard: ['A balanced tree where every record lives in the leaf level', 'Internal nodes only hold keys that route a search', 'Leaves are linked, so range queries are fast'],
      through: ['A tournament bracket: groups → quarter-finals → final, with every team sitting at the bottom level', 'Match referees at each round only tell you which half of the draw to look in', 'The points table is the linked leaves — read "teams on 8–12 points" left to right without climbing back up'] },
  };
  const clone = o => JSON.parse(JSON.stringify(o));

  const SEED = {
    academic_coach: s => [{ role: 'agent', text: `**${s.id === 's3' ? 'Yes' : 'Mostly yes'}, ${s.first}.** ` + audits[s.id].summary.replace(/^Yes\. /, ''), citations: auditCites(s.id), cards: [clone(audits[s.id])],
      trace: [{ tool: 'run_degree_audit', summary: `Checked ${audits[s.id].earned} of 142 units across ${audits[s.id].buckets.length} buckets`, ms: 2600 }, { tool: 'read_circulars', summary: s.id === 's3' ? 'No circulars change your requirements' : 'Found circulars that change your requirements', ms: 1600 }] }],
    exam_prep: s => [{ role: 'agent', text: 'Focus on **normalization** and **transactions** — together they\u2019re 35% of the paper [C1] and your two weakest quiz scores. The exam is on 8 October [C2], so I\u2019ve built a two-week plan that front-loads both.', citations: [Q.blueprint('C1'), Q.examDate('C2')], cards: [clone(CARDS.weak), clone(CARDS.plan)],
      trace: [{ tool: 'read_grades', summary: 'Pulled 6 DBMS quiz scores from Moodle', ms: 1400 }, { tool: 'rank_topics', summary: 'Weighted by the mid-sem blueprint', ms: 900 }, { tool: 'build_plan', summary: '8 blocks over 14 days, 490 minutes total', ms: 1300 }] }],
    course_planner: s => [{ role: 'agent', text: 'Three discipline electives fit cleanly. **Data Mining** is the easiest — Tue/Thu mornings, nothing else in T3 [C1]. **Machine Learning** clashes with PoPL in slot M2 [C2], so only take it if you drop PoPL.\n- For your open elective, *ECON F211* counts for every programme [C3]', citations: [Q.dm('C1'), Q.ml('C2'), Q.econ('C3')], cards: [clone(CARDS.courses)],
      trace: [{ tool: 'search_catalog', summary: '14 electives offered next semester', ms: 1100 }, { tool: 'check_clashes', summary: 'Compared against your registered slots', ms: 800 }] }],
    career: s => [{ role: 'agent', text: 'You\u2019re closer than you think. Data Analyst listings want SQL, pandas, statistics, a BI tool and one end-to-end project [C1]. You have the first three; Data Mining next semester covers pandas. What\u2019s missing is **a dashboard tool** and **a project you can show**.', citations: [Q.analyst('C1')], cards: [clone(CARDS.skills)],
      trace: [{ tool: 'read_role_profiles', summary: 'Matched 1 role profile', ms: 700 }, { tool: 'compare_transcript', summary: '11 courses mapped to 7 skills', ms: 1500 }] }],
    clubs: s => [{ role: 'agent', text: 'Two solid fits and one wildcard. **Shutterbugs** runs night photo walks every second Friday [C1]; the **ACM reading group** meets Wednesdays at 6 [C2]. I\u2019ve pinged both — replies below.', citations: [Q.photo('C1'), Q.acm('C2')], cards: [clone(CARDS.picks)],
      trace: [{ tool: 'search_clubs', summary: '42 clubs, 3 matched your interests', ms: 900 }, { tool: 'notify_clubs', summary: 'Introduced you to 2 clubs', ms: 600 }] }],
    resources: s => [{ role: 'agent', text: 'Five years of mid-sem papers are in the Moodle Question Bank [C1]. The library is open until 2 AM during exams [C2] — Discussion Room 3 is free most evenings.', citations: [Q.papers('C1'), Q.libHours('C2')], cards: [clone(CARDS.resources)],
      trace: [{ tool: 'search_library', summary: '4 resources for CS F212', ms: 800 }] }],
    relevance: s => [{ role: 'agent', text: 'Think of a B+ tree as a **tournament draw**. Every team (record) sits at the bottom; the rounds above only tell you which half to look in [C1]. Side-by-side version in the panel.', citations: [Q.btree('C1')], cards: [clone(CARDS.relevant)],
      trace: [{ tool: 'read_syllabus', summary: 'Found Unit 5 · Indexing and B+ trees', ms: 600 }, { tool: 'map_analogy', summary: 'Mapped 3 properties to cricket', ms: 1100 }] }],
  };

  const GENERIC = {
    academic_coach: q => ({ text: 'Based on your current audit, nothing here changes your graduation date. The handbook rule that applies is the 142-unit requirement [C1]; the latest audit is in the panel.', citations: [Q.credits('C1')], trace: [{ tool: 'run_degree_audit', summary: 'Re-ran audit', ms: 1800 }] }),
    exam_prep: q => ({ text: 'Weightage for the DBMS mid-sem: **SQL 30%**, normalization 20%, indexing 20%, ER modelling and transactions 15% each [C1].', citations: [Q.blueprint('C1')], trace: [{ tool: 'read_syllabus', summary: 'Read mid-sem blueprint', ms: 900 }] }),
    course_planner: q => ({ text: 'ECON F211 fills your open elective and counts for every programme [C1]. It\u2019s Wednesday at 4, so no clashes with your core.', citations: [Q.econ('C1')], trace: [{ tool: 'search_catalog', summary: 'Filtered open electives', ms: 1000 }] }),
    career: q => ({ text: 'Placement registrations for your batch open on **1 November** [C1]. I\u2019ll remind you a week before.', citations: [Q.placeDates('C1')], trace: [{ tool: 'read_role_profiles', summary: 'Read registration calendar', ms: 700 }] }),
    clubs: q => ({ text: 'This weekend: the **Open Pop-Culture Quiz** on Saturday at 8 PM, and a Shutterbugs night walk on Friday [C1].', citations: [Q.photo('C1')], trace: [{ tool: 'search_events', summary: '5 events this weekend', ms: 900 }] }),
    resources: q => ({ text: 'Room bookings open from the library portal in 2-hour slots. Extended hours run 1–13 October [C1].', citations: [Q.libHours('C1')], trace: [{ tool: 'check_rooms', summary: '3 rooms free tonight', ms: 800 }] }),
    relevance: q => ({ text: 'Normalization is squad selection: no player listed twice, every stat stored once, so updating one record never contradicts another. The indexing unit covers the storage side [C1].', citations: [Q.btree('C1')], trace: [{ tool: 'map_analogy', summary: 'Mapped concept to your interest', ms: 1000 }] }),
  };

  const escalationReply = (s, ticketId) => ({ role: 'agent', text: 'Registering above 25 units needs Associate Dean approval and a CGPA of at least 8.0 [C1]. I can\u2019t approve that myself, so I\u2019ve sent your request to your advisor with a summary of your audit.', citations: [Q.overload('C1')], cards: [],
    trace: [{ tool: 'check_policy', summary: 'Found Handbook §5.4 Unit overload', ms: 900 }, { tool: 'create_ticket', summary: `Opened ticket #${ticketId} for Human Advisor`, ms: 500 }], escalation: { ticketId, status: 'open' } });

  const tickets = [
    { id: 'A-104', studentId: 's1', agentId: 'academic_coach', question: 'Can I overload to 28 units next sem?', agentSummary: 'Aarav (CGPA 8.2, Sem 5) wants 28 units next semester to absorb the extra discipline elective from circular 2026-03. Handbook §5.4 caps registration at 25 units without Associate Dean approval; his CGPA clears the 8.0 bar. Needs an advisor recommendation.', citations: [Q.overload('C1'), Q.circ('C2')], status: 'open', createdAt: at(10, 12), reply: null },
    { id: 'A-101', studentId: 's2', agentId: 'academic_coach', question: 'Can I overload to 28 units next sem?', agentSummary: 'Priya (CGPA 8.4, Sem 7) needs one more discipline elective and PS-II in her final semester. Handbook §5.4 overload rule applies; CGPA qualifies.', citations: [Q.overload('C1')], status: 'answered', createdAt: at(9, 30), answeredAt: at(9, 58), reply: 'Priya — with your CGPA you qualify. I\u2019ve recommended it to the Associate Dean\u2019s office. Submit form AUGSD-7 in the ERP by 3 October and I\u2019ll sign it the same day.' },
  ];

  function withMeta(m, ts) { return { id: uid('m'), ts, citations: [], cards: [], ...m }; }
  function threadsFor(sid) {
    const s = students.find(x => x.id === sid);
    const out = {};
    agents.forEach((a, i) => {
      if (sid === 's3') { out[a.id] = []; return; }
      const h = 9 + Math.floor(i / 2), m0 = (i % 2) * 25;
      const q = withMeta({ role: 'student', text: a.starters[0] }, at(h, m0 + 2));
      const replies = SEED[a.id](s).map(r => withMeta(r, at(h, m0 + 3)));
      let list = [q, ...replies];
      if (a.id === 'academic_coach') {
        const tid = sid === 's1' ? 'A-104' : 'A-101';
        const q2 = withMeta({ role: 'student', text: a.starters[1] }, at(sid === 's1' ? 10 : 9, sid === 's1' ? 11 : 29));
        const r2 = withMeta(escalationReply(s, tid), at(sid === 's1' ? 10 : 9, sid === 's1' ? 12 : 30));
        list.push(q2, r2);
        if (sid === 's2') { r2.escalation.status = 'answered'; list.push(withMeta({ role: 'advisor', text: tickets[1].reply }, tickets[1].answeredAt)); }
      }
      if (a.id === 'clubs') {
        const parent = replies[0].id;
        list.push(withMeta({ role: 'club', authorName: 'Shutterbugs', avatar: '📷', replyToId: parent, text: `Hey ${s.first}! Night walk this Friday from the Clock Tower. Phones count as cameras.` }, at(h, m0 + 9)));
        list.push(withMeta({ role: 'club', authorName: 'ACM Student Chapter', avatar: '🤖', replyToId: parent, text: 'Wednesday\u2019s paper is *Attention Is All You Need*. Grab a seat near the front.' }, at(h, m0 + 14)));
      }
      out[a.id] = list;
    });
    return out;
  }

  function replyFor(agentId, text, s, ticketCount) {
    const a = agents.find(x => x.id === agentId), now = new Date().toISOString();
    if (/\b(fail|error)\b/i.test(text)) return { tools: ['read_handbook'], msgs: [withMeta({ role: 'error', text: '' }, now)] };
    if (agentId === 'academic_coach' && /overload/i.test(text)) {
      const tid = 'A-' + (105 + ticketCount);
      const msg = withMeta(escalationReply(s, tid), now);
      const ticket = { id: tid, studentId: s.id, agentId, question: text, agentSummary: `${s.first} (CGPA ${s.cgpa}, Sem ${s.semester}) is asking about a unit overload. Handbook §5.4 caps registration at 25 units without Associate Dean approval. Needs an advisor recommendation.`, citations: [Q.overload('C1')], status: 'open', createdAt: now, reply: null };
      return { tools: msg.trace.map(t => t.tool), msgs: [msg], ticket };
    }
    if (text.trim() === a.starters[0]) { const r = SEED[agentId](s).map(x => withMeta(x, now)); return { tools: r[0].trace.map(t => t.tool), msgs: r }; }
    const g = GENERIC[agentId](text);
    const r = withMeta({ role: 'agent', cards: [], ...g }, now);
    return { tools: g.trace.map(t => t.tool), msgs: [r] };
  }

  const connectors = [
    { id: 'moodle', name: 'Moodle LMS', kind: 'Learning management', provides: ['Handbook', 'Syllabi', 'Quiz scores'], status: 'synthetic' },
    { id: 'erp', name: 'Student ERP', kind: 'Student records', provides: ['Transcript', 'Registration'], status: 'synthetic' },
    { id: 'circulars', name: 'Circulars Board', kind: 'Notices', provides: ['Circulars'], status: 'synthetic' },
    { id: 'library', name: 'Library Catalog', kind: 'Library', provides: ['Books', 'Past papers', 'Rooms'], status: 'synthetic' },
    { id: 'email', name: 'Campus Email', kind: 'Email', provides: ['Advisor replies'], status: 'connected' },
    { id: 'gcal', name: 'Google Calendar', kind: 'Calendar', provides: ['Timetable', 'Events'], status: 'available' },
    { id: 'placement', name: 'Placement Portal', kind: 'Careers', provides: ['Role profiles', 'Drives'], status: 'available' },
  ];

  const state = {}; students.forEach(s => state[s.id] = { audit: clone(audits[s.id]) });
  return { students, agents, docs, connectors, tickets, state, threadsFor, replyFor, advisor: { name: 'Dr. Kavita Rao' } };
})();
