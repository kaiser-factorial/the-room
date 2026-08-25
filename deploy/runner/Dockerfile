# the-room runner as a Hugging Face Docker Space.
# The runner is a control-plane daemon (polls room_control in Supabase for
# admin start/stop/say); the HTTP server it exposes on $PORT is a liveness
# probe only. Secrets required on the Space (never in this repo):
#   OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
# Note: session JSONL written here is EPHEMERAL (wiped on rebuild/restart) —
# Supabase is the durable record for hosted sessions. Mount an HF bucket at
# a volume later if hosted JSONL needs to persist.

FROM node:22-slim

# HF Spaces run the container as uid 1000 — node:22-slim already ships a
# 'node' user at uid 1000 (a fresh useradd fails: "UID 1000 is not unique").
USER node
ENV HOME=/home/node
WORKDIR /home/node/app

COPY --chown=node package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node src ./src
COPY --chown=node conditions ./conditions

EXPOSE 7860
CMD ["npm", "run", "runner"]
