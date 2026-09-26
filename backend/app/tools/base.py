"""What every Academic Coach tool returns: (card, citations, trace), plus the code-computed
facts the compose step may state. Tools never write prose to the student (AGENTS.md §8)."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from app.core.models import Citation, ToolTrace


@dataclass
class ToolResult:
    card: dict[str, Any] | None = None
    cards: list[dict[str, Any]] = field(default_factory=list)   # extra cards, rendered after `card`
    citations: list[Citation] = field(default_factory=list)
    trace: list[ToolTrace] = field(default_factory=list)
    facts: list[str] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def all_cards(self) -> list[dict[str, Any]]:
        return ([self.card] if self.card else []) + self.cards


class Stopwatch:
    """with Stopwatch() as sw: ...  →  sw.ms"""

    def __enter__(self) -> "Stopwatch":
        self._t = time.perf_counter()
        self.ms = 0
        return self

    def __exit__(self, *exc: Any) -> None:
        self.ms = int((time.perf_counter() - self._t) * 1000)


def trace(tool: str, summary: str, ms: float, error: str | None = None) -> ToolTrace:
    return ToolTrace(tool=tool, summary=summary, durationMs=int(ms), error=error)
