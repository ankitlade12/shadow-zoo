#!/usr/bin/env bash
# Emulator pose drill: resets the zoo through the menu, then brings all seven creatures to life
# with built-in emulator hand poses, timing each match. Needs a running headless dev server
# (iwsdk dev up --ai-mode agent --headless). Usage: bash scripts/drill.sh [output-dir]
set -u
cd "$(dirname "$0")/.."
B=./node_modules/.bin/iwsdk
OUT=${1:-docs/evidence/drill}
mkdir -p "$OUT"

json() { python3 -I -c "import sys,json; d=json.loads(sys.stdin.read()); print($1)"; }
ready() {
  for _ in $(seq 1 60); do
    [ "$($B dev status 2>/dev/null | json "d['data']['state'].get('browserCommandReady')" 2>/dev/null)" = "True" ] && return 0
  done
  return 1
}
tick() { $B xr status >/dev/null 2>&1; }
count() { matches "[ShadowZoo] sound $1 "; }
matches() {
  $B browser logs --input-json '{"count":200}' 2>/dev/null | python3 -I -c "
import sys,json
d=json.loads(sys.stdin.read())['data']; res=d.get('result',d); logs=res if isinstance(res,list) else res.get('logs',[])
print(sum(1 for l in logs if sys.argv[1] in str(l.get('message',''))))" "$1"
}
await_visitor() {
  local name=$1 before=$2 start=$SECONDS
  while [ $((SECONDS - start)) -lt 240 ]; do
    [ "$(matches "[ShadowZoo] visitor $name")" -gt "$before" ] && return 0
    tick
  done
  return 1
}
target() {
  $B xr list-targets 2>/dev/null | python3 -I -c "
import sys,json
d=json.loads(sys.stdin.read()); ts=((d.get('data') or {}).get('result') or {}).get('targets') or []
p=[t['position'] for t in ts if t.get('name')=='$1']; print(json.dumps(p[0]) if p else '')"
}
click() {
  local t
  t=$(target "$1")
  [ -z "$t" ] && { echo "  (no target $1)"; return 1; }
  $B xr set-hand-pose --input-json '{"device":"hand-right","poseId":"default"}' >/dev/null 2>&1
  $B xr set-transform --input-json '{"device":"hand-right","position":{"x":0.15,"y":1.2,"z":-0.35}}' >/dev/null 2>&1
  $B xr look-at --input-json "{\"device\":\"hand-right\",\"target\":$t}" >/dev/null 2>&1
  tick
  $B xr select --input-json '{"device":"hand-right","duration":0.3}' >/dev/null 2>&1
  tick
}
in_xr() { [ "$($B xr status 2>/dev/null | json "(d.get('data') or {}).get('result', {}).get('sessionActive')" 2>/dev/null)" = "True" ]; }
enter() {
  for _ in 1 2 3; do
    ready
    $B xr enter >/dev/null 2>&1
    in_xr && break
  done
  $B xr set-input-mode --input-json '{"mode":"hand"}' >/dev/null 2>&1
  $B xr set-transform --input-json '{"device":"headset","position":{"x":0,"y":1.6,"z":0},"orientation":{"pitch":0,"yaw":0,"roll":0}}' >/dev/null 2>&1
  $B xr set-transform --input-json '{"device":"hand-left","anchor":"wrist","position":{"x":-0.35,"y":0.9,"z":0.1},"orientation":"auto"}' >/dev/null 2>&1
  for _ in 1 2 3; do tick; done
}
place() {
  $B xr set-hand-pose --input-json "$1" >/dev/null 2>&1
  $B xr set-transform --input-json "{\"device\":\"hand-right\",\"anchor\":\"wrist\",\"position\":{\"x\":0.05,\"y\":1.3,\"z\":-0.4},\"orientation\":{\"fingers\":$2,\"palm\":$3}}" >/dev/null 2>&1
}
await_sound() {
  local name=$1 before=$2 limit=$3 start=$SECONDS
  while [ $((SECONDS - start)) -lt "$limit" ]; do
    [ "$(count "$name")" -gt "$before" ] && { echo $((SECONDS - start)); return 0; }
    tick
  done
  echo timeout
  return 1
}

echo "== reset the zoo through the menu"
$B browser reload >/dev/null 2>&1; ready; enter
click open; click reset; click reset
# Reset reloads the page: wait for the old XR session to end before entering again.
for _ in $(seq 1 20); do in_xr || break; tick; done
enter
in_xr || { echo "could not enter XR after reset"; exit 1; }

