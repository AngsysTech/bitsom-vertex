"""Merged calendar (contracts §9b): timetable + exam calendar + plan blocks + accepted actions.

Every item carries its ``source``; nothing appears that can't be traced to one of
those four. Study time is placed by code into free evening slots that don't
collide with classes, exams or other placed items. Built 26 Sep 2026.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

from app.core import db
from app.core.academics import due_iso, exams, iso, sessions_between
from app.core.config import TZ
from app.core.models import CalendarItem
from app.core.records import registered_courses
from app.core.state import get_state, plan_week_monday
from app.core.syllabus import course_slug

EVENING_START = time(18, 0)
EVENING_END = time(22, 0)
STEP = timedelta(minutes=15)


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def parse_iso(value: str | None) -> datetime | None:
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


def _class_items(student_id: str, start: datetime, end: datetime) -> list[CalendarItem]:
    courses = registered_courses(student_id)
    return [CalendarItem(id=f"class:{s.id}:{s.start:%Y-%m-%d}", studentId=student_id, kind="class",
                         title=f"{s.course_code} {s.title}" + (f" ({s.room})" if s.room else ""),
                         courseCode=s.course_code, start=iso(s.start), end=iso(s.end),
                         source={"type": "timetable"})
            for s in sessions_between(start, end, courses)]


def _exam_items(student_id: str, start: datetime, end: datetime) -> list[CalendarItem]:
    courses = registered_courses(student_id)
    out = []
    for e in exams():
        if not (start <= e.start < end):
            continue
        if courses is not None and course_slug(e.course_code) not in courses:
            continue
        out.append(CalendarItem(id=f"exam:{e.id}", studentId=student_id, kind=e.kind, title=e.title,
                                courseCode=e.course_code, start=due_iso(e),
                                end=iso(e.end) if e.end and not e.all_day else None,
                                allDay=True if e.all_day else None,
                                source={"type": "exam_calendar", "examId": e.id}))
    return out


def stored_items(student_id: str) -> list[CalendarItem]:
    return [CalendarItem.model_validate(i) for i in db.find("calendar_item", student_id=student_id)]


def _interval(item: CalendarItem) -> tuple[datetime, datetime] | None:
    if item.allDay or not item.end:
        return None
    return parse_iso(item.start), parse_iso(item.end)


def busy(student_id: str, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    items = _class_items(student_id, start - timedelta(days=1), end + timedelta(days=1)) + \
        _exam_items(student_id, start - timedelta(days=1), end + timedelta(days=1)) + stored_items(student_id)
    out = [iv for iv in (_interval(i) for i in items) if iv]
    # an exam or quiz whose calendar entry has a date but no time blocks that whole day
    for i in items:
        if i.kind in ("exam", "quiz") and (i.allDay or not i.end):
            day = parse_iso(i.start[:10])
            out.append((day, day + timedelta(days=1)))
    return out


def find_slot(student_id: str, minutes: int, earliest: datetime, latest: datetime,
              extra_busy: list[tuple[datetime, datetime]] | None = None) -> tuple[datetime, datetime] | None:
    """First free evening slot of ``minutes`` in [earliest, latest]."""
    length = timedelta(minutes=minutes)
    taken = busy(student_id, earliest, latest) + (extra_busy or [])
    day = earliest.astimezone(TZ).date()
    while day <= latest.astimezone(TZ).date():
        t = max(datetime.combine(day, EVENING_START, TZ), _ceil(earliest))
        stop = min(datetime.combine(day, EVENING_END, TZ), latest)
        while t + length <= stop:
            if all(t + length <= s or t >= e for s, e in taken):
                return t, t + length
            t += STEP
        day += timedelta(days=1)
    return None


def build_calendar(student_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
    items = _class_items(student_id, start, end) + _exam_items(student_id, start, end)
    stored = stored_items(student_id)
    items += [i for i in stored if start <= parse_iso(i.start) < end]

    # Plan blocks. Those created by accepting an action are already on the calendar as
    # that action's item (timed), unless the action is an all-day deadline, in which
    # case its work block is shown at the slot chosen on accept.
    actions = {a["planBlockId"]: a for a in db.find("action", student_id=student_id) if a.get("planBlockId")}
    timed_action_blocks = {pid for pid, a in actions.items()
                           if any(i.id == a.get("calendarItemId") and not i.allDay for i in stored)}
    # blocks from tools/plan.py are stored as their own calendar items (source plan_block)
    own_items = {i.source.planBlockId for i in stored if i.source.type == "plan_block"}
    placed: list[tuple[datetime, datetime]] = []
    plan = get_state(student_id).get("plan") or {}
    for week in plan.get("weeks", []):
        monday = plan_week_monday(week.get("label", "")) or monday_of(datetime.now(TZ).date())
        for block in week.get("blocks", []):
            if block["id"] in timed_action_blocks or block["id"] in own_items:
                continue
            slot_doc = db.get("block_slot", block["id"])
            if slot_doc:
                slot = parse_iso(slot_doc["start"]), parse_iso(slot_doc["end"])
            else:
                week_start = datetime.combine(monday, time(0, 0), TZ)
                slot = find_slot(student_id, int(block.get("minutes") or 45), week_start,
                                 week_start + timedelta(days=7), placed)
            if not slot:
                continue
            placed.append(slot)
            if start <= slot[0] < end:
                items.append(CalendarItem(id=f"plan:{block['id']}", studentId=student_id, kind="study_block",
                                          title=f"Study: {block.get('topic')}", courseCode=block.get("course"),
                                          start=iso(slot[0]), end=iso(slot[1]),
                                          source={"type": "plan_block", "planBlockId": block["id"]},
                                          status="planned"))
    statuses = {s["itemId"]: s["status"] for s in db.find("calendar_status", student_id=student_id)}
    for i in items:
        if i.id in statuses:
            i.status = statuses[i.id]
    items.sort(key=lambda i: (parse_iso(i.start), i.kind))
    return [i.dump() for i in items]


# ---- status (done | missed | planned), persisted as an overlay keyed by item id ----------
# The overlay never edits another module's calendar_item docs; build_calendar applies it.

STATUSES = ("planned", "done", "missed")
STUDY_KINDS = ("study_block", "action", "prep", "deadline")


def _derived_plan_item(item_id: str, student_id: str | None) -> CalendarItem | None:
    """A plan block rendered by build_calendar from its block_slot (no stored item)."""
    block_id = item_id.removeprefix("plan:")
    if student_id is None:
        action = next((a for a in db.find("action") if a.get("planBlockId") == block_id), None)
        lecture = db.get("lecture", action["lectureId"]) if action else None
        student_id = lecture.get("studentId") if lecture else None
    slot = db.get("block_slot", block_id)
    if not student_id or not slot:
        return None
    plan = get_state(student_id).get("plan") or {}
    block = next((b for w in plan.get("weeks", []) for b in w.get("blocks", []) if b.get("id") == block_id), None)
    if block is None:
        return None
    return CalendarItem(id=item_id, studentId=student_id, kind="study_block", title=f"Study: {block.get('topic')}",
                        courseCode=block.get("course"), start=slot["start"], end=slot["end"],
                        source={"type": "plan_block", "planBlockId": block_id}, status="planned")


def set_item_status(item_id: str, status: str, student_id: str | None = None) -> dict[str, Any]:
    if status not in STATUSES:
        raise ValueError(f"status must be one of {', '.join(STATUSES)}")
    body = db.get("calendar_item", item_id)
    if body:
        item = CalendarItem.model_validate(body)
    elif item_id.startswith("plan:"):
        item = _derived_plan_item(item_id, student_id)
    else:
        item = None
    if item is None:
        if item_id.startswith(("class:", "exam:")):
            raise ValueError("status applies to study blocks, actions, prep and deadlines, not classes or exams")
        raise LookupError(f"calendar item {item_id} not found")
    if item.kind not in STUDY_KINDS:
        raise ValueError(f"status applies to {', '.join(STUDY_KINDS)} items; {item_id} is a {item.kind}")
    db.put("calendar_status", item_id, {"itemId": item_id, "status": status,
                                        "at": datetime.now(TZ).isoformat(timespec="seconds")},
           student_id=item.studentId)
    item.status = status
    return item.dump()


