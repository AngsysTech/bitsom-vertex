from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from core.schemas import SourceRef


def utcnow() -> datetime:
    return datetime.now(UTC)

StudyDifficulty = Literal["auto", "beginner", "intermediate", "advanced", "mixed"]
ResolvedDifficulty = Literal["beginner", "intermediate", "advanced"]
SRSConfidence = Literal["again", "hard", "good", "easy"]
LearningMode = Literal["learn", "revision", "practice_exam", "interview_prep"]
WebAugmentationMode = Literal["off", "augment", "recommend_only"]
WebAugmentationProvider = Literal["tavily", "openai"]
WebSourcePolicy = Literal["open_web_filtered"]
PracticeResourceType = Literal["question_bank", "practice_exam", "study_guide", "course_page"]
FlashcardType = Literal["concept", "cloze", "application", "definition"]
QuizQuestionType = Literal["multiple_choice", "fill_in_blank", "short_answer", "true_false", "scenario", "audio"]
StudyJobKind = Literal["flashcards", "quiz", "notes"]
StudyJobStatus = Literal["queued", "running", "done", "error", "expired", "awaiting_payment"]
GradingState = Literal["graded", "indeterminate"]
ConceptSupportType = Literal["primary", "rule", "example", "prerequisite", "related"]
# ``adaptive`` remains a legal stored mode: attempts written before adaptive
# generation was deferred still open, answer, grade and complete. Nothing starts
# a new one — see ``study/quiz_attempts.STARTABLE_MODES``.
QuizMode = Literal["deferred", "interactive", "adaptive"]
QuizAttemptStatus = Literal["in_progress", "completed"]
ReasoningEffort = Literal["minimal", "low", "medium", "high"]

# Hard cap on how many topics a single flashcard/quiz request may target via
# explicit selection (topic_ids) or manual entry (manual_topics).  Bounds the
# per-request cost of context assembly (retrieval + concept synthesis) and
# keeps the context endpoint responsive within typical client HTTP timeouts.
MAX_SELECTED_TOPICS = 10


class StudentProfile(BaseModel):
    level: str | None = None
    target_exam: str | None = None
    weak_topics: list[str] = Field(default_factory=list)
    strong_topics: list[str] = Field(default_factory=list)


class LearningGoal(BaseModel):
    mode: LearningMode = "learn"
    target_date: datetime | None = None
    desired_difficulty: ResolvedDifficulty | None = None


class WebAugmentation(BaseModel):
    mode: WebAugmentationMode = "off"
    provider: WebAugmentationProvider = "tavily"
    required: bool = False
    source_policy: WebSourcePolicy = "open_web_filtered"
    top_results: int = Field(default=8, ge=1, le=12)
    top_sources: int = Field(default=5, ge=1, le=8)
    chunks_per_source: int = Field(default=2, ge=1, le=4)


class TopicRef(BaseModel):
    topic_id: str
    label: str
    summary: str
    recommended_difficulty: ResolvedDifficulty
    source_count: int
    evidence_count: int
    sub_concepts: list[str] = Field(default_factory=list)
    prerequisite_topic_ids: list[str] = Field(default_factory=list)
    related_topic_ids: list[str] = Field(default_factory=list)
    source_refs: list[SourceRef] = Field(default_factory=list)
    manual: bool = False
    anchor_refs: list[str] = Field(default_factory=list)


class PracticeSource(BaseModel):
    """LEGACY. A web resource the old context builder recommended alongside a set.

    Quiz no longer produces or carries these: the learning pipeline grounds every
    question in the learner's OWN materialized sources, and a link to a third-party
    page is not evidence. The model stays because the DEPRECATED flashcard context
    path (``FlashcardContextRequest``/``Response``, ``POST /v1/study/flashcards/
    generations``) still populates it, and that path is Notes-and-Flashcards work,
    not Quiz work. It goes when that path goes.
    """

    practice_source_id: str
    title: str
    url: str
    resource_type: PracticeResourceType
    why_recommended: str
    snippets: list[str] = Field(default_factory=list)
    domain_score: float = 0.0
    trust_flags: list[str] = Field(default_factory=list)


