"""Timetable, exam calendar and past papers: loaders plus the date/marks arithmetic.

LLM reads, code counts: every date a lecturer implies ("next lecture", "Friday") and
every marks figure an action cites is computed here from the synthetic dataset.
If the data isn't there, the answer is None, never a guess.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from typing import Any

from app.core.config import DATA_DIR, TZ
from app.core.syllabus import course_slug, load_syllabus

DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _load(name: str) -> Any:
    path = DATA_DIR / name
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def same_course(a: str | None, b: str | None) -> bool:
    return bool(a) and bool(b) and course_slug(a) == course_slug(b)


def norm_topic(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").casefold()).strip()


def _day_index(value: str) -> int | None:
    v = (value or "").strip().lower()[:3]
    return DAYS.index(v) if v in DAYS else None


def _hm(value: str) -> time:
    h, m = (value or "00:00").split(":")[:2]
    return time(int(h), int(m))


def iso(dt: datetime) -> str:
    return dt.astimezone(TZ).isoformat(timespec="seconds")


@lru_cache(maxsize=1)
def _catalog_titles() -> dict[str, str]:
    data = _load("catalog.json") or {}
    rows = data.get("courses", []) if isinstance(data, dict) else data
    return {course_slug(r.get("code") or r.get("courseCode") or ""): r.get("title", "")
            for r in rows if r.get("title")}


def course_title(course_code: str) -> str | None:
    return _catalog_titles().get(course_slug(course_code)) or None


def canonical_course_code(course_code: str) -> str:
    """"cs-f212" / "CS  F212" → "CS F212" as the catalog or timetable writes it; else as given."""
    slug = course_slug(course_code or "")
    data = _load("catalog.json") or {}
    rows = data.get("courses", []) if isinstance(data, dict) else data
    known = [r.get("code") or r.get("courseCode") for r in rows] + [r.get("courseCode") for r in _rows()]
    return next((c for c in known if c and course_slug(c) == slug), " ".join((course_code or "").split()))


# ---- timetable -------------------------------------------------------------------

@dataclass
class Session:
    id: str
    course_code: str
    title: str
    kind: str
    start: datetime
    end: datetime
    room: str | None


@lru_cache(maxsize=1)
def timetable() -> dict[str, Any]:
    return _load("timetable.json") or {}


def _rows() -> list[dict[str, Any]]:
    data = timetable()
    return data.get("sessions") or data.get("classes") or data.get("rows") or []


def _term() -> tuple[date | None, date | None]:
    term = timetable().get("term") or {}
    start = date.fromisoformat(term["start"]) if term.get("start") else None
    end = date.fromisoformat(term["end"]) if term.get("end") else None
    return start, end


def sessions_between(start: datetime, end: datetime, courses: set[str] | None = None) -> list[Session]:
    """Every timetable occurrence starting in [start, end)."""
    term_start, term_end = _term()
    out: list[Session] = []
    day = start.astimezone(TZ).date()
    last = end.astimezone(TZ).date()
    while day <= last:
        if (term_start and day < term_start) or (term_end and day > term_end):
            day += timedelta(days=1)
            continue
        for row in _rows():
            if _day_index(row.get("day", "")) != day.weekday():
                continue
            code = row.get("courseCode", "")
            if courses is not None and course_slug(code) not in courses:
                continue
            s = datetime.combine(day, _hm(row.get("start", "09:00")), TZ)
            e = datetime.combine(day, _hm(row.get("end", row.get("start", "09:00"))), TZ)
            if e <= s:
                e = s + timedelta(minutes=50)
            if start <= s < end:
                kind = (row.get("kind") or "lecture").lower()
                out.append(Session(id=row.get("id") or f"{course_slug(code)}-{kind}-{DAYS[day.weekday()]}-{s:%H%M}",
                                   course_code=code, title=row.get("title") or course_title(code) or code,
                                   kind=kind, start=s, end=e, room=row.get("room")))
        day += timedelta(days=1)
    return sorted(out, key=lambda x: x.start)


def next_session(course_code: str, after: datetime, *, lecture_only: bool = True) -> Session | None:
    """First session of the course strictly after ``after`` (within 8 weeks)."""
    found = [s for s in sessions_between(after + timedelta(minutes=1), after + timedelta(weeks=8))
             if same_course(s.course_code, course_code)]
    if lecture_only and any(s.kind == "lecture" for s in found):
        found = [s for s in found if s.kind == "lecture"]
    return found[0] if found else None


def lecture_start(course_code: str, day: date) -> datetime:
    """The scheduled start of this course on ``day``, else the start of that day."""
    for s in sessions_between(datetime.combine(day, time(0, 0), TZ), datetime.combine(day, time(23, 59), TZ)):
        if same_course(s.course_code, course_code):
            return s.start
    return datetime.combine(day, time(0, 0), TZ)


# ---- exam calendar -------------------------------------------------------------------

@dataclass
class Exam:
    id: str
    course_code: str
    kind: str          # exam | quiz
    component: str     # "Mid-sem", "End-sem", "Quiz 2"
    title: str
    start: datetime
    end: datetime | None
    all_day: bool = False  # the generated calendar has dates only; never invent a time


def due_iso(e: Exam) -> str:
    return e.start.date().isoformat() if e.all_day else iso(e.start)


def _per_course_exams(courses: list[dict[str, Any]]) -> list[Exam]:
    """{courses: [{courseCode, midSemDate, endSemDate, quizDates: [...]}]} → all-day Exams."""
    out: list[Exam] = []
    for c in courses:
        code, slug = c.get("courseCode", ""), course_slug(c.get("courseCode", ""))
        dated = [(f"{slug}-quiz{n}", "quiz", f"Quiz {n}", d) for n, d in enumerate(c.get("quizDates") or [], 1)]
        if c.get("midSemDate"):
            dated.append((f"{slug}-midsem", "exam", "Mid-sem", c["midSemDate"]))
        if c.get("endSemDate"):
            dated.append((f"{slug}-endsem", "exam", "End-sem", c["endSemDate"]))
        for exam_id, kind, component, d in dated:
            title = f"{code} {component}" + (" exam" if kind == "exam" else "")
            out.append(Exam(id=exam_id, course_code=code, kind=kind, component=component, title=title,
                            start=datetime.combine(date.fromisoformat(d[:10]), time(0, 0), TZ), end=None,
                            all_day=True))
    return out


@lru_cache(maxsize=1)
def exams() -> list[Exam]:
    data = _load("exam_calendar.json") or {}
    if isinstance(data, dict) and isinstance(data.get("courses"), list):
        return sorted(_per_course_exams(data["courses"]), key=lambda e: e.start)
    rows = data.get("exams") if isinstance(data, dict) else data
    out: list[Exam] = []
    for row in rows or []:
        if not row.get("date"):
            continue
        d = date.fromisoformat(row["date"][:10])
        start = datetime.combine(d, _hm(row.get("start", "09:00")), TZ)
        end = datetime.combine(d, _hm(row["end"]), TZ) if row.get("end") else None
        component = row.get("component") or row.get("title") or ""
        kind = (row.get("kind") or ("quiz" if "quiz" in component.lower() else "exam")).lower()
        out.append(Exam(id=row.get("id") or f"{course_slug(row.get('courseCode', ''))}-{row['date']}",
                        course_code=row.get("courseCode", ""), kind="quiz" if kind == "quiz" else "exam",
                        component=component, title=row.get("title") or component, start=start, end=end))
    return sorted(out, key=lambda e: e.start)


def next_exam(course_code: str, after: datetime, *, component: str | None = None) -> Exam | None:
    """Next exam/quiz of the course after ``after``; ``component`` narrows it
    ('mid', 'end', 'quiz', 'compre')."""
    for e in exams():
        if not same_course(e.course_code, course_code) or e.start <= after:
            continue
        if component:
            c = component.lower()
            label = f"{e.component} {e.title}".lower()
            if c.startswith("end") or "compre" in c:
                if not ("end" in label or "compre" in label):
                    continue
            elif c.startswith("mid"):
                if "mid" not in label:
                    continue
            elif "quiz" in c:
                if e.kind != "quiz":
                    continue
        return e
    return None


# ---- past papers ------------------------------------------------------------------

@lru_cache(maxsize=1)
def past_papers() -> list[dict[str, Any]]:
    data = _load("past_papers.json") or {}
    if isinstance(data, list):
        return data
    if "papers" in data:
        return data["papers"]
    courses = data.get("courses") or []
    if isinstance(courses, dict):  # {"CS F212": {"papers": [...]}}
        courses = [{"courseCode": code, **c} for code, c in courses.items()]
    papers: list[dict[str, Any]] = []
    for course in courses:
        for p in course.get("papers", []):
            topics = p.get("topics") or [{"topic": t, "marks": m} for t, m in (p.get("topicMarks") or {}).items()]
            # the generated dataset holds end-sem papers only (its README says so)
            papers.append({"courseCode": course.get("courseCode"), "exam": p.get("exam", "End-sem"),
                           "year": p.get("year"), "topics": topics})
    return papers


@dataclass
class TopicWeight:
    fact: str                 # "carried 14–18 marks in the last 3 end-sems (2023–2025)"
    citation_id: str          # past_papers.<course>.<topic>
    max_marks: int


def topic_weight(course_code: str, topic: str) -> TopicWeight | None:
    """Marks this topic carried in the course's last three end-sem papers, from past_papers.json.

    Papers are sometimes set at unit level ("Transactions and concurrency") while the
    syllabus lists finer topics ("Two-phase locking"). Then the fact names the unit topic
    the marks belong to, e.g. "part of Transactions and concurrency, which carried ...".
    """
    exact = _weight(course_code, topic)
    if exact:
        return exact
    syl = load_syllabus(course_code)
    unit = next((u for u in syl.units if any(norm_topic(t.title) == norm_topic(topic) for t in u.topics)),
                None) if syl else None
    if unit is None:
        return None
    umbrella = re.sub(r"^\s*unit\s+\d+\s*[:.\-–]\s*", "", unit.title, flags=re.I).strip()
    w = _weight(course_code, umbrella) if norm_topic(umbrella) != norm_topic(topic) else None
    if w is None:
        return None
    return TopicWeight(fact=f"part of {umbrella}, which {w.fact}", citation_id=w.citation_id, max_marks=w.max_marks)


def _weight(course_code: str, topic: str) -> TopicWeight | None:
    key = norm_topic(topic)
    ends = [p for p in past_papers()
            if same_course(p.get("courseCode"), course_code)
            and re.search(r"end|compre", str(p.get("exam", "")), re.I)]
    ends = sorted(ends, key=lambda p: p.get("year", 0))[-3:]
    if not ends:
        return None
    marks: list[tuple[int, int]] = []  # (year, marks) where the topic appeared
    for p in ends:
        for t in p.get("topics", []):
            if norm_topic(t.get("topic", "")) == key:
                marks.append((p.get("year", 0), int(t.get("marks", 0))))
    if not marks:
        return None
    values = [m for _, m in marks]
    lo, hi = min(values), max(values)
    span = f"{lo}" if lo == hi else f"{lo}–{hi}"
    years = [p.get("year") for p in ends]
    yr = f"{years[0]}–{years[-1]}" if len(years) > 1 else f"{years[0]}"
    if len(marks) == len(ends):
        fact = f"carried {span} marks in each of the last {len(ends)} end-sems ({yr})"
    else:
        fact = f"appeared in {len(marks)} of the last {len(ends)} end-sems ({yr}), for {span} marks"
    return TopicWeight(fact=fact, citation_id=f"past_papers.{course_slug(course_code)}.{key.replace(' ', '-')}",
                       max_marks=hi)


# ---- relative dates said in a lecture ------------------------------------------------

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]


def resolve_when(when: dict[str, Any], course_code: str, lecture_at: datetime, quote: str,
                 context: str = "") -> tuple[str | None, str]:
    """Turn a model-extracted time expression into an ISO date/datetime.

    Returns (dueBy or None, how). The expression must be visible in the quote (or,
    for "next lecture", in the same transcript segment: "...next lecture we start
    deadlocks. Before that, read 18.2"); otherwise dueBy stays empty.
    """
    kind = (when or {}).get("type") or "none"
    q = quote.lower()
    if kind == "next_lecture":
        if not re.search(r"\bnext\b|\btomorrow\b|\bfollowing\b", q) and \
                not re.search(r"\bnext (lecture|class|session|time)\b", context.lower()):
            return None, "neither quote nor segment says 'next lecture'; left empty"
        s = next_session(course_code, lecture_at)
        return (iso(s.start), f"next {course_code} session in timetable ({s.start:%a %d %b %H:%M})") if s else \
            (None, "no later session in timetable")
    if kind == "next_week":
        if "next week" not in q:
            return None, "quote does not say 'next week'; left empty"
        monday = (lecture_at + timedelta(days=7 - lecture_at.weekday())).replace(hour=0, minute=0)
        s = next_session(course_code, monday - timedelta(minutes=2), lecture_only=False)
        return (iso(s.start), f"first {course_code} session next week ({s.start:%a %d %b})") if s else \
            (None, "no session next week in timetable")
    if kind == "date":
        month, day = when.get("month"), when.get("day")
        try:
            month, day = int(month), int(day)
        except (TypeError, ValueError):
            return None, "date parts missing; left empty"
        if not (1 <= month <= 12) or (MONTHS[month - 1][:3] not in q and f"{month}/" not in q) or \
                not re.search(rf"\b{day}(st|nd|rd|th)?\b", q):
            return None, "date not visible in quote; left empty"
        for year in (lecture_at.year, lecture_at.year + 1):
            try:
                d = date(year, month, day)
            except ValueError:
                return None, "invalid date; left empty"
            if d >= lecture_at.date():
                return d.isoformat(), f"date said in lecture ({d:%a %d %b %Y})"
        return None, "date is in the past; left empty"
    if kind == "weekday":
        idx = _day_index(str(when.get("weekday", "")))
        if idx is None or DAYS[idx] not in q:
            return None, "weekday not visible in quote; left empty"
        delta = (idx - lecture_at.weekday()) % 7 or 7
        d = (lecture_at + timedelta(days=delta)).date()
        return d.isoformat(), f"next {DAYS[idx].title()} after the lecture ({d:%d %b})"
    if kind == "exam":
        if not re.search(r"exam|end-?sem|mid-?sem|quiz|compre|test|paper", q):
            return None, "no exam named in quote; left empty"
        comp = str(when.get("exam") or "")
        e = next_exam(course_code, lecture_at, component=comp or None)
        if not e:
            return None, "no matching exam in exam calendar"
        return due_iso(e), f"{e.title} in exam calendar ({e.start:%d %b})"
    return None, "no time expression"
