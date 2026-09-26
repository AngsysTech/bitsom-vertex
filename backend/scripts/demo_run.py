"""Backend dry run of the demo (AGENTS.md §7, contracts.ts §10) against a running server. No UI.

    cd backend
    .venv/bin/python scripts/demo_run.py --reset                 # meera on Lecture.mp3, then aarav
    .venv/bin/python scripts/demo_run.py --reset --transcript    # CS F212 text fallback instead of audio
    .venv/bin/python scripts/demo_run.py --student aarav --audio path/to/clip.mp3 --base-url http://127.0.0.1:8000

Order; every step prints its requests, the key response fields and its wall time:
  0  which course the audio is: transcribe it once through app.core.stt (cached in data/demo_run/),
     then word overlap with data/lectures/*.md; when none of those matches, the syllabi decide
  1  POST /demo/reset/:studentId                          (with --reset)
  2  POST /demo/simulate-week/meera                       (meera only; prints clockNow)
  3  POST /lectures                                        (audio; the transcript path if STT failed)
  4  POST /lectures/:id/markers {atSec: 120, note: "lost here"}
  5  POST /lectures/:id/process, poll every 2 s until ready|failed (cap 180 s); audio failure reruns 3-5 on text
  6  GET  /lectures/:id/handout and /cards
  7  POST /actions/:id {status: accepted} for the first study and the first prep action
  8  GET  /calendar/:studentId?from=today&to=today+14d    assert: both accepted items present, no overlap
  9  POST /chat "What should I study this week?"
 10  weekly 1:1: current, answer one question, complete {shareWithAdvisor: true}
 11  POST /chat "Can I get a fee extension for a medical issue?"    assert: escalation, zero citations
 12  advisor inbox, reply, the reply in GET /threads/:studentId/academic_coach    assert: it is there
 13  POST /relevant on the stuck section, interest from the student's profile
 14  steps 3-9 for the other student (reset first with --reset), then a two-line diff

Stops at the first failure with the full error; --keep-going records it and carries on so one run
maps every break. Exit 0 only if every step and assert passed. The console log is also written to
scripts/demo_run.log (or --log).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import traceback
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

import httpx

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
DATA = BACKEND / "app" / "data"
LECTURE_FILES = DATA / "lectures"
CACHE = BACKEND / "data" / "demo_run" / "transcripts"  # backend/data/ is gitignored runtime state
TZ = ZoneInfo("Asia/Kolkata")

STUDENTS = ("meera", "aarav")
AGENT = "academic_coach"
TEXT_FALLBACK = LECTURE_FILES / "cs-f212-2026-09-22-transactions.md"
AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".webm", ".ogg", ".mp4", ".aac", ".flac"}
MARKER = {"atSec": 120, "note": "lost here"}
Q_PLAN = "What should I study this week?"
Q_FEE = "Can I get a fee extension for a medical issue?"
ANSWER = "Ran out of time on Tuesdays"
REPLY = "Approved, submit the medical certificate to the Academic Office by Friday."
POLL_EVERY = 2.0
KEYWORDS = 15        # subject words per lecture file used for the course check
MATCH_MIN = 8        # of those, how many the audio must contain to count as that lecture

STOP = set("""about above after again against also because been before being below between both could does
doing down during each from further have having here hers herself himself into itself just more most myself
once only other ours ourselves over same should some such than that their theirs them themselves then there
these they this those through under until very were what when where which while whom will with would your
yours yourself yourselves okay yeah right like thing things really going know think want said well today
lecture student students question answer good sort kind mean actually gonna time first next last make made
even much many look looks point says need needs used using lets something someone people every though another
different case example""".split())


class Fail(Exception):
    """The step failed: an HTTP error, a failed lecture or a broken assert."""


class Skip(Exception):
    """The step can't run because an earlier one failed."""


class Abort(Exception):
    """Stop the run (first failure without --keep-going)."""


# ---- small helpers ----------------------------------------------------------------------

def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    if len(value) == 10:
        return datetime.combine(date.fromisoformat(value), datetime.min.time(), TZ)
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=TZ)


def fmt_due(value: str | None) -> str:
    dt = parse_dt(value)
    if not dt:
        return "no dueBy"
    return f"{dt:%a %d %b}" if len(value or "") == 10 else f"{dt:%a %d %b %H:%M}"


def clip(text: str | None, n: int) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= n else text[: n - 1] + "…"


def mmss(sec: float | None) -> str:
    return "?" if sec is None else f"{int(sec) // 60}:{int(sec) % 60:02d}"


def need(value: Any, why: str) -> Any:
    if not value:
        raise Skip(why)
    return value


def front_matter(path: Path) -> tuple[dict[str, str], str]:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"\A---\n(.*?)\n---\s*\n", text, re.S)
    meta = dict(re.findall(r"^(\w+):\s*(.+?)\s*$", m.group(1), re.M)) if m else {}
    return meta, text[m.end():] if m else text


def tokens(text: str) -> list[str]:
    out = []
    for w in re.findall(r"[a-z]+", text.lower()):
        if len(w) <= 3 or w in STOP:
            continue
        out.append(w[:-1] if len(w) > 4 and w.endswith("s") and not w.endswith("ss") else w)
    return out


def find_audio(explicit: str | None) -> Path | None:
    """--audio PATH, else Lecture.mp3 at the repo root or in backend/ (a file, or a folder holding one)."""
    def audio_in(p: Path) -> Path | None:
        if p.is_file():
            return p
        if p.is_dir():
            files = sorted(f for f in p.iterdir() if f.suffix.lower() in AUDIO_EXTS)
            return files[0] if files else None
        return None

    if explicit:
        return audio_in(Path(explicit).expanduser())
    for p in (ROOT / "Lecture.mp3", BACKEND / "Lecture.mp3", ROOT / "Lecture", BACKEND / "Lecture"):
        found = audio_in(p)
        if found:
            return found
    skip = {"node_modules", ".git", ".venv", "venv", "data", "__pycache__"}
    for top, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in skip and len(Path(top, d).relative_to(ROOT).parts) <= 3]
        if "Lecture.mp3" in files or "Lecture.mp3" in dirs:
            found = audio_in(Path(top) / "Lecture.mp3")
            if found:
                return found
    return None


