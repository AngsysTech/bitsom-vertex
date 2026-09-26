"""Lecture mind map endpoints (contracts.ts v3.9). Built 26 Sep 2026."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from app.tools import mindmap

router = APIRouter()


@router.get("/lectures/{lecture_id}/mindmap")
def get_mindmap(lecture_id: str) -> dict[str, Any]:
    return mindmap.get_mindmap(lecture_id)


@router.post("/lectures/{lecture_id}/mindmap/rebuild")
def rebuild_mindmap(lecture_id: str) -> dict[str, Any]:
    return mindmap.rebuild(lecture_id)
