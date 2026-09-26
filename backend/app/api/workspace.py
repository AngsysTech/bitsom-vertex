"""Workspace boot endpoints (contracts.ts §10 "Workspace" and "Students / records / docs"). Built 26 Sep 2026."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app import workspace as ws
from app.core.records import load_records, load_student

router = APIRouter()


def _student(student_id: str) -> None:
    if load_student(student_id) is None:
        raise HTTPException(404, f"student {student_id} not found")


@router.get("/students")
def students() -> list[dict[str, Any]]:
    return ws.students()


@router.get("/students/{student_id}/state")
def student_state(student_id: str) -> dict[str, Any]:
    _student(student_id)
    return ws.state(student_id)


@router.get("/students/{student_id}/records")
def student_records(student_id: str) -> dict[str, Any]:
    _student(student_id)
    return load_records(student_id)


@router.get("/workspace/{student_id}")
def workspace(student_id: str) -> dict[str, Any]:
    _student(student_id)
    return ws.workspace(student_id)


@router.get("/classes/{student_id}")
def classes(student_id: str) -> list[dict[str, Any]]:
    _student(student_id)
    return ws.class_channels(student_id)


@router.get("/files/{student_id}")
def files(student_id: str) -> list[dict[str, Any]]:
    _student(student_id)
    return ws.files(student_id)


@router.get("/connectors")
def connectors() -> list[dict[str, Any]]:
    return ws.connectors()
