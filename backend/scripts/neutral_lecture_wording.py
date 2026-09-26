"""Rewrite stored lecture-judging wording to the neutral wording the companion now writes (26 Sep 2026).

Lectures processed before the change carry text that grades the lecture: the class-thread message says
"Compared with <unit>, the lecture did not cover X", and some model-written action reasons say "the lecture
skipped it". New runs no longer write that (tools/companion.py, prompts/class_companion.md). This rewrites
what is already stored, so the preloaded demo lectures read the same way, without re-running STT or the LLM:

- message text: "Compared with U, the lecture did not cover X." → "It maps to U. Also on that unit's
  syllabus: X, on your actions list to study."; "It covered every topic listed for U." → "It maps to U."
- any "why" (actions, plan blocks, calendar items, card copies inside messages) whose first clause says the
  lecture skipped / missed / didn't cover the topic: that clause becomes "On your syllabus for this unit",
  the fallback the code already uses. The code-computed facts after the first ";" are kept as they are.

Idempotent. Backs the database up first (sqlite backup API, safe while the server runs in WAL mode).

    .venv/bin/python scripts/neutral_lecture_wording.py --dry-run     # show what would change
    .venv/bin/python scripts/neutral_lecture_wording.py               # rewrite data/app.db (or $DB_PATH)
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import DB_PATH  # noqa: E402

NEUTRAL = "On your syllabus for this unit"
_COMPARED = re.compile(r"Compared with (.+?), the lecture did not cover (.+?)\.(?=\s|$)")
_ALL_COVERED = re.compile(r"It covered every topic listed for (.+?)\.(?=\s|$)")
_JUDGING = re.compile(
    r"\b(?:lecture|class|lecturer)\b[^;]*?\b(?:skip(?:s|ped)?|miss(?:es|ed)?|left out|did not cover|didn.?t cover|"
    r"not (?:covered|taught))\b|\b(?:skip(?:ped)?|missed|left out|not (?:covered|taught))\b[^;]*?\b(?:lecture|class)\b",
    re.I)
_TITLE_TAG = re.compile(r"\s*\((?:skipped|missed|not covered)[^)]*\)", re.I)


def _text(text: str) -> str:
    text = _COMPARED.sub(r"It maps to \1. Also on that unit's syllabus: \2, on your actions list to study.", text)
    return _ALL_COVERED.sub(r"It maps to \1.", text)


def _why(why: str) -> str:
    first, sep, rest = why.partition(";")
    return f"{NEUTRAL}{sep}{rest}" if _JUDGING.search(first) else why


def _walk(node: Any) -> Any:
    if isinstance(node, list):
        return [_walk(x) for x in node]
    if not isinstance(node, dict):
        return node
    out = {k: _walk(v) for k, v in node.items()}
    if isinstance(out.get("why"), str):
        out["why"] = _why(out["why"])
        if isinstance(out.get("title"), str):
            out["title"] = _TITLE_TAG.sub("", out["title"])
    if isinstance(out.get("text"), str) and out.get("role") == "agent":
        out["text"] = _text(out["text"])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(DB_PATH))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    db = Path(args.db)
    if not db.exists():
        print(f"no database at {db}")
        return 1
    conn = sqlite3.connect(db, timeout=30)
    rows = conn.execute("SELECT kind, id, body FROM docs").fetchall()
    changes: list[tuple[str, str, str]] = []
    for kind, doc_id, body in rows:
        try:
            data = json.loads(body)
        except ValueError:
            continue
        new = _walk(data)
        if new != data:
            changes.append((kind, doc_id, json.dumps(new, ensure_ascii=False)))
    by_kind: dict[str, int] = {}
    for kind, _, _ in changes:
        by_kind[kind] = by_kind.get(kind, 0) + 1
    print(f"{len(changes)} docs to rewrite in {db}: {by_kind or 'none'}")
    if args.dry_run or not changes:
        for kind, doc_id, body in changes[:40]:
            hits = [m.group(0) for m in re.finditer(r"It maps to [^.]+\.|On your syllabus for this unit[^;\"]*", body)]
            print(f"  {kind} {doc_id}: {hits[:3]}")
        return 0
    backup = db.with_name(f"{db.name}.bak-{datetime.now():%Y%m%d-%H%M%S}")
    with sqlite3.connect(backup) as dst:
        conn.backup(dst)
    print(f"backup: {backup}")
    with conn:
        conn.executemany("UPDATE docs SET body = ? WHERE kind = ? AND id = ?",
                         [(body, kind, doc_id) for kind, doc_id, body in changes])
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
