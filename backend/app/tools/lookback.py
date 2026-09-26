"""Weekly 1:1 (contracts §7; the Academic Coach's weekly_review tool).

Recap is code: the last 7 days of the student's calendar (plan blocks and accepted actions
with their done/missed status) → minutes, blocks done/missed, prep met/missed, completed and
skipped topics, streak, and weak-topic impact before (at plan time) vs after (re-run
diagnose). One LLM call (prompts/lookback.md) turns the recap into wins, concerns, 2–3
questions and proposed adjustments; every line must reference a topic or number from the
recap and may state no number that isn't in it, or it is rejected. Completing the 1:1
re-runs tools/plan.py with the answers, the adjustments and the missed topics as
carry-over, and optionally shares the recap with an advisor as a ticket.

Built 26 Sep 2026 (Feature 2).
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from app import escalation
from app.core import clock, db, llm
from app.core.academics import exams, iso
from app.core.config import PROMPTS_DIR, TZ
from app.core.models import (FlaggedTopic, OneOnOne, OneOnOneAdjustment, OneOnOneQuestion, OneOnOneRecap,
                             RecapWindow, TopicMovement)
from app.core.parser import fmt_day
from app.core.records import load_records, load_student, registered_courses
from app.core.state import get_state
from app.core.syllabus import course_slug
from app.tools import calendar as cal
from app.tools import diagnose as dx
from app.tools import plan as planner
from app.tools.base import Stopwatch, ToolResult, trace

TOOL = "weekly_review"
AGENT_ID = "academic_coach"
STUDY = ("study_block", "action", "prep")
NUM = re.compile(r"\d+(?:\.\d+)?")


@lru_cache(maxsize=1)
def _system_prompt() -> str:
    return (PROMPTS_DIR / "lookback.md").read_text(encoding="utf-8")


class _Question(BaseModel):
    prompt: str


class _Adjustment(BaseModel):
    blockId: Optional[str] = None
    change: Literal["add", "move", "drop", "resize"]
    detail: str


class _Review(BaseModel):
    wins: list[str] = Field(default_factory=list)
    concerns: list[str] = Field(default_factory=list)
    questions: list[_Question] = Field(default_factory=list)
    proposedAdjustments: list[_Adjustment] = Field(default_factory=list)


def _parse(value: str | None) -> datetime | None:
    return cal.parse_iso(value)


def _minutes(item: dict[str, Any]) -> int:
    s, e = _parse(item.get("start")), _parse(item.get("end"))
    return int((e - s).total_seconds() // 60) if s and e else 0


def _item_topic(student_id: str, item: dict[str, Any]) -> tuple[str, str]:
    src = item.get("source") or {}
    if src.get("type") == "plan_block":
        block = db.get("plan_block", src.get("planBlockId", "")) or next(
            (b for w in (get_state(student_id).get("plan") or {}).get("weeks", []) for b in w.get("blocks", [])
             if b.get("id") == src.get("planBlockId")), {})
        if block:
            return block.get("topic", ""), block.get("course", item.get("courseCode", ""))
    if src.get("type") == "action":
        action = db.get("action", src.get("actionId", "")) or {}
        if action:
            return action.get("topic", ""), action.get("course", item.get("courseCode", ""))
    return item.get("title", "").removeprefix("Study: "), item.get("courseCode", "")


# ---------------------------------------------------------------------------------
# recap (code)
# ---------------------------------------------------------------------------------

def flagged_topics(student_id: str, until: datetime) -> list[FlaggedTopic]:
    """Stuck markers ("I'm stuck here" taps, stored by the class companion) by topic, flagged since the
    previous 1:1's window closed and before ``until``. A weekly review covers everything since the last
    review; a strict 7-day cut would drop flags made in class just before a simulated week."""
    since = max((o["recap"].get("window", {}).get("to", "") for o in db.find("one_on_one", student_id=student_id)
                 if o.get("recap", {}).get("window", {}).get("to", "") < iso(until)), default="")
    counts: dict[str, int] = {}
    for m in sorted(db.find("marker", student_id=student_id), key=lambda m: m.get("createdAt", "")):
        at = _parse(m.get("createdAt"))
        if not m.get("topic") or at is None or at >= until or (since and at < _parse(since)):
            continue
        counts[m["topic"]] = counts.get(m["topic"], 0) + 1
    return [FlaggedTopic(topic=t, times=n) for t, n in sorted(counts.items(), key=lambda kv: -kv[1])]


def recap(student_id: str, start: datetime, end: datetime) -> tuple[OneOnOneRecap, dict[str, Any]]:
    items = cal.build_calendar(student_id, start, end)
    mine = [i for i in items if (i.get("source") or {}).get("type") in ("plan_block", "action")]
    study = [i for i in mine if i["kind"] in STUDY and i.get("end")]
    prep = [i for i in mine if i["kind"] in ("prep", "deadline")]
    rows = []
    for i in sorted(study, key=lambda x: x["start"]):
        topic, course = _item_topic(student_id, i)
        rows.append({"id": i["id"], "blockId": (i.get("source") or {}).get("planBlockId") or i["id"],
                     "topic": topic, "course": course, "minutes": _minutes(i), "status": i.get("status") or "planned",
                     "start": i["start"], "kind": i["kind"]})
    done = [r for r in rows if r["status"] == "done"]
    missed = [r for r in rows if r["status"] == "missed"]
    completed = list(dict.fromkeys(r["topic"] for r in done))
    skipped = list(dict.fromkeys(r["topic"] for r in missed))

    # streak: consecutive days, back from the window's last day, with at least one done block;
    # a day with nothing scheduled neither extends nor breaks it
    by_day: dict[date, list[str]] = {}
    for r in rows:
        by_day.setdefault(_parse(r["start"]).date(), []).append(r["status"])
    streak = 0
    day = (end - timedelta(seconds=1)).date()
    while day >= start.date():
        statuses = by_day.get(day)
        if statuses:
            if "done" not in statuses:
                break
            streak += 1
        day -= timedelta(days=1)

    meta = db.get("plan_meta", student_id) or {}
    before = {(course_slug(x["course"]), x["topic"]): x for x in meta.get("impacts", [])}
    stats, _ = dx.compute(student_id)
    after = {(course_slug(s.course), s.topic): s for s in stats}
    focus = list(dict.fromkeys([(course_slug(r["course"]), r["topic"]) for r in rows] +
                               [(course_slug(s.course), s.topic) for s in stats[:3]]))
    movement = [TopicMovement.model_validate({"topic": k[1], "from": before[k]["impact"],
                                              "to": after[k].impact if k in after else 0})
                for k in focus if k in before]
    note = None
    if movement and all(m.from_ == m.to for m in movement):
        marks = load_records(student_id)["internalMarks"].get("rows") or []
        latest = max((r.get("date", "") for r in marks), default="")
        built = meta.get("builtAt", "")[:10]
        note = (f"No new internal marks since the plan was built on {fmt_day(date.fromisoformat(built))} "
                f"(latest marks dated {fmt_day(date.fromisoformat(latest))}), so impact did not move."
                if built and latest and latest <= built else "Impact did not move this week.")
    rec = OneOnOneRecap(
        plannedMinutes=sum(r["minutes"] for r in rows), doneMinutes=sum(r["minutes"] for r in done),
        blocksPlanned=len(rows), blocksDone=len(done), blocksMissed=len(missed),
        completedTopics=completed, skippedTopics=skipped, weakTopicMovement=movement, streakDays=streak,
        prepMet=sum(1 for i in prep if i.get("status") == "done"),
        prepMissed=sum(1 for i in prep if i.get("status") == "missed"),
        movementNote=note, flaggedTopics=flagged_topics(student_id, end),
        window=RecapWindow.model_validate({"from": iso(start), "to": iso(end)}))
    return rec, {"rows": rows, "after": after}


# ---------------------------------------------------------------------------------
# reflection (LLM) with grounding checks
# ---------------------------------------------------------------------------------

def _facts(student: dict[str, Any], rec: OneOnOneRecap, details: dict[str, Any], now: datetime) -> tuple[str, list[str]]:
    rows = details["rows"]
    after = details["after"]
    lines = [f"Student: {student.get('name')}. Review window: {fmt_day(_parse(rec.window.from_).date())} – "
             f"{fmt_day((_parse(rec.window.to) - timedelta(seconds=1)).date())}.",
             f"RECAP: planned {rec.plannedMinutes} min in {rec.blocksPlanned} blocks; done {rec.doneMinutes} min in "
             f"{rec.blocksDone} blocks; missed {rec.blocksMissed} blocks; prep items met {rec.prepMet}, missed "
             f"{rec.prepMissed}; streak {rec.streakDays} days."]
    topics: list[str] = []
    lines.append("BY TOPIC:")
    for t in dict.fromkeys(r["topic"] for r in rows):
        rs = [r for r in rows if r["topic"] == t]
        d = [r for r in rs if r["status"] == "done"]
        m = [r for r in rs if r["status"] == "missed"]
        course = rs[0]["course"]
        stat = after.get((course_slug(course), t))
        extra = f"; impact {stat.impact}, {stat.marks_fact()}, {stat.weight_fact()}" if stat else ""
        missed_on = ", ".join(f"{_parse(r['start']):%a %d %b}" for r in m)
        lines.append(f"- {t} ({course}): {len(d)} done ({sum(r['minutes'] for r in d)} min), {len(m)} missed "
                     f"({sum(r['minutes'] for r in m)} min){' on ' + missed_on if missed_on else ''}{extra}")
        topics.append(t)
    lines.append("BLOCKS (ids you may use in proposedAdjustments):")
    for r in rows:
        lines.append(f"- {r['blockId']}: {r['topic']}, {_parse(r['start']):%a %d %b %H:%M}, {r['minutes']} min, {r['status']}")
    if rec.weakTopicMovement:
        lines.append("WEAK-TOPIC IMPACT (at plan time → now): " + "; ".join(
            f"{m.topic} {m.from_} → {m.to}" for m in rec.weakTopicMovement))
        topics += [m.topic for m in rec.weakTopicMovement]
    if rec.movementNote:
        lines.append(f"NOTE: {rec.movementNote}")
    if rec.flaggedTopics:
        lines.append("FLAGGED IN CLASS (\"I'm stuck\" taps since the last 1:1): " + "; ".join(
            f"{f.topic} ×{f.times}" for f in rec.flaggedTopics))
        topics += [f.topic for f in rec.flaggedTopics]
    courses = registered_courses(student["id"])
    soon = [e for e in exams() if (courses is None or course_slug(e.course_code) in courses)
            and now.date() <= e.start.date() <= now.date() + timedelta(days=21)]
    if soon:
        lines.append("UPCOMING (next 3 weeks): " + "; ".join(f"{e.course_code} {e.component} {fmt_day(e.start.date())}"
                                                            for e in soon))
    return "\n".join(lines), list(dict.fromkeys(topics))


def _grounded(line: str, topics: list[str], allowed: set[str]) -> str | None:
    """None if the line is grounded, else why it isn't."""
    nums = NUM.findall(line)
    bad = [n for n in nums if n not in allowed]
    if bad:
        return f"states numbers not in the recap: {', '.join(bad)}"
    low = line.casefold()
    if not nums and not any(t.casefold() in low for t in topics):
        return "names no topic and no number from the recap"
    return None


