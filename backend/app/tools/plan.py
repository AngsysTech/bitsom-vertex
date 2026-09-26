"""build_study_plan (Academic Coach, AGENTS.md §4.1): one LLM allocation + code placement.

1. diagnose (code): weak topics with impact, score, marks range and syllabus section.
2. allocate (LLM, prompts/plan_allocate.md): per week, {course, topic, minutes, why,
   syllabusSectionId}. Week labels and (course, topic, section) triples are closed choices,
   verified; anything else is dropped and counted in the trace.
3. place (code): 25/50-minute blocks after the student's last class of the day, never over
   a class, quiz or exam (exam-calendar dates without a time block the whole day), every
   block for a course before that course's end-sem, at most 120 study minutes a day
   including accepted-action blocks, spread across the week.
4. persist: PlanBlocks into StudentState.plan and one CalendarItem per block with source
   {type: "plan_block"}. A rebuild replaces only this module's own future blocks: accepted-
   action blocks (class companion) are never touched, and past blocks stay on the calendar
   with their done/missed status as history.

Numbers in a block's ``why`` come from code (marks, weights); the model contributes a
short clause with no digits. Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import re
import threading
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from typing import Any, Optional

from pydantic import BaseModel, Field

from app.core import clock, db, llm
from app.core.academics import Exam, exams, iso, same_course, sessions_between
from app.core.citations import CitationSet
from app.core.config import PROMPTS_DIR, TZ
from app.core.models import CalendarItem, StudyPlanCard
from app.core.parser import course_label, exam_section_id, fmt_day, section, syllabus_section_id
from app.core.records import load_student, registered_courses
from app.core.state import get_state, plan_week_monday, save_state, week_label
from app.core.syllabus import course_slug
from app.core.verify import normalize_ws
from app.tools import diagnose as dx
from app.tools.base import Stopwatch, ToolResult, trace

TOOL = "build_study_plan"
AGENT_ID = "academic_coach"
DAILY_CAP = 120
BLOCK_MIN = 25
AFTER_CLASS = timedelta(minutes=30)
FREE_DAY_START = time(10, 0)
DAY_END = time(22, 0)
GAP = timedelta(minutes=10)
STEP = timedelta(minutes=15)
MAX_CANDIDATES = 10
MIN_IMPACT = 10

_locks: dict[str, threading.Lock] = defaultdict(threading.Lock)


@lru_cache(maxsize=1)
def _system_prompt() -> str:
    return (PROMPTS_DIR / "plan_allocate.md").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------------
# model output
# ---------------------------------------------------------------------------------

class _Alloc(BaseModel):
    course: str
    topic: str
    minutes: int
    why: str = ""
    syllabusSectionId: str


class _Week(BaseModel):
    label: str
    items: list[_Alloc] = Field(default_factory=list)


class _Allocation(BaseModel):
    weeks: list[_Week] = Field(default_factory=list)


# ---------------------------------------------------------------------------------
# inputs
# ---------------------------------------------------------------------------------

@dataclass
class Candidate:
    key: str
    course: str
    topic: str
    section_id: str
    impact: int
    facts: list[str]
    end_sem: date | None
    carry_minutes: int = 0
    carry_note: str = ""
    action_id: str | None = None


@dataclass
class Context:
    now: datetime
    intervals: list[tuple[datetime, datetime]]          # classes, timed exams, action blocks
    blocked_days: dict[date, list[str]]                  # all-day exams/quizzes
    used: dict[date, int]                                # minutes already committed (action blocks)
    last_class_end: dict[date, datetime]
    exams: list[Exam]


@dataclass
class WeekInfo:
    label: str
    monday: date
    days: list[date]
    capacity: int
    exams: list[Exam]


@dataclass
class Placed:
    cand: Candidate
    minutes: int
    why: str
    start: datetime
    end: datetime
    block_id: str = field(default_factory=lambda: f"pb_{uuid.uuid4().hex[:10]}")


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    if len(value) == 10:
        return datetime.combine(date.fromisoformat(value), time(0, 0), TZ)
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=TZ)


def _ceil(dt: datetime) -> datetime:
    dt = dt.astimezone(TZ).replace(second=0, microsecond=0)
    extra = dt.minute % 15
    return dt + timedelta(minutes=15 - extra) if extra else dt


def _student_exams(student_id: str) -> list[Exam]:
    courses = registered_courses(student_id)
    return [e for e in exams() if courses is None or course_slug(e.course_code) in courses]


def end_sems(student_id: str) -> dict[str, date]:
    out: dict[str, date] = {}
    for e in _student_exams(student_id):
        if re.search(r"end|compre", f"{e.component} {e.title}", re.I):
            out[course_slug(e.course_code)] = e.start.date()
    return out


def _action_blocks(student_id: str) -> dict[str, dict[str, Any]]:
    """planBlockId → action, for accepted class-companion actions."""
    return {a["planBlockId"]: a for a in db.find("action", student_id=student_id)
            if a.get("planBlockId") and a.get("status") == "accepted"}


def _context(student_id: str, now: datetime, until: date) -> Context:
    courses = registered_courses(student_id)
    start = datetime.combine(now.date(), time(0, 0), TZ)
    end = datetime.combine(until + timedelta(days=1), time(0, 0), TZ)
    intervals: list[tuple[datetime, datetime]] = []
    last_end: dict[date, datetime] = {}
    for s in sessions_between(start, end, courses):
        intervals.append((s.start, s.end))
        d = s.start.date()
        last_end[d] = max(last_end.get(d, s.end), s.end)
    blocked: dict[date, list[str]] = defaultdict(list)
    student_exams = _student_exams(student_id)
    for e in student_exams:
        if e.all_day or e.end is None:
            blocked[e.start.date()].append(e.title)
        else:
            intervals.append((e.start, e.end))
    used: dict[date, int] = defaultdict(int)
    action_ids = set(_action_blocks(student_id))
    for pid in action_ids:  # the work slot of every accepted action (timed or deadline)
        slot = db.get("block_slot", pid)
        if slot:
            s, e = _parse(slot["start"]), _parse(slot["end"])
            intervals.append((s, e))
            used[s.date()] += int((e - s).total_seconds() // 60)
    for item in db.find("calendar_item", student_id=student_id):
        src = item.get("source") or {}
        if src.get("type") == "action" and not item.get("allDay") and item.get("end"):
            intervals.append((_parse(item["start"]), _parse(item["end"])))
    return Context(now=now, intervals=intervals, blocked_days=dict(blocked), used=dict(used),
                   last_class_end=last_end, exams=student_exams)


def _window(ctx: Context, day: date) -> tuple[datetime, datetime] | None:
    last = ctx.last_class_end.get(day)
    start = last + AFTER_CLASS if last else datetime.combine(day, FREE_DAY_START, TZ)
    if day == ctx.now.date():
        start = max(start, ctx.now + timedelta(minutes=15))
    start = _ceil(start)
    end = datetime.combine(day, DAY_END, TZ)
    return (start, end) if start < end else None


def _free_minutes(ctx: Context, day: date) -> int:
    win = _window(ctx, day)
    if win is None or day in ctx.blocked_days:
        return 0
    s, e = win
    busy = sorted((max(a, s), min(b, e)) for a, b in ctx.intervals if a < e and b > s)
    free, cursor = 0, s
    for a, b in busy:
        if a > cursor:
            free += int((a - cursor).total_seconds() // 60)
        cursor = max(cursor, b)
    free += max(0, int((e - cursor).total_seconds() // 60))
    return free


def _weeks(ctx: Context, last_day: date) -> list[WeekInfo]:
    out: list[WeekInfo] = []
    monday = monday_of(ctx.now.date())
    while monday <= last_day:
        days = [monday + timedelta(days=i) for i in range(7)]
        days = [d for d in days if ctx.now.date() <= d <= last_day]
        cap = 0
        for d in days:
            room = min(DAILY_CAP - ctx.used.get(d, 0), _free_minutes(ctx, d))
            cap += max(0, room) // BLOCK_MIN * BLOCK_MIN
        wk_exams = [e for e in ctx.exams if monday <= e.start.date() < monday + timedelta(days=7)]
        out.append(WeekInfo(label=week_label(monday), monday=monday, days=days, capacity=cap, exams=wk_exams))
        monday += timedelta(days=7)
    return out


def _unplaced_actions(student_id: str, state_plan: dict[str, Any]) -> list[dict[str, Any]]:
    in_plan = {b.get("id") for w in state_plan.get("weeks", []) for b in w.get("blocks", [])}
    return [a for a in db.find("action", student_id=student_id)
            if a.get("status") == "accepted" and (not a.get("planBlockId") or a["planBlockId"] not in in_plan)]


def _candidates(student_id: str, stats: list[dx.TopicStat], carry: list[dict[str, Any]],
                actions: list[dict[str, Any]], ends: dict[str, date]) -> tuple[list[Candidate], list[str]]:
    notes: list[str] = []
    cands: list[Candidate] = []
    by_key: dict[tuple[str, str], Candidate] = {}
    ranked = [s for s in stats if s.impact >= MIN_IMPACT][:MAX_CANDIDATES]
    carry_keys = {(course_slug(c["course"]), c["topic"]) for c in carry}
    ranked += [s for s in stats if (course_slug(s.course), s.topic) in carry_keys and s not in ranked]
    for s in ranked:
        if not s.section_id:
            notes.append(f"{s.course} {s.topic}: no syllabus section; not plannable")
            continue
        c = Candidate(key=f"T{len(cands) + 1}", course=s.course, topic=s.topic, section_id=s.section_id,
                      impact=s.impact, facts=[s.marks_fact(), s.weight_fact()],
                      end_sem=ends.get(course_slug(s.course)))
        cands.append(c)
        by_key[(course_slug(s.course), s.topic)] = c
    for item in carry:
        c = by_key.get((course_slug(item["course"]), item["topic"]))
        if c is None:  # e.g. a missed class-companion action: any syllabus topic can be carried over
            sec = syllabus_section_id(item["course"], item["topic"])
            if not sec:
                notes.append(f"carry-over {item['course']} {item['topic']} has no syllabus section; not planned")
                continue
            w = dx.exact_weight(item["course"], item["topic"])
            c = Candidate(key=f"C{len(cands) + 1}", course=item["course"], topic=item["topic"], section_id=sec,
                          impact=0, facts=[w] if w else [], end_sem=ends.get(course_slug(item["course"])))
            cands.append(c)
            by_key[(course_slug(item["course"]), item["topic"])] = c
        c.carry_minutes += int(item.get("minutes", 0))
        c.carry_note = f"carried over: missed {', '.join(item.get('missedOn') or [])}".rstrip(": ")
    for a in actions:
        sec = (a.get("provenance") or {}).get("syllabusSectionId")
        if not sec or not section(sec):
            notes.append(f"accepted action '{a.get('title', '')[:40]}' has no syllabus section; not planned")
            continue
        due = _parse(a.get("dueBy"))
        c = Candidate(key=f"A{len(cands) + 1}", course=a.get("course", ""), topic=a.get("topic", ""),
                      section_id=sec, impact=0, facts=[a.get("why", "")],
                      end_sem=min(filter(None, [due.date() if due else None, ends.get(course_slug(a.get("course", "")))]),
                                  default=None),
                      action_id=a.get("id"))
        cands.append(c)
    return cands, notes


# ---------------------------------------------------------------------------------
# allocate (LLM)
# ---------------------------------------------------------------------------------

def _exam_line(e: Exam) -> str:
    return f"{e.course_code} {e.component} ({fmt_day(e.start.date())})"


def _prompt(student: dict[str, Any], ctx: Context, weeks: list[WeekInfo], cands: list[Candidate],
            ends: dict[str, date], extra: dict[str, Any]) -> str:
    lines = [f"Student: {student.get('name')} ({student.get('program')}, semester {student.get('semester')}), "
             f"career goal: {student.get('careerGoal')}.",
             f"Now: {ctx.now:%a %d %b %Y %H:%M}. Daily cap: {DAILY_CAP} study minutes. Blocks are 25 or 50 minutes.",
             "", "WEEKS (closed list of labels):"]
    for w in weeks:
        span = f"{fmt_day(w.days[0])} – {fmt_day(w.days[-1])}" if w.days else "no usable days"
        ex = "; ".join(_exam_line(e) for e in w.exams) or "none"
        lines.append(f"- {w.label} | {span} | capacity {w.capacity} min | assessments: {ex}")
    lines += ["", "END-SEMS (nothing for a course on or after its end-sem):"]
    for slug, d in sorted(ends.items(), key=lambda kv: kv[1]):
        code = next((c.course for c in cands if course_slug(c.course) == slug), slug.upper().replace("-", " "))
        lines.append(f"- {course_label(code)}: {fmt_day(d)}")
    lines += ["", "TOPICS (closed list; copy course, topic and syllabusSectionId exactly):"]
    for c in cands:
        row = f"- {c.course} | {c.topic} | {c.section_id} | impact {c.impact} | {'; '.join(c.facts)}"
        if c.action_id:
            row += " | accepted class-companion action, schedule it once before its due date"
        lines.append(row)
    carry = [c for c in cands if c.carry_minutes]
    if carry:
        lines += ["", "CARRY-OVER (missed last week; put each in the FIRST week with at least these minutes):"]
        lines += [f"- {c.course} | {c.topic} | {c.section_id} | {c.carry_minutes} min | {c.carry_note}" for c in carry]
    if extra.get("answers"):
        lines += ["", "1:1 ANSWERS (the student's own words):"]
        lines += [f"- Q: {a['prompt']} A: {a['answer']}" for a in extra["answers"]]
    if extra.get("adjustments"):
        lines += ["", "1:1 AGREED ADJUSTMENTS:"]
        lines += [f"- {a.get('change')}: {a.get('detail')}" for a in extra["adjustments"]]
    return "\n".join(lines)


def _clause(text: str) -> str:
    """The model's reason, minus any part that states a number (numbers come from code)."""
    clause = normalize_ws(text).rstrip(".;:, ")
    parts = [p.strip() for p in re.split(r"[,;]", clause) if p.strip() and not re.search(r"\d", p)]
    return ", ".join(parts)[:110]


