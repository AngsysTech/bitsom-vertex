"""Class companion: audio → transcript → handout → coverage → commitments → actions.

Tool of the Academic Coach (AGENTS.md §4.1; types in contracts.ts §9b).

Transcription and note structuring are the jury-approved vendored pipeline
(app/vendored/audio_notes/, see its NOTICE.md), reached through core/stt.py and
companion_bridge.py. Everything in this file was built on 26 Sep 2026: the adapter
into Handout, syllabus mapping, coverage, commitments, actions, notify and accept.

Each step is one function. Each writes its result to SQLite before the next starts.
Every model output is schema-validated. Every segment id, quote and syllabus section
id is verified against its source, and anything that fails is dropped and counted
in the ToolTrace. A failed step fails the lecture with an error; it never produces
a plausible-looking stand-in.
"""
from __future__ import annotations

import logging
import re
import shutil
import threading
from pathlib import Path
from types import SimpleNamespace
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, BinaryIO, Literal, Optional

from pydantic import BaseModel, Field

from app.core import academics, db, exam_evidence, llm, media, records, stt
from app.core.academics import (Exam, TopicWeight, due_iso, iso, lecture_start, next_exam, next_session,
                                norm_topic, resolve_when, topic_weight)
from app.core.config import LECTURES_DIR, PROMPTS_DIR, TZ
from app.core.models import (ActionItem, ActionProvenance, ActionsCard, CalendarItem, Citation, CoverageCard,
                             CoverageCovered, CoverageEmphasized, CoverageMissed, Handout, HandoutDefinition,
                             HandoutSection, Lecture, LectureCommitment, Message, ToolTrace, Transcript,
                             TranscriptSegment, CoverageConfusion, StuckFlag, StuckMarker)
from app.core.records import load_student, topic_marks
from app.core.state import add_plan_block, remove_plan_block
from app.core.syllabus import Syllabus, Topic, load_syllabus
from app.core.threads import append_message, class_thread_id
from app.core.verify import find_verbatim, normalize_ws
from app.tools import calendar as cal
from app.vendored.audio_notes.notes_generation import NotesGenerationService

log = logging.getLogger("companion")

AGENT_ID = "academic_coach"
CONNECTOR_ID = "lms_moodle"
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".webm", ".flac", ".mp4",
              ".mpeg", ".mpga", ".aiff", ".aif", ".caf"}
MEDIA_EXTS = AUDIO_EXTS | media.VIDEO_EXTS  # a lecture video's audio track is extracted locally (core/media.py)
MAX_BUNDLE_SEGMENTS = 10  # the vendored notes prompt reads at most 10 evidence chunks per topic


class NotFound(Exception):
    pass


class BadRequest(Exception):
    pass


class StepError(Exception):
    pass


# ---------------------------------------------------------------------------------
# prompts
# ---------------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _prompts() -> dict[str, str]:
    text = (PROMPTS_DIR / "class_companion.md").read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for block in re.split(r"^## ", text, flags=re.M)[1:]:
        name, _, body = block.partition("\n")
        out[name.strip()] = body.strip()
    return out


def prompt(name: str) -> str:
    return _prompts()[name]


# ---------------------------------------------------------------------------------
# persistence
# ---------------------------------------------------------------------------------

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_lecture(lecture_id: str) -> Lecture:
    body = db.get("lecture", lecture_id)
    if not body:
        raise NotFound(f"lecture {lecture_id} not found")
    return Lecture.model_validate(body)


def _save_lecture(lec: Lecture) -> Lecture:
    db.put("lecture", lec.id, lec.dump(), student_id=lec.studentId)
    return lec


def list_lectures(student_id: str) -> list[dict[str, Any]]:
    return [Lecture.model_validate(b).dump() for b in db.find("lecture", student_id=student_id)]


def get_transcript(lecture_id: str) -> Transcript:
    get_lecture(lecture_id)
    body = db.get("transcript", lecture_id)
    if not body:
        raise NotFound(f"transcript for {lecture_id} not ready")
    return Transcript.model_validate(body)


def get_handout(lecture_id: str) -> Handout:
    lec = get_lecture(lecture_id)
    body = db.get("handout", lecture_id)
    if lec.status != "ready" or not body:
        raise NotFound(f"handout for {lecture_id} not ready (status {lec.status})")
    return Handout.model_validate(body)


def _actions_for(lecture_id: str) -> list[ActionItem]:
    return [ActionItem.model_validate(a) for a in db.find("action", parent_id=lecture_id)]


def get_cards(lecture_id: str) -> dict[str, Any]:
    lec = get_lecture(lecture_id)
    coverage = db.get("coverage", lecture_id)
    commitments = db.get("commitments", lecture_id)
    if lec.status != "ready" or not coverage or commitments is None:
        raise NotFound(f"cards for {lecture_id} not ready (status {lec.status})")
    actions = ActionsCard(lectureId=lecture_id,
                          commitments=[LectureCommitment.model_validate(c) for c in commitments["items"]],
                          items=_actions_for(lecture_id))
    return {"coverage": CoverageCard.model_validate(coverage).dump(), "actions": actions.dump()}


class Tracer:
    """ToolTrace entries for one lecture run, persisted as they happen."""

    def __init__(self, lecture_id: str):
        self.lecture_id = lecture_id
        self.entries: list[ToolTrace] = []
        db.put("trace", lecture_id, {"entries": []})

    def add(self, tool: str, summary: str, ms: float, error: str | None = None) -> None:
        self.entries.append(ToolTrace(tool=tool, summary=summary, durationMs=int(ms), error=error))
        db.put("trace", self.lecture_id, {"entries": [e.dump() for e in self.entries]})


# ---------------------------------------------------------------------------------
# 1. ingest
# ---------------------------------------------------------------------------------

def create_lecture(*, student_id: str, course_code: str, lecture_date: str, title: str | None = None,
                   transcript_text: str | None = None, audio: bytes | BinaryIO | None = None,
                   audio_filename: str | None = None, source: str | None = None) -> Lecture:
    """`audio` is the uploaded file's bytes or an open binary file (streamed to disk, so a long lecture
    video never sits in memory). It may be audio or video; see _store_media."""
    if not student_id or not course_code or not lecture_date:
        raise BadRequest("studentId, courseCode and date are required")
    if load_student(student_id) is None:
        raise NotFound(f"student {student_id} not found")
    try:
        day = date.fromisoformat(lecture_date[:10])
    except ValueError:
        raise BadRequest(f"date must be ISO (got {lecture_date!r})")
    if (transcript_text is None) == (audio is None):
        raise BadRequest("send exactly one of transcriptText or audio")

    lecture_id = f"lec_{uuid.uuid4().hex[:10]}"
    folder = LECTURES_DIR / lecture_id
    audio_url = None
    if transcript_text is not None:
        if not stt.clean_transcript_text(transcript_text):
            raise BadRequest("transcriptText is empty")
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "transcript.txt").write_text(transcript_text, encoding="utf-8")
        src = "transcript"
    else:
        _store_media(folder, audio, audio_filename)
        src = "recording" if source == "recording" else "upload"
        audio_url = f"/lectures/{lecture_id}/audio"
    lec = Lecture(id=lecture_id, studentId=student_id, courseCode=course_code, date=day.isoformat(),
                  title=title, source=src, audioUrl=audio_url, status="uploaded", connectorId=CONNECTOR_ID)
    lec = _save_lecture(lec)
    if src == "upload":
        _import_stuck_chapters(lec)
    return lec


# "I'm stuck: lost at the 2PL diagram" / "Stuck" / "stuck - note". Anything else ("Stuck in traffic") is not a tap.
_STUCK_CHAPTER = re.compile(r"^\s*(?:i['’]?m\s+)?stuck\s*(?:[:\-–—]\s*(?P<note>.*?))?\s*$", re.I)


def _import_stuck_chapters(lec: Lecture) -> None:
    """Stuck taps saved inside the uploaded file, the way phone recorders keep bookmarks: a chapter mark
    titled "I'm stuck: <note>" becomes a StuckMarker at the chapter's start, exactly as if it had been
    tapped live. Other chapters are ignored; a file without chapters changes nothing."""
    marks = [(start, m.group("note")) for start, title in media.chapters(audio_path(lec.id))
             if (m := _STUCK_CHAPTER.match(title))]
    for start, note in marks:
        add_marker(lec.id, start, note)
    if marks:
        log.info("lecture %s: %d stuck marker(s) imported from the file's chapter marks", lec.id, len(marks))


def _store_media(folder: Path, data: bytes | BinaryIO, filename: str | None) -> None:
    """Keep the upload on disk as audio.<ext>, or as video.<ext> when it has a picture track (its audio is
    extracted to audio.m4a at transcribe time). Only a file ffprobe reads as having no sound is refused;
    anything ffprobe can't read goes to STT as before."""
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if filename and "." in filename else ""
    if ext not in MEDIA_EXTS:
        raise BadRequest(f"unsupported file type {ext or '(none)'}; use audio ({', '.join(sorted(AUDIO_EXTS))}) "
                         f"or video ({', '.join(sorted(media.VIDEO_EXTS - AUDIO_EXTS))})")
    folder.mkdir(parents=True, exist_ok=True)
    upload = folder / f"upload{ext}"
    if isinstance(data, (bytes, bytearray)):
        upload.write_bytes(data)
    else:
        with upload.open("wb") as out:
            shutil.copyfileobj(data, out, 1024 * 1024)
    info = media.probe(upload) if upload.stat().st_size else None
    if not upload.stat().st_size or (info is not None and not info.audio):
        shutil.rmtree(folder, ignore_errors=True)
        raise BadRequest("audio file is empty" if info is None else f"{filename} has no audio track to transcribe")
    is_video = info.video if info is not None else ext in media.VIDEO_EXTS - AUDIO_EXTS
    upload.rename(folder / f"{'video' if is_video else 'audio'}{ext}")


