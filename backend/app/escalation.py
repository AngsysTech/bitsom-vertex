"""Escalation to a human advisor (AGENTS.md §4.4; contracts §5).

A ticket carries the student's question, the agent's pre-triage summary and whatever
verified citations the agent had. The advisor's reply lands in the student's DM thread as an
``advisor`` message, and the escalation on the originating agent message flips to
"answered" so the thread stops polling. Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Any

from app.core import db
from app.core.models import Citation, Escalation, Message, Ticket, TicketReply
from app.core.records import load_student
from app.core.threads import append_message, thread_id

_lock = threading.Lock()


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _next_id() -> str:
    # max + 1, not count + 1: POST /demo/reset deletes one student's tickets, and a count would
    # then hand out an id another student's ticket still holds (and db.put would overwrite it)
    nums = [int(t["ticketId"][2:]) for t in db.find("ticket") if str(t.get("ticketId", ""))[2:].isdigit()]
    return f"A-{max(nums, default=100) + 1}"


def create_ticket(*, student_id: str, agent_id: str, question: str, agent_summary: str,
                  citations: list[Citation] | None = None,
                  reason: str = "needs_human", message_id: str | None = None) -> tuple[Ticket, Escalation]:
    student = load_student(student_id) or {"name": student_id}
    with _lock:
        ticket = Ticket(ticketId=_next_id(), studentId=student_id, studentName=student.get("name", student_id),
                        agentId=agent_id, question=question.strip(), agentSummary=agent_summary.strip(),
                        citations=citations or [], status="open", createdAt=_utcnow())
        db.put("ticket", ticket.ticketId, {**ticket.dump(), "_reason": reason, "_messageId": message_id},
               student_id=student_id)
    return ticket, Escalation(ticketId=ticket.ticketId, status="open", reason=reason)


def attach_message(ticket_id: str, message_id: str) -> None:
    body = db.get("ticket", ticket_id)
    if body:
        body["_messageId"] = message_id
        db.put("ticket", ticket_id, body)


def _public(body: dict[str, Any]) -> dict[str, Any]:
    return Ticket.model_validate({k: v for k, v in body.items() if not k.startswith("_")}).dump()


def get_ticket(ticket_id: str) -> dict[str, Any]:
    body = db.get("ticket", ticket_id)
    if not body:
        raise LookupError(f"ticket {ticket_id} not found")
    return _public(body)


def inbox() -> list[dict[str, Any]]:
    tickets = sorted((_public(b) for b in db.find("ticket")), key=lambda t: t["createdAt"], reverse=True)
    return sorted(tickets, key=lambda t: t["status"] != "open")  # open first, newest first within each


def reply(ticket_id: str, text: str) -> dict[str, Any]:
    if not text or not text.strip():
        raise ValueError("reply text is empty")
    body = db.get("ticket", ticket_id)
    if not body:
        raise LookupError(f"ticket {ticket_id} not found")
    now = _utcnow()
    body["status"] = "answered"
    body["reply"] = TicketReply(text=text.strip(), at=now).dump()
    db.put("ticket", ticket_id, body)
    student_id, agent_id = body["studentId"], body["agentId"]
    tid = thread_id(student_id, agent_id)
    append_message(student_id, Message(id=f"msg_{uuid.uuid4().hex[:10]}", threadId=tid, role="advisor",
                                       agentId=agent_id, createdAt=now, text=text.strip(),
                                       escalation={"ticketId": ticket_id, "status": "answered",
                                                   "reason": body.get("_reason", "needs_human")}))
    original = db.get("message", body.get("_messageId") or "")
    if original and original.get("escalation"):
        original["escalation"]["status"] = "answered"
        db.put("message", original["id"], original, student_id=student_id, parent_id=tid)
    return _public(body)
