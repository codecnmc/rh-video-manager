#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("shots", type=Path)
    ap.add_argument("--output", type=Path)
    args = ap.parse_args()
    rows = [json.loads(line) for line in args.shots.read_text(encoding="utf-8").splitlines() if line.strip()]
    md = ["# Shot Catalog Summary", "", f"Shots: {len(rows)}", "", "| Shot | Source range | Duration | Motion | Sharpness | Issues |", "|---|---:|---:|---:|---:|---|"]
    for r in rows:
        t = r["time"]
        tech = r["technical"]
        md.append(f"| {r['shot_id']} | {t['source_in_tc']}–{t['source_out_tc']} | {t['end_seconds']-t['start_seconds']:.2f}s | {tech.get('motion_score',0):.3f} | {tech.get('mean_sharpness',0):.1f} | {', '.join(tech.get('issues',[]))} |")
    text = "\n".join(md) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