def _split(minutes: int) -> list[int]:
    fifties, rest = divmod(minutes, 50)
    return [50] * fifties + ([25] if rest >= 25 else [])


def _verify(out: _Allocation, weeks: list[WeekInfo], cands: list[Candidate]) -> tuple[dict[str, list], list[str]]:
    labels = {w.label: w for w in weeks}
    by_sec = {c.section_id: c for c in cands}
    allocs: dict[str, list[tuple[Candidate, int, str]]] = defaultdict(list)
    notes: list[str] = []
    bad_label = bad_id = after_exam = 0
    for wk in out.weeks:
        w = labels.get(wk.label.strip())
        if w is None:
            bad_label += 1
            continue
        for it in wk.items:
            c = by_sec.get(it.syllabusSectionId.strip())
            if c is None or not same_course(c.course, it.course) or dx.norm_topic(c.topic) != dx.norm_topic(it.topic):
                bad_id += 1
                continue
            usable = [d for d in w.days if c.end_sem is None or d < c.end_sem]
            if not usable:
                after_exam += 1
                continue
            minutes = max(BLOCK_MIN, min(300, int(round(it.minutes / BLOCK_MIN)) * BLOCK_MIN))
            existing = next((i for i, a in enumerate(allocs[w.label]) if a[0] is c), None)
            if existing is not None:
                cand, mins, why = allocs[w.label][existing]
                allocs[w.label][existing] = (cand, mins + minutes, why)
            else:
                allocs[w.label].append((c, minutes, _clause(it.why)))
    if bad_label:
        notes.append(f"{bad_label} week(s) with an unknown label dropped")
    if bad_id:
        notes.append(f"{bad_id} item(s) whose course/topic/syllabusSectionId did not verify dropped")
    if after_exam:
        notes.append(f"{after_exam} item(s) dated on/after that course's end-sem dropped")
    # carry-over is binding: it goes into the first week that has room
    first = next((w for w in weeks if w.capacity > 0), None)
    for c in cands:
        if not c.carry_minutes or first is None:
            continue
        have = sum(m for cand, m, _ in allocs[first.label] if cand is c)
        if have < c.carry_minutes:
            deficit = c.carry_minutes - have
            idx = next((i for i, a in enumerate(allocs[first.label]) if a[0] is c), None)
            if idx is None:
                allocs[first.label].insert(0, (c, deficit, "carry-over from last week"))
            else:
                cand, mins, why = allocs[first.label][idx]
                allocs[first.label][idx] = (cand, mins + deficit, why)
            notes.append(f"carry-over {c.topic}: model gave {have}/{c.carry_minutes} min in {first.label}; "
                         f"code added {deficit} min")
    for label in allocs:  # carry-over first, then highest impact
        allocs[label].sort(key=lambda a: (-(a[0].carry_minutes > 0), -a[0].impact))
    return allocs, notes