def audio_path(lecture_id: str) -> Path:
    """The lecture's audio: the uploaded file, or the track extracted from an uploaded video (the video
    itself until the extraction has run)."""
    folder = LECTURES_DIR / lecture_id
    found = (sorted(folder.glob("audio.*")) or sorted(folder.glob("video.*"))) if folder.exists() else []
    if not found:
        raise NotFound(f"no audio for {lecture_id}")
    return found[0]


def _stt_input(lecture_id: str) -> tuple[Path, str]:
    """(file STT reads, trace note). A video's audio track is extracted locally once and kept next to it
    as audio.m4a, so STT uploads ~20 MB per lecture hour instead of the whole video."""
    path = audio_path(lecture_id)
    if not path.name.startswith("video."):
        return path, ""
    if not media.available():
        return path, f"; {path.suffix} video sent as-is (ffmpeg not installed)"
    out = path.with_name(media.EXTRACTED_AUDIO)
    secs = media.extract_audio(path, out)
    return out, f"; audio track extracted locally from the {path.suffix} video in {secs:.1f}s"


# ---------------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------------

_running: set[str] = set()
_running_lock = threading.Lock()


def start_processing(lecture_id: str) -> tuple[Lecture, bool]:
    """Mark the lecture as processing. Returns (lecture, should_run)."""
    lec = get_lecture(lecture_id)
    with _running_lock:
        if lecture_id in _running or lec.status == "ready":
            return lec, False
        _running.add(lecture_id)
    lec.status = "processing" if lec.source == "transcript" else "transcribing"
    lec.error = None
    return _save_lecture(lec), True


@dataclass
class Ctx:
    lecture: Lecture
    tracer: Tracer
    segments: list[TranscriptSegment] = field(default_factory=list)
    syllabus: Syllabus | None = None
    handout: Handout | None = None
    coverage: CoverageCard | None = None
    commitments: list[LectureCommitment] = field(default_factory=list)
    actions: list[ActionItem] = field(default_factory=list)
    soft_error: str | None = None  # step finished but could not do all of its job
    section_topics: dict[str, list[str]] = field(default_factory=dict)  # handout section → syllabus topic ids
    # missed, but the lecturer said it comes later: topic title → (segment id, verified quote)
    deferred_topics: dict[str, tuple[str, str]] = field(default_factory=dict)
    revisit_ids: set[str] = field(default_factory=set)  # actions that are Smart Exam revisits, due at the next class

    @property
    def seg(self) -> dict[str, TranscriptSegment]:
        return {s.id: s for s in self.segments}


def run_pipeline(lecture_id: str) -> None:
    try:
        _run(lecture_id)
    except Exception:  # never leave a lecture stuck in a running state
        log.exception("companion pipeline crashed for %s", lecture_id)
        lec = get_lecture(lecture_id)
        if lec.status not in ("ready", "failed"):
            lec.status, lec.error = "failed", "internal error; see server log"
            _save_lecture(lec)
    finally:
        with _running_lock:
            _running.discard(lecture_id)


def reload_data() -> None:
    """Pick up dataset files (re)generated while the server runs."""
    load_syllabus.cache_clear()
    for cached in (academics.timetable, academics.exams, academics.past_papers, academics._catalog_titles,
                   records._raw):
        cached.cache_clear()


def _run(lecture_id: str) -> None:
    reload_data()
    ctx = Ctx(lecture=get_lecture(lecture_id), tracer=Tracer(lecture_id))
    ctx.syllabus = load_syllabus(ctx.lecture.courseCode)
    steps = [("transcribe", step_transcribe), ("handout", step_handout), ("coverage", step_coverage),
             ("commitments", step_commitments), ("actions", step_actions), ("markers", step_markers),
             ("notify", step_notify)]
    for name, fn in steps:
        started = time.perf_counter()
        ctx.soft_error = None
        try:
            summary = fn(ctx)
        except Exception as exc:
            error = str(exc) or type(exc).__name__
            log.warning("companion step %s failed for %s: %s", name, lecture_id, error)
            ctx.tracer.add(f"class_companion.{name}", f"failed: {error}", (time.perf_counter() - started) * 1000,
                           error=error)
            _fail(ctx, name, error)
            return
        ctx.tracer.add(f"class_companion.{name}", summary, (time.perf_counter() - started) * 1000,
                       error=ctx.soft_error)
    ctx.lecture.status = "ready"
    _save_lecture(ctx.lecture)
    apply_late_markers(lecture_id)  # taps that arrived while the last steps ran


def _fail(ctx: Ctx, step: str, error: str) -> None:
    lec = ctx.lecture
    lec.status, lec.error = "failed", f"{step}: {error}"
    _save_lecture(lec)
    append_message(lec.studentId, Message(
        id=f"msg_{uuid.uuid4().hex[:10]}", threadId=class_thread_id(lec.studentId, lec.courseCode), role="system",
        agentId=AGENT_ID, createdAt=_utcnow(),
        text=f"Class companion stopped at **{step}** for {lec.courseCode} ({lec.date}): {error}",
        trace=ctx.tracer.entries))


# ---------------------------------------------------------------------------------
# 2. transcribe
# ---------------------------------------------------------------------------------

def step_transcribe(ctx: Ctx) -> str:
    lec = ctx.lecture
    if lec.source == "transcript":
        text = (LECTURES_DIR / lec.id / "transcript.txt").read_text(encoding="utf-8")
        segments = stt.segments_from_text(text)
        how = "text fallback: ~40-word segments at sentence boundaries, synthetic timestamps"
    else:
        lec.status = "transcribing"
        _save_lecture(lec)
        path, note = _stt_input(lec.id)
        segments = stt.transcribe(str(path))
        how = f"{stt.provider()} via vendored audio_notes STT, ~30 s segments{note}"
    if not segments:
        raise StepError("transcript is empty")
    ctx.segments = [TranscriptSegment(id=s.id, startSec=s.startSec, endSec=s.endSec, text=s.text) for s in segments]
    db.put("transcript", lec.id, Transcript(lectureId=lec.id, segments=ctx.segments).dump(),
           student_id=lec.studentId, parent_id=lec.id)
    lec.durationSec = ctx.segments[-1].endSec
    lec.status = "transcribed"
    _save_lecture(lec)
    return f"{len(ctx.segments)} segments, {lec.durationSec / 60:.1f} min ({how})"


# ---------------------------------------------------------------------------------
# 3. handout: topic split → vendored notes → adapter → syllabus mapping
# ---------------------------------------------------------------------------------

class _Part(BaseModel):
    startSegmentId: str
    label: str
    keyTerms: list[str] = Field(default_factory=list)


class _Split(BaseModel):
    parts: list[_Part]


def _segments_block(segments: list[TranscriptSegment]) -> str:
    return "\n".join(f"[{s.id}] {s.text}" for s in segments)


def _topic_split(ctx: Ctx) -> list[tuple[str, list[str], list[TranscriptSegment]]]:
    hint = f"Syllabus topics of {ctx.syllabus.course_code}:\n{_topic_list(ctx.syllabus.topics)}\n\n" \
        if ctx.syllabus else ""
    res = llm.json(f"{hint}Transcript segments:\n{_segments_block(ctx.segments)}", _Split,
                   system=prompt("topic_split"), max_tokens=1500)
    order = {s.id: i for i, s in enumerate(ctx.segments)}
    starts: dict[int, _Part] = {}
    for part in res.parts:
        if part.startSegmentId in order and part.label.strip():
            starts.setdefault(order[part.startSegmentId], part)
    if not starts:
        raise StepError("topic split returned no valid segment ids")
    idx = sorted(starts)
    if idx[0] != 0:  # the first part always starts at the first segment
        starts[0] = starts.pop(idx[0])
        idx = sorted(starts)
    parts = []
    for n, i in enumerate(idx):
        end = idx[n + 1] if n + 1 < len(idx) else len(ctx.segments)
        span = ctx.segments[i:end]
        for k in range(0, len(span), MAX_BUNDLE_SEGMENTS):
            parts.append((normalize_ws(starts[i].label), [normalize_ws(t) for t in starts[i].keyTerms][:6],
                          span[k:k + MAX_BUNDLE_SEGMENTS]))
    return parts


def _notes_input(lec: Lecture, parts) -> tuple[dict[str, Any], dict[str, str], dict[str, set[str]]]:
    """Build the vendored NotesContextResponse payload from transcript parts.

    The vendored code expected topic bundles from its retrieval layer (not copied). Here
    each topic part becomes a bundle and each transcript segment one evidence chunk
    whose evidence_id IS the segment id, so the notes' source refs map back to segments.
    """
    source_id = uuid.uuid5(uuid.NAMESPACE_URL, f"lecture:{lec.id}")
    title = lec.title or f"{lec.courseCode} lecture {lec.date}"
    chunk_to_seg: dict[str, str] = {}
    bundle_segs: dict[str, set[str]] = {}
    topics, bundles = [], []
    for n, (label, terms, segs) in enumerate(parts, 1):
        topic_id = f"{lec.id}-t{n}"
        bundle_segs[topic_id] = {s.id for s in segs}
        chunks = []
        for s in segs:
            chunk_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"lecture:{lec.id}:{s.id}"))
            chunk_to_seg[chunk_id] = s.id
            chunks.append({
                "evidence_id": s.id, "chunk_id": chunk_id, "content": s.text, "support_type": "primary",
                "source_ref": {"source_id": str(source_id), "chunk_id": chunk_id, "title": title,
                               "source_type": "audio", "origin_url": None, "timestamp_start": s.startSec,
                               "timestamp_end": s.endSec, "excerpt": s.text[:240]},
            })
        topics.append({"topic_id": topic_id, "label": label, "summary": label,
                       "recommended_difficulty": "intermediate", "source_count": 1, "evidence_count": len(segs)})
        bundles.append({"topic_id": topic_id, "learning_objective": label, "key_terms": terms,
                        "evidence_chunks": chunks, "source_id": str(source_id), "source_title": title,
                        "content_type": "transcript"})
    payload = {"context_snapshot_id": str(uuid.uuid4()), "topics": topics, "bundles": bundles}
    return payload, chunk_to_seg, bundle_segs