def _check(review: _Review, topics: list[str], allowed: set[str], block_ids: set[str]) -> tuple[dict, list[str]]:
    out: dict[str, Any] = {"wins": [], "concerns": [], "questions": [], "adjustments": []}
    rejected: list[str] = []
    for key in ("wins", "concerns"):
        for line in getattr(review, key):
            why = _grounded(line, topics, allowed)
            (rejected.append(f"{key}: {line!r} {why}") if why else out[key].append(line.strip()))
    for q in review.questions:
        why = _grounded(q.prompt, topics, allowed)
        (rejected.append(f"question: {q.prompt!r} {why}") if why else out["questions"].append(q.prompt.strip()))
    for a in review.proposedAdjustments:
        why = _grounded(a.detail, topics, allowed)
        if why:
            rejected.append(f"adjustment: {a.detail!r} {why}")
            continue
        bid = a.blockId if a.blockId in block_ids else None
        if a.blockId and bid is None:
            rejected.append(f"adjustment blockId {a.blockId!r} is not a recap block; id removed")
        out["adjustments"].append(OneOnOneAdjustment(blockId=bid, change=a.change, detail=a.detail.strip()))
    out["wins"], out["concerns"], out["questions"] = out["wins"][:3], out["concerns"][:3], out["questions"][:3]
    out["adjustments"] = out["adjustments"][:3]
    return out, rejected


