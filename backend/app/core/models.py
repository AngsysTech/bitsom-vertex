"""Pydantic mirrors of contracts.ts. Field names are the wire names (camelCase).

Only the shapes this backend returns are here. Serialise with ``dump()`` so
optional fields the backend did not set are omitted, as in the TS contract.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, Field


class Model(BaseModel):
    def dump(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)


# ---- chat ------------------------------------------------------------------

class ToolTrace(Model):
    tool: str
    summary: str
    durationMs: int
    # not in contracts.ts: set when a step fails, so the trace never hides it
    error: Optional[str] = None


class Citation(Model):
    id: str
    docId: str
    docTitle: str
    sectionId: str
    sectionHeading: str
    quote: str


class Message(Model):
    id: str
    threadId: str
    role: Literal["student", "agent", "advisor", "system"]
    agentId: Optional[str] = None
    replyToId: Optional[str] = None
    createdAt: str
    text: str
    citations: list[Citation] = Field(default_factory=list)
    cards: list[dict[str, Any]] = Field(default_factory=list)
    trace: list[ToolTrace] = Field(default_factory=list)
    escalation: Optional[dict[str, Any]] = None


class Thread(Model):
    id: str
    studentId: str
    agentId: str
    messages: list[Message]


# ---- study plan / state ------------------------------------------------------

class PlanBlock(Model):
    id: str
    course: str
    topic: str
    minutes: int
    why: str
    citationId: Optional[str] = None


class PlanWeek(Model):
    label: str
    examNote: Optional[str] = None
    blocks: list[PlanBlock] = Field(default_factory=list)


class StudyPlanCard(Model):
    type: Literal["study_plan"] = "study_plan"
    weeks: list[PlanWeek] = Field(default_factory=list)


# ---- class companion (contracts §9b) -----------------------------------------

LectureStatus = Literal["uploaded", "transcribing", "transcribed", "processing", "ready", "failed"]


class Lecture(Model):
    id: str
    studentId: str
    courseCode: str
    date: str
    title: Optional[str] = None
    source: Literal["upload", "recording", "transcript"]
    audioUrl: Optional[str] = None
    durationSec: Optional[float] = None
    status: LectureStatus
    error: Optional[str] = None
    connectorId: str


class TranscriptSegment(Model):
    id: str
    startSec: float
    endSec: float
    text: str


class Transcript(Model):
    lectureId: str
    segments: list[TranscriptSegment]


class HandoutDefinition(Model):
    term: str
    definition: str


class HandoutSection(Model):
    id: str
    heading: str
    keyPoints: list[str] = Field(default_factory=list)
    definitions: list[HandoutDefinition] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    examHints: list[str] = Field(default_factory=list)
    segmentIds: list[str] = Field(default_factory=list)
    syllabusTopic: Optional[str] = None
    syllabusSectionId: Optional[str] = None


class Handout(Model):
    id: str
    lectureId: str
    courseCode: str
    title: str
    summary: str
    sections: list[HandoutSection]
    createdAt: str


class CoverageCovered(Model):
    topic: str
    handoutSectionIds: list[str]


class CoverageMissed(Model):
    topic: str
    syllabusSectionId: str
    why: str


class CoverageEmphasized(Model):
    topic: str
    segmentId: str
    quote: str


class CoverageCard(Model):
    type: Literal["coverage"] = "coverage"
    lectureId: str
    courseCode: str
    unit: str
    covered: list[CoverageCovered] = Field(default_factory=list)
    missed: list[CoverageMissed] = Field(default_factory=list)
    emphasized: list[CoverageEmphasized] = Field(default_factory=list)


class ActionProvenance(Model):
    segmentId: Optional[str] = None
    syllabusSectionId: Optional[str] = None
    pastPapersCitationId: Optional[str] = None
    commitmentId: Optional[str] = None


ActionKind = Literal["study", "review", "ask", "resource", "prep", "deadline"]


class ActionItem(Model):
    id: str
    lectureId: str
    kind: ActionKind
    title: str
    course: str
    topic: str
    minutes: Optional[int] = None
    dueBy: Optional[str] = None
    why: str
    provenance: ActionProvenance
    status: Literal["proposed", "accepted", "dismissed", "done"] = "proposed"
    planBlockId: Optional[str] = None
    calendarItemId: Optional[str] = None


CommitmentKind = Literal["next_lecture_topic", "assignment", "reading", "deadline", "exam_hint"]


class LectureCommitment(Model):
    id: str
    lectureId: str
    kind: CommitmentKind
    text: str
    dueBy: Optional[str] = None
    segmentId: str
    quote: str


class ActionsCard(Model):
    type: Literal["actions"] = "actions"
    lectureId: str
    commitments: list[LectureCommitment] = Field(default_factory=list)
    items: list[ActionItem] = Field(default_factory=list)


# ---- calendar ------------------------------------------------------------------

class SourceTimetable(Model):
    type: Literal["timetable"] = "timetable"


class SourceExam(Model):
    type: Literal["exam_calendar"] = "exam_calendar"
    examId: str


class SourcePlanBlock(Model):
    type: Literal["plan_block"] = "plan_block"
    planBlockId: str


class SourceAction(Model):
    type: Literal["action"] = "action"
    actionId: str
    lectureId: str


CalendarItemKind = Literal["class", "exam", "quiz", "study_block", "action", "prep", "deadline"]


class CalendarItem(Model):
    id: str
    studentId: str
    kind: CalendarItemKind
    title: str
    courseCode: Optional[str] = None
    start: str
    end: Optional[str] = None
    allDay: Optional[bool] = None
    source: Union[SourceTimetable, SourceExam, SourcePlanBlock, SourceAction]
    status: Optional[Literal["planned", "done", "missed"]] = None