def _adapt(result, chunk_to_seg: dict[str, str], bundle_segs: dict[str, set[str]],
           known: set[str]) -> tuple[list[HandoutSection], list[str], list[str]]:
    """Vendored NoteSection → contracts HandoutSection. Returns (sections, summaries, drops)."""
    sections: list[HandoutSection] = []
    summaries: list[str] = []
    drops: list[str] = []
    for ns in result.sections:
        if not ns.concepts and not ns.key_terms:
            # the vendored code's deterministic fallback after a failed model call
            drops.append(f"'{ns.title[:40]}': fallback notes, not model-structured")
            continue
        allowed = bundle_segs.get(ns.topic_id, set()) & known
        seg_ids: list[str] = []
        for ref in ns.source_refs:
            sid = chunk_to_seg.get(str(ref.chunk_id)) if ref.chunk_id else None
            if sid in allowed and sid not in seg_ids:
                seg_ids.append(sid)
        if not seg_ids:
            drops.append(f"'{ns.title[:40]}': no segment id verifies")
            continue
        definitions: list[HandoutDefinition] = []
        seen: set[str] = set()
        for term, definition in [(k.term, k.definition) for k in ns.key_terms] + \
                                [(c.concept, c.definition) for c in ns.concepts]:
            key = term.strip().casefold()
            if term.strip() and definition.strip() and key not in seen:
                seen.add(key)
                definitions.append(HandoutDefinition(term=term.strip(), definition=definition.strip()))
        sections.append(HandoutSection(
            id=f"h{len(sections) + 1}", heading=normalize_ws(ns.title),
            keyPoints=[normalize_ws(k) for k in ns.key_points if k.strip()][:8],
            definitions=definitions[:8], segmentIds=sorted(seg_ids, key=lambda x: int(x[1:]))))
        summaries.append(normalize_ws(ns.summary))
    return sections, summaries, drops


class _Quote(BaseModel):
    segmentId: str
    quote: str


class _SecMap(BaseModel):
    sectionId: str
    topicIds: list[str] = Field(default_factory=list)
    examHints: list[_Quote] = Field(default_factory=list)
    examples: list[_Quote] = Field(default_factory=list)


class _Map(BaseModel):
    sections: list[_SecMap]


def _topic_list(topics: list[Topic]) -> str:
    return "\n".join(f"- {t.id}: {t.title}  ({t.unit_title})" for t in topics)


def _map_to_syllabus(ctx: Ctx, sections: list[HandoutSection]) -> str:
    syl = ctx.syllabus
    seg = ctx.seg
    blocks = []
    for sec in sections:
        seg_text = "\n".join(f"  [{sid}] {seg[sid].text}" for sid in sec.segmentIds)
        points = "; ".join(sec.keyPoints[:5])
        blocks.append(f"SECTION {sec.id}: {sec.heading}\n  key points: {points}\n  segments:\n{seg_text}")
    res = llm.json(f"Syllabus topics of {syl.course_code} (closed list):\n{_topic_list(syl.topics)}\n\n"
                   f"Handout sections:\n\n" + "\n\n".join(blocks), _Map, system=prompt("syllabus_map"),
                   max_tokens=3000)
    by_id = {s.id: s for s in sections}
    mapped = bad_topic = hint_ok = hint_drop = ex_ok = ex_drop = 0
    for m in res.sections:
        sec = by_id.get(m.sectionId)
        if sec is None:
            continue
        topics = [syl.topic(t) for t in dict.fromkeys(m.topicIds)]
        bad_topic += sum(1 for t in topics if t is None)
        topics = [t for t in topics if t]
        if topics:  # contracts carry the main topic; coverage uses all of them
            sec.syllabusTopic, sec.syllabusSectionId = topics[0].title, topics[0].id
            ctx.section_topics[sec.id] = [t.id for t in topics]
            mapped += 1
        for q, target in [(q, "hint") for q in m.examHints] + [(q, "example") for q in m.examples]:
            exact = find_verbatim(q.quote, seg[q.segmentId].text) if q.segmentId in sec.segmentIds else None
            bucket = sec.examHints if target == "hint" else sec.examples
            if exact and exact not in bucket:
                bucket.append(exact)
                hint_ok, ex_ok = (hint_ok + 1, ex_ok) if target == "hint" else (hint_ok, ex_ok + 1)
            elif not exact:
                hint_drop, ex_drop = (hint_drop + 1, ex_drop) if target == "hint" else (hint_drop, ex_drop + 1)
    note = f"syllabus-mapped {mapped}/{len(sections)}"
    if bad_topic:
        note += f" ({bad_topic} unknown topic id dropped)"
    return note + f"; exam hints {hint_ok} verified/{hint_drop} dropped; examples {ex_ok} verified/{ex_drop} dropped"


def _summary(summaries: list[str]) -> str:
    firsts = [re.split(r"(?<=[.!?])\s+", s)[0] for s in summaries if s]
    picked = firsts[:4]
    if len(picked) < 3:  # short lectures: take more sentences from each section summary
        picked = [x for s in summaries for x in re.split(r"(?<=[.!?])\s+", s)[:2] if x][:4]
    return " ".join(picked)


def step_handout(ctx: Ctx) -> str:
    lec = ctx.lecture
    lec.status = "processing"
    _save_lecture(lec)
    t0 = time.perf_counter()
    parts = _topic_split(ctx)
    t1 = time.perf_counter()
    payload, chunk_to_seg, bundle_segs = _notes_input(lec, parts)
    result = NotesGenerationService().generate_notes(context_payload=payload, request_payload={})
    t2 = time.perf_counter()
    sections, summaries, drops = _adapt(result, chunk_to_seg, bundle_segs, set(ctx.seg))
    if not sections:
        detail = "; ".join(drops + result.warnings[:3]) or "no sections returned"
        raise StepError(f"note structuring produced no verifiable sections ({detail})")
    map_note = "no syllabus for this course; sections not mapped"
    if ctx.syllabus:
        map_note = _map_to_syllabus(ctx, sections)
        map_note += f" (split {t1 - t0:.1f}s, vendored notes {t2 - t1:.1f}s, map {time.perf_counter() - t2:.1f}s)"
    else:
        ctx.soft_error = f"no syllabus found for {lec.courseCode}"
    handout = Handout(id=f"ho_{lec.id}", lectureId=lec.id, courseCode=lec.courseCode,
                      title=normalize_ws(result.generation_title or lec.title or f"{lec.courseCode} lecture"),
                      summary=_summary(summaries), sections=sections, createdAt=_utcnow())
    db.put("handout", lec.id, handout.dump(), student_id=lec.studentId, parent_id=lec.id)
    ctx.handout = handout
    dropped = f"; dropped {len(drops)}: {'; '.join(drops)}" if drops else ""
    return (f"{len(parts)} topic parts → vendored notes → {len(sections)} sections, every segment id "
            f"verified{dropped}; {map_note}")


# ---------------------------------------------------------------------------------
# 4. coverage
# ---------------------------------------------------------------------------------

class _Cov(BaseModel):
    topicId: str
    handoutSectionIds: list[str] = Field(default_factory=list)


class _Miss(BaseModel):
    topicId: str
    why: str
    deferredSegmentId: Optional[str] = None
    deferredQuote: Optional[str] = None


class _Emph(BaseModel):
    topicId: Optional[str] = None
    segmentId: str
    quote: str


class _Coverage(BaseModel):
    covered: list[_Cov] = Field(default_factory=list)
    missed: list[_Miss] = Field(default_factory=list)
    emphasized: list[_Emph] = Field(default_factory=list)


def step_coverage(ctx: Ctx) -> str:
    lec, syl, handout = ctx.lecture, ctx.syllabus, ctx.handout
    card = CoverageCard(lectureId=lec.id, courseCode=lec.courseCode, unit="")
    unit_votes = Counter(syl.topic(s.syllabusSectionId).unit_id for s in handout.sections
                         if syl and s.syllabusSectionId and syl.topic(s.syllabusSectionId))
    if not unit_votes:
        ctx.soft_error = ("no syllabus found for this course" if not syl
                          else "no handout section maps to the syllabus, so coverage was not computed")
        db.put("coverage", lec.id, card.dump(), student_id=lec.studentId, parent_id=lec.id)
        ctx.coverage = card
        return ctx.soft_error
    unit = syl.unit(unit_votes.most_common(1)[0][0])
    card.unit = unit.title
    sections_block = "\n".join(
        f"- {s.id}: {s.heading} | mapped topics: {', '.join(ctx.section_topics.get(s.id, [])) or 'none'} | "
        f"segments: {', '.join(s.segmentIds)} | key points: {'; '.join(s.keyPoints[:4])}" for s in handout.sections)
    res = llm.json(
        f"Unit under review: {unit.title}\nUnit topics (closed list):\n{_topic_list(unit.topics)}\n\n"
        f"All course topics (for emphasized):\n{_topic_list(syl.topics)}\n\n"
        f"Handout sections:\n{sections_block}\n\nTranscript segments:\n{_segments_block(ctx.segments)}",
        _Coverage, system=prompt("coverage"), max_tokens=3000)

    unit_ids = {t.id for t in unit.topics}
    section_ids = {s.id for s in handout.sections}
    covered: dict[str, set[str]] = {}
    for c in res.covered:
        ids = [x for x in c.handoutSectionIds if x in section_ids]
        if c.topicId in unit_ids and ids:
            covered.setdefault(c.topicId, set()).update(ids)
    for s in handout.sections:  # a section mapped to a unit topic in step 3 covers it too
        for tid in ctx.section_topics.get(s.id, []):
            if tid in unit_ids:
                covered.setdefault(tid, set()).add(s.id)
    # "missed" is a claim shown to the student: the model must state it with a reason,
    # and no handout section may map to the topic.
    why = {m.topicId: normalize_ws(m.why) for m in res.missed if m.topicId in unit_ids and m.why.strip()}
    order = {s.id: i for i, s in enumerate(handout.sections)}
    deferred: dict[str, tuple[str, str]] = {}
    for m in res.missed:
        exact = find_verbatim(m.deferredQuote, ctx.seg[m.deferredSegmentId].text) \
            if m.deferredQuote and m.deferredSegmentId in ctx.seg else None
        if exact:
            deferred[m.topicId] = (m.deferredSegmentId, exact)
    unclassified = []
    for t in unit.topics:
        if t.id in covered:
            card.covered.append(CoverageCovered(topic=t.title, handoutSectionIds=sorted(covered[t.id], key=order.get)))
        elif t.id in why:
            reason = why[t.id]
            if t.id in deferred:
                ctx.deferred_topics[t.title] = deferred[t.id]
                reason = f'{reason.rstrip(".")}. The lecturer deferred it: "{deferred[t.id][1]}".'
            card.missed.append(CoverageMissed(topic=t.title, syllabusSectionId=t.id, why=reason))
        else:
            unclassified.append(t.title)
    if unclassified:
        ctx.soft_error = f"model did not classify {unclassified}; left out of covered and missed"
    seg = ctx.seg
    seg_topic = {sid: s.syllabusTopic for s in handout.sections for sid in s.segmentIds if s.syllabusTopic}
    kept = dropped = 0
    for e in res.emphasized:
        exact = find_verbatim(e.quote, seg[e.segmentId].text, min_words=4) if e.segmentId in seg else None
        topic = syl.topic(e.topicId) if e.topicId else None
        title = topic.title if topic else seg_topic.get(e.segmentId)
        if not exact or not title:
            dropped += 1
            continue
        if any(x.segmentId == e.segmentId and x.quote == exact for x in card.emphasized):
            continue
        card.emphasized.append(CoverageEmphasized(topic=title, segmentId=e.segmentId, quote=exact))
        kept += 1
    db.put("coverage", lec.id, card.dump(), student_id=lec.studentId, parent_id=lec.id)
    ctx.coverage = card
    deferred_note = f" (deferred by the lecturer, verified quote: {sorted(ctx.deferred_topics)})" \
        if ctx.deferred_topics else ""
    return (f"{unit.title}: {len(card.covered)}/{len(unit.topics)} topics covered, missed "
            f"{[m.topic for m in card.missed] or 'none'}{deferred_note}; emphasized {kept} verified quotes, "
            f"{dropped} dropped")


