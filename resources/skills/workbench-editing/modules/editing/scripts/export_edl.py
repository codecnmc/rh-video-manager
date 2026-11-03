#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description="Export a basic CMX3600 EDL from edit_plan.json")
    ap.add_argument("plan", type=Path)
    ap.add_argument("--output", type=Path, required=True)
    args = ap.parse_args()
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    title = plan.get("timeline", {}).get("name", "ROUGH_CUT")
    lines = [f"TITLE: {title}", "FCM: NON-DROP FRAME", ""]
    for i, e in enumerate(plan.get("edits", []), 1):
        reel = (e.get("reel") or Path(e["source"]).stem)[:8].upper().ljust(8)
        transition = "C"
        lines.append(f"{i:03d}  {reel} V     {transition}        {e['source_in']} {e['source_out']} {e['record_in']} {e['record_out']}")
        lines.append(f"* FROM CLIP NAME: {Path(e['source']).name}")
        lines.append(f"* COMMENT: {e.get('reason','')} | {e.get('rationale','')}")
        lines.append("")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines), encoding="utf-8")
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
