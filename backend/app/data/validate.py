from pathlib import Path
import json,re,sys
ROOT=Path(__file__).resolve().parent
TODAY='2026-09-26'

def loadj(name): return json.loads((ROOT/name).read_text())
def fail(msg): print('FAIL:',msg); raise AssertionError(msg)
def ok(msg): print('PASS:',msg)
cat=loadj('catalog.json')['courses']; by={c['code']:c for c in cat}; codes=set(by)
# Collect syllabus topics and units
syll={}; units={}
for p in (ROOT/'syllabus').glob('*.md'):
    txt=p.read_text(); cm=re.search(r'^courseCode:\s*(.+)$',txt,re.M); code=cm.group(1).strip()
    if code not in codes: fail(f'syllabus course missing from catalog: {code}')
    topics=[]; unitmap={}; current=None
    for line in txt.splitlines():
      if line.startswith('## Unit '): current=line.split(':',1)[1].strip(); unitmap[current]=[]
      elif line.startswith('### '):
        t=line[4:].strip(); topics.append(t); unitmap[current].append(t)
    syll[code]=set(topics); units[code]=unitmap
# course refs across JSON
for fn,key in [('timetable.json','rows')]:
  for r in loadj(fn)[key]:
    if r['courseCode'] not in codes: fail(f'{fn}: {r["courseCode"]}')
for r in loadj('exam_calendar.json')['courses']:
  if r['courseCode'] not in codes: fail('exam calendar missing course')
for c in loadj('past_papers.json')['courses']:
  if c['courseCode'] not in codes: fail('past papers missing course')
  for paper in c['papers']:
    for t in paper['topicMarks']:
      if t not in syll[c['courseCode']]: fail(f'past paper topic not in syllabus: {c["courseCode"]} {t}')
for sfile in (ROOT/'students').glob('*.json'):
  s=json.loads(sfile.read_text())
  for group in ['transcript','registrations']:
    for r in s[group]['rows']:
      if r['courseCode'] not in codes: fail(f'{sfile.name} {group} unknown {r["courseCode"]}')
  if 'plannedNextSemester' in s:
    for r in s['plannedNextSemester']['rows']:
      if r['courseCode'] not in codes: fail('planned unknown course')
  for r in s['internalMarks']['rows']:
    if r['courseCode'] not in codes: fail('marks unknown course')
    if r['topic'] not in syll[r['courseCode']]: fail(f'mark topic not syllabus {r["courseCode"]} {r["topic"]}')
ok('all course codes and topic references resolve')
# skills
skills={x for c in cat for x in c['skills']}
for role in loadj('role_profiles.json')['roles']:
  for sk in role['requiredSkills']+role['niceToHave']:
    if sk not in skills: fail(f'role skill not in catalog: {sk}')
ok('role skill vocabulary is covered by catalog')
# clubs
clubs=loadj('clubs.json')['clubs']; slugs={c['slug'] for c in clubs}; names={c['name'] for c in clubs}
for e in loadj('events.json')['events']:
  if 'clubSlug' in e and e['clubSlug'] not in slugs: fail('event club slug missing')
feed=(ROOT/'club_feed.md').read_text(); feednames={x.strip() for x in re.findall(r'^## (.+)$',feed,re.M)}
if feednames!=names: fail(f'club feed mismatch: {feednames^names}')
ok('clubs, feed and events resolve')
# handbook bucket exact match
hb=(ROOT/'handbook.md').read_text();
def parse_list(prefix):
  m=re.search(re.escape(prefix)+r' (.+?)\.',hb)
  if not m: fail('handbook bucket sentence missing')
  return {x.strip() for x in m.group(1).split(',')}
if parse_list('The following course codes count as Discipline Electives:') != {c['code'] for c in cat if c['bucket']=='discipline_elective'}: fail('discipline list mismatch')
if parse_list('The following course codes count as Open Electives:') != {c['code'] for c in cat if c['bucket']=='open_elective'}: fail('open list mismatch')
ok('handbook elective lists exactly match catalog buckets')
# override quote
c1=(ROOT/'circulars/2026-03-revised-discipline-elective-minimum.md').read_text()
if 'minimum of 4 courses totaling at least 16 units' not in hb: fail('handbook 4 rule missing')
if 'minimum of 5 courses totaling at least 20 units' not in c1: fail('circular 5 rule missing')
ok('elective override trap present')
# timetable clashes sem5
tt=loadj('timetable.json')['rows']
for i,a in enumerate(tt):
  for b in tt[i+1:]:
    if a['day']==b['day'] and max(a['start'],b['start'])<min(a['end'],b['end']): fail(f'sem5 timetable clash {a} {b}')
