from __future__ import annotations

import json
import logging
import re
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

from core.config import get_settings
from core.llm_client import call_llm
from core.study_schemas import (
    EvidenceChunk,
    NoteCode,
    NoteConceptNode,
    NoteEquation,
    NoteImage,
    NoteKeyTerm,
    NoteSection,
    NoteTable,
    NotesContextBundle,
    NotesContextResponse,
    NotesGenerationResult,
    NotesOutline,
    NotesOutlineEntry,
    SourceRef,
    StudyConcept,
    TopicRef,
)
from study.utils import clean_study_text, split_sentences, stable_hash, unique_preserve_order

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[int, list[str] | None], None]
_NOTES_MAX_TOKENS = 4096
_NOTES_FALLBACK_MEDIA_LIMIT = 3

# ---------------------------------------------------------------------------
# System prompts — module-level constants for OpenAI prefix-cache optimisation
# ---------------------------------------------------------------------------

_NOTES_OUTLINE_SYSTEM_PROMPT = (
    "You are a document analysis engine. Output strict JSON only — no markdown fences, no prose.\n\n"
    "You will receive a list of topic bundles extracted from one or more documents. "
    "Your job is to produce a structural outline that will guide detailed notes generation.\n\n"
    "OUTPUT SCHEMA:\n"
    '{"content_type":"<textbook|lecture_slides|research_paper|transcript|mixed>",'
    '"generation_title":"<short descriptive title for the notes set ≤10 words>",'
    '"global_context":"<2-3 sentence overview of the entire material>",'
    '"outline_entries":[{'
    '"section_id":"<copy from input>",'
    '"topic_id":"<copy from input>",'
    '"title":"<proposed section heading ≤10 words>",'
    '"scope":"<1-2 sentences: what this section should cover>",'
    '"depth_hint":"<shallow|standard|deep>",'
    '"preceding_context":"<1 sentence: what the reader already knows from prior sections>"'
    "}]}\n\n"
    "RULES:\n"
    "- content_type: infer from structural patterns — many short headings/bullet points = lecture_slides; "
    "numbered chapters with theory+exercises = textbook; abstract+methodology+results = research_paper; "
    "conversational with timestamps = transcript; otherwise mixed\n"
    "- generation_title: a concise, professional title that encompasses the entire notes set\n"
    "- global_context: synthesize the overarching subject, scope, and learning goals across all topics\n"
    "- For the FIRST entry, preceding_context should be empty string\n"
    "- depth_hint: 'deep' for complex/foundational topics with many evidence chunks; "
    "'shallow' for simple/supplementary topics; 'standard' otherwise\n"
    "- title: derive from the topic label and learning objective; name the core concept clearly\n"
    "- scope: describe what specific aspects the section should address\n"
    "- Preserve the input ordering of topics\n"
    "- Emit exactly one outline_entry per input bundle\n"
    "- LANGUAGE RULE: All output fields MUST be written in English, even if the provided source material is in another language (e.g., Hindi).\n"
)

_NOTES_BULK_SYSTEM_PROMPT = (
    "You are a structured revision-notes generation engine for a multimodal knowledge base. "
    "Output strict JSON only — no markdown fences, no prose outside the JSON object.\n\n"
    "OUTPUT SCHEMA:\n"
    '{"sections":[{'
    '"section_id":"<copy from input>",'
    '"topic_id":"<copy from input>",'
    '"title":"<heading ≤10 words, derived from source headings>",'
    '"summary":"<3-5 sentences>",'
    '"concepts":[{"concept":"<name 3-6 words>","definition":"<1-2 sentences>","sub_concepts":["<20-40 words each>"]}],'
    '"key_terms":[{"term":"<term>","definition":"<1-2 sentences>"}],'
    '"key_points":["<revision bullet ≤30 words>"],'
    '"table_ids":["<table_id from available_tables>"],'
    '"image_ids":["<image_id from available_images>"],'
    '"equation_ids":["<equation_id from available_equations>"],'
    '"code_ids":["<code_id from available_code_blocks>"],'
    '"source_refs":[{"evidence_id":"<evidence_id>","citation":"<short label>"}]'
    "}]}\n\n"
    "FIELD RULES — ALL MUST BE FOLLOWED:\n"
    "section_id: copy the section_id from the bundle input exactly — do not generate new IDs\n"
    "topic_id: copy from bundle topic_id exactly\n"
    "title: derive from the most prominent heading or section title in the source material; ≤10 words; "
    "name the core concept clearly\n"
    "summary: state the main idea, its significance, and key insights; depth and length MUST be proportional to the volume and density of the provided evidence (range 2-8 sentences); write as a study guide author, not as someone describing the document\n"
    "concepts: 3-8 concept nodes; use the source's section/heading structure as the skeleton; "
    "each concept has a name (3-6 words), a definition (1-2 sentences), and 2-5 sub_concepts "
    "(each 20-40 words, explaining a specific aspect, mechanism, condition, or implication of that concept); scale the number of concepts with the richness of the evidence\n"
    "key_terms: 3-10 important vocabulary terms with precise 1-2 sentence definitions; "
    "prioritise terms a student must know for exams or real-world applications\n"
    "key_points: 5-15 bullets; each ≤30 words; revision-style — focus on understanding and application, "
    "not memorisation of facts; active voice; start each with a verb or concrete noun; "
    "no repetition with summary; include relationships, mechanisms, consequences, and examples; count of bullets should scale with the amount of source evidence provided\n"
    "table_ids: IDs from available_tables that directly illustrate this section — "
    "only include tables whose content is supported by the evidence; omit list if none apply\n"
    "image_ids: same rule as table_ids but for available_images\n"
    "equation_ids: same rule for available_equations\n"
    "code_ids: same rule for available_code_blocks\n"
    "source_refs: for each evidence_id you drew from, include it with a short citation label "
    "(e.g. page number or section title); minimum 1 source_ref per section\n\n"
    "REVISION-NOTES STYLE RULES:\n"
    "  - Write to build understanding, not just recall. Ask: 'Why does this matter?' and 'How does this work?'\n"
    "  - concepts section must reflect the conceptual hierarchy from the source — not a flat list of facts\n"
    "  - sub_concepts should explain mechanisms, conditions, implications, or contrasts — not just restate the concept\n"
    "  - key_terms are for vocabulary; key_points are for principles — do not duplicate content between them\n"
    "  - summary must NOT simply restate key_points as prose\n"
    "  - Do not hallucinate content absent from the provided evidence chunks\n"
    "  - Do not write 'the document says' or 'the passage states' — write as a study guide author\n"
    "  - Emit exactly one section object per bundle in the input (no merging, no splitting)\n"
    "  - table_ids/image_ids/equation_ids/code_ids must only reference IDs from the provided "
    "available_* lists — never fabricate IDs\n"
    "- If the evidence contains a table, equation, image, or code block relevant to the topic, "
    "include its ID — do not skip rich media unnecessarily\n"
    "- LANGUAGE RULE: You must output all notes content (summaries, concept definitions, key points, etc.) in English. If the source material is in Hindi or another language, translate it into standard academic English.\n"
)

