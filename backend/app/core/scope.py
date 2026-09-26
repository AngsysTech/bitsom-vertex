"""Per-agent document scope, enforced in code (AGENTS.md §3).

An agent's context builder and its citation verifier only ever see ``scoped_documents``;
a section outside the scope is not passed to a model and cannot be cited.
"""
from __future__ import annotations

from app.core.parser import Doc, documents, section

# Academic Coach: handbook, circulars, catalog, syllabus, exam calendar, past papers.
# (Lecture transcripts reach it only through the class companion tool, not as documents.)
SCOPES: dict[str, tuple[str, ...]] = {
    "academic_coach": ("handbook", "circular", "catalog", "syllabus", "exam_calendar", "past_papers"),
}


def kinds(agent_id: str) -> tuple[str, ...]:
    if agent_id not in SCOPES:
        raise KeyError(f"no document scope defined for agent {agent_id}")
    return SCOPES[agent_id]


def scoped_documents(agent_id: str) -> list[Doc]:
    allowed = kinds(agent_id)
    return [d for d in documents().values() if d.kind in allowed]


def allows(agent_id: str, section_id: str) -> bool:
    found = section(section_id)
    return bool(found) and found[0].kind in kinds(agent_id)


def doc_ids(agent_id: str) -> list[str]:
    return [d.id for d in scoped_documents(agent_id)]
