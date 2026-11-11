#!/usr/bin/env python3
"""Voices the demo video with Kokoro, an open text-to-speech model under the Apache 2.0 license.

This is the alternative to recording the lines yourself with scripts/record_voice.py. It writes one
take per narration line to docs/video/voice-lines/NN.wav (git-ignored). The voice is Kokoro's Hindi
male voice "hm_omega" reading English with British pronunciation. A line that would overrun its
slot before the next beat is spoken a little faster, up to 1.12 times. Each take is trimmed and,
when faster-whisper is installed, transcribed back and compared with the script, so a misread line
is reported. Then run scripts/narrate.py and scripts/encode.py.

Kokoro needs Python 3.10 to 3.12 and isn't a dependency of the game, so it runs from its own
environment, for example:
  uv venv --python 3.12 ~/.venvs/shadow-zoo-tts
  uv pip install --python ~/.venvs/shadow-zoo-tts/bin/python kokoro soundfile faster-whisper pillow \\
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
  ~/.venvs/shadow-zoo-tts/bin/python scripts/synth_voice.py            every line
  ~/.venvs/shadow-zoo-tts/bin/python scripts/synth_voice.py 2 10       only lines 2 and 10
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from narrate import TAKES, cues, take  # noqa: E402
from record_voice import slots  # noqa: E402

VOICE = 'hm_omega'
LANG = 'b'  # British English pronunciation
SPEED = 1.05  # a brisk narration pace
MAX_SPEED = 1.12  # the fastest a line may go to fit its slot
SR = 24000
SILENCE = 0.004  # amplitude (-48 dBFS) below which the start and end of a take count as silence


def pipeline():
    import espeakng_loader
    from kokoro import KPipeline
    from phonemizer.backend.espeak.wrapper import EspeakWrapper
    # espeak-ng ignores a data path longer than about 160 characters, so a long one is copied to a short
    # temporary directory (a symlink wouldn't do: phonemizer resolves it back to the long path).
    data = espeakng_loader.get_data_path()
    if len(data) > 150:
        short = os.path.join(tempfile.mkdtemp(prefix='espeak-'), 'data')
        shutil.copytree(data, short)
        data = short
    EspeakWrapper.set_data_path(data)
    return KPipeline(lang_code=LANG, repo_id='hexgrad/Kokoro-82M')


def speak(pipe, text, speed):
    chunks = [np.asarray(audio) for _, _, audio in pipe(text, voice=VOICE, speed=speed) if audio is not None]
    audio = np.concatenate(chunks)
    loud = np.flatnonzero(np.abs(audio) > SILENCE)
    if loud.size == 0:
        return audio
    # Generous margins keep quiet first and last sounds (the p of "pinch", a final s); a line that starts
    # on its very first sample also loses its opening consonant to the ear.
    return audio[max(0, loud[0] - int(0.25 * SR)): loud[-1] + int(0.15 * SR)]


def heard(path):
    """What Whisper hears in a take, or None when faster-whisper isn't installed."""
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return None
    if not hasattr(heard, 'model'):
        heard.model = WhisperModel('medium.en', device='cpu', compute_type='int8')
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    segments, _ = heard.model.transcribe(np.frombuffer(raw, dtype=np.float32), beam_size=5, language='en')
    return ' '.join(s.text.strip() for s in segments)


def words(text):
    return re.findall(r'[a-z0-9]+', text.lower().replace("'", '').replace('metaquest', 'meta quest'))


def main():
    _, end, found = cues()
    slot = slots(found, end)
    only = {int(a) for a in sys.argv[1:]}
    pipe = pipeline()
    os.makedirs(TAKES, exist_ok=True)
    for i, line, _ in found:
        if only and i not in only:
            continue
        speed = SPEED
        audio = speak(pipe, line['text'], speed)
        if len(audio) / SR > slot[i]:
            speed = min(MAX_SPEED, SPEED * len(audio) / SR / slot[i])
            audio = speak(pipe, line['text'], speed)
        sf.write(take(i), audio, SR, subtype='PCM_16')
        length = len(audio) / SR
        text = heard(take(i))
        check = '' if text is None else ('  heard word for word' if words(text) == words(line['text']) else f'  CHECK, heard: {text}')
        print(f'  [{i:02d}] {length:4.1f} s of {slot[i]:4.1f} s at {speed:.2f}x{check}')
    print(f'wrote takes to {os.path.relpath(TAKES)}; next: python3 scripts/narrate.py && python3 scripts/encode.py')


if __name__ == '__main__':
    main()
