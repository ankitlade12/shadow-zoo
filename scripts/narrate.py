#!/usr/bin/env python3
"""Voices the demo video.

Reads scripts/narration.json: each line anchored to a beat in docs/video/chapters.txt ("start" is the
beginning and "=" the closing card). Each line is spoken by its take, docs/video/voice-lines/NN.wav
(NN is the line's number in scripts/narration.json): voice the lines with scripts/synth_voice.py, or
record them yourself with scripts/record_voice.py. With no takes yet, it drafts every line in the
macOS voice named there.
macOS licenses its system voices for personal, non-commercial use only, so that draft is for
checking timing, not for publishing. It places every line on the joined recording's timeline after
its beat, never letting two lines overlap, and writes:
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
TAKES = os.path.join(ROOT, 'voice-lines')
GAP = 0.3


def seconds(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def take(i):
    """The recorded take of line i of scripts/narration.json."""
    return os.path.join(TAKES, f'{i:02d}.wav')


def cues():
    """The script, the video's length, and (line number, line, wished start) for each line whose beat is in this recording."""
    spec = json.load(open(SCRIPT))
    _, spans, end = timeline()
    anchors = {'start': 0.0}
    for at, text in chapter_times(spans, end):
        anchors.setdefault('=' if text.startswith('=') else text, at)
    found = [(i, line, anchors[line['at']] + line.get('after', 0.0)) for i, line in enumerate(spec['lines']) if line['at'] in anchors]
    return spec, end, found


def main():
    spec, end, found = cues()
    used = {i for i, _, _ in found}
    for i, line in enumerate(spec['lines']):
        if i not in used:
            print(f'  skip (no beat "{line["at"]}" in this recording): {line["text"][:50]}')
    if not found:
        sys.exit('no narration lines matched the recording')
    recorded = os.path.isdir(TAKES) and any(name.endswith('.wav') for name in os.listdir(TAKES))
    if recorded:
        missing = [i for i, _, _ in found if not os.path.exists(take(i))]
        if missing:
            sys.exit(f'no take for line(s) {", ".join(map(str, missing))}: run scripts/synth_voice.py or scripts/record_voice.py')
        source = 'the takes in docs/video/voice-lines'
    else:
        source = f'draft macOS voice "{spec["voice"]}", not for publishing'
        print('  draft: macOS licenses its system voices for personal, non-commercial use only; voice the lines with scripts/synth_voice.py or record them with scripts/record_voice.py before publishing')
    work = tempfile.mkdtemp(prefix='narration-')
    lines, last = [], 0.0
    for i, line, wished in found:
        start = max(wished, last + GAP if lines else 0.0)
        source_path = take(i)
        if not recorded:
            source_path = os.path.join(work, f'line{i:02d}.aiff')
            subprocess.run(['say', '-v', spec['voice'], '-o', source_path, line['text']], check=True)
        wav = os.path.join(work, f'line{i:02d}.wav')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', source_path, '-ar', '48000', '-ac', '2', wav], check=True)
        length = seconds(wav)
        lines.append({'start': round(start, 3), 'end': round(start + length, 3), 'text': line['text'], 'path': wav})
        late = start - wished
        print(f'  {start:6.2f}-{start + length:6.2f}  {"(+%.1f s late) " % late if late > 0.05 else ""}{line["text"]}')
        last = start + length
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
    print(f'wrote docs/video/voice.wav and narration.json: {len(lines)} lines, voice: {source}, video {end:.1f} s')


if __name__ == '__main__':
    main()