def _reflect(student: dict[str, Any], rec: OneOnOneRecap, details: dict[str, Any],
             now: datetime) -> tuple[dict[str, Any], list[str], str | None]:
    facts, topics = _facts(student, rec, details, now)
    allowed = set(NUM.findall(facts))
    block_ids = {r["blockId"] for r in details["rows"]}
    prompt = facts
    best: tuple[dict, list[str]] | None = None
    for attempt in range(2):
        review = llm.json(prompt, _Review, system=_system_prompt(), max_tokens=6000)
        checked, rejected = _check(review, topics, allowed, block_ids)
        if best is None or len(checked["questions"]) > len(best[0]["questions"]) or \
                (len(checked["questions"]) == len(best[0]["questions"]) and len(rejected) < len(best[1])):
            best = (checked, rejected)
        if len(checked["questions"]) >= 2 and checked["concerns"] and not rejected:
            break
        prompt = (f"{facts}\n\nYour previous review had lines rejected by the grounding check:\n- "
                  + "\n- ".join(rejected or ["fewer than 2 grounded questions"]) +
                  "\nRewrite it. Every line must name a topic or number from the recap above, and state no other number.")
    checked, rejected = best
    error = None
    if len(checked["questions"]) < 2:
        error = f"only {len(checked['questions'])} grounded question(s) after retry"
    return checked, rejected, error


