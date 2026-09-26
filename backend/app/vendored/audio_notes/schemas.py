from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Ingest ────────────────────────────────────────────────────────────────


# ``MineruBackend``, ``ParseMethod`` and ``ContentTypeHint`` were the field types
# of ``PDFParseOptions`` and went with it. The backend and parse-method values
# still exist — as Settings fields, validated in ``core.config`` — because they
# configure the one parse path rather than one request.


# ``PDFParseOptions`` lived here: per-request overrides for MinerU backend,
# parse method, language and a content-type hint. It is DELETED with the
# synchronous PDF ingest that carried it. There is no request in the parse path
# any more — an object lands in a bucket and a stage picks it up — so the parse
# configuration comes from Settings alone, resolved once in
# ``connectors.mineru_extraction.MineruExtractionNormalizer.resolve_opts`` and
# recorded on the dispatch completion so the result stage reads the values the
# submission actually used.


GlobalIngestSourceType = Literal["pdf", "ppt", "docx", "image", "url", "youtube", "paper", "audio", "video"]


class GlobalBatchManifestItem(BaseModel):
    client_item_id: str
    source_type: GlobalIngestSourceType
    title: str | None = None
    subject_id: str | None = None
    chapter_id: uuid.UUID | None = None
    # file-backed types (pdf, ppt, docx, image)
    file_index: int | None = Field(default=None, ge=0)
    # url
    url: str | None = None
    crawl_depth: int = Field(default=0, ge=0, le=2)
    # youtube
    youtube_url: str | None = None
    # paper
    arxiv_id: str | None = None
    doi: str | None = None
    # Explicit per-item flag: when true, force the question-bank extractor
    # path and skip the LLM content-type tagging entirely. See the comment
    # on SubjectSourceBatchManifestItem.is_question_bank for the rationale.
    is_question_bank: bool = False


class GlobalBatchManifest(BaseModel):
    kb_id: uuid.UUID
    tenant_id: str
    user_uuid: str
    items: list["GlobalBatchManifestItem"] = Field(default_factory=list, min_length=1)


class GlobalBatchCreatedItem(BaseModel):
    client_item_id: str
    source_id: uuid.UUID
    job_id: uuid.UUID
    source_type: GlobalIngestSourceType
    title: str


class GlobalBatchFailedItem(BaseModel):
    client_item_id: str
    source_type: GlobalIngestSourceType
    error: str
    filename: str | None = None
    url: str | None = None
    youtube_url: str | None = None


class GlobalBatchIngestSummary(BaseModel):
    created_count: int = 0
    failed_count: int = 0
    total_count: int = 0


class GlobalBatchIngestResponse(BaseModel):
    created: list[GlobalBatchCreatedItem] = Field(default_factory=list)
    failed: list[GlobalBatchFailedItem] = Field(default_factory=list)
    summary: GlobalBatchIngestSummary = Field(default_factory=GlobalBatchIngestSummary)


# ``IngestPaperRequest`` lived here. Its only consumer was
# ``api.ingest.start_paper_ingest``, which resolved an arXiv id or DOI to a PDF
# and ran the synchronous PDF ingest on it. Both are deleted; ``paper`` items in
# a batch manifest are refused with ``api.ingest.PAPER_INGEST_UNAVAILABLE_ERROR``
# until citation acquisition is rebuilt on the EDA path (TD-INGEST-002). The
# manifest still ACCEPTS the source type so the refusal is a precise per-item
# message rather than a schema rejection nobody can act on.


class IngestResponse(BaseModel):
    job_id: uuid.UUID
    source_id: uuid.UUID
    message: str = "Ingest started"


class BatchIngestResponse(BaseModel):
    total: int
    jobs: list[IngestResponse]


class JobStatusResponse(BaseModel):
    job_id: uuid.UUID
    source_id: uuid.UUID
    status: Literal["queued", "running", "done", "error"]
    progress: int
    steps_done: list[str]
    error: str | None
    metrics: dict[str, Any] | None = None


# ── Source references ─────────────────────────────────────────────────────


class SourceRef(BaseModel):
    source_id: uuid.UUID
    chunk_id: uuid.UUID | None = None
    title: str
    source_type: str
    origin_url: str | None
    page_number: int | None = None
    # Populated for video/audio chunks so the UI can deep-link into the
    # exact moment, e.g. "{origin_url}&t={int(timestamp_start)}s" for YouTube.
    timestamp_start: float | None = None
    timestamp_end: float | None = None
    excerpt: str | None = None
    # Tree-walk trace from the agentic retriever — list of {level, label,
    # source_id, source_title} entries from root → leaf. Empty for chunks
    # retrieved via vector / BM25 / direct doctree paths.
    traversal_path: list[dict[str, Any]] = Field(default_factory=list)
