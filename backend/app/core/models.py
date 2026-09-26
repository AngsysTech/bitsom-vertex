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
    courseCode: Optional[str] = None  # class-channel threads: `${studentId}:class:${courseCode}`
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
    stuck: Optional["StuckFlag"] = None  # student flagged this part in class


class StuckFlag(Model):
    markerIds: list[str] = Field(default_factory=list)
    atSec: list[float] = Field(default_factory=list)


class StuckMarker(Model):
    """"I'm stuck here": a tap during class (or a click on the handout timeline afterwards)."""
    id: str
    lectureId: str
    atSec: float
    note: Optional[str] = None
    createdAt: str
    segmentId: Optional[str] = None
    handoutSectionId: Optional[str] = None
    topic: Optional[str] = None


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
    confusion: list["CoverageConfusion"] = Field(default_factory=list)  # from StuckMarkers


class CoverageConfusion(Model):
    topic: str
    markerId: str
    atSec: float
    handoutSectionId: str
    note: Optional[str] = None


class ActionProvenance(Model):
    segmentId: Optional[str] = None
    syllabusSectionId: Optional[str] = None
    pastPapersCitationId: Optional[str] = None
    commitmentId: Optional[str] = None
    markerId: Optional[str] = None
    gapTags: Optional[list[str]] = None  # Smart Exam concept gaps (graded_answers) behind this action


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


# ---- academic coach: weak topics, weekly 1:1, escalation (contracts §4, §5, §7) --------

class WeakTopicGap(Model):
    tag: str
    evidence: str
    marksLost: float
    citationId: str


class WeakTopic(Model):
    course: str
    topic: str
    score: str
    examWeight: float
    impact: int
    citationId: str
    gaps: Optional[list[WeakTopicGap]] = None


class WeakTopicsCard(Model):
    type: Literal["weak_topics"] = "weak_topics"
    items: list[WeakTopic] = Field(default_factory=list)


class TopicMovement(Model):
    topic: str
    from_: int = Field(alias="from")
    to: int

    model_config = {"populate_by_name": True}

    def dump(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True, by_alias=True)


class RecapWindow(Model):
    from_: str = Field(alias="from")
    to: str

    model_config = {"populate_by_name": True}


class FlaggedTopic(Model):
    topic: str
    times: int


class OneOnOneRecap(Model):
    plannedMinutes: int
    doneMinutes: int
    blocksPlanned: int
    blocksDone: int
    completedTopics: list[str] = Field(default_factory=list)
    skippedTopics: list[str] = Field(default_factory=list)
    weakTopicMovement: list[TopicMovement] = Field(default_factory=list)
    movementNote: Optional[str] = None
    flaggedTopics: list[FlaggedTopic] = Field(default_factory=list)
    blocksMissed: int = 0
    prepMet: int = 0
    prepMissed: int = 0
    window: Optional[RecapWindow] = None     # always set when built; optional only for older stored 1:1s
    streakDays: int = 0

    def dump(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True, by_alias=True)


class OneOnOneQuestion(Model):
    id: str
    prompt: str
    answer: Optional[str] = None


class OneOnOneAdjustment(Model):
    blockId: Optional[str] = None
    change: Literal["add", "move", "drop", "resize"]
    detail: str


class OneOnOne(Model):
    id: str
    studentId: str
    weekLabel: str
    status: Literal["ready", "in_progress", "done"]
    recap: OneOnOneRecap
    wins: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    questions: list[OneOnOneQuestion] = Field(default_factory=list)
    proposedAdjustments: list[OneOnOneAdjustment] = Field(default_factory=list)
    adjustedPlan: Optional[StudyPlanCard] = None
    shareWithAdvisor: bool = False

    def dump(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True, by_alias=True)


class Escalation(Model):
    ticketId: str
    status: Literal["open", "answered"]
    reason: Literal["out_of_scope", "needs_human", "conflicting_rules"]


class TicketReply(Model):
    text: str
    at: str


class Ticket(Model):
    ticketId: str
    studentId: str
    studentName: str
    agentId: str
    question: str
    agentSummary: str
    citations: list[Citation] = Field(default_factory=list)
    status: Literal["open", "answered"] = "open"
    reply: Optional[TicketReply] = None
    createdAt: str


HandoutSection.model_rebuild()
CoverageCard.model_rebuild()
