from __future__ import annotations

import hashlib
import json
import math
import re
from typing import Iterable


_NON_WORD_RE = re.compile(r"[^a-z0-9]+")
_STOPWORDS = {
    "a", "an", "and", "the", "of", "to", "in", "for", "on", "with",
    "introduction", "overview", "basics",
}


def normalize_label(text: str) -> str:
    lowered = text.strip().lower()
    lowered = _NON_WORD_RE.sub(" ", lowered)
    parts = [part for part in lowered.split() if part and part not in _STOPWORDS]
    return " ".join(parts) or "general"


def slugify(text: str) -> str:
    return normalize_label(text).replace(" ", "-")


def stable_hash(*parts: object) -> str:
    payload = "||".join(str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def json_dumps(value: object) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=True, default=str)


def lexical_overlap_score(text: str, snippets: Iterable[str]) -> float:
    base_tokens = set(normalize_label(text).split())
    if not base_tokens:
        return 0.0

    best = 0.0
    for snippet in snippets:
        snippet_tokens = set(normalize_label(snippet).split())
        if not snippet_tokens:
            continue
        intersection = len(base_tokens & snippet_tokens)
        union = len(base_tokens | snippet_tokens)
        if union:
            best = max(best, intersection / union)
    return best


def clean_study_text(text: str) -> str:
    cleaned = (text or "").replace("\u00a0", " ")
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = re.sub(r"([A-Za-z])\s*\|\s*([A-Za-z])", r"\1 \2", cleaned)
    cleaned = re.sub(r"\bpage\s+\d+\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bchapter\s+\d+\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[_=]{2,}", " ", cleaned)
    return cleaned.strip()


def split_sentences(text: str) -> list[str]:
    normalized = clean_study_text(text)
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if part.strip()]


def sentence_count(text: str) -> int:
    return len(split_sentences(text))


def first_sentence(text: str) -> str:
    parts = split_sentences(text)
    return parts[0] if parts else clean_study_text(text)


def cosine_similarity(left: list[float] | None, right: list[float] | None) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    numerator = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


def unique_preserve_order(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = value.strip()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result
