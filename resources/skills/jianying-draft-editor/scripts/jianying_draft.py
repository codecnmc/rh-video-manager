"""Compile a restricted, explicit local edit plan into a new Jianying draft."""

import argparse
from contextlib import redirect_stdout
from datetime import datetime
import hashlib
import io
import sys

if sys.version_info < (3, 8):
    raise SystemExit("Select Python 3.8 or newer; the system default Python is not supported")

from importlib import metadata
import json
import math
from pathlib import Path
import re
import shutil
import time
from uuid import uuid4


MAX_US = 86_400_000_000
PACKAGE_VERSION = "0.3.1"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fields(value, required, optional=()):
    require(isinstance(value, dict), "Expected an object")
    require(set(required) <= value.keys(), "Missing fields: " + ", ".join(set(required) - value.keys()))
    require(value.keys() <= set(required) | set(optional), "Unsupported fields: " + ", ".join(value.keys() - set(required) - set(optional)))


def integer(value, label, minimum=0, maximum=MAX_US):
    require(type(value) is int and minimum <= value <= maximum, "Invalid integer: " + label)
    return value


def text(value, label, maximum=200):
    require(isinstance(value, str) and value.strip() and len(value) <= maximum, "Invalid text: " + label)
    return value


def local_path(value):
    text(value, "local path", 2000)
    require(not value.startswith(("\\\\", "//")), "Network paths are not supported")
    path = Path(value)
    require(path.is_absolute(), "Expected an absolute local path: " + value)
    resolved = path.resolve(strict=True)
    require(not str(resolved).startswith(("\\\\", "//")), "Resolved network paths are not supported")
    return resolved


def within(path, root):
    return path == root or root in path.parents


def check_segments(items, assets, kind):
    require(isinstance(items, list) and len(items) <= 10000, "Invalid segment list")
    ends = {}
    for item in sorted(items, key=lambda entry: entry.get("startUs", 0) if isinstance(entry, dict) and type(entry.get("startUs", 0)) is int else 0):
        optional = ("fadeInUs", "fadeOutUs") if kind == "audio" else (("monochrome",) if kind == "video" else ())
        if kind == "video" and "monochrome" in item:
            require(type(item["monochrome"]) is bool, "monochrome must be a boolean")
        required = ("startUs", "durationUs", "text") if kind == "caption" else ("assetId", "startUs", "durationUs", "sourceInUs", "volume")
        if kind == "audio":
            required += ("track",)
        fields(item, required, optional)
        start = integer(item["startUs"], "startUs")
        duration = integer(item["durationUs"], "durationUs", 1)
        integer(start + duration, "segment end", 1)
        track = text(item["track"], "audio track", 80) if kind == "audio" else kind
        require(start >= ends.get(track, 0), "Overlapping segments on track: " + track)
        ends[track] = start + duration
        if kind == "caption":
            text(item["text"], "caption", 2000)
            continue
        asset_id = text(item["assetId"], "assetId")
        require(asset_id in assets, "Unknown asset: " + asset_id)
        asset = assets[asset_id]
        allowed = ("video", "image") if kind == "video" else ("audio",)
        require(asset["kind"] in allowed, "Wrong media kind: " + asset_id)
        source_in = integer(item["sourceInUs"], "sourceInUs")
        integer(source_in + duration, "source end", 1)
        gain = item["volume"]
        require(type(gain) in (int, float) and math.isfinite(gain) and 0 <= gain <= 2, "Invalid volume")
        if asset["kind"] == "image":
            require(source_in == 0 and gain == 0, "Images require sourceInUs=0 and volume=0")
        if kind == "audio":
            fade_in = integer(item.get("fadeInUs", 0), "fadeInUs")
            fade_out = integer(item.get("fadeOutUs", 0), "fadeOutUs")
            require(fade_in + fade_out <= duration, "Audio fades exceed duration")
    return max(ends.values(), default=0)


