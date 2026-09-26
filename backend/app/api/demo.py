"""Demo setup (disclosed on stage): POST /demo/reset/:studentId.

Clears one student's demo state so a run starts clean: lectures and everything stored under
them (transcript, handout, coverage, commitments, trace, markers, uploaded audio), actions,
the plan (StudentState.plan, plan blocks, block slots, plan meta), stored calendar items and
their statuses, weekly 1:1s, tickets and the demo clock. Timetable classes and exams are
computed from the dataset, so they stay. The student's DM threads are cleared too: their
cards and escalations point at the lectures and tickets removed here. Records, the dataset
and other students are never touched. Built 26 Sep 2026 for the demo dry run.
"""
from __future__ import annotations

import shutil
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException

from app.core import db
from app.core.config import LECTURES_DIR
from app.core.records import load_student
from app.core.state import get_state, save_state
from app.tools import companion

router = APIRouter()

# kinds stored with this student's id (every db.put call site passes student_id for these)
STUDENT_KINDS = ("lecture", "transcript", "handout", "coverage", "commitments", "action", "plan_block",
                 "plan_meta", "block_slot", "calendar_item", "calendar_status", "one_on_one", "ticket",
                 "clock", "message")


def _keys(conn: Any, sql: str, args: list[str]) -> set[tuple[str, str]]:
    return {(kind, id_) for kind, id_ in conn.execute(sql, args).fetchall()}


@router.post("/demo/reset/{student_id}")
def reset(student_id: str) -> dict[str, Any]:
    if load_student(student_id) is None:
        raise HTTPException(404, f"student {student_id} not found")
    lecture_ids = [b["id"] for b in db.find("lecture", student_id=student_id)]
    with db._lock:  # db.py has no bulk delete; one locked pass over the same table
        conn = db._connection()
        keys = _keys(conn, f"SELECT kind, id FROM docs WHERE student_id = ? AND kind IN "
                           f"({','.join('?' * len(STUDENT_KINDS))})", [student_id, *STUDENT_KINDS])
        if lecture_ids:
            marks = ",".join("?" * len(lecture_ids))
            # anything stored under a lecture (markers included), and its trace (stored without a student id)
            keys |= _keys(conn, f"SELECT kind, id FROM docs WHERE parent_id IN ({marks})", lecture_ids)
            keys |= _keys(conn, f"SELECT kind, id FROM docs WHERE kind = 'trace' AND id IN ({marks})", lecture_ids)
        conn.executemany("DELETE FROM docs WHERE kind = ? AND id = ?", sorted(keys))
        conn.commit()
    state = get_state(student_id)
    plan_cleared = state.pop("plan", None) is not None
    if plan_cleared:
        save_state(state)
    folders = 0
    for lid in lecture_ids:
        folder = LECTURES_DIR / lid
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
            folders += 1
    return {"studentId": student_id, "lectures": len(lecture_ids),
            "deleted": dict(sorted(Counter(kind for kind, _ in keys).items())),
            "planCleared": plan_cleared, "audioFoldersRemoved": folders,
            # a pipeline still running for a removed lecture would write its results after this reset
            "stillRunning": sorted(set(lecture_ids) & companion._running)}
