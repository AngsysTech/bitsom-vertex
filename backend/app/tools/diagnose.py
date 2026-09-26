"""diagnose_performance (Academic Coach, AGENTS.md §4.1). Pure code, no LLM.

For every current-semester course of the student and every canonical syllabus topic:

    score       = scored/max, summed over the internal-mark components that name the topic
    examWeight  = mean marks the topic carried in the course's last 3 end-sem papers
                  (past_papers.json; a paper that doesn't list the topic counts as 0)
    impact      = examWeight × (1 − scored/max), put on a 0–100 scale by dividing by the
                  heaviest end-sem topic in past_papers.json (Normalization, 20 marks), so
                  100 = scoring nothing on the heaviest topic. The scaling is monotonic:
                  the ranking is exactly the ranking of examWeight × (1 − scored/max).

Topics without internal marks, or never examined in the last three end-sems, are left out:
there is no evidence to rank them on. Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

from app.core import exam_evidence
from app.core.academics import norm_topic, past_papers, same_course
from app.core.citations import CitationSet
from app.core.parser import past_papers_section_id, section, syllabus_section_id
from app.core.records import load_records, load_student
from app.core.state import get_state, save_state
from app.core.syllabus import course_slug, load_syllabus
from app.tools.base import Stopwatch, ToolResult, trace

TOOL = "diagnose_performance"
AGENT_ID = "academic_coach"


@dataclass
class TopicStat:
    course: str
    topic: str
    scored: float
    max: float
    marks: list[tuple[int, int]]      # (year, marks) over the last 3 end-sems, 0 when absent
    exam_weight: float
    impact: int
    citation_id: str                  # past-papers section
    section_id: str | None            # syllabus section
    gaps: list[dict] = field(default_factory=list)  # Smart Exam concept gaps (graded answers), most marks lost first

    @property
    def score(self) -> str:
        return f"{_num(self.scored)}/{_num(self.max)}"

    @property
    def pct(self) -> int:
        return round(100 * self.scored / self.max) if self.max else 0

    def marks_fact(self) -> str:
        return f"scored {self.score} in internal marks"

    def weight_fact(self) -> str:
        present = [m for _, m in self.marks if m > 0]
        lo, hi = min(present), max(present)
        span = f"{lo}" if lo == hi else f"{lo}–{hi}"
        years = [y for y, _ in self.marks]
        yr = f"{years[0]}–{years[-1]}" if len(years) > 1 else f"{years[0]}"
        if len(present) == len(self.marks):
            return f"carried {span} marks in each of the last {len(self.marks)} end-sems ({yr})"
        return f"carried {span} marks in {len(present)} of the last {len(self.marks)} end-sems ({yr})"

    def dump(self) -> dict:
        return {"course": self.course, "topic": self.topic, "score": self.score,
                "examWeight": round(self.exam_weight, 1), "impact": self.impact, "citationId": self.citation_id,
                **({"gaps": self.gaps} if self.gaps else {})}


def _num(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:.1f}"


def _end_sems(course: str) -> list[dict]:
    papers = [p for p in past_papers()
              if same_course(p.get("courseCode"), course) and re.search(r"end|compre", str(p.get("exam", "")), re.I)]
    return sorted(papers, key=lambda p: p.get("year", 0))[-3:]


def _topic_marks(papers: list[dict], topic: str) -> list[tuple[int, int]]:
    key = norm_topic(topic)
    out = []
    for p in papers:
        hit = next((t for t in p.get("topics", []) if norm_topic(t.get("topic", "")) == key), None)
        out.append((int(p.get("year", 0)), int(hit.get("marks", 0)) if hit else 0))
    return out


@lru_cache(maxsize=1)
def heaviest_topic() -> tuple[str, str, float]:
    """(course, topic, mean marks) of the heaviest end-sem topic in past_papers.json."""
    best = ("", "", 0.0)
    for course in {p.get("courseCode") for p in past_papers() if p.get("courseCode")}:
        papers = _end_sems(course)
        for topic in {t.get("topic") for p in papers for t in p.get("topics", [])}:
            marks = _topic_marks(papers, topic)
            mean = sum(m for _, m in marks) / len(marks)
            if mean > best[2]:
                best = (course, topic, mean)
    return best


def semester_courses(student_id: str) -> list[str]:
    student = load_student(student_id) or {}
    rows = load_records(student_id)["registrations"].get("rows") or []
    sem = student.get("semester")
    return [r["courseCode"] for r in rows
            if r.get("status", "registered") == "registered" and (sem is None or r.get("semester") == sem)]


def compute(student_id: str) -> tuple[list[TopicStat], list[str]]:
    """(stats sorted by impact, notes about rows that could not be used)."""
    marks_rows = load_records(student_id)["internalMarks"].get("rows") or []
    scale = heaviest_topic()[2] or 1.0
    notes: list[str] = []
    stats: list[TopicStat] = []
    for course in semester_courses(student_id):
        syl = load_syllabus(course)
        canon = {norm_topic(t.title): t.title for t in syl.topics} if syl else {}
        sums: dict[str, list[float]] = {}
        for r in marks_rows:
            if not same_course(r.get("courseCode"), course) or not r.get("topic") or not r.get("max"):
                continue
            key = norm_topic(r["topic"])
            if key not in canon:
                notes.append(f"{course} mark topic '{r['topic']}' is not a syllabus topic; skipped")
                continue
            acc = sums.setdefault(key, [0.0, 0.0])
            acc[0] += float(r.get("scored", 0))
            acc[1] += float(r["max"])
        papers = _end_sems(course)
        if not papers:
            if sums:
                notes.append(f"{course}: no end-sem papers in past_papers.json")
            continue
        for key, (scored, mx) in sums.items():
            topic = canon[key]
            marks = _topic_marks(papers, topic)
            weight = sum(m for _, m in marks) / len(marks)
            if weight <= 0:
                continue
            impact = round(100 * weight * (1 - scored / mx) / scale)
            if impact <= 0:
                continue
            stats.append(TopicStat(course=course, topic=topic, scored=scored, max=mx, marks=marks,
                                   exam_weight=weight, impact=max(0, min(100, impact)),
                                   citation_id=past_papers_section_id(course, topic),
                                   section_id=syllabus_section_id(course, topic),
                                   gaps=_gaps(student_id, course, topic)))
    stats.sort(key=lambda s: (-s.impact, -s.exam_weight, s.course, s.topic))
    return stats, notes


def _gaps(student_id: str, course: str, topic: str) -> list[dict]:
    """WeakTopic.gaps (contracts v3.7): the Smart Exam questions that lost concept marks on a weak topic.
    citationId is the exam-system record (connector exam_system), not a document section."""
    return [{"tag": g.tag, "evidence": f"{g.question} {g.exam}: {g.label}", "marksLost": g.lost,
             "citationId": f"exam_system:{student_id}:{g.course}:{g.question}"}
            for g in exam_evidence.weak_gaps(student_id, course, topic)]


def card_from(stats: list[TopicStat]) -> dict:
    return {"type": "weak_topics", "items": [s.dump() for s in stats]}


def diagnose(student_id: str, *, persist: bool = True, cite_top: int = 3, course: str | None = None) -> ToolResult:
    """``course`` narrows what is returned (a class channel); the full list is still written to state."""
    if load_student(student_id) is None:
        raise LookupError(f"student {student_id} not found")
    with Stopwatch() as sw:
        stats, notes = compute(student_id)
        missing = [s.citation_id for s in stats if section(s.citation_id) is None]
        card = card_from(stats)
        if persist:
            state = get_state(student_id)
            state["weakTopics"] = card
            save_state(state)
        if course:
            stats = [s for s in stats if same_course(s.course, course)]
            card = card_from(stats)
    heavy = heaviest_topic()
    top = ", ".join(f"{s.topic} {s.impact}" for s in stats[:3]) or "none"
    summary = (f"internal marks × last-3 end-sem past papers → {len(stats)} topics across "
               f"{len({s.course for s in stats})} courses; top: {top} "
               f"(impact scaled to 0–100 by the heaviest topic, {heavy[1]} {heavy[2]:.1f} marks)")
    if notes:
        summary += f"; {len(notes)} mark rows skipped: {'; '.join(notes[:3])}"
    result = ToolResult(card=card, trace=[trace(TOOL, summary, sw.ms,
                                                error=f"unresolved past-paper sections {missing}" if missing else None)])
    cites = CitationSet(AGENT_ID)
    for s in stats[:cite_top]:
        c = cites.cite_section(s.citation_id)
        tag = f" [{c.id}]" if c else ""
        gaps = "".join(f"; Smart Exam {g['evidence']} (lost {_num(g['marksLost'])})" for g in s.gaps[:2])
        result.facts.append(f"{s.topic} ({s.course}): impact {s.impact}; {s.marks_fact()}; {s.weight_fact()}{gaps}{tag}")
    result.citations = cites.items
    result.data = {"stats": stats}
    return result


def exact_weight(course: str, topic: str) -> str | None:
    """The past-paper fact for exactly this topic (no unit-level fallback), or None."""
    papers = _end_sems(course)
    marks = _topic_marks(papers, topic) if papers else []
    if not any(m for _, m in marks):
        return None
    stat = TopicStat(course=course, topic=topic, scored=0, max=1, marks=marks, exam_weight=0, impact=0,
                     citation_id=past_papers_section_id(course, topic), section_id=None)
    return stat.weight_fact()


def impacts(student_id: str) -> dict[tuple[str, str], int]:
    stats, _ = compute(student_id)
    return {(course_slug(s.course), s.topic): s.impact for s in stats}
