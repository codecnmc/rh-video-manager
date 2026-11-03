#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from common import ffprobe, parse_rate, safe_name, seconds_to_tc, write_json


@dataclass
class Sample:
    frame: int
    seconds: float
    hist: np.ndarray
    brightness: float
    sharpness: float
    motion: float


def video_stream(meta: dict[str, Any]) -> dict[str, Any]:
    for s in meta.get("streams", []):
        if s.get("codec_type") == "video":
            return s
    raise RuntimeError("No video stream found")


def audio_streams(meta: dict[str, Any]) -> list[dict[str, Any]]:
    return [s for s in meta.get("streams", []) if s.get("codec_type") == "audio"]


def frame_features(frame: np.ndarray, prev_gray: np.ndarray | None) -> tuple[np.ndarray, float, float, float, np.ndarray]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(frame, (192, 108), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1], None, [24, 16], [0, 180, 0, 256])
    cv2.normalize(hist, hist)
    brightness = float(gray.mean())
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    if prev_gray is None:
        motion = 0.0
    else:
        a = cv2.resize(prev_gray, (192, 108), interpolation=cv2.INTER_AREA)
        b = cv2.resize(gray, (192, 108), interpolation=cv2.INTER_AREA)
        motion = float(cv2.absdiff(a, b).mean() / 255.0)
    return hist, brightness, sharpness, motion, gray


def hist_distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA))


def refine_boundary(cap: cv2.VideoCapture, candidate_frame: int, fps: float, window_seconds: float) -> tuple[int, float]:
    radius = max(2, int(round(window_seconds * fps)))
    start = max(1, candidate_frame - radius)
    end = candidate_frame + radius
    cap.set(cv2.CAP_PROP_POS_FRAMES, start - 1)
    ok, prev = cap.read()
    if not ok:
        return candidate_frame, 0.0
    prev_hist, *_ = frame_features(prev, None)
    best_frame, best_score = candidate_frame, -1.0
    for frame_no in range(start, end + 1):
        ok, frame = cap.read()
        if not ok:
            break
        hist, *_ = frame_features(frame, None)
        score = hist_distance(prev_hist, hist)
        if score > best_score:
            best_frame, best_score = frame_no, score
        prev_hist = hist
    return best_frame, max(0.0, best_score)


def extract_frame(cap: cv2.VideoCapture, frame_no: int, path: Path, quality: int) -> bool:
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, frame_no))
    ok, frame = cap.read()
    if not ok:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    return bool(cv2.imwrite(str(path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality]))


def make_contact_sheet(items: list[tuple[Path, str]], output: Path, columns: int = 4, thumb_width: int = 420) -> None:
    if not items:
        return
    opened: list[tuple[Image.Image, str]] = []
    for path, label in items:
        try:
            im = Image.open(path).convert("RGB")
            ratio = thumb_width / im.width
            opened.append((im.resize((thumb_width, max(1, int(im.height * ratio)))), label))
        except Exception:
            continue
    if not opened:
        return
    label_h = 40
    cell_h = max(im.height for im, _ in opened) + label_h
    rows = math.ceil(len(opened) / columns)
    canvas = Image.new("RGB", (columns * thumb_width, rows * cell_h), "white")
    draw = ImageDraw.Draw(canvas)
    for i, (im, label) in enumerate(opened):
        x = (i % columns) * thumb_width
        y = (i // columns) * cell_h
        canvas.paste(im, (x, y))
        draw.text((x + 8, y + im.height + 8), label, fill="black")
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, quality=92)


def audio_energy(src: Path, output_dir: Path, duration: float) -> dict[str, Any] | None:
    wav_path = output_dir / "audio_mono_16k.wav"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "1", "-ar", "16000", str(wav_path)]
    proc = subprocess.run(cmd, text=True, capture_output=True)
    if proc.returncode != 0 or not wav_path.exists():
        return None
    try:
        with wave.open(str(wav_path), "rb") as wf:
            rate = wf.getframerate()
            n = wf.getnframes()
            raw = wf.readframes(n)
            sampwidth = wf.getsampwidth()
        dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(sampwidth)
        if dtype is None:
            return None
        data = np.frombuffer(raw, dtype=dtype).astype(np.float32)
        maxv = float(np.iinfo(dtype).max)
        data /= maxv if maxv else 1.0
        step = max(1, int(rate * 0.1))
        points = []
        for i in range(0, len(data), step):
            chunk = data[i:i+step]
            if len(chunk) == 0:
                continue
            rms = float(np.sqrt(np.mean(chunk * chunk)))
            points.append({"seconds": round(i / rate, 3), "rms": round(rms, 6)})
        result = {"sample_rate": rate, "window_seconds": 0.1, "points": points}
        write_json(output_dir / "audio_energy.json", result)
        return result
    finally:
        try:
            wav_path.unlink()
        except OSError:
            pass


