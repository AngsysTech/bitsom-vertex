"""Lecture mind map (contracts.ts v3.9, AGENTS.md §9.6). Built 26 Sep 2026.

A view over what the class companion already produced: the handout, the coverage and
actions cards, and the stuck markers. It is never a new source of facts. There is no model
call and no transcript read. Every label is the handout title, a handout heading, a handout
key point, or a coverage.missed topic.

Structure, in code: root = handout title, one node per HandoutSection in handout order, and
one child per key point. The Enstine mind-map builder was evaluated and not copied
(app/vendored/NOTICE.md, "Mind map"), so this tree is new code.

Overlay, in code:
  stuck           handout section `stuck`, coverage `confusion` and StuckMarkers, per section
  emphasized      coverage.emphasized, on the section whose segmentIds hold its segmentId
  ghost_missed    one per coverage.missed entry, under the root, placed in syllabus order
  reviewActionId  an action whose provenance.markerId or syllabusSectionId names the node

Cache: one `mindmap` doc per lecture stores a fingerprint of its inputs. Every GET reloads
the inputs (a few SQLite reads) and rebuilds only when the fingerprint changed. So a new
marker or a recomputed card shows up on the next GET without a rebuild call. The doc sits
under the lecture (parent_id), so POST /demo/reset clears it with the rest.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import Field

from app.core import db
from app.core.models import Model
from app.tools import companion

KIND = "mindmap"
BUILDER_VERSION = "mindmap.1"  # part of the fingerprint: a code change invalidates old caches


# ---- contracts.ts v3.9 (kept here, not in core/models.py, so no shared file changes) --------

class StuckFlag(Model):
    markerIds: list[str]
    atSec: list[float]


class EmphasizedFlag(Model):
    quote: str
    segmentId: str


class MissedFlag(Model):
    why: str


class NodeFlags(Model):
    stuck: Optional[StuckFlag] = None
    emphasized: Optional[EmphasizedFlag] = None
    missed: Optional[MissedFlag] = None
    reviewActionId: Optional[str] = None


class MindMapNode(Model):
    id: str
    kind: Literal["root", "section", "point", "ghost_missed"]
    label: str
    parentId: Optional[str] = None
    handoutSectionId: Optional[str] = None
    syllabusSectionId: Optional[str] = None
    segmentIds: Optional[list[str]] = None
    flags: NodeFlags = Field(default_factory=NodeFlags)
    order: int


class MindMapStats(Model):
    sections: int
    points: int
    stuck: int
    missed: int
    emphasized: int


class MindMap(Model):
    lectureId: str
    courseCode: str
    builtAt: str
    nodes: list[MindMapNode]
    stats: MindMapStats


# ---- inputs ----------------------------------------------------------------------------------

_MARKER_READERS = ("list_markers", "get_markers")


def _markers(lecture_id: str) -> list[dict[str, Any]]:
    """StuckMarker[] (contracts §9b) from the companion, which owns markers.

    The companion does not store markers yet (POST /lectures/:id/markers was not on main at
    14:50). Until it does, stuck flags come only from the handout's `stuck` and the coverage
    card's `confusion`. Once it exposes `list_markers(lecture_id)`, this reads it too.
    """
    for name in _MARKER_READERS:
        reader = getattr(companion, name, None)
        if callable(reader):
            return [m if isinstance(m, dict) else m.dump() for m in reader(lecture_id)]
    return []


def _inputs(lecture_id: str) -> dict[str, Any]:
    """The same data GET /handout and GET /cards serve. Raises NotFound (404) until ready."""
    handout = companion.get_handout(lecture_id).dump()
    cards = companion.get_cards(lecture_id)
    return {"handout": handout, "coverage": cards["coverage"], "actions": cards["actions"],
            "markers": _markers(lecture_id)}


def _fingerprint(inputs: dict[str, Any]) -> str:
    raw = json.dumps([BUILDER_VERSION, inputs], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


# ---- build -----------------------------------------------------------------------------------

def _syllabus_key(section_id: str | None) -> tuple[str, tuple[int, ...]] | None:
    """`syllabus.cs-f212.3.5` -> ("syllabus.cs-f212", (3, 5)); None when it has no number."""
    if not section_id:
        return None
    parts = section_id.split(".")
    nums: list[int] = []
    while parts and parts[-1].isdigit():
        nums.insert(0, int(parts.pop()))
    return (".".join(parts), tuple(nums)) if nums else None


def _ghost_position(children: list[tuple[str, dict[str, Any]]], syllabus_id: str) -> int:
    """Where a missed topic sits among the root's children: after the last child from the
    same syllabus that comes before it, else before the first that comes after it, else last."""
    key = _syllabus_key(syllabus_id)
    if key is None:
        return len(children)
    keys = [_syllabus_key(item.get("syllabusSectionId")) for _, item in children]
    before = [i for i, k in enumerate(keys) if k and k[0] == key[0] and k[1] < key[1]]
    if before:
        return before[-1] + 1
    after = [i for i, k in enumerate(keys) if k and k[0] == key[0]]
    return after[0] if after else len(children)


_STATUS_RANK = {"accepted": 0, "done": 0, "proposed": 1}
_KIND_RANK = {"review": 0, "study": 1, "prep": 2, "ask": 3, "resource": 4, "deadline": 5}


def _pick_action(candidates: list[tuple[int, int, dict[str, Any]]]) -> str | None:
    """The action to point at: marker matches before syllabus matches, accepted before
    proposed, review before study before prep, then card order. Dismissed ones never."""
    live = [(src, _STATUS_RANK[a["status"]], _KIND_RANK.get(a["kind"], 9), pos, a["id"])
            for src, pos, a in candidates if a.get("status") in _STATUS_RANK]
    return min(live)[-1] if live else None


def build(lecture_id: str, inputs: dict[str, Any]) -> dict[str, Any]:
    handout, coverage = inputs["handout"], inputs["coverage"]
    sections: list[dict[str, Any]] = handout["sections"]
    section_ids = {s["id"] for s in sections}
    seg_section: dict[str, str] = {}
    for s in sections:
        for seg in s.get("segmentIds", []):
            seg_section.setdefault(seg, s["id"])

    # stuck: three views of the same markers, merged per section, each marker once
    stuck: dict[str, dict[str, list]] = {}

    def flag_stuck(section_id: str | None, marker_id: str | None, at_sec: float | None) -> None:
        if section_id not in section_ids or not marker_id or at_sec is None:
            return
        entry = stuck.setdefault(section_id, {"markerIds": [], "atSec": []})
        if marker_id not in entry["markerIds"]:
            entry["markerIds"].append(marker_id)
            entry["atSec"].append(at_sec)

    for s in sections:
        mark = s.get("stuck") or {}
        for marker_id, at_sec in zip(mark.get("markerIds", []), mark.get("atSec", [])):
            flag_stuck(s["id"], marker_id, at_sec)
    for c in coverage.get("confusion", []):
        flag_stuck(c.get("handoutSectionId"), c.get("markerId"), c.get("atSec"))
    for m in inputs["markers"]:
        flag_stuck(m.get("handoutSectionId") or seg_section.get(m.get("segmentId", "")), m.get("id"), m.get("atSec"))

    # exam hints: the first emphasized quote whose segment a section owns
    emphasized: dict[str, dict[str, str]] = {}
    for e in coverage.get("emphasized", []):
        section_id = seg_section.get(e["segmentId"])
        if section_id and section_id not in emphasized:
            emphasized[section_id] = {"quote": e["quote"], "segmentId": e["segmentId"]}

    # actions by what they name
    by_marker: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    by_syllabus: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for pos, a in enumerate(inputs["actions"].get("items", [])):
        prov = a.get("provenance") or {}
        if prov.get("markerId"):
            by_marker.setdefault(prov["markerId"], []).append((pos, a))
        if prov.get("syllabusSectionId"):
            by_syllabus.setdefault(prov["syllabusSectionId"], []).append((pos, a))

    def action_for(marker_ids: list[str], syllabus_id: str | None) -> str | None:
        found = [(0, pos, a) for mid in marker_ids for pos, a in by_marker.get(mid, [])]
        found += [(1, pos, a) for pos, a in by_syllabus.get(syllabus_id or "", [])]
        return _pick_action(found)

    # the root's children: sections in handout order, missed topics placed in syllabus order
    children: list[tuple[str, dict[str, Any]]] = [("section", s) for s in sections]
    ghost_ids: set[str] = set()
    for miss in coverage.get("missed", []):
        ghost_id = f"miss:{miss['syllabusSectionId']}"
        while ghost_id in ghost_ids:  # two missed topics under one syllabus section
            ghost_id += "+"
        ghost_ids.add(ghost_id)
        children.insert(_ghost_position(children, miss["syllabusSectionId"]),
                        ("ghost_missed", {**miss, "id": ghost_id}))

    root_id = f"root:{lecture_id}"
    nodes: list[MindMapNode] = [MindMapNode(id=root_id, kind="root", label=handout["title"], order=0)]
    for order, (kind, item) in enumerate(children):
        if kind == "ghost_missed":
            nodes.append(MindMapNode(
                id=item["id"], kind="ghost_missed", label=item["topic"], parentId=root_id,
                syllabusSectionId=item["syllabusSectionId"], order=order,
                flags=NodeFlags(missed=MissedFlag(why=item["why"]),
                                reviewActionId=action_for([], item["syllabusSectionId"]))))
            continue
        section_node_id = f"sec:{item['id']}"
        stuck_flag = stuck.get(item["id"])
        nodes.append(MindMapNode(
            id=section_node_id, kind="section", label=item["heading"], parentId=root_id,
            handoutSectionId=item["id"], syllabusSectionId=item.get("syllabusSectionId"),
            segmentIds=list(item.get("segmentIds", [])) or None, order=order,
            flags=NodeFlags(
                stuck=StuckFlag(**stuck_flag) if stuck_flag else None,
                emphasized=EmphasizedFlag(**emphasized[item["id"]]) if item["id"] in emphasized else None,
                reviewActionId=action_for(stuck_flag["markerIds"] if stuck_flag else [],
                                          item.get("syllabusSectionId")))))
        for n, point in enumerate(item.get("keyPoints", [])):
            nodes.append(MindMapNode(id=f"pt:{item['id']}:{n}", kind="point", label=point,
                                     parentId=section_node_id, handoutSectionId=item["id"], order=n))

    stats = MindMapStats(
        sections=sum(n.kind == "section" for n in nodes),
        points=sum(n.kind == "point" for n in nodes),
        stuck=sum(n.flags.stuck is not None for n in nodes),
        missed=sum(n.kind == "ghost_missed" for n in nodes),
        emphasized=sum(n.flags.emphasized is not None for n in nodes))
    return MindMap(lectureId=lecture_id, courseCode=handout["courseCode"],
                   builtAt=datetime.now(timezone.utc).isoformat(), nodes=nodes, stats=stats).dump()


# ---- cache + public API ----------------------------------------------------------------------

def _store(lecture_id: str, inputs: dict[str, Any], fingerprint: str) -> dict[str, Any]:
    mind_map = build(lecture_id, inputs)
    student_id = companion.get_lecture(lecture_id).studentId
    db.put(KIND, lecture_id, {"fingerprint": fingerprint, "map": mind_map},
           student_id=student_id, parent_id=lecture_id)
    return mind_map


def get_mindmap(lecture_id: str) -> dict[str, Any]:
    """GET /lectures/:id/mindmap. Rebuilds lazily when any input changed since the last build."""
    inputs = _inputs(lecture_id)
    fingerprint = _fingerprint(inputs)
    cached = db.get(KIND, lecture_id)
    if cached and cached.get("fingerprint") == fingerprint:
        return cached["map"]
    return _store(lecture_id, inputs, fingerprint)


def rebuild(lecture_id: str) -> dict[str, Any]:
    """POST /lectures/:id/mindmap/rebuild. Always rebuilds."""
    inputs = _inputs(lecture_id)
    return _store(lecture_id, inputs, _fingerprint(inputs))