# ---------------------------------------------------------------------------------
# endpoints' logic
# ---------------------------------------------------------------------------------

def _id(student_id: str, now: datetime) -> str:
    return f"ooo_{student_id}_{planner.monday_of(now.date()):%Y%m%d}"


def _load(one_id: str) -> dict[str, Any]:
    body = db.get("one_on_one", one_id)
    if not body:
        raise LookupError(f"1:1 {one_id} not found")
    return body


def _public(body: dict[str, Any]) -> dict[str, Any]:
    rec = body.get("recap") or {}
    if "window" not in rec and rec.get("windowStart") and rec.get("windowEnd"):  # 1:1s stored before v3.8
        rec["window"] = {"from": rec["windowStart"], "to": rec["windowEnd"]}
    return OneOnOne.model_validate({k: v for k, v in body.items() if not k.startswith("_")}).dump()


def _save(body: dict[str, Any]) -> dict[str, Any]:
    db.put("one_on_one", body["id"], body, student_id=body["studentId"])
    return _public(body)


def build_current(student_id: str) -> tuple[dict[str, Any], list]:
    """(OneOnOne, trace). Builds one for the current week if none exists (or the ready one is stale)."""
    student = load_student(student_id)
    if student is None:
        raise LookupError(f"student {student_id} not found")
    now = clock.now(student_id)
    start, end = now - timedelta(days=7), now
    one_id = _id(student_id, now)
    existing = db.get("one_on_one", one_id)
    with Stopwatch() as sw_recap:
        rec, details = recap(student_id, start, end)
    if existing and (existing["status"] != "ready" or _same(existing["recap"], rec.dump())):
        return _public(existing), [trace(TOOL, f"current 1:1 {one_id} ({existing['status']})", sw_recap.ms)]
    label = f"Week of {start:%b} {start.day}"
    traces = [trace(f"{TOOL}.recap", f"{rec.blocksPlanned} blocks in the last 7 days: {rec.blocksDone} done, "
                                     f"{rec.blocksMissed} missed, {rec.doneMinutes}/{rec.plannedMinutes} min, "
                                     f"streak {rec.streakDays}" + (f"; {rec.movementNote}" if rec.movementNote else ""),
                    sw_recap.ms)]
    body: dict[str, Any] = {"id": one_id, "studentId": student_id, "weekLabel": label, "status": "ready",
                            "recap": rec.dump(), "wins": [], "concerns": [], "questions": [],
                            "proposedAdjustments": [], "shareWithAdvisor": False,
                            "_rows": details["rows"], "_builtAt": iso(now)}
    if rec.blocksPlanned == 0:
        traces.append(trace(TOOL, "nothing to review: no study blocks in the last 7 days; 1:1 not stored", 0))
        return _public(body), traces
    with Stopwatch() as sw:
        try:
            checked, rejected, error = _reflect(student, rec, details, now)
        except llm.LLMError as exc:
            traces.append(trace(f"{TOOL}.reflect", "model call failed; 1:1 not built", sw.ms, error=str(exc)))
            raise RuntimeError(f"weekly review failed: {exc}") from exc
    body.update({"wins": checked["wins"], "concerns": checked["concerns"],
                 "questions": [OneOnOneQuestion(id=f"q{n}", prompt=p).dump()
                               for n, p in enumerate(checked["questions"], 1)],
                 "proposedAdjustments": [a.dump() for a in checked["adjustments"]]})
    traces.append(trace(f"{TOOL}.reflect", f"{len(checked['wins'])} wins, {len(checked['concerns'])} concerns, "
                                           f"{len(checked['questions'])} questions, {len(checked['adjustments'])} "
                                           f"adjustments grounded in the recap; {len(rejected)} lines rejected"
                        + (f" ({'; '.join(rejected[:3])})" if rejected else ""), sw.ms, error=error))
    return _save(body), traces