slotc=(ROOT/'circulars/2026-08-sem5-timetable-slot-change.md').read_text()
if 'CS F415 Data Mining is moved to slot T2' not in slotc or 'CS F407 Artificial Intelligence' not in slotc: fail('sem6 clash trap missing')
ok('Sem 5 clash-free; Sem 6 clash planted in circular')
# lectures
lecture_cfg={
 'cs-f212-2026-09-22-transactions.md':('CS F212','Transactions and concurrency','Two-phase locking',"This part on serializability will definitely be on the end-sem, I'm telling you now.",['ACID properties','Serializability','Locking basics']),
 'cs-f372-2026-09-23-scheduling.md':('CS F372','CPU scheduling','Multilevel feedback queues','Expect a Gantt-chart question on Round Robin in the end-sem.',['FCFS scheduling','Shortest Job First','Round Robin']),
 'cs-f303-2026-09-24-transport.md':('CS F303','Transport layer','Congestion control','I always ask one question on the three-way handshake.',['TCP three-way handshake','Flow control'])}
for fn,(code,unit,skip,hint,covers) in lecture_cfg.items():
  txt=(ROOT/'lectures'/fn).read_text()
  if unit not in units[code]: fail(f'lecture unit missing {fn}')
  if skip not in units[code][unit]: fail(f'skip is not canonical {fn}')
  body=txt.split('---',2)[-1]
  if skip.lower() in body.lower(): fail(f'skipped topic appears in transcript {fn}')
  for t in covers:
    # canonical concept may be phrased title case in transcript; require phrase words
    if t.lower() not in body.lower(): fail(f'covered topic missing in text {fn}: {t}')
  if hint not in body: fail(f'hint not verbatim {fn}')
ok('lecture units, covered topics, skipped topics and exact hints validate')
# Meera past papers >=14
pp={c['courseCode']:c for c in loadj('past_papers.json')['courses']}
for code,topic in [('CS F212','Normalization'),('CS F212','B+ trees'),('CS F372','CPU scheduling')]:
  vals=[p['topicMarks'].get(topic,0) for p in pp[code]['papers']]
  if len(vals)!=3 or min(vals)<14: fail(f'Meera impact trap failed {code} {topic}: {vals}')
ok('Meera weak topics carry >=14 marks in all three years')
# ISO date checks
iso=re.compile(r'^\d{4}-\d{2}-\d{2}$')
for p in (ROOT/'circulars').glob('*.md'):
  m=re.search(r'^effectiveDate:\s*(\d{4}-\d{2}-\d{2})$',p.read_text(),re.M)
  if not m or not iso.match(m.group(1)) or m.group(1)>TODAY: fail(f'effective date {p.name}')
for e in loadj('events.json')['events']:
  if not iso.match(e['date']) or e['date']<'2026-09-28': fail('event date')
for sfile in (ROOT/'students').glob('*.json'):
  s=json.loads(sfile.read_text())
  for r in s['internalMarks']['rows']:
    if not iso.match(r['date']): fail('mark date')
ok('date constraints validate')
# student totals and intended traps
expected={'aarav':96,'meera':78,'rohan':92}
for sid,total in expected.items():
  s=loadj(f'students/{sid}.json')
  earned=sum(r['units'] for r in s['transcript']['rows'] if r['grade']!='F')
  if earned!=total: fail(f'{sid} total {earned} != {total}')
meera=loadj('students/meera.json')
if sum(1 for r in meera['transcript']['rows'] if r['grade']=='F')!=2: fail('Meera backlog count')
rohan=loadj('students/rohan.json')
if any(r['courseCode']=='CS F351' and r['grade']!='F' for r in rohan['transcript']['rows']): fail('Rohan unexpectedly took F351')
planned={r['courseCode'] for r in rohan['plannedNextSemester']['rows']}
if not {'CS F342','CS F415','CS F464'}.issubset(planned): fail('Rohan planned list missing required courses')
ok('student totals and student-specific traps validate')
# stronger student story checks
cat_by={c['code']:c for c in cat}
gp={'A':10,'A-':9,'B':8,'B-':7,'C':6,'C-':5,'D':4,'E':2,'F':0}
def cgpa(s):
  rows=s['transcript']['rows']; return sum(r['units']*gp[r['grade']] for r in rows)/sum(r['units'] for r in rows)
