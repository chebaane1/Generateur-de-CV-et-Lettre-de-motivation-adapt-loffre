#!/usr/bin/env bash
# Start only the engines you want. The others are hidden on the web page.
#   ./bots.sh claude          only Claude
#   ./bots.sh gemini local    Gemini + local model
#   ./bots.sh all             all three
# Then open http://localhost:8080
set -e
cd "$(dirname "$0")"

[ $# -eq 0 ] && { echo "Usage: $0 claude|gemini|local|all [...]"; exit 1; }
want=" $* "
[[ $want == *" all "* ]] && want=" claude gemini local "

# the web page only offers the engines launched here (read on every request, no restart needed)
mkdir -p data
engines=$(for b in claude gemini local; do if [[ $want == *" $b "* ]]; then printf '"%s",' "$b"; fi; done)
echo "[${engines%,}]" > data/engines.json

# app (web page + pipeline) and pdf always run; ollama only for the local model
services="app pdf"
[[ $want == *" local "* ]] && services="$services ollama"
docker-compose up -d $services

# free the RAM used by the local model when it's off
[[ $want == *" local "* ]] || docker-compose stop ollama >/dev/null 2>&1 || true

for b in claude gemini local; do
  if [[ $want == *" $b "* ]]; then echo "$b: ON"; else echo "$b: off"; fi
done
echo "Done. Open http://localhost:8080"
