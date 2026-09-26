"""Feature 2 definition-of-done smoke test: week plan, calendar, weekly 1:1, academic_coach chat.

Runs against a live server over HTTP. By default it starts its own uvicorn on a free port with a
throwaway SQLite file, so it never touches backend/data/app.db. Expectations are computed from the
dataset files directly (timetable, exam calendar, syllabi, past papers), not through the app.

    cd backend
    .venv/bin/python scripts/feature2_smoke.py                  # 1-7; check 3 runs the class companion
    .venv/bin/python scripts/feature2_smoke.py --no-companion   # check 3 inserts one action item directly
    .venv/bin/python scripts/feature2_smoke.py --base-url http://127.0.0.1:8000 --db data/app.db

Checks (from the build brief):
 1. diagnose Meera → top two are Normalization and B+ trees, each impact >= 60 with a past-papers citation
 2. build Meera's plan → >= 6 blocks in the next 3 weeks; none overlaps a class, quiz or exam; every CS F212
    block before the CS F212 end-sem; every why has a mark fraction and a marks range; every
    syllabusSectionId verifies
 3. GET /calendar/meera shows classes, exams and study blocks together; an accepted companion action sits
    on the same day as a study block without overlap
 4. simulate week → current 1:1 has blocksDone, blocksMissed > 0, a concern naming a missed topic, >= 2
    questions; answer one, complete with shareWithAdvisor → adjustedPlan moves the missed topics into the
    next week, calendar updated, a ticket in the advisor inbox
 5. /chat "What should I study this week?" → build_study_plan, >= 2 verified citations, a study_plan card
 6. /chat "Can I get a fee extension for a medical issue?" → escalate, ticket created, no policy claims
 7. /chat "When is the DBMS end-sem?" → answer_from_docs, cites exam_calendar, the right date
 8. /chat with courseCode CS F212 → the class thread, only CS F212 blocks and citations; another course's
    question → "ask me in my DM"
 9. POST /relevant (weak topic) → RelevantCard with resolvable citations; GET /relevant history; bad topic → 404
"""
from __future__ import annotations

import argparse
import json
import os
import re
import socket
import sqlite3
import subprocess
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

BACKEND = Path(__file__).resolve().parents[1]
DATA = BACKEND / "app" / "data"
STUDENT = "meera"
TZ = ZoneInfo("Asia/Kolkata")
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
LECTURE = DATA / "lectures" / "cs-f212-2026-09-22-transactions.md"

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f": {detail}" if detail else ""), flush=True)
    return ok


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip().casefold()


def dt(value: str) -> datetime:
    if len(value) == 10:
        return datetime.fromisoformat(value).replace(tzinfo=TZ)
    v = datetime.fromisoformat(value)
    return v if v.tzinfo else v.replace(tzinfo=TZ)