aarav=loadj('students/aarav.json'); meera=loadj('students/meera.json'); rohan=loadj('students/rohan.json')
aar_de=[r for r in aarav['transcript']['rows'] if r['grade']!='F' and cat_by[r['courseCode']]['bucket']=='discipline_elective']
if len(aar_de)!=2: fail(f'Aarav must have exactly 2 discipline electives, got {len(aar_de)}')
if not 8.2 <= cgpa(aarav) <= 8.6: fail(f'Aarav CGPA out of target range: {cgpa(aarav):.2f}')
if not 5.9 <= cgpa(meera) <= 6.3: fail(f'Meera CGPA out of target range: {cgpa(meera):.2f}')
if not 7.4 <= cgpa(rohan) <= 7.8: fail(f'Rohan CGPA out of target range: {cgpa(rohan):.2f}')
if not any(r['courseCode']=='CS F303' and r['topic']=='Flow control' and r['scored']/r['max']<=0.5 for r in aarav['internalMarks']['rows']): fail('Aarav CS F303 soft spot missing')
for code,topic,target in [('CS F212','Normalization',(4,12)),('CS F212','B+ trees',(3,10))]:
  if not any(r['courseCode']==code and r['topic']==topic and (r['scored'],r['max'])==target for r in meera['internalMarks']['rows']): fail(f'Meera explicit weak score missing {topic}')
planned={r['courseCode'] for r in rohan['plannedNextSemester']['rows']}
if 'CS F342' not in planned or 'CS F351' in {r['courseCode'] for r in rohan['transcript']['rows'] if r['grade']!='F'}: fail('Rohan prerequisite trap missing')
if not {'CS F415','CS F407'}.issubset(planned): fail('Rohan planned clash pair missing')
ok('student narrative targets, CGPAs, weak spots, prereq and clash traps validate')

# connectorId presence on top-level docs/collections
for fn in ['catalog.json','role_profiles.json','timetable.json','exam_calendar.json','past_papers.json','resources.json','clubs.json','events.json','gap_tags.json']:
  if 'connectorId' not in loadj(fn): fail(f'connectorId missing {fn}')
for sfile in (ROOT/'students').glob('*.json'):
  s=json.loads(sfile.read_text())
  for group in ['transcript','registrations','internalMarks']:
    if 'connectorId' not in s[group]: fail(f'connectorId missing {sfile.name} {group}')
ok('connector provenance present')

# graded answers (exam_system connector, contracts v3.7 GradedAnswerRow): mid-sem, CS F212 + CS F372 only
GA_COURSES=('CS F212','CS F372')
GA_KEYS={'courseCode','exam','question','topic','scored','max','rubricFeedback','gapTag','date'}
ex={c['id']:c for c in loadj('connectors.json')}.get('exam_system',{})
if (ex.get('kind'),ex.get('status'),ex.get('provides'))!=('exam_system','synthetic',['graded_answers']): fail('exam_system connector missing or wrong')
gt=loadj('gap_tags.json'); tags={t['tag']:t for t in gt['tags']}
if gt['connectorId']!='exam_system' or len(tags)!=len(gt['tags']): fail('gap_tags.json: connectorId must be exam_system, tags unique')
for t in gt['tags']:
  if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*',t['tag']): fail(f'gap tag not kebab-case: {t["tag"]}')
  if t['kind'] not in ('concept','presentation','none') or (t['kind']=='none')!=(t['tag']=='none'): fail(f'gap tag kind: {t["tag"]}')
  if not t['label'].strip() or '\n' in t['label']: fail(f'gap tag needs a one-line label: {t["tag"]}')
