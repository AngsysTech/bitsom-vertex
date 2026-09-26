"""Agent DM threads in SQLite. Thread id is ``<studentId>:<agentId>`` (contracts §3)."""
from __future__ import annotations

from typing import Any

from app.core import db
from app.core.models import Message, Thread


def thread_id(student_id: str, agent_id: str) -> str:
    return f"{student_id}:{agent_id}"


def append_message(student_id: str, message: Message) -> Message:
    db.put("message", message.id, message.dump(), student_id=student_id, parent_id=message.threadId)
    return message


def get_thread(student_id: str, agent_id: str) -> dict[str, Any]:
    tid = thread_id(student_id, agent_id)
    messages = [Message.model_validate(m) for m in db.find("message", parent_id=tid)]
    messages.sort(key=lambda m: m.createdAt)
    return Thread(id=tid, studentId=student_id, agentId=agent_id, messages=messages).dump()
