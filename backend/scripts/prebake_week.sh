#!/usr/bin/env bash
# Fallback 1:1 for the demo (26 Sep 2026): run a student's week through the real endpoints so their DM already
# holds a plan, a pre-marked week and an open Weekly 1:1. Run AFTER preload_demo.sh (it accepts actions from the
# student's preloaded lectures). Moves that student's clock 7 days on (the disclosed simulate-week step).
#   bash backend/scripts/prebake_week.sh aarav
set -euo pipefail
API="${API:-http://localhost:8000}"
S="${1:?student id, e.g. aarav}"

# accept up to 3 open actions from this student's lectures (reviews first: they carry the stuck taps)
python3 - "$API" "$S" <<'EOF'
import json, sys, urllib.request
api, s = sys.argv[1], sys.argv[2]
get = lambda p: json.load(urllib.request.urlopen(api + p))
def post(p, body):
    req = urllib.request.Request(api + p, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))
lectures = get(f"/students/{s}/lectures")
lectures = lectures if isinstance(lectures, list) else lectures.get("lectures", [])
acts = []
for lec in lectures:
    card = get(f"/lectures/{lec['id']}/cards").get("actions", {})
    acts += [a for a in card.get("actions", card.get("items", [])) if a.get("status") in (None, "suggested", "open", "proposed")]
acts.sort(key=lambda a: {"review": 0, "prep": 1, "study": 2}.get(a.get("kind"), 3))
for a in acts[:3]:
    post(f"/actions/{a['id']}", {"status": "accepted"})
    print("accepted", a["kind"], a["title"])
EOF

chat() { curl -sf -X POST "$API/chat" -H 'Content-Type: application/json' \
  -d "{\"studentId\":\"$S\",\"agentId\":\"academic_coach\",\"text\":\"$1\"}" \
  | python3 -c "import json,sys; ms=json.load(sys.stdin); print([ (m.get('role'), [c.get('type') for c in (m.get('cards') or [])]) for m in ms])"; }

echo "plan:";   chat "What should I study this week?"
echo "week:";   curl -sf -X POST "$API/demo/simulate-week/$S" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['done'], 'done', d['missed'], 'missed, clock', d['clockNow'])"
echo "1:1:";    chat "Run my weekly review"
echo "done"