class ExternalEvidence(BaseModel):
    """LEGACY, for the same reason as :class:`PracticeSource`. Quiz emits none."""

    practice_source_id: str
    title: str
    url: str
    snippets: list[str] = Field(default_factory=list)


class EvidenceChunk(BaseModel):
    evidence_id: str
    chunk_id: uuid.UUID
    content: str
    polished_text: str | None = None
    support_type: Literal["primary", "prerequisite", "related", "external"]
    source_ref: SourceRef
    metadata: dict[str, Any] = Field(default_factory=dict)


class ConceptSupportRef(BaseModel):
    evidence_id: str
    chunk_id: uuid.UUID | None = None
    support_type: ConceptSupportType = "primary"
    rank: int = 0
    excerpt: str
    source_ref: SourceRef
    metadata: dict[str, Any] = Field(default_factory=dict)


class StudyConcept(BaseModel):
    concept_id: str
    topic_id: str
    concept_name: str
    normalized_name: str
    definition: str
    intuition: str = ""
    rules: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    misconceptions: list[str] = Field(default_factory=list)
    prerequisite_topic_ids: list[str] = Field(default_factory=list)
    related_concept_ids: list[str] = Field(default_factory=list)
    difficulty: ResolvedDifficulty = "intermediate"
    confidence: float = 0.0
    support_refs: list[ConceptSupportRef] = Field(default_factory=list)
    anchor_refs: list[str] = Field(default_factory=list)
    catalog_version: str


class FlashcardContextBundle(BaseModel):
    topic_id: str
    learning_objective: str
    key_terms: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    evidence_chunks: list[EvidenceChunk] = Field(default_factory=list)
    citations: list[SourceRef] = Field(default_factory=list)
    external_evidence: list[ExternalEvidence] = Field(default_factory=list)
    recommended_card_mix: dict[str, int] = Field(default_factory=dict)
    concepts: list[StudyConcept] = Field(default_factory=list)


class FlashcardContextResponse(BaseModel):
    context_snapshot_id: uuid.UUID
    topics: list[TopicRef]
    bundles: list[FlashcardContextBundle]
    recommended_practice_sources: list[PracticeSource] = Field(default_factory=list)


class GenerationJob(BaseModel):
    job_id: uuid.UUID
    kind: StudyJobKind
    status: StudyJobStatus
    expires_at: datetime
    poll_url: str
    progress: int = 0
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None


class FlashcardItem(BaseModel):
    flashcard_id: str
    topic_id: str
    concept_id: str | None = None
    concept_name: str | None = None
    card_type: FlashcardType
    difficulty: ResolvedDifficulty
    front: str
    back: str
    why_it_matters: str
    hints: list[str] = Field(default_factory=list)
    source_refs: list[SourceRef]
    evidence_chunks: list[EvidenceChunk]
    external_refs: list[ExternalEvidence] = Field(default_factory=list)
    # MiR metadata (populated when the card back was anchored to a user interest).
    # Clients feed `mir_log_id` back to POST /mir/feedback to record thumbs up/down.
    mir_log_id: uuid.UUID | None = None
    mir_anchor_label: str | None = None


class QuizAsset(BaseModel):
    asset_id: str
    type: Literal["image", "table", "formula"]
    # Either a URL the client can fetch directly (a question bank's own asset
    # manifest carries one), or None with `source_id` set — a durable reference
    # the client resolves through the scoped asset route, which re-checks
    # ownership at read time. A presigned URL expires; a saved quiz does not.
    url: str | None = None
    source_id: uuid.UUID | None = None
    markdown: str | None = None
    latex: str | None = None
    alt_text: str | None = None