# ---------------------------------------------------------------------------------
# 5. commitments
# ---------------------------------------------------------------------------------

class _When(BaseModel):
    type: Literal["next_lecture", "next_week", "weekday", "date", "exam", "none"] = "none"
    weekday: Optional[str] = None
    month: Optional[int] = None
    day: Optional[int] = None
    exam: Optional[str] = None


class _Commit(BaseModel):
    kind: Literal["next_lecture_topic", "assignment", "reading", "deadline", "exam_hint"]
    text: str
    segmentId: str
    quote: str
    when: _When = Field(default_factory=_When)


class _Commits(BaseModel):
    commitments: list[_Commit] = Field(default_factory=list)


def _lecture_at(lec: Lecture) -> datetime:
    return lecture_start(lec.courseCode, date.fromisoformat(lec.date))


def step_commitments(ctx: Ctx) -> str:
    lec = ctx.lecture
    lecture_at = _lecture_at(lec)
    res = llm.json(f"Lecture: {lec.courseCode}, {lecture_at:%A %d %B %Y}.\nTranscript segments:\n"
                   f"{_segments_block(ctx.segments)}", _Commits, system=prompt("commitments"), max_tokens=2500)
    seg = ctx.seg
    out: list[LectureCommitment] = []
    dropped = 0
    unresolved: list[str] = []
    for c in res.commitments:
        exact = find_verbatim(c.quote, seg[c.segmentId].text) if c.segmentId in seg else None
        if not exact:
            dropped += 1
            continue
        due, how = (None, "no time said") if c.when.type == "none" else \
            resolve_when(c.when.model_dump(), lec.courseCode, lecture_at, exact, context=seg[c.segmentId].text)
        if c.when.type != "none" and not due:
            unresolved.append(f"{c.kind}: {how}")
        out.append(LectureCommitment(id=f"cm_{lec.id[4:]}_{len(out) + 1}", lectureId=lec.id, kind=c.kind,
                                     text=normalize_ws(c.text), dueBy=due, segmentId=c.segmentId, quote=exact))
    db.put("commitments", lec.id, {"items": [c.dump() for c in out]}, student_id=lec.studentId, parent_id=lec.id)
    ctx.commitments = out
    kinds = Counter(c.kind for c in out)
    note = f"{len(out)} verified ({dict(kinds)}), {dropped} dropped (quote not verbatim)"
    if unresolved:
        note += f"; dueBy left empty for {len(unresolved)}: {'; '.join(unresolved)}"
    return note


# ---------------------------------------------------------------------------------
# 6. actions
# ---------------------------------------------------------------------------------
#
# The model titles and explains candidates that code built. Code then decides what the card
# holds: every action's topic is a canonical syllabus topic wherever one applies, there is
# one action per (topic, kind), and every missed topic gets its action even when the model
# left it out. Actions built that way are marked "origin: guaranteed" in the trace only.

ACTIONS_SEED = 212  # fixed seed for the actions call; the API treats it as best effort


@dataclass
class _Cand:
    id: str
    kind: str
    topic: str
    context: str
    facts: list[str]
    provenance: dict[str, str]
    due: str | None
    canonical: bool = False  # topic is a syllabus topic fixed by code; the model's topicId can't change it
    revisit: str | None = None  # Smart Exam gap: the topic taught (or promised) that builds on this one


@dataclass
class _Need:
    """The action one missed topic must end up with."""
    kind: str                         # "study", or "prep" when deferred to a session still ahead
    due: str | None                   # study: the next assessment; prep: the session the lecturer named
    note: str                         # how that was decided, for the trace
    segment_id: str | None = None     # segment of the verified deferral quote
    commitment_id: str | None = None  # the next_lecture_topic commitment that is the same sentence


class _ItemOut(BaseModel):
    candidateId: str
    title: str
    why: str
    minutes: int = 45
    topicId: Optional[str] = None
    mergedIds: list[str] = Field(default_factory=list)


class _AskOut(BaseModel):
    candidateId: str
    title: str
    why: str
    minutes: int = 15


class _Actions(BaseModel):
    items: list[_ItemOut] = Field(default_factory=list)
    asks: list[_AskOut] = Field(default_factory=list)


_KIND_FACT = {"study": "Not taught in this lecture", "review": "The lecturer stressed it",
              "prep": "It is the next lecture's topic", "deadline": "Set by the lecturer",
              "resource": "Named by the lecturer", "ask": "Worth clarifying in class"}


def _student_fact(student_id: str, course: str, topic: str) -> tuple[str | None, float | None]:
    rows = topic_marks(student_id, course, topic)
    if not rows:
        return None, None
    r = sorted(rows, key=lambda x: x.get("date", ""))[-1]
    pct = r["scored"] / r["max"] if r.get("max") else None
    when = f" ({date.fromisoformat(r['date']):%d %b})" if r.get("date") else ""
    return f"you scored {r['scored']}/{r['max']} on it in {r.get('component', 'an internal')}{when}", pct


def _facts_for(ctx: Ctx, topic: str, exam: Exam | None) -> tuple[list[str], dict[str, str]]:
    """Past-paper marks, the student's own marks and the next assessment, all computed."""
    course = ctx.lecture.courseCode
    facts, prov = [], {}
    w: TopicWeight | None = topic_weight(course, topic)
    if w:
        facts.append(w.fact)
        prov["pastPapersCitationId"] = w.citation_id
    sf, _ = _student_fact(ctx.lecture.studentId, course, topic)
    if sf:
        facts.append(sf)
    gaps = exam_evidence.weak_gaps(ctx.lecture.studentId, course, topic)
    if gaps:  # the Smart Exam's rubric: which questions lost concept marks, and on what
        facts += [g.fact for g in gaps[:2]]
        prov["gapTags"] = [g.tag for g in gaps]
    if exam:
        facts.append(f"next {course} assessment: {exam.title} on {exam.start:%a %d %b}")
    return facts, prov


def _words(text: str) -> str:
    """Lower-case words with a plural 's' dropped: how a topic title is found in a quote."""
    return " ".join(w[:-1] if len(w) > 3 and w.endswith("s") else w
                    for w in re.sub(r"[^a-z0-9]+", " ", (text or "").casefold()).split())


def _same_sentence(a: str, b: str) -> bool:
    """Two verified quotes are the same statement: most words of the shorter are in the longer."""
    short, long = sorted((_words(a).split(), _words(b).split()), key=len)
    words = set(long)
    return bool(short) and sum(w in words for w in short) >= 0.6 * len(short)


def _topic_named_in(ctx: Ctx, quote: str) -> str | None:
    """The syllabus topic whose title the lecturer said in ``quote``, when exactly one is."""
    said = f" {_words(quote)} "
    hits = {t.title for t in (ctx.syllabus.topics if ctx.syllabus else []) if f" {_words(t.title)} " in said}
    return hits.pop() if len(hits) == 1 else None


def _commitment_topic(ctx: Ctx, cm: LectureCommitment) -> str | None:
    """A commitment's canonical topic when code can tell: the missed topic whose verified
    deferral is this same sentence, else the one syllabus topic its quote names."""
    for topic, (seg_id, quote) in ctx.deferred_topics.items():
        if cm.segmentId == seg_id and _same_sentence(cm.quote, quote):
            return topic
    return _topic_named_in(ctx, cm.quote)


def _named_session(ctx: Ctx, seg_id: str, quote: str) -> tuple[str | None, str | None, str]:
    """When a deferred topic will be taught: (dueBy, commitment id, how). The dueBy of the
    next_lecture_topic commitment that is the same sentence, else the quote resolved against
    the timetable, else the next session (the default a prep commitment gets too)."""
    lec = ctx.lecture
    lecture_at = _lecture_at(lec)
    cm = next((c for c in ctx.commitments if c.kind == "next_lecture_topic" and c.segmentId == seg_id
               and _same_sentence(c.quote, quote)), None)
    cm_id = cm.id if cm else None
    if cm and cm.dueBy:
        return cm.dueBy, cm_id, f"as commitment {cm.id}"
    said = quote.lower()
    when = "next_week" if "next week" in said else \
        "next_lecture" if re.search(r"\b(next|tomorrow|following)\b", said) else None
    if when:
        due, how = resolve_when({"type": when}, lec.courseCode, lecture_at, quote,
                                context=ctx.seg[seg_id].text if seg_id in ctx.seg else "")
        if due:
            return due, cm_id, how
    s = next_session(lec.courseCode, lecture_at)
    return (iso(s.start), cm_id, "no session named, so the next one") if s else \
        (None, cm_id, "the timetable has no later session")


