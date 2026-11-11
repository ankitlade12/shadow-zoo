#!/usr/bin/env bash
# Plays the scripted demo for the submission video in the IWSDK emulator while scripts/record.mjs
# records it. The beats:
#   - a first-time player: the lantern, the rabbit, feeding, petting, two more visitors, wearing the
#     dog, feeding the zoo, then the two-handed bird;
#   - the last creature found: the zoo is complete;
#   - a returning player: the welcome, the full zoo, today's visitor and a trick;
#   - the hands-only menu.
# It drives the game through built-in emulator hand poses, smooth hand motions and pinches only;
# no game code is bypassed. It waits on the game's dev-mode console lines, which the recorder
# writes to docs/video/live.log, and pauses the recording over page loads and setup. Chapter titles
# go to docs/video/chapters.txt for scripts/encode.py.
# Needs a dev server from:
#   iwsdk dev up --ai-mode agent --headless --allow-browser-automation --screenshot-width 1280 --screenshot-height 720
# Then: bash scripts/demo.sh
#       ./node_modules/.bin/iwsdk browser run scripts/render-audio.mjs --timeout 110000
#       python3 scripts/encode.py
set -u
cd "$(dirname "$0")/.."
B=./node_modules/.bin/iwsdk
V=docs/video
mkdir -p "$V"
rm -rf "$V/frames"
rm -f "$V/chapters.txt" "$V/stop" "$V/audio.wav" "$V/live.log"

FOV=64
# Head pitched down 8 degrees: the wall's light pool and the hands both stay in view.
HEAD='{"position":{"x":0,"y":1.6,"z":0},"orientation":{"x":-0.0698,"y":0,"z":0,"w":0.9976}}'
WRIST_X=0.05 WRIST_Y=1.3 WRIST_Z=-0.4

now_ms() { python3 -I -c 'import time; print(int(time.time() * 1000))'; }
pause() { sleep "$1"; }
chapter() {
  python3 -I -c 'import sys, time; print(f"{time.time():.3f}\t{sys.argv[1]}")' "$1" >>"$V/chapters.txt"
  echo "== $1"
}
xr() { $B xr "$1" --input-json "$2" >/dev/null 2>&1; }
ready() {
  for _ in $(seq 1 60); do
    [ "$($B dev status 2>/dev/null | python3 -I -c 'import sys,json; print(json.loads(sys.stdin.read())["data"]["state"].get("browserCommandReady"))' 2>/dev/null)" = True ] && return 0
  done
  return 1
}
in_xr() { $B xr status 2>/dev/null | grep -q '"sessionActive": true'; }

# The game's console lines matching a regex since a moment (ms since epoch), from the live log:
# "count" prints how many, "last" prints the newest.
logs() {
  python3 -I - "$1" "$2" "$3" "$V/live.log" <<'EOF'
import re, sys
pattern, since, mode, path = re.compile(sys.argv[1]), float(sys.argv[2]) / 1000, sys.argv[3], sys.argv[4]
hits = []
try:
    for line in open(path):
        t, _, text = line.rstrip('\n').partition('\t')
        if t and float(t) >= since and pattern.search(text):
            hits.append(text)
except FileNotFoundError:
    pass
print((hits[-1] if hits else '') if mode == 'last' else len(hits))
EOF
}
seen() { [ "$(logs "$1" "$2" count)" -gt 0 ]; }
wait_for() { # regex since seconds
  local start=$SECONDS
  while [ $((SECONDS - start)) -lt "$3" ]; do
    seen "$1" "$2" && return 0
    pause 0.15
  done
  echo "  (timed out waiting for /$1/)"
  return 1
}

