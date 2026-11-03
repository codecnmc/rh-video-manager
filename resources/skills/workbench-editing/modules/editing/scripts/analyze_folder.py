#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

VIDEO_EXTS = {".mp4", ".mov", ".mxf", ".avi", ".mkv", ".webm", ".mts", ".m2ts"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--base-sample-fps", type=float, default=4.0)
    ap.add_argument("--scene-threshold", type=float, default=0.48)
    args = ap.parse_args()
    root = args.input.resolve()
    out = args.output.resolve()
    files = sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTS)
    results = []
    script = Path(__file__).with_name("analyze_video.py")
    for src in files:
        rel = src.relative_to(root)
        dst = out / rel.parent / src.stem
        cmd = [sys.executable, str(script), str(src), "--output", str(dst), "--base-sample-fps", str(args.base_sample_fps), "--scene-threshold", str(args.scene_threshold)]
        proc = subprocess.run(cmd, text=True, capture_output=True)
        results.append({"source": str(src), "returncode": proc.returncode, "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip(), "output": str(dst)})
    out.mkdir(parents=True, exist_ok=True)
    (out / "batch_summary.json").write_text(json.dumps({"files": len(files), "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": all(r["returncode"] == 0 for r in results), "files": len(files), "output": str(out)}, ensure_ascii=False))
    return 0 if all(r["returncode"] == 0 for r in results) else 2


if __name__ == "__main__":
    raise SystemExit(main())