def transcribe_once(audio: Path) -> tuple[list[dict[str, Any]], str]:
    """Segments of ``audio`` through the app's one STT boundary, cached by content hash."""
    sha = hashlib.sha1(audio.read_bytes()).hexdigest()[:16]
    cached = CACHE / f"{sha}.json"
    if cached.exists():
        body = json.loads(cached.read_text(encoding="utf-8"))
        return body["segments"], (f"cached {body['provider']} transcript from {body['transcribedAt']} "
                                  f"(that transcription took {body['seconds']} s)")
    sys.path.insert(0, str(BACKEND))
    from app.core import stt  # noqa: E402  (loads backend/.env; wraps the vendored transcription service)

    started = time.perf_counter()
    segments = stt.transcribe(str(audio))
    secs = time.perf_counter() - started
    CACHE.mkdir(parents=True, exist_ok=True)
    body = {"audio": str(audio), "sha1": sha, "provider": stt.provider(),
            "transcribedAt": datetime.now(TZ).isoformat(timespec="seconds"), "seconds": round(secs, 1),
            "segments": [s.__dict__ for s in segments]}
    cached.write_text(json.dumps(body, ensure_ascii=False), encoding="utf-8")
    return body["segments"], f"{body['provider']} transcription in {secs:.1f} s, cached to {cached.relative_to(BACKEND)}"


def match_course(text: str) -> dict[str, Any]:
    """Which lecture file the transcript is: each file's most frequent words that no other lecture
    file uses (its subject words), counted in the transcript. Plain vocabulary overlap is not used
    to decide: a long talk shares most everyday words with any of the files."""
    heard = Counter(tokens(text))
    files = {}
    for f in sorted(LECTURE_FILES.glob("*.md")):
        meta, body = front_matter(f)
        if meta.get("courseCode"):
            files[f] = (meta, Counter(tokens("\n".join(l for l in body.splitlines() if not l.lstrip().startswith("#")))))
    rows = []
    for f, (meta, words) in files.items():
        others = Counter()
        for g, (_, w) in files.items():
            if g != f:
                others.update(w)
        keys = [w for w, _ in words.most_common() if not others[w]][:KEYWORDS]
        hits = {w: heard[w] for w in keys}
        vocab = set(words)
        rows.append({"file": f, "course": meta["courseCode"], "unit": meta.get("unit", ""), "keys": hits,
                     "present": sum(1 for v in hits.values() if v), "of": len(keys),
                     "occurrences": sum(hits.values()), "vocab": len(vocab & set(heard)) / max(1, len(vocab))})
    best = max(rows, key=lambda r: (r["present"], r["occurrences"])) if rows else None
    syllabi = []
    heads = {}
    for f in sorted((DATA / "syllabus").glob("*.md")):
        meta, body = front_matter(f)
        heads[f] = (meta, Counter(tokens(" ".join(re.findall(r"^#{2,3}\s+(.+)$", body, re.M)))))
    for f, (meta, words) in heads.items():
        others = Counter()
        for g, (_, w) in heads.items():
            if g != f:
                others.update(w)
        own = {w: heard[w] for w in words if not others[w] and heard[w]}
        syllabi.append({"course": meta.get("courseCode", f.stem), "title": meta.get("title", ""), "hits": own,
                        "occurrences": sum(own.values())})
    syllabi.sort(key=lambda s: -s["occurrences"])
    return {"rows": rows, "best": best, "matched": bool(best and best["present"] >= MATCH_MIN),
            "syllabi": syllabi, "words": sum(heard.values())}


# ---- the run -----------------------------------------------------------------------------

class Student:
    def __init__(self, sid: str, mode: str):
        self.id = sid
        self.mode = mode                      # "audio" | "transcript"
        self.lecture_id: str | None = None
        self.ready = False
        self.marker: dict[str, Any] | None = None
        self.segments: list[dict[str, Any]] = []
        self.sections: list[dict[str, Any]] = []
        self.stuck_section: dict[str, Any] | None = None
        self.section_at_marker: dict[str, Any] | None = None
        self.actions: list[dict[str, Any]] = []
        self.accepted: list[dict[str, Any]] = []
        self.plan: dict[str, Any] | None = None
        self.fee_ticket: str | None = None
        self.orphans: list[str] = []          # audio lectures abandoned for the transcript path