def _revisit_targets(ctx: Ctx) -> dict[str, tuple[str, str, str | None]]:
    """Topics with a Smart Exam concept gap that this lecture taught again, or that a topic it
    taught (or promised for the next lecture) builds on, per the syllabus's "Builds on" lines.
    Returns target → (context for the model, the topic that builds on it, segmentId)."""
    syl, cov, lec = ctx.syllabus, ctx.coverage, ctx.lecture
    if not syl:
        return {}
    taught: dict[str, tuple[str, str | None]] = {}  # topic → (how, segment where it came up)
    for s in ctx.handout.sections if ctx.handout else []:
        if s.syllabusTopic:
            taught.setdefault(s.syllabusTopic, ("taught in this lecture", s.segmentIds[0] if s.segmentIds else None))
    for c in cov.covered if cov else []:
        taught.setdefault(c.topic, ("taught in this lecture", None))
    for cm in ctx.commitments:
        topic = _commitment_topic(ctx, cm) if cm.kind == "next_lecture_topic" else None
        if topic:
            taught.setdefault(topic, ("promised for the next lecture", cm.segmentId))
    out: dict[str, tuple[str, str, str | None]] = {}
    for topic, (how, seg) in taught.items():
        t = syl.by_title(topic)
        for base in ([t.title] + t.builds_on) if t else []:
            if base in out or not exam_evidence.weak_gaps(lec.studentId, lec.courseCode, base):
                continue
            if base == t.title:
                why = (f"Smart Exam shows a concept gap in {base}, which was {how}: "
                       f"revisit that gap before the next class builds on it")
            else:
                why = (f"Smart Exam shows a concept gap in {base}; {t.title} ({how}) builds on it "
                       f"per the syllabus: revisit {base} before learning {t.title}")
            out[base] = (why, t.title, seg)
    return out


def _missed_needs(ctx: Ctx, exam: Exam | None, now: datetime) -> dict[str, _Need]:
    """Every missed topic needs one study action due before the next assessment. One the
    lecturer deferred to a session still ahead needs a prep action due by that session
    instead. A deferral to a session that has already happened no longer covers the gap."""
    exam_due = due_iso(exam) if exam else None
    needs: dict[str, _Need] = {}
    for m in ctx.coverage.missed if ctx.coverage else []:
        if m.topic not in ctx.deferred_topics:
            needs[m.topic] = _Need("study", exam_due, "not taught in this lecture")
            continue
        seg_id, quote = ctx.deferred_topics[m.topic]
        due, cm_id, how = _named_session(ctx, seg_id, quote)
        at = cal.parse_iso(due)
        if at and at > now:
            needs[m.topic] = _Need("prep", due, f"the lecturer deferred it to {at:%a %d %b %H:%M}, {how}", seg_id, cm_id)
        else:
            note = f"the lecturer deferred it to {at:%a %d %b}, which has passed" if at else \
                f"the lecturer deferred it, but {how}"
            needs[m.topic] = _Need("study", exam_due, note, seg_id, cm_id)
    return needs


def _candidates(ctx: Ctx, needs: dict[str, _Need], exam: Exam | None,
                now: datetime) -> tuple[list[_Cand], list[str]]:
    lec, cov = ctx.lecture, ctx.coverage
    course, student = lec.courseCode, lec.studentId
    lecture_at = _lecture_at(lec)
    session = next_session(course, lecture_at)
    exam_due = due_iso(exam) if exam else None
    session_due = iso(session.start) if session else None
    syl = ctx.syllabus
    by_title = {t.title: t for t in syl.topics} if syl else {}
    cands: list[_Cand] = []
    notes: list[str] = []
    topics_seen: set[str] = set()

    def facts_for(topic: str) -> tuple[list[str], dict[str, str]]:
        return _facts_for(ctx, topic, exam)

    for m in cov.missed if cov else []:
        need = needs[m.topic]
        if need.kind == "prep":
            continue  # deferred to a session still ahead: its commitment becomes the prep action
        facts, prov = facts_for(m.topic)
        if need.segment_id:  # deferred to a session that has already happened
            facts.insert(0, need.note)
        cands.append(_Cand(f"c{len(cands) + 1}", "study", m.topic, f"Not taught in this lecture: {m.why}", facts,
                           {"syllabusSectionId": m.syllabusSectionId, **prov}, exam_due, canonical=True))
        topics_seen.add(m.topic)
    for e in cov.emphasized if cov else []:
        if e.topic in topics_seen:
            continue
        facts, prov = facts_for(e.topic)
        sec_id = by_title[e.topic].id if e.topic in by_title else None
        cands.append(_Cand(f"c{len(cands) + 1}", "review", e.topic, f'Lecturer said: "{e.quote}"', facts,
                           {"segmentId": e.segmentId, **({"syllabusSectionId": sec_id} if sec_id else {}), **prov},
                           exam_due, canonical=True))
        topics_seen.add(e.topic)
    # Smart Exam evidence: a concept gap this lecture re-taught or builds on → revisit it before the next class
    ahead = next_session(course, max(lecture_at, now))
    ahead_due = iso(ahead.start) if ahead else exam_due
    next_fact = f"next {course} class: {ahead.start:%a %d %b, %H:%M}" if ahead else None
    for base, (context, builds, seg) in _revisit_targets(ctx).items():
        if base not in by_title:
            continue
        have = next((c for c in cands if c.topic == base and c.kind in ("review", "study")), None)
        if have is not None:  # already stressed or skipped: that candidate becomes the revisit, due before the next class
            have.revisit, have.due, have.context = builds, ahead_due, f"{context}. {have.context}"
            have.facts += [next_fact] if next_fact else []
            continue
        if base in topics_seen:
            continue
        facts, prov = facts_for(base)
        facts += [next_fact] if next_fact else []
        cands.append(_Cand(f"c{len(cands) + 1}", "review", base, context, facts,
                           {"syllabusSectionId": by_title[base].id, **({"segmentId": seg} if seg else {}), **prov},
                           ahead_due, canonical=True, revisit=builds))
        topics_seen.add(base)
    # the student's own weak spots among what this lecture covered
    for c in cov.covered if cov else []:
        if c.topic in topics_seen:
            continue
        sf, pct = _student_fact(student, course, c.topic)
        if sf and pct is not None and pct <= 0.5:
            facts, prov = facts_for(c.topic)
            sec_id = by_title[c.topic].id if c.topic in by_title else None
            cands.append(_Cand(f"c{len(cands) + 1}", "review", c.topic,
                               f"Covered in this lecture; the student is weak on it", facts,
                               {**({"syllabusSectionId": sec_id} if sec_id else {}), **prov}, exam_due,
                               canonical=True))
            topics_seen.add(c.topic)
    # the student's weakest high-weight topics in this course, from internal marks × past papers
    weak: list[tuple[float, str]] = []
    for t in (syl.topics if syl else []):
        if t.title in topics_seen:
            continue
        sf, pct = _student_fact(student, course, t.title)
        w = topic_weight(course, t.title)
        if sf and pct is not None and pct <= 0.5 and w:
            weak.append(((1 - pct) * w.max_marks, t.title))
    for _, title in sorted(weak, reverse=True)[:2]:
        facts, prov = facts_for(title)
        cands.append(_Cand(f"c{len(cands) + 1}", "review", title,
                           "Weak in the student's internal marks (not from this lecture)", facts,
                           {"syllabusSectionId": by_title[title].id, **prov}, exam_due, canonical=True))
        topics_seen.add(title)
    emph_segments = {e.segmentId for e in (cov.emphasized if cov else [])}
    for cm in ctx.commitments:
        if cm.kind == "exam_hint" and cm.segmentId in emph_segments:
            continue  # already a review candidate from the same sentence
        kind = {"next_lecture_topic": "prep", "assignment": "deadline", "deadline": "deadline",
                "reading": "resource", "exam_hint": "review"}[cm.kind]
        if kind == "deadline" and not cm.dueBy:
            kind = "review"  # work set without a date is practice, due before the next assessment
        topic = _commitment_topic(ctx, cm)
        need = needs.get(topic) if topic else None
        if kind == "prep" and need and need.kind == "prep":
            due = need.due  # the session this missed topic was deferred to
        else:
            due = cm.dueBy if kind == "deadline" else (cm.dueBy or session_due) if kind in ("prep", "resource") \
                else exam_due
        if kind == "prep" and cal.parse_iso(due) and cal.parse_iso(due) < now:
            notes.append(f"no prep for '{cm.text[:50]}': that session ({_fmt_due(due)}) has already happened")
            continue
        due_dt = cal.parse_iso(due)
        facts = []
        if due_dt and kind in ("prep", "resource"):
            facts.append(f"next {course} lecture: {due_dt:%a %d %b, %H:%M}")
        elif due_dt and kind == "deadline":
            facts.append(f"due {due_dt:%a %d %b} as said in class")
        prov = {"segmentId": cm.segmentId, "commitmentId": cm.id}
        if topic in by_title:
            prov["syllabusSectionId"] = by_title[topic].id
        cands.append(_Cand(f"c{len(cands) + 1}", kind, topic or cm.text, f'Lecturer said: "{cm.quote}"', facts,
                           prov, due, canonical=topic is not None))
    return cands, notes


_NUMBER = re.compile(r"(?<![A-Za-z])\d+(?![A-Za-z])")  # a figure; "3NF", "2PL" and "Q4b" are names, not figures


_NEXT_CLASS = re.compile(r"\s*\b(?:before|by|for) (?:the |your )?next (?:class|lecture|session)\b", re.I)


