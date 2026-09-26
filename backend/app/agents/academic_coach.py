"""Academic Coach chat handler: POST /chat for agentId = academic_coach (AGENTS.md §4.1).

1. Load StudentState, StudentRecords and the thread so far.
2. Route: one LLM call (prompts/academic_coach_route.md) picks one tool from a closed list.
   Out of scope → escalate.
3. Run the tool → (card, citations, trace) plus the code-computed facts it may state.
   answer_from_docs puts the agent's scoped documents in context (core/scope.py) and keeps
   only evidence whose quote verifies verbatim; when the documents run out or say a person
   must decide, it opens a pre-cited ticket.
4. Compose: one LLM call (prompts/academic_coach_compose.md) writes the reply with inline
   [Cn] markers from the verified citation list only; unknown markers and numbers that are
   not in the facts are caught and reported in the trace.
5. One agent Message with cards, citations, trace (every step timed) and escalation.

A failed step returns a system message with the error in its trace, never a stand-in answer.
Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app import escalation
from app.core import llm, scope
from app.core.academics import canonical_course_code, course_title
from app.core.citations import CitationSet, check_markers, used
from app.core.config import PROMPTS_DIR
from app.core.models import Citation, Message, ToolTrace
from app.core.records import load_records, load_student, registered_courses
from app.core.state import get_state
from app.core.syllabus import course_slug
from app.core.threads import append_message, class_thread_id, get_class_thread, get_thread, thread_id
from app.core.verify import normalize_ws
from app.tools import diagnose as dx
from app.tools import lookback
from app.tools import plan as planner
from app.tools.base import Stopwatch, ToolResult, trace

log = logging.getLogger("academic_coach")

AGENT_ID = "academic_coach"
TOOLS = ("diagnose_performance", "build_study_plan", "weekly_review", "answer_from_docs",
         "run_degree_audit", "escalate")
NUM = re.compile(r"\d+(?:\.\d+)?")


@lru_cache(maxsize=8)
def _prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


class _Route(BaseModel):
    tool: Literal["diagnose_performance", "build_study_plan", "weekly_review", "answer_from_docs",
                  "run_degree_audit", "escalate"]
    reason: str = ""
    rebuild: bool = False
    escalationReason: Optional[Literal["out_of_scope", "needs_human"]] = None
    summaryForAdvisor: Optional[str] = None


class _ClassRoute(BaseModel):
    tool: Literal["diagnose_performance", "build_study_plan", "answer_from_docs", "redirect_to_dm"]
    reason: str = ""
    rebuild: bool = False


class _Evidence(BaseModel):
    sectionId: str
    quote: str
    point: str = ""


class _Answer(BaseModel):
    status: Literal["answered", "needs_human", "not_in_docs"]
    evidence: list[_Evidence] = Field(default_factory=list)
    summaryForAdvisor: Optional[str] = None


class _Reply(BaseModel):
    text: str


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------------
# context
# ---------------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _scope_toc() -> str:
    lines = []
    for d in scope.scoped_documents(AGENT_ID):
        eff = f", effective {d.effective_date}" if d.effective_date else ""
        if d.kind in ("handbook", "circular"):
            lines.append(f"- {d.title} ({d.kind}{eff}): " + "; ".join(s.heading for s in d.sections))
        elif d.kind == "catalog":
            lines.append(f"- {d.title}: " + "; ".join(s.heading for s in d.sections))
        elif d.kind == "syllabus":
            units = list(dict.fromkeys(s.heading.split(" › ")[0] for s in d.sections))
            lines.append(f"- {d.title}: " + "; ".join(units))
        else:
            lines.append(f"- {d.title}: " + "; ".join(s.heading for s in d.sections))
    return "\n".join(lines)


@lru_cache(maxsize=1)
def _scope_full() -> str:
    parts = []
    for d in scope.scoped_documents(AGENT_ID):
        eff = f", effectiveDate {d.effective_date}" if d.effective_date else ""
        parts.append(f"=== DOCUMENT {d.id}: {d.title} ({d.kind}{eff}) ===")
        for s in d.sections:
            parts.append(f"[{s.id}] {s.heading}\n{s.text}")
    return "\n\n".join(parts)


def _class_scope_full(course: str) -> str:
    parts = []
    for d, secs in scope.class_sections(course):
        parts.append(f"=== DOCUMENT {d.id}: {d.title} ({d.kind}) ===")
        parts += [f"[{s.id}] {s.heading}\n{s.text}" for s in secs]
    return "\n\n".join(parts)


def _state_summary(student_id: str) -> str:
    state = get_state(student_id)
    weak = (state.get("weakTopics") or {}).get("items") or []
    upcoming = planner.upcoming(student_id, days=7)
    top = ", ".join("{} ({}, impact {})".format(w["topic"], w["course"], w["impact"]) for w in weak[:3])
    lines = [f"weak topics: {top or 'not computed yet'}",
             f"study plan: {len(upcoming)} blocks in the next 7 days" if upcoming else "study plan: none yet"]
    open_tickets = [t for t in escalation.inbox() if t["studentId"] == student_id and t["status"] == "open"]
    if open_tickets:
        lines.append(f"open advisor tickets: {', '.join(t['ticketId'] for t in open_tickets)}")
    return "\n".join(lines)


def _thread_tail(student_id: str, n: int = 6) -> str:
    msgs = get_thread(student_id, AGENT_ID)["messages"][-n:]
    return "\n".join(f"{m['role']}: {normalize_ws(m['text'])[:300]}" for m in msgs) or "(new conversation)"


# ---------------------------------------------------------------------------------
# tools
# ---------------------------------------------------------------------------------

def _escalate(student_id: str, student: dict[str, Any], question: str, reason: str, summary: str | None,
              citations: list[Citation], facts: list[str]) -> ToolResult:
    with Stopwatch() as sw:
        head = (f"{student.get('name')} (semester {student.get('semester')}, {student.get('program')}) asked the "
                f"Academic Coach: “{question}”.")
        ticket, esc = escalation.create_ticket(
            student_id=student_id, agent_id=AGENT_ID, question=question,
            agent_summary=f"{head} {normalize_ws(summary or '')}".strip(), citations=citations, reason=reason)
    result = ToolResult(citations=citations, facts=list(facts))
    if reason == "out_of_scope" and not citations:
        result.facts.append("the coach's documents (handbook, circulars, course catalog, syllabi, exam calendar, "
                            "past papers) do not cover this question")
    result.facts.append(f"ticket {ticket.ticketId} opened for a human advisor (reason: {reason.replace('_', ' ')}); "
                        f"the advisor's reply will appear in this thread")
    result.trace.append(trace("escalate", f"ticket {ticket.ticketId} opened ({reason}) with {len(citations)} "
                                          f"verified citations and the agent summary", sw.ms))
    result.data["escalation"] = esc.dump()
    return result


def _grounded_point(point: str, quote: str, question: str) -> bool:
    allowed = set(NUM.findall(quote)) | set(NUM.findall(question))
    return all(n in allowed for n in NUM.findall(point))


def _answer_from_docs(student_id: str, student: dict[str, Any], question: str, history: str,
                      course: str | None = None) -> ToolResult:
    """``course``: a class channel. Its scope is that course's documents only, and when they don't answer,
    the student is sent to the DM (which can escalate) instead of opening a ticket from the channel."""
    docs = _class_scope_full(course) if course else _scope_full()
    with Stopwatch() as sw:
        out = llm.json(f"{docs}\n\n=== STUDENT ===\n{student.get('name')}, semester "
                       f"{student.get('semester')}, {student.get('program')}\n\n=== RECENT THREAD ===\n{history}\n\n"
                       f"=== QUESTION ===\n{question}", _Answer, system=_prompt("academic_coach_answer"),
                       max_tokens=6000)
    cites = CitationSet(AGENT_ID, allowed=scope.class_section_ids(course) if course else None)
    facts = []
    for ev in out.evidence[:5]:
        c = cites.add(ev.sectionId.strip(), ev.quote, min_words=4)
        if not c:
            continue
        point = normalize_ws(ev.point)
        if point and _grounded_point(point, c.quote, question):
            facts.append(f"{point} (source: “{c.quote}”) [{c.id}]")
        else:
            facts.append(f"{c.docTitle} › {c.sectionHeading}: “{c.quote}” [{c.id}]")
    read = f"{course}'s documents" if course else f"{len(scope.doc_ids(AGENT_ID))} scoped documents"
    summary = (f"{out.status}: read {read}; {len(cites.items)}/"
               f"{len(out.evidence[:5])} evidence quotes verified verbatim")
    if cites.dropped:
        summary += f"; dropped: {'; '.join(cites.dropped[:3])}"
    result = ToolResult(citations=cites.items, facts=facts, trace=[trace("answer_from_docs", summary, sw.ms)])
    if out.status == "answered" and cites.items:
        return result
    if course:  # a class channel never opens tickets; the DM coach can
        result.data["redirect"] = True
        return result
    # the documents ran out, or they say a person decides: open a pre-cited ticket
    if out.status == "answered":
        result.trace[-1].error = "answered without a verifiable quote; escalated instead"
    reason = "needs_human" if (out.status == "needs_human" or cites.items) else "out_of_scope"
    esc = _escalate(student_id, student, question, reason, out.summaryForAdvisor, cites.items, facts)
    esc.trace = result.trace + esc.trace
    return esc


def _cite_topics(result: ToolResult, topics: list[tuple[str, str]]) -> None:
    cites = CitationSet(AGENT_ID)
    for course, topic in topics[:3]:
        c = cites.cite_section(dx.past_papers_section_id(course, topic))
        if c:
            result.facts.append(f"{topic} ({course}) past papers: “{c.quote}” [{c.id}]")
    result.citations = cites.items


def _run(route: _Route, student_id: str, student: dict[str, Any], question: str,
         history: str) -> tuple[ToolResult, str | None]:
    """(result, system_text). system_text is set when the tool can't produce an agent reply."""
    if route.tool == "diagnose_performance":
        return dx.diagnose(student_id), None
    if route.tool == "build_study_plan":
        ok, why = planner.fresh(student_id)
        result = planner.current(student_id) if ok and not route.rebuild else planner.build_plan(student_id)
        if result.error:
            return result, f"I couldn't build your study plan: {result.error}."
        weak = get_state(student_id).get("weakTopics")
        if weak:
            result.cards.append(weak)
        return result, None
    if route.tool == "weekly_review":
        result = lookback.as_tool(student_id)
        one = result.card["oneOnOne"]
        rows = [(m.get("course", ""), m["topic"]) for m in one["recap"].get("weakTopicMovement", [])
                if m["topic"] in one["recap"].get("skippedTopics", [])]
        cites_before = list(result.facts)
        _cite_topics(result, rows)
        result.facts = cites_before + [f for f in result.facts if f not in cites_before]
        return result, None
    if route.tool == "answer_from_docs":
        return _answer_from_docs(student_id, student, question, history), None
    if route.tool == "run_degree_audit":
        result = ToolResult(trace=[trace("run_degree_audit", "audit not available yet", 0,
                                         error="the degree audit (Feature 3) is not built yet")])
        return result, ("The degree audit isn't available yet, so I can't tell you whether you're on track to "
                        "graduate. I can show your weak topics, build a study plan or answer questions from the "
                        "handbook and circulars.")
    reason = route.escalationReason or "out_of_scope"
    return _escalate(student_id, student, question, reason, route.summaryForAdvisor, [], []), None