class Run:
    def __init__(self, args: argparse.Namespace, log_path: Path):
        self.args = args
        self.log = log_path.open("w", encoding="utf-8")
        self.client = httpx.Client(base_url=args.base_url.rstrip("/"), timeout=httpx.Timeout(300, connect=5))
        self.today = datetime.now(TZ).date()
        self.steps: list[dict[str, Any]] = []
        self.asserts: list[tuple[str, bool, str]] = []
        self.warnings: list[str] = []
        self._fallbacks: list[str] = []
        self._step_checks: list[tuple[str, bool, str]] = []
        self.course = "CS F212"
        self.audio: Path | None = None
        self.fallback_text: tuple[str, str] | None = None   # (text, what it is)
        self.stt_note = ""
        self.students: dict[str, Student] = {}

    # ---- output -----------------------------------------------------------------------
    def out(self, line: str = "") -> None:
        print(line, flush=True)
        self.log.write(line + "\n")
        self.log.flush()

    def warn(self, text: str) -> None:
        self.warnings.append(text)
        self.out(f"  WARN: {text}")

    def fallback(self, text: str) -> None:
        self._fallbacks.append(text)
        self.out(f"  FALLBACK: {text}")

    def check(self, name: str, ok: bool, detail: str = "") -> bool:
        self.asserts.append((name, ok, detail))
        self._step_checks.append((name, ok, detail))
        self.out(f"  [{'PASS' if ok else 'FAIL'}] assert {name}" + (f": {detail}" if detail else ""))
        return ok

    # ---- steps ------------------------------------------------------------------------
    def step(self, label: str, name: str, fn: Callable[[], None]) -> bool:
        self.out()
        self.out(f"── {label}. {name}")
        self._fallbacks, self._step_checks = [], []
        started = time.perf_counter()
        status, note = "PASS", ""
        try:
            fn()
            failed = [n for n, ok, _ in self._step_checks if not ok]
            if failed:
                raise Fail(f"assert failed: {'; '.join(failed)}")
            if self._fallbacks:
                status, note = "PASS*", "; ".join(self._fallbacks)
        except Skip as exc:
            status, note = "SKIP", str(exc)
            self.out(f"  SKIPPED: {exc}")
        except Fail as exc:
            status, note = "FAIL", str(exc).splitlines()[0]
            self.out(f"  FAILED: {exc}")
        except httpx.HTTPError as exc:
            status, note = "FAIL", f"{type(exc).__name__}: {exc}"
            self.out(f"  FAILED: {type(exc).__name__}: {exc}")
        except Exception as exc:  # a response this script didn't expect: report it in full, like any failure
            status, note = "FAIL", f"{type(exc).__name__}: {exc}"
            self.out(f"  FAILED: unexpected {type(exc).__name__}: {exc}")
            for line in traceback.format_exc().rstrip().splitlines():
                self.out(f"    {line}")
        secs = time.perf_counter() - started
        self.out(f"  ⏱ {secs:.1f}s  [{status}]")
        self.steps.append({"label": label, "name": name, "status": status, "secs": secs, "note": note})
        if status == "FAIL" and not self.args.keep_going:
            raise Abort(label)
        return status in ("PASS", "PASS*")

    def call(self, method: str, path: str, *, body: Any = None, params: dict[str, str] | None = None,
             files: Any = None, data: dict[str, str] | None = None, show: str | None = None) -> Any:
        shown = show if show is not None else (json.dumps(body, ensure_ascii=False) if body is not None else "")
        query = ("?" + "&".join(f"{k}={v}" for k, v in params.items())) if params else ""
        self.out(f"  → {method} {path}{query}" + (f"  {shown}" if shown else ""))
        started = time.perf_counter()
        r = self.client.request(method, path, json=body, params=params, files=files, data=data)
        secs = time.perf_counter() - started
        try:
            payload = r.json()
        except ValueError:
            payload = r.text
        self.out(f"  ← {r.status_code} in {secs:.1f}s")
        if r.status_code != 200:
            err = payload.get("error") if isinstance(payload, dict) else payload
            hint = {"Not Found": "  (no such route on this server)",
                    "Method Not Allowed": "  (route exists, not for this method)"}.get(err, "")
            raise Fail(f"{method} {path} → HTTP {r.status_code}: {json.dumps(payload, ensure_ascii=False)}{hint}")
        return payload

    # ---- 0. preflight + course check ----------------------------------------------------
    def preflight(self) -> None:
        a = self.args
        self.out(f"demo_run.py  {datetime.now(TZ):%Y-%m-%d %H:%M:%S %Z}  server {a.base_url}  primary student {a.student}")
        try:
            head = subprocess.run(["git", "log", "-1", "--format=%h %s"], cwd=ROOT, capture_output=True,
                                  text=True, timeout=5).stdout.strip()
            dirty = subprocess.run(["git", "status", "--short"], cwd=ROOT, capture_output=True, text=True,
                                   timeout=5).stdout.split("\n")
            dirty = [d.strip() for d in dirty if d.strip()]
            self.out(f"git HEAD {head}; working tree: {len(dirty)} uncommitted path(s)"
                     + (f" ({', '.join(d.split()[-1] for d in dirty[:8])}{', …' if len(dirty) > 8 else ''})" if dirty else ""))
        except (OSError, subprocess.SubprocessError):
            pass
        try:
            health = self.client.get("/health", timeout=5).json()
            spec = self.client.get("/openapi.json", timeout=10).json()
        except (httpx.HTTPError, ValueError) as exc:
            self.out(f"server not reachable at {a.base_url}: {exc}")
            raise Abort("preflight")
        routes = {(m.upper(), p) for p, ops in spec.get("paths", {}).items() for m in ops}
        wanted = [("POST", "/demo/reset/{student_id}"), ("POST", "/demo/simulate-week/{student_id}"),
                  ("POST", "/lectures"), ("POST", "/lectures/{lecture_id}/markers"),
                  ("POST", "/lectures/{lecture_id}/process"), ("GET", "/lectures/{lecture_id}/handout"),
                  ("GET", "/lectures/{lecture_id}/cards"), ("POST", "/actions/{action_id}"),
                  ("GET", "/calendar/{student_id}"), ("POST", "/chat"), ("GET", "/one-on-one/{student_id}/current"),
                  ("GET", "/advisor/inbox"), ("POST", "/advisor/reply"), ("POST", "/relevant")]
        norm = {(m, re.sub(r"\{[^}]+\}", "{}", p)) for m, p in routes}
        missing = [f"{m} {p}" for m, p in wanted if (m, re.sub(r"\{[^}]+\}", "{}", p)) not in norm]
        self.out(f"health {health}; demo routes present {len(wanted) - len(missing)}/{len(wanted)}"
                 + (f"; MISSING: {', '.join(missing)}" if missing else ""))

        self.out()
        self.out("── 0. Course check (which lecture is the audio?)")
        started = time.perf_counter()
        if a.transcript:
            meta, _ = front_matter(TEXT_FALLBACK)
            self.course = meta.get("courseCode", "CS F212")
            self.fallback_text = (TEXT_FALLBACK.read_text(encoding="utf-8"), TEXT_FALLBACK.name)
            self.out(f"  --transcript: no audio; text fallback {TEXT_FALLBACK.relative_to(BACKEND)} ({self.course})")
            self.out(f"  ⏱ {time.perf_counter() - started:.1f}s")
            self.banner(f"MODE transcript · COURSE {self.course} · text fallback {TEXT_FALLBACK.name}")
            return
        self.audio = find_audio(a.audio)
        if self.audio is None:
            raise Abort("no audio: pass --audio PATH or --transcript")
        size = self.audio.stat().st_size
        self.out(f"  audio {self.audio.relative_to(ROOT) if self.audio.is_relative_to(ROOT) else self.audio} "
                 f"({size / 1e6:.1f} MB)")
        try:
            segments, how = transcribe_once(self.audio)
        except Exception as exc:  # STT down: the whole run takes the text path, and says so
            self.stt_note = f"STT failed ({type(exc).__name__}: {clip(str(exc), 300)})"
            self.out(f"  {self.stt_note}")
            meta, _ = front_matter(TEXT_FALLBACK)
            self.course = meta.get("courseCode", "CS F212")
            self.fallback_text = (TEXT_FALLBACK.read_text(encoding="utf-8"), TEXT_FALLBACK.name)
            self.out(f"  ⏱ {time.perf_counter() - started:.1f}s")
            self.banner(f"MODE transcript (automatic: {self.stt_note}) · COURSE {self.course} · "
                        f"text fallback {TEXT_FALLBACK.name}")
            self.args.transcript = True
            return
        text = " ".join(s["text"] for s in segments)
        self.out(f"  {how}")
        self.out(f"  {len(segments)} segments, {mmss(segments[-1]['endSec'])} long, {len(text.split())} words")
        self.out(f"  opens: “{clip(text, 220)}”")
        m = match_course(text)
        self.out(f"  subject words of each lecture file ({KEYWORDS} per file, words no other lecture file uses), "
                 f"counted in the transcript:")
        for r in m["rows"]:
            top = ", ".join(f"{w}×{n}" for w, n in list(r["keys"].items())[:8])
            self.out(f"    {r['file'].name:<40} {r['course']:<8} {r['present']:>2}/{r['of']} present, "
                     f"{r['occurrences']:>3} occurrences ({top}, …); plain vocabulary overlap {r['vocab']:.0%}")
        heard = Counter(tokens(text)).most_common(12)
        self.out(f"  the transcript's own most frequent words: {', '.join(f'{w}×{n}' for w, n in heard)}")
        best = m["best"]
        if m["matched"]:
            self.course = best["course"]
            verdict = f"matches {best['file'].name} ({best['present']}/{best['of']} subject words)"
        else:
            syl = next((s for s in m["syllabi"] if s["occurrences"]), None)
            self.out("  syllabus headings (words only that course's syllabus uses), counted in the transcript:")
            for s in m["syllabi"][:4]:
                self.out(f"    {s['course']:<10} {s['occurrences']:>3} ({', '.join(f'{w}×{n}' for w, n in sorted(s['hits'].items(), key=lambda x: -x[1])[:6]) or 'none'})  {s['title']}")
            if syl:
                self.course = syl["course"]
                verdict = (f"matches none of the three lecture files (best {best['file'].name}: "
                           f"{best['present']}/{best['of']} subject words); by the syllabi it is {syl['course']} "
                           f"({syl['title']})")
            else:
                verdict = "matches no lecture file and no syllabus; keeping CS F212, expect coverage to be meaningless"
        self.out(f"  → {verdict}")
        if self.course == "CS F212":
            self.fallback_text = (TEXT_FALLBACK.read_text(encoding="utf-8"), TEXT_FALLBACK.name)
        else:
            self.fallback_text = (text, f"cached STT transcript of {self.audio.name} (no {self.course} text file exists)")
        self.out(f"  ⏱ {time.perf_counter() - started:.1f}s")
        if self.course != "CS F212":
            self.banner(f"COURSE CHECK: {self.audio.name} is NOT CS F212 — it {verdict}. Using {self.course} for "
                        f"the whole run. The planted CS F212 story (Two-phase locking skipped, exam hint, prep for "
                        f"the next CS F212 session) cannot appear on this audio.")
        else:
            self.banner(f"COURSE CHECK: {self.audio.name} {verdict}; using CS F212")
        self.transcript_hints(segments)

    def banner(self, text: str) -> None:
        self.out("  " + "=" * 96)
        for line in re.findall(r".{1,94}(?:\s|$)", text):
            self.out(f"  = {line.strip()}")
        self.out("  " + "=" * 96)

    def transcript_hints(self, segments: list[dict[str, Any]]) -> None:
        at = next((s for s in segments if s["startSec"] <= MARKER["atSec"] < s["endSec"]), None)
        if at:
            self.out(f"  the marker at {MARKER['atSec']} s lands in {at['id']} ({mmss(at['startSec'])}–"
                     f"{mmss(at['endSec'])}): “{clip(at['text'], 160)}”")

    # ---- per-student steps -------------------------------------------------------------
    def s1_reset(self, st: Student) -> None:
        res = self.call("POST", f"/demo/reset/{st.id}")
        self.out(f"  cleared {res.get('lectures')} lecture(s); deleted {res.get('deleted')}; plan cleared "
                 f"{res.get('planCleared')}; audio folders removed {res.get('audioFoldersRemoved')}"
                 + (f"; STILL RUNNING {res['stillRunning']}" if res.get("stillRunning") else ""))

    def s2_simulate(self, st: Student) -> None:
        try:
            res = self.call("POST", f"/demo/simulate-week/{st.id}")
        except Fail as exc:
            if "build a plan first" not in str(exc):
                raise
            self.fallback("simulate-week refused (no plan blocks in the next 7 days); built the plan with "
                          f"POST /students/{st.id}/plan, then retried")
            plan = self.call("POST", f"/students/{st.id}/plan")
            weeks = (plan.get("card") or {}).get("weeks") or []
            self.out(f"  plan: {sum(len(w['blocks']) for w in weeks)} blocks in {len(weeks)} week(s); "
                     + "; ".join(t["summary"][:140] for t in plan.get("trace", []) if t["tool"].endswith(".place")))
            res = self.call("POST", f"/demo/simulate-week/{st.id}")
        self.out(f"  marked {res.get('done')} done, {res.get('missed')} missed between {fmt_due(res.get('from'))} and "
                 f"{fmt_due(res.get('to'))}")
        self.out(f"  clockNow = {res.get('clockNow')}")

    def s3_create(self, st: Student) -> None:
        form = {"studentId": st.id, "courseCode": self.course, "date": self.today.isoformat()}
        if st.mode == "audio":
            assert self.audio is not None
            with self.audio.open("rb") as fh:
                lec = self.call("POST", "/lectures", files={"audio": (self.audio.name, fh, "audio/mpeg")}, data=form,
                                show=f"multipart {json.dumps(form)} + audio={self.audio.name} "
                                     f"({self.audio.stat().st_size / 1e6:.1f} MB)")
        else:
            text, what = need(self.fallback_text, "no transcript text")
            lec = self.call("POST", "/lectures", body={**form, "transcriptText": text},
                            show=f"{json.dumps(form)} + transcriptText=<{what}, {len(text)} chars>")
        st.lecture_id, st.ready, st.marker = lec["id"], False, None
        self.out(f"  lecture {lec['id']}: status {lec['status']}, source {lec['source']}, {lec['courseCode']} "
                 f"{lec['date']}")

    def s4_marker(self, st: Student) -> None:
        need(st.lecture_id, "no lecture (step 3 failed)")
        m = self.call("POST", f"/lectures/{st.lecture_id}/markers", body=MARKER)
        st.marker = m
        self.out(f"  marker {m.get('id')} at {m.get('atSec')} s, segment {m.get('segmentId') or '(resolved later)'}")

    def process(self, lecture_id: str) -> tuple[dict[str, Any], float]:
        started = time.perf_counter()
        lec = self.call("POST", f"/lectures/{lecture_id}/process")
        self.out(f"  polling GET /lectures/{lecture_id} every {POLL_EVERY:.0f} s (cap {self.args.poll_cap} s)")
        self.out(f"    {0:6.1f}s  {lec['status']}")
        last = lec["status"]
        while lec["status"] not in ("ready", "failed") and time.perf_counter() - started < self.args.poll_cap:
            time.sleep(POLL_EVERY)
            r = self.client.get(f"/lectures/{lecture_id}")
            if r.status_code != 200:
                raise Fail(f"GET /lectures/{lecture_id} → HTTP {r.status_code}: {r.text}")
            lec = r.json()
            if lec["status"] != last:
                last = lec["status"]
                self.out(f"    {time.perf_counter() - started:6.1f}s  {last}")
        return lec, time.perf_counter() - started

    def s5_process(self, st: Student) -> None:
        need(st.lecture_id, "no lecture (step 3 failed)")
        lec, secs = self.process(st.lecture_id)
        if lec["status"] == "ready":
            st.ready = True
            self.out(f"  ready in {secs:.1f}s; durationSec {lec.get('durationSec')}")
            return
        why = f"failed: {lec.get('error')}" if lec["status"] == "failed" else \
            f"not ready after {self.args.poll_cap} s (still {lec['status']})"
        if st.mode != "audio":
            raise Fail(f"lecture {st.lecture_id} {why}")
        st.orphans.append(st.lecture_id)
        st.mode = "transcript"
        self.fallback(f"audio lecture {st.lecture_id} {why}; reran steps 3-5 on the transcript path "
                      f"({self.fallback_text[1] if self.fallback_text else '?'})")
        self.s3_create(st)
        try:
            self.s4_marker(st)
        except Fail as exc:
            self.out(f"  (step 4 again) {str(exc).splitlines()[0]}")
        lec, secs = self.process(st.lecture_id)
        if lec["status"] != "ready":
            raise Fail(f"transcript lecture {st.lecture_id} also did not finish: {lec['status']} {lec.get('error') or ''}")
        st.ready = True
        self.out(f"  ready in {secs:.1f}s on the transcript path")

    def s6_results(self, st: Student) -> None:
        need(st.ready, "lecture not ready (step 5 failed)")
        lid = st.lecture_id
        h = self.call("GET", f"/lectures/{lid}/handout")
        cards = self.call("GET", f"/lectures/{lid}/cards")
        tr = self.call("GET", f"/lectures/{lid}/transcript")
        st.segments = tr.get("segments") or []
        seg = {s["id"]: s for s in st.segments}
        st.sections = h.get("sections") or []
        self.out(f"  handout “{h.get('title')}”: {len(st.sections)} sections; summary: {clip(h.get('summary'), 240)}")
        for s in st.sections:
            ids = s.get("segmentIds") or []
            span = f"{mmss(seg[ids[0]]['startSec'])}–{mmss(seg[ids[-1]]['endSec'])}" if ids and ids[0] in seg and ids[-1] in seg else "?"
            self.out(f"    {s['id']:<4} {span:<11} {clip(s['heading'], 60):<60} → {s.get('syllabusTopic') or '(no syllabus topic)'}"
                     + (f"  STUCK {s['stuck']}" if s.get("stuck") else ""))
        stuck = [s for s in st.sections if s.get("stuck")]
        st.stuck_section = stuck[0] if stuck else None
        at = next((x for x in st.segments if x["startSec"] <= MARKER["atSec"] < x["endSec"]), None)
        st.section_at_marker = next((s for s in st.sections if at and at["id"] in (s.get("segmentIds") or [])), None)
        where = "covering"
        if st.section_at_marker is None and at:  # the handout left that segment out of every section: nearest one
            def gap(s: dict[str, Any]) -> float:
                starts = [seg[i]["startSec"] for i in s.get("segmentIds") or [] if i in seg]
                ends = [seg[i]["endSec"] for i in s.get("segmentIds") or [] if i in seg]
                return min(abs(MARKER["atSec"] - x) for x in starts + ends) if starts else float("inf")
            st.section_at_marker = min(st.sections, key=gap, default=None)
            where = f"nearest to (segment {at['id']} is in no section)"
        self.out(f"  stuck section: {st.stuck_section['heading'] if st.stuck_section else 'none — no section carries `stuck`'}"
                 + ("" if st.stuck_section or not st.section_at_marker else
                    f" (the section {where} {MARKER['atSec']} s is {st.section_at_marker['id']} "
                    f"“{st.section_at_marker['heading']}”)"))
        cov, act = cards.get("coverage") or {}, cards.get("actions") or {}
        self.out(f"  coverage vs “{cov.get('unit')}”: covered {len(cov.get('covered') or [])} "
                 f"({', '.join(c['topic'] for c in cov.get('covered') or []) or 'none'})")
        self.out(f"  coverage.missed[].topic: {[m['topic'] for m in cov.get('missed') or []]}")
        for m in cov.get("missed") or []:
            self.out(f"    missed {m['topic']}: {clip(m.get('why'), 160)}")
        self.out(f"  coverage.emphasized[].quote ({len(cov.get('emphasized') or [])}):")
        for e in cov.get("emphasized") or []:
            s = seg.get(e.get("segmentId"), {})
            self.out(f"    [{mmss(s.get('startSec'))} {e.get('segmentId')}] {e['topic']}: “{clip(e['quote'], 200)}”")
        self.out(f"  coverage.confusion: " + (json.dumps(cov["confusion"], ensure_ascii=False) if "confusion" in cov
                                             else "field absent (markers not implemented)"))
        self.out(f"  commitments ({len(act.get('commitments') or [])}):")
        for c in act.get("commitments") or []:
            s = seg.get(c.get("segmentId"), {})
            self.out(f"    {c['kind']:<18} due {fmt_due(c.get('dueBy')):<16} {clip(c['text'], 90)}  "
                     f"[{mmss(s.get('startSec'))}] “{clip(c.get('quote'), 120)}”")
        st.actions = act.get("items") or []
        self.out(f"  actions ({len(st.actions)}):")
        for a in st.actions:
            self.out(f"    {a['kind']:<8} due {fmt_due(a.get('dueBy')):<16} {a.get('minutes') or '?':>3} min  {clip(a['title'], 90)}")
        if not st.actions:
            self.warn("no actions proposed")
        thread = self.call("GET", f"/threads/{st.id}/{AGENT}")
        msg = next((m for m in reversed(thread.get("messages") or [])
                    if any(c.get("lectureId") == lid for c in m.get("cards") or [])), None)
        if msg:
            self.out("  pipeline timings (trace on the 'handout ready' message):")
            for t in msg.get("trace") or []:
                self.out(f"    {t['tool']:<34} {t['durationMs'] / 1000:7.1f}s  {clip(t['summary'], 110)}"
                         + (f"  ERROR {t['error']}" if t.get("error") else ""))
        else:
            self.warn("no 'handout ready' message in the academic_coach thread")

    def s7_accept(self, st: Student) -> None:
        need(st.actions, "no actions (step 6)")
        st.accepted = []
        missing = []
        for kind in ("study", "prep"):
            a = next((x for x in st.actions if x["kind"] == kind), None)
            if a is None:
                missing.append(kind)
                continue
            res = self.call("POST", f"/actions/{a['id']}", body={"status": "accepted"})
            st.accepted.append(res)
            self.out(f"  accepted {kind} “{clip(res['title'], 80)}” (due {fmt_due(res.get('dueBy'))}) → "
                     f"calendarItemId {res.get('calendarItemId')}, planBlockId {res.get('planBlockId')}")
        if missing:
            raise Fail(f"no {' and no '.join(missing)} action was proposed, so it can't be accepted "
                       f"(kinds proposed: {sorted({a['kind'] for a in st.actions})})")

    def s8_calendar(self, st: Student) -> None:
        need(st.accepted, "nothing accepted (step 7)")
        to = self.today + timedelta(days=14)
        items = self.call("GET", f"/calendar/{st.id}", params={"from": self.today.isoformat(), "to": to.isoformat()})
        accepted = {a.get("calendarItemId") for a in st.accepted}
        self.out(f"  {len(items)} items: " + ", ".join(f"{k} {n}" for k, n in Counter(i["kind"] for i in items).most_common()))
        day = None
        for i in items:
            d = i["start"][:10]
            if d != day:
                day = d
                self.out(f"   {parse_dt(d):%a %d %b}")
            s, e = parse_dt(i["start"]), parse_dt(i.get("end"))
            when = "all day" if i.get("allDay") or not i.get("end") else f"{s:%H:%M}–{e:%H:%M}"
            self.out(f"     {when:<12} {i['kind']:<11} {(i.get('source') or {}).get('type', '?'):<13} "
                     f"{clip(i['title'], 64)}" + (f" ({i['status']})" if i.get("status") not in (None, "planned") else "")
                     + ("   ◀ accepted" if i["id"] in accepted else ""))
        by_id = {i["id"]: i for i in items}
        for a in st.accepted:
            cid = a.get("calendarItemId")
            item = by_id.get(cid)
            self.check(f"accepted {a['kind']} {cid} is on the calendar", item is not None,
                       f"{fmt_due(item['start'])}" if item else "missing from the 14-day window")
            if item:
                clashes = overlaps(item, items)
                self.check(f"accepted {a['kind']} {cid} overlaps nothing", not clashes,
                           "; ".join(clashes) if clashes else "")

    def chat(self, st: Student, text: str) -> dict[str, Any]:
        msgs = self.call("POST", "/chat", body={"studentId": st.id, "agentId": AGENT, "text": text})
        m = msgs[-1]
        route = next((t["summary"] for t in m.get("trace") or [] if t["tool"].endswith(".route")), "(no route trace)")
        self.out(f"  route: {clip(route, 200)}")
        self.out(f"  {m['role']} reply ({len(m.get('text') or '')} chars): {clip(m.get('text'), 300)}")
        self.out(f"  citations {len(m.get('citations') or [])}; cards {[c.get('type') for c in m.get('cards') or []]}"
                 + (f"; escalation {m['escalation']}" if m.get("escalation") else ""))
        for t in m.get("trace") or []:
            self.out(f"    trace {t['tool']:<34} {t['durationMs'] / 1000:6.1f}s  {clip(t['summary'], 100)}"
                     + (f"  ERROR {t['error']}" if t.get("error") else "") + (f"  dropped {t['dropped']}" if t.get("dropped") else ""))
        return m

    def s9_plan_chat(self, st: Student) -> None:
        m = self.chat(st, Q_PLAN)
        plan = next((c for c in m.get("cards") or [] if c.get("type") == "study_plan"), None)
        st.plan = plan
        if plan:
            for w in plan.get("weeks") or []:
                topics = list(dict.fromkeys(b["topic"] for b in w["blocks"]))
                self.out(f"    plan {w['label']}: {len(w['blocks'])} blocks, {sum(b['minutes'] for b in w['blocks'])} min"
                         f" — {', '.join(topics)}" + (f"  [{w['examNote']}]" if w.get("examNote") else ""))
        if m["role"] != "agent":
            raise Fail(f"the coach answered with a {m['role']} message: {clip(m.get('text'), 300)}")
        if "build_study_plan" not in (next((t["summary"] for t in m.get("trace") or [] if t["tool"].endswith(".route")), "")):
            self.warn("routed to something other than build_study_plan")
        if not plan:
            self.warn("no study_plan card in the reply")

    def s10_one_on_one(self, st: Student) -> None:
        one = self.call("GET", f"/one-on-one/{st.id}/current")
        r = one.get("recap") or {}
        self.out(f"  {one.get('id')} “{one.get('weekLabel')}” status {one.get('status')}")
        self.out(f"  recap: planned {r.get('plannedMinutes')} min / {r.get('blocksPlanned')} blocks; done "
                 f"{r.get('doneMinutes')} min / {r.get('blocksDone')} blocks; missed {r.get('blocksMissed')} blocks; "
                 f"streak {r.get('streakDays')} days")
        self.out(f"  recap topics: completed {r.get('completedTopics')}; skipped {r.get('skippedTopics')}")
        self.out(f"  recap weakTopicMovement {r.get('weakTopicMovement')}; flaggedTopics {r.get('flaggedTopics')}"
                 + (f"; note: {r['movementNote']}" if r.get("movementNote") else ""))
        for w in one.get("wins") or []:
            self.out(f"    win: {w}")
        for c in one.get("concerns") or []:
            self.out(f"    concern: {c}")
        for q in one.get("questions") or []:
            self.out(f"    question {q['id']}: {q['prompt']}")
        for adj in one.get("proposedAdjustments") or []:
            self.out(f"    adjustment {adj.get('change')}: {clip(adj.get('detail'), 140)}")
        if not one.get("questions"):
            raise Fail("the 1:1 has no questions to answer")
        q = one["questions"][0]
        one = self.call("POST", f"/one-on-one/{one['id']}/answer", body={"questionId": q["id"], "answer": ANSWER})
        self.out(f"  answered {q['id']}; status {one.get('status')}")
        one = self.call("POST", f"/one-on-one/{one['id']}/complete", body={"shareWithAdvisor": True})
        weeks = (one.get("adjustedPlan") or {}).get("weeks") or []
        self.out(f"  status {one.get('status')}; adjustedPlan {len(weeks)} week(s)")
        for n, w in enumerate(weeks, 1):
            self.out(f"    week {n} {w['label']}: {len(w['blocks'])} blocks — "
                     f"{', '.join(dict.fromkeys(b['topic'] for b in w['blocks']))}")
        self.out(f"  adjustedPlan week 1 block count: {len(weeks[0]['blocks']) if weeks else 0}")
        inbox = self.call("GET", "/advisor/inbox")
        mine = [t for t in inbox if t["studentId"] == st.id and t["question"].startswith("Weekly 1:1")]
        mine.sort(key=lambda t: t["createdAt"])
        if not mine:
            raise Fail("complete {shareWithAdvisor: true} created no ticket")
        self.out(f"  new ticket {mine[-1]['ticketId']}: {clip(mine[-1]['agentSummary'], 240)}")

    def s11_fee(self, st: Student) -> None:
        m = self.chat(st, Q_FEE)
        esc = m.get("escalation")
        self.check("escalation present", bool(esc), json.dumps(esc) if esc else "none")
        self.check("zero citations", not m.get("citations"), f"{len(m.get('citations') or [])} citation(s)"
                   + (f": {[c['sectionId'] for c in m['citations']]}" if m.get("citations") else ""))
        st.fee_ticket = (esc or {}).get("ticketId")

    def s12_advisor(self, st: Student) -> None:
        inbox = self.call("GET", "/advisor/inbox")
        self.out(f"  inbox: {len(inbox)} ticket(s)")
        for t in inbox:
            self.out(f"    {t['ticketId']} {t['studentId']:<6} {t['status']:<8} {clip(t['question'], 70)}")
        ticket = need(st.fee_ticket, "no ticket from step 11")
        res = self.call("POST", "/advisor/reply", body={"ticketId": ticket, "text": REPLY})
        self.out(f"  {res['ticketId']} → {res['status']}")
        thread = self.call("GET", f"/threads/{st.id}/{AGENT}")
        msgs = thread.get("messages") or []
        adv = [m for m in msgs if m["role"] == "advisor" and m.get("text") == REPLY
               and (m.get("escalation") or {}).get("ticketId") == ticket]
        self.check("advisor reply is in the student's academic_coach thread", bool(adv),
                   f"{adv[-1]['id']} ({len(msgs)} messages in thread)" if adv else f"not among {len(msgs)} messages")
        orig = next((m for m in msgs if m["role"] != "advisor" and (m.get("escalation") or {}).get("ticketId") == ticket), None)
        self.out(f"  original escalation on {orig['id'] if orig else '?'}: {(orig or {}).get('escalation')}")

    def s13_relevant(self, st: Student) -> None:
        need(st.ready, "lecture not ready")
        profile = json.loads((DATA / "students" / f"{st.id}.json").read_text(encoding="utf-8"))
        prof = profile.get("student") or profile.get("profile") or profile
        interest = (prof.get("interests") or [None])[0]
        section = st.stuck_section
        if section is None:
            section = need(st.section_at_marker, "no stuck section and no handout section near the marker time")
            self.out(f"  no stuck section; using the section at the marker ({MARKER['atSec']} s): {section['id']} "
                     f"“{section['heading']}”")
        source = {"type": "handout_section", "lectureId": st.lecture_id, "sectionId": section["id"],
                  **({"markerId": st.marker["id"]} if st.marker and st.marker.get("id") else {})}
        card = self.call("POST", "/relevant", body={"studentId": st.id, "interest": interest, "source": source})
        self.out(f"  interest {card.get('interest')} (profile: {interest}); concept {card.get('concept')}")
        self.out(f"  reframed: {clip(card.get('reframed'), 200)}")
        self.out(f"  citations {card.get('citationIds')}")

    # ---- orchestration ------------------------------------------------------------------
    def run_student(self, st: Student, prefix: str = "", steps: tuple[int, ...] = tuple(range(1, 14))) -> None:
        p = prefix
        if 1 in steps:
            if self.args.reset:
                self.step(f"{p}1", f"reset {st.id}", lambda: self.s1_reset(st))
            else:
                self.out()
                self.out(f"── {p}1. reset {st.id}: skipped (pass --reset)")
        if 2 in steps and st.id == "meera":
            self.step(f"{p}2", f"simulate-week {st.id}", lambda: self.s2_simulate(st))
        self.step(f"{p}3", f"create lecture ({st.mode}, {self.course}, {self.today})", lambda: self.s3_create(st))
        self.step(f"{p}4", f"stuck marker at {MARKER['atSec']} s", lambda: self.s4_marker(st))
        self.step(f"{p}5", "process and poll", lambda: self.s5_process(st))
        self.step(f"{p}6", "handout + cards", lambda: self.s6_results(st))
        self.step(f"{p}7", "accept first study + first prep", lambda: self.s7_accept(st))
        self.step(f"{p}8", "calendar, next 14 days", lambda: self.s8_calendar(st))
        self.step(f"{p}9", f"chat “{Q_PLAN}”", lambda: self.s9_plan_chat(st))
        if 10 in steps:
            self.step(f"{p}10", "weekly 1:1 round trip", lambda: self.s10_one_on_one(st))
            self.step(f"{p}11", f"chat “{Q_FEE}”", lambda: self.s11_fee(st))
            self.step(f"{p}12", "advisor reply lands in the DM", lambda: self.s12_advisor(st))
            self.step(f"{p}13", "Make it Relevant on the stuck section", lambda: self.s13_relevant(st))

    def diff(self, a: Student, b: Student) -> None:
        self.out()
        self.out(f"── 14. {a.id} vs {b.id}, same lecture")
        # titles are model-written, so the same action reads differently per run; kind + topic is what differs
        ka = [f"{x['kind']} {x['topic']}" for x in a.actions]
        kb = [f"{x['kind']} {x['topic']}" for x in b.actions]
        same_titles = sum(1 for x in a.actions if x["title"] in {y["title"] for y in b.actions})
        self.out(f"  actions: {a.id} {len(ka)} / {b.id} {len(kb)} ({same_titles} identical titles); by kind+topic only "
                 f"{a.id}: {[t for t in ka if t not in kb] or '—'}; only {b.id}: {[t for t in kb if t not in ka] or '—'}; "
                 f"both: {[t for t in ka if t in kb] or '—'}")

        def focus(st: Student) -> str:
            minutes: Counter[str] = Counter()
            for w in (st.plan or {}).get("weeks") or []:
                for x in w["blocks"]:
                    minutes[f"{x['topic']} ({x['course']})"] += x["minutes"]
            return ", ".join(f"{t} {m}m" for t, m in minutes.most_common(3)) or "no plan"
        self.out(f"  plan, top topics by minutes: {a.id} {focus(a)} | {b.id} {focus(b)}")

    def orphans(self) -> None:
        for st in self.students.values():
            for lid in st.orphans:
                try:
                    lec = self.client.get(f"/lectures/{lid}").json()
                except httpx.HTTPError as exc:
                    self.out(f"  abandoned audio lecture {lid}: {exc}")
                    continue
                self.out(f"  abandoned audio lecture {lid} ({st.id}) is now {lec.get('status')}"
                         + (f": {lec.get('error')}" if lec.get("error") else ""))
                thread = self.client.get(f"/threads/{st.id}/{AGENT}").json()
                msg = next((m for m in thread.get("messages") or []
                            if any(c.get("lectureId") == lid for c in m.get("cards") or [])
                            or (m["role"] == "system" and lid in json.dumps(m.get("trace")))), None)
                steps = [t for t in (msg or {}).get("trace") or [] if t["tool"].startswith("class_companion.")]
                if steps:
                    self.out("    its pipeline: " + ", ".join(f"{t['tool'].split('.')[-1]} {t['durationMs'] / 1000:.0f}s"
                                                          for t in steps)
                             + f"; total {sum(t['durationMs'] for t in steps) / 1000:.0f}s")

    def summary(self, code_hint: str = "") -> int:
        self.out()
        self.out("══ Summary")
        for s in self.steps:
            self.out(f"  {s['label']:>5}  {s['status']:<5} {s['secs']:7.1f}s  {s['name']}"
                     + (f"  — {clip(s['note'], 150)}" if s["note"] else ""))
        passed = sum(1 for _, ok, _ in self.asserts if ok)
        self.out(f"  asserts: {passed}/{len(self.asserts)} passed")
        for name, ok, detail in self.asserts:
            if not ok:
                self.out(f"    FAIL {name}: {detail}")
        for w in self.warnings:
            self.out(f"  warning: {w}")
        self.orphans()
        failed = [s for s in self.steps if s["status"] in ("FAIL", "SKIP")]
        code = 1 if failed or passed < len(self.asserts) or code_hint else 0
        self.out(f"  exit {code}" + (f" ({code_hint})" if code_hint else ""))
        return code