def _honest_title(title: str, cand: "_Cand", kind: str, due: str | None, exam: Exam | None) -> str:
    """Only a Smart Exam revisit is due at the next class. A review or study title that says so is re-dated to
    what it is really due by (the next assessment), in code."""
    if cand.revisit or kind not in ("review", "study") or not _NEXT_CLASS.search(title):
        return title
    at = cal.parse_iso(due)
    label = exam.title if exam and due == due_iso(exam) else (f"{at:%a %d %b}" if at else None)
    return _NEXT_CLASS.sub(f" before {label}" if label else "", title).strip()


def _why_clause(text: str, kind: str, fallback: str | None = None) -> str:
    clause = normalize_ws(text).rstrip(".;")
    if _NUMBER.search(clause):  # numbers must come from code, never the model
        clause = ", ".join(p for p in re.split(r",|;", clause) if not _NUMBER.search(p)).strip()
    return clause or fallback or _KIND_FACT[kind]


def _fallback_clause(cand: "_Cand") -> str | None:
    """What an emptied clause falls back to when the kind's default would misstate the reason."""
    if cand.revisit:
        return f"{cand.revisit} builds on it" if norm_topic(cand.revisit) != norm_topic(cand.topic) \
            else "Your Smart Exam gap is in what this lecture taught"
    if cand.kind == "review" and cand.context.startswith(("Weak in", "Covered in this lecture; the student is weak")):
        return "You are weak on it in your internal marks"
    return None


def _dedupe(items: list[ActionItem], order: dict[str, int]) -> tuple[list[ActionItem], list[str]]:
    """One action per (topic, kind): the one due first stays, then the one from the earlier
    candidate (coverage and marks come before commitments). The others are dropped."""
    kept: dict[tuple[str, str], ActionItem] = {}
    dropped: list[str] = []
    for a in sorted(items, key=lambda a: (a.dueBy or "9999", order.get(a.id, 0))):
        key = (norm_topic(a.topic), a.kind)
        if key in kept:
            dropped.append(f"{a.kind} '{a.title}' (same as '{kept[key].title}')")
        else:
            kept[key] = a
    return list(kept.values()), dropped


def _guaranteed_action(ctx: Ctx, m: CoverageMissed, need: _Need, exam: Exam | None) -> ActionItem:
    """Template action for a missed topic the model gave none. Every figure and date is computed."""
    lec = ctx.lecture
    if need.kind == "study":
        facts, prov = _facts_for(ctx, m.topic, exam)
        if need.segment_id:
            facts.insert(0, need.note)
        title, minutes, why = f"Self-study {m.topic}", 45, "; ".join([_KIND_FACT["study"]] + facts)
        provenance = {"syllabusSectionId": m.syllabusSectionId, **prov}
    else:
        at = cal.parse_iso(need.due)
        title, minutes = f"Preview {m.topic} before the {at:%a %d %b} lecture", 30
        why = f"The lecturer deferred it to that lecture; {lec.courseCode} lecture: {at:%a %d %b, %H:%M}"
        provenance = {"segmentId": need.segment_id, "syllabusSectionId": m.syllabusSectionId,
                      "commitmentId": need.commitment_id}
    return ActionItem(id=f"act_{uuid.uuid4().hex[:10]}", lectureId=lec.id, kind=need.kind, title=title,
                      course=lec.courseCode, topic=m.topic, minutes=minutes, dueBy=need.due, why=why,
                      provenance=ActionProvenance(**provenance))


def _guarantee(ctx: Ctx, items: list[ActionItem], needs: dict[str, _Need], exam: Exam | None,
               now: datetime) -> tuple[list[str], list[str]]:
    """Give every missed topic its one study action, or its prep action due by the session it
    was deferred to. Returns (trace notes for guaranteed actions, dueBy fixes)."""
    made: list[str] = []
    fixed: list[str] = []
    for m in ctx.coverage.missed if ctx.coverage else []:
        need = needs[m.topic]
        have = next((a for a in items if a.kind == need.kind and norm_topic(a.topic) == norm_topic(m.topic)), None)
        if have is not None:
            if need.kind == "prep" and not (have.dueBy and cal.parse_iso(have.dueBy) <= cal.parse_iso(need.due)):
                fixed.append(f"prep '{m.topic}' dueBy {have.dueBy} → {need.due}, the session it was deferred to")
                have.dueBy = need.due
            continue
        action = _guaranteed_action(ctx, m, need, exam)
        items.append(action)
        # accepting it places a block with the same clash-free slot finder; say if none is free yet
        due = cal.parse_iso(action.dueBy)
        full = due is not None and cal.find_slot(ctx.lecture.studentId, action.minutes or 45, now, due) is None
        made.append(f"{action.kind} '{m.topic}' {action.id} ({need.note}"
                    + (f"; no free evening slot before {due:%a %d %b} yet" if full else "") + ")")
    return made, fixed


def _guarantee_revisits(ctx: Ctx, items: list[ActionItem], cands: list[_Cand]) -> list[str]:
    """Every Smart Exam revisit candidate ends up as a review action, even when the model left it out.
    The template's clause has no numbers; every figure after it is a computed fact."""
    made: list[str] = []
    lec = ctx.lecture
    for c in cands:  # a skipped (study) revisit is already guaranteed by _guarantee
        if not c.revisit or c.kind != "review" or \
                any(a.kind == "review" and norm_topic(a.topic) == norm_topic(c.topic) for a in items):
            continue
        same = norm_topic(c.revisit) == norm_topic(c.topic)
        title = f"Revisit your {c.topic} gap before the next class" if same else f"Revisit {c.topic} before {c.revisit}"
        lead = "Your Smart Exam gap is in what this lecture taught" if same else f"{c.revisit} builds on it"
        action = ActionItem(id=f"act_{uuid.uuid4().hex[:10]}", lectureId=lec.id, kind="review", title=title,
                            course=lec.courseCode, topic=c.topic, minutes=30, dueBy=c.due,
                            why="; ".join([lead] + c.facts), provenance=ActionProvenance(**c.provenance))
        items.append(action)
        ctx.revisit_ids.add(action.id)
        made.append(f"review '{c.topic}' {action.id} (Smart Exam gap; {c.revisit} builds on it)")
    return made


def step_actions(ctx: Ctx) -> str:
    lec = ctx.lecture
    now = datetime.now(TZ)
    exam = next_exam(lec.courseCode, max(_lecture_at(lec), now))
    ctx.revisit_ids = set()
    needs = _missed_needs(ctx, exam, now)
    cands, notes = _candidates(ctx, needs, exam, now)
    for old in _actions_for(lec.id):  # re-processing replaces the proposals
        db.delete("action", old.id)
    by_id = {c.id: c for c in cands}
    res = _Actions()
    if cands:
        listing = "\n".join(
            f"- {c.id} | kind={c.kind} | topic={c.topic} | {c.context}" + (f" | facts: {'; '.join(c.facts)}" if c.facts else "")
            for c in cands)
        student = load_student(lec.studentId) or {}
        topics = _topic_list(ctx.syllabus.topics) if ctx.syllabus else "(no syllabus)"
        # temperature 0 where the model allows it (llm.py falls back to the default where it doesn't)
        res = llm.json(f"Student: {student.get('name', lec.studentId)}, goal: {student.get('careerGoal', 'n/a')}.\n"
                       f"Course: {lec.courseCode}. Lecture of {lec.date}.\n\nCandidates:\n{listing}\n\n"
                       f"Syllabus topics (closed list, optional topicId for an item):\n{topics}",
                       _Actions, system=prompt("actions"), max_tokens=2500, temperature=0.0, seed=ACTIONS_SEED)
    # the syllabus mapping coverage uses for emphasized quotes: segment → its handout section's topic
    seg_topic = {sid: s.syllabusTopic for s in (ctx.handout.sections if ctx.handout else [])
                 for sid in s.segmentIds if s.syllabusTopic}
    retopic: Counter[str] = Counter()
    used: set[str] = set()
    items: list[ActionItem] = []
    order: dict[str, int] = {}  # action id → position of its candidate

    def topic_of(cand: _Cand, topic_id: str | None) -> str:
        if cand.canonical:
            return cand.topic
        picked = ctx.syllabus.topic(topic_id) if topic_id and ctx.syllabus else None
        if picked:
            retopic["the model's topicId"] += 1
            return picked.title
        if cand.provenance.get("segmentId") in seg_topic:
            retopic["its handout section"] += 1
            return seg_topic[cand.provenance["segmentId"]]
        retopic["none (no syllabus topic applies)"] += 1
        return cand.topic

    def make(cand: _Cand, kind: str, title: str, why: str, minutes: int, topic_id: str | None) -> ActionItem:
        due = cand.due
        if kind == "ask":  # take it to the next class that hasn't happened yet
            due = next_session(lec.courseCode, max(_lecture_at(lec), now))
            due = iso(due.start) if due else None
        title = _honest_title(normalize_ws(title), cand, kind, due, exam)
        item = ActionItem(id=f"act_{uuid.uuid4().hex[:10]}", lectureId=lec.id, kind=kind,
                          title=title[:120], course=lec.courseCode, topic=topic_of(cand, topic_id),
                          minutes=max(10, min(int(minutes or 45), 180)), dueBy=due,
                          why="; ".join([_why_clause(why, kind, _fallback_clause(cand))] + cand.facts),
                          provenance=ActionProvenance(**cand.provenance))
        order[item.id] = int(cand.id[1:])
        if cand.revisit and kind == cand.kind:
            ctx.revisit_ids.add(item.id)
        return item

    for it in res.items:
        cand = by_id.get(it.candidateId)
        if not cand or cand.id in used:
            continue
        used.add(cand.id)
        for mid in it.mergedIds:
            if mid in by_id and mid not in used and by_id[mid].kind not in ("study", "deadline"):
                used.add(mid)
        items.append(make(cand, cand.kind, it.title, it.why, it.minutes, it.topicId))
    for ask in res.asks[:2]:
        cand = by_id.get(ask.candidateId)
        if cand:
            items.append(make(cand, "ask", ask.title, ask.why, ask.minutes, None))
    items, duplicates = _dedupe(items, order)
    guaranteed, fixed = _guarantee(ctx, items, needs, exam, now)
    guaranteed += _guarantee_revisits(ctx, items, cands)
    if not cands and not items:
        ctx.actions = []
        return "no gaps, emphasis or commitments, so no actions" + (f"; {'; '.join(notes)}" if notes else "")
    rank = {"prep": 0, "deadline": 1, "study": 2, "review": 3, "resource": 4, "ask": 5}
    items.sort(key=lambda a: (a.dueBy or "9999", rank[a.kind]))
    for a in items:
        db.put("action", a.id, a.dump(), student_id=lec.studentId, parent_id=lec.id)
    ctx.actions = items
    have = {(norm_topic(a.topic), a.kind) for a in items}
    missing = [c for c in cands if c.id not in used and c.kind in ("study", "prep", "deadline")
               and (norm_topic(c.topic), c.kind) not in have]
    if missing:
        ctx.soft_error = f"model left out {len(missing)} required candidate(s): {[c.topic for c in missing]}"
    kinds = Counter(a.kind for a in items)
    parts = [f"{len(cands)} candidates from missed/emphasized/commitments/marks → {len(items)} actions {dict(kinds)}"]
    said = sum(1 for c in cands if c.canonical and "commitmentId" in c.provenance)
    if said or retopic:
        parts.append("commitment topics → syllabus: " + ", ".join(
            [f"{said} from the lecturer's own words"] + [f"{n} via {how}" for how, n in retopic.items()]))
    deferred = [f"{t}: {n.note} → {n.kind}" for t, n in needs.items() if n.segment_id]
    if deferred:
        parts.append(f"deferred: {'; '.join(deferred)}")
    if duplicates:
        parts.append(f"dropped {len(duplicates)} duplicate (topic, kind): {'; '.join(duplicates)}")
    parts += fixed
    if guaranteed:
        parts.append(f"origin: guaranteed (the model gave no action for these missed topics): {'; '.join(guaranteed)}")
    revisits = [f"{c.topic} (← {c.revisit})" for c in cands if c.revisit]
    if revisits:
        parts.append(f"Smart Exam gaps this lecture builds on: {', '.join(revisits)}")
    parts.append("marks and dates computed from past_papers.json, exam_calendar.json, timetable.json, "
                 "graded_answers/ (Smart Exam)")
    return "; ".join(parts + notes)


