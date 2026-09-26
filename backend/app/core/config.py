"""Paths, timezone and env loading. Everything else reads config from here."""
from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BACKEND_DIR / "app"
DATA_DIR = APP_DIR / "data"            # synthetic dataset (read-only at runtime)
PROMPTS_DIR = APP_DIR / "prompts"
RUNTIME_DIR = BACKEND_DIR / "data"     # uploads + SQLite, created on demand
LECTURES_DIR = RUNTIME_DIR / "lectures"

load_dotenv(BACKEND_DIR / ".env")

DB_PATH = Path(os.getenv("DB_PATH", str(RUNTIME_DIR / "app.db")))
TZ = ZoneInfo(os.getenv("APP_TIMEZONE", "Asia/Kolkata"))


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    return value if value not in (None, "") else default