def validate_plan(plan, media_roots):
    fields(plan, ("schemaVersion", "draftName", "canvas", "assets", "video", "audio", "captions"), ("provenance", "mode"))
    require(plan.get("mode", "edit") in ("edit", "importOnly"), "Unsupported plan mode")
    require(type(plan["schemaVersion"]) is int and plan["schemaVersion"] == 1, "Unsupported schema version")
    text(plan["draftName"], "draftName", 100)
    canvas = plan["canvas"]
    fields(canvas, ("width", "height", "fps"))
    for key in ("width", "height"):
        size = integer(canvas[key], key, 128, 4096)
        require(size % 2 == 0, "Canvas dimensions must be even")
    integer(canvas["fps"], "fps", 1, 60)
    if "provenance" in plan:
        origin = plan["provenance"]
        fields(origin, (), ("projectId", "assemblyId", "versionId", "revision"))
        for key, value in origin.items():
            if key == "revision":
                integer(value, key, 1)
            elif key != "projectId" or value is not None:
                text(value, key)
    roots = [local_path(str(root)) for root in media_roots]
    require(roots and all(root.is_dir() for root in roots), "Provide existing authorized media directories")
    require(isinstance(plan["assets"], list) and 0 < len(plan["assets"]) <= 10000, "Invalid assets")
    assets = {}
    for item in plan["assets"]:
        fields(item, ("id", "kind", "path"), ("name",))
        if "name" in item:
            text(item["name"], "asset name", 500)
        asset_id = text(item["id"], "asset ID")
        require(asset_id not in assets, "Duplicate asset ID: " + asset_id)
        require(item["kind"] in ("video", "image", "audio"), "Unsupported asset kind")
        path = local_path(item["path"])
        require(any(within(path, root) for root in roots), "Media is outside authorized roots: " + str(path))
        require(path.is_file(), "Not a media file: " + str(path))
        assets[asset_id] = {**item, "path": path}
    if plan.get("mode") == "importOnly":
        require(plan["video"] == [] and plan["audio"] == [] and plan["captions"] == [],
                "Import-only mode requires an empty timeline")
        return assets, 0
    video_end = check_segments(plan["video"], assets, "video")
    require(video_end > 0, "At least one video/image segment is required")
    audio_end = check_segments(plan["audio"], assets, "audio")
    caption_end = check_segments(plan["captions"], assets, "caption")
    require(max(audio_end, caption_end) <= video_end, "Audio/captions extend beyond the video timeline")
    used = {item["assetId"] for item in plan["video"] + plan["audio"]}
    require(used == set(assets), "The assets list contains unreferenced files")
    return assets, video_end


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def check_media_bounds(plan, assets, materials):
    for item in plan["video"] + plan["audio"]:
        asset = assets[item["assetId"]]
        material = materials[item["assetId"]]
        if asset["kind"] != "audio":
            expected = "photo" if asset["kind"] == "image" else "video"
            require(material.material_type == expected, "Actual media kind differs: " + asset["id"])
        require(item["sourceInUs"] + item["durationUs"] <= material.duration, "Source range exceeds actual media duration: " + asset["id"])


def verify_content(content, expected):
    actual = {}
    for track in content["tracks"]:
        actual[track["name"]] = []
        for segment in track["segments"]:
            source = segment.get("source_timerange")
            actual[track["name"]].append({
                "start": segment["target_timerange"]["start"],
                "duration": segment["target_timerange"]["duration"],
                "source": source,
                "material": segment["material_id"],
                "volume": segment.get("volume", 1),
            })
    ordered = lambda rows: sorted(rows, key=lambda row: row["start"])
    require(actual.keys() == expected.keys(), "Readback track names differ")
    for name, rows in expected.items():
        require(ordered(actual[name]) == ordered(rows), "Readback segment mismatch: " + name)


def verify_monochrome(content, plan):
    # 原生滤镜必须既有素材记录，也被对应片段引用；不能仅检查饱和度关键帧。
    filters = {item["id"]: item for item in content["materials"].get("effects", [])
               if item.get("type") == "filter"}
    track = next((item for item in content["tracks"] if item["name"] == "V1"), None)
    segments = sorted(track["segments"], key=lambda item: item["target_timerange"]["start"]) if track else []
    planned = sorted(plan["video"], key=lambda item: item["startUs"])
    require(len(segments) == len(planned), "Filter readback segment count differs")
    referenced = set()
    for segment, item in zip(segments, planned):
        linked = [filters[key] for key in segment.get("extra_material_refs", []) if key in filters]
        if item.get("monochrome", False):
            require(len(linked) == 1, "Missing monochrome filter reference")
            effect = linked[0]
            require(effect.get("effect_id") == "7127655037026848031"
                    and effect.get("value") == 1.0, "Monochrome filter or intensity differs")
            referenced.add(effect["id"])
        else:
            require(not linked, "Unexpected filter on a color segment")
    require(referenced == set(filters), "Unexpected unreferenced filter materials")
    return sum(item.get("monochrome", False) for item in planned)


