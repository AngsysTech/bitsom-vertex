"""Provenance checks: a quote must exist verbatim (whitespace-normalised) in its source.

Matching ignores whitespace runs, typographic quote/dash variants and case, then
returns the source's own substring so what we display is the source's exact text.
"""
from __future__ import annotations

import re

_TYPO = str.maketrans({
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"',
    "–": "-", "—": "-", "−": "-", " ": " ",
})
_STRIP = " \t\r\n\"'`“”‘’.…,;:"


def normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _canon_with_map(text: str) -> tuple[str, list[int]]:
    out: list[str] = []
    index: list[int] = []
    prev_space = True
    for i, ch in enumerate(text.translate(_TYPO)):
        if ch.isspace():
            if prev_space:
                continue
            out.append(" ")
            index.append(i)
            prev_space = True
            continue
        for c in ch.casefold():
            out.append(c)
            index.append(i)
        prev_space = False
    while out and out[-1] == " ":
        out.pop()
        index.pop()
    return "".join(out), index


def clean_quote(quote: str) -> str:
    q = normalize_ws(quote)
    q = q.replace("...", " ").replace("…", " ")
    return normalize_ws(q).strip(_STRIP)


def find_verbatim(quote: str, text: str, *, min_words: int = 3) -> str | None:
    """Return the exact substring of ``text`` that ``quote`` matches, or None."""
    q = clean_quote(quote)
    if len(q.split()) < min_words:
        return None
    canon_q, _ = _canon_with_map(q)
    canon_t, index = _canon_with_map(text)
    pos = canon_t.find(canon_q)
    if pos < 0:
        return None
    start = index[pos]
    end = index[pos + len(canon_q) - 1] + 1
    return text[start:end]
