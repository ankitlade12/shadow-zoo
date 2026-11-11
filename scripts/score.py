#!/usr/bin/env python3
"""Composes and renders the demo video's music: an original music-box waltz, synthesized from scratch.

Every note comes from this file. A music box carries the tune over a soft piano waltz and a plucked
bass. Warm strings join for the bird, swell into the moment the zoo is complete, and settle for the
end card, where the tune resolves. The score is laid on a bar grid aligned with the recording's
beats (docs/video/chapters.txt): a bar line falls exactly on "Find all seven", the strings rise from
the bird, and the final chord rings out under the end card. It writes docs/video/music.wav (48 kHz
stereo, about -23 LUFS), which scripts/encode.py mixes under the voice.

Run after scripts/demo.sh and before scripts/encode.py. Needs numpy and ffmpeg.
Usage: python3 scripts/score.py
"""
import math
import os
import re
import subprocess
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from encode import ROOT, chapter_times, timeline  # noqa: E402

OUT = os.path.join(ROOT, 'music.wav')
SR = 48000
BPM = 96
BEAT = 60 / BPM
BAR = 3 * BEAT  # a waltz: three beats to the bar
LOUDNESS = -23.0  # LUFS: a bed under the voice

# Tunes, one bar per "|": a note is NAME+OCTAVE with an optional ":beats" (one beat by default).
# Each phrase is eight bars, with one chord per bar.
THEME_A = ('F#5 A5 D6 | C#6:2 B5 | B5 A5 G5 | A5:3 | F#5 A5 D6 | E6 D6 B5 | G5 B5 D6 | C#6:2 A5',
           'D Bm G A D Bm Em7 A7')
THEME_A2 = ('F#5 A5 D6 | C#6:2 B5 | B5 D6 G6 | F#6 E6 C#6 | D6:2 A5 | B5 G5 B5 | A5 G5 E5 | D5:3',
            'D Bm G A7 D G A7 D')
THEME_B = ('B5:2 D6 | C#6:2 E6 | A5:2 C#6 | D6:3 | B5 D6 G6 | E6 C#6 A5 | F#5:3 | E5 G5 C#6',
           'G A F#m Bm G A D A7')
RISE = ('D5 G5 B5 | E5 A5 C#6 | F#5 B5 D6 | G5 B5 D6 | G5 B5 E6 | A5 C#6 E6',
        'G A Bm G Em7 A7')
ENDING = ('F#5 A5 D6 | C#6:2 B5 | B5 A5 G5 | A5:3 | F#5 A5 D6 | E6 D6 B5 | D6 B5 G5 | A5 C#6 E6 | D6:3',
          'D Bm G A D Bm G A7 D')

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
CHORD_TONES = {
    'D': ('D', 'F#', 'A'), 'Bm': ('B', 'D', 'F#'), 'G': ('G', 'B', 'D'), 'A': ('A', 'C#', 'E'),
    'A7': ('A', 'C#', 'E', 'G'), 'Em7': ('E', 'G', 'B', 'D'), 'F#m': ('F#', 'A', 'C#'),
}


def midi(name):
    m = re.fullmatch(r'([A-G]#?)(\d)', name)
    return NOTE[m.group(1)] + 12 * (int(m.group(2)) + 1)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def notes_of(tune):
    """(bar, beat, midi, beats) for each note of a tune."""
    notes = []
    for bar, cell in enumerate(tune.split('|')):
        beat = 0.0
        for token in cell.split():
            name, _, length = token.partition(':')
            notes.append((bar, beat, midi(name), float(length or 1)))
            beat += float(length or 1)
    return notes


def first_bars(phrase, count):
    tune, chords = phrase
    return '|'.join(tune.split('|')[:count]), ' '.join(chords.split()[:count])


def last_bars(phrase, count):
    tune, chords = phrase
    return '|'.join(tune.split('|')[-count:]), ' '.join(chords.split()[-count:])


def chord_notes(chord, low, high):
    """The chord's tones between two MIDI notes, ascending."""
    classes = {NOTE[t] for t in CHORD_TONES[chord]}
    return [m for m in range(low, high + 1) if m % 12 in classes]


# ---- instruments: each returns a note's samples from its attack ----

def music_box(m, vel):
    f = hz(m)
    ring = 2.4
    t = np.arange(int(ring * SR)) / SR
    index = (2.2 * np.exp(-t / 0.18) + 0.25) * min(1.0, 1200 / f)  # gentler on high notes: no aliasing
    tone = np.sin(2 * np.pi * f * t + index * np.sin(2 * np.pi * 3.5 * f * t))
    tone += 0.22 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.35)
    decay = 0.9 * (880 / f) ** 0.35
    shape = (1 - np.exp(-t / 0.002)) * np.exp(-t / decay) * np.clip((ring - t) / 0.15, 0, 1)
    return 0.16 * vel * tone * shape


