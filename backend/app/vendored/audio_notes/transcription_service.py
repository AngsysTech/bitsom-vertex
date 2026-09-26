import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from core.config import Settings

logger = logging.getLogger(__name__)


class ExtractedPage:
    def __init__(self, page: int, text: str, timestamp: float | None = None):
        self.page = page
        self.text = text
        self.timestamp = timestamp


@dataclass(frozen=True)
class TranscriptionResult:
    """Transcription output: pages for the ingest pipeline plus a raw payload for persistence."""

    pages: list[ExtractedPage]
    raw: dict[str, Any]


def _segment_to_dict(seg: Any) -> dict[str, Any]:
    """Normalize an OpenAI verbose_json transcription segment to a plain dict.

    openai>=1.x returns segments as Pydantic ``TranscriptionSegment`` objects,
    which have no ``.get`` (older SDKs returned plain dicts). Accept either so
    the dict-style access downstream works across SDK versions.
    """
    if isinstance(seg, dict):
        return seg
    if hasattr(seg, "model_dump"):
        return seg.model_dump()
    return getattr(seg, "__dict__", {}) or {}


class TranscriptionService:
    """Service for transcribing audio and video files using AssemblyAI or OpenAI Whisper."""

    @staticmethod
    def transcribe_assemblyai(audio_path: str, settings: "Settings") -> TranscriptionResult:
        import assemblyai as aai  # type: ignore

        if not settings.assemblyai_api_key:
            raise ValueError("ASSEMBLYAI_API_KEY is not configured.")

        aai.settings.api_key = settings.assemblyai_api_key
        config = aai.TranscriptionConfig(
            speech_models=["universal-3-pro", "universal-2"],
            speaker_labels=settings.assemblyai_speaker_labels,
            language_detection=True,
        )
        transcriber = aai.Transcriber()
        logger.info("AssemblyAI: submitting transcription for %s", audio_path)

        transcript = transcriber.submit(audio_path, config=config)
        import time

        while transcript.status in [aai.TranscriptStatus.queued, aai.TranscriptStatus.processing]:
            logger.info("AssemblyAI: transcription status is %s...", transcript.status)
            time.sleep(3)
            transcript = aai.Transcript.get_by_id(transcript.id)

        if transcript.status == aai.TranscriptStatus.error:
            logger.error("AssemblyAI error: %s", transcript.error)
            raise RuntimeError(f"AssemblyAI transcription failed: {transcript.error}")
        if not transcript.text or not transcript.text.strip():
            raise RuntimeError("Transcription produced no text. The audio may be silent or contain no detectable speech.")

        pages = TranscriptionService._utterances_to_pages(transcript)
        raw = TranscriptionService._assemblyai_raw_payload(transcript)
        return TranscriptionResult(pages=pages, raw=raw)

    @staticmethod
    def transcribe_quiz_audio(audio_path: str, settings: "Settings") -> tuple[str, dict[str, Any]]:
        import assemblyai as aai  # type: ignore

        if not settings.assemblyai_api_key:
            raise ValueError("ASSEMBLYAI_API_KEY is not configured.")

        aai.settings.api_key = settings.assemblyai_api_key
        config = aai.TranscriptionConfig(
            speech_models=["universal-3-pro", "universal-2"],
            language_detection=True,
            disfluencies=True,
        )
        transcriber = aai.Transcriber()
        logger.info("AssemblyAI: submitting quiz audio for %s", audio_path)

        transcript = transcriber.submit(audio_path, config=config)
        import time

        while transcript.status in [aai.TranscriptStatus.queued, aai.TranscriptStatus.processing]:
            time.sleep(1)
            transcript = aai.Transcript.get_by_id(transcript.id)

        if transcript.status == aai.TranscriptStatus.error:
            logger.error("AssemblyAI error: %s", transcript.error)
            raise RuntimeError(f"AssemblyAI transcription failed: {transcript.error}")
        
        words = transcript.words or []
        if not words:
            return ("", {
                "wpm": 0,
                "filler_ratio": 0.0,
                "avg_word_confidence": 0.0,
                "avg_pause_ms": 0,
                "filler_count": 0
            })

        filler_words = [w for w in words if w.text.lower() in ["um", "uh", "like", "you know", "erm", "ah"]]
        
        duration_sec = (words[-1].end - words[0].start) / 1000.0 if words[-1].end > words[0].start else 1.0
        wpm = (len(words) / duration_sec) * 60.0

        avg_confidence = sum(w.confidence for w in words) / len(words)

        pauses = []
        for i in range(1, len(words)):
            pauses.append(words[i].start - words[i-1].end)
        avg_pause_ms = sum(pauses) / len(pauses) if pauses else 0.0

        fluency_metrics = {
            "wpm": round(wpm),
            "filler_ratio": round(len(filler_words) / len(words), 4),
            "avg_word_confidence": round(avg_confidence, 4),
            "avg_pause_ms": round(avg_pause_ms),
            "filler_count": len(filler_words)
        }

        return (transcript.text or "", fluency_metrics)

    @staticmethod
    def _assemblyai_raw_payload(transcript) -> dict[str, Any]:
        utterances_raw: list[dict[str, Any]] = []
        for utt in getattr(transcript, "utterances", None) or []:
            utterances_raw.append({
                "speaker": getattr(utt, "speaker", None),
                "start": getattr(utt, "start", None),
                "end": getattr(utt, "end", None),
                "text": getattr(utt, "text", ""),
                "confidence": getattr(utt, "confidence", None),
            })

        audio_duration = getattr(transcript, "audio_duration", None)
        return {
            "provider": "assemblyai",
            "transcript_id": getattr(transcript, "id", None),
            "language_code": getattr(transcript, "language_code", None),
            "audio_duration_seconds": audio_duration,
            "confidence": getattr(transcript, "confidence", None),
            "text": transcript.text or "",
            "utterances": utterances_raw,
        }

    @staticmethod
    def _utterances_to_pages(transcript) -> list[ExtractedPage]:
        pages: list[ExtractedPage] = []
        segment_duration_ms = 60_000
        current_texts: list[str] = []
        current_start = 0.0
        page_num = 1

        utterances = getattr(transcript, "utterances", None) or []
        if utterances:
            for utt in utterances:
                speaker = getattr(utt, "speaker", "")
                text = getattr(utt, "text", "")
                start_ms = getattr(utt, "start", 0)

                if start_ms - current_start > segment_duration_ms and current_texts:
                    pages.append(ExtractedPage(
                        page=page_num,
                        text="\n".join(current_texts),
                        timestamp=current_start / 1000,
                    ))
                    page_num += 1
                    current_texts = []
                    current_start = start_ms

                prefix = f"[{speaker}]: " if speaker else ""
                current_texts.append(f"{prefix}{text}")
        else:
            chunk_text = transcript.text or ""
            pages.append(ExtractedPage(page=1, text=chunk_text, timestamp=0.0))
            return pages

        if current_texts:
            pages.append(ExtractedPage(
                page=page_num,
                text="\n".join(current_texts),
                timestamp=current_start / 1000,
            ))
        return pages or [ExtractedPage(page=1, text=transcript.text or "", timestamp=0.0)]

    @staticmethod
    def transcribe_whisper(audio_path: str, settings: "Settings") -> TranscriptionResult:
        from openai import OpenAI  # type: ignore

        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is not configured.")

        client = OpenAI(api_key=settings.openai_api_key)
        logger.info("Whisper: starting transcription for %s", audio_path)
        with open(audio_path, "rb") as handle:
            result = client.audio.transcriptions.create(
                model="whisper-1",
                file=handle,
                response_format="verbose_json",
            )
        # openai>=1.x returns verbose_json segments as Pydantic objects (no
        # ``.get``); normalize to dicts so the access below works on any SDK.
        segments = [_segment_to_dict(s) for s in (getattr(result, "segments", None) or [])]
        full_text = getattr(result, "text", "") or ""
        language = getattr(result, "language", None)
        duration = getattr(result, "duration", None)

        raw: dict[str, Any] = {
            "provider": "whisper",
            "model": "whisper-1",
            "language": language,
            "duration_seconds": duration,
            "text": full_text,
            "segments": [
                {
                    "id": seg.get("id"),
                    "start": seg.get("start"),
                    "end": seg.get("end"),
                    "text": (seg.get("text") or "").strip(),
                    "avg_logprob": seg.get("avg_logprob"),
                    "no_speech_prob": seg.get("no_speech_prob"),
                }
                for seg in segments
            ],
        }

        if not segments:
            return TranscriptionResult(
                pages=[ExtractedPage(page=1, text=full_text, timestamp=0.0)],
                raw=raw,
            )

        pages: list[ExtractedPage] = []
        page_num = 1
        segment_duration = 60.0
        current_texts: list[str] = []
        current_start = 0.0

        for seg in segments:
            start = float(seg.get("start", 0))
            text = seg.get("text", "").strip()
            if start - current_start > segment_duration and current_texts:
                pages.append(ExtractedPage(page=page_num, text=" ".join(current_texts), timestamp=current_start))
                page_num += 1
                current_texts = []
                current_start = start
            current_texts.append(text)

        if current_texts:
            pages.append(ExtractedPage(page=page_num, text=" ".join(current_texts), timestamp=current_start))
        return TranscriptionResult(pages=pages, raw=raw)