# ---------------------------------------------------------------------------------
# 7. notify
# ---------------------------------------------------------------------------------

def _fmt_due(value: str | None) -> str:
    dt = cal.parse_iso(value)
    return f"{dt:%a %d %b}" if dt else "no date"


def step_notify(ctx: Ctx) -> str:
    lec, handout, cov = ctx.lecture, ctx.handout, ctx.coverage
    citations: list[Citation] = []
    syl = ctx.syllabus
    for m in cov.missed if cov else []:
        topic = syl.topic(m.syllabusSectionId) if syl else None
        if topic and find_verbatim(topic.line, topic.line, min_words=1):
            citations.append(Citation(id=f"C{len(citations) + 1}", docId=syl.doc_id, docTitle=syl.title,
                                      sectionId=topic.id, sectionHeading=f"{topic.unit_title} › {topic.line}",
                                      quote=topic.line))
    when = f"{date.fromisoformat(lec.date):%a %d %b}"
    s1 = f"Your handout for **{lec.courseCode} · {handout.title}** ({when}) is ready: {len(handout.sections)} sections."
    if cov and cov.unit and cov.missed:
        names = ", ".join(f"**{m.topic}** [{c.id}]" for m, c in zip(cov.missed, citations))
        s2 = f"Compared with {cov.unit}, the lecture did not cover {names}."
    elif cov and cov.unit:
        s2 = f"It covered every topic listed for {cov.unit}."
    else:
        s2 = "I couldn't match this lecture to the syllabus, so there is no coverage check."
    if ctx.actions:
        first = ctx.actions[0]
        s3 = f"I've proposed {len(ctx.actions)} actions; the first, “{first.title}”, is due {_fmt_due(first.dueBy)}."
    else:
        s3 = "Nothing in this lecture needs a follow-up action."
    gap_items = [a for a in ctx.actions if a.id in ctx.revisit_ids and a.dueBy]
    if gap_items:
        names = ", ".join(f"**{a.topic}**" for a in gap_items)
        nxt = next_session(lec.courseCode, max(_lecture_at(lec), datetime.now(TZ)))
        when = f"before the next class ({_fmt_due(gap_items[0].dueBy)})" \
            if nxt and gap_items[0].dueBy == iso(nxt.start) else f"by {_fmt_due(gap_items[0].dueBy)}"
        s3 += (f" Your Smart Exam shows gaps in {names}, which this lecture covers or builds on, so each has a "
               f"revisit item due {when}.")
    if cov and cov.confusion:
        flagged = list(dict.fromkeys(c.topic for c in cov.confusion))
        s3 += f" You flagged {len(cov.confusion)} moment(s) as confusing ({', '.join(flagged)}); each has a review item."
    cards = []
    if cov:
        cards.append(cov.dump())
    cards.append(ActionsCard(lectureId=lec.id, commitments=ctx.commitments, items=ctx.actions).dump())
    started = time.perf_counter()
    msg = Message(id=f"msg_{uuid.uuid4().hex[:10]}", threadId=class_thread_id(lec.studentId, lec.courseCode),
                  role="agent", agentId=AGENT_ID, createdAt=_utcnow(), text=" ".join([s1, s2, s3]),
                  citations=citations, cards=cards, trace=ctx.tracer.entries + [ToolTrace(
                      tool="class_companion.notify", summary=f"message appended to the {lec.courseCode} class thread",
                      durationMs=int((time.perf_counter() - started) * 1000))])
    append_message(lec.studentId, msg)
    return f"message {msg.id} with {len(cards)} cards, {len(citations)} verified citations"


# ---------------------------------------------------------------------------------
# 8. accept / dismiss
# ---------------------------------------------------------------------------------

_accept_lock = threading.Lock()


def update_action(action_id: str, status: str) -> dict[str, Any]:
    if status not in ("accepted", "dismissed", "done", "proposed"):
        raise BadRequest("status must be one of proposed, accepted, dismissed, done")
    with _accept_lock:
        body = db.get("action", action_id)
        if not body:
            raise NotFound(f"action {action_id} not found")
        action = ActionItem.model_validate(body)
        lec = get_lecture(action.lectureId)
        if status == "accepted" and action.status != "accepted":
            _accept(action, lec.studentId)
        elif status in ("dismissed", "proposed") and action.status == "accepted":
            _unaccept(action, lec.studentId)
        action.status = status
        db.put("action", action.id, action.dump(), student_id=lec.studentId, parent_id=lec.id)
        return action.dump()


def _accept(action: ActionItem, student_id: str) -> None:
    now = datetime.now(TZ)
    due = cal.parse_iso(action.dueBy)
    minutes = action.minutes or 45
    # this week, or the week before dueBy when that is further out
    if due and due - now > timedelta(days=7):
        week = cal.monday_of((due - timedelta(days=7)).date())
    else:
        week = cal.monday_of(now.date())
    week_start = datetime.combine(week, datetime.min.time(), TZ)
    earliest = max(now, week_start)
    latest = min(due, week_start + timedelta(days=7)) if due and due > earliest else week_start + timedelta(days=7)
    slot = cal.find_slot(student_id, minutes, earliest, latest)
    if slot is None and due and due > now:  # nothing free that week: any evening before it is due
        slot = cal.find_slot(student_id, minutes, now, due)
    if slot is None and not due:
        slot = cal.find_slot(student_id, minutes, earliest, earliest + timedelta(days=14))
    if slot is None:
        raise BadRequest(f"no free evening slot of {minutes} min before {action.dueBy or 'the next two weeks'}")

    block_id = f"pb_{uuid.uuid4().hex[:10]}"
    add_plan_block(student_id, {"id": block_id, "course": action.course, "topic": action.topic,
                                "minutes": minutes, "why": action.why,
                                **({"citationId": action.provenance.syllabusSectionId}
                                   if action.provenance.syllabusSectionId else {})},
                   cal.monday_of(slot[0].date()))
    db.put("block_slot", block_id, {"start": iso(slot[0]), "end": iso(slot[1])}, student_id=student_id)
    source = {"type": "action", "actionId": action.id, "lectureId": action.lectureId}
    if action.kind == "deadline" and action.dueBy:
        item = CalendarItem(id=f"cal_{uuid.uuid4().hex[:10]}", studentId=student_id, kind="deadline",
                            title=action.title, courseCode=action.course, start=action.dueBy[:10], allDay=True,
                            source=source, status="planned")
    else:
        kind = "prep" if action.kind == "prep" else "action"
        item = CalendarItem(id=f"cal_{uuid.uuid4().hex[:10]}", studentId=student_id, kind=kind, title=action.title,
                            courseCode=action.course, start=iso(slot[0]), end=iso(slot[1]), source=source,
                            status="planned")
    db.put("calendar_item", item.id, item.dump(), student_id=student_id, parent_id=action.id)
    action.planBlockId, action.calendarItemId = block_id, item.id


def _unaccept(action: ActionItem, student_id: str) -> None:
    if action.planBlockId:
        remove_plan_block(student_id, action.planBlockId)
        db.delete("block_slot", action.planBlockId)
    if action.calendarItemId:
        db.delete("calendar_item", action.calendarItemId)
    action.planBlockId = action.calendarItemId = None


# ---------------------------------------------------------------------------------
# 9. stuck markers: "I'm stuck here" taps (contracts §9b, v3.4)
# ---------------------------------------------------------------------------------
#
# A marker is a timestamp, plus an optional short note, that the student tapped in class. Code
# resolves it: the segment covering atSec, the handout section holding that segment (or the
# nearest section, since some handouts leave a segment out of every section), and that
# section's syllabus topic. Once the handout exists it shows up as HandoutSection.stuck, a
# CoverageCard.confusion row and a review action whose provenance.markerId names it. No model
# is asked anything: the marker is the student's own signal, and every text here is built
# from the marker, the handout and computed facts.

