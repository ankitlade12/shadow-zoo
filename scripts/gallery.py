#!/usr/bin/env python3
"""Captioned screenshots for the Devpost gallery, taken from the demo recording.

Each shot is a moment in docs/video/frames: a beat from chapters.txt, optionally the first game event
after it (from live.log, such as "sound reveal"), plus a few seconds. The frame is cropped to 3:2 and
given a caption band. Writes docs/gallery/NN-name.png (PNG, well under Devpost's 5 MB), plus a
title thumbnail: docs/thumbnail-youtube.jpg (1280x720) and docs/thumbnail-devpost.jpg (3:2).
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


def thumbnail(path, size, out, zoom=0.78):
    """A video thumbnail or project card: the shot zoomed onto the light, a bold title on the left."""
    frame = Image.open(path).convert('RGB')
    w, h = frame.size
    # Zoom in so the light pool sits on the right and the left is quiet room for the title.
    crop_w = int(w * zoom)
    crop_h = int(crop_w * size[1] / size[0])
    if crop_h > h:
        crop_h = h
        crop_w = int(h * size[0] / size[1])
    top = max(0, min(h - crop_h, int(h * 0.02)))
    img = frame.crop((0, top, crop_w, top + crop_h)).resize(size, Image.LANCZOS)
    W, H = size
    shade = Image.new('L', size, 0)
    d = ImageDraw.Draw(shade)
    for x in range(W):
        d.line([(x, 0), (x, H)], fill=int(225 * max(0.0, 1 - x / (W * 0.58)) ** 1.2))
    img = Image.composite(Image.new('RGB', size, (16, 10, 6)), img, shade)
    k = W / 1280
    title, sub, badge = font(('/System/Library/Fonts/Supplemental/Iowan Old Style.ttc', 4), int(124 * k)), font(('/System/Library/Fonts/Avenir Next.ttc', 2), int(42 * k)), font(('/System/Library/Fonts/Avenir Next.ttc', 0), int(24 * k))
    x0, y0 = int(58 * k), int(H * 0.26)
    # A warm glow behind the title.
    glow = Image.new('RGBA', size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for line, dy in (('Shadow', 0), ('Zoo', int(118 * k))):
        gd.text((x0, y0 + dy), line, font=title, fill=(255, 170, 70, 210))
    glow = glow.filter(ImageFilter.GaussianBlur(int(18 * k)))
    img = Image.alpha_composite(img.convert('RGBA'), glow)
    d = ImageDraw.Draw(img)
    for line, dy in (('Shadow', 0), ('Zoo', int(118 * k))):
        d.text((x0, y0 + dy), line, font=title, fill=(255, 238, 210))
    d.text((x0 + int(4 * k), y0 + int(262 * k)), 'Hand shadows that come alive', font=sub, fill=(250, 222, 186))
    d.text((x0 + int(4 * k), y0 + int(312 * k)), 'on your real wall', font=sub, fill=(250, 222, 186))
    label = 'MIXED REALITY  ·  META QUEST'
    bw = d.textlength(label, font=badge) + int(40 * k)
    by = y0 - int(74 * k)
    d.rounded_rectangle((x0, by, x0 + bw, by + int(46 * k)), radius=int(23 * k), fill=(255, 194, 122))
    d.text((x0 + int(20 * k), by + int(9 * k)), label, font=badge, fill=(38, 23, 12))
    img.convert('RGB').save(out, quality=92)
    print(f'  {os.path.relpath(out)}  {size[0]}x{size[1]}  {os.path.getsize(out) // 1024} KB')


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
    # The thumbnail: the moment the zoo is complete, golden lantern and every creature on the wall.
    beat = 'Find all seven, and your zoo is complete'
    if beat in beats:
        t = (first_event('sound reveal', beats[beat]) or beats[beat]) + 1.6
        path = frame_at(t, segs)
        if path:
            thumbnail(path, (1280, 720), os.path.join(ROOT, '..', 'thumbnail-youtube.jpg'))
            thumbnail(path, (1200, 800), os.path.join(ROOT, '..', 'thumbnail-devpost.jpg'), zoom=0.66)


if __name__ == '__main__':
    main()
