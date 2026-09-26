"""StudentState in SQLite (contracts §6). Agents coordinate only through this.

Minimal today: get/save plus adding and removing plan blocks. The audit writes
``audit``; the class companion writes plan blocks when an action is accepted.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from app.core import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_state(student_id: str) -> dict[str, Any]:
    return db.get("state", student_id) or {"studentId": student_id, "updatedAt": _now()}


def save_state(state: dict[str, Any]) -> dict[str, Any]:
    state["updatedAt"] = _now()
    return db.put("state", state["studentId"], state, student_id=state["studentId"])


def week_label(monday: date) -> str:
    return f"Week of {monday:%b} {monday.day}"


def add_plan_block(student_id: str, block: dict[str, Any], week_monday: date) -> dict[str, Any]:
    state = get_state(student_id)
    plan = state.get("plan") or {"type": "study_plan", "weeks": []}
    label = week_label(week_monday)
    week = next((w for w in plan["weeks"] if w.get("label") == label), None)
    if week is None:
        week = {"label": label, "blocks": []}
        plan["weeks"].append(week)
        plan["weeks"].sort(key=lambda w: _label_date(w.get("label", "")) or date.max)
    week["blocks"].append(block)
    state["plan"] = plan
    save_state(state)
    return state


def remove_plan_block(student_id: str, block_id: str) -> None:
    state = get_state(student_id)
    plan = state.get("plan")
    if not plan:
        return
    for week in plan.get("weeks", []):
        week["blocks"] = [b for b in week.get("blocks", []) if b.get("id") != block_id]
    plan["weeks"] = [w for w in plan["weeks"] if w.get("blocks")]
    save_state(state)


def _label_date(label: str) -> date | None:
    try:
        parsed = datetime.strptime(label.replace("Week of ", ""), "%b %d")
    except ValueError:
        return None
    today = date.today()
    guess = parsed.date().replace(year=today.year)
    if (guess - today).days < -180:  # a January label read in December
        guess = guess.replace(year=today.year + 1)
    return guess


def plan_week_monday(label: str) -> date | None:
    return _label_date(label)