hand_to() { # x y z fingers palm [seconds]: moves the right wrist like a person would
  xr animate-to "{\"device\":\"hand-right\",\"anchor\":\"wrist\",\"position\":{\"x\":$1,\"y\":$2,\"z\":$3},\"orientation\":{\"fingers\":$4,\"palm\":$5},\"duration\":${6:-1},\"easing\":\"minimum-jerk\"}"
}
pose() { # pose-fields [seconds]: reshapes the right hand
  xr set-hand-pose "{\"device\":\"hand-right\",$1,\"duration\":${2:-0.6}}"
}
shape() { # pose-fields fingers palm [x y z] [seconds]: reshape and move together
  pose "$1" "${7:-0.8}" &
  local reshaping=$!
  hand_to "${4:-$WRIST_X}" "${5:-$WRIST_Y}" "${6:-$WRIST_Z}" "$2" "$3" "${7:-0.8}"
  wait "$reshaping"
}
pinch() { xr select '{"device":"hand-right","duration":0.25}'; }
left_to() { # x y z fingers palm [seconds]: moves the left wrist like a person would
  xr animate-to "{\"device\":\"hand-left\",\"anchor\":\"wrist\",\"position\":{\"x\":$1,\"y\":$2,\"z\":$3},\"orientation\":{\"fingers\":$4,\"palm\":$5},\"duration\":${6:-1},\"easing\":\"minimum-jerk\"}"
}
make_bird() { # both hands open, thumbs hooked at the comfortable point, fingers fanned out as wings
  local since
  since=$(now_ms)
  xr set-hand-pose '{"device":"hand-left","poseId":"open","duration":0.8}' &
  local left_shape=$!
  left_to 0.061 "$WRIST_Y" "$WRIST_Z" '[-1,0.45,0]' '[0,0,-1]' 1.2 &
  local left_move=$!
  shape '"poseId":"open"' '[1,0.45,0]' '[0,0,-1]' 0.039 "$WRIST_Y" "$WRIST_Z" 1.2
  wait "$left_shape" "$left_move"
  wait_for 'sound reveal ' "$since" 12 && echo "  bird came alive"
}
left_rest() { left_to -0.3 0.95 -0.05 '[-0.3,0.2,-1]' '[0,-1,0]' 1.0; }
hands_rest() {
  xr set-transform '{"device":"hand-left","anchor":"wrist","position":{"x":-0.3,"y":0.95,"z":-0.05},"orientation":"auto"}'
  xr set-hand-pose '{"device":"hand-right","poseId":"default"}'
  xr set-transform '{"device":"hand-right","anchor":"wrist","position":{"x":0.28,"y":0.95,"z":-0.1},"orientation":"auto"}'
}
lower_hand() { # rests the right hand out of the light, smoothly
  shape '"poseId":"default"' '[0.3,0.2,-1]' '[0,-1,0]' 0.28 0.95 -0.1 1.0
}
landing_ready() { # waits until the landing page shows its button (the app loads after the shell)
  $B browser interact --input-json '{"timeoutMs":12000,"steps":[{"action":"wait","locator":{"role":"button","name":"Light the lantern"},"state":"visible"}]}' >/dev/null 2>&1
  pause 0.5
}
enter() { # presses "Light the lantern" for real, then frames the emulated headset as soon as XR starts
  $B browser interact --input-json '{"steps":[{"action":"click","locator":{"role":"button","name":"Light the lantern"}}]}' >/dev/null 2>&1
  local framed=no
  for _ in $(seq 1 15); do
    $B xr set-device-state --input-json "{\"state\":{\"inputMode\":\"hand\",\"fov\":$FOV,\"headset\":$HEAD}}" 2>/dev/null | grep -q '"ok": true' && { framed=yes; break; }
    pause 0.2
  done
  [ $framed = yes ] || { $B xr enter >/dev/null 2>&1; xr set-device-state "{\"state\":{\"inputMode\":\"hand\",\"fov\":$FOV,\"headset\":$HEAD}}"; }
  xr set-input-mode '{"mode":"hand"}'
  hands_rest
}
recorder_start() {
  node scripts/record.mjs >"$V/record.log" 2>&1 &
  RECORDER=$!
  for _ in $(seq 1 50); do grep -q listening "$V/record.log" 2>/dev/null && return 0; pause 0.2; done
  echo "the recorder did not start:"
  cat "$V/record.log"
  exit 1
}
rec() { # resume | pause | stop: steers the recorder and waits until it has acted
  touch "$V/$1"
  for _ in $(seq 1 100); do [ -f "$V/$1" ] || return 0; pause 0.05; done
}

