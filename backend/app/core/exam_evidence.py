"""Smart Exam evidence: the synthetic `exam_system` connector's graded answers.

Reads backend/app/data/graded_answers/<student>.json (per-question marks, rubric feedback and a
canonical gapTag) and gap_tags.json (tag → label, kind). Code only: every number and label here
comes from those files; no model writes or changes them.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from typing import Any

from app.core.academics import norm_topic, same_course
from app.core.config import DATA_DIR

WEAK = 0.5  # a topic is weak when the student scored at most half its Smart Exam marks (as internal marks)


@dataclass(frozen=True)
class Gap:
    course: str
    topic: str
    exam: str
    question: str
    date: str
    scored: float
    max: float
    tag: str
    label: str
    feedback: str

    @property
    def lost(self) -> float:
        return self.max - self.scored

    @property
    def fact(self) -> str:
        """"Smart Exam Mid-sem Q4b (08 Sep): 1/4, transitive dependency left in 3NF decomposition"."""
        when = f" ({date.fromisoformat(self.date):%d %b})" if self.date else ""
        return f"Smart Exam {self.exam} {self.question}{when}: {_n(self.scored)}/{_n(self.max)}, {self.label}"


def _n(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def _load(path) -> Any:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


@lru_cache(maxsize=1)
def _tags() -> dict[str, dict[str, Any]]:
    data = _load(DATA_DIR / "gap_tags.json") or {}
    return {t["tag"]: t for t in data.get("tags", [])}


@lru_cache(maxsize=64)
def _rows(student_id: str) -> tuple[dict[str, Any], ...]:
    data = _load(DATA_DIR / "graded_answers" / f"{student_id}.json") or {}
    return tuple(data.get("rows", []))


def topic_rows(student_id: str, course: str, topic: str) -> list[dict[str, Any]]:
    key = norm_topic(topic)
    return [r for r in _rows(student_id)
            if same_course(r.get("courseCode"), course) and norm_topic(r.get("topic", "")) == key]


def concept_gaps(student_id: str, course: str, topic: str) -> list[Gap]:
    """Questions on this topic where a concept mark was lost, most marks lost first."""
    out = []
    for r in topic_rows(student_id, course, topic):
        tag = _tags().get(r.get("gapTag", ""), {})
        if tag.get("kind") != "concept" or not r.get("max") or r["scored"] >= r["max"]:
            continue
        out.append(Gap(course=r["courseCode"], topic=r["topic"], exam=r.get("exam", "exam"),
                       question=r.get("question", ""), date=r.get("date", ""), scored=r["scored"], max=r["max"],
                       tag=r["gapTag"], label=tag.get("label", r["gapTag"]), feedback=r.get("rubricFeedback", "")))
    return sorted(out, key=lambda g: (-g.lost, g.question))


def topic_total(student_id: str, course: str, topic: str) -> tuple[float, float] | None:
    """(scored, max) over every graded question on this topic, gap or not."""
    rows = topic_rows(student_id, course, topic)
    if not rows:
        return None
    return sum(r["scored"] for r in rows), sum(r["max"] for r in rows)


def weak_gaps(student_id: str, course: str, topic: str) -> list[Gap]:
    """Concept gaps on a topic the student is weak in (Smart Exam total at or below WEAK); else []."""
    total = topic_total(student_id, course, topic)
    if not total or not total[1] or total[0] / total[1] > WEAK:
        return []
    return concept_gaps(student_id, course, topic)


def summary_fact(student_id: str, course: str, topic: str) -> str | None:
    """"Smart Exam: lost 8 of 12 marks on Normalization across 3 questions"."""
    total, gaps = topic_total(student_id, course, topic), concept_gaps(student_id, course, topic)
    if not total or not gaps:
        return None
    scored, mx = total
    n = len(topic_rows(student_id, course, topic))
    return f"Smart Exam: lost {_n(mx - scored)} of {_n(mx)} marks on {topic} across {n} question{'s' if n != 1 else ''}"
