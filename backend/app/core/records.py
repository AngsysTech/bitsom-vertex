"""Students and their records (synthetic, tagged with connectorId).

Reads backend/app/data/students/<id>.json. Accepts either
{"student": {...}, "records": {...}} or a flat profile with the record keys at top level.
Interests start as the connector's list; once the student edits them (POST/DELETE
/students/:id/interests) the edited list lives in SQLite and the dataset file is never written.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any

from app.core import db
from app.core.config import DATA_DIR
from app.core.academics import same_course, norm_topic

INTEREST_MAX_LEN = 40
INTEREST_MAX_COUNT = 10


@lru_cache(maxsize=64)
def _raw(student_id: str) -> dict[str, Any] | None:
    path = DATA_DIR / "students" / f"{student_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_student(student_id: str) -> dict[str, Any] | None:
    raw = _raw(student_id)
    if raw is None:
        return None
    profile = raw.get("student") or raw.get("profile") or raw
    student = {k: v for k, v in profile.items() if k in
               ("id", "name", "program", "semester", "careerGoal", "interests", "avatarEmoji")} | {"id": student_id}
    edited = db.get("interests", student_id)
    if edited is not None:
        student["interests"] = edited["interests"]
    return student


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _interest(text: str) -> str:
    interest = _clean(text)
    if not interest:
        raise ValueError("interest is required")
    if len(interest) > INTEREST_MAX_LEN:
        raise ValueError(f"keep an interest under {INTEREST_MAX_LEN} characters")
    return interest


def _save_interests(student_id: str, interests: list[str]) -> list[str]:
    db.put("interests", student_id, {"interests": interests}, student_id=student_id)
    return interests


def add_interest(student_id: str, text: str) -> list[str]:
    """Appends (case-insensitive: an existing interest is kept as spelled). Returns the whole list."""
    student = load_student(student_id)
    if student is None:
        raise LookupError(f"student {student_id} not found")
    interest, current = _interest(text), list(student.get("interests") or [])
    if any(i.casefold() == interest.casefold() for i in current):
        return current
    if len(current) >= INTEREST_MAX_COUNT:
        raise ValueError(f"at most {INTEREST_MAX_COUNT} interests; remove one first")
    return _save_interests(student_id, [*current, interest])


def remove_interest(student_id: str, text: str) -> list[str]:
    student = load_student(student_id)
    if student is None:
        raise LookupError(f"student {student_id} not found")
    current = list(student.get("interests") or [])
    kept = [i for i in current if i.casefold() != _clean(text).casefold()]
    if len(kept) == len(current):
        raise LookupError(f"{text!r} is not one of {student_id}'s interests")
    return _save_interests(student_id, kept)


def load_records(student_id: str) -> dict[str, Any]:
    raw = _raw(student_id) or {}
    rec = raw.get("records") or raw
    empty = {"connectorId": "", "rows": []}

    def part(key: str) -> dict[str, Any]:
        value = rec.get(key)
        if isinstance(value, list):
            return {"connectorId": "", "rows": value}
        return value or empty

    return {"studentId": student_id, "transcript": part("transcript"),
            "internalMarks": part("internalMarks"), "registrations": part("registrations")}


def registered_courses(student_id: str) -> set[str] | None:
    rows = load_records(student_id)["registrations"].get("rows") or []
    from app.core.syllabus import course_slug

    codes = {course_slug(r.get("courseCode", "")) for r in rows if r.get("courseCode")}
    return codes or None


def topic_marks(student_id: str, course_code: str, topic: str) -> list[dict[str, Any]]:
    """Internal-mark rows for exactly this course + canonical topic."""
    rows = load_records(student_id)["internalMarks"].get("rows") or []
    key = norm_topic(topic)
    return [r for r in rows if same_course(r.get("courseCode"), course_code) and norm_topic(r.get("topic", "")) == key]
