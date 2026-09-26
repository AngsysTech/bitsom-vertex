"""Lecture mind map definition-of-done smoke test (contracts.ts v3.9, AGENTS.md §9.6).

Runs against a live server over HTTP. By default it starts its own uvicorn on a free port
over a throwaway SQLite file. That file is a snapshot of the demo dry-run database when that
database holds a ready CS F212 lecture. Otherwise it creates one through the transcript path,
which takes about 40 s of model calls. It never touches backend/data/app.db.

    cd backend
    .venv/bin/python scripts/mindmap_smoke.py                 # dry-run snapshot, else transcript path
    .venv/bin/python scripts/mindmap_smoke.py --fresh         # always run the transcript path
    .venv/bin/python scripts/mindmap_smoke.py --base-url http://127.0.0.1:8000 --lecture-id lec_...

Checks (from the build brief):
 0. GET /mindmap is 404 until the lecture is ready
 1. section nodes = handout sections one-to-one (same ids, same order); points = key points
 2. exactly one ghost_missed per coverage.missed entry; the Two-phase locking ghost has a why
 3. the serializability node has flags.emphasized with a quote verbatim in its segment;
    3b the stuck section's node has flags.stuck with the marker id
 4. POST /lectures/:id/markers -> the next GET /mindmap shows it without a rebuild call;
    4b the adapter flags a marker's section and its review action (in-process, no HTTP);
    4c a card change (an action dismissed) shows on the next GET without a rebuild call
 5. stats match the node counts
 6. no node label that is not a handout heading, a key point or a missed syllabus topic
 7. POST /rebuild returns a fresh map, and the next GET serves that same map from cache

A check that needs something another component has not shipped is reported BLOCKED, with
the missing piece named. It is never reported as passed. Exit code: 0 all pass, 1 any FAIL,
2 no FAIL but some BLOCKED.
"""
from __future__ import annotations

import argparse
import copy
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
DEMO_LECTURE = BACKEND / "app" / "data" / "lectures" / "cs-f212-2026-09-22-transactions.md"
DRY_RUN_DB = BACKEND / "data" / "demo_run" / "transcript_run.db"
COURSE, STUDENT, LECTURE_DATE = "CS F212", "aarav", "2026-09-22"
TITLE = "Transactions, schedules and serializability"

results: list[tuple[str, str, str]] = []


def record(name: str, status: str, detail: str = "") -> bool:
    results.append((name, status, detail))
    print(f"  [{status}] {name}" + (f": {detail}" if detail else ""), flush=True)
    return status == "PASS"


def check(name: str, ok: bool, detail: str = "") -> bool:
    return record(name, "PASS" if ok else "FAIL", detail)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().casefold()


class Server:
    def __init__(self, base_url: str | None, db_path: str | None):
        self.proc = None
        if base_url:
            self.url = base_url.rstrip("/")
            return
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        self.log = open(Path(db_path).with_suffix(".log"), "w")
        self.proc = subprocess.Popen([str(BACKEND / ".venv" / "bin" / "uvicorn"), "app.main:app", "--port", str(port)],
                                     cwd=BACKEND, env={**os.environ, "DB_PATH": db_path},
                                     stdout=self.log, stderr=subprocess.STDOUT)
        for _ in range(60):
            try:
                if httpx.get(f"{self.url}/health", timeout=1).status_code == 200:
                    return
            except httpx.HTTPError:
                time.sleep(0.25)
        raise RuntimeError(f"server did not start; see {self.log.name}")

    def stop(self) -> None:
        if self.proc:
            self.proc.terminate()
            self.proc.wait(timeout=10)


def snapshot_lecture(db_dir: Path) -> tuple[str, str] | None:
    """(db path, lecture id) of a consistent copy of the dry-run DB with a ready CS F212 lecture."""
    if not DRY_RUN_DB.exists():
        return None
    target = db_dir / "snapshot.db"
    with sqlite3.connect(DRY_RUN_DB) as src, sqlite3.connect(target) as dst:
        src.backup(dst)
    with sqlite3.connect(target) as conn:
        rows = conn.execute("SELECT l.id FROM docs l JOIN docs h ON h.kind = 'handout' AND h.id = l.id "
                            "WHERE l.kind = 'lecture' AND json_extract(l.body, '$.courseCode') = ? "
                            "AND json_extract(l.body, '$.status') = 'ready' ORDER BY l.updated_at DESC",
                            (COURSE,)).fetchall()
    return (str(target), rows[0][0]) if rows else None


