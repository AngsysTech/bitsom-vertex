"""Class companion definition-of-done smoke test.

Runs against a live server over HTTP. By default it starts its own uvicorn on a free
port with a throwaway SQLite file, so it never touches backend/data/app.db.

    cd backend
    .venv/bin/python scripts/companion_smoke.py                   # checks 1-6 (text path)
    .venv/bin/python scripts/companion_smoke.py --audio clip.mp3  # + 7 (real audio) and 8 (STT key killed)
    .venv/bin/python scripts/companion_smoke.py --make-audio      # + 7/8 with a ~2 min clip spoken by macOS `say`
    .venv/bin/python scripts/companion_smoke.py --base-url http://127.0.0.1:8000   # use a running server
    .venv/bin/python scripts/companion_smoke.py --student meera   # another student, same lecture
    .venv/bin/python scripts/companion_smoke.py --lecture app/data/lectures/cs-f372-2026-09-23-scheduling.md

Checks (from the build brief). Actions are matched on their canonical `topic`, never on titles.
 1. transcript path → status ready in < 60 s
 2. handout has >= 3 sections; every segmentId exists in the transcript
 3. coverage.missed has the lecture's planted skipped topic (lectures/README.md); for the CS F212 demo
    lecture, emphasized has the serializability exam-hint quote, verbatim in its segment
 4. a next_lecture_topic commitment on deadlocks, dueBy = the CS F212 session the lecturer named (timetable.json)
 5. actions: prep (Deadlocks, due by next session), study (Two-phase locking, why cites marks),
    review (Serializability); 5d every coverage.missed topic has a study or prep action;
    5e one action per (topic, kind)
 6. accept the study action → plan block in StudentState + calendar item with source.type = "action"
 7. real audio clip through STT → ready, >= 2 sections
 8. STT key killed → audio lecture failed with error; transcript path still passes 1-6
Checks 3b, 4 and 5a-5c are specific to the CS F212 demo lecture and run only for it.
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
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

BACKEND = Path(__file__).resolve().parents[1]
DATA = BACKEND / "app" / "data"
DEMO_LECTURE = DATA / "lectures" / "cs-f212-2026-09-22-transactions.md"
# the topic each synthetic lecture skips on purpose (lectures/README.md)
PLANTED = {"cs-f212-2026-09-22-transactions.md": "Two-phase locking",
           "cs-f372-2026-09-23-scheduling.md": "Multilevel feedback queues",
           "cs-f303-2026-09-24-transport.md": "Congestion control"}
TZ = ZoneInfo("Asia/Kolkata")
READY_BUDGET_SEC = 60

# set by configure() from --student / --lecture
LECTURE_FILE, COURSE, STUDENT, LECTURE_DATE = DEMO_LECTURE, "CS F212", "aarav", "2026-09-22"
TITLE = "Transactions, schedules and serializability"


def configure(student: str, lecture: Path) -> None:
    """Point the checks at one lecture file (course and date from its front matter) and student."""
    global LECTURE_FILE, COURSE, STUDENT, LECTURE_DATE, TITLE
    front = re.match(r"\A---\n(.*?)\n---", lecture.read_text(), re.S)
    meta = dict(re.findall(r"^(\w+):\s*(.+?)\s*$", front.group(1) if front else "", re.M))
    LECTURE_FILE, STUDENT = lecture.resolve(), student
    COURSE, LECTURE_DATE = meta.get("courseCode", COURSE), meta.get("date", LECTURE_DATE)
    if LECTURE_FILE != DEMO_LECTURE.resolve():
        TITLE = meta.get("unit") or f"{COURSE} lecture"


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
    print(f"\n== Text path ({label}: {STUDENT}, {LECTURE_FILE.name})", flush=True)
    before = len(results)
    demo = LECTURE_FILE == DEMO_LECTURE.resolve()
    client = httpx.Client(base_url=server.url, timeout=30)
    r = client.post("/lectures", json={"studentId": STUDENT, "courseCode": COURSE, "date": LECTURE_DATE,
                                       "title": TITLE, "transcriptText": LECTURE_FILE.read_text()})
    if not check("1a POST /lectures (transcriptText)", r.status_code == 200 and r.json().get("source") == "transcript",
                 f"{r.status_code} {r.text[:120]}"):
        return False
    lec_id = r.json()["id"]
    early = client.post(f"/lectures/{lec_id}/markers", json={"atSec": 75, "note": "lost at the precedence graph"})
    check("M1 POST marker before processing → StuckMarker (unresolved until there is a transcript)",
          early.status_code == 200 and early.json().get("atSec") == 75 and not early.json().get("segmentId"),
          f"{early.status_code} {early.text[:140]}")
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
    planted = PLANTED.get(LECTURE_FILE.name)
    if planted:
        check(f"3a coverage.missed contains {planted}", any(norm(t) == norm(planted) for t in missed),
              f"missed={missed}")
    items = act["items"]
    for a in items:
        print(f"         {a['kind']:8} {a['topic'][:34]:34} due {a.get('dueBy') or '-':25} {a['title'][:56]}")

    def on(kind: str, topic: str) -> list[dict]:
        """Actions of this kind whose canonical topic is ``topic``."""
        return [a for a in items if a["kind"] == kind and norm(a["topic"]) == norm(topic)]

    study = [a for a in items if a["kind"] == "study" and any(norm(a["topic"]) == norm(t) for t in missed)]
    if demo:
        hint = [e for e in cov["emphasized"]
                if "serializab" in norm(e["quote"]) and re.search(r"end.?sem", norm(e["quote"]))]
        check("3b emphasized has the serializability exam-hint quote, verbatim in its segment",
              bool(hint) and all(norm(e["quote"]) in norm(seg.get(e["segmentId"], "")) for e in hint),
              f"{[(e['segmentId'], e['quote'][:70]) for e in hint]}")

        nl = [c for c in act["commitments"] if c["kind"] == "next_lecture_topic" and "deadlock" in norm(c["text"])]
        next_session = expected_due(nl[0]["quote"]) if nl else None
        check("4 next_lecture_topic (deadlocks) dueBy = the CS F212 session the lecturer named, from timetable.json",
              bool(nl) and parse_dt(nl[0].get("dueBy")) == next_session,
              f"quote={nl[0]['quote'] if nl else None!r}; expected {next_session and next_session.isoformat()}, "
              f"got {[c.get('dueBy') for c in nl]}")

        prep, study, review = on("prep", "Deadlocks"), on("study", "Two-phase locking"), on("review", "Serializability")
        check("5a prep action on Deadlocks, due by the next session",
              bool(prep) and next_session is not None and parse_dt(prep[0].get("dueBy")) is not None
              and parse_dt(prep[0]["dueBy"]) <= next_session,
              f"{[(a['title'], a.get('dueBy')) for a in prep]}")
        check("5b study action on Two-phase locking, why cites past-paper marks",
              bool(study) and bool(re.search(r"\d+\s*(–|-|to)?\s*\d*\s*marks", study[0]["why"])),
              f"{[a['why'] for a in study]}")
        check("5c review action on Serializability", bool(review), f"{[a['title'] for a in review]}")
    without = [t for t in missed if not (on("study", t) or on("prep", t))]
    check("5d every coverage.missed topic has a study or prep action", not without,
          f"missed={missed}" + (f", without one: {without}" if without else ""))
    dups = [f"{kind} {topic!r}" for (topic, kind), n in Counter((norm(a["topic"]), a["kind"]) for a in items).items()
            if n > 1]
    check("5e one action per (topic, kind)", not dups, f"duplicates: {dups}" if dups else f"{len(items)} actions")

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

    thread = client.get(f"/threads/{STUDENT}/class/{COURSE}").json()
    notify = [m for m in thread["messages"] if m["role"] == "agent" and m["cards"]
              and {c["type"] for c in m["cards"]} >= {"coverage", "actions"}
              and any(c.get("lectureId") == lec_id for c in m["cards"])]
    check("7-notify class thread has the summary message with both cards and a trace",
          thread.get("id") == f"{STUDENT}:class:{COURSE}" and thread.get("courseCode") == COURSE
          and bool(notify) and len(notify[0]["trace"]) >= 6,
          f"{thread.get('id')}: {notify[0]['text'][:140] if notify else thread.get('messages')}")
    step = next((t for t in notify[0]["trace"] if t["tool"] == "class_companion.actions"), None) if notify else None
    if step:
        print(f"         trace class_companion.actions: {step['summary']}", flush=True)

    # stuck markers: the pre-processing tap, resolved on ready
    markers = client.get(f"/lectures/{lec_id}/markers").json()
    m1 = next((m for m in markers if m["id"] == early.json().get("id")), {})
    sections = {sec["id"]: sec for sec in handout["sections"]}
    check("M2 marker resolved on ready: segmentId, handoutSectionId, topic",
          bool(m1.get("segmentId")) and m1.get("handoutSectionId") in sections and bool(m1.get("topic"))
          and seg_covers(transcript, m1["segmentId"], 75), json.dumps(m1)[:220])
    check("M3 handout section.stuck, coverage.confusion and a review action name the marker",
          m1.get("id") in ((sections.get(m1.get("handoutSectionId")) or {}).get("stuck") or {}).get("markerIds", [])
          and any(c["markerId"] == m1.get("id") for c in cov.get("confusion", []))
          and any(a["kind"] == "review" and a["provenance"].get("markerId") == m1.get("id") for a in act["items"]),
          f"confusion={cov.get('confusion')}")

    # a tap after ready is applied at once: cards recompute and the class thread hears about it
    n_msgs = len(thread["messages"])
    late = client.post(f"/lectures/{lec_id}/markers", json={"atSec": 0}).json()
    cards2 = client.get(f"/lectures/{lec_id}/cards").json()
    thread2 = client.get(f"/threads/{STUDENT}/class/{COURSE}").json()
    note_msg = [m for m in thread2["messages"][n_msgs:]
                if any(t["tool"] == "class_companion.marker" for t in m.get("trace") or [])]
    check("M4 marker after ready: resolved in the response, cards recomputed, note in class thread",
          bool(late.get("handoutSectionId")) and bool(late.get("topic"))
          and any(c["markerId"] == late.get("id") for c in cards2["coverage"]["confusion"])
          and any(a["kind"] == "review" and (a["provenance"].get("markerId") == late.get("id")
                                             or norm(a["topic"]) == norm(late.get("topic", "")))
                  for a in cards2["actions"]["items"])
          and bool(note_msg), f"{json.dumps(late)[:160]} | {note_msg[0]['text'][:120] if note_msg else 'no message'}")

    # the Schedule tab: courseCode filters the calendar to one class
    rng = {"from": "2026-09-21", "to": "2026-10-18"}
    everything = client.get(f"/calendar/{STUDENT}", params=rng).json()
    one = client.get(f"/calendar/{STUDENT}", params={**rng, "courseCode": COURSE}).json()
    check("C1 GET /calendar?courseCode filters to that class",
          bool(one) and all(i.get("courseCode") == COURSE for i in one) and len(one) < len(everything),
          f"{len(one)} of {len(everything)} items")
    return all(ok for _, ok, _ in results[before:])


def seg_covers(transcript: dict, seg_id: str, at: float) -> bool:
    """The resolved segment is the one covering ``at``, or the nearest one when none does."""
    segs = transcript["segments"]
    inside = [x for x in segs if x["startSec"] <= at < x["endSec"]]
    want = inside[0] if inside else min(segs, key=lambda x: min(abs(at - x["startSec"]), abs(at - x["endSec"])))
    return want["id"] == seg_id


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
    ap.add_argument("--student", default=STUDENT)
    ap.add_argument("--lecture", type=Path, default=DEMO_LECTURE,
                    help="transcript .md with courseCode/date front matter (default: the CS F212 demo lecture)")
    args = ap.parse_args()
    configure(args.student, args.lecture)

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
