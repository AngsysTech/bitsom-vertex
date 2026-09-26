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
from app.core.syllabus import course_slug

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
                out.append(Session(id=row.get("id") or f"{course_slug(code)}-{row.get('day')}",
                                   course_code=code, title=row.get("title") or code,
                                   kind=(row.get("kind") or "lecture").lower(), start=s, end=e,
                                   room=row.get("room")))
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


@lru_cache(maxsize=1)
def exams() -> list[Exam]:
    data = _load("exam_calendar.json") or {}
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
    papers: list[dict[str, Any]] = []  # {"courses": {"CS F212": {"papers": [...]}}}
    for code, course in (data.get("courses") or {}).items():
        for p in course.get("papers", []):
            papers.append({"courseCode": code, **p})
    return papers


@dataclass
class TopicWeight:
    fact: str                 # "carried 14–18 marks in the last 3 end-sems (2023–2025)"
    citation_id: str          # past_papers.<course>.<topic>
    max_marks: int


def topic_weight(course_code: str, topic: str) -> TopicWeight | None:
    """Marks this topic carried in the course's last three end-sem papers, from past_papers.json."""
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
        return iso(e.start), f"{e.title} in exam calendar ({e.start:%d %b})"
    return None, "no time expression"