def overlaps(item: dict[str, Any], items: list[dict[str, Any]]) -> list[str]:
    """Timed items that intersect ``item``, plus an all-day exam or quiz on its day."""
    if item.get("allDay") or not item.get("end"):
        return []
    s, e = parse_dt(item["start"]), parse_dt(item["end"])
    out = []
    for o in items:
        if o["id"] == item["id"]:
            continue
        if o.get("allDay") or not o.get("end"):
            if o["kind"] in ("exam", "quiz") and o["start"][:10] == item["start"][:10]:
                out.append(f"{o['kind']} {o['title']} that day")
            continue
        os_, oe = parse_dt(o["start"]), parse_dt(o["end"])
        if s < oe and os_ < e:
            out.append(f"{o['kind']} {o['title']} {os_:%H:%M}–{oe:%H:%M}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--student", choices=STUDENTS, default="meera")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--audio", metavar="PATH", help="lecture audio (default: Lecture.mp3, found in the repo)")
    mode.add_argument("--transcript", action="store_true", help="use the CS F212 text fallback, no audio")
    ap.add_argument("--reset", action="store_true", help="POST /demo/reset for each student before its run")
    ap.add_argument("--keep-going", action="store_true", help="record failures and run the remaining steps")
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--poll-cap", type=int, default=180, help="seconds to wait for a lecture (default 180)")
    ap.add_argument("--log", default=str(Path(__file__).with_name("demo_run.log")))
    args = ap.parse_args()

    run = Run(args, Path(args.log))
    hint = ""
    try:
        run.preflight()
        mode_ = "transcript" if args.transcript else "audio"
        primary = run.students[args.student] = Student(args.student, mode_)
        run.run_student(primary)
        other_id = next(s for s in STUDENTS if s != args.student)
        # the other student gets the path that worked for the first one
        other = run.students[other_id] = Student(other_id, primary.mode)
        if primary.mode != mode_:
            run.out()
            run.out(f"   ({other_id} uses the transcript path too: the audio path failed for {args.student})")
        steps = (1, 3, 4, 5, 6, 7, 8, 9)
        run.run_student(other, prefix="14.", steps=steps)
        try:
            run.diff(primary, other)
        except Exception as exc:  # the diff is a printout; it must not cost the summary
            run.out(f"  diff failed: {type(exc).__name__}: {exc}")
            hint = "the step-14 diff failed"
    except Abort as exc:
        hint = f"stopped at step {exc}; rerun with --keep-going to run the rest"
    except KeyboardInterrupt:
        hint = "interrupted"
    code = run.summary(hint)
    run.log.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