# ---------------------------------------------------------------------------------
# place (code)
# ---------------------------------------------------------------------------------

def _fits(s: datetime, e: datetime, taken: list[tuple[datetime, datetime]]) -> bool:
    return all(e + GAP <= a or s >= b + GAP for a, b in taken)


def _first_fit(ctx: Context, day: date, minutes: int, taken: list[tuple[datetime, datetime]]) -> tuple | None:
    win = _window(ctx, day)
    if win is None:
        return None
    length = timedelta(minutes=minutes)
    t, stop = win
    while t + length <= stop:
        if _fits(t, t + length, taken):
            return t, t + length
        t += STEP
    return None


def _place(ctx: Context, weeks: list[WeekInfo], allocs: dict[str, list]) -> tuple[list[Placed], list[str]]:
    taken = list(ctx.intervals)
    used = defaultdict(int, ctx.used)
    placed: list[Placed] = []
    unplaced: list[str] = []
    spill: list[tuple[Candidate, int, str]] = []  # carry-over that didn't fit its week moves on
    for w in weeks:
        queue: list[tuple[Candidate, int, str]] = []
        lanes = [[(c, m, why) for m in _split(mins)] for c, mins, why in allocs.get(w.label, [])]
        queue += spill
        spill = []
        while any(lanes):
            for lane in lanes:
                if lane:
                    queue.append(lane.pop(0))
        for cand, minutes, why in queue:
            days = [d for d in w.days if d not in ctx.blocked_days and (cand.end_sem is None or d < cand.end_sem)]
            days.sort(key=lambda d: (used[d], d))
            slot = None
            for d in days:
                if used[d] + minutes > DAILY_CAP:
                    continue
                slot = _first_fit(ctx, d, minutes, taken)
                if slot:
                    break
            if slot is None:
                if cand.carry_minutes:
                    spill.append((cand, minutes, why))
                else:
                    unplaced.append(f"{cand.topic} {minutes} min in {w.label}")
                continue
            taken.append(slot)
            used[slot[0].date()] += minutes
            placed.append(Placed(cand=cand, minutes=minutes, why=why, start=slot[0], end=slot[1]))
    unplaced += [f"{c.topic} {m} min (carry-over, no room before the horizon ends)" for c, m, _ in spill]
    return placed, unplaced


