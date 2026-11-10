#!/usr/bin/env python3
"""Encodes a demo recording into docs/video/shadow-zoo-demo.mp4.

Inputs, from scripts/record.mjs, scripts/demo.sh and scripts/render-audio.mjs:
  docs/video/frames/<n>/f*.jpg, times.json   each segment's screencast frames and capture times
                                             (seconds since epoch); segments are joined end to end
  docs/video/chapters.txt                    one "<epoch seconds>\\t<title>" line per beat (optional)
  docs/video/audio.wav                       the rebuilt soundtrack (optional)

Keeps the real timing between frames and shows each beat's title for a few seconds. A title that
starts with "=" is shown as a centered card, with "|" between lines. A permanent label says this
is emulator footage. Needs ffmpeg and Pillow. Usage: python3 scripts/encode.py
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'video')
FRAMES = os.path.join(ROOT, 'frames')
OVERLAYS = os.path.join(ROOT, 'overlays')
OUT = os.path.join(ROOT, 'shadow-zoo-demo.mp4')
W, H = 1280, 720
SERIF = ('/System/Library/Fonts/Supplemental/Iowan Old Style.ttc', 0)
SANS = ('/System/Library/Fonts/Avenir Next.ttc', 5)
INK = (255, 233, 199, 255)
MUTED = (232, 212, 183, 255)
LABEL = 'IWSDK WebXR emulator footage  ·  emulated hand tracking  ·  no physical headset'
CHAPTER_SECONDS = 4.2
FADE = 0.35


def font(spec, size):
    return ImageFont.truetype(spec[0], size, index=spec[1])


def pill(lines, fonts, pad_x, pad_y, gap, fill, radius, align='left'):
    """Text on a soft, rounded dark panel, as an RGBA image; one font per line (the last repeats)."""
    fonts = [fonts[min(i, len(fonts) - 1)] for i in range(len(lines))]
    probe = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    boxes = [probe.textbbox((0, 0), line, font=fnt) for line, fnt in zip(lines, fonts)]
    widths = [b[2] - b[0] for b in boxes]
    # A centered card's title gets extra room below it.
    gaps = [gap * 1.8 if i == 0 and align == 'center' else gap for i in range(len(lines) - 1)] + [0]
    height = int(sum(b[3] - b[1] for b in boxes) + sum(gaps))
    w, h = max(widths) + 2 * pad_x, height + 2 * pad_y
    blur = 10
    img = Image.new('RGBA', (w + 4 * blur, h + 4 * blur), (0, 0, 0, 0))
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((2 * blur, 2 * blur, 2 * blur + w, 2 * blur + h), radius, fill=(0, 0, 0, 90))
    img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(blur)))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((2 * blur, 2 * blur, 2 * blur + w, 2 * blur + h), radius, fill=fill)
    y = 2 * blur + pad_y
    for line, fnt, box, width, after in zip(lines, fonts, boxes, widths, gaps):
        x = 2 * blur + (pad_x if align == 'left' else (w - width) // 2)
        draw.text((x - box[0], y - box[1]), line, font=fnt, fill=INK if fnt is fonts[0] else MUTED)
        y += box[3] - box[1] + after
    return img


def overlay_images(chapters):
    os.makedirs(OVERLAYS, exist_ok=True)
    label = pill([LABEL], [font(SANS, 17)], 12, 7, 0, (12, 8, 6, 150), 9)
    label_path = os.path.join(OVERLAYS, 'label.png')
    label.save(label_path)
    paths = []
    for i, (_, text) in enumerate(chapters):
        if text.startswith('='):
            lines = text[1:].split('|')
            img = pill(lines, [font(SERIF, 64), font(SANS, 25)], 56, 34, 20, (22, 14, 9, 210), 24, align='center')
        else:
            img = pill([text], [font(SERIF, 34)], 26, 14, 0, (22, 14, 9, 185), 16)
        path = os.path.join(OVERLAYS, f'chapter{i:02d}.png')
        img.save(path)
        paths.append((path, img.size, text.startswith('=')))
    return (label_path, label.size), paths


def segments():
    """(name, frame times, stop time) for each recorded segment, in order."""
    names = [n for n in os.listdir(FRAMES) if os.path.exists(os.path.join(FRAMES, n, 'times.json'))]
    out = []
    for name in sorted(names, key=float):
        times = json.load(open(os.path.join(FRAMES, name, 'times.json')))
        if not times:
            continue
        meta = os.path.join(FRAMES, name, 'segment.json')
        # A static page sends no new frames, so the segment lasts until the recorder paused it.
        stop = json.load(open(meta))['stop'] if os.path.exists(meta) else times[-1] + 1 / 30
        out.append((name, times, max(stop, times[-1] + 1 / 30)))
    return out


def to_output(t, spans):
    """Maps a wall-clock moment onto the joined timeline (a moment between segments opens the next one)."""
    for t0, t1, offset in spans:
        if t0 - 0.5 <= t <= t1:
            return max(offset, t - t0 + offset)
    later = [offset for t0, _, offset in spans if t0 > t]
    return later[0] + 0.2 if later else None


def main():
    segs = segments()
    if not segs:
        sys.exit('no frames recorded')
    spans, offset, last = [], 0.0, None
    with open(os.path.join(FRAMES, 'list.txt'), 'w') as f:
        f.write('ffconcat version 1.0\n')
        for name, times, stop in segs:
            spans.append((times[0], stop, offset))
            for i, t in enumerate(times):
                nxt = times[i + 1] if i + 1 < len(times) else stop
                # Real gaps are kept (a reload can pause the screencast) so the soundtrack stays in sync.
                f.write(f"file '{name}/f{i:05d}.jpg'\nduration {max(1 / 60, nxt - t):.4f}\n")
            last = f"{name}/f{len(times) - 1:05d}.jpg"
            offset += stop - times[0]
        f.write(f"file '{last}'\n")
    end = offset

    chapters = []
    chapter_file = os.path.join(ROOT, 'chapters.txt')
    if os.path.exists(chapter_file):
        for line in open(chapter_file):
            if '\t' in line:
                t, text = line.rstrip('\n').split('\t', 1)
                at = to_output(float(t), spans)
                if at is not None and at < end:
                    chapters.append((at, text))
    (label_path, label_size), chapter_images = overlay_images(chapters)

    args = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', os.path.join(FRAMES, 'list.txt')]
    args += ['-loop', '1', '-framerate', '30', '-i', label_path]
    # A quick dip through black at every cut between segments.
    dips = ''.join(
        f",fade=t=out:st={b - FADE:.3f}:d={FADE}:enable='between(t,{b - FADE:.3f},{b:.3f})'"
        f",fade=t=in:st={b:.3f}:d={FADE}:enable='between(t,{b:.3f},{b + FADE:.3f})'"
        for b in [span[2] for span in spans[1:]]
    )
    graph = [f'[0:v]fps=30,scale={W}:{H}{dips},format=rgba[b0]', f'[1:v]format=rgba[label]', f'[b0][label]overlay=6:H-h-4:shortest=1[b1]']
    base = 'b1'
    for k, ((start, text), (path, size, card)) in enumerate(zip(chapters, chapter_images)):
        nxt = chapters[k + 1][0] if k + 1 < len(chapters) else end
        dur = max(1.5, min(CHAPTER_SECONDS if not card else 6.0, nxt - start - 0.2))
        args += ['-loop', '1', '-framerate', '30', '-t', f'{dur:.2f}', '-i', path]
        idx = 2 + k
        x, y = ((W - size[0]) // 2, (H - size[1]) // 2 - 40) if card else (12, 8)
        graph.append(
            f'[{idx}:v]format=rgba,fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st={dur - 0.45:.2f}:d=0.45:alpha=1,'
            f'setpts=PTS-STARTPTS+{start:.3f}/TB[c{k}]'
        )
        graph.append(f"[{base}][c{k}]overlay={x}:{y}:eof_action=pass:enable='between(t,{start:.3f},{start + dur:.3f})'[b{k + 2}]")
        base = f'b{k + 2}'
    graph.append(f'[{base}]format=yuv420p[v]')
    audio = os.path.join(ROOT, 'audio.wav')
    newest = max(os.path.getmtime(os.path.join(FRAMES, name, 'times.json')) for name, _, _ in segs)
    has_audio = os.path.exists(audio) and os.path.getmtime(audio) >= newest
    if has_audio:
        args += ['-i', audio]
    args += ['-filter_complex', ';'.join(graph), '-map', '[v]']
    if has_audio:
        args += ['-map', f'{2 + len(chapters)}:a', '-c:a', 'aac', '-b:a', '192k']
    args += ['-t', f'{end + 1 / 30:.3f}', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-r', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT]
    subprocess.run(args, check=True)
    print(f'wrote {os.path.relpath(OUT)}: {end:.1f} s from {len(segs)} segments, {len(chapters)} chapters, audio {"yes" if has_audio else "no"}')


if __name__ == '__main__':
    main()