# ---------------------------------------------------------------------------------
# compose
# ---------------------------------------------------------------------------------

def _strip_markers(text: str) -> str:
    return re.sub(r"\[C\d+\]", "", text)


def _compose(student: dict[str, Any], question: str, tool: str, result: ToolResult,
             channel: str | None = None) -> tuple[str, ToolTrace]:
    first = (student.get("name") or "").split(" ")[0]
    facts = "\n".join(f"- {f}" for f in result.facts) or "- (none)"
    cites = CitationSet(AGENT_ID)
    cites.items = result.citations
    where = f"CHANNEL: class channel for {channel}; talk about this course only\n" if channel else ""
    base = (f"{where}STUDENT: {student.get('name')} (first name {first})\nQUESTION: {question}\nTOOL: {tool}\n"
            f"FACTS:\n{facts}\nCITATIONS:\n{cites.listing()}")
    allowed = set(NUM.findall(base))
    prompt, text, bad, removed = base, "", [], []
    with Stopwatch() as sw:
        for _ in range(2):
            out = llm.json(prompt, _Reply, system=_prompt("academic_coach_compose"), max_tokens=3000)
            text, removed = check_markers(out.text, result.citations)
            bad = [n for n in NUM.findall(_strip_markers(text)) if n not in allowed]
            uncited = bool(result.citations) and not used(text)
            if not bad and not uncited:
                break
            problems = []
            if bad:
                problems.append(f"stated numbers that are not in FACTS or CITATIONS: {', '.join(sorted(set(bad)))}")
            if uncited:
                problems.append("used no citation marker although CITATIONS is not empty")
            prompt = f"{base}\n\nYour previous reply {' and '.join(problems)}. Rewrite it following the rules."
    notes = []
    if bad:  # still ungrounded after one retry: drop those sentences, say so in the trace
        sentences = re.split(r"(?<=[.!?])\s+", text)
        kept = [s for s in sentences if not any(n in NUM.findall(_strip_markers(s)) for n in bad)]
        text = " ".join(kept).strip()
        notes.append(f"dropped sentence(s) stating ungrounded numbers {sorted(set(bad))}")
    if removed:
        notes.append(f"removed unknown markers {removed}")
    n_used = len(used(text) & {c.id for c in result.citations})
    summary = f"reply written from {len(result.facts)} facts; {n_used}/{len(result.citations)} verified citations used"
    return text, trace(f"{AGENT_ID}.compose", summary + (f"; {'; '.join(notes)}" if notes else ""), sw.ms,
                       error="; ".join(notes) if bad else None)


