"""Academic Coach endpoints (contracts.ts §10): chat, calendar status, weekly 1:1, advisor inbox,
plus two tool endpoints and the disclosed demo fixture. GET /calendar itself lives in
api/companion.py and calls tools/calendar.build_calendar. Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app import escalation
from app.agents import academic_coach
from app.core import parser
from app.tools import calendar as cal
from app.tools import diagnose as dx
from app.tools import lookback
from app.tools import plan as planner
from app.tools import relevant

router = APIRouter()


@contextmanager
def _errors() -> Iterator[None]:
    try:
        yield
    except (HTTPException, KeyError, ValidationError):  # KeyError/ValidationError here are bugs → 500
        raise
    except LookupError as exc:
        raise HTTPException(404, str(exc).strip("'\""))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))


async def _body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "body must be JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be a JSON object")
    return body


# ---- chat ----------------------------------------------------------------------------

@router.post("/chat")
async def chat(request: Request) -> list[dict[str, Any]]:
    body = await _body(request)
    agent_id = str(body.get("agentId") or "")
    if agent_id != academic_coach.AGENT_ID:
        raise HTTPException(400, f"agent '{agent_id}' is not available yet; only academic_coach is live")
    with _errors():
        return academic_coach.handle(str(body.get("studentId") or ""), str(body.get("text") or ""),
                                     str(body.get("courseCode") or "") or None)


# ---- coach tools, callable directly (contracts v3.8: return the bare card) ---------------

@router.post("/students/{student_id}/diagnose")
def diagnose(student_id: str) -> dict[str, Any]:
    with _errors():
        return dx.diagnose(student_id).card  # contracts v3.8: -> WeakTopicsCard


@router.post("/students/{student_id}/plan")
def build_plan(student_id: str) -> dict[str, Any]:
    with _errors():
        result = planner.build_plan(student_id)
    if result.error:
        raise HTTPException(502, result.error)
    return result.card  # contracts v3.8: -> StudyPlanCard


# ---- calendar status -------------------------------------------------------------------

@router.post("/calendar/items/{item_id}/status")
async def item_status(item_id: str, request: Request) -> dict[str, Any]:
    body = await _body(request)
    with _errors():
        return cal.set_item_status(item_id, str(body.get("status") or ""), body.get("studentId") or None)


# ---- weekly 1:1 ------------------------------------------------------------------------

@router.get("/one-on-one/{student_id}/current")
def one_on_one_current(student_id: str) -> dict[str, Any]:
    with _errors():
        one, _ = lookback.build_current(student_id)
    return one


@router.post("/one-on-one/{one_id}/answer")
async def one_on_one_answer(one_id: str, request: Request) -> dict[str, Any]:
    body = await _body(request)
    with _errors():
        return lookback.answer(one_id, str(body.get("questionId") or ""), str(body.get("answer") or ""))


@router.post("/one-on-one/{one_id}/complete")
async def one_on_one_complete(one_id: str, request: Request) -> dict[str, Any]:
    body = await _body(request)
    with _errors():
        one, _ = lookback.complete(one_id, bool(body.get("shareWithAdvisor", False)))
    return one


# ---- demo fixture (disclosed setup step; statuses + clock only) --------------------------

@router.post("/demo/simulate-week/{student_id}")
def simulate_week(student_id: str) -> dict[str, Any]:
    with _errors():
        return lookback.simulate_week(student_id)


# ---- Make it Relevant ------------------------------------------------------------------

@router.post("/relevant")
async def make_relevant(request: Request) -> dict[str, Any]:
    body = await _body(request)
    with _errors():
        return relevant.make(str(body.get("studentId") or ""), body.get("source"), body.get("interest"))


@router.get("/relevant/{student_id}")
def relevant_history(student_id: str) -> list[dict[str, Any]]:
    with _errors():
        return relevant.history(student_id)


# ---- advisor ---------------------------------------------------------------------------

@router.get("/advisor/inbox")
def advisor_inbox() -> list[dict[str, Any]]:
    return escalation.inbox()


@router.post("/advisor/reply")
async def advisor_reply(request: Request) -> dict[str, Any]:
    body = await _body(request)
    with _errors():
        return escalation.reply(str(body.get("ticketId") or ""), str(body.get("text") or ""))


# ---- documents (citation targets) --------------------------------------------------------

@router.get("/documents/{doc_id}")
def document(doc_id: str) -> dict[str, Any]:
    doc = parser.document(doc_id)
    if doc is None:
        raise HTTPException(404, f"document {doc_id} not found")
    return doc.dump()


@router.get("/documents/{doc_id}/sections/{section_id}")
def document_section(doc_id: str, section_id: str) -> dict[str, Any]:
    found = parser.section(section_id)
    if found is None or found[0].id != doc_id:
        raise HTTPException(404, f"section {section_id} not found in {doc_id}")
    return found[1].dump()