class QuizItem(BaseModel):
    question_id: str
    topic_id: str
    concept_id: str | None = None
    concept_name: str | None = None
    question_type: QuizQuestionType
    difficulty: ResolvedDifficulty
    prompt: str
    hint: str | None = None
    explanation: str
    source_refs: list[SourceRef]
    evidence_chunks: list[EvidenceChunk]
    external_refs: list[ExternalEvidence] = Field(default_factory=list)
    options: list[str] = Field(default_factory=list)
    correct_option_index: int | None = None
    accepted_answers: list[str] = Field(default_factory=list)
    normalization_rules: list[str] = Field(default_factory=list)
    reference_answer: str | None = None
    grading_rubric: list[str] = Field(default_factory=list)
    scoring_scale: int | None = None
    # `prompt` and `explanation` may contain [ASSET:<asset_id>] placeholders
    # resolving to entries here.  option_assets is parallel to options:
    # option_assets[i] holds the assets for options[i] (empty for text-only
    # options).  Populated only for question-bank verbatim items today.
    assets: list[QuizAsset] = Field(default_factory=list)
    option_assets: list[list[QuizAsset]] = Field(default_factory=list)


class QuizQuestionView(BaseModel):
    question_id: str
    topic_id: str
    concept_id: str | None = None
    concept_name: str | None = None
    question_type: QuizQuestionType
    difficulty: ResolvedDifficulty
    prompt: str
    hint: str | None = None
    source_refs: list[SourceRef]
    evidence_chunks: list[EvidenceChunk]
    external_refs: list[ExternalEvidence] = Field(default_factory=list)
    options: list[str] = Field(default_factory=list)
    normalization_rules: list[str] = Field(default_factory=list)
    scoring_scale: int | None = None
    assets: list[QuizAsset] = Field(default_factory=list)
    option_assets: list[list[QuizAsset]] = Field(default_factory=list)


class StudyGenerationMetrics(BaseModel):
    concept_count: int = 0
    generated_count: int = 0
    accepted_count: int = 0
    repaired_count: int = 0
    rejected_count: int = 0
    fallback_count: int = 0
    duplicate_reject_count: int = 0
    avg_answer_chars: float = 0.0
    avg_question_alignment: float = 0.0
    avg_answer_alignment: float = 0.0
    reject_reasons: dict[str, int] = Field(default_factory=dict)


class FlashcardGenerationResult(BaseModel):
    topics: list[TopicRef]
    items: list[FlashcardItem]
    generation_title: str | None = None
    warnings: list[str] = Field(default_factory=list)
    recommended_practice_sources: list[PracticeSource] = Field(default_factory=list)
    metrics: StudyGenerationMetrics | None = None


class QuizGenerationResult(BaseModel):
    """A generated quiz, answer key included. The authoring-side view.

    ``recommended_practice_sources`` was removed with the legacy context builder.
    A quiz payload persisted before that still has the key; pydantic ignores it,
    which is what lets an old saved quiz open and play unchanged.
    """

    topics: list[TopicRef]
    items: list[QuizItem]
    generation_title: str | None = None
    is_timed: bool = False
    time_limit: int | None = Field(default=None, ge=1)
    warnings: list[str] = Field(default_factory=list)
    metrics: StudyGenerationMetrics | None = None


class QuizPublicGenerationResult(BaseModel):
    """The same quiz with every answer-bearing field stripped. The learner's view."""

    topics: list[TopicRef]
    items: list[QuizQuestionView]
    generation_title: str | None = None
    is_timed: bool = False
    time_limit: int | None = Field(default=None, ge=1)
    warnings: list[str] = Field(default_factory=list)
    metrics: StudyGenerationMetrics | None = None


class TopicSelectionRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    topic_ids: list[str] = Field(default_factory=list)
    manual_topics: list[str] = Field(default_factory=list)
    query: str | None = None
    source_ids: list[uuid.UUID] | None = None
    student_profile: StudentProfile = Field(default_factory=StudentProfile)
    learning_goal: LearningGoal = Field(default_factory=LearningGoal)
    web_augmentation: WebAugmentation = Field(default_factory=WebAugmentation)
    # Cost bound: when the user doesn't explicitly pick topic_ids, this
    # caps how many topics get full context assembly (retrieval + concept
    # normalization LLM calls).  10 topics × ~1 LLM call each = ~10 calls.
    # The user can override by sending more topic_ids explicitly — then
    # len(topic_ids) overrides this cap in _resolve_topics().
    topic_limit: int = Field(default=10, ge=1, le=30)

    @model_validator(mode="after")
    def _validate_topic_selection(self) -> "TopicSelectionRequest":
        if not self.topic_ids and not self.manual_topics and not self.query:
            raise ValueError("Provide topic_ids, manual_topics, or query.")
        selected_count = len(self.topic_ids) + len(self.manual_topics)
        if selected_count > MAX_SELECTED_TOPICS:
            raise ValueError(
                f"At most {MAX_SELECTED_TOPICS} topics may be selected per request "
                f"(received {selected_count}: {len(self.topic_ids)} topic_ids + "
                f"{len(self.manual_topics)} manual_topics)."
            )
        return self