_CONTENT_TYPE_SUFFIXES: dict[str, str] = {
    "textbook": (
        "\nCONTENT-TYPE GUIDANCE (textbook):\n"
        "  - Emphasize definitions, theorems, and worked examples\n"
        "  - Structure concepts as a learning progression from foundational to advanced\n"
        "  - Key points should include formulas, rules, and application conditions\n"
    ),
    "lecture_slides": (
        "\nCONTENT-TYPE GUIDANCE (lecture slides):\n"
        "  - Synthesize across fragmented slide content — fill in implicit connections between bullet points\n"
        "  - Add transitional context that the slides assume but don't state\n"
        "  - Convert abbreviated slide notes into complete, coherent explanations\n"
    ),
    "research_paper": (
        "\nCONTENT-TYPE GUIDANCE (research paper):\n"
        "  - Emphasize methodology, findings, and implications\n"
        "  - Distinguish claims from evidence; note limitations\n"
        "  - Key points should highlight novel contributions and practical takeaways\n"
    ),
    "transcript": (
        "\nCONTENT-TYPE GUIDANCE (transcript):\n"
        "  - Extract structured concepts from conversational content\n"
        "  - Organize chronological ideas thematically rather than sequentially\n"
        "  - Remove verbal filler; distill spoken explanations into precise written form\n"
        "  - PRESERVE AUTHENTICITY: Include specific metaphors, unique sentences, and characteristic words used in the audio. "
        "The notes should feel like they were captured directly from this specific session, retaining the speaker's original flavor.\n"
        "  - RELATIVE SCALING: Scale the detail level based on the transcript duration and density. If the provided segments are brief, be concise. If they are extensive, be detailed and exhaustive.\n"
    ),
}

_NOTES_REPAIR_SYSTEM_PROMPT = (
    "You are a study notes repair engine. Output strict JSON only — no markdown fences, no prose.\n\n"
    "You will receive a note section that failed quality validation, the validation failure reasons, "
    "and the original evidence chunks. Fix ONLY the issues listed in the failure reasons while "
    "preserving all valid content from the original section.\n\n"
    "OUTPUT SCHEMA:\n"
    '{"section":{'
    '"section_id":"<preserve from input>",'
    '"topic_id":"<preserve from input>",'
    '"title":"<heading ≤10 words>",'
    '"summary":"<3-5 sentences>",'
    '"concepts":[{"concept":"<name 3-6 words>","definition":"<1-2 sentences>","sub_concepts":["<20-40 words each>"]}],'
    '"key_terms":[{"term":"<term>","definition":"<1-2 sentences>"}],'
    '"key_points":["<revision bullet ≤30 words>"],'
    '"table_ids":["<id>"],"image_ids":["<id>"],"equation_ids":["<id>"],"code_ids":["<id>"],'
    '"source_refs":[{"evidence_id":"<id>","citation":"<label>"}]}}\n\n'
    "RULES:\n"
    "  - Fix ONLY the listed issues; do not rewrite content that is already valid\n"
    "  - Preserve section_id and topic_id exactly\n"
    "  - Do not hallucinate content absent from the provided evidence\n"
    "  - Only reference IDs from the provided available_* lists\n"
    "  - Minimum 1 source_ref in output\n"
    "  - LANGUAGE RULE: All output must be in English.\n"
)

_NOTES_POLISH_SYSTEM_PROMPT = (
    "You are a study notes cross-referencing engine. Output strict JSON only — no markdown fences, no prose.\n\n"
    "You will receive a list of note sections (titles, summaries, and concept names). "
    "Add cross-references between related sections to help students navigate the material.\n\n"
    "OUTPUT SCHEMA:\n"
    '{"cross_references":{'
    '"<section_id>":["<cross-reference text>"]'
    "}}\n\n"
    "RULES:\n"
    "  - Each cross-reference should be a short phrase like 'See also: <Section Title> for <relationship>'\n"
    "  - Only add cross-references where there is a genuine conceptual connection\n"
    "  - Maximum 3 cross-references per section\n"
    "  - Do not add self-references\n"
    "  - If sections have no meaningful connections, return an empty object for that section_id\n"
)

