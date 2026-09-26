"""The one STT boundary. transcribe(path) -> list[Segment]. No other module calls an STT provider.

Transcription itself is the jury-approved vendored wrapper
(app/vendored/audio_notes/transcription_service.py). This module picks the
provider, and turns its timestamped output into ~30 s segments s1..sN.

Env:
    STT_PROVIDER        assemblyai | whisper   (default: assemblyai if its key is set)
    ASSEMBLYAI_API_KEY  for assemblyai
    STT_OPENAI_API_KEY  for whisper (falls back to OPENAI_API_KEY)
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from app.core.config import env
from app.vendored.audio_notes.transcription_service import TranscriptionService

TARGET_SEGMENT_SEC = 30.0
TEXT_CHUNK_WORDS = 40
TEXT_WORDS_PER_SEC = 2.5  # synthetic timestamps for the text path (~150 wpm)


class STTError(RuntimeError):
    pass


@dataclass
class Segment:
    id: str
    startSec: float
    endSec: float
    text: str


def provider() -> str:
    p = (env("STT_PROVIDER") or "").lower()
    if p:
        return p
    return "assemblyai" if env("ASSEMBLYAI_API_KEY") else "whisper"


def _settings() -> SimpleNamespace:
    # Only the attributes the vendored wrapper reads.
    return SimpleNamespace(
        assemblyai_api_key=env("ASSEMBLYAI_API_KEY"),
        assemblyai_speaker_labels=True,
        openai_api_key=env("STT_OPENAI_API_KEY") or env("OPENAI_API_KEY"),
    )


def _assemblyai_sentences(transcript_id: str | None) -> list[tuple[float, float, str]]:
    """Sentence timestamps for a finished AssemblyAI transcript (utterances are too coarse
    for a single lecturer)."""
    if not transcript_id:
        return []
    import assemblyai as aai

    aai.settings.api_key = env("ASSEMBLYAI_API_KEY")
    transcript = aai.Transcript.get_by_id(transcript_id)
    return [(s.start / 1000.0, s.end / 1000.0, s.text) for s in transcript.get_sentences()]


def _window(units: list[tuple[float, float, str]], target: float = TARGET_SEGMENT_SEC) -> list[Segment]:
    """Group consecutive timestamped units into ~target-second segments at unit boundaries."""
    segments: list[Segment] = []
    buf: list[tuple[float, float, str]] = []
    for unit in units:
        start, end, text = unit
        if not text or not text.strip():
            continue
        if buf and (end - buf[0][0]) > target * 1.25 and (buf[-1][1] - buf[0][0]) >= target * 0.5:
            segments.append(_flush(buf, len(segments) + 1))
            buf = []
        buf.append((float(start), float(end), text.strip()))
    if buf:
        segments.append(_flush(buf, len(segments) + 1))
    return segments


def _flush(buf: list[tuple[float, float, str]], n: int) -> Segment:
    return Segment(id=f"s{n}", startSec=round(buf[0][0], 2), endSec=round(buf[-1][1], 2),
                   text=" ".join(t for _, _, t in buf))


def transcribe(path: str) -> list[Segment]:
    p = provider()
    settings = _settings()
    try:
        if p == "assemblyai":
            result = TranscriptionService.transcribe_assemblyai(path, settings)
            raw: dict[str, Any] = result.raw
            units = _assemblyai_sentences(raw.get("transcript_id"))
            if not units:
                units = [(u["start"] / 1000.0, u["end"] / 1000.0, u["text"])
                         for u in raw.get("utterances") or [] if u.get("start") is not None]
        elif p in ("whisper", "openai"):
            result = TranscriptionService.transcribe_whisper(path, settings)
            units = [(s["start"], s["end"], s["text"]) for s in result.raw.get("segments") or []]
        else:
            raise STTError(f"unknown STT_PROVIDER '{p}'")
    except STTError:
        raise
    except Exception as exc:
        raise STTError(f"{p} transcription failed: {exc}") from exc
    segments = _window(units)
    if not segments:
        raise STTError(f"{p} returned no timestamped speech")
    return segments


# ---- text fallback path (no STT) --------------------------------------------------

_FRONT_MATTER = re.compile(r"\A---\s*\n.*?\n---\s*\n", re.S)


def clean_transcript_text(text: str) -> str:
    """Drop YAML front matter and markdown heading lines from an uploaded transcript file."""
    text = _FRONT_MATTER.sub("", text or "")
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
    return "\n".join(lines).strip()


def segments_from_text(text: str) -> list[Segment]:
    """~40-word segments cut at sentence boundaries, with synthetic timestamps (~150 wpm).

    Cutting at sentences keeps every sentence inside one segment, so a verbatim quote
    never straddles two segment ids.
    """
    body = re.sub(r"\s+", " ", clean_transcript_text(text)).strip()
    if not body:
        return []
    sentences = re.split(r"(?<=[.!?])\s+", body)
    segments: list[Segment] = []
    buf: list[str] = []
    words_before = 0
    buf_words = 0
    for sentence in sentences:
        n = len(sentence.split())
        if buf and buf_words + n > TEXT_CHUNK_WORDS * 1.3 and buf_words >= TEXT_CHUNK_WORDS * 0.5:
            segments.append(_text_segment(buf, len(segments) + 1, words_before, buf_words))
            words_before += buf_words
            buf, buf_words = [], 0
        buf.append(sentence)
        buf_words += n
    if buf:
        segments.append(_text_segment(buf, len(segments) + 1, words_before, buf_words))
    return segments


def _text_segment(buf: list[str], n: int, words_before: int, words: int) -> Segment:
    return Segment(id=f"s{n}", startSec=round(words_before / TEXT_WORDS_PER_SEC, 1),
                   endSec=round((words_before + words) / TEXT_WORDS_PER_SEC, 1), text=" ".join(buf))
