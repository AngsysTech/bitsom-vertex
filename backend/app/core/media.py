"""Local media for lecture uploads: tell video from audio, pull the audio track out of a video.

Built 26 Sep 2026. Uploads stay on disk under backend/data/lectures/<lectureId>/ (gitignored):
    video.<ext>  the original upload when it carries a picture track (lecture videos, screen recordings)
    audio.<ext>  what STT reads and GET /lectures/:id/audio serves: the uploaded audio file itself, or
                 the track extracted from video.<ext> (mono 16 kHz AAC, ~20 MB per hour of lecture)

ffprobe/ffmpeg come from PATH (brew install ffmpeg). Without them audio uploads work unchanged and a
video goes to the STT provider as-is.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

# Containers that can carry a picture. .mp4/.webm/.mpeg can also be audio-only (Safari and Chrome
# MediaRecorder output), so ffprobe decides; without ffprobe only the video-only ones count as video.
VIDEO_EXTS = {".mp4", ".m4v", ".mov", ".qt", ".mkv", ".avi", ".webm", ".wmv", ".flv", ".3gp", ".mpg", ".mpeg",
              ".ts", ".mts", ".m2ts", ".ogv"}
EXTRACTED_AUDIO = "audio.m4a"


class MediaError(RuntimeError):
    pass


@dataclass
class Probe:
    video: bool
    audio: bool
    duration_sec: float | None


def available() -> bool:
    return bool(shutil.which("ffprobe") and shutil.which("ffmpeg"))


def probe(path: Path) -> Probe | None:
    """Stream layout of a media file, or None when ffprobe is missing or can't read the file."""
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type:stream_disposition=attached_pic",
             "-of", "json", str(path)], capture_output=True, text=True, timeout=60, check=True).stdout
        info = json.loads(out or "{}")
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
    streams = info.get("streams") or []
    # Cover art inside an mp3/m4a is a one-frame "video" stream flagged attached_pic: not a video.
    video = any(s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic") for s in streams)
    audio = any(s.get("codec_type") == "audio" for s in streams)
    try:
        duration = float((info.get("format") or {}).get("duration"))
    except (TypeError, ValueError):
        duration = None
    return Probe(video=video, audio=audio, duration_sec=duration)


def chapters(path: Path) -> list[tuple[float, str]]:
    """(start seconds, title) of each chapter mark in the file (recorder bookmarks, mp4/m4a chapters,
    mp3 CHAP frames). [] when ffprobe is missing, the file has none, or it can't be read."""
    if not shutil.which("ffprobe"):
        return []
    try:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_chapters", "-of", "json", str(path)],
                             capture_output=True, text=True, timeout=60, check=True).stdout
        rows = json.loads(out or "{}").get("chapters") or []
    except (subprocess.SubprocessError, OSError, ValueError):
        return []
    marks = []
    for c in rows:
        try:
            marks.append((float(c.get("start_time")), str((c.get("tags") or {}).get("title") or "")))
        except (TypeError, ValueError):
            continue
    return marks


def extract_audio(src: Path, dst: Path) -> float:
    """Write src's first audio track to dst as mono 16 kHz AAC (plenty for speech). Returns seconds taken."""
    if not available():
        raise MediaError("ffmpeg is not installed (brew install ffmpeg)")
    partial = dst.with_name(f"extracting{dst.suffix}")  # doesn't match audio.* until it is complete
    started = time.perf_counter()
    try:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src), "-map", "0:a:0",
             "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart",
             str(partial)], capture_output=True, text=True, timeout=1800, check=True)
    except subprocess.CalledProcessError as exc:
        partial.unlink(missing_ok=True)
        detail = (exc.stderr or "").strip().splitlines()[-1:] or ["unknown error"]
        raise MediaError(f"couldn't extract audio from {src.name}: {detail[0][:200]}") from exc
    except subprocess.TimeoutExpired as exc:
        partial.unlink(missing_ok=True)
        raise MediaError(f"audio extraction from {src.name} took over 30 min") from exc
    if not partial.exists() or partial.stat().st_size == 0:
        partial.unlink(missing_ok=True)
        raise MediaError(f"{src.name} produced no audio")
    partial.replace(dst)
    return time.perf_counter() - started