# ---------------------------------------------------------------------------------
# persist
# ---------------------------------------------------------------------------------

def _why(p: Placed) -> str:
    facts = list(p.cand.facts)
    if p.cand.carry_note:
        facts.insert(0, p.cand.carry_note)
    return "; ".join([x for x in [p.why] if x] + facts)


def _exam_note(ctx: Context, monday: date) -> str | None:
    wk = [e for e in ctx.exams if monday <= e.start.date() < monday + timedelta(days=7)]
    return "; ".join(_exam_line(e) for e in wk) or None


def my_items(student_id: str) -> list[dict[str, Any]]:
    return [i for i in db.find("calendar_item", student_id=student_id)
            if (i.get("source") or {}).get("type") == "plan_block"]


def _persist(student_id: str, ctx: Context, placed: list[Placed]) -> tuple[dict[str, Any], list[str], int, int]:
    now = ctx.now
    mine = {b["id"] for b in db.find("plan_block", student_id=student_id)}
    removed = kept_past = 0
    for item in my_items(student_id):
        if _parse(item["start"]) >= now:
            db.delete("calendar_item", item["id"])
            db.delete("calendar_status", item["id"])
            db.delete("plan_block", item["source"]["planBlockId"])
            removed += 1
        else:
            kept_past += 1
    new_ids = []
    for p in placed:
        block = {"id": p.block_id, "course": p.cand.course, "topic": p.cand.topic, "minutes": p.minutes,
                 "why": _why(p), "citationId": p.cand.section_id}
        db.put("plan_block", p.block_id, {**block, "start": iso(p.start), "end": iso(p.end),
                                          **({"actionId": p.cand.action_id} if p.cand.action_id else {})},
               student_id=student_id)
        item = CalendarItem(id=f"plan:{p.block_id}", studentId=student_id, kind="study_block",
                            title=f"Study: {p.cand.topic}", courseCode=p.cand.course, start=iso(p.start),
                            end=iso(p.end), source={"type": "plan_block", "planBlockId": p.block_id},
                            status="planned")
        db.put("calendar_item", item.id, item.dump(), student_id=student_id, parent_id=p.block_id)
        new_ids.append(item.id)

    state = get_state(student_id)
    old = state.get("plan") or {"type": "study_plan", "weeks": []}
    weeks: dict[str, dict[str, Any]] = {}
    order: dict[str, datetime] = {}
    for w in old.get("weeks", []):  # blocks this module didn't create (e.g. accepted actions) stay as they are
        for b in w.get("blocks", []):
            if b.get("id") in mine:
                continue
            wk = weeks.setdefault(w["label"], {"label": w["label"], "blocks": []})
            wk["blocks"].append(b)
            slot = db.get("block_slot", b.get("id", ""))
            order[b["id"]] = _parse(slot["start"]) if slot else datetime.max.replace(tzinfo=TZ)
    for p in placed:
        label = week_label(monday_of(p.start.date()))
        wk = weeks.setdefault(label, {"label": label, "blocks": []})
        wk["blocks"].append({"id": p.block_id, "course": p.cand.course, "topic": p.cand.topic,
                             "minutes": p.minutes, "why": _why(p), "citationId": p.cand.section_id})
        order[p.block_id] = p.start
    for label, wk in weeks.items():
        wk["blocks"].sort(key=lambda b: order.get(b["id"], datetime.max.replace(tzinfo=TZ)))
        monday = plan_week_monday(label)
        note = _exam_note(ctx, monday) if monday else None
        if note:
            wk["examNote"] = note
    ordered = sorted(weeks.values(), key=lambda w: plan_week_monday(w["label"]) or date.max)
    card = StudyPlanCard.model_validate({"type": "study_plan", "weeks": ordered}).dump()
    state["plan"] = card
    save_state(state)
    return card, new_ids, removed, kept_past


