#!/usr/bin/env bash
# Encodes frames captured by scripts/record.mjs into docs/video/shadow-zoo-demo.mp4, keeping the
# real timing between frames and labeling the footage as emulator footage.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=docs/video/frames
OUT=docs/video/shadow-zoo-demo.mp4
python3 -I - "$DIR" <<'EOF'
import json, os, sys
d = sys.argv[1]
times = json.load(open(os.path.join(d, 'times.json')))
with open(os.path.join(d, 'list.txt'), 'w') as f:
    f.write('ffconcat version 1.0\n')
    for i, t in enumerate(times):
        f.write(f"file 'f{i:05d}.jpg'\n")
        nxt = times[i + 1] if i + 1 < len(times) else t + 1 / 30
        f.write(f'duration {max(1 / 60, min(1.0, nxt - t)):.4f}\n')
    f.write(f"file 'f{len(times) - 1:05d}.jpg'\n")
print(f'{len(times)} frames, {times[-1] - times[0]:.1f} s')
EOF
FONT=/System/Library/Fonts/Supplemental/Arial.ttf
LABEL="IWSDK WebXR emulator footage - emulated hand tracking - no physical headset"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$DIR/list.txt" \
  -vf "scale=1280:-2,fps=30,drawtext=fontfile=$FONT:text='$LABEL':x=16:y=h-34:fontsize=18:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=6" \
  -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "$OUT"
echo "wrote $OUT"
