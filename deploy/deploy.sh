#!/usr/bin/env bash
# F3: deploy the-room to Hugging Face Spaces.
#   ./deploy/deploy.sh <namespace>          # both spaces
#   ./deploy/deploy.sh <namespace> viewer   # just one
#   ./deploy/deploy.sh <namespace> runner
#
# Needs: hf CLI authed with a write token (HF_TOKEN or hf auth login).
# Runner secrets: set OPENROUTER_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_KEY
# in the environment when running this script and they'll be pushed as Space
# secrets; any that are missing must be set later:
#   hf spaces secrets add <ns>/the-room-runner KEY=value
set -euo pipefail
cd "$(dirname "$0")/.."

NS=${1:?usage: deploy.sh <namespace> [viewer|runner]}
TARGET=${2:-all}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

if [[ $TARGET == all || $TARGET == viewer ]]; then
  echo "── viewer → $NS/the-room (static, public)"
  mkdir -p "$STAGE/viewer"
  cp viewer/index.html "$STAGE/viewer/index.html"
  # §9.8: the page the room builds for itself, served from the same Space.
  cp viewer/site.html "$STAGE/viewer/site.html"
  # §9.9/§9.11: everything every room made — pages, files, code output.
  cp viewer/made.html "$STAGE/viewer/made.html"
  npx tsx src/conditions-info.ts > "$STAGE/viewer/conditions.json"
  cat > "$STAGE/viewer/README.md" <<'EOF'
---
title: the-room
emoji: 🚪
colorFrom: gray
colorTo: indigo
sdk: static
app_file: index.html
short_description: Six AI models in a task-free room. Watch live.
---

# the-room — live viewer

Six different AI models locked in a task-free, facilitator-free group
conversation; this page replays and live-streams sessions from the Supabase
mirror (read-only anon key). The apparatus measures linguistic drift —
whether the models keep their own voices or converge toward a room-voice.

`site.html` serves the website the room built for itself, live as it is
written — the room's own index.html, rendered in a sandboxed frame.

`made.html` is everything every room has made: a gallery of the pages, and
for each room a workspace showing its files version by version (with the
changes between them) and the output of every piece of code it ran.
EOF
  hf repos create "$NS/the-room" --type space --space-sdk static --public --exist-ok
  hf upload "$NS/the-room" "$STAGE/viewer" . --repo-type space
  echo "   https://huggingface.co/spaces/$NS/the-room"
fi

if [[ $TARGET == all || $TARGET == runner ]]; then
  echo "── runner → $NS/the-room-runner (docker, private)"
  mkdir -p "$STAGE/runner"
  cp deploy/runner/Dockerfile package.json package-lock.json tsconfig.json "$STAGE/runner/"
  cp -r src conditions "$STAGE/runner/"
  cat > "$STAGE/runner/README.md" <<'EOF'
---
title: the-room runner
emoji: 🎛️
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
short_description: Session daemon for the-room (admin control plane).
---

# the-room — runner daemon

Polls `room_control` for admin start/stop/say commands and runs sessions.
Secrets required: `OPENROUTER_API_KEY`, `SUPABASE_URL`,
`SUPABASE_SERVICE_KEY`. The HTTP endpoint is a liveness probe only.
Session JSONL here is ephemeral — Supabase is the durable record for
hosted sessions.
EOF
  SECRET_ARGS=()
  for key in OPENROUTER_API_KEY SUPABASE_URL SUPABASE_SERVICE_KEY XAI_API_KEY; do
    if [[ -n "${!key:-}" ]]; then SECRET_ARGS+=(--secrets "$key=${!key}"); else echo "   NOTE: $key not in env — set it later with: hf spaces secrets add $NS/the-room-runner $key=..."; fi
  done
  hf repos create "$NS/the-room-runner" --type space --space-sdk docker --private --exist-ok "${SECRET_ARGS[@]}"
  hf upload "$NS/the-room-runner" "$STAGE/runner" . --repo-type space --exclude "**/__pycache__/**"
  echo "   https://huggingface.co/spaces/$NS/the-room-runner"
fi

echo "Done. Check build: hf spaces logs $NS/the-room-runner --build --follow"