def piano(m, vel, hold):
    f = hz(m)
    length = hold + 0.5
    t = np.arange(int(length * SR)) / SR
    out = np.zeros_like(t)
    for k in range(1, 9):
        fk = k * f * math.sqrt(1 + 0.0004 * k * k)
        if fk > 9000:
            break
        out += k ** -1.6 * np.sin(2 * np.pi * fk * t) * np.exp(-t / (1.9 / (1 + 0.45 * k)))
    return 0.07 * vel * out * (1 - np.exp(-t / 0.004)) * np.clip((length - t) / 0.4, 0, 1)


def bass(m, vel):
    f = hz(m)
    length = 1.9
    t = np.arange(int(length * SR)) / SR
    tone = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) * np.exp(-t / 0.3)
            + 0.12 * np.sin(6 * np.pi * f * t) * np.exp(-t / 0.15))
    return 0.2 * vel * tone * (1 - np.exp(-t / 0.005)) * np.exp(-t / 0.9) * np.clip((length - t) / 0.3, 0, 1)


def strings(ms, level, length):
    """A warm string pad on a chord: three slightly detuned voices per note, upper harmonics rolled off."""
    t = np.arange(int(length * SR)) / SR
    left, right = np.zeros_like(t), np.zeros_like(t)
    for m in ms:
        f = hz(m)
        for cents, pan in ((-7, 0.8), (0, 0.5), (7, 0.2)):
            fv = f * 2 ** (cents / 1200)
            drift = 1 + 0.0025 * np.sin(2 * np.pi * (0.18 + 0.004 * cents) * t)
            voice = np.zeros_like(t)
            for k in range(1, 11):
                if k * fv > 5000:
                    break
                voice += np.exp(-k / 3.5) / k * np.sin(2 * np.pi * k * fv * t * drift)
            left += pan * voice
            right += (1 - pan) * voice
    shape = np.clip(t / 0.5, 0, 1) * np.clip((length - t) / 0.7, 0, 1)
    gain = 0.035 * level / max(1, len(ms))
    return gain * left * shape, gain * right * shape


def swell(length):
    """Rising air into the finale, opening up toward its downbeat, then a quick fall away."""
    n, tail = int(length * SR), int(0.4 * SR)
    noise = np.random.default_rng(7).standard_normal((2, n + tail))
    spec = np.fft.rfft(noise, axis=1)
    freqs = np.fft.rfftfreq(n + tail, 1 / SR)
    spec *= np.exp(-(np.log2(np.maximum(freqs, 20) / 3500) ** 2) / 1.2)
    air = np.fft.irfft(spec, n + tail, axis=1)
    shape = np.concatenate([(np.arange(n) / n) ** 3, np.exp(-np.arange(tail) / (0.08 * SR))])
    return tuple(0.05 * air / np.max(np.abs(air)) * shape)


# ---- the score ----

class Score:
    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.dry = np.zeros((2, self.n))
        self.wet = np.zeros((2, self.n))

    def add(self, sound, at, pan=0.5, send=0.25):
        """Adds a mono sound (panned) or a (left, right) pair at a time, with a reverb send."""
        start = int(at * SR)
        if start >= self.n:
            return
        if isinstance(sound, tuple):
            left, right = sound
        else:
            left, right = sound * math.sqrt(1 - pan), sound * math.sqrt(pan)
        end = min(self.n, start + len(left))
        for ch, sig in enumerate((left, right)):
            self.dry[ch, start:end] += sig[:end - start]
            self.wet[ch, start:end] += send * sig[:end - start]

    def mix(self, seconds=2.6):
        """Dry plus a soft hall: decaying, slightly darkened stereo noise as the impulse response."""
        n = int(seconds * SR)
        rng = np.random.default_rng(11)
        t = np.arange(n) / SR
        size = 1 << int(math.ceil(math.log2(self.n + n)))
        hall = np.zeros_like(self.wet)
        for ch in range(2):
            ir = np.convolve(rng.standard_normal(n) * np.exp(-t / 0.42), np.ones(6) / 6, mode='same')
            ir[:int(0.022 * SR)] = 0
            ir /= np.sqrt(np.sum(ir ** 2))
            hall[ch] = np.fft.irfft(np.fft.rfft(self.wet[ch], size) * np.fft.rfft(ir, size), size)[:self.n]
        return self.dry + 0.6 * hall


