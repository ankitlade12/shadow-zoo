#!/usr/bin/env python3
"""Voices the demo video with macOS text to speech.

Reads scripts/narration.json (the voice, and each line anchored to a beat in docs/video/chapters.txt:
"start" is the beginning and "=" the closing card). Renders every line, places it on the joined
recording's timeline after its beat, never letting two lines overlap, and writes:
  docs/video/voice.wav        the voiceover track (48 kHz stereo)
  docs/video/narration.json   each line's start, end and text, which scripts/encode.py captions

Run after scripts/demo.sh and before scripts/encode.py. Usage: python3 scripts/narrate.py
"""
import json
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from encode import ROOT, chapter_times, timeline  # noqa: E402

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'narration.json')
GAP = 0.3


def seconds(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def main():
    spec = json.load(open(SCRIPT))
    _, spans, end = timeline()
    anchors = {'start': 0.0}
    for at, text in chapter_times(spans, end):
        anchors.setdefault('=' if text.startswith('=') else text, at)
    work = tempfile.mkdtemp(prefix='narration-')
    lines, last = [], 0.0
    for i, line in enumerate(spec['lines']):
        if line['at'] not in anchors:
            print(f'  skip (no beat "{line["at"]}" in this recording): {line["text"][:50]}')
            continue
        start = max(anchors[line['at']] + line.get('after', 0.0), last + GAP if lines else 0.0)
        aiff = os.path.join(work, f'line{i:02d}.aiff')
        wav = os.path.join(work, f'line{i:02d}.wav')
        subprocess.run(['say', '-v', spec['voice'], '-o', aiff, line['text']], check=True)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', aiff, '-ar', '48000', '-ac', '2', wav], check=True)
        length = seconds(wav)
        lines.append({'start': round(start, 3), 'end': round(start + length, 3), 'text': line['text'], 'path': wav})
        late = start - (anchors[line['at']] + line.get('after', 0.0))
        print(f'  {start:6.2f}-{start + length:6.2f}  {"(+%.1f s late) " % late if late > 0.05 else ""}{line["text"]}')
        last = start + length
    if not lines:
        sys.exit('no narration lines matched the recording')
    if last > end:
        print(f'  warning: the voice runs {last - end:.1f} s past the video ({end:.1f} s)')

    args = ['ffmpeg', '-y', '-loglevel', 'error']
    for line in lines:
        args += ['-i', line['path']]
    delays = [f'[{i}:a]adelay={int(line["start"] * 1000)}|{int(line["start"] * 1000)}[d{i}]' for i, line in enumerate(lines)]
    mix = ''.join(f'[d{i}]' for i in range(len(lines))) + f'amix=inputs={len(lines)}:normalize=0:duration=longest'
    # An even, clear voice level for a video: about -16 LUFS.
    graph = ';'.join(delays + [mix + ',loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[voice]'])
    args += ['-filter_complex', graph, '-map', '[voice]', '-ar', '48000', '-ac', '2', os.path.join(ROOT, 'voice.wav')]
    subprocess.run(args, check=True)
    json.dump([{k: v for k, v in line.items() if k != 'path'} for line in lines], open(os.path.join(ROOT, 'narration.json'), 'w'), indent=1)
    print(f'wrote docs/video/voice.wav and narration.json: {len(lines)} lines, voice "{spec["voice"]}", video {end:.1f} s')


if __name__ == '__main__':
    main()
