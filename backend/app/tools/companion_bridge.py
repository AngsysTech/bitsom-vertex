"""Dependency cut for the vendored notes code (app/vendored/audio_notes/NOTICE.md).

The vendored ``notes_generation.py`` imported ``get_settings`` from its old settings
module and ``call_llm`` from its old provider client. Neither was copied. Its imports
now point here, and this module routes every model call through ``app/core/llm.py``,
the app's only LLM boundary. Built 26 Sep 2026.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.core import llm
from app.core.config import env

_SETTINGS = SimpleNamespace(study_generation_concurrency=int(env("NOTES_CONCURRENCY", "6")))


def get_settings() -> SimpleNamespace:
    return _SETTINGS


def call_llm(*, prompt: str | None = None, messages: list[dict] | None = None, system: str | None = None,
             purpose: str = "general", temperature: float = 0.2, max_tokens: int | None = 1024,
             json_mode: bool = False, **_: Any) -> SimpleNamespace:
    if messages:  # the notes path always passes prompt/system; kept for signature parity
        system = "\n".join(m["content"] for m in messages if m.get("role") == "system") or system
        prompt = "\n".join(m["content"] for m in messages if m.get("role") != "system")
    # The vendored parsers validate the JSON themselves; the adapter validates again
    # against contracts.ts before anything reaches the API.
    text = llm.complete_json_text(system=system, prompt=prompt or "", max_tokens=max(max_tokens or 4096, 2048),
                                  temperature=temperature)
    return SimpleNamespace(text=text)
