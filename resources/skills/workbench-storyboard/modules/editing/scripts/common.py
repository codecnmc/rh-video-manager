from __future__ import annotations

import json
import math
import re
import subprocess
from pathlib import Path
from typing import Any


def run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=check, text=True, capture_output=True)


def ffprobe(path: Path) -> dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path)
    ]
    return json.loads(run(cmd).stdout)


def parse_rate(value: str | None) -> float:
    if not value or value in {"0/0", "N/A"}:
        return 0.0
    if "/" in value:
        a, b = value.split("/", 1)
        return float(a) / float(b) if float(b) else 0.0
    return float(value)


def safe_name(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "_", value)
    return value.strip("._") or "media"


def seconds_to_tc(seconds: float, fps: float) -> str:
    nominal = max(1, round(fps))
    total_frames = max(0, int(round(seconds * fps)))
    ff = total_frames % nominal
    total_seconds = total_frames // nominal
    ss = total_seconds % 60
    mm = (total_seconds // 60) % 60
    hh = total_seconds // 3600
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"


def tc_to_frames(tc: str, fps: float) -> int:
    parts = re.split(r"[:;]", tc)
    if len(parts) != 4:
        raise ValueError(f"Unsupported timecode: {tc}")
    hh, mm, ss, ff = map(int, parts)
    nominal = max(1, round(fps))
    return (((hh * 60 + mm) * 60) + ss) * nominal + ff


def frames_to_tc(frames: int, fps: float) -> str:
    nominal = max(1, round(fps))
    frames = max(0, int(frames))
    ff = frames % nominal
    total_seconds = frames // nominal
    ss = total_seconds % 60
    mm = (total_seconds // 60) % 60
    hh = total_seconds // 3600
    return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
