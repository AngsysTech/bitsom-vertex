#!/usr/bin/env bash
# Preload processed lectures for the demo fallback (26 Sep 2026).
#
# Uploads stage clips from backend/data/stage/ through the same API the UI uses (POST /lectures as an
# upload, then /process), so each one runs the real pipeline: STT → handout → coverage → actions, and the
# "I'm stuck" chapter marks inside each file become StuckMarkers. Nothing is canned. Dated to the course's
# last class this week so they read as "recorded in class earlier this week".
#
# Kept OUT on purpose, for the live demo: B (CS F212 B+ tree, Meera), E as Meera, C, H, dbms_demo.mp3.
#
# POST /demo/reset/<student> deletes these. Re-run this script after any reset:
#   bash backend/scripts/preload_demo.sh            # all of the list below
#   API=http://localhost:8000 bash backend/scripts/preload_demo.sh
set -euo pipefail
API="${API:-http://localhost:8000}"
STAGE="$(cd "$(dirname "$0")/.." && pwd)/data/stage"

# student | course | date (last session) | file
LIST=(
  "meera|CS F212|2026-09-24|A_CS-F212_transactions_CMU-L15.m4a"
  "meera|CS F372|2026-09-25|D_CS-F372_cpu-scheduling.m4a"
  "aarav|CS F303|2026-09-25|E_CS-F303_tcp-flow-control_Kurose.m4a"
  "aarav|MATH F241|2026-09-23|G_MATH-F241_bayes_Stat110-L5.m4a"
  "rohan|CS F351|2026-09-23|F_CS-F351_automata_MIT-18.404.m4a"
)

field() { python3 -c "import json,sys; print(json.load(sys.stdin).get('$1',''))"; }

ids=()
for row in "${LIST[@]}"; do
  IFS='|' read -r student course day file <<<"$row"
  lid=$(curl -sf -X POST "$API/lectures" -F "studentId=$student" -F "courseCode=$course" -F "date=$day" \
        -F "source=upload" -F "audio=@$STAGE/$file" | field id)
  curl -sf -X POST "$API/lectures/$lid/process" >/dev/null
  echo "started $lid  $student  $course  $file"
  ids+=("$lid")
done

pending=("${ids[@]}")
while ((${#pending[@]})); do
  sleep 10
  next=()
  for lid in "${pending[@]}"; do
    status=$(curl -sf -m 10 "$API/lectures/$lid" | field status || echo "unreachable")
    case "$status" in
      ready|error|failed) echo "$(date +%H:%M:%S) $lid → $status" ;;
      *) next+=("$lid") ;;
    esac
  done
  pending=("${next[@]+"${next[@]}"}")
done
echo "done"
