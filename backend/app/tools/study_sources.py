"""Where to study a topic (contracts v3.13 StudySource). Built 26 Sep 2026.

Two kinds, never mixed up:
- university: the syllabus reading list. Code looks the topic up in syllabus/<course>.md and returns its
  "Reading:" line as written, cited to that syllabus section. No model is involved.
- web: one model call (prompts/study_online.md) suggests free pages for the concept. Code keeps the first one
  whose link loads live (HTTP 200) and whose page names the concept. The UI labels it AI-suggested. A suggestion
  that fails the check is dropped and the reason is returned as a note, never shown as a source.
"""
from __future__ import annotations

import html
import logging
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field

from app.core import llm
from app.core.config import PROMPTS_DIR
from app.core.syllabus import load_syllabus

log = logging.getLogger("study_sources")

_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
       "Chrome/126.0 Safari/537.36")
_MAX_BYTES = 800_000
_LINK_TIMEOUT = 5.0
_STOP = {"and", "the", "for", "with", "from", "into", "basics", "what", "your"}
_SOFT_404 = re.compile(r"\b(?:404|not found|page not found|does not exist|no results)\b")

_web_cache: dict[tuple[str, str], dict[str, Any]] = {}  # (course, concept) → a source that passed the check
_web_lock = threading.Lock()


def university(course: str, topic: str | None = None, section_id: str | None = None) -> dict[str, Any] | None:
    """The syllabus reading for a topic (by section id, else by canonical title), or None if it has none."""
    syl = load_syllabus(course) if course else None
    if syl is None:
        return None
    found = (syl.topic(section_id) if section_id else None) or (syl.by_title(topic) if topic else None)
    if found is None or not found.reading:
        return None
    return {"kind": "university", "title": found.reading, "publisher": f"{syl.course_code} syllabus · reading list",
            "citationId": found.id}


class _Suggestion(BaseModel):
    title: str
    url: str
    publisher: str = ""
    why: str = ""


class _Suggestions(BaseModel):
    sources: list[_Suggestion] = Field(default_factory=list)


@lru_cache(maxsize=1)
def _system_prompt() -> str:
    return (PROMPTS_DIR / "study_online.md").read_text(encoding="utf-8")


def _keywords(concept: str) -> list[str]:
    words = [w for w in re.findall(r"[a-z0-9+]+(?:-[a-z0-9+]+)*", concept.lower()) if len(w) >= 4 and w not in _STOP]
    return words or [concept.lower().strip()]


def _check(url: str, keywords: list[str]) -> str | None:
    """None when the link loads and the page names the concept; otherwise why it was dropped."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return "not an http(s) link"
    body = b""
    try:
        with httpx.Client(follow_redirects=True, timeout=_LINK_TIMEOUT,
                          headers={"User-Agent": _UA, "Accept-Language": "en"}) as client:
            with client.stream("GET", url) as res:
                if res.status_code != 200:
                    return f"HTTP {res.status_code}"
                if "pdf" in res.headers.get("content-type", ""):
                    return None  # live lecture notes as a PDF: loading is the check we can afford
                for chunk in res.iter_bytes():
                    body += chunk
                    if len(body) > _MAX_BYTES:
                        break
    except httpx.HTTPError as exc:
        return type(exc).__name__
    text = html.unescape(body.decode("utf-8", "ignore")).lower()
    title = re.search(r"<title[^>]*>(.*?)</title>", text, re.S)
    if title and _SOFT_404.search(title.group(1)):
        return "page says not found"
    if not any(k in text.replace("‐", "-") for k in keywords):
        return "page does not name the topic"
    return None


def web(concept: str, course: str, unit: str | None = None) -> tuple[dict[str, Any] | None, str | None]:
    """(an AI-suggested online source whose link was checked live, or None; a note when none passed)."""
    key = (course.casefold(), concept.casefold())
    with _web_lock:
        if key in _web_cache:
            return _web_cache[key], None
    prompt = f"CONCEPT: {concept}\nCOURSE: {course}" + (f"\nUNIT: {unit}" if unit else "")
    try:
        out = llm.json(prompt, _Suggestions, system=_system_prompt(), max_tokens=1200)
    except Exception as exc:  # the card still ships with the university source; the note says what failed
        log.warning("study_online suggestion failed for %s / %s: %s", course, concept, exc)
        return None, f"the online suggestion failed ({type(exc).__name__})"
    cands: list[_Suggestion] = []
    for s in out.sources:
        if s.url.strip() and s.url.strip() not in {c.url.strip() for c in cands}:
            cands.append(s)
    cands = cands[:4]
    if not cands:
        return None, "the model suggested no online page"
    keywords = _keywords(concept)
    with ThreadPoolExecutor(max_workers=len(cands)) as pool:
        verdicts = list(pool.map(lambda s: _check(s.url.strip(), keywords), cands))
    for s, why_not in zip(cands, verdicts):
        if why_not is None:
            src = {"kind": "web", "title": s.title.strip() or s.url.strip(), "url": s.url.strip(),
                   "publisher": s.publisher.strip() or urlparse(s.url).netloc, "why": s.why.strip() or None}
            src = {k: v for k, v in src.items() if v}
            with _web_lock:
                _web_cache[key] = src
            return src, None
    dropped = "; ".join(f"{urlparse(s.url).netloc or s.url}: {v}" for s, v in zip(cands, verdicts))
    log.info("study_online: no link passed for %s / %s (%s)", course, concept, dropped)
    return None, f"none of the AI-suggested links passed the live check ({dropped})"
