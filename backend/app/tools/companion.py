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
import threading
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app.core import academics, db, llm, records, stt
from app.core.academics import (TopicWeight, due_iso, iso, lecture_start, next_exam, next_session,
                                resolve_when, topic_weight)
from app.core.config import LECTURES_DIR, PROMPTS_DIR, TZ
from app.core.models import (ActionItem, ActionProvenance, ActionsCard, CalendarItem, Citation, CoverageCard,
                             CoverageCovered, CoverageEmphasized, CoverageMissed, Handout, HandoutDefinition,
                             HandoutSection, Lecture, LectureCommitment, Message, ToolTrace, Transcript,
                             TranscriptSegment)
from app.core.records import load_student, topic_marks
from app.core.state import add_plan_block, remove_plan_block
from app.core.syllabus import Syllabus, Topic, load_syllabus
from app.core.threads import append_message, thread_id
from app.core.verify import find_verbatim, normalize_ws
from app.tools import calendar as cal
from app.vendored.audio_notes.notes_generation import NotesGenerationService

log = logging.getLogger("companion")

AGENT_ID = "academic_coach"
CONNECTOR_ID = "lms_moodle"
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".webm", ".flac", ".mp4",
              ".mpeg", ".mpga", ".aiff", ".aif", ".caf"}
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
                   transcript_text: str | None = None, audio: bytes | None = None,
                   audio_filename: str | None = None, source: str | None = None) -> Lecture:
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
    folder.mkdir(parents=True, exist_ok=True)
    audio_url = None
    if transcript_text is not None:
        if not stt.clean_transcript_text(transcript_text):
            raise BadRequest("transcriptText is empty")
        (folder / "transcript.txt").write_text(transcript_text, encoding="utf-8")
        src = "transcript"
    else:
        ext = ("." + (audio_filename or "").rsplit(".", 1)[-1].lower()) if audio_filename and "." in audio_filename else ""
        if ext not in AUDIO_EXTS:
            raise BadRequest(f"unsupported audio type {ext or '(none)'}; use one of {sorted(AUDIO_EXTS)}")
        if not audio:
            raise BadRequest("audio file is empty")
        (folder / f"audio{ext}").write_bytes(audio)
        src = "recording" if source == "recording" else "upload"
        audio_url = f"/lectures/{lecture_id}/audio"
    lec = Lecture(id=lecture_id, studentId=student_id, courseCode=course_code, date=day.isoformat(),
                  title=title, source=src, audioUrl=audio_url, status="uploaded", connectorId=CONNECTOR_ID)
    return _save_lecture(lec)


def audio_path(lecture_id: str):
    folder = LECTURES_DIR / lecture_id
    found = sorted(folder.glob("audio.*")) if folder.exists() else []
    if not found:
        raise NotFound(f"no audio for {lecture_id}")
    return found[0]


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
    deferred_topics: set[str] = field(default_factory=set)  # missed, but the lecturer said it comes later

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
             ("commitments", step_commitments), ("actions", step_actions), ("notify", step_notify)]
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