class FlashcardContextRequest(TopicSelectionRequest):
    difficulty: StudyDifficulty = "auto"
    card_types: list[FlashcardType] = Field(default_factory=list)
    cards_per_topic: int = Field(default=3, ge=1, le=100)
    include_prerequisites: bool = False
    include_related: bool = False
    practice_source_ids: list[str] = Field(default_factory=list)


class FlashcardGenerationRequest(FlashcardContextRequest):
    context_snapshot_id: uuid.UUID | None = None
    # When true, and the user has at least one active interest, flashcard backs
    # are framed via an interest anchor (MiR). False forces standard output even
    # if the user has interests configured. Default-on per PRD §14.
    mir_enabled: bool = True

    @model_validator(mode="after")
    def _validate_topic_selection(self) -> "FlashcardGenerationRequest":
        if self.context_snapshot_id is not None:
            return self
        if not self.topic_ids and not self.manual_topics and not self.query:
            raise ValueError("Provide topic_ids, manual_topics, or query.")
        selected_count = len(self.topic_ids) + len(self.manual_topics)
        if selected_count > MAX_SELECTED_TOPICS:
            raise ValueError(
                f"At most {MAX_SELECTED_TOPICS} topics may be selected per request "
                f"(received {selected_count}: {len(self.topic_ids)} topic_ids + "
                f"{len(self.manual_topics)} manual_topics)."
            )
        return self


class QuizAnswerInput(BaseModel):
    question_id: str
    selected_option_index: int | None = None
    answer_text: str | None = None
    fluency_metrics: QuizFluencyMetrics | None = None
    is_timeout: bool = False

    @model_validator(mode="after")
    def _normalize_answer(self) -> "QuizAnswerInput":
        if self.answer_text is not None:
            stripped = self.answer_text.strip()
            self.answer_text = stripped or None
        return self


class QuizAttemptStartRequest(BaseModel):
    tenant_id: str
    user_uuid: str
    mode: QuizMode = "deferred"


class SavedSetCreateRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    generation_job_id: uuid.UUID
    title: str | None = None
    chapter_id: uuid.UUID | None = None


class SavedSetRenameRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    title: str

    @model_validator(mode="after")
    def _validate_title(self) -> "SavedSetRenameRequest":
        if not self.title.strip():
            raise ValueError("title is required")
        return self


class SavedSetUpdateRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    title: str | None = None
    chapter_id: uuid.UUID | None = None


class FlashcardContentUpdateRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    front: str | None = None
    back: str | None = None

    @model_validator(mode="after")
    def _validate_content(self) -> "FlashcardContentUpdateRequest":
        if self.front is None and self.back is None:
            raise ValueError("Provide front or back.")
        if self.front is not None and not self.front.strip():
            raise ValueError("front is required")
        if self.back is not None and not self.back.strip():
            raise ValueError("back is required")
        return self


