#!/usr/bin/env python3
"""Records the demo video's voiceover in your own voice, one line at a time.

macOS licenses its system voices for personal, non-commercial use only, so the draft voice from
scripts/narrate.py can't go in a published video. This records a voice you own instead. For each
line of scripts/narration.json that the recording uses, it shows the text and how long the line
has before the next one starts. It records the microphone until you press Enter, trims the silence
at both ends, evens out the level and plays the take back. Then it saves the take as
docs/video/voice-lines/NN.wav (git-ignored). When every line has a take, it offers to rebuild the
voiceover and the video (scripts/narrate.py, then scripts/encode.py).

Usage: python3 scripts/record_voice.py            record each line that has no take yet
       python3 scripts/record_voice.py 3 7        record lines 3 and 7 again
       python3 scripts/record_voice.py --mics     list the microphones (then pass --mic NAME or INDEX)
Needs ffmpeg. The first recording asks for microphone access for your terminal app.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from narrate import GAP, TAKES, cues, seconds, take  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WARM_UP = 0.6  # seconds for the microphone to open before you start reading
KEY_CLICK = 0.25  # seconds cut from the end of a take: the Enter key's click
SILENT = -50.0  # dB: a take whose loudest moment is quieter than this caught no voice
SPEECH_LEVEL = -20.0  # dB: every take's average level, so the lines sound even
CEILING = -1.5  # dB: the loudest peak a take may reach
# Rumble filtered out, then the silence trimmed at both ends (the end is trimmed on the reversed take).
TRIM = ('highpass=f=70,'
        'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12:detection=peak,areverse,'
        'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.18:detection=peak,areverse')


def capture_args(mic):
    """ffmpeg input arguments for the microphone."""
    return ['-f', 'avfoundation', '-i', f':{mic}']


def play(path):
    subprocess.run(['afplay', path], check=False)


def length_of(path):
    try:
        return seconds(path)
    except (subprocess.CalledProcessError, ValueError):
        return 0.0


def levels(path):
    """The average and peak level of a recording, in dB."""
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    mean = re.search(r'mean_volume: (-?[\d.]+|-inf) dB', out.stderr)
    peak = re.search(r'max_volume: (-?[\d.]+|-inf) dB', out.stderr)
    as_db = lambda m: float(m.group(1)) if m and m.group(1) != '-inf' else -120.0
    return as_db(mean), as_db(peak)


def slots(found, end):
    """Seconds each line has before the next line's beat, or before the video ends."""
    out = {}
    for k, (i, _, wished) in enumerate(found):
        limit = found[k + 1][2] - GAP if k + 1 < len(found) else end - 0.3
        out[i] = limit - wished
    return out


def record(mic, raw):
    """Records the microphone into raw until Enter. Returns False if the microphone didn't open."""
    proc = subprocess.Popen(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error'] + capture_args(mic) + ['-ac', '1', '-ar', '48000', raw], stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(WARM_UP)
    if proc.poll() is not None:
        print('  The microphone did not open: ' + (proc.stderr.read().decode(errors='replace').strip() or 'ffmpeg stopped'))
        print('  List the microphones with --mics, then pick one with --mic.')
        return False
    try:
        input('  ● Recording. Read the line, then press Enter. ')
    finally:
        try:
            proc.communicate(b'q', timeout=5)  # ffmpeg stops cleanly on "q"
        except subprocess.TimeoutExpired:
            proc.terminate()
            proc.wait()
    return os.path.exists(raw)


def clean(raw, out):
    """Trims a raw take and evens out its level. Returns the take's length, or 0 if no voice is left."""
    trimmed = out + '.trim.wav'
    keep = max(0.0, length_of(raw) - KEY_CLICK)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-t', f'{keep:.3f}', '-af', TRIM, '-ar', '48000', '-ac', '1', trimmed], check=True)
    if length_of(trimmed) < 0.3:
        return 0.0
    mean, peak = levels(trimmed)
    gain = min(SPEECH_LEVEL - mean, CEILING - peak)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', trimmed, '-af', f'volume={gain:.2f}dB', '-ar', '48000', '-ac', '1', out], check=True)
    os.remove(trimmed)
    return length_of(out)


def record_line(i, line, slot, mic):
    """Records one line until a take is kept. Returns 'kept', 'skipped' or 'quit'."""
    while True:
        print(f'\n[{i:02d}]  {line["text"]}')
        print(f'      Aim for {slot:.1f} s or less.')
        answer = input('  Press Enter to record (s = skip, q = quit). ').strip().lower()
        if answer in ('q', 's'):
            return 'quit' if answer == 'q' else 'skipped'
        with tempfile.TemporaryDirectory() as tmp:
            raw = os.path.join(tmp, 'raw.wav')
            if not record(mic, raw):
                return 'quit'
            if levels(raw)[1] < SILENT:
                print('  Only silence came through. Allow the microphone for your terminal app in')
                print('  System Settings > Privacy & Security > Microphone, or pick another one with --mics and --mic.')
                continue
            cleaned = os.path.join(tmp, 'take.wav')
            length = clean(raw, cleaned)
            if length == 0.0:
                print('  No words came through above the room noise. Try again a little closer to the microphone.')
                continue
            over = length - slot
            print(f'  {length:.1f} s' + (f', {over:.1f} s over its slot, so the lines after it start later. A quicker read keeps them on their beats.' if over > 0.05 else ', on time.'))
            play(cleaned)
            if input('  Keep it? (Enter = keep, r = record again) ').strip().lower() == 'r':
                continue
            os.makedirs(TAKES, exist_ok=True)
            shutil.move(cleaned, take(i))
            return 'kept'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Record the demo video voiceover in your own voice, one line at a time.')
    parser.add_argument('lines', nargs='*', type=int, help='line numbers to record again (default: every line without a take)')
    parser.add_argument('--mic', default='default', help='microphone name or index from --mics (default: the system default)')
    parser.add_argument('--mics', action='store_true', help='list the microphones and stop')
    args = parser.parse_args(argv)
    if args.mics:
        out = subprocess.run(['ffmpeg', '-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], capture_output=True, text=True)
        listing = out.stderr
        print(listing[listing.find('audio devices'):] if 'audio devices' in listing else listing)
        return

    _, end, found = cues()
    slot = slots(found, end)
    numbers = [i for i, _, _ in found]
    unknown = [n for n in args.lines if n not in numbers]
    if unknown:
        sys.exit(f'not a line of this recording: {unknown}; its lines are {numbers}')
    todo = set(args.lines) if args.lines else {i for i in numbers if not os.path.exists(take(i))}
    if todo:
        print(f'{len(todo)} line(s) to record. Read each one exactly as written, so the captions match.')
        print('A quiet room and a steady distance from the microphone keep the takes even.')
        try:
            for i, line, _ in found:
                if i in todo and record_line(i, line, slot[i], args.mic) == 'quit':
                    break
        except KeyboardInterrupt:
            print('\nStopped. Kept takes are saved.')
            sys.exit(1)
    missing = [i for i in numbers if not os.path.exists(take(i))]
    if missing:
        print(f'\nStill to record: lines {", ".join(map(str, missing))}. Run this again to continue.')
        return
    if not todo:
        print('Every line has a take. Pass line numbers to record some again.')
    if input('\nEvery line has a take. Rebuild the voiceover and the video now? (Enter = yes, n = no) ').strip().lower() != 'n':
        subprocess.run([sys.executable, os.path.join(HERE, 'narrate.py')], check=True)
        subprocess.run([sys.executable, os.path.join(HERE, 'encode.py')], check=True)


if __name__ == '__main__':
    main()