MARKER_NOTE_MAX = 60
_marker_lock = threading.Lock()


def _markers_for(lecture_id: str) -> list[dict[str, Any]]:
    return sorted(db.find("marker", parent_id=lecture_id), key=lambda m: (m["atSec"], m["createdAt"]))


def list_markers(lecture_id: str) -> list[dict[str, Any]]:
    """StuckMarker[] for a lecture (also read by the mind-map adapter)."""
    get_lecture(lecture_id)
    return [StuckMarker.model_validate(m).dump() for m in _markers_for(lecture_id)]


def _mmss(sec: float) -> str:
    return f"{int(sec // 60)}:{int(sec % 60):02d}"


def _segment_at(segments: list[TranscriptSegment], at_sec: float) -> TranscriptSegment | None:
    if not segments:
        return None
    inside = [s for s in segments if s.startSec <= at_sec < s.endSec]
    if inside:
        return inside[0]
    return min(segments, key=lambda s: min(abs(at_sec - s.startSec), abs(at_sec - s.endSec)))


def _section_for(handout: Handout | None, segments: list[TranscriptSegment],
                 seg_id: str | None) -> tuple[HandoutSection | None, str]:
    """The handout section holding the segment, else the nearest section by transcript order."""
    if not handout or not handout.sections or not seg_id:
        return None, "no handout yet"
    for sec in handout.sections:
        if seg_id in sec.segmentIds:
            return sec, "contains the segment"
    order = {s.id: i for i, s in enumerate(segments)}
    at = order.get(seg_id)
    if at is None:
        return None, "segment not in transcript"

    def distance(sec: HandoutSection) -> float:
        idx = [order[x] for x in sec.segmentIds if x in order]
        if not idx:
            return float("inf")
        return 0 if min(idx) <= at <= max(idx) else min(abs(at - min(idx)), abs(at - max(idx)))
    return min(handout.sections, key=distance), "nearest section (segment is in none)"


def _resolve(marker: dict[str, Any], segments: list[TranscriptSegment], handout: Handout | None) -> str:
    seg = _segment_at(segments, float(marker["atSec"]))
    if seg:
        marker["segmentId"] = seg.id
    sec, how = _section_for(handout, segments, marker.get("segmentId"))
    if sec:
        marker["handoutSectionId"] = sec.id
        marker["topic"] = sec.syllabusTopic or sec.heading
    return how


def _flag_fact(markers: list[dict[str, Any]]) -> str:
    times = ", ".join(_mmss(m["atSec"]) + (f' ("{m["note"]}")' if m.get("note") else "") for m in markers)
    return f"you flagged it in class at {times}"


def _apply_markers(lec: Lecture, markers: list[dict[str, Any]], segments: list[TranscriptSegment],
                   handout: Handout, coverage: CoverageCard, actions: list[ActionItem]
                   ) -> tuple[list[ActionItem], list[str]]:
    """Put resolved markers into the handout, the coverage card and the actions (all mutated in
    place and persisted). Returns (actions touched, notes for the trace)."""
    now = datetime.now(TZ)
    exam = next_exam(lec.courseCode, max(_lecture_at(lec), now))
    by_section = {s.id: s for s in handout.sections}
    touched: list[ActionItem] = []
    notes: list[str] = []
    for m in markers:
        how = _resolve(m, segments, handout)
        sec = by_section.get(m.get("handoutSectionId") or "")
        if sec is None:
            notes.append(f"{m['id']} at {_mmss(m['atSec'])}: not placed ({how})")
            continue
        sec.stuck = sec.stuck or StuckFlag()
        if m["id"] not in sec.stuck.markerIds:
            sec.stuck.markerIds.append(m["id"])
            sec.stuck.atSec.append(float(m["atSec"]))
        if not any(c.markerId == m["id"] for c in coverage.confusion):
            coverage.confusion.append(CoverageConfusion(topic=m["topic"], markerId=m["id"], atSec=float(m["atSec"]),
                                                        handoutSectionId=sec.id, note=m.get("note")))
        topic_markers = [x for x in markers if x.get("topic") == m["topic"]]
        review = next((a for a in actions if a.kind == "review" and norm_topic(a.topic) == norm_topic(m["topic"])),
                      None)
        if review is None:
            facts, prov = _facts_for(SimpleNamespace(lecture=lec), m["topic"], exam)
            review = ActionItem(
                id=f"act_{uuid.uuid4().hex[:10]}", lectureId=lec.id, kind="review",
                title=f"Revisit {m['topic']}: you flagged it at {_mmss(m['atSec'])}", course=lec.courseCode,
                topic=m["topic"], minutes=30, dueBy=due_iso(exam) if exam else None,
                why="; ".join([_flag_fact(topic_markers)] + facts),
                provenance=ActionProvenance(markerId=m["id"], segmentId=m.get("segmentId"),
                                            syllabusSectionId=sec.syllabusSectionId, **prov))
            actions.append(review)
            notes.append(f"{m['id']} at {_mmss(m['atSec'])} → {m['segmentId']}, {sec.id} ({how}), "
                         f"topic {m['topic']}: new review action {review.id}")
        else:
            base = re.sub(r"(^|; )you flagged it in class at [^;]*", "", review.why).strip("; ")
            review.why = "; ".join(x for x in [base, _flag_fact(topic_markers)] if x)
            if not review.provenance.markerId:
                review.provenance.markerId = m["id"]
            notes.append(f"{m['id']} at {_mmss(m['atSec'])} → {m['segmentId']}, {sec.id} ({how}), "
                         f"topic {m['topic']}: linked to review action {review.id}")
        if review not in touched:
            touched.append(review)
        m["applied"] = True
    db.put("handout", lec.id, handout.dump(), student_id=lec.studentId, parent_id=lec.id)
    db.put("coverage", lec.id, coverage.dump(), student_id=lec.studentId, parent_id=lec.id)
    for a in touched:
        db.put("action", a.id, a.dump(), student_id=lec.studentId, parent_id=lec.id)
    for m in markers:
        db.put("marker", m["id"], m, student_id=lec.studentId, parent_id=lec.id)
    return touched, notes


def step_markers(ctx: Ctx) -> str:
    """Pipeline step: every marker of the lecture goes into this run's handout, coverage and actions."""
    with _marker_lock:
        markers = _markers_for(ctx.lecture.id)
        if not markers:
            return "no stuck markers"
        _, notes = _apply_markers(ctx.lecture, markers, ctx.segments, ctx.handout, ctx.coverage, ctx.actions)
    return f"{len(markers)} stuck marker(s): " + "; ".join(notes)


def _apply_after_ready(lec: Lecture, pending: list[dict[str, Any]]) -> None:
    """Markers that reach a ready lecture: apply now, recompute the cards, tell the class thread."""
    started = time.perf_counter()
    segments = get_transcript(lec.id).segments
    handout = Handout.model_validate(db.get("handout", lec.id))
    coverage = CoverageCard.model_validate(db.get("coverage", lec.id))
    actions = _actions_for(lec.id)
    touched, notes = _apply_markers(lec, pending, segments, handout, coverage, actions)
    placed = [m for m in pending if m.get("applied")]
    if not placed:
        return
    m = placed[-1]
    note = f' ("{m["note"]}")' if m.get("note") else ""
    review = touched[-1] if touched else None
    text = f"Noted: you're stuck on **{m['topic']}** at {_mmss(m['atSec'])}{note}."
    if review:
        text += f" It's in this lecture's confusion list, and “{review.title}” is due {_fmt_due(review.dueBy)}."
    commitments = db.get("commitments", lec.id) or {"items": []}
    cards = [coverage.dump(), ActionsCard(lectureId=lec.id, items=_actions_for(lec.id),
                                          commitments=[LectureCommitment.model_validate(c)
                                                       for c in commitments["items"]]).dump()]
    append_message(lec.studentId, Message(
        id=f"msg_{uuid.uuid4().hex[:10]}", threadId=class_thread_id(lec.studentId, lec.courseCode), role="agent",
        agentId=AGENT_ID, createdAt=_utcnow(), text=text, cards=cards,
        trace=[ToolTrace(tool="class_companion.marker", summary="; ".join(notes),
                         durationMs=int((time.perf_counter() - started) * 1000))]))


def apply_late_markers(lecture_id: str) -> None:
    """After "ready": markers that arrived while the pipeline's last steps ran."""
    with _marker_lock:
        lec = get_lecture(lecture_id)
        pending = [m for m in _markers_for(lecture_id) if not m.get("applied")]
        if lec.status == "ready" and pending:
            _apply_after_ready(lec, pending)


def add_marker(lecture_id: str, at_sec: Any, note: Any = None) -> dict[str, Any]:
    """POST /lectures/:id/markers. Works while recording, before processing, or after ready."""
    lec = get_lecture(lecture_id)
    try:
        at = float(at_sec)
    except (TypeError, ValueError):
        raise BadRequest("atSec must be a number of seconds")
    if at < 0 or at != at:
        raise BadRequest("atSec must be >= 0")
    text = normalize_ws(str(note))[:MARKER_NOTE_MAX] if note not in (None, "") else None
    marker: dict[str, Any] = {"id": f"mk_{uuid.uuid4().hex[:10]}", "lectureId": lec.id, "atSec": round(at, 1),
                              "createdAt": _utcnow(), "applied": False, **({"note": text} if text else {})}
    with _marker_lock:
        lec = get_lecture(lecture_id)
        body = db.get("transcript", lec.id)
        segments = Transcript.model_validate(body).segments if body else []
        handout_body = db.get("handout", lec.id)
        _resolve(marker, segments, Handout.model_validate(handout_body) if handout_body else None)
        db.put("marker", marker["id"], marker, student_id=lec.studentId, parent_id=lec.id)
        if lec.status == "ready":
            _apply_after_ready(lec, [marker])
    return StuckMarker.model_validate(db.get("marker", marker["id"])).dump()
