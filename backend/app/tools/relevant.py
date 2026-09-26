"""make_it_relevant (Academic Coach, AGENTS.md §4.1; contracts RelevantCard, POST /relevant).

Code resolves the source (a handout section, a plan block, a weak topic or a graded-answer gap)
to its concept, course, facts and document sections. One LLM call (prompts/make_it_relevant.md)
writes the concept twice from those facts only: plainly ("standard") and through the student's
interest ("reframed"). Numbers in either text must come from the facts, or the card is rejected.
Cards are kept per student for the Canvas history. Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from pydantic import BaseModel

from app.core import db, llm
from app.core.academics import canonical_course_code, norm_topic, same_course
from app.core.config import DATA_DIR, PROMPTS_DIR
from app.core.parser import past_papers_section_id, section, syllabus_section_id
from app.core.records import load_student
from app.core.state import get_state
from app.tools import diagnose as dx

TOOL = "make_it_relevant"
NUM = re.compile(r"\d+(?:\.\d+)?")


class _Relevant(BaseModel):
    standard: str
    reframed: str


@lru_cache(maxsize=1)
def _system_prompt() -> str:
    return (PROMPTS_DIR / "make_it_relevant.md").read_text(encoding="utf-8")


def _section_facts(section_id: str | None) -> list[str]:
    found = section(section_id) if section_id else None
    return [f"{found[1].heading}: {found[1].text}"] if found else []


def _graded_rows(student_id: str) -> list[dict[str, Any]]:
    path = DATA_DIR / "graded_answers" / f"{student_id}.json"
    return json.loads(path.read_text(encoding="utf-8")).get("rows", []) if path.exists() else []


def _tag_label(tag: str) -> str | None:
    path = DATA_DIR / "gap_tags.json"
    tags = json.loads(path.read_text(encoding="utf-8")).get("tags", []) if path.exists() else []
    return next((t.get("label") for t in tags if t.get("tag") == tag), None)


def resolve(student_id: str, source: dict[str, Any]) -> tuple[str, str, list[str], list[str], dict[str, Any]]:
    """(concept, course, facts, citation section ids, normalised source). Raises LookupError / ValueError."""
    kind = source.get("type")
    if kind == "handout_section":
        lec = db.get("lecture", str(source.get("lectureId") or ""))
        if not lec or lec.get("studentId") != student_id:
            raise LookupError(f"lecture {source.get('lectureId')} not found for {student_id}")
        handout = db.get("handout", lec["id"])
        sec = next((s for s in (handout or {}).get("sections", []) if s.get("id") == source.get("sectionId")), None)
        if sec is None:
            raise LookupError(f"handout section {source.get('sectionId')} not found in lecture {lec['id']}")
        course = handout.get("courseCode") or lec.get("courseCode", "")
        concept = sec.get("syllabusTopic") or sec.get("heading", "")
        facts = [f"Handout section “{sec.get('heading')}” key points: " + "; ".join(sec.get("keyPoints") or [])]
        facts += [f"Definition — {d['term']}: {d['definition']}" for d in sec.get("definitions") or []]
        facts += [f"Example said in class: “{e}”" for e in sec.get("examples") or []]
        facts += [f"Lecturer's exam hint: “{h}”" for h in sec.get("examHints") or []]
        facts += _section_facts(sec.get("syllabusSectionId"))
        marker = db.get("marker", str(source.get("markerId") or "")) if source.get("markerId") else None
        if marker and marker.get("note"):
            facts.append(f"The student flagged this part in class as confusing: “{marker['note']}”")
        cites = [sec["syllabusSectionId"]] if sec.get("syllabusSectionId") else []
        norm = {"type": kind, "lectureId": lec["id"], "sectionId": sec["id"],
                **({"markerId": source["markerId"]} if source.get("markerId") else {})}
    elif kind == "plan_block":
        bid = str(source.get("planBlockId") or "")
        block = db.get("plan_block", bid) or next(
            (b for w in (get_state(student_id).get("plan") or {}).get("weeks", []) for b in w.get("blocks", [])
             if b.get("id") == bid), None)
        if not block:
            raise LookupError(f"plan block {bid} not found for {student_id}")
        course, concept = block["course"], block["topic"]
        facts = _section_facts(block.get("citationId")) + [f"Why it is in the plan: {block.get('why', '')}"]
        cites = [block["citationId"]] if block.get("citationId") else []
        norm = {"type": kind, "planBlockId": bid}
    elif kind in ("weak_topic", "gap"):
        course = canonical_course_code(str(source.get("course") or ""))
        concept = str(source.get("topic") or "")
        sid = syllabus_section_id(course, concept)
        if not sid:
            raise LookupError(f"{concept!r} is not a topic in the {course} syllabus")
        stat = next((s for s in dx.compute(student_id)[0]
                     if same_course(s.course, course) and norm_topic(s.topic) == norm_topic(concept)), None)
        facts = _section_facts(sid)
        if stat:
            facts.append(f"The student {stat.marks_fact()}; the topic {stat.weight_fact()}")
        cites = [sid]
        norm = {"type": kind, "course": course, "topic": concept}
        if kind == "gap":
            tag = str(source.get("tag") or "")
            rows = [r for r in _graded_rows(student_id) if same_course(r.get("courseCode"), course)
                    and norm_topic(r.get("topic", "")) == norm_topic(concept) and r.get("gapTag") == tag]
            if not rows:
                raise LookupError(f"no graded answer with gap {tag!r} on {concept} ({course})")
            label = _tag_label(tag)
            facts += [f"{r['exam']} {r['question']}: scored {r['scored']}/{r['max']}. Rubric feedback: "
                      f"{r['rubricFeedback']}" for r in rows]
            if label:
                facts.append(f"Gap: {label}")
            norm["tag"] = tag
    else:
        raise ValueError("source.type must be handout_section, plan_block, weak_topic or gap")
    pp = past_papers_section_id(course, concept)
    if section(pp):
        cites.append(pp)
        facts += _section_facts(pp)
    return concept, course, [f for f in facts if f.strip()], [c for c in cites if section(c)], norm


def make(student_id: str, source: dict[str, Any], interest: str | None = None) -> dict[str, Any]:
    student = load_student(student_id)
    if student is None:
        raise LookupError(f"student {student_id} not found")
    if not isinstance(source, dict):
        raise ValueError("source is required")
    interest = (interest or "").strip() or next(iter(student.get("interests") or []), "")
    if not interest:
        raise ValueError("no interest given and the student has none on file")
    concept, course, facts, cites, norm = resolve(student_id, source)
    listing = "\n".join(f"- {f}" for f in facts)
    base = (f"CONCEPT: {concept}\nCOURSE: {course}\nSTUDENT: {student.get('name')}\nINTEREST: {interest}\n"
            f"FACTS (the only content you may use):\n{listing}")
    allowed = set(NUM.findall(base))
    prompt, bad = base, []
    for _ in range(2):
        out = llm.json(prompt, _Relevant, system=_system_prompt(), max_tokens=3000)
        bad = sorted({n for n in NUM.findall(f"{out.standard} {out.reframed}") if n not in allowed})
        if not bad:
            break
        prompt = f"{base}\n\nYour previous answer stated numbers that are not in FACTS: {', '.join(bad)}. Rewrite it."
    if bad:
        raise RuntimeError(f"reframing stated numbers not in the facts ({', '.join(bad)}); no card made")
    card = {"type": "relevant", "concept": concept, "course": course, "interest": interest,
            "standard": out.standard.strip(), "reframed": out.reframed.strip(), "citationIds": cites, "source": norm}
    db.put("relevant", f"rel_{uuid.uuid4().hex[:10]}", {**card, "_createdAt": datetime.now(timezone.utc).isoformat()},
           student_id=student_id)
    return card


def history(student_id: str) -> list[dict[str, Any]]:
    if load_student(student_id) is None:
        raise LookupError(f"student {student_id} not found")
    rows = sorted(db.find("relevant", student_id=student_id), key=lambda r: r.get("_createdAt", ""), reverse=True)
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]
