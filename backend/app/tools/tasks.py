"""Student-added calendar tasks (contracts v3.12): the student's own commitments on the merged calendar.

A task is a CalendarItem of kind "task" with source {type: "manual"}, stored like any other
calendar item. Code never invents, moves or deletes one: plan rebuilds (tools/plan.py) keep it,
place study blocks around it, and count a timed task tied to a course toward that day's study cap.
Accepting an action (tools/calendar.find_slot) avoids it too. Built 26 Sep 2026.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

from app.core import db
from app.core.academics import canonical_course_code, iso
from app.core.config import TZ
from app.core.models import CalendarItem
from app.core.records import load_student, registered_courses
from app.core.syllabus import course_slug

MAX_TITLE = 80
MAX_MINUTES = 8 * 60


def is_task(item: dict[str, Any]) -> bool:
    return (item.get("source") or {}).get("type") == "manual"


def tasks(student_id: str) -> list[dict[str, Any]]:
    return [i for i in db.find("calendar_item", student_id=student_id) if is_task(i)]


def _parse(value: Any) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("start is required")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"'{text}' is not an ISO date or datetime")
    return dt if dt.tzinfo else dt.replace(tzinfo=TZ)


def add(student_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """body: {title, start, end? | minutes?, allDay?, courseCode?}. A date-only start is all-day."""
    if load_student(student_id) is None:
        raise LookupError(f"student {student_id} not found")
    title = " ".join(str(body.get("title") or "").split())
    if not title:
        raise ValueError("title is required")
    if len(title) > MAX_TITLE:
        raise ValueError(f"title must be at most {MAX_TITLE} characters")
    course = " ".join(str(body.get("courseCode") or "").split()) or None
    if course:
        course = canonical_course_code(course)
        registered = registered_courses(student_id)
        if registered is not None and course_slug(course) not in registered:
            raise ValueError(f"{course} is not one of this student's registered courses")
    raw_start = str(body.get("start") or "").strip()
    start = _parse(raw_start)
    fields: dict[str, Any]
    if body.get("allDay") or len(raw_start) == 10:
        fields = {"start": start.date().isoformat(), "allDay": True}
    else:
        if body.get("end"):
            end = _parse(body["end"])
        elif body.get("minutes"):
            try:
                end = start + timedelta(minutes=int(body["minutes"]))
            except (TypeError, ValueError):
                raise ValueError("minutes must be a whole number")
        else:
            raise ValueError("a timed task needs end or minutes (or allDay: true)")
        if end <= start:
            raise ValueError("end must be after start")
        if end - start > timedelta(minutes=MAX_MINUTES):
            raise ValueError(f"a task can be at most {MAX_MINUTES // 60} hours")
        fields = {"start": iso(start), "end": iso(end)}
    item = CalendarItem(id=f"task:{uuid.uuid4().hex[:10]}", studentId=student_id, kind="task", title=title,
                        courseCode=course, source={"type": "manual"}, status="planned", **fields)
    db.put("calendar_item", item.id, item.dump(), student_id=student_id)
    return item.dump()


def delete(item_id: str) -> dict[str, Any]:
    """Removes one student-added task (and its status); returns the removed item."""
    body = db.get("calendar_item", item_id)
    if not body or not is_task(body):
        raise LookupError(f"task {item_id} not found (only tasks you added can be deleted)")
    status = db.get("calendar_status", item_id)
    db.delete("calendar_item", item_id)
    db.delete("calendar_status", item_id)
    return {**body, **({"status": status["status"]} if status else {})}


def fingerprint(student_id: str) -> list[str]:
    """What a plan was built around; plan.fresh() rebuilds when it changes."""
    return sorted(f"{t['id']}|{t['start']}|{t.get('end') or ''}" for t in tasks(student_id))


def upcoming_fact(student_id: str, now: datetime, days: int = 7) -> str | None:
    """One code-written fact line for the coach's reply: the student's own tasks it planned around."""
    until = now + timedelta(days=days)
    rows = []
    for t in sorted(tasks(student_id), key=lambda x: x["start"]):
        start = _parse(t["start"])
        end = _parse(t["end"]) if t.get("end") else start + timedelta(days=1)
        if end <= now or start >= until:
            continue
        when = f"{start:%a %d %b}, all day" if t.get("allDay") or not t.get("end") else \
            f"{start:%a %d %b %H:%M}–{end:%H:%M}"
        rows.append(f"{t['title']}" + (f" ({t['courseCode']})" if t.get("courseCode") else "") + f" on {when}")
    if not rows:
        return None
    return (f"the student's own calendar tasks in the next {days} days, kept exactly as they added them, with study "
            f"blocks placed around them: " + "; ".join(rows[:6]))
