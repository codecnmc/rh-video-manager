#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fields = ["event","source","reel","source_in","source_out","record_in","record_out","track","reason","rationale","confidence","alternatives"]
    with args.output.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for e in plan.get("edits", []):
            row = {k: e.get(k, "") for k in fields}
            row["alternatives"] = " | ".join(e.get("alternatives", []))
            w.writerow(row)
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