def play(score, start_bar, t0, phrase, vel, *, octave_up=False, waltz=True, bass_on=True, pad=0.0, glints=False):
    """Plays a phrase from a bar: the tune on the music box; the chords on piano, bass and strings."""
    tune, chords = phrase
    for bar, beat, m, _ in notes_of(tune):
        at = t0 + (start_bar + bar) * BAR + beat * BEAT
        score.add(music_box(m, vel), at, pan=0.35 + 0.3 * (m - 74) / 24, send=0.35)
        if octave_up:
            score.add(music_box(m + 12, 0.45 * vel), at + 0.012, pan=0.65, send=0.45)
    for bar, chord in enumerate(chords.split()):
        at = t0 + (start_bar + bar) * BAR
        root = min(chord_notes(chord, 38, 49))
        voicing = chord_notes(chord, 61, 73)[:3]
        if bass_on:
            score.add(bass(root, vel), at, send=0.05)
        if waltz:  # oom-pah-pah: the bass on one, the chord on two and three
            for beat in (1, 2):
                for m in voicing:
                    score.add(piano(m, 0.8 * vel, 0.45), at + beat * BEAT, pan=0.42, send=0.25)
        else:  # a gentle broken chord
            for i, m in enumerate([root + 12] + voicing):
                score.add(piano(m, 0.75 * vel, 0.9), at + i * BEAT * 0.75, pan=0.42, send=0.3)
        if pad > 0:
            score.add(strings([root + 12] + voicing, pad, BAR + 0.7), at - 0.05, send=0.3)
        if glints:  # a sparkle of high notes on the third beat
            for i, m in enumerate(chord_notes(chord, 86, 98)[:4]):
                score.add(music_box(m, 0.35 * vel), at + 2 * BEAT + i * 0.09, pan=0.75, send=0.5)


def phrases(score, start, count, t0, cycle, vel, **style):
    """Plays count bars from a bar, cycling through eight-bar phrases (the last one cut short)."""
    bar, k = start, 0
    while bar < start + count:
        n = min(8, start + count - bar)
        play(score, bar, t0, first_bars(cycle[k % len(cycle)], n), vel, **style)
        bar, k = bar + n, k + 1


def main():
    _, spans, end = timeline()
    chapters = chapter_times(spans, end)
    at = lambda prefix: next(t for t, text in chapters if text.startswith(prefix))
    finale_t, bird_t, card_t = at('Find all seven'), at('Two hands make a bird'), at('=')
    finale = int(finale_t // BAR)
    t0 = finale_t - finale * BAR  # a bar line falls exactly on the finale
    bird = math.ceil((bird_t - t0) / BAR)
    ending = int((card_t - t0) // BAR) - 6  # the closing phrase's final chord lands two bars into the card
    rise = min(6, finale - bird)
    assert 20 + 8 <= bird and finale + 8 < ending, 'this score expects the demo video beats'

    score = Score(end)
    play(score, 0, t0, first_bars(THEME_A, 4), 0.55, waltz=False, bass_on=False, pad=0.25)  # intro
    phrases(score, 4, 16, t0, [THEME_A, THEME_A2], 0.7)  # the lantern, the first creatures
    phrases(score, 20, 8, t0, [THEME_B], 0.75, pad=0.3)  # wearing creatures
    phrases(score, 28, finale - rise - 28, t0, [THEME_A2, THEME_A], 0.75, pad=0.45)  # the zoo grows
    play(score, finale - rise, t0, last_bars(RISE, rise), 0.85, octave_up=True, pad=0.8)  # the bird
    score.add(swell(2 * BAR), t0 + (finale - 2) * BAR, send=0.4)
    play(score, finale, t0, THEME_A2, 1.0, octave_up=True, pad=1.0, glints=True)  # the zoo is complete
    phrases(score, finale + 8, ending - finale - 8, t0, [THEME_B, THEME_A], 0.6, waltz=False, bass_on=False)
    play(score, ending, t0, ENDING, 0.85, octave_up=True, pad=0.7)  # the end card
    last = t0 + (ending + 8) * BAR  # the final chord: a rolled D across the music box's range
    for i, m in enumerate((62, 66, 69, 74, 78, 81, 86)):
        score.add(music_box(m, 0.7), last + 0.06 * i, pan=0.3 + 0.07 * i, send=0.5)

    mix = score.mix() * np.clip((end - np.arange(score.n) / SR) / 1.5, 0, 1)
    mix *= 0.89 / np.max(np.abs(mix))
    write(OUT, mix)
    write(OUT, mix * 10 ** ((LOUDNESS - lufs(OUT)) / 20))
    print(f'wrote {os.path.relpath(OUT)}: {end:.1f} s in {BAR:.3f} s bars from {t0:.2f} s; '
          f'strings rise at bar {finale - rise} ({t0 + (finale - rise) * BAR:.1f} s), finale at bar {finale} ({finale_t:.1f} s), '
          f'final chord at {last:.1f} s; {lufs(OUT):.1f} LUFS')


def write(path, stereo):
    pcm = (np.clip(stereo, -1, 1).T * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def lufs(path):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', out)[-1])


if __name__ == '__main__':
    main()
