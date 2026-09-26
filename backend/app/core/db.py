"""SQLite document store: one table, JSON bodies keyed by (kind, id).

Every pipeline step writes its result here before the next step starts, so a
lecture's state survives a server restart and every endpoint reads from here.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any

from app.core.config import DB_PATH

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def _connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """CREATE TABLE IF NOT EXISTS docs (
                kind TEXT NOT NULL,
                id TEXT NOT NULL,
                student_id TEXT,
                parent_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                body TEXT NOT NULL,
                PRIMARY KEY (kind, id)
            )"""
        )
        conn.execute("CREATE INDEX IF NOT EXISTS docs_student ON docs(kind, student_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS docs_parent ON docs(kind, parent_id)")
        conn.commit()
        _conn = conn
    return _conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def put(kind: str, id: str, body: dict[str, Any], *, student_id: str | None = None,
        parent_id: str | None = None) -> dict[str, Any]:
    with _lock:
        conn = _connection()
        now = _now()
        conn.execute(
            """INSERT INTO docs (kind, id, student_id, parent_id, created_at, updated_at, body)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(kind, id) DO UPDATE SET
                 student_id = COALESCE(excluded.student_id, docs.student_id),
                 parent_id = COALESCE(excluded.parent_id, docs.parent_id),
                 updated_at = excluded.updated_at,
                 body = excluded.body""",
            (kind, id, student_id, parent_id, now, now, json.dumps(body, ensure_ascii=False)),
        )
        conn.commit()
    return body


def get(kind: str, id: str) -> dict[str, Any] | None:
    with _lock:
        row = _connection().execute(
            "SELECT body FROM docs WHERE kind = ? AND id = ?", (kind, id)
        ).fetchone()
    return json.loads(row[0]) if row else None


def find(kind: str, *, student_id: str | None = None, parent_id: str | None = None) -> list[dict[str, Any]]:
    sql = "SELECT body FROM docs WHERE kind = ?"
    args: list[Any] = [kind]
    if student_id is not None:
        sql += " AND student_id = ?"
        args.append(student_id)
    if parent_id is not None:
        sql += " AND parent_id = ?"
        args.append(parent_id)
    sql += " ORDER BY created_at, rowid"
    with _lock:
        rows = _connection().execute(sql, args).fetchall()
    return [json.loads(r[0]) for r in rows]


def delete(kind: str, id: str) -> None:
    with _lock:
        conn = _connection()
        conn.execute("DELETE FROM docs WHERE kind = ? AND id = ?", (kind, id))
        conn.commit()