def overlaps(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


# ---- server ------------------------------------------------------------------------------

class Server:
    def __init__(self, base_url: str | None, db_path: str):
        self.proc = None
        self.db_path = db_path
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
        for _ in range(80):
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


# ---- independent expectations from the dataset files ------------------------------------------

def registered() -> set[str]:
    s = json.loads((DATA / "students" / f"{STUDENT}.json").read_text())
    regs = s.get("registrations") or s.get("records", {}).get("registrations")
    return {r["courseCode"] for r in regs["rows"] if r.get("status", "registered") == "registered"}


def class_intervals(day: date) -> list[tuple[datetime, datetime, str]]:
    tt = json.loads((DATA / "timetable.json").read_text())
    rows = tt.get("rows") or tt.get("sessions") or []
    out = []
    for r in rows:
        if r["courseCode"] in registered() and DAYS.index(r["day"].lower()[:3]) == day.weekday():
            h1, m1 = map(int, r["start"].split(":"))
            h2, m2 = map(int, r["end"].split(":"))
            out.append((datetime(day.year, day.month, day.day, h1, m1, tzinfo=TZ),
                        datetime(day.year, day.month, day.day, h2, m2, tzinfo=TZ), r["courseCode"]))
    return out


def exam_days() -> dict[date, list[str]]:
    cal = json.loads((DATA / "exam_calendar.json").read_text())
    out: dict[date, list[str]] = {}
    for c in cal["courses"]:
        if c["courseCode"] not in registered():
            continue
        for label, d in [("Mid-sem", c.get("midSemDate")), ("End-sem", c.get("endSemDate"))] + \
                        [(f"Quiz {n}", q) for n, q in enumerate(c.get("quizDates") or [], 1)]:
            if d:
                out.setdefault(date.fromisoformat(d), []).append(f"{c['courseCode']} {label}")
    return out


def end_sem(course: str) -> date:
    cal = json.loads((DATA / "exam_calendar.json").read_text())
    return date.fromisoformat(next(c["endSemDate"] for c in cal["courses"] if c["courseCode"] == course))


def syllabus_ids() -> dict[str, str]:
    """section id → topic title, parsed straight from syllabus/*.md (## Unit N / ### Topic)."""
    out = {}
    for path in (DATA / "syllabus").glob("*.md"):
        text = path.read_text()
        code = re.search(r"^courseCode:\s*(.+)$", text, re.M).group(1).strip()
        slug = re.sub(r"[^a-z0-9]+", "-", code.lower()).strip("-")
        unit, k = None, 0
        for line in text.splitlines():
            m = re.match(r"^## Unit (\d+)", line)
            if m:
                unit, k = m.group(1), 0
            elif line.startswith("### ") and unit:
                k += 1
                out[f"syllabus.{slug}.{unit}.{k}"] = line[4:].strip()
    return out


def past_paper_marks(course: str, topic: str) -> dict[int, int]:
    pp = json.loads((DATA / "past_papers.json").read_text())
    c = next(c for c in pp["courses"] if c["courseCode"] == course)
    return {p["year"]: p["topicMarks"][topic] for p in c["papers"] if topic in p["topicMarks"]}


# ---- checks -------------------------------------------------------------------------------------

def check_diagnose(client: httpx.Client) -> None:
    print("\n== 1. diagnose", flush=True)
    r = client.post(f"/students/{STUDENT}/diagnose")
    if not check("1a POST /students/meera/diagnose", r.status_code == 200, f"{r.status_code} {r.text[:200]}"):
        return
    items = r.json()["items"]  # contracts v3.8: the bare WeakTopicsCard
    top = [(i["course"], i["topic"], i["impact"], i["citationId"]) for i in items[:3]]
    check("1b top two are Normalization and B+ trees", [i["topic"] for i in items[:2]] == ["Normalization", "B+ trees"],
          f"top3={top}")
    check("1c each impact >= 60", all(i["impact"] >= 60 for i in items[:2]), f"{[i['impact'] for i in items[:2]]}")
    ok, shown = True, []
    for i in items[:2]:
        sec = client.get(f"/documents/past_papers/sections/{i['citationId']}")
        text = sec.json().get("text", "") if sec.status_code == 200 else ""
        truth = past_paper_marks(i["course"], i["topic"])
        quoted = {int(y): int(m) for m, y in re.findall(r"(\d+) marks in the (\d{4})", text)}
        ok &= i["citationId"].startswith("past_papers.") and quoted == truth
        shown.append((i["citationId"], text[:90]))
    check("1d each has a past-papers citation whose section's marks match past_papers.json", ok, f"{shown}")


def check_plan(client: httpx.Client) -> list[dict]:
    print("\n== 2. build plan", flush=True)
    t0 = time.perf_counter()
    r = client.post(f"/students/{STUDENT}/plan", timeout=240)
    if not check("2a POST /students/meera/plan", r.status_code == 200, f"{r.status_code} {r.text[:300]}"):
        return []
    card = r.json()  # contracts v3.8: the bare StudyPlanCard
    print(f"     ({time.perf_counter() - t0:.1f}s) {sum(len(w['blocks']) for w in card['weeks'])} blocks in "
          f"{len(card['weeks'])} weeks", flush=True)
    blocks = {b["id"]: b for w in card["weeks"] for b in w["blocks"]}
    today = datetime.now(TZ)
    cal = client.get(f"/calendar/{STUDENT}", params={"from": today.date().isoformat(),
                                                     "to": date(2026, 12, 11).isoformat()}).json()
    study = [i for i in cal if i["source"]["type"] == "plan_block" and i["source"]["planBlockId"] in blocks]
    in3 = [i for i in study if dt(i["start"]) < today + timedelta(days=21)]
    check("2b >= 6 blocks in the next 3 weeks", len(in3) >= 6, f"{len(in3)} of {len(study)} blocks")
    exams = exam_days()
    bad = []
    for i in study:
        s, e = dt(i["start"]), dt(i["end"])
        for cs, ce, code in class_intervals(s.date()):
            if overlaps((s, e), (cs, ce)):
                bad.append(f"{i['title']} {s:%a %d %b %H:%M} over {code} class")
        if s.date() in exams:
            bad.append(f"{i['title']} {s:%a %d %b} on {exams[s.date()]}")
    check("2c no block overlaps a class, quiz or exam (timetable.json, exam_calendar.json)", not bad,
          f"{len(study)} blocks checked; {bad[:4]}")
    f212_end = end_sem("CS F212")
    late = [f"{i['title']} {i['start'][:10]}" for i in study if i["courseCode"] == "CS F212" and dt(i["start"]).date() >= f212_end]
    check(f"2d every CS F212 block before the CS F212 end-sem ({f212_end})", not late and any(
        i["courseCode"] == "CS F212" for i in study), f"late={late[:3]}")
    mine = [blocks[i["source"]["planBlockId"]] for i in study]
    no_fact = [b["why"] for b in mine if not (re.search(r"\b\d+/\d+\b", b["why"])
                                               and re.search(r"\d+\s*[–-]\s*\d+ marks", b["why"]))]
    check("2e every block's why has a mark fraction and a marks range", not no_fact and bool(mine),
          f"e.g. {mine[0]['why'] if mine else None!r}; failing={no_fact[:2]}")
    ids = syllabus_ids()
    unverified = [(b["topic"], b.get("citationId")) for b in mine
                  if b.get("citationId") not in ids or norm(ids[b["citationId"]]) != norm(b["topic"])]
    check("2f every syllabusSectionId verifies against syllabus/*.md and names the block's topic", not unverified,
          f"{len({b['citationId'] for b in mine})} distinct ids; bad={unverified[:3]}")
    return study


def _companion_action(client: httpx.Client) -> tuple[dict | None, str]:
    r = client.post("/lectures", json={"studentId": STUDENT, "courseCode": "CS F212", "date": "2026-09-22",
                                       "title": "Transactions, schedules and serializability",
                                       "transcriptText": LECTURE.read_text()})
    if r.status_code != 200:
        return None, f"POST /lectures {r.status_code} {r.text[:120]}"
    lec_id = r.json()["id"]
    lec = client.post(f"/lectures/{lec_id}/process").json()
    t0 = time.perf_counter()
    while lec.get("status") not in ("ready", "failed") and time.perf_counter() - t0 < 240:
        time.sleep(1.5)
        lec = client.get(f"/lectures/{lec_id}").json()
    if lec.get("status") != "ready":
        return None, f"lecture {lec.get('status')}: {lec.get('error')}"
    items = client.get(f"/lectures/{lec_id}/cards").json()["actions"]["items"]
    pick = next((a for a in items if a["kind"] == "study"), None) or next(
        (a for a in items if a["kind"] in ("review", "prep")), None)
    if pick is None:
        return None, "companion proposed no study/review/prep action"
    acc = client.post(f"/actions/{pick['id']}", json={"status": "accepted"})
    if acc.status_code != 200:
        return None, f"accept {acc.status_code} {acc.text[:160]}"
    return acc.json(), f"companion ready in {time.perf_counter() - t0:.0f}s; accepted {pick['kind']} '{pick['title']}'"


def _insert_action(db_path: str, study: list[dict]) -> tuple[dict | None, str]:
    """Fallback: write what accepting a class-companion action writes (the accepted action, its plan
    block in StudentState.plan, its block_slot and its calendar item), at a free evening slot on a
    study-block day. Mirrors tools/companion._accept, so the planner and the 1:1 see a real action."""
    course, topic = "CS F212", "Two-phase locking"
    section = next(sid for sid, title in syllabus_ids().items()
                   if sid.startswith("syllabus.cs-f212.") and norm(title) == norm(topic))
    for anchor in sorted(study, key=lambda i: i["start"]):
        day = dt(anchor["start"]).date()
        taken = [(dt(i["start"]), dt(i["end"])) for i in study if dt(i["start"]).date() == day]
        taken += [(s, e) for s, e, _ in class_intervals(day)]
        t = datetime(day.year, day.month, day.day, 18, 0, tzinfo=TZ)
        while t.hour < 22:
            slot = (t, t + timedelta(minutes=45))
            if any(overlaps(slot, x) for x in taken):
                t += timedelta(minutes=15)
                continue
            start, end = (x.isoformat(timespec="seconds") for x in slot)
            why = "Not taught in the CS F212 lecture of 22 Sep (smoke-test fixture)"
            action = {"id": "act_smoke", "lectureId": "lec_smoke", "kind": "study", "title": f"Self-study: {topic}",
                      "course": course, "topic": topic, "minutes": 45, "why": why,
                      "provenance": {"syllabusSectionId": section}, "status": "accepted",
                      "planBlockId": "pb_smoke_action", "calendarItemId": "cal_smoke_action"}
            item = {"id": "cal_smoke_action", "studentId": STUDENT, "kind": "action", "title": action["title"],
                    "courseCode": course, "start": start, "end": end,
                    "source": {"type": "action", "actionId": "act_smoke", "lectureId": "lec_smoke"},
                    "status": "planned"}
            block = {"id": "pb_smoke_action", "course": course, "topic": topic, "minutes": 45, "why": why,
                     "citationId": section}
            monday = day - timedelta(days=day.weekday())
            label = f"Week of {monday:%b} {monday.day}"
            now = datetime.now().isoformat()
            with sqlite3.connect(db_path) as conn:
                row = conn.execute("SELECT body FROM docs WHERE kind='state' AND id=?", (STUDENT,)).fetchone()
                state = json.loads(row[0]) if row else {"studentId": STUDENT}
                weeks = state.setdefault("plan", {"type": "study_plan", "weeks": []})["weeks"]
                week = next((w for w in weeks if w["label"] == label), None)
                if week is None:
                    week = {"label": label, "blocks": []}
                    weeks.append(week)
                week["blocks"].append(block)
                for kind, doc_id, parent, body in [("state", STUDENT, None, state),
                                                   ("action", "act_smoke", "lec_smoke", action),
                                                   ("block_slot", "pb_smoke_action", None, {"start": start, "end": end}),
                                                   ("calendar_item", "cal_smoke_action", "act_smoke", item)]:
                    conn.execute("INSERT OR REPLACE INTO docs (kind, id, student_id, parent_id, created_at, "
                                 "updated_at, body) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                 (kind, doc_id, STUDENT, parent, now, now, json.dumps(body)))
            return ({"calendarItemId": "cal_smoke_action", "planBlockId": "pb_smoke_action"},
                    "wrote one accepted action directly (action, plan block, slot, calendar item; companion not used)")
    return None, "no free evening slot on any study-block day"


def check_calendar(client: httpx.Client, server: Server, study: list[dict], use_companion: bool) -> None:
    print("\n== 3. merged calendar + accepted action", flush=True)
    how = ""
    action = None
    if use_companion:
        action, how = _companion_action(client)
        if action is None:
            print(f"     companion path unavailable ({how}); falling back to a direct insert", flush=True)
    if action is None:
        action, how2 = _insert_action(server.db_path, study)
        how = f"{how}; {how2}" if how else how2
    today = datetime.now(TZ)
    cal = client.get(f"/calendar/{STUDENT}", params={"from": today.date().isoformat(),
                                                     "to": date(2026, 12, 11).isoformat()}).json()
    kinds = {i["kind"] for i in cal}
    check("3a calendar shows classes, exams/quizzes and study blocks together",
          {"class", "study_block"} <= kinds and bool(kinds & {"exam", "quiz"}) and "exam" in kinds,
          f"kinds={sorted(kinds)}, {len(cal)} items")
    sources = {i["source"]["type"] for i in cal}
    check("3b every item has a source (timetable | exam_calendar | plan_block | action)",
          all(i.get("source", {}).get("type") in ("timetable", "exam_calendar", "plan_block", "action") for i in cal),
          f"sources={sorted(sources)}")
    if not check("3c accepted action is on the calendar", action is not None, how):
        return
    item = next((i for i in cal if i["id"] == action.get("calendarItemId")), None)
    if not check("3d action item merged with source.type = action", bool(item) and item["source"]["type"] == "action",
                 f"{item and (item['kind'], item['start'], item['title'])}; {how}"):
        return
    if item.get("allDay") or not item.get("end"):
        slot = next((i for i in cal if i["source"]["type"] == "plan_block" and i["source"]["planBlockId"] ==
                     action.get("planBlockId")), None)
        item = slot or item
    s, e = dt(item["start"]), dt(item["end"]) if item.get("end") else dt(item["start"]) + timedelta(days=1)
    same_day = [i for i in cal if i["kind"] == "study_block" and i["source"]["type"] == "plan_block"
                and dt(i["start"]).date() == s.date() and i["id"] != item["id"]]
    clash = [i["title"] for i in cal if i["id"] != item["id"] and i.get("end") and not i.get("allDay")
             and overlaps((s, e), (dt(i["start"]), dt(i["end"])))]
    check("3e action sits on the same day as a study block, overlapping nothing",
          bool(same_day) and not clash,
          f"action {s:%a %d %b %H:%M}-{e:%H:%M}; study blocks that day="
          f"{[dt(i['start']).strftime('%H:%M') for i in same_day]}; clashes={clash}")


def check_one_on_one(client: httpx.Client) -> None:
    print("\n== 4. simulate week → weekly 1:1", flush=True)
    sim = client.post(f"/demo/simulate-week/{STUDENT}")
    if not check("4a POST /demo/simulate-week/meera", sim.status_code == 200, f"{sim.status_code} {sim.text[:200]}"):
        return
    sim = sim.json()
    print(f"     updated {sim.get('updated')} ({sim['done']} done / {sim['missed']} missed); clock now "
          f"{sim['clockNow']}", flush=True)
    check("4a' simulate-week returns {updated, clockNow}", isinstance(sim.get("updated"), int) and sim["updated"] > 0
          and bool(sim.get("clockNow")), f"updated={sim.get('updated')} clockNow={sim.get('clockNow')}")
    r = client.get(f"/one-on-one/{STUDENT}/current", timeout=120)
    if not check("4b GET /one-on-one/meera/current", r.status_code == 200, f"{r.status_code} {r.text[:200]}"):
        return
    one = r.json()
    rec = one["recap"]
    contract = {"plannedMinutes", "doneMinutes", "blocksPlanned", "blocksDone", "completedTopics", "skippedTopics",
                "weakTopicMovement", "flaggedTopics", "blocksMissed", "prepMet", "prepMissed", "window", "streakDays"}
    check("4b' recap has the v3.8 fields (window {from,to}, flaggedTopics; movement items {topic,from,to})",
          contract <= set(rec) and set(rec["window"]) == {"from", "to"} and
          all(set(m) == {"topic", "from", "to"} for m in rec["weakTopicMovement"]),
          f"missing={sorted(contract - set(rec))}; extra={sorted(set(rec) - contract - {'movementNote'})}")
    check("4c recap has blocksDone and blocksMissed > 0", rec["blocksDone"] > 0 and rec.get("blocksMissed", 0) > 0,
          f"planned={rec['blocksPlanned']} done={rec['blocksDone']} missed={rec.get('blocksMissed')} "
          f"minutes={rec['doneMinutes']}/{rec['plannedMinutes']} streak={rec['streakDays']}")
    skipped = rec["skippedTopics"]
    naming = [c for c in one["concerns"] if any(norm(t) in norm(c) for t in skipped)]
    check("4d a concern names a missed topic", bool(naming), f"skipped={skipped}; concerns={one['concerns']}")
    check("4e >= 2 questions", len(one["questions"]) >= 2, f"{[q['prompt'] for q in one['questions']]}")
    if not one["questions"]:
        return
    q = one["questions"][0]
    a = client.post(f"/one-on-one/{one['id']}/answer",
                    json={"questionId": q["id"], "answer": "Badminton practice ran late twice, so I pushed "
                                                           "those blocks. Earlier slots would work better."})
    check("4f answer stored", a.status_code == 200 and a.json()["questions"][0].get("answer") and
          a.json()["status"] == "in_progress", f"{a.status_code} {a.text[:160]}")
    before_items = {i["id"] for i in client.get(f"/calendar/{STUDENT}", params={
        "from": sim["clockNow"][:10], "to": (dt(sim["clockNow"]) + timedelta(days=14)).date().isoformat()}).json()
        if i["source"]["type"] == "plan_block"}
    t0 = time.perf_counter()
    c = client.post(f"/one-on-one/{one['id']}/complete", json={"shareWithAdvisor": True}, timeout=240)
    if not check("4g complete with shareWithAdvisor → status done + adjustedPlan",
                 c.status_code == 200 and c.json()["status"] == "done" and bool(c.json().get("adjustedPlan")),
                 f"{c.status_code} {c.text[:200]} ({time.perf_counter() - t0:.0f}s)"):
        return
    done = c.json()
    adj_ids = {b["id"]: b for w in done["adjustedPlan"]["weeks"] for b in w["blocks"]}
    now = dt(sim["clockNow"])
    cal = client.get(f"/calendar/{STUDENT}", params={"from": now.date().isoformat(),
                                                     "to": (now + timedelta(days=14)).date().isoformat()}).json()
    next_week = [i for i in cal if i["source"]["type"] == "plan_block" and i["source"]["planBlockId"] in adj_ids
                 and now <= dt(i["start"]) < now + timedelta(days=7)]
    topics = {norm(adj_ids[i["source"]["planBlockId"]]["topic"]) for i in next_week}
    moved = [t for t in skipped if norm(t) in topics]
    check("4h adjustedPlan moves the missed topics into the next week", moved and len(moved) == len(skipped),
          f"missed={skipped}; in the 7 days from {now:%a %d %b}: {sorted(topics)}")
    after_items = {i["id"] for i in cal if i["source"]["type"] == "plan_block"}
    check("4i calendar updated (future plan items replaced by the adjusted plan's)",
          bool(after_items) and after_items != before_items and all(
              i["source"]["planBlockId"] in adj_ids for i in cal if i["id"] in after_items - before_items),
          f"{len(before_items)} → {len(after_items)} plan items in the next 14 days")
    inbox = client.get("/advisor/inbox").json()
    tick = [t for t in inbox if t["studentId"] == STUDENT and "1:1" in t["question"]]
    check("4j a ticket with the recap is in the advisor inbox", bool(tick) and str(rec["blocksPlanned"]) in
          tick[0]["agentSummary"], f"{tick[0]['ticketId'] + ': ' + tick[0]['agentSummary'][:140] if tick else inbox[:1]}")


def chat(client: httpx.Client, text: str) -> dict:
    r = client.post("/chat", json={"studentId": STUDENT, "agentId": "academic_coach", "text": text}, timeout=240)
    r.raise_for_status()
    msgs = r.json()
    return msgs[-1]


def routed(msg: dict) -> str | None:
    t = next((t for t in msg["trace"] if t["tool"] == "academic_coach.route"), None)
    m = re.match(r"route → (\w+)", t["summary"]) if t else None
    return m.group(1) if m else None


def verify_citations(client: httpx.Client, msg: dict) -> list[str]:
    """Each citation's quote must be verbatim in the section the documents endpoint serves."""
    bad = []
    for c in msg["citations"]:
        r = client.get(f"/documents/{c['docId']}/sections/{c['sectionId']}")
        if r.status_code != 200 or norm(c["quote"]) not in norm(r.json()["text"]):
            bad.append(c["id"])
    return bad


def check_chat(client: httpx.Client) -> None:
    print("\n== 5-7. /chat academic_coach", flush=True)
    t0 = time.perf_counter()
    m = chat(client, "What should I study this week?")
    bad = verify_citations(client, m)
    print(f"     ({time.perf_counter() - t0:.0f}s) {m['text'][:220]}", flush=True)
    check("5a route = build_study_plan", routed(m) == "build_study_plan", f"route={routed(m)}")
    check("5b reply has >= 2 verified citations", m["role"] == "agent" and len(m["citations"]) >= 2 and not bad,
          f"{len(m['citations'])} citations {[c['sectionId'] for c in m['citations']]}; unverified={bad}")
    check("5c cards contain a study_plan", any(c["type"] == "study_plan" for c in m["cards"]),
          f"{[c['type'] for c in m['cards']]}")

    t0 = time.perf_counter()
    m = chat(client, "Can I get a fee extension for a medical issue?")
    print(f"     ({time.perf_counter() - t0:.0f}s) {m['text'][:220]}", flush=True)
    check("6a route = escalate", routed(m) == "escalate", f"route={routed(m)}")
    esc = m.get("escalation") or {}
    inbox = client.get("/advisor/inbox").json()
    tick = next((t for t in inbox if t["ticketId"] == esc.get("ticketId")), None)
    check("6b ticket created and in the advisor inbox", bool(tick) and "fee extension" in norm(tick["question"]),
          f"escalation={esc}; ticket={tick and tick['question']}")
    digits = [n for n in re.findall(r"\d+", m["text"]) if n not in (esc.get("ticketId") or "")]
    rule = re.compile(r"(allowed|permitted|eligible|entitled|policy (says|states|allows)|within \w+ days|"
                      r"deadline is|fee is|extensions? (is|are) (granted|allowed|available|possible))", re.I)
    # a claim is asserted, not embedded in "don't cover whether/if …" or "can't confirm …"
    claims = [x.group(0) for x in rule.finditer(m["text"])
              if not re.search(r"(whether|\bif\b|cover|confirm)", m["text"][max(0, x.start() - 60):x.start()], re.I)]
    check("6c reply makes no policy claims (no citations, no numbers but the ticket id, no rule language)",
          not m["citations"] and not digits and not claims, f"digits={digits}; claims={claims}")

    t0 = time.perf_counter()
    m = chat(client, "When is the DBMS end-sem?")
    print(f"     ({time.perf_counter() - t0:.0f}s) {m['text'][:220]}", flush=True)
    check("7a route = answer_from_docs", routed(m) == "answer_from_docs", f"route={routed(m)}")
    bad = verify_citations(client, m)
    check("7b cites exam_calendar (verified)", any(c["docId"] == "exam_calendar" for c in m["citations"]) and not bad,
          f"{[(c['id'], c['sectionId']) for c in m['citations']]}; unverified={bad}")
    d = end_sem("CS F212")
    forms = [d.isoformat(), f"{d.day} {d:%b}", f"{d:%b} {d.day}", f"{d.day} {d:%B}", f"{d:%B} {d.day}",
             f"{d.day}/{d.month}"]
    check(f"7c answer is correct ({d:%a %d %b %Y}, from exam_calendar.json)",
          any(norm(f) in norm(m["text"]) for f in forms), m["text"][:200])


def check_class_chat(client: httpx.Client) -> None:
    print("\n== 8. /chat in a class channel (courseCode = CS F212)", flush=True)
    r = client.post("/chat", json={"studentId": STUDENT, "agentId": "academic_coach", "courseCode": "CS F212",
                                   "text": "What should I study this week?"}, timeout=240)
    if not check("8a class chat answers", r.status_code == 200, f"{r.status_code} {r.text[:160]}"):
        return
    m = r.json()[-1]
    plan = next((c for c in m["cards"] if c["type"] == "study_plan"), None)
    courses = {b["course"] for w in (plan or {}).get("weeks", []) for b in w["blocks"]}
    outside = [c["sectionId"] for c in m["citations"] if not re.match(r"^(syllabus|past_papers|exam_calendar|catalog)"
                                                                      r"\.cs-f212(\.|$)", c["sectionId"])]
    check("8b thread is <sid>:class:<courseCode>, route build_study_plan", m["threadId"] == f"{STUDENT}:class:CS F212"
          and (routed(m) or "").startswith("build_study_plan"), f"thread={m['threadId']} route={routed(m)}")
    check("8c plan card and every citation stay inside CS F212", courses == {"CS F212"} and m["citations"]
          and not outside, f"plan courses={sorted(courses)}; {len(m['citations'])} citations; outside={outside}")
    r = client.post("/chat", json={"studentId": STUDENT, "agentId": "academic_coach", "courseCode": "CS F212",
                                   "text": "When is the Operating Systems end-sem?"}, timeout=120)
    m = r.json()[-1]
    check("8d another course's question → 'ask me in my DM', nothing cited",
          (routed(m) or "") == "redirect_to_dm" and "DM" in m["text"] and not m["citations"],
          f"route={routed(m)}; {m['text'][:120]}")


def check_relevant(client: httpx.Client) -> None:
    print("\n== 9. Make it Relevant", flush=True)
    r = client.post("/relevant", json={"studentId": STUDENT, "source": {"type": "weak_topic", "course": "CS F212",
                                                                        "topic": "Normalization"}}, timeout=120)
    card = r.json()
    fields = {"type", "concept", "course", "interest", "standard", "reframed", "citationIds", "source"}
    ok = r.status_code == 200 and set(card) == fields and card["interest"] == "badminton"
    unresolved = [c for c in card.get("citationIds", [])
                  if client.get(f"/documents/{c.split('.')[0] if c.startswith('past_papers') else c.rsplit('.', 2)[0]}"
                                f"/sections/{c}").status_code != 200]
    check("9a POST /relevant (weak topic) → RelevantCard, interest defaults to the first, citations resolve",
          ok and bool(card.get("citationIds")) and not unresolved,
          f"{r.status_code} keys={sorted(card)} interest={card.get('interest')} cites={card.get('citationIds')} "
          f"unresolved={unresolved}")
    hist = client.get(f"/relevant/{STUDENT}").json()
    check("9b GET /relevant/:id has it", any(h.get("concept") == "Normalization" for h in hist), f"{len(hist)} cards")
    bad = client.post("/relevant", json={"studentId": STUDENT, "source": {"type": "weak_topic", "course": "CS F212",
                                                                          "topic": "Quantum widgets"}})
    check("9c a topic outside the syllabus → 404, no card", bad.status_code == 404, f"{bad.status_code} {bad.text[:100]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--db", help="SQLite path of the --base-url server (needed for the direct-insert fallback)")
    ap.add_argument("--no-companion", action="store_true", help="check 3: insert the action item directly")
    args = ap.parse_args()
    tmp = Path(tempfile.mkdtemp(prefix="feature2_smoke_"))
    db = args.db or (str(BACKEND / "data" / "app.db") if args.base_url else str(tmp / "smoke.db"))
    print(f"artifacts: {tmp}")
    server = Server(args.base_url, db)
    try:
        client = httpx.Client(base_url=server.url, timeout=60)
        check_diagnose(client)
        study = check_plan(client)
        check_calendar(client, server, study, use_companion=not args.no_companion)
        check_one_on_one(client)
        check_chat(client)
        check_class_chat(client)
        check_relevant(client)
    finally:
        server.stop()
    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed" + (f"; FAILED: {failed}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