# ---------------------------------------------------------------------------------
# entry points
# ---------------------------------------------------------------------------------

def build_plan(student_id: str, *, extra: dict[str, Any] | None = None) -> ToolResult:
    """Rebuild the plan from now to the last end-sem. ``extra`` (from the weekly 1:1):
    {"carryOver": [{course, topic, minutes, missedOn}], "answers": [{prompt, answer}],
     "adjustments": [{change, detail, blockId?}]}."""
    student = load_student(student_id)
    if student is None:
        raise LookupError(f"student {student_id} not found")
    extra = extra or {}
    with _locks[student_id]:
        diag = dx.diagnose(student_id)
        result = ToolResult(trace=list(diag.trace))
        now = clock.now(student_id)
        ends = end_sems(student_id)
        future_ends = [d for d in ends.values() if d > now.date()]
        if not future_ends:
            result.error = "no end-sem dates after today in exam_calendar.json"
            result.trace.append(trace(TOOL, "nothing to plan: no upcoming end-sem", 0, error=result.error))
            return result
        last_day = max(future_ends) - timedelta(days=1)
        with Stopwatch() as sw_in:
            ctx = _context(student_id, now, last_day)
            weeks = _weeks(ctx, last_day)
            state = get_state(student_id)
            actions = _unplaced_actions(student_id, state.get("plan") or {})
            cands, cand_notes = _candidates(student_id, diag.data["stats"], extra.get("carryOver") or [],
                                            actions, ends)
        if not cands:
            result.error = "no weak topics with marks and past-paper weight, and no accepted actions to place"
            result.trace.append(trace(TOOL, "nothing to plan", sw_in.ms, error=result.error))
            return result
        prompt = _prompt(student, ctx, weeks, cands, ends, extra)
        with Stopwatch() as sw_llm:
            try:
                out = llm.json(prompt, _Allocation, system=_system_prompt(), max_tokens=12000)
            except llm.LLMError as exc:
                result.error = f"allocation failed: {exc}"
                result.trace.append(trace(f"{TOOL}.allocate", "model call failed; plan not changed",
                                          sw_in.ms, error=result.error))
                return result
        allocs, notes = _verify(out, weeks, cands)
        alloc_min = sum(m for items in allocs.values() for _, m, _ in items)
        result.trace.append(trace(
            f"{TOOL}.allocate",
            f"{len(cands)} closed-choice topics × {len(weeks)} weeks ({weeks[0].label} → {weeks[-1].label}, "
            f"capacity {sum(w.capacity for w in weeks)} min); model allocated {alloc_min} min in "
            f"{sum(len(v) for v in allocs.values())} verified items" + (f"; {'; '.join(notes + cand_notes)}"
                                                                        if notes or cand_notes else ""),
            sw_in.ms + sw_llm.ms))
        if not allocs:
            result.error = "model allocation had no verifiable items"
            result.trace[-1].error = result.error
            return result
        with Stopwatch() as sw_place:
            placed, unplaced = _place(ctx, weeks, allocs)
            card, new_ids, removed, kept_past = _persist(student_id, ctx, placed)
            db.put("plan_meta", student_id, {
                "studentId": student_id, "builtAt": iso(now),
                "horizonEnd": last_day.isoformat(), "blockIds": [p.block_id for p in placed],
                "impacts": [{"course": s.course, "topic": s.topic, "impact": s.impact, "score": s.score}
                            for s in diag.data["stats"]],
                "carryOver": extra.get("carryOver") or [], "answers": extra.get("answers") or [],
            }, student_id=student_id)
        three_weeks = sum(1 for p in placed if p.start < now + timedelta(days=21))
        summary = (f"placed {len(placed)} blocks ({sum(p.minutes for p in placed)} min; {three_weeks} in the next "
                   f"3 weeks) after the last class of each day, none over a class, quiz or exam, each course "
                   f"before its end-sem, ≤{DAILY_CAP} min/day incl. accepted actions; replaced {removed} future "
                   f"blocks, kept {kept_past} past blocks as history")
        result.trace.append(trace(f"{TOOL}.place", summary + (f"; could not place: {'; '.join(unplaced[:5])}"
                                                               if unplaced else ""), sw_place.ms,
                                  error=f"{len(unplaced)} blocks unplaced" if unplaced else None))
        result.card = card
        result.data = {"placed": placed, "calendarItemIds": new_ids, "unplaced": unplaced, "now": now}
        _facts(student_id, result, placed, now)
        return result


