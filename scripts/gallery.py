#!/usr/bin/env python3
"""Captioned screenshots for the Devpost gallery, taken from the demo recording.

Each shot is a moment in docs/video/frames: a beat from chapters.txt, optionally the first game event
after it (from live.log, such as "sound reveal"), plus a few seconds. The frame is cropped to 3:2 and
given a caption band. Writes docs/gallery/NN-name.png (PNG, well under Devpost's 5 MB).
Run after scripts/demo.sh. Usage: python3 scripts/gallery.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from encode import FRAMES, ROOT, SANS, SERIF, font, segments  # noqa: E402

OUT = os.path.join(ROOT, '..', 'gallery')
SIZE = (1080, 720)
INK = (255, 236, 205)
MUTED = (236, 214, 184)

# (file name, beat, game event after the beat or None, seconds after, title, subtitle)
SHOTS = [
    ('title', None, None, 2.5, 'Shadow Zoo', 'Hand shadows that come alive on your real wall'),
    ('lantern', 'Your hands cast shadows on your own wall', None, 2.8, 'Light the lantern', 'Your real hands cast shadows on your real wall'),
    ('rabbit', 'Make the shape it shows, and it comes alive', 'sound reveal', 0.9, 'It comes alive', 'Shape your hand to fit the glowing outline'),
    ('feed', 'Feed it: a pinch releases a firefly', 'sound firefly', 1.2, 'Feed it', 'Pinch to release a firefly, and it chases it down'),
    ('wear', 'Wear a creature: snap its jaw and it speaks', 'sound voice-dog', 0.4, 'Wear a creature', 'Snap the dog’s jaw, and it barks'),
    ('bird', 'Two hands make a bird, and it flies', 'sound reveal', 1.5, 'Two hands, one bird', 'Hook your thumbs, and it takes wing'),
    ('complete', 'Find all seven, and your zoo is complete', 'sound reveal', 1.0, 'Your zoo is complete', 'Find all seven, and the lantern turns gold'),
    ('welcome', 'Come back tomorrow: your zoo remembers you', None, 1.2, 'Come back tomorrow', 'Your zoo remembers you, and a new visitor waits'),
    ('menu', 'A hands-only menu: point and pinch', None, 6.5, 'No controllers, ever', 'Even the menu is point and pinch'),
]


def chapter_epochs():
    out = {}
    for line in open(os.path.join(ROOT, 'chapters.txt')):
        if '\t' in line:
            t, text = line.rstrip('\n').split('\t', 1)
            out.setdefault(text, float(t))
    return out


def first_event(pattern, after):
    for line in open(os.path.join(ROOT, 'live.log')):
        t, _, text = line.rstrip('\n').partition('\t')
        if t and float(t) >= after and pattern in text:
            return float(t)
    return None


def frame_at(t, segs):
    """The recorded frame nearest to wall-clock moment t (or the first frame for None)."""
    best = None
    for name, times, _ in segs:
        for i, ft in enumerate(times):
            if t is None:
                return os.path.join(FRAMES, name, f'f{i:05d}.jpg')
            d = abs(ft - t)
            if best is None or d < best[0]:
                best = (d, os.path.join(FRAMES, name, f'f{i:05d}.jpg'))
    return best[1] if best and best[0] < 1.5 else None


def captioned(path, title, subtitle):
    frame = Image.open(path).convert('RGB')
    w, h = frame.size
    crop_w = int(h * 1.5)
    img = frame.crop(((w - crop_w) // 2, 0, (w - crop_w) // 2 + crop_w, h)).resize(SIZE, Image.LANCZOS)
    # A soft dark band at the bottom for the caption.
    band = Image.new('L', SIZE, 0)
    draw = ImageDraw.Draw(band)
    for y in range(SIZE[1] - 230, SIZE[1]):
        draw.line([(0, y), (SIZE[0], y)], fill=int(205 * min(1, (y - (SIZE[1] - 230)) / 150)))
    img = Image.composite(Image.new('RGB', SIZE, (14, 9, 6)), img, band)
    draw = ImageDraw.Draw(img)
    big, small = font(SERIF, 52), font(SANS, 27)
    draw.text((44, SIZE[1] - 128), title, font=big, fill=INK)
    draw.text((46, SIZE[1] - 58), subtitle, font=small, fill=MUTED)
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    segs = segments()
    beats = chapter_epochs()
    made = 0
    for n, (name, beat, event, after, title, subtitle) in enumerate(SHOTS):
        t = None
        if beat:
            if beat not in beats:
                print(f'  skip {name}: no beat "{beat}"')
                continue
            t = beats[beat]
            if event:
                hit = first_event(event, t)
                t = hit if hit is not None else t
            t += after
        path = frame_at(t, segs) if t is not None else frame_at(None, segs[:1])
        if not path:
            print(f'  skip {name}: no frame at that moment')
            continue
        out = os.path.join(OUT, f'{n + 1:02d}-{name}.png')
        captioned(path, title, subtitle).save(out, optimize=True)
        made += 1
        print(f'  {os.path.relpath(out)}  {os.path.getsize(out) // 1024} KB')
    print(f'wrote {made} gallery images to docs/gallery')


if __name__ == '__main__':
    main()
