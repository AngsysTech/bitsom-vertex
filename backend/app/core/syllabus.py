"""Syllabus loader: backend/app/data/syllabus/<course>.md → units → canonical topics.

Expected shape (front matter optional):

    ---
    docId: syllabus.cs-f212
    courseCode: CS F212
    title: ...
    connectorId: lms_moodle
    ---
    ## Unit 4: Transactions and Concurrency Control
    - 4.1 ACID properties            (or "### 4.1 ACID properties")
    Builds on: Serializability.      (optional: earlier topics this one needs)

A topic's section id is ``<docId>.<unit>.<n>`` (``syllabus.cs-f212.4.4``), stable across
runs. Topics are the closed list every model call picks from; a model never names
a topic in free text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache

from app.core.config import DATA_DIR


@dataclass
class Topic:
    id: str            # section id, e.g. syllabus.cs-f212.4.4
    title: str         # canonical topic string, e.g. "Two-phase locking"
    line: str          # the syllabus line as written (citation quote)
    unit_id: str
    unit_title: str
    builds_on: list[str] = field(default_factory=list)  # canonical titles from its "Builds on:" line


@dataclass
class Unit:
    id: str
    number: str
    title: str         # "Unit 4: Transactions and Concurrency Control"
    topics: list[Topic] = field(default_factory=list)


@dataclass
class Syllabus:
    doc_id: str
    course_code: str
    title: str
    connector_id: str
    units: list[Unit]

    @property
    def topics(self) -> list[Topic]:
        return [t for u in self.units for t in u.topics]

    def topic(self, topic_id: str | None) -> Topic | None:
        return next((t for t in self.topics if t.id == topic_id), None)

    def unit(self, unit_id: str | None) -> Unit | None:
        return next((u for u in self.units if u.id == unit_id), None)

    def by_title(self, title: str | None) -> Topic | None:
        key = (title or "").casefold().strip()
        return next((t for t in self.topics if t.title.casefold() == key), None)


def course_slug(course_code: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", course_code.lower()).strip("-")


def _front_matter(text: str) -> tuple[dict[str, str], str]:
    m = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[m.end():]


_NUM = re.compile(r"^(\d+(?:\.\d+)*)[.)]?\s+")
_BUILDS_ON = re.compile(r"^builds on:\s*(.+?)\.?$", re.I)


def _parse(text: str, fallback_code: str, slug: str) -> Syllabus:
    meta, body = _front_matter(text)
    doc_id = meta.get("docId") or f"syllabus.{slug}"
    units: list[Unit] = []
    current: Unit | None = None
    title = meta.get("title") or ""
    for raw in body.splitlines():
        line = raw.strip()
        if line.startswith("# ") and not title:
            title = line[2:].strip()
            continue
        h2 = re.match(r"^##\s+(.*)$", line)
        if h2 and not line.startswith("###"):
            heading = h2.group(1).strip()
            num = re.search(r"\bunit\s+(\d+)", heading, re.I)
            number = num.group(1) if num else str(len(units) + 1)
            current = Unit(id=f"{doc_id}.{number}", number=number, title=heading)
            units.append(current)
            continue
        dep = _BUILDS_ON.match(line)
        if dep and current is not None and current.topics:
            current.topics[-1].builds_on += [d.strip() for d in dep.group(1).split(",") if d.strip()]
            continue
        item = re.match(r"^(?:###\s+|[-*]\s+)(.*)$", line)
        if item and current is not None:
            text_line = item.group(1).strip()
            num = _NUM.match(text_line)
            topic_title = _NUM.sub("", text_line).strip()
            if not topic_title:
                continue
            if num and num.group(1).startswith(current.number + "."):
                sec = num.group(1)
            else:
                sec = f"{current.number}.{len(current.topics) + 1}"
            current.topics.append(Topic(id=f"{doc_id}.{sec}", title=topic_title, line=text_line,
                                        unit_id=current.id, unit_title=current.title))
    syl = Syllabus(doc_id=doc_id, course_code=meta.get("courseCode") or fallback_code,
                   title=title or f"{fallback_code} syllabus",
                   connector_id=meta.get("connectorId") or "lms_moodle",
                   units=[u for u in units if u.topics])
    for t in syl.topics:  # keep only prerequisites that are topics of this same syllabus
        t.builds_on = [p.title for p in map(syl.by_title, t.builds_on) if p and p.title != t.title]
    return syl


@lru_cache(maxsize=32)
def load_syllabus(course_code: str) -> Syllabus | None:
    folder = DATA_DIR / "syllabus"
    if not folder.exists():
        return None
    slug = course_slug(course_code)
    candidates = [folder / f"{slug}.md", folder / f"{slug.replace('-', '_')}.md",
                  folder / f"{slug.replace('-', '')}.md"]
    for path in candidates:
        if path.exists():
            return _parse(path.read_text(encoding="utf-8"), course_code, slug)
    for path in sorted(folder.glob("*.md")):  # match on front-matter courseCode
        text = path.read_text(encoding="utf-8")
        meta, _ = _front_matter(text)
        if course_slug(meta.get("courseCode", "")) == slug:
            return _parse(text, course_code, slug)
    return None
