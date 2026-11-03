#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from common import ffprobe, parse_rate, seconds_to_tc, write_json


def make_sheet(items: list[tuple[Path, str]], output: Path, columns: int = 5, width: int = 360) -> None:
    opened = []
    for path, label in items:
        im = Image.open(path).convert("RGB")
        ratio = width / im.width
        im = im.resize((width, max(1, int(im.height * ratio))))
        opened.append((im, label))
    if not opened:
        return
    label_h = 36
    cell_h = max(im.height for im, _ in opened) + label_h
    rows = math.ceil(len(opened) / columns)
    canvas = Image.new("RGB", (columns * width, rows * cell_h), "white")
    draw = ImageDraw.Draw(canvas)
    for i, (im, label) in enumerate(opened):
        x = (i % columns) * width
        y = (i // columns) * cell_h
        canvas.paste(im, (x, y))
        draw.text((x + 6, y + im.height + 6), label, fill="black")
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, quality=92)


def main() -> int:
    ap = argparse.ArgumentParser(description="High-density frame rescan for gestures, eye-lines, impacts, and micro-performance.")
    ap.add_argument("input", type=Path)
    ap.add_argument("--start", type=float, required=True, help="Start seconds")
    ap.add_argument("--end", type=float, required=True, help="End seconds")
    ap.add_argument("--sample-fps", type=float, default=24.0)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--max-frames", type=int, default=240)
    ap.add_argument("--jpeg-quality", type=int, default=92)
    args = ap.parse_args()

    src = args.input.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    frames_dir = out / "frames"
    frames_dir.mkdir(exist_ok=True)

    meta = ffprobe(src)
    vs = next(s for s in meta["streams"] if s.get("codec_type") == "video")
    fps = parse_rate(vs.get("avg_frame_rate")) or parse_rate(vs.get("r_frame_rate"))
    if args.end <= args.start or args.start < 0:
        raise ValueError("Invalid start/end range")
    sample_fps = min(max(0.1, args.sample_fps), fps)
    step = max(1, int(round(fps / sample_fps)))
    start_frame = max(0, int(math.floor(args.start * fps)))
    end_frame = int(math.ceil(args.end * fps))

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open {src}")
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    items = []
    metrics = []
    prev_gray = None
    saved = 0
    frame_no = start_frame
    while frame_no <= end_frame and saved < args.max_frames:
        ok, frame = cap.read()
        if not ok:
            break
        if (frame_no - start_frame) % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            brightness = float(gray.mean())
            motion = 0.0
            if prev_gray is not None:
                a = cv2.resize(prev_gray, (192,108), interpolation=cv2.INTER_AREA)
                b = cv2.resize(gray, (192,108), interpolation=cv2.INTER_AREA)
                motion = float(cv2.absdiff(a,b).mean()/255.0)
            prev_gray = gray
            path = frames_dir / f"F{frame_no:08d}_{frame_no/fps:010.4f}s.jpg"
            cv2.imwrite(str(path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), args.jpeg_quality])
            label = f"{seconds_to_tc(frame_no/fps, fps)} F{frame_no} M{motion:.3f}"
            items.append((path, label))
            metrics.append({"frame": frame_no, "seconds": round(frame_no/fps,6), "timecode": seconds_to_tc(frame_no/fps, fps), "brightness": round(brightness,4), "sharpness": round(sharpness,4), "motion": round(motion,6), "path": str(path)})
            saved += 1
        frame_no += 1
    cap.release()

    make_sheet(items, out / "contact_sheet.jpg")
    write_json(out / "rescan.json", {
        "source": str(src), "source_fps": fps, "requested_sample_fps": args.sample_fps,
        "actual_sample_step_frames": step, "start_seconds": args.start, "end_seconds": args.end,
        "frames_saved": saved, "truncated": saved >= args.max_frames,
        "frames": metrics
    })
    print(json.dumps({"ok": True, "frames": saved, "output": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