def upcoming(student_id: str, days: int = 7) -> list[dict[str, Any]]:
    """This module's study blocks (with times) in the next ``days`` days, from the calendar."""
    now = clock.now(student_id)
    out = []
    for item in my_items(student_id):
        s = _parse(item["start"])
        if now <= s < now + timedelta(days=days):
            block = db.get("plan_block", item["source"]["planBlockId"]) or {}
            out.append({**block, "start": item["start"], "end": item["end"]})
    return sorted(out, key=lambda b: b["start"])


def _facts(student_id: str, result: ToolResult, placed: list[Placed], now: datetime) -> None:
    week = [p for p in placed if p.start < now + timedelta(days=7)]
    cites = CitationSet(AGENT_ID)
    topics: list[Candidate] = []
    for p in week:
        if p.cand not in topics:
            topics.append(p.cand)
    for c in topics[:3]:
        syl = cites.cite_section(c.section_id)
        pp = cites.cite_section(dx.past_papers_section_id(c.course, c.topic)) if not c.action_id else None
        tags = " ".join(f"[{x.id}]" for x in (syl, pp) if x)
        mins = sum(p.minutes for p in week if p.cand is c)
        days = ", ".join(dict.fromkeys(f"{p.start:%a %d %b}" for p in sorted(week, key=lambda x: x.start) if p.cand is c))
        result.facts.append(f"{c.topic} ({c.course}): {mins} min over the next 7 days ({days}); "
                            f"impact {c.impact}; {'; '.join(c.facts)} {tags}".strip())
    for code in dict.fromkeys(c.course for c in topics[:3]):
        sid = exam_section_id(code)
        e = next((x for x in _student_exams(student_id) if same_course(x.course_code, code) and x.start >= now), None)
        if sid and e:
            cit = cites.add(sid, f"{code} {e.component}: {fmt_day(e.start.date())} ({e.start.date().isoformat()})")
            if cit:
                result.facts.append(f"next {code} assessment: {e.component} on {fmt_day(e.start.date())} [{cit.id}]")
    total = sum(p.minutes for p in week)
    result.facts.insert(0, f"next 7 days: {len(week)} study blocks, {total} min in total, placed after classes "
                           f"with at most {DAILY_CAP} min a day")
    result.citations = cites.items