class FlashcardVariantCreateRequest(BaseModel):
    """POST /study/flashcards/saved/{saved_set_id}/cards body.

    Appends a NEW flashcard to an existing saved set, derived from one
    of its cards. Used for adopting a MiR-generated interest-anchored
    variant the user liked. Topic, difficulty, concept, evidence, and
    why-it-matters are copied from the source card; `front`/`back`
    come from the request; MiR metadata is attached for feedback.
    """

    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    source_flashcard_id: str = Field(min_length=1)
    front: str = Field(min_length=1, max_length=1000)
    back: str = Field(min_length=1, max_length=2000)
    mir_log_id: uuid.UUID | None = None
    mir_anchor_label: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def _strip(self) -> "FlashcardVariantCreateRequest":
        self.front = self.front.strip()
        self.back = self.back.strip()
        if not self.front or not self.back:
            raise ValueError("front and back must be non-empty.")
        if self.mir_anchor_label is not None:
            stripped = self.mir_anchor_label.strip()
            self.mir_anchor_label = stripped or None
        return self


class FlashcardProgressUpdateRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    seen: bool | None = None
    flipped: bool | None = None
    mastered: bool | None = None
    confidence: SRSConfidence | None = None

    @model_validator(mode="after")
    def _validate_state(self) -> "FlashcardProgressUpdateRequest":
        if self.seen is None and self.flipped is None and self.mastered is None and self.confidence is None:
            raise ValueError("Provide seen, flipped, mastered, or confidence.")
        return self


class QuizAttemptQuestionUpdateRequest(BaseModel):
    tenant_id: str
    user_uuid: str
    selected_option_index: int | None = None
    answer_text: str | None = None
    fluency_metrics: QuizFluencyMetrics | None = None
    is_timeout: bool = False

    @model_validator(mode="after")
    def _normalize_answer(self) -> "QuizAttemptQuestionUpdateRequest":
        if self.answer_text is not None:
            stripped = self.answer_text.strip()
            self.answer_text = stripped or None
        return self


class QuizAttemptCompleteRequest(BaseModel):
    tenant_id: str
    user_uuid: str


class QuizAttemptViewPreferences(BaseModel):
    topic_ids: list[str] | None = None
    question_types: list[QuizQuestionType] | None = None
    difficulties: list[ResolvedDifficulty] | None = None


class QuizAttemptViewUpdateRequest(BaseModel):
    tenant_id: str
    user_uuid: str
    view_preferences: QuizAttemptViewPreferences = Field(default_factory=QuizAttemptViewPreferences)


class QuizQuestionHelpMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class QuizQuestionHelpRequest(BaseModel):
    tenant_id: str
    user_uuid: str
    query: str = Field(..., min_length=1, max_length=4000)
    history: list[QuizQuestionHelpMessage] = Field(default_factory=list)
    reasoning_effort: ReasoningEffort = "minimal"

    @model_validator(mode="after")
    def _validate_query(self) -> "QuizQuestionHelpRequest":
        if not self.query.strip():
            raise ValueError("Provide query.")
        return self


class QuizQuestionHelpUsage(BaseModel):
    input_tokens: int
    output_tokens: int


class QuizQuestionHelpSource(BaseModel):
    citation_id: str
    source_id: uuid.UUID
    chunk_id: uuid.UUID | None = None
    title: str | None = None
    page_number: int | None = None
    excerpt: str | None = None
    support_type: Literal["primary", "prerequisite", "related", "external"] = "primary"


class QuizQuestionHelpResponse(BaseModel):
    question_id: str
    answer: str
    sources: list[QuizQuestionHelpSource] = Field(default_factory=list)
    usage: QuizQuestionHelpUsage


class QuizEvaluationSummary(BaseModel):
    total_questions: int
    correct_count: int
    score: float
    indeterminate_count: int = 0
    achieved_marks: float | None = None
    total_marks: int | None = None


class QuizFluencyMetrics(BaseModel):
    wpm: int
    filler_ratio: float
    avg_word_confidence: float
    avg_pause_ms: int
    filler_count: int


class QuizAuthoritativeAnswer(BaseModel):
    correct_option_index: int | None = None
    correct_option_text: str | None = None
    correct_option_assets: list[QuizAsset] = Field(default_factory=list)
    accepted_answers: list[str] = Field(default_factory=list)
    reference_answer: str | None = None


