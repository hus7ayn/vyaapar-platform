#!/usr/bin/env bash
# Ralph loop for MSW Global — runs a fresh agent per iteration until every
# story in ralph/prd.json has status "pass". Adapted from snarktank/ralph.
#
# Usage:  bash ralph/ralph.sh [max_iterations]
# Requires: claude CLI on PATH, python3, a clean-ish working tree.
set -uo pipefail
cd "$(dirname "$0")/.."

MAX_ITERS="${1:-20}"

remaining() {
  python3 -c "import json;print(sum(1 for s in json.load(open('ralph/prd.json'))['stories'] if s.get('status')!='pass'))"
}

for i in $(seq 1 "$MAX_ITERS"); do
  left="$(remaining)"
  echo "=== ralph iteration $i / $MAX_ITERS — $left story(ies) remaining ==="
  if [ "$left" -eq 0 ]; then
    echo "All stories pass. Ralph done."
    exit 0
  fi
  # One fresh agent, one story. --dangerously-skip-permissions for unattended runs;
  # drop that flag to run with normal permission prompts.
  claude -p "$(cat ralph/prompt.md)" --dangerously-skip-permissions \
    || echo "(iteration $i exited non-zero — continuing to next)"
done

echo "Reached max iterations ($MAX_ITERS). $(remaining) story(ies) still open."
