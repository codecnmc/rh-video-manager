#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path
from jsonschema import Draft202012Validator


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("document", type=Path)
    ap.add_argument("schema", type=Path)
    args = ap.parse_args()
    doc = json.loads(args.document.read_text(encoding="utf-8"))
    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    errors = sorted(Draft202012Validator(schema).iter_errors(doc), key=lambda e: list(e.path))
    if errors:
        for e in errors:
            print(f"ERROR {'/'.join(map(str, e.path)) or '<root>'}: {e.message}")
        return 2
    print("VALID")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