class QuizEvaluationItemResult(BaseModel):
    question_id: str
    question_type: QuizQuestionType
    correct: bool
    score: float
    confidence: float
    normalized_answer: str | None = None
    feedback: str
    explanation: str
    source_refs: list[SourceRef] = Field(default_factory=list)
    authoritative_answer: QuizAuthoritativeAnswer | None = None
    grading_state: GradingState = "graded"
    fluency_metrics: QuizFluencyMetrics | None = None
    marks: float | None = None


class QuizEvaluationResult(BaseModel):
    summary: QuizEvaluationSummary
    results: list[QuizEvaluationItemResult]


class QuizQuestionState(BaseModel):
    question_id: str
    answer: QuizAnswerInput | None = None
    answered: bool = False
    locked: bool = False
    submitted_at: datetime | None = None
    graded_at: datetime | None = None
    started_at: datetime | None = None
    result: QuizEvaluationItemResult | None = None


class QuizAttemptProgress(BaseModel):
    total_questions: int = 0
    answered_count: int = 0
    graded_count: int = 0
    locked_count: int = 0
    remaining_count: int = 0


class QuizAttemptSummary(BaseModel):
    attempt_id: uuid.UUID
    mode: QuizMode
    status: QuizAttemptStatus
    saved_set_id: uuid.UUID | None = None
    source_generation_job_id: uuid.UUID | None = None
    progress: QuizAttemptProgress = Field(default_factory=QuizAttemptProgress)
    summary: QuizEvaluationSummary | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    completed_at: datetime | None = None
    server_time: datetime = Field(default_factory=utcnow)


class QuizAttemptDetail(QuizAttemptSummary):
    quiz: QuizPublicGenerationResult
    view_preferences: QuizAttemptViewPreferences = Field(default_factory=QuizAttemptViewPreferences)
    question_states: list[QuizQuestionState] = Field(default_factory=list)


class FlashcardProgressState(BaseModel):
    flashcard_id: str
    seen: bool = False
    flipped: bool = False
    mastered: bool = False
    review_count: int = 0
    first_seen_at: datetime | None = None
    last_reviewed_at: datetime | None = None
    mastered_at: datetime | None = None
    updated_at: datetime | None = None
    # SRS fields
    ease_factor: float = 2.5
    interval_days: int = 0
    next_review_at: datetime | None = None


class FlashcardDeckProgressSummary(BaseModel):
    total_cards: int = 0
    seen_count: int = 0
    flipped_count: int = 0
    mastered_count: int = 0
    review_count: int = 0


class FlashcardProgressUpdateResponse(BaseModel):
    card_progress: FlashcardProgressState
    progress_summary: FlashcardDeckProgressSummary


class FlashcardReviewQueueResponse(BaseModel):
    """Cards ordered for review: overdue first, then due today, then new."""
    items: list[FlashcardItem] = Field(default_factory=list)
    due_count: int = 0
    new_count: int = 0


class FlashcardSavedSetSummary(BaseModel):
    saved_set_id: uuid.UUID
    kind: Literal["flashcards"] = "flashcards"
    title: str | None = None
    chapter_id: uuid.UUID | None = None
    source_generation_job_id: uuid.UUID | None = None
    topic_labels: list[str] = Field(default_factory=list)
    item_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_activity_at: datetime | None = None
    progress_summary: FlashcardDeckProgressSummary = Field(default_factory=FlashcardDeckProgressSummary)


class FlashcardSavedSetDetail(FlashcardSavedSetSummary):
    generated_payload: FlashcardGenerationResult
    card_progress_by_id: dict[str, FlashcardProgressState] = Field(default_factory=dict)


class QuizSavedSetSummary(BaseModel):
    saved_set_id: uuid.UUID
    kind: Literal["quiz"] = "quiz"
    title: str | None = None
    chapter_id: uuid.UUID | None = None
    source_generation_job_id: uuid.UUID | None = None
    topic_labels: list[str] = Field(default_factory=list)
    item_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_activity_at: datetime | None = None
    completed_attempt_count: int = 0
    latest_completed_attempt: QuizAttemptSummary | None = None
    active_attempt: QuizAttemptSummary | None = None


class QuizSavedSetDetail(QuizSavedSetSummary):
    generated_payload: QuizPublicGenerationResult