_NOTES_ENHANCE_SYSTEM_PROMPT = (
    "You are a study notes enhancement engine. Output strict JSON only — no markdown, no prose.\n\n"
    "You will receive an existing note section and additional evidence. "
    "Return an enhanced version of the same section with richer concept hierarchy.\n\n"
    "OUTPUT SCHEMA:\n"
    '{"section":{"section_id":"<preserve>","topic_id":"<preserve>","title":"<heading>",'
    '"summary":"<sentences>",'
    '"concepts":[{"concept":"<name 3-6 words>","definition":"<1-2 sentences>","sub_concepts":["<20-40 words each>"]}],'
    '"key_terms":[{"term":"<term>","definition":"<1-2 sentences>"}],'
    '"key_points":["<revision bullet ≤30 words>"],'
    '"table_ids":["<id>"],"image_ids":["<id>"],"equation_ids":["<id>"],"code_ids":["<id>"],'
    '"source_refs":[{"evidence_id":"<id>","citation":"<label>"}]}}\n\n'
    "EXPAND MODE RULES:\n"
    "deep_dive: expand summary to 4-5 sentences; increase concepts to 5-7 nodes each with 3-5 sub_concepts; "
    "increase key_terms to 6-10; increase key_points to 8-12; pull in ALL relevant rich media from the evidence\n"
    "simplify: rewrite summary in plain language (grade-10 reading level); simplify concept definitions and "
    "sub_concepts using analogies and concrete examples; reduce key_points to 3-5; retain all rich media\n"
    "add_examples: add 2-4 worked examples within sub_concepts and key_points prefixed with 'Example:'; "
    "reference code blocks and tables where available\n"
    "add_practice: add 2-4 self-test prompts to key_points prefixed with 'Practice:'; "
    "frame as questions; include hints in parentheses\n\n"
    "CONSTRAINTS:\n"
    "  - Preserve section_id and topic_id exactly from the input\n"
    "  - Do not hallucinate content absent from the provided evidence\n"
    "  - Only reference IDs from the provided available_* lists\n"
    "  - Minimum 1 source_ref in output\n"
    "  - key_terms are for vocabulary; key_points are for principles — do not duplicate between them\n"
    "  - LANGUAGE RULE: All output must be in English.\n"
)


# ---------------------------------------------------------------------------
# Internal result types
# ---------------------------------------------------------------------------

@dataclass
class _NotesAdvanceResult:
    state: str  # "done" | "failed"
    warnings: list[str] = field(default_factory=list)
    result: NotesGenerationResult | None = None
    error: str | None = None