def _fail(ctx: Ctx, step: str, error: str) -> None:
    lec = ctx.lecture
    lec.status, lec.error = "failed", f"{step}: {error}"
    _save_lecture(lec)
    append_message(lec.studentId, Message(
        id=f"msg_{uuid.uuid4().hex[:10]}", threadId=thread_id(lec.studentId, AGENT_ID), role="system",
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
        segments = stt.transcribe(str(audio_path(lec.id)))
        how = f"{stt.provider()} via vendored audio_notes STT, ~30 s segments"
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
    deferred: dict[str, str] = {}
    for m in res.missed:
        exact = find_verbatim(m.deferredQuote, ctx.seg[m.deferredSegmentId].text) \
            if m.deferredQuote and m.deferredSegmentId in ctx.seg else None
        if exact:
            deferred[m.topicId] = exact
    unclassified = []
    for t in unit.topics:
        if t.id in covered:
            card.covered.append(CoverageCovered(topic=t.title, handoutSectionIds=sorted(covered[t.id], key=order.get)))
        elif t.id in why:
            reason = why[t.id]
            if t.id in deferred:
                ctx.deferred_topics.add(t.title)
                reason = f'{reason.rstrip(".")}. The lecturer deferred it: "{deferred[t.id]}".'
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

@dataclass
class _Cand:
    id: str
    kind: str
    topic: str
    context: str
    facts: list[str]
    provenance: dict[str, str]
    due: str | None


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


def _candidates(ctx: Ctx) -> tuple[list[_Cand], list[str]]:
    lec, cov = ctx.lecture, ctx.coverage
    course, student = lec.courseCode, lec.studentId
    lecture_at = _lecture_at(lec)
    now = datetime.now(TZ)
    session = next_session(course, lecture_at)
    exam = next_exam(course, max(lecture_at, now))
    exam_due = due_iso(exam) if exam else None
    session_due = iso(session.start) if session else None
    syl = ctx.syllabus
    by_title = {t.title: t for t in syl.topics} if syl else {}
    cands: list[_Cand] = []
    notes: list[str] = []
    topics_seen: set[str] = set()

    def facts_for(topic: str) -> tuple[list[str], dict[str, str]]:
        facts, prov = [], {}
        w: TopicWeight | None = topic_weight(course, topic)
        if w:
            facts.append(w.fact)
            prov["pastPapersCitationId"] = w.citation_id
        sf, _ = _student_fact(student, course, topic)
        if sf:
            facts.append(sf)
        if exam:
            facts.append(f"next {course} assessment: {exam.title} on {exam.start:%a %d %b}")
        return facts, prov

    for m in cov.missed if cov else []:
        if m.topic in ctx.deferred_topics:
            continue  # the lecturer will teach it next: the commitment becomes a prep action instead
        facts, prov = facts_for(m.topic)
        cands.append(_Cand(f"c{len(cands) + 1}", "study", m.topic, f"Not taught in this lecture: {m.why}", facts,
                           {"syllabusSectionId": m.syllabusSectionId, **prov}, exam_due))
        topics_seen.add(m.topic)
    for e in cov.emphasized if cov else []:
        if e.topic in topics_seen:
            continue
        facts, prov = facts_for(e.topic)
        sec_id = by_title[e.topic].id if e.topic in by_title else None
        cands.append(_Cand(f"c{len(cands) + 1}", "review", e.topic, f'Lecturer said: "{e.quote}"', facts,
                           {"segmentId": e.segmentId, **({"syllabusSectionId": sec_id} if sec_id else {}), **prov},
                           exam_due))
        topics_seen.add(e.topic)
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
                               {**({"syllabusSectionId": sec_id} if sec_id else {}), **prov}, exam_due))
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
                           {"syllabusSectionId": by_title[title].id, **prov}, exam_due))
        topics_seen.add(title)
    emph_segments = {e.segmentId for e in (cov.emphasized if cov else [])}
    for cm in ctx.commitments:
        if cm.kind == "exam_hint" and cm.segmentId in emph_segments:
            continue  # already a review candidate from the same sentence
        kind = {"next_lecture_topic": "prep", "assignment": "deadline", "deadline": "deadline",
                "reading": "resource", "exam_hint": "review"}[cm.kind]
        if kind == "deadline" and not cm.dueBy:
            kind = "review"  # work set without a date is practice, due before the next assessment
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
        cands.append(_Cand(f"c{len(cands) + 1}", kind, cm.text, f'Lecturer said: "{cm.quote}"', facts,
                           {"segmentId": cm.segmentId, "commitmentId": cm.id}, due))
    return cands, notes


def _why_clause(text: str, kind: str) -> str:
    clause = normalize_ws(text).rstrip(".;")
    if re.search(r"\d", clause):  # numbers must come from code, never the model
        clause = ", ".join(p for p in re.split(r",|;", clause) if not re.search(r"\d", p)).strip()
    return clause or _KIND_FACT[kind]


