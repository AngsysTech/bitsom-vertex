"""Class companion + calendar + thread endpoints (contracts.ts §10). Built 26 Sep 2026."""
from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse

from app.core.config import TZ
from app.core.threads import get_thread
from app.tools import calendar as cal
from app.tools import companion
from app.tools.companion import BadRequest

router = APIRouter()


@router.post("/lectures")
async def create_lecture(request: Request) -> dict[str, Any]:
    ctype = request.headers.get("content-type", "")
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("audio")
        audio = await upload.read() if upload is not None and hasattr(upload, "read") else None
        lec = companion.create_lecture(
            student_id=str(form.get("studentId") or ""), course_code=str(form.get("courseCode") or ""),
            lecture_date=str(form.get("date") or ""), title=form.get("title") or None,
            transcript_text=form.get("transcriptText") or None if audio is None else None,
            audio=audio, audio_filename=getattr(upload, "filename", None),
            source=str(form.get("source") or "") or None)
    else:
        try:
            body = await request.json()
        except Exception:
            raise BadRequest("body must be JSON or multipart/form-data")
        lec = companion.create_lecture(
            student_id=body.get("studentId", ""), course_code=body.get("courseCode", ""),
            lecture_date=body.get("date", ""), title=body.get("title"),
            transcript_text=body.get("transcriptText"))
    return lec.dump()


@router.post("/lectures/{lecture_id}/process")
def process_lecture(lecture_id: str, background: BackgroundTasks) -> dict[str, Any]:
    lec, should_run = companion.start_processing(lecture_id)
    if should_run:
        background.add_task(companion.run_pipeline, lecture_id)
    return lec.dump()


@router.get("/lectures/{lecture_id}")
def get_lecture(lecture_id: str) -> dict[str, Any]:
    return companion.get_lecture(lecture_id).dump()


@router.get("/lectures/{lecture_id}/audio")
def get_audio(lecture_id: str) -> FileResponse:
    return FileResponse(companion.audio_path(lecture_id))


@router.get("/lectures/{lecture_id}/transcript")
def get_transcript(lecture_id: str) -> dict[str, Any]:
    return companion.get_transcript(lecture_id).dump()


@router.get("/lectures/{lecture_id}/handout")
def get_handout(lecture_id: str) -> dict[str, Any]:
    return companion.get_handout(lecture_id).dump()


@router.get("/lectures/{lecture_id}/cards")
def get_cards(lecture_id: str) -> dict[str, Any]:
    return companion.get_cards(lecture_id)


@router.post("/actions/{action_id}")
async def update_action(action_id: str, request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        raise BadRequest("body must be JSON {status}")
    return companion.update_action(action_id, str(body.get("status", "")))


@router.get("/students/{student_id}/lectures")
def student_lectures(student_id: str) -> list[dict[str, Any]]:
    return companion.list_lectures(student_id)


@router.get("/calendar/{student_id}")
def calendar(student_id: str, request: Request) -> list[dict[str, Any]]:
    q = request.query_params
    try:
        start = cal.parse_iso(q.get("from")) if q.get("from") else None
        end = cal.parse_iso(q.get("to")) if q.get("to") else None
    except ValueError:
        raise BadRequest("from/to must be ISO dates")
    if start is None:
        start = datetime.combine(cal.monday_of(datetime.now(TZ).date()), time(0, 0), TZ)
    if end is None:
        end = start + timedelta(days=14)
    elif q.get("to") and len(q.get("to")) == 10:
        end += timedelta(days=1)  # a date-only `to` is inclusive
    return cal.build_calendar(student_id, start, end)


@router.get("/threads/{student_id}/{agent_id}")
def thread(student_id: str, agent_id: str) -> dict[str, Any]:
    return get_thread(student_id, agent_id)