def write_metadata(stage, target, name, content, materials):
    """Register copied media in the local bin without adding timeline segments."""
    meta_path = stage / "draft_meta_info.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8-sig"))
    now = int(time.time() * 1_000_000)
    entries = []
    for material in materials.values():
        is_video = hasattr(material, "material_type")
        kind = material.material_type if is_video else "music"
        entries.append({
            "id": material.material_id, "file_Path": material.path,
            "extra_info": material.material_name, "duration": material.duration,
            "width": getattr(material, "width", 0), "height": getattr(material, "height", 0),
            "metetype": kind, "type": 0, "item_source": 1,
            "create_time": now // 1_000_000, "import_time": now // 1_000_000,
            "import_time_ms": now // 1_000, "md5": "",
            "roughcut_time_range": {"start": -1, "duration": -1},
            "sub_time_range": {"start": -1, "duration": -1},
        })
    meta.update(draft_id=content["id"], draft_name=name, draft_fold_path=str(target),
                draft_root_path=str(target.parent), tm_duration=content["duration"],
                tm_draft_create=now, tm_draft_modified=now)
    next(group for group in meta["draft_materials"] if group["type"] == 0)["value"] = entries
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    restored = json.loads(meta_path.read_text(encoding="utf-8"))
    saved = next(group["value"] for group in restored["draft_materials"] if group["type"] == 0)
    require(saved == entries and restored["draft_id"] == content["id"], "Material bin readback differs")