# ---------------------------------------------------------------------------
# Notes schemas
# ---------------------------------------------------------------------------

NotesSourceScope = Literal["combined", "per_source"]
NotesExpandMode = Literal["deep_dive", "simplify", "add_examples", "add_practice"]


class NoteTable(BaseModel):
    table_id: str
    title: str | None = None
    markdown_content: str
    source_ref: SourceRef | None = None


class NoteImage(BaseModel):
    image_id: str
    public_url: str
    caption: str | None = None
    page_number: int | None = None
    source_ref: SourceRef | None = None


class NoteEquation(BaseModel):
    equation_id: str
    latex_source: str
    description: str | None = None
    source_ref: SourceRef | None = None


class NoteCode(BaseModel):
    code_id: str
    language: str
    code_text: str
    description: str | None = None
    source_ref: SourceRef | None = None


class NoteConceptNode(BaseModel):
    concept: str                                          # concept name, 3-6 words
    definition: str                                       # 1-2 sentence definition
    sub_concepts: list[str] = Field(default_factory=list) # 2-5 sub-points, 20-40 words each


class NoteKeyTerm(BaseModel):
    term: str
    definition: str                                       # 1-2 sentences


class NoteSection(BaseModel):
    section_id: str
    topic_id: str
    title: str
    summary: str
    key_points: list[str] = Field(default_factory=list)
    tables: list[NoteTable] = Field(default_factory=list)
    images: list[NoteImage] = Field(default_factory=list)
    equations: list[NoteEquation] = Field(default_factory=list)
    code_blocks: list[NoteCode] = Field(default_factory=list)
    source_refs: list[SourceRef] = Field(default_factory=list)
    evidence_chunks: list[EvidenceChunk] = Field(default_factory=list)
    enhanced: bool = False
    source_id: uuid.UUID | None = None
    source_title: str | None = None
    concepts: list[NoteConceptNode] = Field(default_factory=list)
    key_terms: list[NoteKeyTerm] = Field(default_factory=list)
    cross_references: list[str] = Field(default_factory=list)


class NotesOutlineEntry(BaseModel):
    section_id: str
    topic_id: str
    title: str
    scope: str                    # 1-2 sentences: what this section covers
    depth_hint: Literal["shallow", "standard", "deep"] = "standard"
    preceding_context: str = ""   # what came before (for cross-section awareness)


class NotesOutline(BaseModel):
    content_type: Literal["textbook", "lecture_slides", "research_paper", "transcript", "mixed"] = "mixed"
    generation_title: str | None = None
    outline_entries: list[NotesOutlineEntry] = Field(default_factory=list)
    global_context: str = ""      # 2-3 sentence overview of the entire document


class NotesContextBundle(BaseModel):
    topic_id: str
    learning_objective: str
    key_terms: list[str] = Field(default_factory=list)
    evidence_chunks: list[EvidenceChunk] = Field(default_factory=list)
    citations: list[SourceRef] = Field(default_factory=list)
    available_tables: list[NoteTable] = Field(default_factory=list)
    available_images: list[NoteImage] = Field(default_factory=list)
    available_equations: list[NoteEquation] = Field(default_factory=list)
    available_code_blocks: list[NoteCode] = Field(default_factory=list)
    concepts: list[StudyConcept] = Field(default_factory=list)
    source_id: uuid.UUID | None = None
    source_title: str | None = None
    outline_entry: NotesOutlineEntry | None = None
    global_context: str = ""
    content_type: str = "mixed"


class NotesContextRequest(TopicSelectionRequest):
    sections_per_topic: int = Field(default=1, ge=1, le=3)
    source_scope: NotesSourceScope = "combined"
    include_tables: bool = True
    include_images: bool = True
    include_equations: bool = True
    include_code: bool = True
    include_prerequisites: bool = False
    include_related: bool = False


class NotesContextResponse(BaseModel):
    context_snapshot_id: uuid.UUID
    topics: list[TopicRef]
    bundles: list[NotesContextBundle]


