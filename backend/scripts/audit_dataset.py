#!/usr/bin/env python3
"""Independent audit of the synthetic dataset against AGENTS.md §5 and contracts.ts.

Built from the spec and the data files only; it does not read, import or run the
dataset's own validate.py. Standard library only. Rules (grade points, pace,
overload, bucket lists, prerequisite table) are parsed from handbook.md itself,
so the audit tests the documents against their own text. Every FAIL carries
file:line evidence quoted from the data.

From the repo root:

    python3 backend/scripts/audit_dataset.py --data-dir backend_dataset/app/data
    python3 backend/scripts/audit_dataset.py --data-dir backend_dataset/app/data --format md
    backend/.venv/bin/python backend/scripts/audit_dataset.py \
        --data-dir backend_dataset/app/data --probe-backend

--probe-backend also loads the data through backend/app/core (academics, records,
syllabus) to show whether the code that will demo it can read it.

Accepts both the generated file shapes and the older stub shapes, so it keeps
working if exam_calendar.json / past_papers.json are reshaped.

Exit status 1 if any check FAILs.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TODAY = date(2026, 9, 26)                            # AGENTS.md: Sat 26 Sep 2026
END_SEM = (date(2026, 11, 30), date(2026, 12, 10))   # checklist §5 window

# contracts.ts enums (unchanged v3.1 → v3.4; v3.2 renamed credits → units; v3.7 added graded_answers / exam_system)
DOCUMENT_KINDS = {"handbook", "circular", "catalog", "syllabus", "exam_calendar", "past_papers",
                  "resources", "club_feed", "events", "role_profiles"}
RECORD_KINDS = {"transcript", "internal_marks", "registrations", "graded_answers"}
CONNECTOR_KINDS = {"lms", "erp", "academic_office", "placement", "clubs_portal", "exam_system", "manual"}
CONNECTOR_STATUS = {"synthetic", "connected", "available"}
RESOURCE_KINDS = {"ta_hours", "faculty", "library", "tutoring", "lab"}
REG_STATUS = {"registered", "waitlisted"}
STUDENT_KEYS = {"id", "name", "program", "semester", "careerGoal", "interests"}
TRANSCRIPT_KEYS = {"courseCode", "title", "units", "grade", "semester"}   # checklist: units, not credits
MARK_KEYS = {"courseCode", "component", "scored", "max", "date"}
REG_KEYS = {"courseCode", "semester", "status"}
CATALOG_KEYS = {"code", "title", "units", "slot", "faculty", "prereqs", "bucket", "feedback", "skills"}

# AGENTS.md §5 inventory (+ timetable and lectures, required by contracts v3.1)
REQUIRED = ["handbook.md", "catalog.json", "role_profiles.json", "exam_calendar.json", "past_papers.json",
            "resources.json", "clubs.json", "club_feed.md", "events.json", "connectors.json", "timetable.json"]
REQUIRED_GLOBS = {"circulars/*.md": 2, "syllabus/*.md": 5, "students/*.json": 3, "lectures/cs-f*.md": 1}

# Demo traps. The dataset spec (dataset-prompt.md) was not available to this audit;
# the exam-hint sentences are the exact ones the dataset promises, checked against the text.
LECTURES = {
    "CS F212": dict(skipped="Two-phase locking",
                    absent=[r"(?i)two[\s\-‐-–]*phase", r"\b2\s*PL\b", r"(?i)growing phase",
                            r"(?i)shrinking phase", r"(?i)lock point"],
                    hint="This part on serializability will definitely be on the end-sem, I'm telling you now.",
                    deferred="deadlock"),
    "CS F372": dict(skipped="Multilevel feedback queues",
                    absent=[r"(?i)multi[\s\-]*level", r"\bMLFQ\b", r"(?i)feedback queue"],
                    hint="Expect a Gantt-chart question on Round Robin in the end-sem.",
                    deferred=None),
    "CS F303": dict(skipped="Congestion control",
                    absent=[r"(?i)congestion", r"\bAIMD\b", r"(?i)slow[\s\-]*start", r"\bcwnd\b"],
                    hint="I always ask one question on the three-way handshake.",
                    deferred=None),
}
FUTURE_RX = re.compile(r"(?i)\b(next (?:week|time|class|lecture|session)|come back to|later lecture|"
                       r"we will (?:cover|start|continue|do))\b")
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
CODE_RX = re.compile(r"\b[A-Z]{2,4} F\d{3}\b")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TEMPLATE_SYLLABUS = re.compile(r" is treated as a named assessable topic in this unit, with definitions, "
                               r"worked examples, and problem-solving practice\.$")


# ------------------------------------------------------------------ plumbing

def clip(s: str, n: int = 230) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


@dataclass
class Result:
    cid: str
    title: str
    status: str                      # PASS | FAIL | WARN | INFO
    evidence: list[str] = field(default_factory=list)


class Doc:
    """A data file with line numbers, for quoting evidence."""

    def __init__(self, root: Path, rel: str):
        self.rel = rel
        self.text = (root / rel).read_text(encoding="utf-8")
        self.lines = self.text.splitlines()

    def find(self, pattern: str, start: int = 1) -> int | None:
        rx = re.compile(pattern)
        for i in range(max(start, 1) - 1, len(self.lines)):
            if rx.search(self.lines[i]):
                return i + 1
        return None

    def find_all(self, pattern: str) -> list[int]:
        rx = re.compile(pattern)
        return [i + 1 for i, line in enumerate(self.lines) if rx.search(line)]

    def chain(self, *patterns: str) -> int | None:
        """Line of the last pattern, each searched after the previous match."""
        n: int | None = 1
        for p in patterns:
            n = self.find(p, n or 1)
            if n is None:
                return None
        return n

    def at(self, n: int | None, quote: str | None = None) -> str:
        if n is None:
            return f"{self.rel}: (not found)"
        text = f'"{clip(quote)}"' if quote is not None else clip(self.lines[n - 1].strip())
        return f"{self.rel}:{n}: {text}"


def front_matter(doc: Doc) -> tuple[dict[str, str], int]:
    """(meta, first body line)."""
    if doc.lines and doc.lines[0].strip() == "---":
        for i in range(1, len(doc.lines)):
            if doc.lines[i].strip() == "---":
                meta = {}
                for ln in doc.lines[1:i]:
                    if ":" in ln:
                        k, v = ln.split(":", 1)
                        meta[k.strip()] = v.strip().strip("\"'")
                return meta, i + 2
    return {}, 1


def fm_line(doc: Doc, key: str) -> int | None:
    return doc.find(rf"^{re.escape(key)}\s*:")


@dataclass
class Section:
    heading: str
    number: str | None
    start: int
    body: list[tuple[int, str]]

    @property
    def text(self) -> str:
        return " ".join(t.strip() for _, t in self.body if t.strip())


def sections(doc: Doc) -> list[Section]:
    _, start = front_matter(doc)
    out: list[Section] = []
    cur: Section | None = None
    for i in range(start, len(doc.lines) + 1):
        line = doc.lines[i - 1]
        m = re.match(r"^#{1,6}\s+(.*)$", line)
        if m:
            heading = m.group(1).strip()
            num = re.match(r"^(\d+(?:\.\d+)*)\b", heading)
            cur = Section(heading, num.group(1) if num else None, i, [])
            out.append(cur)
        elif cur is not None:
            cur.body.append((i, line))
    return out


def body_lines(doc: Doc) -> list[tuple[int, str]]:
    _, start = front_matter(doc)
    return [(i, doc.lines[i - 1]) for i in range(start, len(doc.lines) + 1)]


def sentences(lines: list[tuple[int, str]]) -> list[tuple[int, str, bool]]:
    """(line, sentence, is_table_row). Headings are skipped; a table row is one unit."""
    out = []
    for n, line in lines:
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s.startswith("|"):
            if not re.match(r"^\|[\s\-:|]+\|$", s):
                out.append((n, s, True))
            continue
        s = re.sub(r"^[-*]\s+", "", s)
        for part in SENT_SPLIT.split(s):
            if part.strip():
                out.append((n, part.strip(), False))
    return out


# sentence boundary, but not after common abbreviations ("B.E. Computer Science", "Dr. Rao")
SENT_SPLIT = re.compile(r"(?<!\bB\.E\.)(?<!\bDr\.)(?<!\bProf\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\bvs\.)(?<=[.!?])\s+")


def match_sentences(lines, *rxs):
    """(prose hits, table hits) for sentences matching every regex."""
    prose, table = [], []
    for n, s, is_table in sentences(lines):
        if all(re.search(r, s) for r in rxs):
            (table if is_table else prose).append((n, s))
    return prose, table


def weekday_name(d: date) -> str:
    return d.strftime("%a")


# ------------------------------------------------------------------ the dataset, normalised

class Data:
    def __init__(self, root: Path):
        self.root = root
        self.docs: dict[str, Doc] = {}

    def has(self, rel: str) -> bool:
        return (self.root / rel).exists()

    def doc(self, rel: str) -> Doc | None:
        if rel not in self.docs:
            if not self.has(rel):
                return None
            self.docs[rel] = Doc(self.root, rel)
        return self.docs[rel]

    def json(self, rel: str):
        d = self.doc(rel)
        return json.loads(d.text) if d else None

    def glob(self, pattern: str) -> list[str]:
        return sorted(str(p.relative_to(self.root)) for p in self.root.glob(pattern) if p.name != "AUDIT.md")

    # -- catalog
    def catalog(self) -> dict[str, dict]:
        raw = self.json("catalog.json") or {}
        rows = raw.get("courses", []) if isinstance(raw, dict) else raw
        return {c["code"]: c for c in rows if "code" in c}

    # -- handbook rules, parsed from its own sentences
    def rules(self) -> dict:
        hb = self.doc("handbook.md")
        r: dict = {"secs": {}, "points": {}, "pass_min": None, "pace": None, "overload": None,
                   "overload_cgpa": None, "total": None, "buckets": {}, "de_codes": [], "oe_codes": [],
                   "prereqs": {}, "prereq_rows": {}}
        if not hb:
            return r
        secs = {s.number: s for s in sections(hb) if s.number}
        r["secs"] = secs
        t = {k: v.text for k, v in secs.items()}
        r["points"] = {g: int(p) for g, p in re.findall(r"\b([A-F][+-]?)\s*=\s*(\d+)", t.get("5.2", ""))}
        m = re.search(r"passing grade[^.]*?\b([A-F][+-]?) or higher", t.get("5.2", ""))
        r["pass_min"] = m.group(1) if m else None
        m = re.search(r"at least (\d+) units per completed semester", t.get("6.1", ""))
        r["pace"] = int(m.group(1)) if m else None
        m = re.search(r"above (\d+) units", t.get("5.4", ""))
        r["overload"] = int(m.group(1)) if m else None
        m = re.search(r"CGPA of at least (\d+(?:\.\d+)?)", t.get("5.4", ""))
        r["overload_cgpa"] = float(m.group(1)) if m else None
        m = re.search(r"earn (\d+) units", t.get("3.1", ""))
        r["total"] = int(m.group(1)) if m else None
        for name in ("Core", "Discipline Electives", "Open Electives", "Humanities", "Practice School or Thesis"):
            m = re.search(rf"The {name} requirement is (?:a minimum of )?(?:(\d+) courses totaling at least )?"
                          rf"(\d+) units", t.get("3.2", ""))
            if m:
                r["buckets"][name] = (int(m.group(1)) if m.group(1) else None, int(m.group(2)))
        for n, s, _ in sentences(secs["4.1"].body if "4.1" in secs else []):
            if "Discipline Electives" in s:
                r["de_codes"] = CODE_RX.findall(s)
            elif "Open Electives" in s and CODE_RX.search(s):
                r["oe_codes"] = CODE_RX.findall(s)
        for n, s, is_table in sentences(secs["4.3"].body if "4.3" in secs else []):
            if is_table:
                cells = [c.strip() for c in s.strip("|").split("|")]
                codes = CODE_RX.findall(cells[0]) if cells else []
                if codes and len(cells) > 1:
                    r["prereqs"][codes[0]] = CODE_RX.findall(cells[1])
                    r["prereq_rows"][codes[0]] = n
            else:                            # prose form: "CS F342 Compiler Construction requires CS F351 ..."
                m = re.match(rf"^({CODE_RX.pattern})\b.*?\brequires\b(.*)$", s)
                if m:
                    r["prereqs"][m.group(1)] = CODE_RX.findall(m.group(2))
                    r["prereq_rows"][m.group(1)] = n
        return r

    # -- circulars
    def circulars(self) -> list[tuple[Doc, dict]]:
        out = []
        for rel in self.glob("circulars/*.md"):
            d = self.doc(rel)
            out.append((d, front_matter(d)[0]))
        return out

    # -- students (flat, or {student, records})
    def students(self) -> dict[str, dict]:
        out = {}
        for rel in self.glob("students/*.json"):
            raw = self.json(rel)
            prof = raw.get("student") or raw.get("profile") or raw
            rec = raw.get("records") or raw

            def env(key, rec=rec):
                v = rec.get(key)
                if isinstance(v, list):
                    return {"connectorId": None, "rows": v}
                return v or {"connectorId": None, "rows": []}

            planned_key = next((k for k in raw if "planned" in k.lower()), None)
            planned = []
            if planned_key:
                v = raw[planned_key]
                planned = (v.get("rows") if isinstance(v, dict) else v) or []
            regs = env("registrations")
            planned += [r for r in regs["rows"] if r.get("status") == "planned"]
            sid = Path(rel).stem
            out[sid] = dict(rel=rel, doc=self.doc(rel), raw=raw, profile=prof, transcript=env("transcript"),
                            registrations=regs, marks=env("internalMarks"), planned=planned,
                            planned_key=planned_key)
        return out

    # -- syllabi: course -> units [(heading, name, [(topic, line)])]
    def syllabi(self) -> dict[str, dict]:
        out = {}
        for rel in self.glob("syllabus/*.md"):
            d = self.doc(rel)
            meta, start = front_matter(d)
            units, cur = [], None
            for i in range(start, len(d.lines) + 1):
                line = d.lines[i - 1].strip()
                m2 = re.match(r"^##\s+(.*)$", line)
                if m2:
                    full = m2.group(1).strip()
                    cur = [full, re.sub(r"(?i)^unit\s+\d+\s*[:.\-–]\s*", "", full), []]
                    units.append(cur)
                    continue
                m3 = re.match(r"^(?:###\s+|[-*]\s+)(.*)$", line)
                if m3 and cur is not None:
                    topic = re.sub(r"^\d+(?:\.\d+)*[.)]?\s+", "", m3.group(1).strip())
                    if topic:
                        cur[2].append((topic, i))
            code = meta.get("courseCode") or Path(rel).stem.upper().replace("-", " ")
            out[code] = dict(rel=rel, doc=d, meta=meta, units=units,
                             topics={t: n for u in units for t, n in u[2]})
        return out

    # -- past papers, either shape -> [{course, year, exam, total, marks{topic: n}}]
    def papers(self) -> list[dict] | None:
        raw = self.json("past_papers.json")
        if raw is None:
            return None

        def marks(p):
            if "topics" in p:
                return {t["topic"]: t["marks"] for t in p["topics"]}
            return dict(p.get("topicMarks", {}))

        out = []
        if isinstance(raw, dict) and isinstance(raw.get("papers"), list):
            for p in raw["papers"]:
                out.append(dict(course=p.get("courseCode"), year=p.get("year"), exam=p.get("exam"),
                                total=p.get("totalMarks"), marks=marks(p)))
            return out
        courses = raw.get("courses") if isinstance(raw, dict) else raw
        if isinstance(courses, dict):
            courses = [dict(courseCode=k, **v) for k, v in courses.items()]
        for c in courses or []:
            for p in c.get("papers", []):
                out.append(dict(course=c.get("courseCode"), year=p.get("year"), exam=p.get("exam"),
                                total=p.get("totalMarks"), marks=marks(p)))
        return out

    def end_sem_papers(self, course: str) -> list[dict]:
        ps = [p for p in (self.papers() or []) if p["course"] == course
              and (p["exam"] is None or re.search(r"(?i)end|compre", str(p["exam"])))]
        return sorted(ps, key=lambda p: p["year"] or 0)[-3:]

    # -- exam calendar, either shape -> [{course, component, date, id}]
    def exams(self) -> list[dict] | None:
        raw = self.json("exam_calendar.json")
        if raw is None:
            return None
        out = []
        if isinstance(raw, dict) and isinstance(raw.get("exams"), list):
            for e in raw["exams"]:
                out.append(dict(course=e.get("courseCode"), component=e.get("component") or e.get("title"),
                                date=e.get("date"), id=e.get("id")))
            return out
        for c in (raw.get("courses") if isinstance(raw, dict) else raw) or []:
            code = c.get("courseCode")
            for i, q in enumerate(c.get("quizDates", []), 1):
                out.append(dict(course=code, component=f"Quiz {i}", date=q, id=None))
            if c.get("midSemDate"):
                out.append(dict(course=code, component="Mid-sem", date=c["midSemDate"], id=None))
            if c.get("endSemDate"):
                out.append(dict(course=code, component="End-sem", date=c["endSemDate"], id=None))
        return out

    # -- timetable, either shape
    def timetable(self) -> dict | None:
        raw = self.json("timetable.json")
        if raw is None:
            return None
        rows = raw.get("sessions") or raw.get("classes") or raw.get("rows") or []
        out = []
        for r in rows:
            d = (r.get("day") or "").strip().lower()[:3]
            out.append(dict(course=r.get("courseCode"), day=DAYS.index(d) if d in DAYS else None,
                            start=r.get("start"), end=r.get("end"), kind=r.get("kind"), room=r.get("room"),
                            id=r.get("id")))
        return dict(rows=out, term=raw.get("term"), raw=raw)


def hm(s: str) -> int:
    h, m = s.split(":")[:2]
    return int(h) * 60 + int(m)


def canon_component(c: str) -> str:
    c = re.sub(r"(?i)\s*topic total$", "", c or "").strip()
    if re.match(r"(?i)^mid", c):
        return "Mid-sem"
    if re.match(r"(?i)^(end|compre)", c):
        return "End-sem"
    return c


# ------------------------------------------------------------------ audit

class Audit:
    def __init__(self, data: Data):
        self.D = data
        self.results: list[Result] = []

    def add(self, cid: str, title: str, status: str, evidence=()):
        self.results.append(Result(cid, title, status, [e for e in evidence if e]))

    def run(self, probe_backend: bool):
        for group in (self.g0_inventory, self.g1_traps, self.g2_integrity, self.g3_quotability,
                      self.g4_arithmetic, self.g5_calendar, self.g6_realism, self.g7_contract):
            try:
                group()
            except Exception as exc:  # a broken file must not hide every later check
                self.add(group.__name__, f"{group.__name__} crashed", "FAIL",
                         [f"{type(exc).__name__}: {exc}"])
        if probe_backend:
            self.g8_backend_probe()

    # ---------------------------------------------------------------- 0 inventory
    def g0_inventory(self):
        D = self.D
        missing = [f for f in REQUIRED if not D.has(f)]
        short = [f"{g}: {len(D.glob(g))} found, need ≥{n}" for g, n in REQUIRED_GLOBS.items()
                 if len(D.glob(g)) < n]
        self.add("0.1", "Required files present (AGENTS.md §5 + timetable + lectures)",
                 "FAIL" if missing or short else "PASS",
                 [f"missing: {f}" for f in missing] + short or [f"{len(REQUIRED)} files + "
                                                                f"{sum(len(D.glob(g)) for g in REQUIRED_GLOBS)} per-entity files"])
        stubs = []
        for rel in D.glob("**/*.json") + D.glob("**/*.md"):
            d = D.doc(rel)
            n = d.find(r'"_stub"|^stub:\s*true')
            if n:
                stubs.append(d.at(n))
        self.add("0.2", "No stub files", "FAIL" if stubs else "PASS", stubs or ["no _stub / stub: true markers"])

        missing_conn = []
        for rel in D.glob("**/*.md"):
            if Path(rel).name in ("README.md", "AUDIT.md"):
                continue
            d = D.doc(rel)
            if not front_matter(d)[0].get("connectorId"):
                missing_conn.append(f"{rel}: no connectorId in front matter")
        for rel in D.glob("*.json"):
            raw = D.json(rel)
            if rel != "connectors.json" and not (isinstance(raw, dict) and raw.get("connectorId")):
                missing_conn.append(f"{rel}: no top-level connectorId")
        for sid, st in D.students().items():
            for key in ("transcript", "registrations", "marks"):
                if not st[key].get("connectorId"):
                    missing_conn.append(f"{st['rel']}: {key} envelope has no connectorId")
        self.add("0.3", "Every document and record carries a connectorId", "FAIL" if missing_conn else "PASS",
                 missing_conn or ["all markdown front matter, JSON roots and record envelopes carry one"])

    # ---------------------------------------------------------------- 1 demo traps
    def g1_traps(self):
        D = self.D
        hb = D.doc("handbook.md")
        rules = D.rules()
        cat = D.catalog()
        hb_meta = front_matter(hb)[0] if hb else {}

        # 1.1 handbook §3.2, 4-course minimum
        s32 = rules["secs"].get("3.2")
        prose, _ = match_sentences(s32.body if s32 else [], r"Discipline Electives?", r"\b(?:4|four) courses\b")
        self.add("1.1", "handbook §3.2 has one quotable sentence with the 4-course discipline-elective minimum",
                 "PASS" if len(prose) == 1 else "FAIL",
                 [hb.at(n, s) for n, s in prose] or ["no such sentence in §3.2"])

        # 1.2 circular 2026-03, 5-course minimum
        c03 = [(d, m) for d, m in D.circulars() if Path(d.rel).name.startswith("2026-03")]
        if len(c03) != 1:
            self.add("1.2", "circulars/2026-03-* exists once", "FAIL", [f"found {len(c03)}"])
            return
        cd, cm = c03[0]
        prose, _ = match_sentences(body_lines(cd), r"Discipline Electives?", r"\b(?:5|five) courses\b")
        self.add("1.2", "circulars/2026-03-* has one quotable sentence with the 5-course minimum",
                 "PASS" if len(prose) == 1 else "FAIL", [cd.at(n, s) for n, s in prose] or ["no such sentence"])

        # 1.3 effective dates
        he, ce = hb_meta.get("effectiveDate"), cm.get("effectiveDate")
        ok = bool(he and ce and ce > he)
        self.add("1.3", "circular 2026-03 effectiveDate is later than the handbook's", "PASS" if ok else "FAIL",
                 [cd.at(fm_line(cd, "effectiveDate")), hb.at(fm_line(hb, "effectiveDate")),
                  None if ok else f"{ce} is earlier than {he}: 'later effectiveDate wins' (AGENTS.md §3, "
                                  f"core/override.py) keeps the handbook's 4, so the override never fires"])

        # 1.4 supersedes
        sup = cm.get("supersedes")
        ok = sup == "handbook.3.2" and "3.2" in rules["secs"]
        self.add("1.4", "circular supersedes → handbook.3.2 and that section exists", "PASS" if ok else "FAIL",
                 [cd.at(fm_line(cd, "supersedes")), hb.at(s32.start) if s32 else "handbook: no §3.2"])

        # 1.5 population in scope is resolvable from records
        scope_n, scope_s = next(((n, s) for n, s, _ in sentences(body_lines(cd)) if re.search(r"20\d\d", s)
                                 and re.search(r"(?i)graduat", s)), (None, None))
        studs = D.students()
        has_grad = [sid for sid, st in studs.items()
                    if any(re.search(r"(?i)graduat|batch|cohort", k) for k in st["profile"])]
        self.add("1.5", "circular's population ('graduating May 2028 or later') resolvable from student records",
                 "PASS" if len(has_grad) == len(studs) else "WARN",
                 [cd.at(scope_n, scope_s),
                  f"no expectedGraduation/cohort field in {', '.join(st['rel'] for st in studs.values())}; "
                  f"only inferable (semester 5 in Sep 2026 → Sem 8 ends May 2028)" if len(has_grad) != len(studs)
                  else None])

        # 1.6 - 1.10 lecture transcripts
        syl = D.syllabi()
        for idx, (code, spec) in zip(("1.6", "1.7", "1.8"), LECTURES.items()):
            rels = D.glob(f"lectures/{code.lower().replace(' ', '-')}-*.md")
            if not rels:
                self.add(f"{idx}a", f"{code} lecture transcript present", "FAIL", ["no file"])
                continue
            d = D.doc(rels[0])
            body = body_lines(d)
            hits = [d.at(n) for n, line in body for rx in spec["absent"] if re.search(rx, line)]
            self.add(f"{idx}a", f"{code}: skipped topic '{spec['skipped']}' (and variants) absent from transcript",
                     "FAIL" if hits else "PASS",
                     hits or [f"{d.rel}: none of {', '.join(spec['absent'])} occur"])
            n = next((n for n, line in body if spec["hint"] in line), None)
            count = d.text.count(spec["hint"])
            whole = n is not None and any(s == spec["hint"] for _, s, _ in sentences([(n, d.lines[n - 1])]))
            self.add(f"{idx}b", f"{code}: exam-hint sentence verbatim, once, as a whole sentence",
                     "PASS" if n and count == 1 and whole else "FAIL",
                     [d.at(n, spec["hint"]) if n else f'{d.rel}: "{spec["hint"]}" not found verbatim'])
            fut = [(n, s) for n, s, _ in sentences(body) if FUTURE_RX.search(s)]
            topics = [t for t in syl.get(code, {}).get("topics", {})]
            if spec["deferred"]:
                dl = [(n, s) for n, s in fut if spec["deferred"] in s.lower()]
                self.add(f"{idx}c", f"{code}: '{spec['deferred']}s' deferred to a later lecture in the text",
                         "PASS" if dl else "FAIL", [d.at(n, s) for n, s in dl] or ["no deferral sentence"])
            else:
                named = [(n, s) for n, s in fut if any(t.lower() in s.lower() for t in topics)]
                self.add(f"{idx}c", f"{code}: a later-lecture deferral exists and names a syllabus topic",
                         "PASS" if named else ("WARN" if fut else "FAIL"),
                         [d.at(n, s) for n, s in (named or fut)] +
                         ([] if named else ["the deferral names no syllabus topic, so a next_lecture_topic "
                                            "commitment cannot be normalised to one"]))
            in_unit = any(spec["skipped"] in [t for t, _ in u[2]] for u in syl.get(code, {}).get("units", []))
            if not in_unit:
                self.add(f"{idx}d", f"{code}: skipped topic is a syllabus topic", "FAIL",
                         [f"'{spec['skipped']}' not in {syl.get(code, {}).get('rel')}"])

        # 1.9 skipped topics carry past-paper weight (the action's "why" cites it)
        ev, worst = [], "PASS"
        for code, spec in LECTURES.items():
            ps = D.end_sem_papers(code)
            vals = [p["marks"].get(spec["skipped"]) for p in ps]
            years = [p["year"] for p in ps]
            if not ps or all(v is None for v in vals):
                worst = "FAIL"
                ev.append(f"past_papers.json: {code} '{spec['skipped']}' appears in none of {years}")
            elif any(v is None or v < 14 for v in vals):
                worst = "WARN" if worst == "PASS" else worst
                ev.append(f"past_papers.json: {code} '{spec['skipped']}' = {dict(zip(years, vals))} (below 14 in some year)")
            else:
                ev.append(f"past_papers.json: {code} '{spec['skipped']}' = {dict(zip(years, vals))}")
        self.add("1.9", "each skipped topic carries ≥14 marks in each of the last three papers "
                        "(contracts.ts ActionItem.why example)", worst, ev)

        # Rohan
        ro = studs.get("rohan")
        if ro:
            rd = ro["doc"]
            planned = [r for r in ro["planned"] if r.get("courseCode") == "CS F342"]
            self.add("1.10", "rohan: CS F342 is planned", "PASS" if planned else "FAIL",
                     [rd.at(rd.chain(rf'"{ro["planned_key"]}"' if ro["planned_key"] else r'"registrations"',
                                     r'"CS F342"')),
                      f"held under non-contract key '{ro['planned_key']}' with status 'planned'"
                      if ro["planned_key"] else None])
            in_tr = [r for r in ro["transcript"]["rows"] if r["courseCode"] == "CS F351"]
            self.add("1.11", "rohan: CS F351 absent from transcript", "FAIL" if in_tr else "PASS",
                     [rd.at(rd.chain(r'"transcript"', r'"CS F351"'))] if in_tr else
                     [f"{rd.rel}: no transcript row for CS F351"])
            in_reg = [r for r in ro["registrations"]["rows"] if r["courseCode"] == "CS F351"]
            marks = [r for r in ro["marks"]["rows"] if r["courseCode"] == "CS F351"]
            first_mark = rd.chain(r'"internalMarks"', r'"CS F351"')
            self.add("1.12", "rohan: CS F351 absent from registrations", "FAIL" if in_reg else "PASS",
                     ([rd.at(rd.chain(r'"registrations"', r'"CS F351"')),
                       f"{rd.rel}:{first_mark}: plus {len(marks)} internalMarks rows for CS F351" if marks else None,
                       "he is taking the prerequisite now, so the 'hidden prerequisite gap' disappears "
                       "once Sem 5 grades post"]) if in_reg else [f"{rd.rel}: not registered for CS F351"])
            downstream = [r for r in ro["transcript"]["rows"]
                          if "CS F342" in cat.get(r["courseCode"], {}).get("prereqs", [])]
            self.add("1.13", "rohan: transcript does not already contain a course that requires CS F342",
                     "FAIL" if downstream else "PASS",
                     [rd.at(rd.chain(r'"transcript"', rf'"{r["courseCode"]}"'))
                      + f"  (passed in Sem {r['semester']}; catalog prereq CS F342)" for r in downstream]
                     or ["none"])

        # Sem 6 clash
        c08 = [(d, m) for d, m in D.circulars() if re.search(r"slot", d.text, re.I) and "CS F415" in d.text]
        if c08:
            d8 = c08[0][0]
            prose, _ = match_sentences(body_lines(d8), r"CS F415", r"CS F407", r"\bT\d\b")
            self.add("1.14", "CS F415 and CS F407 share a Semester 6 slot per circular 2",
                     "PASS" if prose else "FAIL", [d8.at(n, s) for n, s in prose] or ["no sentence names both"])
        else:
            self.add("1.14", "circular moving CS F415's slot exists", "FAIL", ["none mention CS F415 and a slot"])
        cd_ = D.doc("catalog.json")
        a, b = cat.get("CS F415", {}), cat.get("CS F407", {})
        ok = a.get("slot") and a.get("slot") == b.get("slot") and 6 in a.get("offeredIn", []) \
            and 6 in b.get("offeredIn", [])
        self.add("1.15", "CS F415 and CS F407 share a Semester 6 slot per catalog", "PASS" if ok else "FAIL",
                 [cd_.at(cd_.chain(r'"code": "CS F415"', r'"slot"')), cd_.at(cd_.chain(r'"code": "CS F407"', r'"slot"')),
                  None if ok else "catalog was not updated and the circular's supersedes is null, so nothing "
                                  "machine-readable links the circular to the catalog slot"])
        if ro:
            both = {r["courseCode"] for r in ro["planned"]} >= {"CS F415", "CS F407"}
            self.add("1.16", "rohan plans both CS F415 and CS F407 for Semester 6", "PASS" if both else "FAIL",
                     [f"{ro['rel']}: planned = {sorted(r['courseCode'] for r in ro['planned'])}"])

        # Meera weak topics
        me = studs.get("meera")
        if me:
            weak = self.weak_topics(me)
            md = me["doc"]
            ev = []
            for (course, topic), (sc, mx) in sorted(weak.items()):
                n = md.chain(r'"internalMarks"', rf'"topic": "{re.escape(topic)}"')
                others = [r for r in me["marks"]["rows"] if r["courseCode"] == course and r.get("topic") == topic]
                ev.append(md.at(n) + f"  → {sc}/{mx} = {100 * sc / mx:.1f}% over {len(others)} row(s)")
            self.add("1.17", "meera: weak topics score <40% in internal marks", "PASS" if weak else "FAIL",
                     ev or ["no topic under 40%"])
            ev, ok = [], bool(weak)
            for (course, topic) in sorted(weak):
                ps = D.end_sem_papers(course)
                vals = {p["year"]: p["marks"].get(topic) for p in ps}
                good = len(ps) == 3 and all(v is not None and v >= 14 for v in vals.values())
                ok &= good
                ev.append(f"past_papers.json {course} '{topic}': {vals} {'✓' if good else '✗'}")
            self.add("1.18", "meera: each weak topic carries ≥14 marks in each of the last three past papers",
                     "PASS" if ok else "FAIL", ev)

            # demo step 5: the same DBMS clip for meera → different actions (her weak topics)
            lec = D.glob("lectures/cs-f212-*.md")
            if lec:
                unit = front_matter(D.doc(lec[0]))[0].get("unit")
                unit_topics = next(([t for t, _ in u[2]] for u in syl.get("CS F212", {}).get("units", [])
                                    if u[1] == unit), [])
                mine = [t for (c, t) in weak if c == "CS F212"]
                marked = {sid: sorted({r["topic"] for r in st["marks"]["rows"] if r["courseCode"] == "CS F212"
                                       and r.get("topic") in unit_topics}) for sid, st in studs.items()}
                self.add("1.19", "meera has a weak topic inside the CS F212 lecture's unit (demo step 5)",
                         "PASS" if set(mine) & set(unit_topics) else "WARN",
                         [f"lecture unit '{unit}': {unit_topics}",
                          f"meera's weak CS F212 topics: {mine} (outside that unit)",
                          f"marks on any topic of that unit, per student: {marked} — lecture-derived actions "
                          f"(missed + emphasized) will be identical for every student unless the companion "
                          f"adds course-level weak topics"])

    def weak_topics(self, st) -> dict:
        agg = defaultdict(lambda: [0, 0])
        for r in st["marks"]["rows"]:
            if r.get("topic"):
                agg[(r["courseCode"], r["topic"])][0] += r["scored"]
                agg[(r["courseCode"], r["topic"])][1] += r["max"]
        return {k: tuple(v) for k, v in agg.items() if v[1] and v[0] / v[1] < 0.40}

    # ---------------------------------------------------------------- 2 referential integrity
    def g2_integrity(self):
        D = self.D
        cat = D.catalog()
        codes = set(cat)
        refs: list[tuple[str, str]] = []            # (code, evidence)
        for sid, st in D.students().items():
            d = st["doc"]
            for key in ("transcript", "registrations", "marks"):
                for r in st[key]["rows"]:
                    refs.append((r.get("courseCode"), f"{st['rel']} {key}"))
            for r in st["planned"]:
                refs.append((r.get("courseCode"), f"{st['rel']} planned"))
        for r in (D.timetable() or {}).get("rows", []):
            refs.append((r["course"], "timetable.json"))
        for e in D.exams() or []:
            refs.append((e["course"], "exam_calendar.json"))
        for p in D.papers() or []:
            refs.append((p["course"], "past_papers.json"))
        for code, s in D.syllabi().items():
            refs.append((code, s["rel"]))
        for rel in D.glob("lectures/*.md"):
            c = front_matter(D.doc(rel))[0].get("courseCode")
            if c:
                refs.append((c, rel))
        for r in (D.json("resources.json") or {}).get("resources", []):
            if r.get("forCourse"):
                refs.append((r["forCourse"], "resources.json"))
        for c in cat.values():
            for p in c.get("prereqs", []):
                refs.append((p, f"catalog.json prereqs of {c['code']}"))
        for rel in ["handbook.md"] + D.glob("circulars/*.md"):
            d = D.doc(rel)
            if d:
                for n, line in enumerate(d.lines, 1):
                    for c in CODE_RX.findall(line):
                        refs.append((c, f"{rel}:{n}"))
        bad = sorted({f"{c!r} in {w}" for c, w in refs if c not in codes})
        self.add("2.1", "Every course code resolves to catalog.json", "FAIL" if bad else "PASS",
                 bad or [f"{len(refs)} references, {len({c for c, _ in refs})} distinct codes, all in catalog"])

        syl = D.syllabi()
        bad, checked = [], 0

        def check_topic(course, topic, where):
            nonlocal checked
            checked += 1
            topics = syl.get(course, {}).get("topics", {})
            if topic in topics:
                return
            near = [t for t in topics if re.sub(r"[^a-z0-9]", "", t.lower()) == re.sub(r"[^a-z0-9]", "", topic.lower())]
            bad.append(f"{where}: {course} {topic!r} " + (f"≠ syllabus {near[0]!r} (case/hyphenation)" if near
                                                            else "not a syllabus topic"
                                                            if course in syl else "course has no syllabus"))

        for sid, st in D.students().items():
            for r in st["marks"]["rows"]:
                if r.get("topic"):
                    check_topic(r["courseCode"], r["topic"], st["rel"])
        for p in D.papers() or []:
            for t in p["marks"]:
                check_topic(p["course"], t, f"past_papers.json {p['year']}")
        bad = sorted(set(bad))
        self.add("2.2", "Topic strings (internal marks, past papers) match the syllabus character-for-character",
                 "FAIL" if bad else "PASS", bad or [f"{checked} topic references, all exact"])

        ev, bad2 = [], []
        for rel in D.glob("lectures/*.md"):
            d = D.doc(rel)
            meta = front_matter(d)[0]
            if not meta.get("courseCode"):
                continue
            units = [u[1] for u in syl.get(meta["courseCode"], {}).get("units", [])]
            u = meta.get("unit") or meta.get("title")
            (ev if u in units else bad2).append(d.at(fm_line(d, "unit") or fm_line(d, "title")))
            lec = meta.get("lecturer")
            fac = cat.get(meta["courseCode"], {}).get("faculty")
            if lec and fac and lec != fac:
                bad2.append(d.at(fm_line(d, "lecturer")) + f"  (catalog faculty: {fac})")
        self.add("2.3", "Lecture front matter: unit is a syllabus unit and lecturer is the catalog faculty",
                 "FAIL" if bad2 else "PASS", bad2 or ev)

        skills = {s for c in cat.values() for s in c.get("skills", [])}
        roles = (D.json("role_profiles.json") or {}).get("roles", [])
        bad = [f"role_profiles.json {r['role']}: {s!r}" for r in roles
               for s in r.get("requiredSkills", []) + r.get("niceToHave", []) if s not in skills]
        unused = sorted(skills - {s for r in roles for s in r.get("requiredSkills", []) + r.get("niceToHave", [])})
        self.add("2.4", "Role-profile skill tags resolve to catalog skill tags", "FAIL" if bad else "PASS",
                 bad or [f"{len(skills)} catalog skills; role tags all resolve; catalog-only tags: {unused}"])

        role_names = {r["role"] for r in roles}
        bad = [f"{st['rel']}: careerGoal {st['profile'].get('careerGoal')!r}" for st in D.students().values()
               if st["profile"].get("careerGoal") not in role_names]
        self.add("2.5", "Every careerGoal is a role in role_profiles.json", "FAIL" if bad else "PASS",
                 bad or [f"goals {sorted(st['profile'].get('careerGoal') for st in D.students().values())}"])

        clubs = (D.json("clubs.json") or {}).get("clubs", [])
        slugs, names = {c["slug"] for c in clubs}, {c["name"] for c in clubs}
        ev_doc = D.doc("events.json")
        bad, warn = [], []
        for e in (D.json("events.json") or {}).get("events", []):
            if "clubSlug" in e and e["clubSlug"] not in slugs:
                bad.append(f"events.json {e['title']!r}: clubSlug {e['clubSlug']!r}")
            if "clubSlug" not in e:
                n = ev_doc.chain(rf'"title": "{re.escape(e["title"])}"', r'"organi[sz]er"') \
                    or ev_doc.find(rf'"title": "{re.escape(e["title"])}"')
                warn.append(ev_doc.at(n) + f"  (event {e['title']!r} has no clubSlug; organiser is a connectorId)")
        feed = D.doc("club_feed.md")
        for s in sections(feed) if feed else []:
            if s.heading not in names:
                bad.append(feed.at(s.start) + "  (heading is not a clubs.json name)")
        self.add("2.6", "Club slugs: events.clubSlug and club_feed headings resolve to clubs.json",
                 "FAIL" if bad else ("WARN" if warn else "PASS"),
                 bad + warn or [f"{len(slugs)} clubs; all event slugs and feed headings resolve"])

        conns = {c["id"]: c for c in (D.json("connectors.json") or [])}
        used: list[tuple[str, str, str]] = []      # (connectorId, file, kind)
        kind_of = {"handbook.md": "handbook", "catalog.json": "catalog", "exam_calendar.json": "exam_calendar",
                   "past_papers.json": "past_papers", "resources.json": "resources", "club_feed.md": "club_feed",
                   "events.json": "events", "role_profiles.json": "role_profiles", "clubs.json": "clubs",
                   "timetable.json": "timetable"}
        for rel, kind in kind_of.items():
            d = D.doc(rel)
            if not d:
                continue
            cid = front_matter(d)[0].get("connectorId") if rel.endswith(".md") else (D.json(rel) or {}).get("connectorId")
            used.append((cid, rel, kind))
        for rel in D.glob("circulars/*.md"):
            used.append((front_matter(D.doc(rel))[0].get("connectorId"), rel, "circular"))
        for rel in D.glob("syllabus/*.md"):
            used.append((front_matter(D.doc(rel))[0].get("connectorId"), rel, "syllabus"))
        for rel in D.glob("lectures/cs-*.md"):
            used.append((front_matter(D.doc(rel))[0].get("connectorId"), rel, "lectures"))
        for st in D.students().values():
            for key, kind in (("transcript", "transcript"), ("registrations", "registrations"),
                              ("marks", "internal_marks")):
                used.append((st[key].get("connectorId"), f"{st['rel']} {key}", kind))
        bad = [f"{w}: connectorId {c!r} not in connectors.json" for c, w, _ in used if c not in conns]
        undeclared = [f"{w}: connector {c!r} does not list {k!r} in provides {conns[c]['provides']}"
                      for c, w, k in used if c in conns and k not in conns[c].get("provides", [])
                      and not (k == "circular" and "circulars" in conns[c].get("provides", []))]
        self.add("2.7", "Every connectorId resolves to connectors.json", "FAIL" if bad else "PASS",
                 bad or [f"{len(used)} tagged sources → {sorted({c for c, _, _ in used})}"])
        self.add("2.8", "Each source's connector declares that kind in provides", "WARN" if undeclared else "PASS",
                 sorted(set(undeclared)) or ["all declared"])

        rules = D.rules()
        hb = D.doc("handbook.md")
        bad = []
        for bucket, listed in (("discipline_elective", rules["de_codes"]), ("open_elective", rules["oe_codes"])):
            in_cat = {c for c, v in cat.items() if v.get("bucket") == bucket}
            for c in sorted(set(listed) - in_cat):
                bad.append(f"handbook §4.1 lists {c} as {bucket}; catalog says {cat.get(c, {}).get('bucket')}")
            for c in sorted(in_cat - set(listed)):
                bad.append(f"catalog marks {c} {bucket}; handbook §4.1 does not list it")
        self.add("2.9", "handbook §4.1 bucket lists match catalog buckets", "FAIL" if bad else "PASS",
                 bad or [f"{len(rules['de_codes'])} discipline, {len(rules['oe_codes'])} open electives agree"])

        bad = []
        for c, pre in rules["prereqs"].items():
            if set(pre) != set(cat.get(c, {}).get("prereqs", [])):
                bad.append(hb.at(rules["prereq_rows"][c]) + f"  vs catalog {cat.get(c, {}).get('prereqs')}")
        self.add("2.10", "handbook §4.3 prerequisite table matches catalog prereqs", "FAIL" if bad else "PASS",
                 bad or [f"{len(rules['prereqs'])} rows agree with catalog"])

    # ---------------------------------------------------------------- 3 quotability
    def g3_quotability(self):
        D = self.D
        hb = D.doc("handbook.md")
        rules = D.rules()
        secs = rules["secs"]
        circ = {Path(d.rel).name[:7]: d for d, _ in D.circulars()}

        def rule(cid, title, doc, lines, *rxs):
            if doc is None:
                self.add(cid, title, "FAIL", ["document missing"])
                return
            prose, table = match_sentences(lines, *rxs)
            if len(prose) == 1:
                self.add(cid, title, "PASS", [doc.at(prose[0][0], prose[0][1])])
            elif table and not prose:
                self.add(cid, title, "FAIL", [doc.at(n, s) + "  (table row only)" for n, s in table])
            else:
                self.add(cid, title, "FAIL", [doc.at(n, s) for n, s in prose] or ["no sentence found"])

        sec = lambda k: secs[k].body if k in secs else []  # noqa: E731
        rule("3.1", "Total units (142) — one sentence with the number", hb, sec("3.1"), r"\b142\b", r"units")
        rule("3.2", "Core minimum — one sentence with the number", hb, sec("3.2"), r"Core requirement", r"\d+ units")
        rule("3.3", "Discipline-elective minimum (handbook) — one sentence", hb, sec("3.2"),
             r"Discipline Electives requirement", r"\d+ courses")
        c03 = circ.get("2026-03")
        rule("3.4", "Discipline-elective minimum (circular) — one sentence", c03, body_lines(c03) if c03 else [],
             r"Discipline Electives requirement", r"\d+ courses")
        rule("3.5", "Open-elective minimum — one sentence", hb, sec("3.2"), r"Open Electives requirement", r"\d+ courses")
        rule("3.6", "Humanities minimum — one sentence", hb, sec("3.2"), r"Humanities requirement", r"\d+ courses")
        rule("3.7", "Practice School / Thesis units — one sentence", hb, sec("3.2"), r"Practice School or Thesis requirement",
             r"\d+ units")
        rule("3.8", "Minimum CGPA — one sentence", hb, sec("3.2"), r"(?i)grade point average", r"\d+\.\d")
        rule("3.9", "Overload rule (25 units, CGPA 8.0) — one sentence", hb, sec("5.4"), r"above \d+ units",
             r"CGPA of at least \d")
        rule("3.10", "On-track pace (17 units/semester) — one sentence", hb, sec("6.1"), r"on track", r"\d+ units per")
        c09 = circ.get("2026-09")
        rule("3.11", "End-sem weight (40%) — one sentence in the circular", c09, body_lines(c09) if c09 else [],
             r"(?i)end-semester examination carries", r"\d+%")
        c08 = circ.get("2026-08")
        rule("3.12", "Semester 6 clash — one sentence naming both courses and the slot", c08,
             body_lines(c08) if c08 else [], r"CS F415", r"CS F407", r"\bT\d\b")

        # prerequisites: is there a prose sentence naming course and prerequisite together?
        ev, crit = [], False
        for c, pre in rules["prereqs"].items():
            for p in pre:
                prose, table = match_sentences(body_lines(hb), re.escape(c), re.escape(p),
                                               r"(?i)prerequisite|requires?|before|completed")
                if not prose:
                    ev.append(hb.at(rules["prereq_rows"][c]) + "  (table row only)")
                    crit |= (c, p) == ("CS F342", "CS F351")
        ev = sorted(set(ev), key=lambda s: int(s.split(":")[1]))
        self.add("3.13", "Prerequisites — each stated in a quotable prose sentence (not only a table cell)",
                 "FAIL" if ev else "PASS",
                 (["CS F342 ← CS F351 (the Rohan trap) exists only as a table row"] if crit else []) + ev
                 or ["every prerequisite has a prose sentence"])

        ev, bad = [], False
        for code, spec in LECTURES.items():
            rels = D.glob(f"lectures/{code.lower().replace(' ', '-')}-*.md")
            if not rels:
                continue
            d = D.doc(rels[0])
            n = next((n for n, line in body_lines(d) if spec["hint"] in line), None)
            whole = n is not None and any(s == spec["hint"] for _, s, _ in sentences([(n, d.lines[n - 1])]))
            bad |= not whole
            ev.append(d.at(n, spec["hint"]) if n else f"{d.rel}: hint not found")
        self.add("3.14", "Exam hints — each a single sentence on one line", "FAIL" if bad else "PASS", ev)

        prose, _ = match_sentences(sec("5.2"), r"A = \d+", r"F = \d+")
        prose2, _ = match_sentences(sec("5.2"), r"(?i)passing grade", r"or higher")
        self.add("3.15", "Grade scale and passing grade — one sentence each",
                 "PASS" if len(prose) == 1 and len(prose2) == 1 else "FAIL",
                 [hb.at(n, s) for n, s in prose + prose2])

    # ---------------------------------------------------------------- 4 arithmetic
    def student_stats(self, st, cat, rules) -> dict:
        pts = rules["points"]
        pass_min = pts.get(rules["pass_min"] or "D", 4)
        passing = {g for g, p in pts.items() if p >= pass_min}
        rows = st["transcript"]["rows"]
        att, earn_sem = Counter(), Counter()
        passed: dict[str, dict] = {}
        for r in rows:
            u = r.get("units", r.get("credits", 0))
            att[r["semester"]] += u
            if r["grade"] in passing:
                earn_sem[r["semester"]] += u
                passed.setdefault(r["courseCode"], r)
        latest: dict[str, dict] = {}
        for r in rows:
            if r["courseCode"] not in latest or r["semester"] >= latest[r["courseCode"]]["semester"]:
                latest[r["courseCode"]] = r
        earned_any = sum(r.get("units", 0) for r in passed.values())
        earned_latest = sum(r.get("units", 0) for r in latest.values() if r["grade"] in passing)
        graded = [r for r in rows if r["grade"] in pts]
        cg_all = sum(pts[r["grade"]] * r["units"] for r in graded) / max(1, sum(r["units"] for r in graded))
        lat = [r for r in latest.values() if r["grade"] in pts]
        cg_latest = sum(pts[r["grade"]] * r["units"] for r in lat) / max(1, sum(r["units"] for r in lat))
        completed = int(st["profile"].get("semester", 1)) - 1
        buckets = defaultdict(lambda: [0, 0])
        for c, r in passed.items():
            b = ("Discipline Electives" if c in rules["de_codes"] else "Open Electives" if c in rules["oe_codes"]
                 else {"core": "Core", "humanities": "Humanities", "practice_school": "Practice School or Thesis"}
                 .get(cat.get(c, {}).get("bucket"), f"? {cat.get(c, {}).get('bucket')}"))
            buckets[b][0] += 1
            buckets[b][1] += r.get("units", 0)
        return dict(att=dict(sorted(att.items())), earn_sem=dict(sorted(earn_sem.items())), earned=earned_any,
                    earned_latest=earned_latest, cg_all=cg_all, cg_latest=cg_latest, completed=completed,
                    pace=earned_any / completed if completed else 0,
                    pace_latest=earned_latest / completed if completed else 0,
                    buckets={k: tuple(v) for k, v in buckets.items()}, passed=passed, passing=passing)

    def g4_arithmetic(self):
        D = self.D
        cat, rules = D.catalog(), D.rules()
        studs = D.students()
        stats = {sid: self.student_stats(st, cat, rules) for sid, st in studs.items()}
        hb = D.doc("handbook.md")
        pace, over = rules["pace"], rules["overload"]

        ev = []
        for sid, s in stats.items():
            ev.append(f"{sid}: earned {s['earned']} units (latest-attempt rule: {s['earned_latest']}); "
                      f"CGPA {s['cg_all']:.2f} all attempts / {s['cg_latest']:.2f} latest attempt; "
                      f"attempted per sem {s['att']}; {s['completed']} completed sems → "
                      f"{s['pace']:.2f} units/sem; buckets {s['buckets']}")
        self.add("4.1", "Recomputed units, CGPA, per-semester load and buckets (from transcript rows)", "INFO", ev)

        readme = D.doc("README.md")
        if readme:
            claims = []
            for sid, s in stats.items():
                name = studs[sid]["profile"].get("name", sid).split()[0]
                n = readme.find(rf"\*\*{name}.*\d+ earned units")
                m = re.search(r"(\d+) earned units", readme.lines[n - 1]) if n else None
                if m:
                    claims.append((sid, int(m.group(1)), n))
            bad = [readme.at(n) + f"  → computed {stats[sid]['earned']}" for sid, v, n in claims
                   if v != stats[sid]["earned"]]
            self.add("4.2", "README's earned-unit figures match the recomputation", "FAIL" if bad else "PASS",
                     bad or [f"{sid}: README {v} = computed {stats[sid]['earned']}" for sid, v, _ in claims])

        if "aarav" in stats:
            de = stats["aarav"]["buckets"].get("Discipline Electives", (0, 0))
            codes = [c for c in stats["aarav"]["passed"] if c in rules["de_codes"]]
            self.add("4.3", "aarav has exactly 2 discipline electives (handbook §4.1 list)",
                     "PASS" if de[0] == 2 else "FAIL", [f"{studs['aarav']['rel']}: {codes} → {de[0]} courses, {de[1]} units"])

        def standing(sid):
            s = stats[sid]
            return ("on track" if s["pace"] >= pace else "at risk"), s
        pace_ev = hb.at(rules["secs"]["6.1"].body[0][0] if "6.1" in rules["secs"] else None,
                        f"...at least {pace} units per completed semester on average.") if hb else ""
        for cid, sid, want in (("4.4", "aarav", "on track"), ("4.5", "meera", "at risk")):
            if sid not in stats:
                continue
            got, s = standing(sid)
            also = f"; latest-attempt rule gives {s['pace_latest']:.2f} → " \
                   f"{'on track' if s['pace_latest'] >= pace else 'at risk'}" if s["earned_latest"] != s["earned"] else ""
            self.add(cid, f"{pace}-units/semester rule classifies {sid} {want}", "PASS" if got == want else "FAIL",
                     [f"{studs[sid]['rel']}: {s['earned']} earned / {s['completed']} completed semesters = "
                      f"{s['pace']:.2f} → {got}{also}", pace_ev])

        def need(b):
            n, u = rules["buckets"].get(b, (None, None))
            txt = f"{n} courses / {u} units" if n else f"{u} units"
            return txt + (" (circular: 5 courses / 20 units)" if b == "Discipline Electives" else "")
        ev = []
        for sid, s in stats.items():
            ev.append(f"{sid}: " + "; ".join(f"{b} {n} courses / {u} units (needs {need(b)})"
                                            for b, (n, u) in sorted(s["buckets"].items())))
        me_de = stats.get("meera", {}).get("buckets", {}).get("Discipline Electives", (0, 0))[0]
        self.add("4.6", "Bucket counts against handbook §3.2/§4.1 (Sem 5 registrations excluded)",
                 "WARN" if me_de >= 5 else "INFO",
                 ([f"meera ('at risk') has already completed {me_de} discipline electives — more than the "
                   f"circular's 5 and more than on-track aarav"] if me_de >= 5 else []) + ev)

        bad = []
        for sid, s in stats.items():
            for sem, u in s["att"].items():
                if over and u > over:
                    bad.append(f"{studs[sid]['rel']}: Sem {sem} carries {u} units (> {over} needs Associate Dean "
                               f"approval, handbook §5.4)")
        self.add("4.7", f"No transcript semester exceeds the {over}-unit overload threshold",
                 "FAIL" if bad else "PASS", bad or ["all semesters within limit"])

        bad = []
        for sid, st in studs.items():
            d = st["doc"]
            for r in st["transcript"]["rows"]:
                c = cat.get(r["courseCode"], {})
                if c.get("bucket") == "practice_school" and r["semester"] < min(c.get("offeredIn", [7])):
                    bad.append(d.at(d.chain(r'"transcript"', rf'"{r["courseCode"]}"'))
                               + f"  (Sem {r['semester']}; offered in {c.get('offeredIn')})")
        self.add("4.8", "Practice School / Thesis not completed before its offered semesters",
                 "FAIL" if bad else "PASS", bad or ["none early"])

        ev, total = [], 0
        for sid, st in studs.items():
            best = {}
            passing = stats[sid]["passing"]
            for r in st["transcript"]["rows"]:
                if r["grade"] in passing:
                    best[r["courseCode"]] = min(best.get(r["courseCode"], 99), r["semester"])
            viol = []
            for r in st["transcript"]["rows"]:
                if r["grade"] not in passing:
                    continue
                for p in cat.get(r["courseCode"], {}).get("prereqs", []):
                    if best.get(p, 99) >= r["semester"]:
                        when = f"Sem {best[p]}" if p in best else "never passed"
                        viol.append(f"{r['courseCode']} (Sem {r['semester']}) before {p} ({when})")
            total += len(viol)
            if viol:
                ev.append(f"{st['rel']}: {len(viol)} — " + "; ".join(viol[:6]) + (" …" if len(viol) > 6 else ""))
        self.add("4.9", "Transcripts respect catalog prerequisites (prereq passed in an earlier semester)",
                 "FAIL" if total else "PASS", ev or ["no violations"])

        ev, total = [], 0
        for sid, st in studs.items():
            off = [f"{r['courseCode']} S{r['semester']}∉{cat.get(r['courseCode'], {}).get('offeredIn')}"
                   for r in st["transcript"]["rows"] if r["semester"] not in cat.get(r["courseCode"], {}).get("offeredIn", [])]
            total += len(off)
            if off:
                ev.append(f"{st['rel']}: {len(off)}/{len(st['transcript']['rows'])} rows — " + ", ".join(off[:6]) + " …")
        self.add("4.10", "Transcript rows fall in the catalog's offeredIn semesters", "WARN" if total else "PASS",
                 ev or ["all rows in offered semesters"])

        bad = []
        for sid, st in studs.items():
            seen = defaultdict(list)
            for r in st["transcript"]["rows"]:
                seen[r["courseCode"]].append(r)
            for c, rs in seen.items():
                if len(rs) > 1:
                    rs = sorted(rs, key=lambda r: r["semester"])
                    pas = [r["grade"] in stats[sid]["passing"] for r in rs]
                    if any(pas[i] and not pas[j] for i in range(len(rs)) for j in range(i + 1, len(rs))):
                        d, end = st["doc"], st["doc"].find(r'"registrations"') or 10 ** 6
                        lines = [n for n in d.find_all(rf'"courseCode": "{re.escape(c)}"') if n < end]
                        bad.append(f"{st['rel']}:{','.join(map(str, lines))}: {c} "
                                   + " then ".join(f"{r['grade']} (Sem {r['semester']})" for r in rs)
                                   + " — retaken after passing, then failed")
        self.add("4.11", "Repeat attempts are coherent (no pass followed by a later failed retake)",
                 "FAIL" if bad else "PASS", bad or ["coherent"])

        core_units = sum(c.get("units", 0) for c in cat.values() if c.get("bucket") == "core")
        need = rules["buckets"].get("Core", (None, 0))[1]
        self.add("4.12", "Catalog offers enough Core units to meet the Core requirement",
                 "FAIL" if core_units < need else "PASS",
                 [f"catalog core courses total {core_units} units; handbook §3.2 Core requirement is {need}",
                  hb.at(hb.find(r"Core requirement is"), f"The Core requirement is {need} units.")])

        sems = {s: sum(c.get("units", 0) for c in cat.values() if min(c.get("offeredIn", [9])) == s) for s in range(1, 5)}
        cap = sum(sems.values())
        bench = (pace or 0) * 4
        self.add("4.13", "A nominal Sems 1–4 plan can reach the on-track benchmark (pace × 4)",
                 "FAIL" if cap < bench else "PASS",
                 [f"units first offered in Sems 1–4 = {sems} → {cap} total vs benchmark {bench} (handbook §6.1)",
                  "a student taking every course the catalog offers in Sems 1–4 is 'at risk'; the on-track "
                  "persona needs off-semester or extra courses" if cap < bench else None])

        bad = []
        cd = D.doc("catalog.json")
        for code, c in cat.items():
            for p in c.get("prereqs", []):
                pc = cat.get(p)
                if pc and not any(ps < cs for cs in c.get("offeredIn", []) for ps in pc.get("offeredIn", [])):
                    bad.append(cd.at(cd.chain(rf'"code": "{code}"', r'"offeredIn"'))
                               + f"  {code} offered {c.get('offeredIn')} requires {p} offered {pc.get('offeredIn')}")
        self.add("4.14", "Every catalog prerequisite is offered in an earlier semester than the course",
                 "FAIL" if bad else "PASS", bad or ["all schedulable"])

        bad, ev = [], []
        ppd = D.doc("past_papers.json")
        for p in D.papers() or []:
            tot = sum(p["marks"].values())
            declared = p["total"]
            ev.append(f"{p['course']} {p['year']}: {tot}")
            if tot != (declared or 100):
                n = ppd.chain(rf'"courseCode": "{re.escape(p["course"])}"', rf'"year": {p["year"]}')
                bad.append(ppd.at(n) + f"  {p['course']} {p['year']}: topic marks sum to {tot} (expected {declared or 100})")
        self.add("4.15", "Past-paper topic marks sum to the paper total", "FAIL" if bad else "PASS", bad or ev[:6])

        raw = D.json("exam_calendar.json") or {}
        bad, ok = [], 0
        for c in raw.get("courses", []) if isinstance(raw, dict) else []:
            w = c.get("weightages") or {}
            if w:
                ok += 1
                if sum(w.values()) != 100 or w.get("endSem") != 40:
                    bad.append(f"exam_calendar.json {c['courseCode']}: {w}")
        self.add("4.16", "Assessment weightages sum to 100 with end-sem 40% (circular 2026-09)",
                 "FAIL" if bad else ("PASS" if ok else "INFO"), bad or [f"{ok} courses: quizzes 20 + mid 40 + end 40"
                                                                        if ok else "no weightages in this shape"])

        tot = defaultdict(dict)
        names = defaultdict(set)
        for sid, st in studs.items():
            per = defaultdict(int)
            for r in st["marks"]["rows"]:
                per[(r["courseCode"], canon_component(r["component"]))] += r["max"]
                names[(r["courseCode"], canon_component(r["component"]))].add(r["component"])
            for k, v in per.items():
                tot[k][sid] = v
        bad = [f"{k[0]} {k[1]}: max marks per student {v}" for k, v in sorted(tot.items()) if len(set(v.values())) > 1]
        mixed = [f"{k[0]} {k[1]}: component spelled {sorted(v)}" for k, v in sorted(names.items()) if len(v) > 1]
        odd = []
        if mixed:
            for st in studs.values():
                n = st["doc"].find(r"topic total")
                if n:
                    odd.append(st["doc"].chain(r'"internalMarks"', r"topic total") and st["doc"].at(n))
        self.add("4.17", "The same assessment has the same maximum marks for every student",
                 "FAIL" if bad else "PASS", bad + mixed + odd or ["consistent"])

    # ---------------------------------------------------------------- 5 calendar
    def g5_calendar(self):
        D = self.D
        tt = D.timetable()
        studs = D.students()
        exams = D.exams() or []
        if tt is None:
            self.add("5.0", "timetable.json present", "FAIL", ["missing"])
            return

        bad = []
        for sid, st in studs.items():
            regs = {r["courseCode"] for r in st["registrations"]["rows"]}
            rows = [r for r in tt["rows"] if r["course"] in regs]
            for i, a in enumerate(rows):
                for b in rows[i + 1:]:
                    if a["day"] == b["day"] and hm(a["start"]) < hm(b["end"]) and hm(b["start"]) < hm(a["end"]):
                        bad.append(f"{sid}: {a['course']} {a['start']}-{a['end']} overlaps {b['course']} on {DAYS[a['day']]}")
            missing = regs - {r["course"] for r in tt["rows"]}
            bad += [f"{sid}: registered {c} has no timetable row" for c in sorted(missing)]
        self.add("5.1", "No Semester 5 timetable clashes for any student's registrations", "FAIL" if bad else "PASS",
                 bad or [f"{len(tt['rows'])} weekly sessions, no overlaps"])

        ends = [e for e in exams if e["component"] == "End-sem"]
        bad = [f"exam_calendar.json {e['course']} end-sem {e['date']}" for e in ends
               if not (date.fromisoformat(e["date"]) > TODAY and END_SEM[0] <= date.fromisoformat(e["date"]) <= END_SEM[1])]
        self.add("5.2", "Every end-sem date is after 2026-09-26 and inside 2026-11-30…2026-12-10",
                 "FAIL" if bad or not ends else "PASS",
                 bad or ([f"{e['course']} {e['date']} ({weekday_name(date.fromisoformat(e['date']))})" for e in ends]
                         if ends else ["no end-sem dates found"]))

        cal = {(e["course"], canon_component(e["component"])): e["date"] for e in exams}
        future, mism = [], defaultdict(list)
        for sid, st in studs.items():
            for r in st["marks"]["rows"]:
                key = (r["courseCode"], canon_component(r["component"]))
                when = cal.get(key)
                if when and date.fromisoformat(when) > TODAY:
                    future.append(f"{sid} {key[0]} {key[1]}: marked {r['date']} but exam_calendar has it on {when}")
                elif when and when != r["date"]:
                    mism[key[1]].append(f"{sid} {key[0]}: marks dated {r['date']}, calendar {when}")
        fut = sorted(set(future))
        ecd = D.doc("exam_calendar.json")
        first = next(iter(studs.values()), None)
        refs = []
        if fut and first:
            refs = [first["doc"].at(first["doc"].chain(r'"internalMarks"', r'"Quiz 2"')),
                    ecd.at(ecd.chain(r'"courseCode": "CS F212"', r'"quizDates"')) + " … "
                    + clip(ecd.lines[ecd.chain(r'"courseCode": "CS F212"', r'"quizDates"') + 1].strip())]
        self.add("5.3", "No marks for assessments the exam calendar places after today", "FAIL" if fut else "PASS",
                 (refs + [f"{len(fut)} (student, course) pairs; e.g."] + fut[:6]) if fut else ["none"])
        ev = []
        for comp, rows in sorted(mism.items()):
            u = sorted(set(rows))
            ev.append(f"{comp}: {len(u)} mismatched (student, course, date) — " + "; ".join(u[:4]) + " …")
        if ev and first:
            ev.insert(0, first["doc"].at(first["doc"].chain(r'"internalMarks"', r'"Quiz 1"', r'"date"'))
                      + "  vs " + ecd.at(ecd.chain(r'"courseCode": "CS F212"', r'"quizDates"') + 1))
        self.add("5.4", "Internal-mark dates match the exam calendar's date for that assessment",
                 "FAIL" if ev else "PASS", ev or ["all match"])

        bad, ok = [], []
        for rel in D.glob("lectures/cs-*.md"):
            d = D.doc(rel)
            meta = front_matter(d)[0]
            if not meta.get("date"):
                continue
            day = date.fromisoformat(meta["date"])
            meets = sorted({r["day"] for r in tt["rows"] if r["course"] == meta.get("courseCode")})
            names = [DAYS[i].title() for i in meets]
            line = d.at(fm_line(d, "date")) + f" ({weekday_name(day)}); {meta.get('courseCode')} meets {names}"
            (ok if day.weekday() in meets else bad).append(line)
        self.add("5.5", "Each lecture is dated on a day its course meets in timetable.json", "FAIL" if bad else "PASS",
                 bad or ok)

        after = date(2026, 9, 22)
        nxt = None
        for k in range(1, 15):
            dd = after + timedelta(days=k)
            rows = sorted((r for r in tt["rows"] if r["course"] == "CS F212" and r["day"] == dd.weekday()),
                          key=lambda r: hm(r["start"]))
            if rows:
                nxt = (dd, rows[0])
                break
        monday = after + timedelta(days=7 - after.weekday())
        nw = next(((monday + timedelta(days=k), r) for k in range(7) for r in tt["rows"]
                   if r["course"] == "CS F212" and r["day"] == (monday + timedelta(days=k)).weekday()), None)
        self.add("5.6", "The next CS F212 session after 2026-09-22 is resolvable from timetable.json",
                 "PASS" if nxt else "FAIL",
                 [f"next session: {nxt[0]} ({weekday_name(nxt[0])}) {nxt[1]['start']} {nxt[1]['kind']} in {nxt[1]['room']}"
                  if nxt else "none within two weeks",
                  f"'next week' → first session {nw[0]} ({weekday_name(nw[0])}) {nw[1]['start']}" if nw else None])

        wk = [f"exam_calendar.json {e['course']} {e['component']} {e['date']} is a {date.fromisoformat(e['date']):%A}"
              for e in exams if date.fromisoformat(e["date"]).weekday() == 6]
        self.add("5.7", "No assessments on Sundays", "WARN" if wk else "PASS", wk or ["none"])

        ids = "session ids present" if any(r["id"] for r in tt["rows"]) else "no session ids (the loader synthesises them)"
        self.add("5.8", "timetable.json carries term dates (needed to bound weekly rows into CalendarItems)",
                 "PASS" if tt["term"] else "WARN",
                 [f"term {tt['term']}; {ids}" if tt["term"] else
                  f"timetable.json: no term; weekly rows cannot be bounded to the semester; {ids}"])

        evs = (D.json("events.json") or {}).get("events", [])
        clash = [f"events.json {e['title']} {e['date']}" for e in evs
                 if END_SEM[0] <= date.fromisoformat(e["date"]) <= END_SEM[1]]
        past = [f"events.json {e['title']} {e['date']}" for e in evs if date.fromisoformat(e["date"]) <= TODAY]
        self.add("5.9", "Events are in the future and avoid the end-sem window", "WARN" if clash or past else "PASS",
                 clash + past or [f"{len(evs)} events {min(e['date'] for e in evs)} … {max(e['date'] for e in evs)}"])

        cat = D.catalog()
        by_slot = defaultdict(list)
        for c in cat.values():
            if 6 in c.get("offeredIn", []):
                by_slot[c.get("slot")].append(c["code"])
        coll = [f"catalog.json Sem 6 slot {s}: {v}" for s, v in sorted(by_slot.items()) if len(v) > 1]
        other = [c for c in coll if not ("CS F415" in c and "CS F407" in c and c.count("CS F") == 2)]
        self.add("5.10", "Semester 6 catalog slots: the only collision is the planted one", "WARN" if other else "PASS",
                 other + (["(the planted clash moves CS F415 to T2 via circular; by catalog it collides with "
                           "CS F330 instead)"] if any("CS F415" in x and "CS F330" in x for x in other) else [])
                 or coll or ["no collisions"])

    # ---------------------------------------------------------------- 6 realism (evidence for judgement)
    def g6_realism(self):
        D = self.D
        cat = D.catalog()
        tmpl = lambda c, s: s.replace(c["title"], "{title}")  # noqa: E731
        blurbs = Counter(tmpl(c, f["blurb"]) for c in cat.values() for f in c.get("feedback", []))
        shared = {k for k, v in blurbs.items() if v >= 5}
        total = sum(blurbs.values())
        in_tmpl = sum(v for k, v in blurbs.items() if k in shared)
        de_t = sorted(c["code"] for c in cat.values() if c.get("bucket") == "discipline_elective"
                      and any(tmpl(c, f["blurb"]) in shared for f in c.get("feedback", [])))
        cd = D.doc("catalog.json")
        self.add("6.1", "Catalog feedback blurbs are course-specific (Course Planner reads them as quality signal)",
                 "FAIL" if in_tmpl / max(1, total) > 0.5 else "PASS",
                 [f"{in_tmpl}/{total} blurbs come from {len(shared)} templates shared by ≥5 courses: "
                  + "; ".join(f"{v}× \"{k}\"" for k, v in blurbs.most_common(len(shared))),
                  f"templated discipline electives: {de_t}",
                  cd.at(cd.find(r"Clear structure and useful examples in Mathematics I"))])
        desc = Counter(c.get("description", "").lower().replace(c["title"].lower(), "{title}") for c in cat.values())
        top, cnt = desc.most_common(1)[0]
        n = cd.find(r"mathematics i with applied")
        self.add("6.2", "Catalog descriptions are course-specific", "FAIL" if cnt / len(cat) > 0.5 else "PASS",
                 [f"{cnt}/{len(cat)} descriptions are \"{top}\"",
                  cd.at(n) + "  (lower-cased roman numeral on screen)" if n else None])

        tmpl, plural, tot = 0, [], 0
        for code, s in D.syllabi().items():
            d = s["doc"]
            for n, line in body_lines(d):
                if line.strip() and not line.startswith("#"):
                    tot += 1
                    if TEMPLATE_SYLLABUS.search(line.strip()):
                        tmpl += 1
                        m = re.match(r"^(.+?) is treated", line.strip())
                        if m and re.search(r"[^s]s$", m.group(1)) and not m.group(1).endswith("CFLs"):
                            plural.append(d.at(n, m.group(0)))
        self.add("6.3", "Syllabus topic descriptions are real content", "FAIL" if tot and tmpl / tot > 0.5 else "PASS",
                 [f"{tmpl}/{tot} syllabus body lines are the same template sentence",
                  f"{len(plural)} read as plural-subject + 'is' on screen, e.g."] + plural[:3])

        ev, robin = [], False
        orders = {}
        for sid, st in D.students().items():
            sems = [r["semester"] for r in st["transcript"]["rows"]]
            k = sum(1 for i, s in enumerate(sems) if s == (i % 4) + 1)
            robin |= bool(sems) and k / len(sems) >= 0.9 and sems != sorted(sems)
            orders[sid] = [r["courseCode"] for r in st["transcript"]["rows"]][:10]
            grades = [r["grade"] for r in st["transcript"]["rows"]]
            runs = max((sum(1 for _ in g) for _, g in __import__("itertools").groupby(grades)), default=0)
            ev.append(f"{st['rel']}: semesters follow 1,2,3,4,1,2… for {k}/{len(sems)} rows; "
                      f"longest run of one grade = {runs}")
        same = len({tuple(v) for v in orders.values()}) == 1 and len(orders) > 1
        if same:
            ev.append(f"all {len(orders)} transcripts list the same first 10 courses in the same order: "
                      f"{orders[next(iter(orders))]}" + ("" if robin else " (normal for a shared core curriculum)"))
        self.add("6.4", "Transcripts look like individual histories (not a round-robin generator)",
                 "FAIL" if robin else "PASS", ev)

        rowsets = {sid: {(r["courseCode"], r["component"], r.get("topic"), r["scored"], r["max"], r["date"])
                         for r in st["marks"]["rows"]} for sid, st in D.students().items()}
        ids = list(rowsets)
        ev, worst = [], 0.0
        for i, a in enumerate(ids):
            for b in ids[i + 1:]:
                share = len(rowsets[a] & rowsets[b]) / max(1, min(len(rowsets[a]), len(rowsets[b])))
                worst = max(worst, share)
                ev.append(f"{a} vs {b}: {len(rowsets[a] & rowsets[b])} identical rows "
                          f"({100 * share:.0f}% of the smaller set)")
        self.add("6.5", "Internal marks differ between students", "FAIL" if worst > 0.8 else "PASS", ev)

        hb = D.doc("handbook.md")
        hb_eff = front_matter(hb)[0].get("effectiveDate", "9999")
        ana = []
        for n, s, _ in sentences(body_lines(hb)):
            for mon, yr in re.findall(r"(?i)\b(" + "|".join(MONTHS) + r") (20\d\d)\b", s):
                if f"{yr}-{MONTHS.index(mon.lower()) + 1:02d}" > hb_eff[:7]:
                    ana.append(hb.at(n, s) + f"  (handbook effective {hb_eff})")
        self.add("6.6", "Handbook does not cite documents issued after its own effectiveDate",
                 "FAIL" if ana else "PASS", ana or ["none"])

        nums = [s.number for s in sections(hb) if s.number and "." in s.number]
        gaps = []
        for major in sorted({x.split(".")[0] for x in nums}, key=int):
            minors = sorted(int(x.split(".")[1]) for x in nums if x.split(".")[0] == major)
            gaps += [f"{major}.{i}" for i in range(1, max(minors)) if i not in minors]
        self.add("6.7", "Handbook section numbering has no gaps", "WARN" if gaps else "PASS",
                 [f"present: {nums}; missing: {gaps} (AGENTS.md/contracts.ts example id handbook.4.2 does not exist)"]
                 if gaps else ["contiguous"])

        hits = []
        for rel in ("club_feed.md", "events.json", "resources.json", "catalog.json"):
            d = D.doc(rel)
            if not d:
                continue
            for n in d.find_all(r"(?i)\b(fictional|synthetic)\b"):
                if not re.search(r'"note"\s*:', d.lines[n - 1]):
                    hits.append(d.at(n))
        self.add("6.8", "Content text does not announce itself as fictional (disclosure belongs in metadata)",
                 "WARN" if hits else "PASS", hits or ["none"])

        mism = []
        for d, m in D.circulars():
            fn = re.search(r"sem(\d)", Path(d.rel).name)
            tt = re.search(r"Semester (\d)", m.get("title", ""))
            if fn and tt and fn.group(1) != tt.group(1):
                mism.append(f"{d.rel} (filename says sem{fn.group(1)}) vs " + d.at(fm_line(d, "title")))
        self.add("6.9", "Circular filenames agree with their titles", "WARN" if mism else "PASS", mism or ["agree"])

    # ---------------------------------------------------------------- 7 contract fit
    def g7_contract(self):
        D = self.D
        studs = D.students()
        bad = []
        for sid, st in studs.items():
            miss = STUDENT_KEYS - set(st["profile"])
            if miss:
                bad.append(f"{st['rel']}: Student missing {sorted(miss)}")
        self.add("7.1", "students/*.json carry the Student fields (id, name, program, semester, careerGoal, interests)",
                 "FAIL" if bad else "PASS", bad or [f"{len(studs)} students"])

        bad, units = [], 0
        for sid, st in studs.items():
            for r in st["transcript"]["rows"]:
                ks = set(r)
                if "credits" in ks:
                    bad.append(f"{st['rel']}: transcript row {r['courseCode']} uses 'credits'")
                extra = ks - TRANSCRIPT_KEYS - {"bucket"}
                miss = TRANSCRIPT_KEYS - ks
                if extra or miss:
                    bad.append(f"{st['rel']}: {r['courseCode']} extra {sorted(extra)} missing {sorted(miss)}")
                units += "units" in ks
        cat = D.catalog()
        for c in cat.values():
            if "credits" in c:
                bad.append(f"catalog.json {c['code']}: uses 'credits'")
            miss = CATALOG_KEYS - set(c)
            if miss:
                bad.append(f"catalog.json {c['code']}: missing {sorted(miss)}")
            if not 2 <= len(c.get("feedback", [])) <= 3:
                bad.append(f"catalog.json {c['code']}: {len(c.get('feedback', []))} feedback blurbs (spec 2–3)")
        self.add("7.2", "Transcript rows and catalog use 'units' (not 'credits') with the agreed fields",
                 "FAIL" if bad else "PASS",
                 sorted(set(bad))[:12] or [f"{units} transcript rows and {len(cat)} catalog courses use units"])
        ct = (REPO / "contracts.ts")
        if ct.exists():
            lines = ct.read_text(encoding="utf-8").splitlines()
            hits = [f"contracts.ts:{i}: {clip(l.strip())}" for i, l in enumerate(lines, 1) if re.search(r"\bcredits:", l)]
            ag = (REPO / "AGENTS.md")
            ag_hits = [f"AGENTS.md:{i}: {clip(l.strip(), 120)}" for i, l in
                       enumerate(ag.read_text(encoding="utf-8").splitlines(), 1)
                       if "catalog.json" in l and "credits" in l] if ag.exists() else []
            self.add("7.3", "contracts.ts / AGENTS.md agree with the data on 'units'", "WARN" if hits or ag_hits else "PASS",
                     hits + ag_hits + (["the data follows the checklist ('units'); contracts.ts still says credits, and "
                                        "backend/app/core/records.py passes rows through unmapped"] if hits else [])
                     or ["agree"])

        bad = []
        for sid, st in studs.items():
            for r in st["marks"]["rows"]:
                miss = MARK_KEYS - set(r)
                if miss or not ISO_DATE.match(str(r.get("date", ""))):
                    bad.append(f"{st['rel']}: mark row {r} missing {sorted(miss)} or non-ISO date")
            for r in st["registrations"]["rows"]:
                if REG_KEYS - set(r) or r.get("status") not in REG_STATUS:
                    bad.append(f"{st['rel']}: registration {r} not a RegistrationRow")
        self.add("7.4", "InternalMarkRow / RegistrationRow fields, ISO dates and status enum",
                 "FAIL" if bad else "PASS", bad[:8] or ["all rows conform"])

        bad = []
        for sid, st in studs.items():
            if st["planned_key"]:
                d = st["doc"]
                bad.append(d.at(d.find(rf'"{st["planned_key"]}"'))
                           + f"  status {sorted({r.get('status') for r in st['planned']})} — not in StudentRecords, "
                             f"and RegistrationRow.status is only {sorted(REG_STATUS)}")
        self.add("7.5", "No record data outside the StudentRecords contract", "FAIL" if bad else "PASS",
                 bad or ["none"])

        tt = D.timetable()
        if tt:
            nonstd = sorted({r["day"] for r in tt["rows"] if r["day"] is None})
            self.add("7.6", "timetable.json: parseable weekdays/times; ISO datetimes derivable", "WARN" if not tt["term"] else "PASS",
                     [f"{len(tt['rows'])} rows with weekday + HH:MM; no contract type exists for timetable.json; "
                      f"{'no term dates, so CalendarItem.start (ISO datetime) needs an assumed range' if not tt['term'] else 'term present'}"]
                     + ([f"unparseable days {nonstd}"] if nonstd else []))

        exams = D.exams() or []
        bad = [f"{e['course']} {e['component']} {e['date']}" for e in exams if not ISO_DATE.match(str(e["date"]))]
        noid = [e for e in exams if not e["id"]]
        self.add("7.7", "exam_calendar.json: ISO dates and an id per exam (CalendarItem.source.examId)",
                 "FAIL" if bad else ("WARN" if noid else "PASS"),
                 bad or [f"{len(exams)} assessments, ISO dates; {len(noid)} without an id" +
                         ("; the file is per-course (midSemDate/endSemDate/quizDates), not per-exam" if noid else "")])

        conns = D.json("connectors.json") or []
        bad, badprov = [], []
        cdoc = D.doc("connectors.json")
        for c in conns:
            if c.get("kind") not in CONNECTOR_KINDS or c.get("status") not in CONNECTOR_STATUS:
                bad.append(f"connectors.json {c.get('id')}: kind {c.get('kind')} status {c.get('status')}")
            for p in c.get("provides", []):
                if p not in DOCUMENT_KINDS | RECORD_KINDS:
                    badprov.append(cdoc.at(cdoc.chain(rf'"id": "{c["id"]}"', rf'"{p}"')) + f"  ({c['id']})")
        self.add("7.8", "connectors.json: kind/status enums", "FAIL" if bad else "PASS", bad or [f"{len(conns)} connectors, all synthetic"])
        self.add("7.9", "connectors.json: every provides value is a DocumentKind or StudentRecordKind",
                 "FAIL" if badprov else "PASS", badprov or ["all valid"])

        res = (D.json("resources.json") or {}).get("resources", [])
        bad = [f"resources.json {r.get('name')}: kind {r.get('kind')}" for r in res if r.get("kind") not in RESOURCE_KINDS]
        self.add("7.10", "resources.json kinds are Resource.kind values", "FAIL" if bad else "PASS",
                 bad or [f"{len(res)} resources ({dict(Counter(r['kind'] for r in res))})"])

        bad, n = [], 0
        date_keys = re.compile(r"(?i)^(date|effectiveDate|midSemDate|endSemDate|registrationDeadline|lastSyncAt)$")

        def walk(obj, where):
            nonlocal n
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if date_keys.match(k) and isinstance(v, str):
                        n += 1
                        if not ISO_DATE.match(v[:10]) or (len(v) > 10 and v[10] != "T"):
                            bad.append(f"{where}: {k}={v!r}")
                    elif k == "quizDates":
                        for q in v:
                            n += 1
                            if not ISO_DATE.match(q):
                                bad.append(f"{where}: quizDates {q!r}")
                    else:
                        walk(v, where)
            elif isinstance(obj, list):
                for v in obj:
                    walk(v, where)
        for rel in D.glob("**/*.json"):
            walk(D.json(rel), rel)
        for rel in D.glob("**/*.md"):
            meta = front_matter(D.doc(rel))[0]
            for k in ("effectiveDate", "date"):
                if k in meta:
                    n += 1
                    if not ISO_DATE.match(meta[k]):
                        bad.append(f"{rel}: {k}={meta[k]!r}")
        self.add("7.11", "Every date field is ISO 8601", "FAIL" if bad else "PASS", bad or [f"{n} date values"])

        extra = []
        if D.glob("lectures/cs-*.md"):
            extra.append("lectures/*.md — AGENTS.md §4.1 puts 'lectures' in the Academic Coach scope; "
                         "DocumentKind has no 'lecture'")
        if D.has("timetable.json"):
            extra.append("timetable.json — no DocumentKind / type in contracts.ts")
        if D.has("clubs.json"):
            extra.append("clubs.json — no DocumentKind (club agents scope over club_feed)")
        self.add("7.12", "Every source file has a contract home (DocumentKind or record type)", "WARN" if extra else "PASS",
                 extra or ["all mapped"])

    # ---------------------------------------------------------------- 8 backend probe
    def g8_backend_probe(self):
        sys.path.insert(0, str(REPO / "backend"))
        try:
            import app.core.academics as ac
            import app.core.records as rec
            import app.core.syllabus as syl
        except Exception as exc:
            self.add("8.0", "backend loaders importable", "WARN",
                     [f"{type(exc).__name__}: {exc} — run with backend/.venv/bin/python"])
            return
        for m in (syl, ac, rec):
            m.DATA_DIR = self.D.root
        for name in ("load_syllabus", "timetable", "exams", "past_papers", "_raw"):
            for m in (syl, ac, rec):
                f = getattr(m, name, None)
                if hasattr(f, "cache_clear"):
                    f.cache_clear()

        def probe(cid, title, fn, ok):
            try:
                out = fn()
                verdict = ok(out)
                status = verdict if isinstance(verdict, str) else ("PASS" if verdict else "FAIL")
                self.add(cid, title, status, [clip(repr(out), 300)])
            except Exception as exc:
                self.add(cid, title, "FAIL", [f"{type(exc).__name__}: {exc}"])

        def exact_weight(w):  # an umbrella fallback ("part of <unit>") is not the topic's own marks
            return "FAIL" if w is None else ("WARN" if str(w.fact).startswith("part of") else "PASS")

        lec = datetime(2026, 9, 22, 9, 0, tzinfo=ac.TZ)
        probe("8.1", "academics.exams() reads exam_calendar.json", lambda: len(ac.exams()), lambda n: n > 0)
        probe("8.2", "academics.next_exam(CS F212, end) resolves", lambda: ac.next_exam("CS F212", lec, component="end"),
              lambda e: e is not None)
        probe("8.3", "academics.past_papers() reads past_papers.json", lambda: len(ac.past_papers()), lambda n: n > 0)
        for i, (code, spec) in enumerate(LECTURES.items(), 4):
            probe(f"8.{i}", f"academics.topic_weight({code}, {spec['skipped']!r}) is the topic's own marks",
                  lambda code=code, spec=spec: ac.topic_weight(code, spec["skipped"]), exact_weight)
        probe("8.7", "academics.next_session(CS F212) after the lecture",
              lambda: (lambda s: s and (s.start.isoformat(), s.kind))(ac.next_session("CS F212", lec)), bool)
        probe("8.8", "syllabus.load_syllabus(CS F212) finds 'Two-phase locking'",
              lambda: [t.id for t in syl.load_syllabus("CS F212").topics if t.title == "Two-phase locking"], bool)
        probe("8.9", "records.load_records(rohan) exposes planned Sem 6 courses",
              lambda: sorted(k for k in rec.load_records("rohan")), lambda ks: any("plan" in k.lower() for k in ks))


# ------------------------------------------------------------------ output

ORDER = {"FAIL": 0, "WARN": 1, "PASS": 2, "INFO": 3}
GROUPS = {"0": "Inventory", "1": "Demo traps", "2": "Referential integrity", "3": "Quotability",
          "4": "Arithmetic", "5": "Calendar sanity", "6": "Realism (evidence for judgement)",
          "7": "Contract fit", "8": "Backend loader probe", "g": "Crashed group"}


def render_text(results: list[Result]) -> str:
    out, last = [], None
    for r in results:
        g = r.cid.split(".")[0]
        if g != last:
            out.append(f"\n== {g} {GROUPS.get(g[:1], '')}")
            last = g
        out.append(f"[{r.status}] {r.cid} {r.title}")
        out += [f"        {e}" for e in r.evidence]
    return "\n".join(out)


def render_md(results: list[Result]) -> str:
    esc = lambda s: s.replace("|", "\\|")  # noqa: E731
    out, last = [], None
    for r in results:
        g = r.cid.split(".")[0]
        if g != last:
            out += ["", f"#### {g} {GROUPS.get(g[:1], '')}", "", "| Check | Result | Evidence |", "|---|---|---|"]
            last = g
        code = lambda e: f"`` {esc(e)} ``" if "`" in e else f"`{esc(e)}`"  # noqa: E731
        ev = "<br>".join(code(e) if re.match(r"^[\w/.\-]+:\d+:", e) else esc(e) for e in r.evidence) or "—"
        out.append(f"| {r.cid} {esc(r.title)} | **{r.status}** | {ev} |")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=str(REPO / "backend" / "app" / "data"))
    ap.add_argument("--format", choices=("text", "md"), default="text")
    ap.add_argument("--probe-backend", action="store_true")
    args = ap.parse_args()
    root = Path(args.data_dir).resolve()
    if not root.is_dir():
        print(f"no such directory: {root}", file=sys.stderr)
        return 2
    audit = Audit(Data(root))
    audit.run(args.probe_backend)
    counts = Counter(r.status for r in audit.results)
    head = f"Dataset audit: {root}\n" + ", ".join(f"{k} {counts.get(k, 0)}" for k in ORDER)
    if not (root / "handbook.md").exists() and (REPO / "backend_dataset" / "app" / "data" / "handbook.md").exists():
        head += "\nnote: this directory has no handbook.md; the generated dataset is at backend_dataset/app/data"
    print(head)
    print(render_md(audit.results) if args.format == "md" else render_text(audit.results))
    return 1 if counts.get("FAIL") else 0


if __name__ == "__main__":
    sys.exit(main())