# Built-in emulator approximations of each creature (see docs/checkpoint-phase3.md).
creature_pose() {
  case $1 in
    rabbit) echo '"poseId":"peace"|[0.45,1,0]|[0,0,-1]' ;;
    dog) echo '"poseId":"flat","fingers":{"thumb":"thumbs-up"}|[-1,0.1,0]|[0,0,1]' ;;
    crocodile) echo '"poseId":"flat","fingers":{"thumb":"open"}|[-1,0.05,0]|[0,0,-1]' ;;
    peacock) echo '"poseId":"open"|[0.2,1,0]|[0,0,-1]' ;;
    spider) echo '"poseId":"claw","fingers":{"thumb":"open"}|[0,-1,0]|[0,0,-1]' ;;
    turtle) echo '"poseId":"thumbs-up"|[0,-0.3,-1]|[0,-1,0]' ;;
  esac
}
make_creature() { # name [x y z]: makes the shape, then waits for the visitor to come alive
  local since p f pa
  since=$(now_ms)
  IFS='|' read -r p f pa <<<"$(creature_pose "$1")"
  shape "$p" "$f" "$pa" "${2:-$WRIST_X}" "${3:-$WRIST_Y}" "${4:-$WRIST_Z}"
  wait_for 'sound reveal ' "$since" 12 && echo "  $1 came alive"
}
wait_visitor() { # since seconds: prints "<species> [big|steady]"
  wait_for '\[ShadowZoo\] visitor ' "$1" "$2" >/dev/null
  logs '\[ShadowZoo\] visitor ' "$1" last | sed 's/.*visitor //'
}
pet() { # since: rests an open hand on the last fed creature, then sweeps the ground line if needed
  local x hx since
  x=$(logs 'sound eat ' "$1" last | python3 -I -c 'import sys; s = sys.stdin.read().split("@"); print(s[1].split()[0] if len(s) > 1 else 0)')
  hx=$(python3 -I -c "print(round(0.2 * float('${x:-0}') + 0.02, 3))")
  since=$(now_ms)
  shape '"poseId":"open"' '[0.05,1,0]' '[0,0,-1]' "$hx" 1.17 -0.4 1.0
  wait_for 'sound pet ' "$since" 4 && return 0
  hand_to -0.16 1.17 -0.4 '[0.05,1,0]' '[0,0,-1]' 1.2
  hand_to 0.17 1.17 -0.4 '[0.05,1,0]' '[0,0,-1]' 5
  wait_for 'sound pet ' "$since" 3
}

echo "== a first-time player"
recorder_start
SEED=fresh $B browser run scripts/seed-save.mjs >/dev/null 2>&1
landing_ready
rec resume
pause 3.5
rec pause

# 1. Light the lantern; your hand's shadow appears.
enter
rec resume
pause 2.5
chapter "Your hands cast shadows on your own wall"
shape '"poseId":"open"' '[0.1,1,0]' '[0,0,-1]' 0.03 1.27 -0.4 1.4
hand_to -0.02 1.29 -0.4 '[-0.05,1,0]' '[0,0,-1]' 1.2
hand_to 0.06 1.28 -0.4 '[0.15,1,0]' '[0,0,-1]' 1.2
pause 1

# 2. The first visitor: a rabbit, taught by the glowing ghost hand.
chapter "Make the shape it shows, and it comes alive"
make_creature rabbit
pause 2

# 3. Feed it: a pinch releases a firefly.
chapter "Feed it: a pinch releases a firefly"
since_feed=$(now_ms)
shape '"poseId":"point"' '[0,1,0]' '[0,0,-1]' -0.05 1.16 -0.4 0.9
pinch
pause 0.8
hand_to 0.07 1.18 -0.4 '[0,1,0]' '[0,0,-1]' 0.9
pinch
wait_for 'sound eat ' "$since_feed" 15 && echo "  it ate"
pause 2

# 4. Pet it: rest your shadow on it.
chapter "Pet it: let your shadow rest on it"
since_visitor=$(now_ms)
pet "$since_feed" && echo "  petted"
pause 1.5
lower_hand

# 5. Two more visitors.
v=$(wait_visitor "$since_visitor" 30)
echo "  visitor: $v"
chapter "Every visitor is a new shadow to learn"
since_visitor=$(now_ms)
make_creature "${v%% *}"
pause 1.5
lower_hand
v=$(wait_visitor "$since_visitor" 30)
echo "  visitor: $v"
make_creature "${v%% *}"
pause 2

# 6. Wear the dog and bark: the prey scatters.
chapter "Wear a creature: snap its jaw and it speaks"
lower_hand
pause 0.5
shape '"poseId":"flat","fingers":{"thumb":"thumbs-up","pinky":"open"}' '[-1,0.1,0]' '[0,0,1]' 0.15 1.3 -0.4 1.0
pause 1.2
since=$(now_ms)
for _ in 1 2 3; do
  pose '"poseId":"flat","fingers":{"thumb":"thumbs-up"}' 0.12
  pause 0.25
  pose '"poseId":"flat","fingers":{"thumb":"thumbs-up","pinky":"open"}' 0.15
  pause 0.6
