"""Per-student clock: wall time plus a demo offset.

The only thing that moves it is POST /demo/simulate-week (a disclosed demo setup step),
which lets the weekly 1:1 review a week that has "happened". Planning and the 1:1 read
time from here; message timestamps stay on the wall clock.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from app.core import db
from app.core.config import TZ


def offset_days(student_id: str | None) -> int:
    if not student_id:
        return 0
    body = db.get("clock", student_id) or {}
    return int(body.get("offsetDays", 0))


def now(student_id: str | None = None) -> datetime:
    return datetime.now(TZ) + timedelta(days=offset_days(student_id))


def advance(student_id: str, days: int) -> datetime:
    db.put("clock", student_id, {"studentId": student_id, "offsetDays": offset_days(student_id) + days},
           student_id=student_id)
    return now(student_id)
