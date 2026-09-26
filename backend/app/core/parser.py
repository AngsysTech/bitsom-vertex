"""Synthetic documents → contracts ``Document`` with stable ``DocumentSection`` ids (AGENTS.md §3).

Markdown (handbook, circulars): one section per ``##`` heading. A numbered heading keeps its
number, so "## 3.2 Graduation requirements" in the handbook is ``handbook.3.2``.
Syllabus: one section per topic, with the ids core/syllabus.py assigns
(``syllabus.cs-f212.1.4``), so the companion, the planner and citations agree.
JSON (catalog, exam calendar, past papers): each record is rendered to plain sentences by
code. The rendering is what the document reader shows, so a quoted span can be checked
verbatim against exactly what the student can open.

Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from typing import Any

from app.core.academics import course_title, exams, norm_topic, past_papers, same_course
from app.core.config import DATA_DIR
from app.core.syllabus import course_slug, load_syllabus


@dataclass
class Section:
    id: str
    heading: str
    text: str

    def dump(self) -> dict[str, Any]:
        return {"id": self.id, "heading": self.heading, "text": self.text}


@dataclass
class Doc:
    id: str
    kind: str            # contracts DocumentKind
    title: str
    connector_id: str
    effective_date: str | None = None
    sections: list[Section] = field(default_factory=list)
    path: str | None = None          # source file, for WorkspaceFile.updatedAt

    def dump(self) -> dict[str, Any]:
        out: dict[str, Any] = {"id": self.id, "kind": self.kind, "title": self.title,
                               "connectorId": self.connector_id,
                               "sections": [s.dump() for s in self.sections]}
        if self.effective_date:
            out["effectiveDate"] = self.effective_date
        return out


def _front_matter(text: str) -> tuple[dict[str, str], str]:
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not m:
        return {}, text
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[m.end():]


def _markdown_sections(doc_id: str, body: str) -> list[Section]:
    sections: list[Section] = []
    heading: str | None = None
    lines: list[str] = []

    def flush() -> None:
        if heading is None:
            return
        num = re.match(r"^(\d+(?:\.\d+)*)\b", heading)
        sid = f"{doc_id}.{num.group(1) if num else len(sections) + 1}"
        text = "\n".join(lines).strip()
        sections.append(Section(id=sid, heading=heading, text=text or heading))

    for raw in body.splitlines():
        h2 = re.match(r"^##\s+(.*)$", raw.strip())
        if h2 and not raw.strip().startswith("###"):
            flush()
            heading, lines = h2.group(1).strip(), []
        elif heading is not None and not raw.strip().startswith("# "):
            lines.append(raw.rstrip())
    flush()
    return sections


def _load_json(name: str) -> Any:
    path = DATA_DIR / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def _handbook() -> list[Doc]:
    path = DATA_DIR / "handbook.md"
    if not path.exists():
        return []
    meta, body = _front_matter(path.read_text(encoding="utf-8"))
    return [Doc(id="handbook", kind="handbook", title=meta.get("title", "Academic Handbook"),
                connector_id=meta.get("connectorId", "erp_core"), effective_date=meta.get("effectiveDate"),
                sections=_markdown_sections("handbook", body), path=str(path))]


def _circulars() -> list[Doc]:
    folder = DATA_DIR / "circulars"
    out: list[Doc] = []
    for path in sorted(folder.glob("*.md")) if folder.exists() else []:
        meta, body = _front_matter(path.read_text(encoding="utf-8"))
        doc_id = f"circular.{path.stem}"
        out.append(Doc(id=doc_id, kind="circular", title=meta.get("title", path.stem),
                       connector_id=meta.get("connectorId", "academic_office"),
                       effective_date=meta.get("effectiveDate"), sections=_markdown_sections(doc_id, body),
                       path=str(path)))
    return out


def _catalog() -> list[Doc]:
    data = _load_json("catalog.json")
    if not data:
        return []
    rows = data.get("courses", []) if isinstance(data, dict) else data
    sections = []
    for c in rows:
        code = c.get("code") or c.get("courseCode") or ""
        parts = [f"{code} {c.get('title', '')}: {c.get('units', c.get('credits', '?'))} units, "
                 f"bucket {str(c.get('bucket', 'unspecified')).replace('_', ' ')}."]
        if c.get("offeredIn"):
            parts.append(f"Offered in semester {', '.join(str(s) for s in c['offeredIn'])}.")
        if c.get("slot"):
            parts.append(f"Slot {c['slot']}.")
        if c.get("faculty"):
            parts.append(f"Faculty: {c['faculty']}.")
        parts.append(f"Prerequisites: {', '.join(c.get('prereqs') or []) or 'none'}.")
        if c.get("skills"):
            parts.append(f"Skills: {', '.join(c['skills'])}.")
        if c.get("description"):
            parts.append(c["description"].strip())
        for fb in c.get("feedback") or []:
            parts.append(f"Student feedback ({fb.get('rating', '?')}/5): {fb.get('blurb', '').strip()}")
        sections.append(Section(id=f"catalog.{course_slug(code)}", heading=f"{code} {c.get('title', '')}".strip(),
                                text=" ".join(parts)))
    connector = data.get("connectorId", "erp_core") if isinstance(data, dict) else "erp_core"
    return [Doc(id="catalog", kind="catalog", title="Course Catalog", connector_id=connector, sections=sections,
                path=str(DATA_DIR / "catalog.json"))]


def _syllabus_bodies(text: str) -> list[tuple[str, str, str]]:
    """(unit heading, topic heading, body) in document order."""
    _, body = _front_matter(text)
    out: list[tuple[str, str, str]] = []
    unit, topic, lines = "", None, []
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("## ") and not line.startswith("###"):
            if topic is not None:
                out.append((unit, topic, " ".join(lines).strip()))
            unit, topic, lines = line[3:].strip(), None, []
        elif line.startswith("### ") or re.match(r"^[-*]\s+", line):
            if topic is not None:
                out.append((unit, topic, " ".join(lines).strip()))
            topic, lines = re.sub(r"^(?:###\s+|[-*]\s+)", "", line).strip(), []
        elif line and topic is not None and not line.startswith("#"):
            lines.append(line)
    if topic is not None:
        out.append((unit, topic, " ".join(lines).strip()))
    return out


def _syllabi() -> list[Doc]:
    folder = DATA_DIR / "syllabus"
    out: list[Doc] = []
    for path in sorted(folder.glob("*.md")) if folder.exists() else []:
        text = path.read_text(encoding="utf-8")
        meta, _ = _front_matter(text)
        syl = load_syllabus(meta.get("courseCode") or path.stem)
        if syl is None:
            continue
        bodies = _syllabus_bodies(text)
        sections = []
        cursor = 0
        for t in syl.topics:
            desc = ""
            for i in range(cursor, len(bodies)):  # same order as the file; titles must agree
                if norm_topic(re.sub(r"^\d+(?:\.\d+)*[.)]?\s+", "", bodies[i][1])) == norm_topic(t.title):
                    desc, cursor = bodies[i][2], i + 1
                    break
            sections.append(Section(id=t.id, heading=f"{t.unit_title} › {t.title}", text=desc or t.line))
        out.append(Doc(id=syl.doc_id, kind="syllabus", title=f"{syl.course_code} {syl.title}",
                       connector_id=syl.connector_id, effective_date=meta.get("effectiveDate"), sections=sections,
                       path=str(path)))
    return out


def fmt_day(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b %Y}"


def _exam_calendar() -> list[Doc]:
    raw = _load_json("exam_calendar.json") or {}
    by_course: dict[str, list] = {}
    for e in exams():
        by_course.setdefault(e.course_code, []).append(e)
    weights = {}
    for c in (raw.get("courses") or []) if isinstance(raw, dict) else []:
        if c.get("weightages"):
            weights[course_slug(c.get("courseCode", ""))] = c["weightages"]
    sections = []
    for code, rows in by_course.items():
        title = course_title(code)
        parts = []
        for e in sorted(rows, key=lambda x: x.start):
            when = f"{fmt_day(e.start.date())} ({e.start.date().isoformat()})"
            if not e.all_day:
                when += f", {e.start:%H:%M}" + (f"–{e.end:%H:%M}" if e.end else "")
            parts.append(f"{code} {e.component}: {when}.")
        w = weights.get(course_slug(code))
        if w:
            parts.append(f"Weightage: quizzes {w.get('quizzes')}%, mid-sem {w.get('midSem')}%, "
                         f"end-sem {w.get('endSem')}%.")
        sections.append(Section(id=f"exam_calendar.{course_slug(code)}",
                                heading=f"{code} {title}".strip() if title else code, text=" ".join(parts)))
    if not sections:
        return []
    return [Doc(id="exam_calendar", kind="exam_calendar", title="Semester 5 Exam Calendar",
                connector_id=raw.get("connectorId", "academic_office") if isinstance(raw, dict) else "academic_office",
                sections=sections, path=str(DATA_DIR / "exam_calendar.json"))]


def past_papers_section_id(course_code: str, topic: str) -> str:
    """Same id format as academics.TopicWeight.citation_id."""
    return f"past_papers.{course_slug(course_code)}.{norm_topic(topic).replace(' ', '-')}"


def _past_papers() -> list[Doc]:
    raw = _load_json("past_papers.json") or {}
    grouped: dict[str, tuple[str, str, list[tuple[int, str, int]]]] = {}
    for p in past_papers():
        for t in p.get("topics", []):
            sid = past_papers_section_id(p.get("courseCode", ""), t.get("topic", ""))
            entry = grouped.setdefault(sid, (p.get("courseCode", ""), t.get("topic", ""), []))
            entry[2].append((int(p.get("year") or 0), str(p.get("exam") or "End-sem"), int(t.get("marks", 0))))
    sections = []
    for sid, (code, topic, rows) in grouped.items():
        rows.sort()
        spans = [f"{marks} marks in the {year} {exam.lower()}" for year, exam, marks in rows]
        listed = spans[0] if len(spans) == 1 else ", ".join(spans[:-1]) + " and " + spans[-1]
        sections.append(Section(id=sid, heading=f"{code} · {topic}", text=f"{topic} ({code}) carried {listed}."))
    if not sections:
        return []
    return [Doc(id="past_papers", kind="past_papers", title="Past papers: topic marks, 2023–2025",
                connector_id=raw.get("connectorId", "academic_office") if isinstance(raw, dict) else "academic_office",
                sections=sections, path=str(DATA_DIR / "past_papers.json"))]


@lru_cache(maxsize=1)
def documents() -> dict[str, Doc]:
    docs: dict[str, Doc] = {}
    for loader in (_handbook, _circulars, _catalog, _syllabi, _exam_calendar, _past_papers):
        for d in loader():
            docs[d.id] = d
    return docs


@lru_cache(maxsize=1)
def _section_index() -> dict[str, tuple[Doc, Section]]:
    return {s.id: (d, s) for d in documents().values() for s in d.sections}


def document(doc_id: str) -> Doc | None:
    return documents().get(doc_id)


def section(section_id: str) -> tuple[Doc, Section] | None:
    return _section_index().get(section_id)


def syllabus_section_id(course_code: str, topic: str) -> str | None:
    syl = load_syllabus(course_code)
    if syl is None:
        return None
    hit = next((t for t in syl.topics if norm_topic(t.title) == norm_topic(topic)), None)
    return hit.id if hit else None


def exam_section_id(course_code: str) -> str | None:
    sid = f"exam_calendar.{course_slug(course_code)}"
    return sid if section(sid) else None


def course_label(course_code: str) -> str:
    title = course_title(course_code)
    return f"{course_code} {title}" if title else course_code


__all__ = ["Doc", "Section", "documents", "document", "section", "syllabus_section_id", "exam_section_id",
           "past_papers_section_id", "course_label", "fmt_day", "same_course"]