def mean_audio_for_range(audio: dict[str, Any] | None, start: float, end: float) -> float | None:
    if not audio:
        return None
    vals = [p["rms"] for p in audio.get("points", []) if start <= p["seconds"] < end]
    return float(np.mean(vals)) if vals else None


def main() -> int:
    ap = argparse.ArgumentParser(description="Decode a video stream, detect shots, extract evidence frames, and create a shot catalog.")
    ap.add_argument("input", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--base-sample-fps", type=float, default=4.0)
    ap.add_argument("--adaptive-sample-fps", type=float, default=24.0, help="Recorded in manifest; exact-frame boundary refinement always uses source frames.")
    ap.add_argument("--scene-threshold", type=float, default=0.48)
    ap.add_argument("--min-shot-seconds", type=float, default=0.45)
    ap.add_argument("--boundary-refine-window", type=float, default=0.6)
    ap.add_argument("--jpeg-quality", type=int, default=90)
    ap.add_argument("--contact-sheet-columns", type=int, default=4)
    args = ap.parse_args()

    src = args.input.expanduser().resolve()
    out = args.output.expanduser().resolve()
    if not src.exists():
        raise FileNotFoundError(src)
    if shutil.which("ffprobe") is None or shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg and ffprobe must be available on PATH")
    out.mkdir(parents=True, exist_ok=True)
    (out / "keyframes").mkdir(exist_ok=True)
    (out / "contact_sheets").mkdir(exist_ok=True)

    meta = ffprobe(src)
    vs = video_stream(meta)
    avg_fps = parse_rate(vs.get("avg_frame_rate"))
    r_fps = parse_rate(vs.get("r_frame_rate"))
    fps = avg_fps or r_fps
    if fps <= 0:
        raise RuntimeError("Unable to determine video FPS")
    duration = float(vs.get("duration") or meta.get("format", {}).get("duration") or 0.0)
    width, height = int(vs.get("width", 0)), int(vs.get("height", 0))
    nb_frames = int(vs.get("nb_frames") or round(duration * fps))
    vfr = bool(avg_fps and r_fps and abs(avg_fps - r_fps) > 0.01)
    tags = vs.get("tags") or {}
    start_tc = tags.get("timecode") or (meta.get("format", {}).get("tags") or {}).get("timecode") or "00:00:00:00"

    cap = cv2.VideoCapture(str(src))
    if not cap.isOpened():
        raise RuntimeError(f"OpenCV cannot open {src}")

    sample_step = max(1, int(round(fps / max(0.1, args.base_sample_fps))))
    samples: list[Sample] = []
    prev_gray = None
    frame_no = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_no % sample_step == 0:
            hist, brightness, sharpness, motion, gray = frame_features(frame, prev_gray)
            samples.append(Sample(frame_no, frame_no / fps, hist, brightness, sharpness, motion))
            prev_gray = gray
        frame_no += 1

    if not samples:
        raise RuntimeError("No frames decoded")

    min_gap = max(1, int(round(args.min_shot_seconds * fps)))
    candidates: list[tuple[int, float]] = []
    last = 0
    for a, b in zip(samples, samples[1:]):
        score = hist_distance(a.hist, b.hist)
        if score >= args.scene_threshold and b.frame - last >= min_gap:
            candidates.append((b.frame, score))
            last = b.frame

    cap2 = cv2.VideoCapture(str(src))
    refined: list[tuple[int, float]] = []
    for cand, coarse_score in candidates:
        fr, exact_score = refine_boundary(cap2, cand, fps, args.boundary_refine_window)
        if fr - (refined[-1][0] if refined else 0) >= min_gap:
            refined.append((fr, max(coarse_score, exact_score)))
    cap2.release()

    boundaries = [0] + [f for f, _ in refined if 0 < f < nb_frames] + [max(1, nb_frames)]
    boundaries = sorted(set(boundaries))
    audio = audio_energy(src, out, duration) if audio_streams(meta) else None

    cap3 = cv2.VideoCapture(str(src))
    shot_records = []
    all_contact_items: list[tuple[Path, str]] = []
    for idx in range(len(boundaries) - 1):
        start_f, end_f = boundaries[idx], boundaries[idx+1]
        if end_f <= start_f:
            continue
        start_s, end_s = start_f / fps, end_f / fps
        length = end_f - start_f
        key_frames = sorted(set([
            start_f + min(max(1, int(length * 0.08)), max(0, length-1)),
            start_f + max(0, length // 2),
            start_f + max(0, int(length * 0.92) - 1),
        ]))
        # Add the strongest sampled motion moment inside the shot.
        inside = [s for s in samples if start_f <= s.frame < end_f]
        if inside:
            key_frames.append(max(inside, key=lambda s: s.motion).frame)
        key_frames = sorted(set(min(end_f-1, max(start_f, f)) for f in key_frames))

        evidence = []
        contact_items = []
        shot_id = f"{safe_name(src.stem)}_S{idx+1:04d}"
        for k, fno in enumerate(key_frames, 1):
            p = out / "keyframes" / f"{shot_id}_K{k:02d}_{fno:08d}.jpg"
            if extract_frame(cap3, fno, p, args.jpeg_quality):
                label = f"{shot_id}  {seconds_to_tc(fno/fps, fps)}  F{fno}"
                evidence.append({"path": str(p), "seconds": round(fno/fps, 6), "frame": fno, "note": "decoded evidence frame"})
                contact_items.append((p, label))
                all_contact_items.append((p, label))
        contact_path = out / "contact_sheets" / f"{shot_id}.jpg"
        make_contact_sheet(contact_items, contact_path, args.contact_sheet_columns)

        b_vals = [s.brightness for s in inside] or [0.0]
        sh_vals = [s.sharpness for s in inside] or [0.0]
        m_vals = [s.motion for s in inside] or [0.0]
        issues = []
        if np.mean(sh_vals) < 50:
            issues.append("possible_soft_focus_or_low_detail")
        if np.mean(b_vals) < 25:
            issues.append("possible_underexposure")
        if np.mean(b_vals) > 235:
            issues.append("possible_overexposure")
        boundary_score = 1.0 if idx == 0 else next((s for f, s in refined if f == start_f), 0.5)
        record = {
            "shot_id": shot_id,
            "source": {"path": str(src), "reel": src.stem[:8], "fps": fps, "start_timecode": start_tc, "vfr": vfr},
            "time": {
                "start_seconds": round(start_s, 6), "end_seconds": round(end_s, 6),
                "start_frame": start_f, "end_frame": end_f,
                "source_in_tc": seconds_to_tc(start_s, fps), "source_out_tc": seconds_to_tc(end_s, fps)
            },
            "technical": {
                "width": width, "height": height,
                "mean_brightness": round(float(np.mean(b_vals)), 4),
                "mean_sharpness": round(float(np.mean(sh_vals)), 4),
                "motion_score": round(float(np.mean(m_vals)), 6),
                "audio_rms": None if (a := mean_audio_for_range(audio, start_s, end_s)) is None else round(a, 6),
                "issues": issues
            },
            "semantic": {"shot_size":"","camera_motion":"","subjects":[],"actions":[],"eye_line":"","screen_direction":"","emotion":"","dialogue":[],"performance_beats":[],"narrative_function":[]},
            "usable_ranges": [],
            "evidence": {"keyframes": evidence, "contact_sheet": str(contact_path)},
            "confidence": {"boundary": round(min(1.0, max(0.0, boundary_score)), 4), "technical": 0.8, "semantic": 0.0},
            "notes": ["Semantic fields require visual/model review; do not treat empty fields as negative evidence."]
        }
        shot_records.append(record)
    cap3.release()

    with (out / "shots.jsonl").open("w", encoding="utf-8") as f:
        for rec in shot_records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    make_contact_sheet(all_contact_items, out / "contact_sheets" / "ALL_SHOTS.jpg", args.contact_sheet_columns)
    manifest = {
        "source": str(src), "generated_by": "cinematic-stream-editor/scripts/analyze_video.py",
        "video": {"codec": vs.get("codec_name"), "width": width, "height": height, "avg_fps": avg_fps, "r_fps": r_fps, "working_fps": fps, "duration_seconds": duration, "nb_frames": nb_frames, "vfr_warning": vfr, "start_timecode": start_tc},
        "audio_streams": [{"codec": a.get("codec_name"), "sample_rate": a.get("sample_rate"), "channels": a.get("channels")} for a in audio_streams(meta)],
        "analysis": {"base_sample_fps": args.base_sample_fps, "adaptive_sample_fps_requested": args.adaptive_sample_fps, "scene_threshold": args.scene_threshold, "min_shot_seconds": args.min_shot_seconds, "boundary_refine_window_seconds": args.boundary_refine_window, "decoded_frame_count": frame_no}
    }
    write_json(out / "project_manifest.json", manifest)
    write_json(out / "summary.json", {"source": str(src), "shots_detected": len(shot_records), "candidate_boundaries": len(candidates), "refined_boundaries": len(refined), "output": str(out)})
    print(json.dumps({"ok": True, "shots": len(shot_records), "output": str(out)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise
