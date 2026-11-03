#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def deep_merge(dst: dict, src: dict) -> dict:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v
    return dst


def main() -> int:
    ap = argparse.ArgumentParser(description="Merge timestamped/model/human shot annotations into shots.jsonl by shot_id.")
    ap.add_argument("shots", type=Path)
    ap.add_argument("annotations", type=Path, help="JSON object keyed by shot_id")
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    anns = json.loads(args.annotations.read_text(encoding="utf-8"))
    rows = [json.loads(line) for line in args.shots.read_text(encoding="utf-8").splitlines() if line.strip()]
    applied = 0
    for row in rows:
        ann = anns.get(row["shot_id"])
        if ann:
            deep_merge(row, ann)
            applied += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(json.dumps({"ok": True, "records": len(rows), "annotations_applied": applied, "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
