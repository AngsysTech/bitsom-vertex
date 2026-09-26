"""Students and their records (synthetic, tagged with connectorId).

Reads backend/app/data/students/<id>.json. Accepts either
{"student": {...}, "records": {...}} or a flat profile with the record keys at top level.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from app.core.config import DATA_DIR
from app.core.academics import same_course, norm_topic


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
    return {k: v for k, v in profile.items() if k in
            ("id", "name", "program", "semester", "careerGoal", "interests", "avatarEmoji")} | {"id": student_id}


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