# ---------------------------------------------------------------------------------
# entry point
# ---------------------------------------------------------------------------------

def _message(student_id: str, role: str, text: str, result: ToolResult | None, traces: list[ToolTrace],
             esc: dict[str, Any] | None = None, thread: str | None = None) -> Message:
    msg = Message(id=f"msg_{uuid.uuid4().hex[:10]}", threadId=thread or thread_id(student_id, AGENT_ID), role=role,
                  agentId=AGENT_ID, createdAt=_utcnow(), text=text,
                  citations=result.citations if result else [], cards=result.all_cards() if result else [],
                  trace=traces, escalation=esc)
    append_message(student_id, msg)
    if esc:
        escalation.attach_message(esc["ticketId"], msg.id)
    return msg


def handle(student_id: str, text: str, course_code: str | None = None) -> list[dict[str, Any]]:
    student = load_student(student_id)
    if student is None:
        raise LookupError(f"student {student_id} not found")
    question = (text or "").strip()
    if not question:
        raise ValueError("text is empty")
    if course_code:
        return _handle_class(student_id, student, question, canonical_course_code(course_code))
    history = _thread_tail(student_id)
    append_message(student_id, Message(id=f"msg_{uuid.uuid4().hex[:10]}", threadId=thread_id(student_id, AGENT_ID),
                                       role="student", createdAt=_utcnow(), text=question))
    traces: list[ToolTrace] = []

    with Stopwatch() as sw:
        records = load_records(student_id)
        context = (f"STUDENT: {student.get('name')}, semester {student.get('semester')}, {student.get('program')}, "
                   f"career goal {student.get('careerGoal')}; records from "
                   f"{records['internalMarks'].get('connectorId') or 'n/a'} (marks) and "
                   f"{records['transcript'].get('connectorId') or 'n/a'} (transcript)\n"
                   f"STATE:\n{_state_summary(student_id)}\n\nSCOPE:\n{_scope_toc()}\n\n"
                   f"RECENT THREAD:\n{history}\n\nLATEST MESSAGE:\n{question}")
        try:
            route = llm.json(context, _Route, system=_prompt("academic_coach_route"), max_tokens=3000)
        except llm.LLMError as exc:
            route, error = None, str(exc)
    if route is None:
        traces.append(trace(f"{AGENT_ID}.route", "model call failed", sw.ms, error=error))
        return [_message(student_id, "system", f"The Academic Coach couldn't process this message ({error}).",
                         None, traces).dump()]
    traces.append(trace(f"{AGENT_ID}.route", f"route → {route.tool}: {normalize_ws(route.reason)[:200]}", sw.ms))

    try:
        result, system_text = _run(route, student_id, student, question, history)
    except Exception as exc:  # a tool failure is reported, never papered over
        log.exception("academic_coach tool %s failed", route.tool)
        traces.append(trace(route.tool, "tool failed", 0, error=f"{type(exc).__name__}: {str(exc)[:300]}"))
        return [_message(student_id, "system", f"The {route.tool.replace('_', ' ')} step failed: "
                                               f"{str(exc)[:200] or type(exc).__name__}.", None, traces).dump()]
    traces += result.trace
    if system_text:
        return [_message(student_id, "system", system_text, result, traces).dump()]

    try:
        reply, compose_trace = _compose(student, question, route.tool, result)
    except llm.LLMError as exc:
        traces.append(trace(f"{AGENT_ID}.compose", "model call failed", 0, error=str(exc)))
        return [_message(student_id, "system", "The coach finished its tools but couldn't write a reply; the cards "
                                               "and sources are attached.", result, traces,
                         result.data.get("escalation")).dump()]
    traces.append(compose_trace)
    if not reply:
        return [_message(student_id, "system", "The coach's reply failed its grounding checks; the cards and "
                                               "sources are attached.", result, traces,
                         result.data.get("escalation")).dump()]
    return [_message(student_id, "agent", reply, result, traces, result.data.get("escalation")).dump()]