def _same(a: dict[str, Any], b: dict[str, Any]) -> bool:
    keys = ("plannedMinutes", "doneMinutes", "blocksPlanned", "blocksDone", "blocksMissed")
    return all(a.get(k) == b.get(k) for k in keys)


def answer(one_id: str, question_id: str, text: str) -> dict[str, Any]:
    body = _load(one_id)
    if body["status"] == "done":
        raise ValueError("this 1:1 is already complete")
    q = next((q for q in body["questions"] if q["id"] == question_id), None)
    if q is None:
        raise LookupError(f"question {question_id} not in {one_id}")
    if not (text or "").strip():
        raise ValueError("answer is empty")
    q["answer"] = text.strip()
    body["status"] = "in_progress"
    return _save(body)


def _summary(student: dict[str, Any], body: dict[str, Any], moved: list[str]) -> str:
    r = body["recap"]
    parts = [f"Weekly 1:1 for {student.get('name')}, {body['weekLabel']}: planned {r['plannedMinutes']} min in "
             f"{r['blocksPlanned']} blocks; done {r['doneMinutes']} min ({r['blocksDone']} blocks); "
             f"missed {r.get('blocksMissed', 0)} blocks; streak {r['streakDays']} days."]
    if r.get("skippedTopics"):
        parts.append(f"Skipped: {', '.join(r['skippedTopics'])}.")
    if r.get("movementNote"):
        parts.append(r["movementNote"])
    if body.get("concerns"):
        parts.append("Concerns: " + " ".join(body["concerns"]))
    answered = [q for q in body["questions"] if q.get("answer")]
    if answered:
        parts.append("Student said: " + " ".join(f"“{q['prompt']}” {q['answer']}" for q in answered))
    if moved:
        parts.append(f"Adjusted plan moves {', '.join(moved)} into the coming week.")
    return " ".join(parts)


