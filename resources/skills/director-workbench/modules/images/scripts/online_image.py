#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


DEFAULT_BASE_URL = "https://vovoapi.com"
DEFAULT_KEY_FILE = pathlib.Path(__file__).resolve().parents[1] / "key.txt"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_request(request, timeout):
    address = request.full_url if isinstance(request, urllib.request.Request) else request
    parsed = urllib.parse.urlsplit(address)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("An HTTPS URL without embedded credentials is required")
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)


SUPPORTED_SIZES = (
    "1024x1024",
    "1280x720",
    "720x1280",
    "1280x800",
    "2048x2048",
    "2048x1152",
    "1152x2048",
    "2560x1600",
    "2880x2880",
    "3840x2160",
    "2160x3840",
    "3584x2240",
)


def read_key_file(path):
    key_path = pathlib.Path(path)
    if not key_path.exists():
        return None, None

    lines = key_path.read_text(encoding="utf-8-sig").splitlines()
    base_url = lines[0].strip() if len(lines) >= 1 else ""
    api_key = lines[1].strip() if len(lines) >= 2 else ""
    return base_url or None, api_key or None


def resolve_config(args):
    file_base_url, file_api_key = read_key_file(args.key_file)
    args.base_url = args.base_url or file_base_url or os.environ.get("ONLINE_IMAGE_BASE_URL") or DEFAULT_BASE_URL
    args.api_key = args.api_key or file_api_key or os.environ.get("ONLINE_IMAGE_API_KEY")


def request_json(url, api_key, payload, timeout):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with open_request(req, timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def encode_multipart(fields, files):
    boundary = f"----CodexOnlineImage{uuid.uuid4().hex}"
    chunks = []

    for name, value in fields:
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    for field_name, file_path in files:
        path = pathlib.Path(file_path)
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            (
                f'Content-Disposition: form-data; name="{field_name}"; '
                f'filename="{path.name}"\r\nContent-Type: {mime}\r\n\r\n'
            ).encode("utf-8")
        )
        chunks.append(path.read_bytes())
        chunks.append(b"\r\n")

    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return boundary, b"".join(chunks)


def request_multipart(url, api_key, fields, files, timeout):
    boundary, body = encode_multipart(fields, files)
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with open_request(req, timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def download_url(url, output_path, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "Codex online-image"})
    with open_request(req, timeout) as response:
        output_path.write_bytes(response.read())


def output_extension(output_format, url=None):
    if output_format:
        return "." + output_format.lstrip(".").lower()
    if url:
        suffix = pathlib.Path(urllib.parse.urlparse(url).path).suffix
        if suffix:
            return suffix
    return ".png"


def save_images(response_json, output_dir, prefix, output_format, timeout):
    output_dir.mkdir(parents=True, exist_ok=True)
    data = response_json.get("data")
    if not isinstance(data, list):
        data = [response_json]

    saved = []
    for index, item in enumerate(data, start=1):
        if not isinstance(item, dict):
            continue

        ext = output_extension(output_format, item.get("url"))
        stamp = time.strftime("%Y%m%d-%H%M%S")
        output_path = output_dir / f"{prefix}-{stamp}-{uuid.uuid4().hex}-{index}{ext}"

        if item.get("b64_json"):
            output_path.write_bytes(base64.b64decode(item["b64_json"]))
            saved.append(output_path)
        elif item.get("url"):
            download_url(item["url"], output_path, timeout)
            saved.append(output_path)

    if not saved:
        raise RuntimeError("No image URL or b64_json found; request may have been accepted. Do not automatically retry.")

    return saved


def add_common_arguments(parser):
    parser.add_argument("--prompt", required=True)
    parser.add_argument(
        "--key-file",
        default=DEFAULT_KEY_FILE,
        help="Config file (defaults to the skill root key.txt): first line base URL, second line API key.",
    )
    parser.add_argument("--api-key")
    parser.add_argument("--base-url")
    parser.add_argument("--model", default="auto")
    parser.add_argument(
        "--size",
        choices=SUPPORTED_SIZES,
        default="1280x720",
        help="Output dimensions. Must be one of the service-supported 1K, 2K, or 4K sizes.",
    )
    parser.add_argument("--quality", default="high")
    parser.add_argument("--output-format", default="png")
    parser.add_argument("--moderation", default="low")
    parser.add_argument("--n", type=int, default=1)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--prefix", default="online-image")
    parser.add_argument("--timeout", type=int, default=180)


def build_payload(args):
    return {
        "model": args.model,
        "prompt": args.prompt,
        "size": args.size,
        "quality": args.quality,
        "output_format": args.output_format,
        "moderation": args.moderation,
        "n": args.n,
    }


def run_generate(args):
    response = request_json(
        args.base_url.rstrip("/") + "/v1/images/generations",
        args.api_key,
        build_payload(args),
        args.timeout,
    )
    return save_images(response, pathlib.Path(args.output_dir), args.prefix, args.output_format, args.timeout)


def run_edit(args):
    fields = [(key, value) for key, value in build_payload(args).items()]
    files = [("image[]", image) for image in args.image]
    response = request_multipart(
        args.base_url.rstrip("/") + "/v1/images/edits",
        args.api_key,
        fields,
        files,
        args.timeout,
    )
    return save_images(response, pathlib.Path(args.output_dir), args.prefix, args.output_format, args.timeout)


def main():
    parser = argparse.ArgumentParser(description="Generate or edit images with an OpenAI-compatible image API.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_parser = subparsers.add_parser("generate", help="Text-to-image via /v1/images/generations")
    add_common_arguments(generate_parser)

    edit_parser = subparsers.add_parser("edit", help="Text plus reference image via /v1/images/edits")
    add_common_arguments(edit_parser)
    edit_parser.add_argument("--image", action="append", required=True, help="Reference image path. Repeat for multiple images.")

    args = parser.parse_args()
    resolve_config(args)
    if not args.api_key:
        key_file = pathlib.Path(args.key_file).resolve()
        parser.error(f"Provide --api-key, set ONLINE_IMAGE_API_KEY, or create {key_file} with base URL on line 1 and API key on line 2.")

    try:
        saved = run_generate(args) if args.command == "generate" else run_edit(args)
    except urllib.error.HTTPError as error:
        print(f"HTTP {error.code}; acceptance unknown. Do not automatically retry.", file=sys.stderr)
        error.close()
        return 1
    except Exception:
        print("Image operation failed; acceptance or output availability may be unknown. Do not automatically retry.", file=sys.stderr)
        return 1

    for path in saved:
        print(path.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