def build_draft(plan, assets, duration_us, draft_root, draft):
    root = local_path(str(draft_root))
    require(root.is_dir(), "Draft root must be an existing directory")
    require(sys.platform == "win32", "Draft publishing currently supports Windows only")
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", plan["draftName"]).strip(" .")[:70] or "draft"
    name = "jy-" + safe_name + "-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid4().hex[:10]
    target = root / name
    materials = {}
    for asset_id, item in assets.items():
        material_type = draft.AudioMaterial if item["kind"] == "audio" else draft.VideoMaterial
        materials[asset_id] = material_type(str(item["path"]))
        if item["kind"] != "audio":
            expected_kind = "photo" if item["kind"] == "image" else "video"
            require(materials[asset_id].material_type == expected_kind, "Actual media kind differs: " + asset_id)
        if "name" in item:
            materials[asset_id].material_name = item["name"]
    check_media_bounds(plan, assets, materials)
    stage_root = root / (".jy-pending-" + uuid4().hex)
    stage_root.mkdir()
    try:
        script = draft.DraftFolder(str(stage_root)).create_draft(name, **plan["canvas"], maintrack_adsorb=False, allow_replace=False)
        script.content["id"] = str(uuid4()).upper()
        stage = stage_root / name
        media = stage / "media"
        media.mkdir()
        sources = []
        for index, (asset_id, item) in enumerate(assets.items()):
            source = item["path"]
            suffix = source.suffix.lower()
            require(re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) is not None, "Unsupported media filename extension")
            filename = str(index + 1).zfill(4) + suffix
            checksum = digest(source)
            copied = media / filename
            shutil.copyfile(source, copied)
            require(digest(copied) == checksum, "Media changed during copying: " + asset_id)
            materials[asset_id].path = str(target / "media" / filename)
            sources.append({"assetId": asset_id, "sha256": checksum, "file": "media/" + filename})
        import_only = plan.get("mode") == "importOnly"
        track_types = {} if import_only else {"V1": draft.TrackType.video}
        if import_only:
            for asset_id, material in materials.items():
                pool = script.materials.audios if assets[asset_id]["kind"] == "audio" else script.materials.videos
                pool.append(material)
        for item in plan["audio"]:
            track_types["A:" + item["track"]] = draft.TrackType.audio
        if plan["captions"]:
            track_types["captions"] = draft.TrackType.text
        script.append_tracks([draft.TrackSpec(kind, name) for name, kind in track_types.items()])
        expected = {name: [] for name in track_types}
        for group in ("video", "audio", "captions"):
            for item in sorted(plan[group], key=lambda entry: entry["startUs"]):
                timerange = draft.Timerange(item["startUs"], item["durationUs"])
                if group == "captions":
                    segment = draft.TextSegment(item["text"], timerange,
                        style=draft.TextStyle(size=5.0, align=1, auto_wrapping=True),
                        clip_settings=draft.ClipSettings(transform_y=-0.8))
                    track_name = "captions"
                    source_range = None
                else:
                    source_range = {"start": item["sourceInUs"], "duration": item["durationUs"]}
                    segment_type = draft.VideoSegment if group == "video" else draft.AudioSegment
                    segment = segment_type(materials[item["assetId"]], timerange,
                        source_timerange=draft.Timerange(**source_range), volume=item["volume"])
                    track_name = "V1" if group == "video" else "A:" + item["track"]
                    if group == "audio" and (item.get("fadeInUs", 0) or item.get("fadeOutUs", 0)):
                        segment.add_fade(item.get("fadeInUs", 0), item.get("fadeOutUs", 0))
                if group == "video" and item.get("monochrome", False):
                    segment.add_filter(draft.FilterType.默片, intensity=100)
                script.add_segment(segment, track_name)
                expected[track_name].append({"start": item["startUs"], "duration": item["durationUs"],
                    "source": source_range, "material": segment.material_id,
                    "volume": item.get("volume", 1)})
        script.save()
        content = json.loads((stage / "draft_content.json").read_text(encoding="utf-8-sig"))
        verify_content(content, expected)
        filter_count = verify_monochrome(content, plan)
        require(content["duration"] == duration_us, "Readback draft duration differs")
        stored_materials = content["materials"]["videos"] + content["materials"]["audios"]
        require({item["id"]: item["path"] for item in stored_materials}
                == {item.material_id: item.path for item in materials.values()}, "Readback material paths differ")
        write_metadata(stage, target, name, content, materials)
        # Text is stored in a separate material, not directly on its segment.
        text_materials = {item["id"]: json.loads(item["content"])["text"] for item in content["materials"]["texts"]}
        text_track = next((item for item in content["tracks"] if item["name"] == "captions"), None)
        if text_track:
            stored = [text_materials[item["material_id"]] for item in text_track["segments"]]
            require(stored == [item["text"] for item in sorted(plan["captions"], key=lambda entry: entry["startUs"])], "Readback caption text differs")
        receipt = {"status": "draft_created_not_opened_in_jianying", "packageVersion": PACKAGE_VERSION,
            "draftPath": str(target), "durationUs": duration_us, "sources": sources,
            "monochromeFilterSegments": filter_count, "mediaTranscoded": False,
            "filterRenderVerified": False,
            "mode": plan.get("mode", "edit"), "materialCount": len(materials),
            "readback": "empty_timeline_material_bin_paths_duration_verified" if import_only
                else "tracks_ranges_materials_volumes_text_duration_verified", "portableRelocation": False}
        for filename, data in (("skill-plan.json", plan), ("skill-receipt.json", receipt)):
            (stage / filename).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        require(not target.exists(), "Draft target already exists; refusing to overwrite")
        # Windows directory rename fails if the destination exists; old drafts remain untouched.
        stage.rename(target)
        stage_root.rmdir()
        return receipt
    except Exception as error:
        raise RuntimeError("Draft generation failed; partial files retained at " + str(stage_root) + ": " + str(error)) from error


def load_runtime():
    try:
        version = metadata.version("pyJianYingDraft")
    except metadata.PackageNotFoundError as error:
        raise RuntimeError("pyJianYingDraft is not installed in the selected Python; installation needs separate authorization") from error
    require(version == PACKAGE_VERSION, "Expected pyJianYingDraft==" + PACKAGE_VERSION + "; found " + version)
    # Upstream emits a large optional-effect catalogue during import; keep CLI JSON readable.
    with redirect_stdout(io.StringIO()):
        import pyJianYingDraft as draft
    return draft


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", type=Path)
    parser.add_argument("--media-root", type=Path, action="append", required=True)
    parser.add_argument("--draft-root", type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        require(args.plan.stat().st_size <= 8 * 1024 * 1024, "Plan exceeds 8 MiB")
        plan = json.loads(args.plan.read_text(encoding="utf-8-sig"))
        assets, duration_us = validate_plan(plan, args.media_root)
        if args.execute:
            require(args.draft_root is not None, "--execute requires --draft-root")
            with redirect_stdout(sys.stderr):
                result = build_draft(plan, assets, duration_us, args.draft_root, load_runtime())
        else:
            result = {"status": "preflight_only", "filesCreated": False, "actualMediaProbed": False,
                "assetCount": len(assets), "durationUs": duration_us, "packageVersionRequired": PACKAGE_VERSION}
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