# ---------------------------------------------------------------------------------
# class channel (contracts v3.5): the coach scoped to one course
# ---------------------------------------------------------------------------------

def _redirect_text(course: str) -> str:
    title = course_title(course) or ""
    return (f"That's outside {course} {title}".rstrip() + ", so ask me in my DM (Academic Coach). There I can "
            "see all your courses, the handbook and circulars, and pass it to an advisor if it needs one.")


def _handle_class(student_id: str, student: dict[str, Any], question: str, course: str) -> list[dict[str, Any]]:
    if course_slug(course) not in (registered_courses(student_id) or set()):
        raise ValueError(f"{student_id} is not registered in {course}")
    tid = class_thread_id(student_id, course)
    msgs = get_class_thread(student_id, course)["messages"][-6:]
    history = "\n".join(f"{m['role']}: {normalize_ws(m['text'])[:300]}" for m in msgs) or "(new conversation)"
    append_message(student_id, Message(id=f"msg_{uuid.uuid4().hex[:10]}", threadId=tid, role="student",
                                       createdAt=_utcnow(), text=question))
    label = f"{course} {course_title(course) or ''}".strip()
    traces: list[ToolTrace] = []
    with Stopwatch() as sw:
        weak = [w for w in (get_state(student_id).get("weakTopics") or {}).get("items", []) if w["course"] == course]
        toc = "; ".join(f"{d.title}: {len(secs)} section(s)" for d, secs in scope.class_sections(course))
        context = (f"CLASS CHANNEL: {label}\nSCOPE: {toc}\n"
                   f"STUDENT: {student.get('name')}; weak topics in this course: "
                   f"{', '.join(w['topic'] for w in weak[:3]) or 'none computed'}\n\n"
                   f"RECENT THREAD:\n{history}\n\nLATEST MESSAGE:\n{question}")
        try:
            route = llm.json(context, _ClassRoute, system=_prompt("academic_coach_class_route"), max_tokens=3000)
            error = None
        except llm.LLMError as exc:
            route, error = None, str(exc)
    if route is None:
        traces.append(trace(f"{AGENT_ID}.route", "model call failed", sw.ms, error=error))
        return [_message(student_id, "system", f"The coach couldn't process this message ({error}).", None, traces,
                         thread=tid).dump()]
    traces.append(trace(f"{AGENT_ID}.route", f"route → {route.tool} (class {course}): {normalize_ws(route.reason)[:200]}",
                        sw.ms))
    if route.tool == "redirect_to_dm":
        return [_message(student_id, "agent", _redirect_text(course), None, traces, thread=tid).dump()]
    try:
        if route.tool == "diagnose_performance":
            result = dx.diagnose(student_id, course=course)
        elif route.tool == "build_study_plan":
            ok, _ = planner.fresh(student_id)
            built = planner.build_plan(student_id) if route.rebuild or not ok else None
            if built is not None and (built.error or not built.card):
                traces += built.trace
                return [_message(student_id, "system", f"I couldn't build your study plan: {built.error}.", None,
                                 traces, thread=tid).dump()]
            result = planner.current(student_id, course=course)
            if built is not None:
                result.trace = built.trace + [trace(planner.TOOL, f"showing the {course} blocks of the new plan", 0)]
        else:
            result = _answer_from_docs(student_id, student, question, history, course=course)
    except Exception as exc:  # reported, never papered over
        log.exception("academic_coach class tool %s failed", route.tool)
        traces.append(trace(route.tool, "tool failed", 0, error=f"{type(exc).__name__}: {str(exc)[:300]}"))
        return [_message(student_id, "system", f"The {route.tool.replace('_', ' ')} step failed.", None, traces,
                         thread=tid).dump()]
    traces += result.trace
    if result.data.get("redirect"):
        return [_message(student_id, "agent", _redirect_text(course), None, traces, thread=tid).dump()]
    try:
        reply, compose_trace = _compose(student, question, route.tool, result, channel=label)
    except llm.LLMError as exc:
        traces.append(trace(f"{AGENT_ID}.compose", "model call failed", 0, error=str(exc)))
        return [_message(student_id, "system", "The coach finished its tools but couldn't write a reply; the cards "
                                               "and sources are attached.", result, traces, thread=tid).dump()]
    traces.append(compose_trace)
    if not reply:
        return [_message(student_id, "system", "The coach's reply failed its grounding checks; the cards and "
                                               "sources are attached.", result, traces, thread=tid).dump()]
    return [_message(student_id, "agent", reply, result, traces, thread=tid).dump()]