def create_lecture(client: httpx.Client, process: bool) -> dict:
    r = client.post("/lectures", json={"studentId": STUDENT, "courseCode": COURSE, "date": LECTURE_DATE,
                                       "title": TITLE, "transcriptText": DEMO_LECTURE.read_text()})
    r.raise_for_status()
    lec = r.json()
    if not process:
        return lec
    started = time.perf_counter()
    lec = client.post(f"/lectures/{lec['id']}/process").json()
    while lec.get("status") not in ("ready", "failed") and time.perf_counter() - started < 240:
        time.sleep(1)
        lec = client.get(f"/lectures/{lec['id']}").json()
    print(f"  transcript path: {lec['id']} {lec.get('status')} in {time.perf_counter() - started:.1f}s", flush=True)
    return lec


def nodes_of(mm: dict, kind: str) -> list[dict]:
    return [n for n in mm["nodes"] if n["kind"] == kind]


def run(client: httpx.Client, lec_id: str) -> None:
    # 0 — 404 until ready: a second lecture that is uploaded but never processed
    pending = create_lecture(client, process=False)
    r = client.get(f"/lectures/{pending['id']}/mindmap")
    check("0 GET /mindmap is 404 before the lecture is ready", r.status_code == 404,
          f"{pending['id']} status {pending['status']} -> HTTP {r.status_code}")

    handout = client.get(f"/lectures/{lec_id}/handout").json()
    cards = client.get(f"/lectures/{lec_id}/cards").json()
    coverage, actions = cards["coverage"], cards["actions"]
    segments = {s["id"]: s for s in client.get(f"/lectures/{lec_id}/transcript").json()["segments"]}
    r = client.get(f"/lectures/{lec_id}/mindmap")
    if not check("GET /lectures/:id/mindmap", r.status_code == 200, f"HTTP {r.status_code} {r.text[:160]}"):
        return
    mm = r.json()
    ids = [n["id"] for n in mm["nodes"]]
    by_id = {n["id"]: n for n in mm["nodes"]}
    roots = nodes_of(mm, "root")
    check("tree: one root, unique ids, every parentId exists",
          len(roots) == 1 and len(ids) == len(set(ids)) and "parentId" not in roots[0]
          and all(n.get("parentId") in by_id for n in mm["nodes"] if n["kind"] != "root"),
          f"{len(mm['nodes'])} nodes, {len(roots)} root(s)")

    # 1 — sections and points mirror the handout
    sections = nodes_of(mm, "section")
    want = [f"sec:{s['id']}" for s in handout["sections"]]
    got = [n["id"] for n in sections]
    check("1 section nodes = handout sections, same ids and order", got == want
          and [n["label"] for n in sections] == [s["heading"] for s in handout["sections"]]
          and all(n["handoutSectionId"] == n["id"][4:] for n in sections), f"want {want}, got {got}")
    points_ok = all([(p["id"], p["label"]) for p in nodes_of(mm, "point") if p["parentId"] == f"sec:{s['id']}"]
                    == [(f"pt:{s['id']}:{i}", kp) for i, kp in enumerate(s["keyPoints"])]
                    for s in handout["sections"])
    check("1b point nodes = key points under their section, same order", points_ok,
          f"{len(nodes_of(mm, 'point'))} points vs {sum(len(s['keyPoints']) for s in handout['sections'])} key points")

    # 2 — ghosts
    ghosts = nodes_of(mm, "ghost_missed")
    pairs = sorted((g["label"], g.get("syllabusSectionId")) for g in ghosts)
    check("2 one ghost_missed per coverage.missed entry",
          pairs == sorted((m["topic"], m["syllabusSectionId"]) for m in coverage["missed"]),
          f"ghosts {pairs}")
    tpl = [g for g in ghosts if norm(g["label"]) == norm("Two-phase locking")]
    check("2b the Two-phase locking ghost exists with a why",
          len(tpl) == 1 and bool(tpl[0]["flags"].get("missed", {}).get("why")),
          (tpl[0]["flags"].get("missed", {}).get("why", "")[:90] if tpl else "no such ghost"))

    # 3 — exam hint on the serializability node
    serial = [n for n in sections if "serializab" in n["label"].casefold()]
    emph = serial[0]["flags"].get("emphasized") if serial else None
    quote_ok = bool(emph) and emph["segmentId"] in serial[0].get("segmentIds", []) \
        and any(e["quote"] == emph["quote"] and e["segmentId"] == emph["segmentId"] for e in coverage["emphasized"]) \
        and norm(emph["quote"]) in norm(segments.get(emph["segmentId"], {}).get("text", ""))
    check("3 serializability node has flags.emphasized with a verified quote", quote_ok,
          f"{serial[0]['id'] if serial else 'no serializability section'}: "
          f"{emph['segmentId'] + ' ' + repr(emph['quote'][:70]) if emph else 'no flag'}")

    # 3b + 4 — a stuck marker through the companion's endpoint
    first = client.get(f"/lectures/{lec_id}/mindmap").json()
    target = serial[0] if serial else sections[0]
    seg = segments[target["segmentIds"][0]]
    r = client.post(f"/lectures/{lec_id}/markers", json={"atSec": (seg["startSec"] + seg["endSec"]) / 2,
                                                         "note": "mind map smoke"})
    if r.status_code == 404 and "not found" in r.text.casefold() and "lecture" not in r.text.casefold():
        missing = "the companion has no POST /lectures/:id/markers yet (StuckMarker, contracts v3.4)"
        record("3b stuck section's node has flags.stuck with the marker id", "BLOCKED", missing)
        record("4 new marker shows on the next GET without a rebuild call", "BLOCKED", missing)
    elif check("4a POST /lectures/:id/markers", r.status_code == 200, f"HTTP {r.status_code} {r.text[:120]}"):
        marker = r.json()
        after = client.get(f"/lectures/{lec_id}/mindmap").json()
        flagged = [n for n in after["nodes"] if marker["id"] in (n["flags"].get("stuck") or {}).get("markerIds", [])]
        expected = f"sec:{marker['handoutSectionId']}" if marker.get("handoutSectionId") else None
        check("3b stuck section's node has flags.stuck with the marker id",
              len(flagged) == 1 and (expected is None or flagged[0]["id"] == expected),
              f"marker {marker['id']} at {marker['atSec']}s -> {[n['id'] for n in flagged]} (expected {expected})")
        check("4 new marker shows on the next GET without a rebuild call",
              bool(flagged) and after["builtAt"] != first["builtAt"],
              f"builtAt {first['builtAt']} -> {after['builtAt']}")

    # 4b — the overlay code with a marker, in-process (no HTTP, no model, no transcript)
    from app.tools import mindmap as adapter
    inputs = {"handout": copy.deepcopy(handout), "coverage": copy.deepcopy(coverage),
              "actions": copy.deepcopy(actions), "markers": [
                  {"id": "mk_smoke", "lectureId": lec_id, "atSec": seg["startSec"], "createdAt": "2026-09-26T00:00:00Z",
                   "segmentId": seg["id"]}]}
    inputs["actions"]["items"].append({"id": "act_smoke", "lectureId": lec_id, "kind": "review", "title": "smoke",
                                       "course": COURSE, "topic": "smoke", "why": "smoke", "status": "proposed",
                                       "provenance": {"markerId": "mk_smoke"}})
    built = {n["id"]: n for n in adapter.build(lec_id, inputs)["nodes"]}
    flag = built[target["id"]]["flags"]
    check("4b adapter: a marker on a section's segment flags that section and its review action",
          flag.get("stuck", {}).get("markerIds") == ["mk_smoke"] and flag.get("reviewActionId") == "act_smoke"
          and sum(1 for n in built.values() if n["flags"].get("stuck")) == 1,
          f"{target['id']} flags {sorted(flag)}")

    # 4c — a card change reaches the next GET without a rebuild call
    before = client.get(f"/lectures/{lec_id}/mindmap").json()
    pointed = [(n["id"], n["flags"]["reviewActionId"]) for n in before["nodes"] if n["flags"].get("reviewActionId")]
    status_of = {a["id"]: a["status"] for a in actions["items"]}
    proposed = [(node, act) for node, act in pointed if status_of.get(act) == "proposed"]
    if not proposed:
        record("4c card change shows on the next GET without a rebuild call", "FAIL",
               f"no node points at a proposed action to dismiss: {pointed}")
    else:
        node_id, act_id = proposed[0]
        client.post(f"/actions/{act_id}", json={"status": "dismissed"}).raise_for_status()
        after = client.get(f"/lectures/{lec_id}/mindmap").json()
        now = next(n for n in after["nodes"] if n["id"] == node_id)["flags"].get("reviewActionId")
        check("4c card change shows on the next GET without a rebuild call",
              now != act_id and after["builtAt"] != before["builtAt"],
              f"dismissed {act_id}: {node_id} reviewActionId {act_id} -> {now}")
        client.post(f"/actions/{act_id}", json={"status": "proposed"})

    # 5 — stats
    mm = client.get(f"/lectures/{lec_id}/mindmap").json()
    counted = {"sections": len(nodes_of(mm, "section")), "points": len(nodes_of(mm, "point")),
               "stuck": sum(1 for n in mm["nodes"] if n["flags"].get("stuck")),
               "missed": len(nodes_of(mm, "ghost_missed")),
               "emphasized": sum(1 for n in mm["nodes"] if n["flags"].get("emphasized"))}
    check("5 stats match the node counts", mm["stats"] == counted, f"stats {mm['stats']}")

    # 6 — no invented nodes
    allowed = {"root": {handout["title"]}, "section": {s["heading"] for s in handout["sections"]},
               "point": {kp for s in handout["sections"] for kp in s["keyPoints"]},
               "ghost_missed": {m["topic"] for m in coverage["missed"]}}
    invented = [(n["kind"], n["label"]) for n in mm["nodes"] if n["label"] not in allowed[n["kind"]]]
    check("6 every label is a handout heading, key point or missed syllabus topic", not invented,
          f"{len(mm['nodes'])} labels checked" + (f", invented {invented[:3]}" if invented else ""))

    # 7 — rebuild, then the cache serves it
    rebuilt = client.post(f"/lectures/{lec_id}/mindmap/rebuild").json()
    again = client.get(f"/lectures/{lec_id}/mindmap").json()
    check("7 POST /rebuild returns a fresh map; the next GET serves it from cache",
          rebuilt["builtAt"] != mm["builtAt"] and again == rebuilt, f"builtAt {mm['builtAt']} -> {rebuilt['builtAt']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--lecture-id", help="a ready CS F212 lecture on --base-url")
    ap.add_argument("--fresh", action="store_true", help="create the lecture through the transcript path")
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="mindmap_smoke_"))
    snap = None if (args.fresh or args.base_url) else snapshot_lecture(tmp)
    db_path = snap[0] if snap else str(tmp / "smoke.db")
    server = Server(args.base_url, None if args.base_url else db_path)
    try:
        client = httpx.Client(base_url=server.url, timeout=60)
        if args.lecture_id:
            lec_id, source = args.lecture_id, f"--lecture-id on {server.url}"
        elif snap:
            lec_id, source = snap[1], f"snapshot of {DRY_RUN_DB.relative_to(BACKEND)}"
        else:
            lec = create_lecture(client, process=True)
            if lec.get("status") != "ready":
                check("transcript path reaches ready", False, f"{lec.get('status')} {lec.get('error', '')}")
                return 1
            lec_id, source = lec["id"], "transcript path"
        print(f"\n== Mind map smoke on {lec_id} ({source}); server {server.url}", flush=True)
        run(client, lec_id)
    finally:
        server.stop()

    fails = [r for r in results if r[1] == "FAIL"]
    blocked = [r for r in results if r[1] == "BLOCKED"]
    passed = len(results) - len(fails) - len(blocked)
    print(f"\n{passed} passed, {len(fails)} failed, {len(blocked)} blocked", flush=True)
    for name, _, detail in blocked:
        print(f"  BLOCKED {name}: {detail}")
    return 1 if fails else 2 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