class NotesGenerationRequest(NotesContextRequest):
    context_snapshot_id: uuid.UUID | None = None
    # MiR (Make it Relevant): when True (default), the notes service attempts
    # to rewrite the first sentence of each section summary as an interest-
    # anchored hook. Set False to force non-MiR output even for users with an
    # active interest profile.
    mir_enabled: bool = True


class NotesGenerationResult(BaseModel):
    topics: list[TopicRef]
    sections: list[NoteSection]
    generation_title: str | None = None
    warnings: list[str] = Field(default_factory=list)
    metrics: StudyGenerationMetrics | None = None


class NotesEnhanceRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    expand_mode: NotesExpandMode = "deep_dive"
    focus_areas: list[str] = Field(default_factory=list)


class NotesEnhanceResponse(BaseModel):
    saved_set_id: uuid.UUID
    section_id: str
    section: NoteSection
    warnings: list[str] = Field(default_factory=list)


class NotesSavedSetSummary(BaseModel):
    saved_set_id: uuid.UUID
    kind: Literal["notes"] = "notes"
    title: str | None = None
    chapter_id: uuid.UUID | None = None
    source_generation_job_id: uuid.UUID | None = None
    topic_labels: list[str] = Field(default_factory=list)
    section_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_activity_at: datetime | None = None


class NotesSavedSetDetail(NotesSavedSetSummary):
    generated_payload: NotesGenerationResult


# ---------------------------------------------------------------------------
# Manual notes schemas
# ---------------------------------------------------------------------------

ManualNoteKind = Literal["typed", "drawn"]
ManualNoteSaveReason = Literal["autosave", "manual"]
#: What a note can be derived from. A derived note is still the student's own typed
#: note; its origin only records what it was built from.
ManualNoteOriginKind = Literal["audio_handout"]


class ManualNoteOriginRequest(BaseModel):
    """The artifact a new note was converted from, as the client claims it.

    The server verifies the claim against the source's CURRENT registration before a
    row is written, and records the schema version and build policy from that
    registration rather than from the client.
    """

    kind: ManualNoteOriginKind
    source_id: uuid.UUID
    handout_checksum: str = Field(pattern=r"^[0-9a-f]{64}$")
    adapter_version: str = Field(min_length=1, max_length=64)


class ManualNoteOrigin(BaseModel):
    """A derived note's provenance: written once, when the note is created, and never updated."""

    kind: ManualNoteOriginKind
    source_id: uuid.UUID
    handout_checksum: str
    handout_schema: str
    handout_schema_version: int
    handout_policy: str
    adapter_version: str


class ManualNoteCreateRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    kind: ManualNoteKind
    title: str | None = None
    payload_json: dict[str, Any] = Field(default_factory=dict)
    save_reason: ManualNoteSaveReason = "autosave"
    origin: ManualNoteOriginRequest | None = None


class ManualNoteUpdateRequest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    base_revision: int = Field(ge=1)
    title: str | None = None
    payload_json: dict[str, Any] | None = None
    save_reason: ManualNoteSaveReason = "autosave"

    @model_validator(mode="after")
    def _validate_patch(self) -> "ManualNoteUpdateRequest":
        has_title = self.title is not None
        has_payload = self.payload_json is not None
        if not has_title and not has_payload:
            raise ValueError("Provide title or payload_json.")
        return self


class ManualNoteSummary(BaseModel):
    note_id: uuid.UUID
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    kind: ManualNoteKind
    title: str
    revision: int
    payload_size_bytes: int = 0
    content_text: str = ""
    content_stats: dict[str, Any] = Field(default_factory=dict)
    origin: ManualNoteOrigin | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    last_activity_at: datetime | None = None


class ManualNoteDetail(ManualNoteSummary):
    payload_json: dict[str, Any] = Field(default_factory=dict)
    payload_hash: str


class ManualNoteRevisionSummary(BaseModel):
    revision_id: uuid.UUID
    note_id: uuid.UUID
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    revision: int
    payload_hash: str
    payload_size_bytes: int
    save_reason: ManualNoteSaveReason
    created_at: datetime | None = None