def fresh(student_id: str) -> tuple[bool, str]:
    """Can the chat reuse the current plan instead of rebuilding it?"""
    meta = db.get("plan_meta", student_id)
    if not meta:
        return False, "no plan yet"
    now = clock.now(student_id)
    built = _parse(meta["builtAt"])
    if monday_of(built.date()) != monday_of(now.date()):
        return False, f"plan was built in an earlier week ({built:%a %d %b})"
    before = {(course_slug(x["course"]), x["topic"]): x["impact"] for x in meta.get("impacts", [])}
    if before != dx.impacts(student_id):
        return False, "weak-topic impact changed since the plan was built"
    if _unplaced_actions(student_id, get_state(student_id).get("plan") or {}):
        return False, "an accepted action is not in the plan yet"
    if not upcoming(student_id, days=7):
        return False, "no study blocks in the next 7 days"
    return True, f"plan built {built:%a %d %b %H:%M}; weak topics and accepted actions unchanged since"


def course_card(card: dict[str, Any] | None, course: str) -> dict[str, Any]:
    """The plan narrowed to one course (a class channel's view); weeks without its blocks are dropped."""
    weeks = []
    for w in (card or {}).get("weeks", []):
        blocks = [b for b in w.get("blocks", []) if same_course(b.get("course"), course)]
        if blocks:
            week = {"label": w["label"], "blocks": blocks}
            note = "; ".join(p for p in (w.get("examNote") or "").split("; ") if same_course(p[:len(course)], course))
            if note:
                week["examNote"] = note
            weeks.append(week)
    return {"type": "study_plan", "weeks": weeks}