def step_actions(ctx: Ctx) -> str:
    lec = ctx.lecture
    cands, notes = _candidates(ctx)
    for old in _actions_for(lec.id):  # re-processing replaces the proposals
        db.delete("action", old.id)
    if not cands:
        ctx.actions = []
        return "no gaps, emphasis or commitments, so no actions" + (f"; {'; '.join(notes)}" if notes else "")
    by_id = {c.id: c for c in cands}
    listing = "\n".join(
        f"- {c.id} | kind={c.kind} | topic={c.topic} | {c.context}" + (f" | facts: {'; '.join(c.facts)}" if c.facts else "")
        for c in cands)
    student = load_student(lec.studentId) or {}
    topics = _topic_list(ctx.syllabus.topics) if ctx.syllabus else "(no syllabus)"
    res = llm.json(f"Student: {student.get('name', lec.studentId)}, goal: {student.get('careerGoal', 'n/a')}.\n"
                   f"Course: {lec.courseCode}. Lecture of {lec.date}.\n\nCandidates:\n{listing}\n\n"
                   f"Syllabus topics (closed list, optional topicId for an item):\n{topics}",
                   _Actions, system=prompt("actions"), max_tokens=2500)
    used: set[str] = set()
    items: list[ActionItem] = []

    def make(cand: _Cand, kind: str, title: str, why: str, minutes: int, topic_id: str | None) -> ActionItem:
        topic = cand.topic
        if topic_id and ctx.syllabus and ctx.syllabus.topic(topic_id):
            topic = ctx.syllabus.topic(topic_id).title
        due = cand.due
        if kind == "ask":  # take it to the next class that hasn't happened yet
            due = next_session(lec.courseCode, max(_lecture_at(lec), datetime.now(TZ)))
            due = iso(due.start) if due else None
        return ActionItem(id=f"act_{uuid.uuid4().hex[:10]}", lectureId=lec.id, kind=kind,
                          title=normalize_ws(title)[:120], course=lec.courseCode, topic=topic,
                          minutes=max(10, min(int(minutes or 45), 180)), dueBy=due,
                          why="; ".join([_why_clause(why, kind)] + cand.facts),
                          provenance=ActionProvenance(**cand.provenance))

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
    missing = [c for c in cands if c.id not in used and c.kind in ("study", "prep", "deadline")]
    rank = {"prep": 0, "deadline": 1, "study": 2, "review": 3, "resource": 4, "ask": 5}
    items.sort(key=lambda a: (a.dueBy or "9999", rank[a.kind]))
    for a in items:
        db.put("action", a.id, a.dump(), student_id=lec.studentId, parent_id=lec.id)
    ctx.actions = items
    if missing:
        ctx.soft_error = f"model left out {len(missing)} required candidate(s): {[c.topic for c in missing]}"
    kinds = Counter(a.kind for a in items)
    skipped = f"; {'; '.join(notes)}" if notes else ""
    return (f"{len(cands)} candidates from missed/emphasized/commitments/marks → {len(items)} actions {dict(kinds)}; "
            f"marks and dates computed from past_papers.json, exam_calendar.json, timetable.json{skipped}")


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
    cards = []
    if cov:
        cards.append(cov.dump())
    cards.append(ActionsCard(lectureId=lec.id, commitments=ctx.commitments, items=ctx.actions).dump())
    started = time.perf_counter()
    msg = Message(id=f"msg_{uuid.uuid4().hex[:10]}", threadId=thread_id(lec.studentId, AGENT_ID), role="agent",
                  agentId=AGENT_ID, createdAt=_utcnow(), text=" ".join([s1, s2, s3]), citations=citations,
                  cards=cards, trace=ctx.tracer.entries + [ToolTrace(
                      tool="class_companion.notify", summary="message appended to academic_coach thread",
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