mid={r['courseCode']:r['midSemDate'] for r in loadj('exam_calendar.json')['courses']}
vague=re.compile(r'(?i)needs? improvement|good (attempt|effort|work)|well done|work harder|revise (the|this) topic')
if {p.stem for p in (ROOT/'graded_answers').glob('*.json')}!={p.stem for p in (ROOT/'students').glob('*.json')}: fail('graded_answers/ must hold exactly one file per student')
ga={}; used=set()
for sfile in (ROOT/'students').glob('*.json'):
  sid=sfile.stem; g=loadj(f'graded_answers/{sid}.json'); rows=ga[sid]=g['rows']
  if g['connectorId']!='exam_system': fail(f'graded_answers/{sid}.json connectorId')
  seen=set(); sums={}
  for r in rows:
    at=f'graded_answers/{sid}.json {r.get("courseCode")} {r.get("question")}'
    if set(r)!=GA_KEYS: fail(f'{at}: keys differ from GradedAnswerRow: {sorted(set(r)^GA_KEYS)}')
    if r['courseCode'] not in GA_COURSES or r['exam']!='Mid-sem': fail(f'{at}: only CS F212 / CS F372 mid-sem are in scope')
    if not re.fullmatch(r'Q\d+[a-z]?',r['question']) or (r['courseCode'],r['question']) in seen: fail(f'{at}: bad or duplicate question label')
    seen.add((r['courseCode'],r['question']))
    if r['topic'] not in syll[r['courseCode']]: fail(f'{at}: topic not in syllabus: {r["topic"]}')
    if r['gapTag'] not in tags: fail(f'{at}: gapTag not in gap_tags.json: {r["gapTag"]}')
    if not (type(r['scored'])==type(r['max'])==int and 0<=r['scored']<=r['max'] and r['max']>0): fail(f'{at}: scored/max')
    if (r['gapTag']=='none')!=(r['scored']==r['max']): fail(f'{at}: gapTag "none" exactly when full marks')
    fb=r['rubricFeedback']
    if len(fb)<40 or not fb.endswith('.') or re.search(r'[.!?]\s+[A-Z]',fb) or vague.search(fb): fail(f'{at}: rubricFeedback must be one concrete sentence')
    if r['date']!=mid[r['courseCode']]: fail(f'{at}: date {r["date"]} is not the mid-sem date {mid[r["courseCode"]]}')
    used.add(r['gapTag']); acc=sums.setdefault((r['courseCode'],r['topic']),[0,0]); acc[0]+=r['scored']; acc[1]+=r['max']
  for code in GA_COURSES:
    n=sum(r['courseCode']==code for r in rows)
    if not 6<=n<=8: fail(f'graded_answers/{sid}.json {code}: {n} questions, expected 6-8')
  # the file explains the internal mid-sem marks; it never changes them
  marks={}
  for r in loadj(f'students/{sid}.json')['internalMarks']['rows']:
    if r['courseCode'] in GA_COURSES and r['component'].startswith('Mid-sem'):
      if (r['courseCode'],r['topic']) in marks: fail(f'{sid}: two mid-sem mark rows for {r["courseCode"]} {r["topic"]}')
      marks[(r['courseCode'],r['topic'])]=[r['scored'],r['max']]
  diff=sorted(k for k in sums.keys()|marks.keys() if sums.get(k)!=marks.get(k))
  if diff: fail(f'{sid}: graded sums != internal mid-sem marks for {[(k,sums.get(k),marks.get(k)) for k in diff]}')
if set(tags)-used: fail(f'gap_tags.json lists unused tags: {sorted(set(tags)-used)}')
ok('graded answers: in scope, topics and tags resolve, per-topic sums equal internal mid-sem marks')
def concept_gaps(sid): return [r for r in ga[sid] if tags[r['gapTag']]['kind']=='concept']
for code,topic,want in [('CS F212','Normalization',{'transitive-dependency-not-removed','bcnf-vs-3nf-confused'}),
                        ('CS F212','B+ trees',{'split-propagation-missed'}),('CS F372','CPU scheduling',{'rr-quantum-context-switch-ignored'})]:
  rows=[r for r in ga['meera'] if (r['courseCode'],r['topic'])==(code,topic)]
  if not want<={r['gapTag'] for r in rows}: fail(f'Meera {code} {topic}: missing gap tags {want-{r["gapTag"] for r in rows}}')
  if any(r['scored']<r['max'] and tags[r['gapTag']]['kind']!='concept' for r in rows): fail(f'Meera {code} {topic}: every lost mark must carry a concept gap')
if [r['courseCode'] for r in concept_gaps('aarav')]!=['CS F372']: fail('Aarav: expected exactly one concept gap, in CS F372')
if 2*sum(r['scored']==r['max'] for r in ga['aarav'])<=len(ga['aarav']): fail('Aarav: expected full marks on most questions')
if [r['courseCode'] for r in concept_gaps('rohan')]!=['CS F212']: fail('Rohan: expected exactly one concept gap, in CS F212')
ok("graded-answer traps: Meera's mid-sem gaps explain her weak topics; Aarav and Rohan carry one small gap each")
print('\nALL VALIDATIONS PASSED')
