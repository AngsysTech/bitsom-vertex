"""Closed-choice citations (AGENTS.md §3).

A citation is (sectionId, quote). It is kept only if the section exists, is inside the
agent's scope, and the quote is found verbatim in that section's text; the Citation then
carries the source's own substring. Anything else is dropped and reported, never repaired
into something plausible. Reply text may reference only the ids handed out here: unknown
``[Cn]`` markers are removed and reported.
"""
from __future__ import annotations

import re

from app.core import scope
from app.core.models import Citation
from app.core.parser import section
from app.core.verify import find_verbatim

MARKER = re.compile(r"\[C(\d+)\]")


class CitationSet:
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.items: list[Citation] = []
        self.dropped: list[str] = []

    def add(self, section_id: str, quote: str, *, min_words: int = 3) -> Citation | None:
        found = section(section_id)
        if found is None:
            self.dropped.append(f"{section_id}: no such section")
            return None
        doc, sec = found
        if not scope.allows(self.agent_id, section_id):
            self.dropped.append(f"{section_id}: outside {self.agent_id} scope")
            return None
        exact = find_verbatim(quote, sec.text, min_words=min_words)
        if not exact:
            self.dropped.append(f"{section_id}: quote not verbatim ({quote[:60]!r})")
            return None
        for c in self.items:
            if c.sectionId == sec.id and c.quote == exact:
                return c
        c = Citation(id=f"C{len(self.items) + 1}", docId=doc.id, docTitle=doc.title, sectionId=sec.id,
                     sectionHeading=sec.heading, quote=exact)
        self.items.append(c)
        return c

    def cite_section(self, section_id: str) -> Citation | None:
        """Cite a section by a quote code picks from it: its first sentence."""
        found = section(section_id)
        if found is None:
            self.dropped.append(f"{section_id}: no such section")
            return None
        text = found[1].text
        first = re.split(r"(?<=[.!?])\s+", text.strip(), maxsplit=1)[0]
        return self.add(section_id, first if len(first.split()) >= 3 else text)

    def by_section(self, section_id: str) -> Citation | None:
        return next((c for c in self.items if c.sectionId == section_id), None)

    def listing(self) -> str:
        if not self.items:
            return "(none)"
        return "\n".join(f"[{c.id}] {c.docTitle} › {c.sectionHeading}: \"{c.quote}\"" for c in self.items)


def check_markers(text: str, citations: list[Citation]) -> tuple[str, list[str]]:
    """Remove [Cn] markers that don't name a verified citation. Returns (text, removed)."""
    valid = {c.id for c in citations}
    removed: list[str] = []

    def keep(m: re.Match) -> str:
        cid = f"C{m.group(1)}"
        if cid in valid:
            return m.group(0)
        removed.append(cid)
        return ""

    cleaned = MARKER.sub(keep, text)
    cleaned = re.sub(r"[ \t]+([.,;:])", r"\1", re.sub(r"[ \t]{2,}", " ", cleaned)).strip()
    return cleaned, removed


def used(text: str) -> set[str]:
    return {f"C{n}" for n in MARKER.findall(text)}