@dataclass
class _NotesValidationOutcome:
    valid: bool
    recoverable: bool
    reasons: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class NotesGenerationService:
    def __init__(self) -> None:
        self._settings = get_settings()

    # --- Public API --------------------------------------------------------

    def generate_notes(
        self,
        *,
        context_payload: dict[str, Any],
        request_payload: dict[str, Any],
        progress_callback: ProgressCallback | None = None,
    ) -> NotesGenerationResult:
        context = NotesContextResponse.model_validate(context_payload)
        warnings: list[str] = []

        # Phase 0: Outline generation (gpt-5-nano, single call)
        outline = self._generate_outline(context.bundles)
        bundles = self._enrich_bundles_with_outline(context.bundles, outline)

        if progress_callback:
            progress_callback(15, warnings)

        # Phase 1: Parallel section generation (gpt-5-mini)
        sections_by_bundle_index: dict[int, NoteSection] = {}
        repair_candidates: dict[int, tuple[NoteSection, NotesContextBundle, list[str]]] = {}

        if bundles:
            max_workers = min(self._settings.study_generation_concurrency, len(bundles))
            with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
                futures = {
                    pool.submit(self._generate_section_for_bundle, bundle, request_payload): idx
                    for idx, bundle in enumerate(bundles)
                }
                for future in as_completed(futures):
                    idx = futures[future]
                    try:
                        section, bundle_warnings = future.result()
                        warnings.extend(bundle_warnings)
                        if section is not None:
                            # Validate the generated section
                            outcome = self._validate_section(section, bundles[idx])
                            if outcome.valid:
                                sections_by_bundle_index[idx] = section
                            elif outcome.recoverable:
                                repair_candidates[idx] = (section, bundles[idx], outcome.reasons)
                                warnings.append(
                                    f"Section for topic {bundles[idx].topic_id} needs repair: "
                                    f"{'; '.join(outcome.reasons)}"
                                )
                            else:
                                # Hard failure — use fallback directly
                                section_id = stable_hash(
                                    bundles[idx].topic_id,
                                    bundles[idx].source_id or bundles[idx].topic_id,
                                )
                                fallback = self._build_fallback_section(
                                    bundle=bundles[idx],
                                    section_id=section_id,
                                    topic_id=bundles[idx].topic_id,
                                )
                                if bundles[idx].source_id is not None:
                                    fallback = fallback.model_copy(update={
                                        "source_id": bundles[idx].source_id,
                                        "source_title": bundles[idx].source_title,
                                    })
                                sections_by_bundle_index[idx] = fallback
                                warnings.append(
                                    f"Section for topic {bundles[idx].topic_id} failed validation "
                                    f"(non-recoverable): {'; '.join(outcome.reasons)}"
                                )
                    except Exception as exc:
                        warnings.append(f"Bundle generation failed: {exc}")

        if progress_callback:
            progress_callback(65, warnings)

        # Phase 2: Parallel repair (gpt-5-mini, only for validation failures)
        if repair_candidates:
            with ThreadPoolExecutor(
                max_workers=max(1, min(self._settings.study_generation_concurrency, len(repair_candidates)))
            ) as pool:
                repair_futures = {
                    pool.submit(
                        self._repair_section, section, bundle, reasons
                    ): idx
                    for idx, (section, bundle, reasons) in repair_candidates.items()
                }
                for future in as_completed(repair_futures):
                    idx = repair_futures[future]
                    bundle = repair_candidates[idx][1]
                    try:
                        repaired, repair_warnings = future.result()
                        warnings.extend(repair_warnings)
                        if repaired is not None:
                            sections_by_bundle_index[idx] = repaired
                        else:
                            # Repair failed — use fallback
                            section_id = stable_hash(
                                bundle.topic_id,
                                bundle.source_id or bundle.topic_id,
                            )
                            fallback = self._build_fallback_section(
                                bundle=bundle,
                                section_id=section_id,
                                topic_id=bundle.topic_id,
                            )
                            if bundle.source_id is not None:
                                fallback = fallback.model_copy(update={
                                    "source_id": bundle.source_id,
                                    "source_title": bundle.source_title,
                                })
                            sections_by_bundle_index[idx] = fallback
                    except Exception as exc:
                        warnings.append(f"Repair failed for topic {bundle.topic_id}: {exc}")
                        section_id = stable_hash(
                            bundle.topic_id,
                            bundle.source_id or bundle.topic_id,
                        )
                        fallback = self._build_fallback_section(
                            bundle=bundle,
                            section_id=section_id,
                            topic_id=bundle.topic_id,
                        )
                        if bundle.source_id is not None:
                            fallback = fallback.model_copy(update={
                                "source_id": bundle.source_id,
                                "source_title": bundle.source_title,
                            })
                        sections_by_bundle_index[idx] = fallback

        if progress_callback:
            progress_callback(85, warnings)

        # Preserve bundle order
        sections = [
            sections_by_bundle_index[i]
            for i in range(len(bundles))
            if i in sections_by_bundle_index
        ]

        # Phase 3: Cross-section polish (gpt-5-nano, single call)
        if len(sections) > 1:
            try:
                sections = self._polish_cross_references(sections)
            except Exception as exc:
                warnings.append(f"Cross-reference polish skipped: {exc}")
                logger.debug("Cross-reference polish failed: %s", exc)

        if progress_callback:
            progress_callback(95, warnings)

        return NotesGenerationResult(
            topics=context.topics,
            sections=sections,
            generation_title=outline.generation_title if outline else None,
            warnings=list(dict.fromkeys(warnings)),
        )

    def advance_notes_generation_job(
        self,
        *,
        job: Any,
        progress_callback: ProgressCallback | None = None,
    ) -> _NotesAdvanceResult:
        warnings = list(job.warnings or [])
        try:
            result = self.generate_notes(
                context_payload=job.resolved_context or {},
                request_payload=job.request_payload or {},
                progress_callback=progress_callback,
            )
            warnings = list(dict.fromkeys([*warnings, *result.warnings]))
            result.warnings = warnings
            return _NotesAdvanceResult(state="done", warnings=warnings, result=result)
        except Exception as exc:
            logger.exception("Notes generation job %s failed", job.job_id)
            return _NotesAdvanceResult(state="failed", warnings=warnings, error=str(exc))

    def enhance_section(
        self,
        *,
        saved_set_id: uuid.UUID,
        current_section: NoteSection,
        bundle: NotesContextBundle,
        expand_mode: str,
        focus_areas: list[str],
    ) -> tuple[NoteSection, list[str]]:
        warnings: list[str] = []
        user_msg = self._build_enhance_user_message(
            current_section=current_section,
            bundle=bundle,
            expand_mode=expand_mode,
            focus_areas=focus_areas,
        )
        try:
            llm_result = call_llm(
                prompt=user_msg,
                system=_NOTES_ENHANCE_SYSTEM_PROMPT,
                purpose="study_repair",
                temperature=0.3,
                max_tokens=_NOTES_MAX_TOKENS,
                json_mode=True,
            )
            raw = self._load_json_payload(llm_result.text)
            section_data = raw.get("section") or {}
            enhanced = self._parse_section(
                section_data=section_data,
                bundle=bundle,
                fallback_section_id=current_section.section_id,
                fallback_topic_id=current_section.topic_id,
            )
            enhanced = enhanced.model_copy(update={"enhanced": True})
            return enhanced, warnings
        except Exception as exc:
            warnings.append(f"Enhance failed: {exc}")
            logger.exception("Section enhance failed for saved_set %s section %s", saved_set_id, current_section.section_id)
            return current_section, warnings

    # --- Phase 0: Outline generation ---------------------------------------

    def _generate_outline(
        self,
        bundles: list[NotesContextBundle],
    ) -> NotesOutline | None:
        if not bundles:
            return None
        try:
            parts: list[str] = ["Generate a structural outline for the following topic bundles.\n"]
            for idx, bundle in enumerate(bundles):
                section_id = stable_hash(bundle.topic_id, bundle.source_id or bundle.topic_id)
                concept_names = [c.concept_name for c in bundle.concepts[:6]] if bundle.concepts else []
                parts.append(
                    f"BUNDLE {idx + 1}:\n"
                    f"  section_id: {section_id}\n"
                    f"  topic_id: {bundle.topic_id}\n"
                    f"  topic: {bundle.learning_objective}\n"
                    f"  key_terms: {', '.join(bundle.key_terms[:8])}\n"
                    f"  evidence_count: {len(bundle.evidence_chunks)}\n"
                    f"  concepts: {', '.join(concept_names) if concept_names else 'none'}\n"
                    f"  source: {'Audio Source' if bundle.content_type == 'transcript' else (bundle.source_title or 'unknown')}\n"
                )

            llm_result = call_llm(
                prompt="\n".join(parts),
                system=_NOTES_OUTLINE_SYSTEM_PROMPT,
                purpose="study_topic_normalization",
                max_tokens=2048,
                json_mode=True,
            )
            raw = self._load_json_payload(llm_result.text)
            return NotesOutline.model_validate(raw)
        except Exception as exc:
            logger.debug("Outline generation failed (proceeding without): %s", exc)
            return None

    @staticmethod
    def _enrich_bundles_with_outline(
        bundles: list[NotesContextBundle],
        outline: NotesOutline | None,
    ) -> list[NotesContextBundle]:
        if outline is None:
            return list(bundles)

        entry_by_topic: dict[str, NotesOutlineEntry] = {
            e.topic_id: e for e in outline.outline_entries
        }
        enriched: list[NotesContextBundle] = []
        for bundle in bundles:
            entry = entry_by_topic.get(bundle.topic_id)
            enriched.append(bundle.model_copy(update={
                "outline_entry": entry,
                "global_context": outline.global_context,
                "content_type": outline.content_type,
            }))
        return enriched

    # --- Phase 1: Section generation (improved) ----------------------------

    def _generate_section_for_bundle(
        self,
        bundle: NotesContextBundle,
        request_payload: dict[str, Any],
    ) -> tuple[NoteSection | None, list[str]]:
        warnings: list[str] = []
        section_id = stable_hash(bundle.topic_id, bundle.source_id or bundle.topic_id)
        user_msg = self._build_generation_user_message(bundle=bundle, section_id=section_id)

        # Adaptive system prompt with content-type suffix
        system_prompt = _NOTES_BULK_SYSTEM_PROMPT + _CONTENT_TYPE_SUFFIXES.get(
            bundle.content_type, ""
        )

        # Depth-adaptive token budget
        max_tokens = _NOTES_MAX_TOKENS  # 4096 default ("standard")
        if bundle.outline_entry:
            depth = bundle.outline_entry.depth_hint
            if depth == "shallow":
                max_tokens = 2048
            elif depth == "deep":
                max_tokens = 6144

        try:
            llm_result = call_llm(
                prompt=user_msg,
                system=system_prompt,
                purpose="study_generation",
                temperature=0.3,
                max_tokens=max_tokens,
                json_mode=True,
            )
            raw = self._load_json_payload(llm_result.text)
            sections_data: list[dict[str, Any]] = raw.get("sections") or []
            if not sections_data:
                warnings.append(f"LLM returned no sections for topic {bundle.topic_id}; using deterministic fallback.")
                section = self._build_fallback_section(
                    bundle=bundle,
                    section_id=section_id,
                    topic_id=bundle.topic_id,
                )
                if bundle.source_id is not None:
                    section = section.model_copy(update={
                        "source_id": bundle.source_id,
                        "source_title": bundle.source_title,
                    })
                return section, warnings
            section = self._parse_section(
                section_data=sections_data[0],
                bundle=bundle,
                fallback_section_id=section_id,
                fallback_topic_id=bundle.topic_id,
            )
            # Propagate per-source identity
            if bundle.source_id is not None:
                section = section.model_copy(update={
                    "source_id": bundle.source_id,
                    "source_title": bundle.source_title,
                })
            return section, warnings
        except Exception as exc:
            warnings.append(
                f"LLM call failed for topic {bundle.topic_id}: {exc}. Using deterministic fallback notes."
            )
            logger.exception("Notes generation failed for topic %s", bundle.topic_id)
            section = self._build_fallback_section(
                bundle=bundle,
                section_id=section_id,
                topic_id=bundle.topic_id,
            )
            if bundle.source_id is not None:
                section = section.model_copy(update={
                    "source_id": bundle.source_id,
                    "source_title": bundle.source_title,
                })
            return section, warnings

    # --- Phase 2: Validation + Repair --------------------------------------

    @staticmethod
    def _validate_section(
        section: NoteSection,
        bundle: NotesContextBundle,
    ) -> _NotesValidationOutcome:
        reasons: list[str] = []

        # Title checks
        if not section.title or not section.title.strip():
            reasons.append("title is empty")
        elif len(section.title.split()) > 15:
            reasons.append(f"title too long ({len(section.title.split())} words, max 15)")

        # Summary checks
        if not section.summary or not section.summary.strip():
            reasons.append("summary is empty")
        else:
            sentence_count = len(split_sentences(section.summary))
            if sentence_count < 2:
                reasons.append(f"summary too short ({sentence_count} sentences, need 2-5)")
            elif sentence_count > 7:
                reasons.append(f"summary too long ({sentence_count} sentences, max 7)")

        # Concepts checks
        if len(section.concepts) < 2:
            reasons.append(f"too few concepts ({len(section.concepts)}, need 2-7)")
        elif len(section.concepts) > 7:
            reasons.append(f"too many concepts ({len(section.concepts)}, max 7)")
        for c in section.concepts:
            if not c.definition or len(c.definition) < 20:
                reasons.append(f"concept '{c.concept}' has weak definition (<20 chars)")
                break  # report once

        # Key points checks
        if len(section.key_points) < 3:
            reasons.append(f"too few key_points ({len(section.key_points)}, need 3-12)")
        elif len(section.key_points) > 12:
            reasons.append(f"too many key_points ({len(section.key_points)}, max 12)")

        # Source refs check
        if not section.source_refs:
            reasons.append("no source_refs present")

        if not reasons:
            return _NotesValidationOutcome(valid=True, recoverable=False)

        return _NotesValidationOutcome(valid=False, recoverable=True, reasons=reasons)

    def _repair_section(
        self,
        section: NoteSection,
        bundle: NotesContextBundle,
        reasons: list[str],
    ) -> tuple[NoteSection | None, list[str]]:
        warnings: list[str] = []
        section_json = json.dumps({
            "section_id": section.section_id,
            "topic_id": section.topic_id,
            "title": section.title,
            "summary": section.summary,
            "concepts": [
                {"concept": c.concept, "definition": c.definition, "sub_concepts": c.sub_concepts}
                for c in section.concepts
            ],
            "key_terms": [{"term": kt.term, "definition": kt.definition} for kt in section.key_terms],
            "key_points": section.key_points,
            "table_ids": [t.table_id for t in section.tables],
            "image_ids": [i.image_id for i in section.images],
            "equation_ids": [e.equation_id for e in section.equations],
            "code_ids": [c.code_id for c in section.code_blocks],
            "source_refs": [
                {"evidence_id": sr.excerpt or "", "citation": sr.title or ""}
                for sr in section.source_refs
            ],
        }, indent=2)

        parts: list[str] = [
            "Repair the following note section.\n",
            f"VALIDATION FAILURES:\n{chr(10).join(f'  - {r}' for r in reasons)}\n",
            f"ORIGINAL SECTION:\n{section_json}\n",
            f"\ntopic: {bundle.learning_objective}",
            f"key_terms: {', '.join(bundle.key_terms[:8])}",
        ]

        # Include evidence for repair context
        parts.append("\nEVIDENCE CHUNKS:")
        for ev in bundle.evidence_chunks[:8]:
            text = ev.polished_text or ev.content
            parts.append(f"[{ev.evidence_id}] (page {ev.source_ref.page_number}) {text[:800]}")

        if bundle.available_tables:
            parts.append("\nAVAILABLE TABLES:")
            for t in bundle.available_tables[:8]:
                parts.append(f"  table_id={t.table_id} title={t.title or 'table'}")
        if bundle.available_images:
            parts.append("\nAVAILABLE IMAGES:")
            for img in bundle.available_images[:8]:
                parts.append(f"  image_id={img.image_id} caption={img.caption or ''}")
        if bundle.available_equations:
            parts.append("\nAVAILABLE EQUATIONS:")
            for eq in bundle.available_equations[:8]:
                parts.append(f"  equation_id={eq.equation_id} latex={eq.latex_source[:120]}")
        if bundle.available_code_blocks:
            parts.append("\nAVAILABLE CODE BLOCKS:")
            for c in bundle.available_code_blocks[:8]:
                parts.append(f"  code_id={c.code_id} language={c.language}")

        try:
            llm_result = call_llm(
                prompt="\n".join(parts),
                system=_NOTES_REPAIR_SYSTEM_PROMPT,
                purpose="study_repair",
                temperature=0.1,
                max_tokens=_NOTES_MAX_TOKENS,
                json_mode=True,
            )
            raw = self._load_json_payload(llm_result.text)
            section_data = raw.get("section") or {}
            repaired = self._parse_section(
                section_data=section_data,
                bundle=bundle,
                fallback_section_id=section.section_id,
                fallback_topic_id=section.topic_id,
            )
            if bundle.source_id is not None:
                repaired = repaired.model_copy(update={
                    "source_id": bundle.source_id,
                    "source_title": bundle.source_title,
                })
            # Re-validate
            outcome = self._validate_section(repaired, bundle)
            if outcome.valid:
                return repaired, warnings
            else:
                warnings.append(
                    f"Repair did not resolve all issues for topic {bundle.topic_id}: "
                    f"{'; '.join(outcome.reasons)}. Using fallback."
                )
                return None, warnings
        except Exception as exc:
            warnings.append(f"Repair LLM call failed for topic {bundle.topic_id}: {exc}")
            logger.debug("Notes repair failed for topic %s: %s", bundle.topic_id, exc)
            return None, warnings

    # --- Phase 3: Cross-section polish -------------------------------------

    def _polish_cross_references(
        self,
        sections: list[NoteSection],
    ) -> list[NoteSection]:
        parts: list[str] = ["Add cross-references between these note sections.\n"]
        for s in sections:
            concept_names = [c.concept for c in s.concepts[:5]]
            parts.append(
                f"SECTION:\n"
                f"  section_id: {s.section_id}\n"
                f"  title: {s.title}\n"
                f"  summary: {s.summary[:200]}\n"
                f"  concepts: {', '.join(concept_names) if concept_names else 'none'}\n"
            )

        llm_result = call_llm(
            prompt="\n".join(parts),
            system=_NOTES_POLISH_SYSTEM_PROMPT,
            purpose="study_polish",
            max_tokens=1024,
            json_mode=True,
        )
        raw = self._load_json_payload(llm_result.text)
        cross_refs: dict[str, list[str]] = raw.get("cross_references") or {}

        polished: list[NoteSection] = []
        for s in sections:
            refs = cross_refs.get(s.section_id, [])
            if refs and isinstance(refs, list):
                # Limit to 3 cross-references
                cleaned = [str(r) for r in refs[:3] if isinstance(r, str) and r.strip()]
                polished.append(s.model_copy(update={"cross_references": cleaned}))
            else:
                polished.append(s)
        return polished

    # --- Parsing & building helpers ----------------------------------------

    def _parse_section(
        self,
        *,
        section_data: dict[str, Any],
        bundle: NotesContextBundle,
        fallback_section_id: str,
        fallback_topic_id: str,
    ) -> NoteSection:
        if not isinstance(section_data, dict):
            section_data = {}

        # Index rich media by ID for O(1) resolution
        table_by_id = {t.table_id: t for t in bundle.available_tables}
        image_by_id = {i.image_id: i for i in bundle.available_images}
        eq_by_id = {e.equation_id: e for e in bundle.available_equations}
        code_by_id = {c.code_id: c for c in bundle.available_code_blocks}

        resolved_tables = [
            table_by_id[tid]
            for tid in (section_data.get("table_ids") or [])
            if tid in table_by_id
        ]
        resolved_images = [
            image_by_id[iid]
            for iid in (section_data.get("image_ids") or [])
            if iid in image_by_id
        ]
        resolved_equations = [
            eq_by_id[eid]
            for eid in (section_data.get("equation_ids") or [])
            if eid in eq_by_id
        ]
        resolved_code = [
            code_by_id[cid]
            for cid in (section_data.get("code_ids") or [])
            if cid in code_by_id
        ]

        # Build source_refs from LLM citations, cross-referencing evidence_chunks
        evidence_by_id = {e.evidence_id: e for e in bundle.evidence_chunks}
        source_refs: list[SourceRef] = []
        seen_chunk_ids: set[uuid.UUID] = set()
        for ref in section_data.get("source_refs") or []:
            ev = evidence_by_id.get(ref.get("evidence_id") or "")
            if ev and ev.chunk_id not in seen_chunk_ids:
                seen_chunk_ids.add(ev.chunk_id)
                source_refs.append(ev.source_ref)
        if not source_refs:
            source_refs = [e.source_ref for e in bundle.evidence_chunks[:3]]

        # Parse concept hierarchy
        raw_concepts = section_data.get("concepts") or []
        concepts: list[NoteConceptNode] = []
        for c in raw_concepts:
            if isinstance(c, dict) and c.get("concept"):
                concepts.append(NoteConceptNode(
                    concept=str(c.get("concept", "")),
                    definition=str(c.get("definition", "")),
                    sub_concepts=[str(s) for s in (c.get("sub_concepts") or []) if s],
                ))

        # Parse key terms / vocabulary
        raw_key_terms = section_data.get("key_terms") or []
        key_terms: list[NoteKeyTerm] = []
        for kt in raw_key_terms:
            if isinstance(kt, dict) and kt.get("term"):
                key_terms.append(NoteKeyTerm(
                    term=str(kt.get("term", "")),
                    definition=str(kt.get("definition", "")),
                ))

        return NoteSection(
            section_id=section_data.get("section_id") or fallback_section_id,
            topic_id=section_data.get("topic_id") or fallback_topic_id,
            title=str(section_data.get("title") or bundle.learning_objective[:60]),
            summary=str(section_data.get("summary") or ""),
            key_points=[str(kp) for kp in (section_data.get("key_points") or [])],
            tables=resolved_tables,
            images=resolved_images,
            equations=resolved_equations,
            code_blocks=resolved_code,
            source_refs=source_refs,
            evidence_chunks=bundle.evidence_chunks,
            concepts=concepts,
            key_terms=key_terms,
        )

    def _build_fallback_section(
        self,
        *,
        bundle: NotesContextBundle,
        section_id: str,
        topic_id: str,
    ) -> NoteSection:
        source_refs = self._fallback_source_refs(bundle)
        return NoteSection(
            section_id=section_id,
            topic_id=topic_id,
            title=self._fallback_title(bundle.learning_objective),
            summary=self._fallback_summary(bundle),
            key_points=self._fallback_key_points(bundle),
            tables=bundle.available_tables[:_NOTES_FALLBACK_MEDIA_LIMIT],
            images=bundle.available_images[:_NOTES_FALLBACK_MEDIA_LIMIT],
            equations=bundle.available_equations[:_NOTES_FALLBACK_MEDIA_LIMIT],
            code_blocks=bundle.available_code_blocks[:_NOTES_FALLBACK_MEDIA_LIMIT],
            source_refs=source_refs,
            evidence_chunks=bundle.evidence_chunks,
            source_id=bundle.source_id,
            source_title=bundle.source_title,
        )

    @staticmethod
    def _fallback_title(learning_objective: str) -> str:
        cleaned = clean_study_text(learning_objective)
        if not cleaned:
            return "Study Notes"
        words = cleaned.split()
        return " ".join(words[:8])

    @staticmethod
    def _fallback_summary(bundle: NotesContextBundle) -> str:
        sentences: list[str] = []
        objective = clean_study_text(bundle.learning_objective)
        if objective:
            objective_sentence = objective if objective.endswith((".", "!", "?")) else f"{objective}."
            sentences.append(objective_sentence)

        for evidence in bundle.evidence_chunks[:4]:
            for sentence in split_sentences(evidence.polished_text or evidence.content):
                cleaned = clean_study_text(sentence)
                if not cleaned or cleaned in sentences:
                    continue
                sentences.append(cleaned if cleaned.endswith((".", "!", "?")) else f"{cleaned}.")
                if len(sentences) >= 3:
                    return " ".join(sentences[:3])

        if len(sentences) == 1 and bundle.key_terms:
            terms = ", ".join(bundle.key_terms[:4])
            sentences.append(f"Key ideas include {terms}.")

        if not sentences:
            sentences.append("These notes were recovered directly from the ingested evidence.")

        return " ".join(sentences[:3])

    @staticmethod
    def _fallback_key_points(bundle: NotesContextBundle) -> list[str]:
        candidates: list[str] = []
        candidates.extend(bundle.key_terms[:4])

        for evidence in bundle.evidence_chunks[:5]:
            for sentence in split_sentences(evidence.polished_text or evidence.content)[:2]:
                cleaned = clean_study_text(sentence)
                if cleaned:
                    candidates.append(cleaned)

        key_points: list[str] = []
        for candidate in unique_preserve_order(candidates):
            words = candidate.split()
            if len(words) > 18:
                candidate = f"{' '.join(words[:18]).rstrip(',;:')}..."
            key_points.append(candidate)
            if len(key_points) >= 6:
                break

        if not key_points:
            fallback = clean_study_text(bundle.learning_objective) or "Recovered from source evidence."
            key_points = [fallback]

        return key_points

    @staticmethod
    def _fallback_source_refs(bundle: NotesContextBundle) -> list[SourceRef]:
        refs: list[SourceRef] = []
        seen: set[tuple[str, str, int | None]] = set()
        for evidence in bundle.evidence_chunks[:5]:
            ref = evidence.source_ref
            key = (str(ref.source_id), str(ref.chunk_id or ""), ref.page_number)
            if key in seen:
                continue
            seen.add(key)
            refs.append(ref)
        return refs

    @staticmethod
    def _load_json_payload(raw_text: str) -> dict[str, Any]:
        text = str(raw_text or "").strip()
        if not text:
            raise ValueError("empty JSON response")

        candidates: list[str] = [text]
        fence_matches = re.findall(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.IGNORECASE | re.DOTALL)
        candidates.extend(match.strip() for match in fence_matches if match.strip())

        extracted = NotesGenerationService._extract_outer_json_object(text)
        if extracted:
            candidates.append(extracted)

        last_error: Exception | None = None
        seen_candidates: set[str] = set()
        for candidate in candidates:
            normalized = candidate.strip()
            if not normalized or normalized in seen_candidates:
                continue
            seen_candidates.add(normalized)
            try:
                parsed = json.loads(normalized)
            except Exception as exc:
                last_error = exc
                continue
            if isinstance(parsed, dict):
                return parsed

        if last_error is not None:
            raise last_error
        raise ValueError("response did not contain a JSON object")

    @staticmethod
    def _extract_outer_json_object(text: str) -> str | None:
        start = text.find("{")
        if start < 0:
            return None

        depth = 0
        in_string = False
        escape = False
        for index in range(start, len(text)):
            char = text[index]
            if in_string:
                if escape:
                    escape = False
                elif char == "\\":
                    escape = True
                elif char == '"':
                    in_string = False
                continue

            if char == '"':
                in_string = True
            elif char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return text[start:index + 1]
        return None

    @staticmethod
    def _build_generation_user_message(*, bundle: NotesContextBundle, section_id: str) -> str:
        parts: list[str] = []

        # Include outline context if available (Phase 0 enrichment)
        if bundle.global_context:
            parts.append(f"DOCUMENT CONTEXT:\n{bundle.global_context}\n")
        if bundle.outline_entry:
            parts.append("SECTION SCOPE:")
            parts.append(f"This section covers: {bundle.outline_entry.scope}")
            if bundle.outline_entry.preceding_context:
                parts.append(f"Previous sections covered: {bundle.outline_entry.preceding_context}")
            parts.append(f"Depth: {bundle.outline_entry.depth_hint}\n")

        parts.extend([
            f"Generate notes for the following topic bundle.",
            f"\nsection_id: {section_id}",
            f"topic_id: {bundle.topic_id}",
            f"topic: {bundle.learning_objective}",
            f"key_terms: {', '.join(bundle.key_terms[:8])}",
        ])
        if bundle.source_title:
            title = "Audio Source" if bundle.content_type == "transcript" else bundle.source_title
            parts.append(f"source: {title}")

        # Include concept definitions from StudyConcept catalog
        if bundle.concepts:
            parts.append("\nCONCEPT CATALOG:")
            for concept in bundle.concepts[:6]:
                line = f"  - {concept.concept_name}: {concept.definition}"
                if concept.intuition:
                    line += f" ({concept.intuition})"
                parts.append(line)

        parts.append("\nEVIDENCE CHUNKS:")
        for ev in bundle.evidence_chunks[:10]:
            text = ev.polished_text or ev.content
            # Use more text when polished_text is available (cleaner = fewer wasted tokens)
            char_limit = 1200 if ev.polished_text else 800
            parts.append(f"[{ev.evidence_id}] (page {ev.source_ref.page_number}) {text[:char_limit]}")

        if bundle.available_tables:
            parts.append("\nAVAILABLE TABLES:")
            for t in bundle.available_tables[:8]:
                parts.append(f"  table_id={t.table_id} title={t.title or 'table'}")
        if bundle.available_images:
            parts.append("\nAVAILABLE IMAGES:")
            for img in bundle.available_images[:8]:
                parts.append(f"  image_id={img.image_id} caption={img.caption or ''}")
        if bundle.available_equations:
            parts.append("\nAVAILABLE EQUATIONS:")
            for eq in bundle.available_equations[:8]:
                parts.append(f"  equation_id={eq.equation_id} latex={eq.latex_source[:120]}")
        if bundle.available_code_blocks:
            parts.append("\nAVAILABLE CODE BLOCKS:")
            for c in bundle.available_code_blocks[:8]:
                parts.append(f"  code_id={c.code_id} language={c.language}")

        return "\n".join(parts)

    @staticmethod
    def _build_enhance_user_message(
        *,
        current_section: NoteSection,
        bundle: NotesContextBundle,
        expand_mode: str,
        focus_areas: list[str],
    ) -> str:
        parts: list[str] = [
            f"Enhance the following note section using expand_mode={expand_mode}.",
        ]
        if focus_areas:
            parts.append(f"Focus areas: {', '.join(focus_areas)}")

        parts.append("\nCURRENT SECTION:")
        parts.append(json.dumps({
            "section_id": current_section.section_id,
            "topic_id": current_section.topic_id,
            "title": current_section.title,
            "summary": current_section.summary,
            "key_points": current_section.key_points,
            "table_ids": [t.table_id for t in current_section.tables],
            "image_ids": [i.image_id for i in current_section.images],
            "equation_ids": [e.equation_id for e in current_section.equations],
            "code_ids": [c.code_id for c in current_section.code_blocks],
        }, indent=2))

        parts.append("\nADDITIONAL EVIDENCE:")
        for ev in bundle.evidence_chunks[:10]:
            text = ev.polished_text or ev.content
            parts.append(f"[{ev.evidence_id}] {text[:600]}")

        if bundle.available_tables:
            parts.append("\nAVAILABLE TABLES:")
            for t in bundle.available_tables[:8]:
                parts.append(f"  table_id={t.table_id} title={t.title or 'table'}")
        if bundle.available_images:
            parts.append("\nAVAILABLE IMAGES:")
            for img in bundle.available_images[:8]:
                parts.append(f"  image_id={img.image_id} caption={img.caption or ''}")
        if bundle.available_equations:
            parts.append("\nAVAILABLE EQUATIONS:")
            for eq in bundle.available_equations[:8]:
                parts.append(f"  equation_id={eq.equation_id} latex={eq.latex_source[:120]}")
        if bundle.available_code_blocks:
            parts.append("\nAVAILABLE CODE BLOCKS:")
            for c in bundle.available_code_blocks[:8]:
                parts.append(f"  code_id={c.code_id} language={c.language}")

        return "\n".join(parts)