drill() {
  local name=$1 pose=$2 fingers=$3 palm=$4 limit=$5
  local before seen
  seen=$(matches "[ShadowZoo] visitor $name")
  # Keep the hand out of the light while waiting so the previous creature isn't worn.
  place '{"device":"hand-right","poseId":"default"}' '[0,1,0]' '[0,0,-1]'
  $B xr set-transform --input-json '{"device":"hand-right","anchor":"wrist","position":{"x":0.35,"y":0.9,"z":0.1},"orientation":"auto"}' >/dev/null 2>&1
  await_visitor "$name" "$seen" || { echo "$name: visitor never appeared"; return; }
  before=$(count reveal)
  place "$pose" "$fingers" "$palm"
  local took
  took=$(await_sound reveal "$before" "$limit")
  $B browser screenshot --output-file "$OUT/$name.png" >/dev/null 2>&1
  echo "$name: $took s"
}

# The two-handed bird: both hands open, thumbs together at the comfortable point, wrists crossed,
# fingers fanned out and up as wings (the layout of the game's canonical pair).
drill_pair() {
  local name=$1 limit=$2
  local before seen
  seen=$(matches "[ShadowZoo] visitor $name")
  place '{"device":"hand-right","poseId":"default"}' '[0,1,0]' '[0,0,-1]'
  $B xr set-transform --input-json '{"device":"hand-right","anchor":"wrist","position":{"x":0.35,"y":0.9,"z":0.1},"orientation":"auto"}' >/dev/null 2>&1
  await_visitor "$name" "$seen" || { echo "$name: visitor never appeared"; return; }
  before=$(count reveal)
  $B xr set-hand-pose --input-json '{"device":"hand-left","poseId":"open"}' >/dev/null 2>&1
  $B xr set-transform --input-json '{"device":"hand-left","anchor":"wrist","position":{"x":0.061,"y":1.3,"z":-0.4},"orientation":{"fingers":[-1,0.45,0],"palm":[0,0,-1]}}' >/dev/null 2>&1
  $B xr set-hand-pose --input-json '{"device":"hand-right","poseId":"open"}' >/dev/null 2>&1
  $B xr set-transform --input-json '{"device":"hand-right","anchor":"wrist","position":{"x":0.039,"y":1.3,"z":-0.4},"orientation":{"fingers":[1,0.45,0],"palm":[0,0,-1]}}' >/dev/null 2>&1
  local took
  took=$(await_sound reveal "$before" "$limit")
  $B browser screenshot --output-file "$OUT/$name.png" >/dev/null 2>&1
  echo "$name: $took s"
  # The left hand goes back down, out of the light.
  $B xr set-transform --input-json '{"device":"hand-left","anchor":"wrist","position":{"x":-0.35,"y":0.9,"z":0.1},"orientation":"auto"}' >/dev/null 2>&1
}

feed() {
  local before
  before=$(count eat)
  place '{"device":"hand-right","poseId":"point"}' '[0.2,1,0]' '[0,0,-1]'
  for _ in 1 2 3; do $B xr select --input-json '{"device":"hand-right"}' >/dev/null 2>&1; tick; done
  echo "  fed: $(await_sound eat "$before" 30) s"
}

echo "== drill (seconds from posing to reveal, timed after each visitor appears)"
drill rabbit '{"device":"hand-right","poseId":"peace"}' '[0.45,1,0]' '[0,0,-1]' 40
feed
drill dog '{"device":"hand-right","poseId":"flat","fingers":{"thumb":"thumbs-up"}}' '[-1,0.1,0]' '[0,0,1]' 70
drill crocodile '{"device":"hand-right","poseId":"flat","fingers":{"thumb":"open"}}' '[-1,0.05,0]' '[0,0,-1]' 70
drill_pair bird 80
drill peacock '{"device":"hand-right","poseId":"open"}' '[0.2,1,0]' '[0,0,-1]' 80
drill spider '{"device":"hand-right","poseId":"claw","fingers":{"thumb":"open"}}' '[0,-1,0]' '[0,0,-1]' 80
drill turtle '{"device":"hand-right","poseId":"thumbs-up"}' '[0,-0.3,-1]' '[0,-1,0]' 80
$B browser screenshot --output-file "$OUT/zoo.png" >/dev/null 2>&1
echo "== done; screenshots in $OUT"
