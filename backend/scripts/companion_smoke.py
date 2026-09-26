"""Class companion definition-of-done smoke test.

Runs against a live server over HTTP. By default it starts its own uvicorn on a free
port with a throwaway SQLite file, so it never touches backend/data/app.db.

    cd backend
    .venv/bin/python scripts/companion_smoke.py                   # checks 1-6 (text path)
    .venv/bin/python scripts/companion_smoke.py --audio clip.mp3  # + 7 (real audio) and 8 (STT key killed)
    .venv/bin/python scripts/companion_smoke.py --make-audio      # + 7/8 with a ~2 min clip spoken by macOS `say`
    .venv/bin/python scripts/companion_smoke.py --base-url http://127.0.0.1:8000   # use a running server

Checks (from the build brief):
 1. transcript path → status ready in < 60 s
 2. handout has >= 3 sections; every segmentId exists in the transcript
 3. coverage.missed has "Two-phase locking"; emphasized has the serializability exam-hint quote, verbatim in its segment
 4. a next_lecture_topic commitment on deadlocks, dueBy = the CS F212 session the lecturer named (timetable.json)
 5. actions: prep (deadlocks, due by next session), study (two-phase locking, why cites marks), review (serializability)
 6. accept the study action → plan block in StudentState + calendar item with source.type = "action"
 7. real audio clip through STT → ready, >= 2 sections
 8. STT key killed → audio lecture failed with error; transcript path still passes 1-6
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

BACKEND = Path(__file__).resolve().parents[1]
DATA = BACKEND / "app" / "data"
LECTURE_FILE = DATA / "lectures" / "cs-f212-2026-09-22-transactions.md"
COURSE, STUDENT, LECTURE_DATE = "CS F212", "aarav", "2026-09-22"
TZ = ZoneInfo("Asia/Kolkata")
READY_BUDGET_SEC = 60

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f": {detail}" if detail else ""), flush=True)
    return ok


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().casefold()


# ---- server management ------------------------------------------------------------------

class Server:
    def __init__(self, base_url: str | None, db_path: str | None, env_overrides: dict[str, str] | None = None):
        self.proc = None
        self.db_path = db_path
        if base_url:
            self.url = base_url.rstrip("/")
            return
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        self.url = f"http://127.0.0.1:{port}"
        env = {**os.environ, "DB_PATH": db_path, **(env_overrides or {})}
        self.log = open(Path(db_path).with_suffix(".log"), "w")
        self.proc = subprocess.Popen([str(BACKEND / ".venv" / "bin" / "uvicorn"), "app.main:app", "--port", str(port)],
                                     cwd=BACKEND, env=env, stdout=self.log, stderr=subprocess.STDOUT)
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


def wait_until_done(client: httpx.Client, lecture_id: str, timeout: float = 240) -> tuple[dict, float]:
    started = time.perf_counter()
    lec = client.post(f"/lectures/{lecture_id}/process").json()
    while lec.get("status") not in ("ready", "failed") and time.perf_counter() - started < timeout:
        time.sleep(1)
        lec = client.get(f"/lectures/{lecture_id}").json()
    return lec, time.perf_counter() - started


# ---- independent expectations (read the dataset directly, not through the app) ----------------

def course_sessions(first_day: date, lectures_only: bool) -> list[datetime]:
    """CS F212 session starts from timetable.json (stub `sessions` or generated `rows` format)."""
    tt = json.loads((DATA / "timetable.json").read_text())
    rows = [r for r in (tt.get("sessions") or tt.get("rows") or []) if r["courseCode"] == COURSE
            and (not lectures_only or r.get("kind", "lecture") == "lecture")]
    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    out = []
    for offset in range(0, 21):
        d = first_day + timedelta(days=offset)
        for r in rows:
            if days.index(r["day"].lower()[:3]) == d.weekday():
                h, m = map(int, r["start"].split(":"))
                out.append(datetime(d.year, d.month, d.day, h, m, tzinfo=TZ))
    return sorted(out)


def expected_due(quote: str) -> datetime:
    """What the lecturer said, resolved against the timetable: "next week" → the first session
    of the following week; otherwise ("next lecture/session/time") → the next lecture."""
    lecture_day = date.fromisoformat(LECTURE_DATE)
    if "next week" in quote.lower():
        monday = lecture_day + timedelta(days=7 - lecture_day.weekday())
        return course_sessions(monday, lectures_only=False)[0]
    return course_sessions(lecture_day + timedelta(days=1), lectures_only=True)[0]


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    if len(value) == 10:
        return datetime.fromisoformat(value).replace(tzinfo=TZ)
    return datetime.fromisoformat(value)


# ---- checks 1-6 ---------------------------------------------------------------------------

def run_text_path(server: Server, label: str) -> bool:
    print(f"\n== Text path ({label})", flush=True)
    before = len(results)
    client = httpx.Client(base_url=server.url, timeout=30)
    r = client.post("/lectures", json={"studentId": STUDENT, "courseCode": COURSE, "date": LECTURE_DATE,
                                       "title": "Transactions, schedules and serializability",
                                       "transcriptText": LECTURE_FILE.read_text()})
    if not check("1a POST /lectures (transcriptText)", r.status_code == 200 and r.json().get("source") == "transcript",
                 f"{r.status_code} {r.text[:120]}"):
        return False
    lec_id = r.json()["id"]
    lec, elapsed = wait_until_done(client, lec_id)
    check("1 status ready in < 60 s", lec.get("status") == "ready" and elapsed < READY_BUDGET_SEC,
          f"status={lec.get('status')} in {elapsed:.1f}s" + (f" error={lec.get('error')}" if lec.get("error") else ""))
    if lec.get("status") != "ready":
        return False

    transcript = client.get(f"/lectures/{lec_id}/transcript").json()
    seg = {s["id"]: s["text"] for s in transcript["segments"]}
    handout = client.get(f"/lectures/{lec_id}/handout").json()
    ids = [sid for s in handout["sections"] for sid in s["segmentIds"]]
    check("2 handout >= 3 sections, every segmentId verifies",
          len(handout["sections"]) >= 3 and all(i in seg for i in ids) and all(s["segmentIds"] for s in handout["sections"]),
          f"{len(handout['sections'])} sections, {len(ids)} segment refs, unknown={[i for i in ids if i not in seg]}")

    cards = client.get(f"/lectures/{lec_id}/cards").json()
    cov, act = cards["coverage"], cards["actions"]
    missed = [m["topic"] for m in cov["missed"]]
    check("3a coverage.missed contains Two-phase locking", any(norm(t) == "two-phase locking" for t in missed),
          f"missed={missed}")
    hint = [e for e in cov["emphasized"] if "serializab" in norm(e["quote"]) and re.search(r"end.?sem", norm(e["quote"]))]
    check("3b emphasized has the serializability exam-hint quote, verbatim in its segment",
          bool(hint) and all(norm(e["quote"]) in norm(seg.get(e["segmentId"], "")) for e in hint),
          f"{[(e['segmentId'], e['quote'][:70]) for e in hint]}")

    nl = [c for c in act["commitments"] if c["kind"] == "next_lecture_topic" and "deadlock" in norm(c["text"])]
    next_session = expected_due(nl[0]["quote"]) if nl else None
    check("4 next_lecture_topic (deadlocks) dueBy = the CS F212 session the lecturer named, from timetable.json",
          bool(nl) and parse_dt(nl[0].get("dueBy")) == next_session,
          f"quote={nl[0]['quote'] if nl else None!r}; expected {next_session and next_session.isoformat()}, "
          f"got {[c.get('dueBy') for c in nl]}")

    items = act["items"]
    prep = [a for a in items if a["kind"] == "prep" and "deadlock" in norm(a["title"] + " " + a["topic"])]
    study = [a for a in items if a["kind"] == "study" and norm(a["topic"]) == "two-phase locking"]
    review = [a for a in items if a["kind"] == "review" and "serializab" in norm(a["title"] + " " + a["topic"])]
    check("5a prep action on deadlocks, due by the next session",
          bool(prep) and next_session is not None and parse_dt(prep[0].get("dueBy")) is not None
          and parse_dt(prep[0]["dueBy"]) <= next_session,
          f"{[(a['title'], a.get('dueBy')) for a in prep]}")
    check("5b study action on two-phase locking, why cites past-paper marks",
          bool(study) and bool(re.search(r"\d+\s*(–|-|to)?\s*\d*\s*marks", study[0]["why"])),
          f"{[a['why'] for a in study]}")
    check("5c review action on serializability", bool(review), f"{[a['title'] for a in review]}")

    if study:
        acc = client.post(f"/actions/{study[0]['id']}", json={"status": "accepted"}).json()
        check("6a accept study action → planBlockId + calendarItemId",
              acc.get("status") == "accepted" and bool(acc.get("planBlockId")) and bool(acc.get("calendarItemId")),
              json.dumps({k: acc.get(k) for k in ("status", "planBlockId", "calendarItemId", "error")}))
        plan_ids = []
        if server.db_path:
            with sqlite3.connect(server.db_path) as conn:
                row = conn.execute("SELECT body FROM docs WHERE kind='state' AND id=?", (STUDENT,)).fetchone()
            plan = json.loads(row[0]).get("plan", {}) if row else {}
            plan_ids = [b["id"] for w in plan.get("weeks", []) for b in w.get("blocks", [])]
        check("6b StudentState.plan gains the block", acc.get("planBlockId") in plan_ids,
              f"plan blocks={plan_ids}")
        start = date.today() - timedelta(days=date.today().weekday())
        calendar = client.get(f"/calendar/{STUDENT}", params={"from": start.isoformat(),
                                                              "to": (start + timedelta(days=41)).isoformat()}).json()
        hit = [i for i in calendar if i["source"].get("type") == "action" and i["source"].get("actionId") == study[0]["id"]]
        check("6c GET /calendar shows it with source.type = action", bool(hit),
              f"{[(i['kind'], i['start'], i['title']) for i in hit]}; {len(calendar)} items total")

    thread = client.get(f"/threads/{STUDENT}/academic_coach").json()
    notify = [m for m in thread["messages"] if m["role"] == "agent" and m["cards"]
              and {c["type"] for c in m["cards"]} >= {"coverage", "actions"}
              and any(c.get("lectureId") == lec_id for c in m["cards"])]
    check("7-notify academic_coach thread has the summary message with both cards and a trace",
          bool(notify) and len(notify[0]["trace"]) >= 6, f"{notify[0]['text'][:140] if notify else thread}")
    return all(ok for _, ok, _ in results[before:])


# ---- checks 7 and 8 -------------------------------------------------------------------------

def make_audio(out_dir: Path) -> Path:
    """~2 minutes of the lecture spoken by macOS `say`, as m4a: the first ~320 words, which is
    what lectures/README.md asks the presenter to record for the live demo."""
    text = re.sub(r"\A---.*?---\s*", "", LECTURE_FILE.read_text(), flags=re.S)
    text = " ".join(line for line in text.splitlines() if not line.startswith("#"))
    clip = " ".join(text.split()[:320])
    aiff, m4a = out_dir / "clip.aiff", out_dir / "clip.m4a"
    subprocess.run(["say", "-r", "175", "-o", str(aiff), clip], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff), "-c:a", "aac", "-b:a", "64k", str(m4a)],
                   check=True)
    return m4a


def post_audio(client: httpx.Client, path: Path) -> dict:
    with open(path, "rb") as fh:
        r = client.post("/lectures", data={"studentId": STUDENT, "courseCode": COURSE, "date": LECTURE_DATE,
                                           "title": "Transactions (audio)"},
                        files={"audio": (path.name, fh, "application/octet-stream")})
    return r.json()


def run_audio(server: Server, audio: Path) -> None:
    print("\n== Audio path (real STT)", flush=True)
    client = httpx.Client(base_url=server.url, timeout=60)
    lec = post_audio(client, audio)
    if not check("7a POST /lectures (multipart audio)", lec.get("source") == "upload", json.dumps(lec)[:160]):
        return
    lec, elapsed = wait_until_done(client, lec["id"], timeout=300)
    handout = client.get(f"/lectures/{lec['id']}/handout").json() if lec.get("status") == "ready" else {}
    n = len(handout.get("sections", []))
    check("7 audio → ready, >= 2 sections", lec.get("status") == "ready" and n >= 2,
          f"status={lec.get('status')} in {elapsed:.1f}s, {n} sections, duration={lec.get('durationSec')}s"
          + (f" error={lec.get('error')}" if lec.get("error") else ""))


def run_stt_killed(db_dir: Path, audio: Path) -> None:
    print("\n== STT key killed", flush=True)
    kill = {"ASSEMBLYAI_API_KEY": "killed-by-smoke-test", "STT_OPENAI_API_KEY": "killed-by-smoke-test"}
    server = Server(None, str(db_dir / "killed.db"), kill)
    try:
        client = httpx.Client(base_url=server.url, timeout=60)
        lec = post_audio(client, audio)
        lec, _ = wait_until_done(client, lec["id"], timeout=120)
        check("8a audio path fails with status failed + error",
              lec.get("status") == "failed" and bool(lec.get("error")), f"{lec.get('status')}: {lec.get('error')}")
        run_text_path(server, "STT key killed")
    finally:
        server.stop()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--db", help="SQLite path of the --base-url server (for check 6b); default backend/data/app.db")
    ap.add_argument("--audio", type=Path)
    ap.add_argument("--make-audio", action="store_true")
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix="companion_smoke_"))
    db = args.db or (str(BACKEND / "data" / "app.db") if args.base_url else str(tmp / "smoke.db"))
    print(f"artifacts: {tmp}")
    server = Server(args.base_url, db)
    try:
        run_text_path(server, "normal")
        audio = args.audio or (make_audio(tmp) if args.make_audio else None)
        if audio:
            run_audio(server, audio)
    finally:
        server.stop()
    if audio:
        run_stt_killed(tmp, audio)
    else:
        print("\n(skipping 7 and 8: pass --audio PATH or --make-audio)")

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + (f"; FAILED: {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
