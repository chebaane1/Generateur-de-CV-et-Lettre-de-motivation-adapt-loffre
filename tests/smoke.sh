#!/usr/bin/env bash
# End-to-end smoke test, no AI call: compiles a sample CV + letter through the running app and checks the page.
# Needs the app running (./bots.sh … locally, docker compose in CI).
#   tests/smoke.sh                       against http://localhost:8080
#   BASE_URL=http://host:port tests/smoke.sh
set -euo pipefail
cd "$(dirname "$0")"

BASE_URL=${BASE_URL:-http://localhost:8080}
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
fail() { echo "❌ $*"; exit 1; }
ok()   { echo "✅ $*"; }

# wait for the app (containers may still be starting)
for _ in $(seq 1 30); do curl -sf "$BASE_URL/health" >/dev/null && break; sleep 2; done
curl -sf "$BASE_URL/health" >/dev/null || fail "app not reachable at $BASE_URL"
ok "app is up"

# compile a fixture through POST /api/compile, save the PDF, check it
compile() {   # kind fixture
  python3 - "$1" "fixtures/$2" "$BASE_URL" "$OUT/$1.pdf" <<'EOF'
import base64, json, sys, urllib.request
kind, fixture, base, out = sys.argv[1:]
body = json.dumps({"kind": kind, "content": json.load(open(fixture, encoding="utf-8"))}).encode()
req = urllib.request.Request(f"{base}/api/compile", body, {"content-type": "application/json"})
res = json.load(urllib.request.urlopen(req, timeout=180))
if not res.get("ok"):
    sys.exit(f"{kind}: {res.get('error')}")
open(out, "wb").write(base64.b64decode(res["pdf"]))
EOF
}

pages() { python3 -c "import re,sys;print(len(re.findall(rb'/Type\s*/Page[^s]', open(sys.argv[1],'rb').read())))" "$1"; }

for kind in resume letter; do
  fixture=$([ "$kind" = resume ] && echo resume.json || echo letter.json)
  compile "$kind" "$fixture" || fail "$kind PDF failed to compile"
  head -c 4 "$OUT/$kind.pdf" | grep -q '%PDF' || fail "$kind: not a PDF"
  if command -v pdfinfo >/dev/null; then
    n=$(pdfinfo "$OUT/$kind.pdf" | awk '/^Pages:/ {print $2}')
    fonts=$(pdffonts "$OUT/$kind.pdf" 2>/dev/null || true)
  else
    n=$(pages "$OUT/$kind.pdf"); fonts=""
  fi
  [ "$kind" != resume ] || [ "$n" = 1 ] || fail "CV must be exactly one page (got $n)"
  if [ "$kind" = resume ] && [ -n "$fonts" ]; then
    grep -qi 'TeXGyreTermes' <<< "$fonts" || fail "CV font TeX Gyre Termes missing"
  fi
  ok "$kind PDF compiled ($(wc -c < "$OUT/$kind.pdf") bytes, ${n:-?} page(s))"
done

# the page and its scripts
curl -sf "$BASE_URL/" | grep -q 'id="allDialog"' || fail "page or All CVs popup missing"
for js in app all-cvs; do curl -sf "$BASE_URL/$js.js" >/dev/null || fail "/$js.js not served"; done
curl -sf "$BASE_URL/api/history" | grep -q '"ok":true' || fail "/api/history (database) failed"
curl -sf "$BASE_URL/api/engines" | grep -q '"engines"' || fail "/api/engines failed"
ok "page, scripts, database and engines respond"

echo "All smoke tests passed."