done
echo "  barks: $(logs 'sound voice-dog ' "$since" count), flees: $(logs 'sound flee ' "$since" count)"
pause 1.5
lower_hand
pause 0.5

# 7. Feed the zoo: three fireflies, three meals, and the next visitor comes.
since_zoo=$(now_ms)
shape '"poseId":"point"' '[0,1,0]' '[0,0,-1]' -0.08 1.18 -0.4 0.9
pinch
pause 1.2
hand_to 0.02 1.2 -0.4 '[0,1,0]' '[0,0,-1]' 0.8
pinch
pause 1.2
hand_to 0.1 1.18 -0.4 '[0,1,0]' '[0,0,-1]' 0.8
pinch
wait_for 'visitor bird' "$since_zoo" 30 && echo "  meals: $(logs 'sound eat ' "$since_zoo" count)"
lower_hand

# 8. Two hands: the bird. Hook your thumbs and it takes wing.
chapter "Two hands make a bird, and it flies"
make_bird
pause 1
lower_hand &
lowering=$!
left_rest
wait "$lowering"
pause 3

rec pause

# 9. The last creature: the zoo is complete (a zoo with six of seven, after a little play).
echo "== the last creature"
SEED=almost $B browser run scripts/seed-save.mjs >/dev/null 2>&1
landing_ready
since=$(now_ms)
enter
v=$(wait_visitor "$since" 70)
echo "  visitor: $v"
pause 1
rec resume
chapter "Find all seven, and your zoo is complete"
make_creature turtle
pause 1
lower_hand
pause 4

rec pause

# 10. Tomorrow: the zoo remembers (the video dips through black to the next day).
echo "== a returning player"
SEED=returning $B browser run scripts/seed-save.mjs >/dev/null 2>&1
landing_ready
since=$(now_ms)
enter
rec resume
chapter "Come back tomorrow: your zoo remembers you"
v=$(wait_visitor "$since" 30)
echo "  daily visitor: $v"
species=${v%% *}
case $v in
  *big*)
    chapter "Daily visitors bring a twist"
    IFS='|' read -r p f pa <<<"$(creature_pose "$species")"
    shape "$p" "$f" "$pa" "$WRIST_X" "$WRIST_Y" "$WRIST_Z" 1.0
    since=$(now_ms)
    hand_to 0.035 1.285 -0.18 "$f" "$pa" 2.0
    wait_for 'sound reveal ' "$since" 10 && echo "  big $species came"
    ;;
  *)
    chapter "Today's visitor"
    make_creature "$species"
    ;;
esac
pause 2.5

# 11. A creature with three hearts does a trick when petted.
chapter "Pet a friend with three hearts and it does a trick"
since=$(now_ms)
shape '"poseId":"open"' '[0.05,1,0]' '[0,0,-1]' 0.0 1.17 -0.4 1.0
wait_for 'sound pet ' "$since" 4 || {
  hand_to -0.15 1.17 -0.4 '[0.05,1,0]' '[0,0,-1]' 1.2
  hand_to 0.16 1.17 -0.4 '[0.05,1,0]' '[0,0,-1]' 5
}
pause 2
lower_hand

# 12. The menu: point and pinch, no controllers.
chapter "A hands-only menu: point and pinch"
target() {
  $B xr list-targets 2>/dev/null | python3 -I -c "
import json, sys
d = json.loads(sys.stdin.read())
ts = ((d.get('data') or {}).get('result') or {}).get('targets') or []
p = [t['position'] for t in ts if t.get('name') == sys.argv[1]]
print(json.dumps(p[0]) if p else '')" "$1"
}
press() {
  local t
  t=$(target "$1")
  [ -z "$t" ] && { echo "  (no target $1)"; return 1; }
  xr look-at "{\"device\":\"hand-right\",\"target\":$t}"
  pause 0.5
  pinch
  pause 0.9
}
shape '"poseId":"default"' '[0,0.3,-1]' '[0,-1,0]' 0.15 1.2 -0.35 1.0
press open
pause 1
press assist
press assist
pause 0.6
press close
pause 0.5
lower_hand

# 13. Title card over the zoo.
chapter "=Shadow Zoo|Hand shadows that come alive on your wall|Play free on Meta Quest: ankitlade12.github.io/shadow-zoo"
pause 7

rec stop
wait "$RECORDER"
cat "$V/record.log"
