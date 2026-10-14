#!/usr/bin/env bash
# Start only the engines you want. The others are turned off in n8n and hidden on the web page.
#   ./bots.sh claude          only Claude
#   ./bots.sh gemini local    Gemini + local model
#   ./bots.sh all             all three
# Then open http://localhost:8080
set -e
cd "$(dirname "$0")"

[ $# -eq 0 ] && { echo "Usage: $0 claude|gemini|local|all [...]"; exit 1; }
want=" $* "
[[ $want == *" all "* ]] && want=" claude gemini local "

# claude-bridge is always needed: it serves the web page, the prompts and the Gemini calls
services="n8n xelatex-api claude-bridge"
[[ $want == *" local "* ]] && services="$services ollama"
docker-compose up -d $services

# the web page only offers the engines launched here
engines=$(for b in claude gemini local; do if [[ $want == *" $b "* ]]; then printf '"%s",' "$b"; fi; done)
echo "[${engines%,}]" > web/engines.json

declare -A NAMES=([claude]="Claude (Pro plan)" [gemini]="Gemini" [local]="Local (Ollama)")
workflows=$(docker exec n8n n8n list:workflow 2>/dev/null)
for bot in claude gemini local; do
  id=$(awk -F'|' -v n="CV and Cover Letter Generator - ${NAMES[$bot]}" '$2==n {print $1; exit}' <<< "$workflows")
  if [ -z "$id" ]; then echo "$bot: workflow not imported in n8n, skipped"; continue; fi
  if [[ $want == *" $bot "* ]]; then
    docker exec n8n n8n publish:workflow --id="$id" >/dev/null 2>&1 && echo "$bot: ON"
  else
    docker exec n8n n8n unpublish:workflow --id="$id" >/dev/null 2>&1 && echo "$bot: off"
  fi
done

# n8n only picks up workflow changes on restart
docker restart n8n >/dev/null

# free the RAM used by the local model when its bot is off
[[ $want == *" local "* ]] || docker-compose stop ollama >/dev/null 2>&1 || true
echo "Done. Open http://localhost:8080"
