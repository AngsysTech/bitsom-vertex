"""The one LLM boundary. No other module talks to a model provider.

    json(prompt, schema, system=...) -> schema instance (validated, one repair retry)
    complete_json_text(system=..., prompt=...) -> raw JSON text
        (used only by the vendored-notes bridge, whose own parsers validate it)

Env:
    LLM_PROVIDER   openai | anthropic   (openai also covers OpenAI-compatible APIs
                                          via LLM_BASE_URL: OpenRouter, Gemini, Groq ...)
    LLM_MODEL      model id
    LLM_API_KEY    falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY by provider
    LLM_BASE_URL   optional, OpenAI-compatible endpoint
    LLM_TIMEOUT    seconds per request (default 90)
    LLM_REASONING_EFFORT  optional, for OpenAI reasoning models (none | minimal | low | ...)
"""
from __future__ import annotations

import json as _json
import logging
import re
import threading
import time
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.core.config import env

log = logging.getLogger("llm")
M = TypeVar("M", bound=BaseModel)

_DEFAULT_MODELS = {"openai": "gpt-4.1-mini", "anthropic": "claude-sonnet-5"}
_client_lock = threading.Lock()
_client: Any = None


class LLMError(RuntimeError):
    pass


def provider() -> str:
    p = (env("LLM_PROVIDER") or "").lower()
    if p:
        return p
    if env("ANTHROPIC_API_KEY") and not env("OPENAI_API_KEY"):
        return "anthropic"
    return "openai"


def model() -> str:
    return env("LLM_MODEL") or _DEFAULT_MODELS.get(provider(), "gpt-4.1-mini")


def _api_key() -> str | None:
    fallback = "ANTHROPIC_API_KEY" if provider() == "anthropic" else "OPENAI_API_KEY"
    return env("LLM_API_KEY") or env(fallback)


def _get_client() -> Any:
    global _client
    with _client_lock:
        if _client is not None:
            return _client
        key = _api_key()
        if not key:
            raise LLMError(f"no API key configured for LLM provider '{provider()}' (set LLM_API_KEY)")
        timeout = float(env("LLM_TIMEOUT", "90"))
        if provider() == "anthropic":
            import anthropic

            _client = anthropic.Anthropic(api_key=key, timeout=timeout, max_retries=0)
        else:
            from openai import OpenAI

            _client = OpenAI(api_key=key, base_url=env("LLM_BASE_URL"), timeout=timeout, max_retries=0)
        return _client


def _is_retryable(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None)
    if status is not None:
        return status in (408, 409, 429) or status >= 500
    name = type(exc).__name__
    return any(k in name for k in ("Timeout", "Connection", "RateLimit", "Overloaded", "InternalServer"))


def _openai_call(client: Any, system: str | None, prompt: str, max_tokens: int, temperature: float | None) -> str:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    kwargs: dict[str, Any] = {
        "model": model(),
        "messages": messages,
        "response_format": {"type": "json_object"},
        "max_completion_tokens": max_tokens,
    }
    if temperature is not None:
        kwargs["temperature"] = temperature
    if env("LLM_REASONING_EFFORT"):
        kwargs["reasoning_effort"] = env("LLM_REASONING_EFFORT")
    resp = client.chat.completions.create(**kwargs)
    choice = resp.choices[0]
    if choice.finish_reason == "length":
        raise LLMError(f"model output truncated at {max_tokens} tokens")
    return choice.message.content or ""


def _anthropic_call(client: Any, system: str | None, prompt: str, max_tokens: int, temperature: float | None) -> str:
    kwargs: dict[str, Any] = {
        "model": model(),
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt + "\n\nRespond with one JSON object and nothing else."}],
    }
    if system:
        kwargs["system"] = system
    if temperature is not None:
        kwargs["temperature"] = temperature
    resp = client.messages.create(**kwargs)
    if getattr(resp, "stop_reason", None) == "max_tokens":
        raise LLMError(f"model output truncated at {max_tokens} tokens")
    return "".join(getattr(b, "text", "") for b in resp.content)


def complete_json_text(*, system: str | None, prompt: str, max_tokens: int = 4096,
                       temperature: float | None = 0.2) -> str:
    client = _get_client()
    call = _anthropic_call if provider() == "anthropic" else _openai_call
    attempts = 3
    for attempt in range(attempts):
        started = time.perf_counter()
        try:
            text = call(client, system, prompt, max_tokens, temperature)
            log.info("llm ok model=%s ms=%d", model(), (time.perf_counter() - started) * 1000)
            return text
        except LLMError:
            raise
        except Exception as exc:  # provider SDK errors
            msg = str(exc)
            if temperature is not None and "temperature" in msg.lower():
                temperature = None  # some reasoning models reject it; retry without
                continue
            if attempt < attempts - 1 and _is_retryable(exc):
                time.sleep(1.5 * (attempt + 1))
                continue
            raise LLMError(f"{type(exc).__name__}: {msg[:300]}") from exc
    raise LLMError("LLM call failed after retries")


def extract_json_object(text: str) -> dict[str, Any]:
    text = (text or "").strip()
    fenced = re.match(r"^```(?:json)?\s*(.*?)\s*```$", text, re.S)
    if fenced:
        text = fenced.group(1)
    try:
        data = _json.loads(text)
    except _json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("no JSON object in model output")
        data = _json.loads(text[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("model output is not a JSON object")
    return data


def json(prompt: str, schema: type[M], *, system: str | None = None, max_tokens: int = 4096,
         temperature: float | None = 0.2) -> M:
    """One model call whose output must validate against ``schema``. One repair retry."""
    contract = (
        "Output strict JSON only: one object that validates against this JSON Schema. "
        "No markdown, no commentary.\n" + _json.dumps(schema.model_json_schema(), separators=(",", ":"))
    )
    full_system = f"{system}\n\n{contract}" if system else contract
    user = prompt
    last_error: Exception | None = None
    for _ in range(2):
        text = complete_json_text(system=full_system, prompt=user, max_tokens=max_tokens, temperature=temperature)
        try:
            return schema.model_validate(extract_json_object(text))
        except (ValueError, ValidationError) as exc:
            last_error = exc
            user = (f"{prompt}\n\nYour previous answer did not validate: {str(exc)[:800]}\n"
                    "Return the corrected JSON object only.")
    raise LLMError(f"model output failed {schema.__name__} validation: {str(last_error)[:300]}")