def current(student_id: str, course: str | None = None) -> ToolResult:
    """The existing plan as a ToolResult (no model call). ``course`` narrows it to one class."""
    with Stopwatch() as sw:
        state = get_state(student_id)
        now = clock.now(student_id)
        blocks = [b for b in upcoming(student_id, days=7) if course is None or same_course(b["course"], course)]
        meta = db.get("plan_meta", student_id) or {}
        stats = {(course_slug(x["course"]), x["topic"]): x for x in meta.get("impacts", [])}
    result = ToolResult(card=course_card(state.get("plan"), course) if course else state.get("plan"))
    ok, why = fresh(student_id)
    result.trace.append(trace(TOOL, f"reused current plan: {why}", sw.ms))
    cites = CitationSet(AGENT_ID)
    seen: list[tuple[str, str]] = []
    for b in blocks:
        key = (course_slug(b["course"]), b["topic"])
        if key not in seen:
            seen.append(key)
    for slug, topic in seen[:3]:
        bs = [b for b in blocks if (course_slug(b["course"]), b["topic"]) == (slug, topic)]
        code = bs[0]["course"]
        syl = cites.cite_section(bs[0]["citationId"]) if bs[0].get("citationId") else None
        pp = cites.cite_section(dx.past_papers_section_id(code, topic))
        tags = " ".join(f"[{x.id}]" for x in (syl, pp) if x)
        days = ", ".join(dict.fromkeys(f"{_parse(b['start']):%a %d %b}" for b in bs))
        facts = bs[0]["why"]
        impact = stats.get((slug, topic), {}).get("impact")
        result.facts.append(f"{topic} ({code}): {sum(b['minutes'] for b in bs)} min over the next 7 days ({days})"
                            + (f"; impact {impact}" if impact is not None else "") + f"; {facts} {tags}".rstrip())
        sid = exam_section_id(code)
        e = next((x for x in _student_exams(student_id) if same_course(x.course_code, code) and x.start >= now), None)
        if sid and e and not any(f.startswith(f"next {code} assessment") for f in result.facts):
            cit = cites.add(sid, f"{code} {e.component}: {fmt_day(e.start.date())} ({e.start.date().isoformat()})")
            if cit:
                result.facts.append(f"next {code} assessment: {e.component} on {fmt_day(e.start.date())} [{cit.id}]")
    result.facts.insert(0, f"next 7 days: {len(blocks)} study blocks, {sum(b['minutes'] for b in blocks)} min in total")
    result.citations = cites.items
    result.data = {"reused": True}
    return result