def complete(one_id: str, share_with_advisor: bool) -> tuple[dict[str, Any], list]:
    body = _load(one_id)
    if body["status"] == "done":
        return _public(body), [trace(TOOL, f"1:1 {one_id} was already complete", 0)]
    student_id = body["studentId"]
    student = load_student(student_id) or {"name": student_id}
    rows = body.get("_rows") or []
    carry: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        if r["status"] != "missed":
            continue
        c = carry.setdefault((course_slug(r["course"]), r["topic"]),
                             {"course": r["course"], "topic": r["topic"], "minutes": 0, "missedOn": []})
        c["minutes"] += r["minutes"]
        c["missedOn"].append(f"{_parse(r['start']):%a %d %b}")
    answers = [{"prompt": q["prompt"], "answer": q["answer"]} for q in body["questions"] if q.get("answer")]
    result: ToolResult = planner.build_plan(student_id, extra={
        "carryOver": list(carry.values()), "answers": answers, "adjustments": body.get("proposedAdjustments") or []})
    if result.error or not result.card:
        raise RuntimeError(f"re-planning failed: {result.error or 'no plan'}")
    now = clock.now(student_id)
    moved = [c["topic"] for c in carry.values()
             if any(p.cand.topic == c["topic"] and p.start < now + timedelta(days=7) for p in result.data["placed"])]
    body["adjustedPlan"] = result.card
    body["status"] = "done"
    body["shareWithAdvisor"] = bool(share_with_advisor)
    traces = list(result.trace)
    traces.append(trace(TOOL, f"re-planned with {len(carry)} carry-over topic(s), {len(answers)} answer(s), "
                              f"{len(body.get('proposedAdjustments') or [])} adjustment(s); moved into the coming "
                              f"week: {', '.join(moved) or 'none'}", 0,
                        error=None if len(moved) == len(carry) else "some carry-over could not be placed next week"))
    if share_with_advisor:
        ticket, _ = escalation.create_ticket(
            student_id=student_id, agent_id=AGENT_ID,
            question=f"Weekly 1:1 shared for review ({body['weekLabel']})",
            agent_summary=_summary(student, body, moved), citations=[], reason="needs_human")
        body["_ticketId"] = ticket.ticketId
        traces.append(trace("escalate", f"1:1 shared with advisor as ticket {ticket.ticketId}", 0))
    return _save(body), traces


def simulate_week(student_id: str) -> dict[str, Any]:
    """Demo setup (disclosed): mark the next 7 days of plan blocks and accepted actions done/missed
    deterministically (every third, in time order, missed), then move this student's clock 7 days on
    so the weekly 1:1 reviews that week. Touches statuses and the clock only; writes no text."""
    if load_student(student_id) is None:
        raise LookupError(f"student {student_id} not found")
    now = clock.now(student_id)
    items = [i for i in cal.build_calendar(student_id, now, now + timedelta(days=7))
             if i["kind"] in ("study_block", "action", "prep", "deadline")
             and (i.get("source") or {}).get("type") in ("plan_block", "action")]
    if not items:
        raise ValueError("no plan blocks in the next 7 days; build a plan first")
    marked = []
    for n, item in enumerate(sorted(items, key=lambda i: (i["start"], i["id"]))):
        status = "missed" if n % 3 == 2 else "done"
        cal.set_item_status(item["id"], status, student_id)
        marked.append({"id": item["id"], "start": item["start"], "status": status})
    new_now = clock.advance(student_id, 7)
    return {"updated": len(marked), "clockNow": iso(new_now), "studentId": student_id, "from": iso(now),
            "to": iso(now + timedelta(days=7)), "marked": marked,
            "done": sum(1 for m in marked if m["status"] == "done"),
            "missed": sum(1 for m in marked if m["status"] == "missed")}


def as_tool(student_id: str) -> ToolResult:
    """weekly_review for the chat: the current 1:1 as a card, plus the numbers compose may state."""
    one, traces = build_current(student_id)
    r = one["recap"]
    result = ToolResult(card={"type": "one_on_one", "oneOnOne": one}, trace=traces)
    if r["blocksPlanned"] == 0:
        result.facts.append("no study blocks were scheduled in the last 7 days, so there is nothing to review yet")
        return result
    result.facts += [f"{one['weekLabel']}: planned {r['plannedMinutes']} min in {r['blocksPlanned']} blocks; done "
                     f"{r['doneMinutes']} min in {r['blocksDone']} blocks; missed {r.get('blocksMissed', 0)} blocks; "
                     f"streak {r['streakDays']} days",
                     f"completed topics: {', '.join(r['completedTopics']) or 'none'}; skipped topics: "
                     f"{', '.join(r['skippedTopics']) or 'none'}"]
    if r.get("movementNote"):
        result.facts.append(r["movementNote"])
    result.facts += [f"concern: {c}" for c in one["concerns"]]
    result.facts += [f"question for the student: {q['prompt']}" for q in one["questions"]]
    return result
