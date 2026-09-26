"""Workspace reads the frontend boots from (contracts §0, §1, §2, §6, §8): students, channels,
class channels, agents, connectors, files. Pure reads over the dataset and SQLite; the one
write is computing weak topics (code only) the first time a student's state is loaded.
Built 26 Sep 2026 (Feature 2, at the frontend-integration session's request).
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, time
from functools import lru_cache
from typing import Any

from app.core import clock, db, parser, scope
from app.core.academics import due_iso, exams, iso, next_session, same_course
from app.core.config import DATA_DIR, TZ
from app.core.records import load_student
from app.core.state import get_state
from app.core.syllabus import course_slug
from app.tools import diagnose as dx

# channel names for the demo courses ("cs-f212-dbms"); other courses fall back to a title slug
SHORT_NAMES = {"cs-f212": "dbms", "cs-f351": "toc", "cs-f372": "os", "cs-f303": "networks",
               "math-f241": "prob-stats", "hss-f235": "tech-society"}


@lru_cache(maxsize=1)
def _catalog() -> dict[str, dict[str, Any]]:
    path = DATA_DIR / "catalog.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    rows = data.get("courses", []) if isinstance(data, dict) else data
    return {course_slug(r.get("code") or r.get("courseCode") or ""): r for r in rows}


def course_info(code: str) -> dict[str, Any]:
    return _catalog().get(course_slug(code), {})


def students() -> list[dict[str, Any]]:
    ids = sorted(p.stem for p in (DATA_DIR / "students").glob("*.json"))
    ids.sort(key=lambda s: s != "meera")  # the demo student first
    return [s for s in (load_student(i) for i in ids) if s]


def _exam_kind(component: str) -> str:
    c = component.lower()
    return "quiz" if "quiz" in c else "mid_sem" if "mid" in c else "end_sem"


def class_channels(student_id: str) -> list[dict[str, Any]]:
    """ClassChannel[] for the student's current-semester courses, recomputed on every call."""
    now = clock.now(student_id)
    today = datetime.combine(now.date(), time(0, 0), TZ)
    actions = db.find("action", student_id=student_id)
    lectures = db.find("lecture", student_id=student_id)
    stats, _ = dx.compute(student_id)
    out = []
    for code in dx.semester_courses(student_id):
        info = course_info(code)
        item: dict[str, Any] = {"channelId": f"class:{code}", "courseCode": code,
                                "title": info.get("title", code), "faculty": info.get("faculty", ""),
                                "slot": info.get("slot", "")}
        nxt = next_session(code, now, lecture_only=False)
        if nxt:
            item["nextSessionAt"] = iso(nxt.start)
            if nxt.room:
                item["nextSessionRoom"] = nxt.room
        exam = next((e for e in exams() if same_course(e.course_code, code) and e.start >= today), None)
        if exam:
            item["examAt"] = due_iso(exam)
            item["examKind"] = _exam_kind(exam.component)
        mine = [a for a in actions if same_course(a.get("course"), code)]
        item["pendingActions"] = sum(1 for a in mine if a.get("status") == "proposed")
        item["prepDue"] = sum(1 for a in mine if a.get("kind") == "prep" and a.get("status") == "accepted"
                              and a.get("dueBy") and (nxt is None or a["dueBy"] <= iso(nxt.start)))
        course_lectures = sorted((lec for lec in lectures if same_course(lec.get("courseCode"), code)),
                                 key=lambda lec: (lec.get("date", ""), lec.get("id", "")))
        if course_lectures:
            last = course_lectures[-1]
            item["latestLecture"] = {"lectureId": last["id"], "date": last.get("date"), "status": last.get("status")}
        item["weakTopicCount"] = sum(1 for s in stats if same_course(s.course, code) and s.impact >= 50)
        out.append(item)
    return out


def channels(student_id: str) -> list[dict[str, Any]]:
    out = [{"id": "announcements", "name": "announcements", "kind": "live",
            "description": "Circulars from the Academic Office (synthetic feed)"}]
    for code in dx.semester_courses(student_id):
        info = course_info(code)
        title = info.get("title", code)
        slug = course_slug(code)
        short = SHORT_NAMES.get(slug) or re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
        out.append({"id": f"class:{code}", "name": f"{slug}-{short}", "kind": "class",
                    "description": f"{code} {title}" + (f" with {info['faculty']}" if info.get("faculty") else "")
                                   + ": lectures, schedule and the coach scoped to this course",
                    "courseCode": code})
    return out


def agents() -> list[dict[str, Any]]:
    planner_scope = [d.id for d in parser.documents().values() if d.kind in ("handbook", "circular", "catalog")]
    return [
        {"id": "academic_coach", "kind": "specialist", "name": "Academic Coach", "emoji": "🎓",
         "tagline": "Weak topics, a weekly study plan, exam dates and program rules, cited to official documents",
         "scope": scope.doc_ids("academic_coach"),
         "starters": ["What should I study this week?", "When is the DBMS end-sem?",
                      "Which topics are costing me the most marks?"]},
        {"id": "course_planner", "kind": "specialist", "name": "Course Planner", "emoji": "🧭",
         "tagline": "Which courses to take next, and whether they fit a job (coming soon)",
         "scope": planner_scope,
         "starters": ["What should I take next semester?", "Do my electives fit a backend role?",
                      "Does anything clash in my Sem 6 plan?"]},
        {"id": "campus_guide", "kind": "specialist", "name": "Campus Guide", "emoji": "🗺️",
         "tagline": "Resources and opportunities on campus (coming soon)", "scope": [],
         "starters": ["Who can help me with DBMS?", "Which clubs fit my interests?", "What's on this week?"]},
    ]


def connectors() -> list[dict[str, Any]]:
    path = DATA_DIR / "connectors.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    return data.get("connectors", []) if isinstance(data, dict) else data


def workspace(student_id: str) -> dict[str, Any]:
    return {"channels": channels(student_id), "classes": class_channels(student_id), "agents": agents(),
            "connectors": connectors()}


def state(student_id: str) -> dict[str, Any]:
    """StudentState; weak topics are computed (code only) the first time. The audit is Feature 3."""
    current = get_state(student_id)
    if not current.get("weakTopics"):
        dx.diagnose(student_id)
        current = get_state(student_id)
    return current


def _mtime(path: str | None) -> str:
    stamp = os.path.getmtime(path) if path and os.path.exists(path) else datetime.now(TZ).timestamp()
    return datetime.fromtimestamp(stamp, TZ).isoformat(timespec="seconds")


def files(student_id: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for d in parser.documents().values():
        doc = {"kind": "document", "id": d.id, "title": d.title, "docKind": d.kind, "connectorId": d.connector_id,
               "updatedAt": _mtime(d.path)}
        if d.effective_date:
            doc["effectiveDate"] = d.effective_date
        out.append(doc)
    current = get_state(student_id)
    if current.get("plan"):
        out.append({"kind": "canvas", "id": f"canvas:{student_id}:study_plan", "title": "Study plan",
                    "canvasKind": "study_plan", "cardType": "study_plan", "updatedAt": current["updatedAt"]})
    reviews = sorted(db.find("one_on_one", student_id=student_id), key=lambda o: o.get("_builtAt", ""))
    if reviews:
        latest = reviews[-1]
        out.append({"kind": "canvas", "id": f"canvas:{latest['id']}", "title": f"Weekly 1:1 · {latest['weekLabel']}",
                    "canvasKind": "one_on_one", "cardType": "one_on_one",
                    "updatedAt": latest.get("_builtAt") or current["updatedAt"]})
    return out
