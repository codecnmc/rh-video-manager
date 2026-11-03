#!/usr/bin/env python3
"""Explicit ready-image batches; preflight by default, never automatic retries."""

import argparse
import base64
import concurrent.futures
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from online_image import SUPPORTED_SIZES, encode_multipart
from image_concurrency import ConcurrencyPool


MODULE = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = MODULE / "config" / "image-providers.json"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
MAX_IMAGE_BYTES = 64 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        raise ValueError(f"Cannot read valid JSON: {path}") from None


def identifier(value, field):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError(f"{field}: use 1-80 ASCII letters, digits, '_' or '-'")
    if value.upper() in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}:
        raise ValueError(f"{field}: Windows device names are not allowed")
    return value


def positive_int(value, field, maximum=64):
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f"{field}: expected integer 1..{maximum}")
    return value


def secure_url(value):
    if not isinstance(value, str) or any(ord(char) < 33 for char in value):
        raise ValueError("Expected an HTTPS URL without whitespace")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Expected an HTTPS URL without embedded credentials")
    return parsed


def credentials(provider, config_path):
    name = provider["id"]
    sources = [field for field in ("api_key", "keyFile", "apiKeyEnv") if field in provider]
    if len(sources) != 1:
        raise ValueError(f"{name}: configure exactly one api_key, keyFile or apiKeyEnv in {config_path}")
    if sources[0] == "api_key":
        if not isinstance(provider["api_key"], str):
            raise ValueError(f"{name}: api_key must be a string in {config_path}")
        key = provider["api_key"].strip()
        location = f"api_key field in {config_path}"
    elif sources[0] == "keyFile":
        if not isinstance(provider["keyFile"], str):
            raise ValueError(f"{name}: invalid keyFile in {config_path}")
        key_path = (config_path.parent / provider["keyFile"]).resolve()
        try:
            key = key_path.read_text(encoding="utf-8-sig").strip()
        except OSError:
            raise ValueError(f"{name}: add a single-line API key at {key_path}; config: {config_path}") from None
        location = str(key_path)
    else:
        variable = provider["apiKeyEnv"]
        if not isinstance(variable, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", variable):
            raise ValueError(f"{name}: invalid apiKeyEnv in {config_path}")
        key = os.environ.get(variable, "").strip()
        location = f"environment variable {variable}"
    if not key or any(char.isspace() for char in key):
        raise ValueError(f"{name}: add a single-line API key in {location}; config: {config_path}")
    return key


def preflight(config_path, jobs_path):
    if not config_path.is_file():
        raise ValueError(f"Add providers at {config_path}; use {MODULE / 'config' / 'image-providers.example.json'}")
    config, batch = read_json(config_path), read_json(jobs_path)
    if not isinstance(config, dict) or not isinstance(batch, dict):
        raise ValueError("Config and batch must be JSON objects")
    if not isinstance(config.get("modelFamily"), str) or not config["modelFamily"].strip():
        raise ValueError("Set the user-confirmed modelFamily in the provider config")
    limit = positive_int(config.get("globalConcurrency", 2), "globalConcurrency")
    rows = config.get("providers")
    jobs = batch.get("jobs")
    if not isinstance(rows, list) or not rows or not isinstance(jobs, list) or not jobs:
        raise ValueError("providers and jobs must be nonempty lists")
    providers, groups = {}, {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Each provider must be an object")
        name = identifier(row.get("id"), "provider.id")
        if name in providers:
            raise ValueError(f"Duplicate provider: {name}")
        parsed = secure_url(row.get("baseUrl"))
        if parsed.query or parsed.fragment or parsed.path not in ("", "/") or parsed.hostname.endswith(".invalid"):
            raise ValueError(f"{name}: set the actual HTTPS baseUrl without /v1, path, query or fragment")
        group = identifier(row.get("accountGroup", name), f"{name}.accountGroup")
        capacity = positive_int(row.get("maxConcurrency", 2), f"{name}.maxConcurrency")
        if group in groups and groups[group] != capacity:
            raise ValueError(f"{group}: shared account keys must use the same maxConcurrency")
        model = row.get("model")
        if not isinstance(model, str) or not model.strip() or model.lower() == "auto":
            raise ValueError(f"{name}: select an explicit API model, not auto")
        groups[group] = capacity
        providers[name] = {**row, "accountGroup": group, "maxConcurrency": capacity}
    output = batch.get("outputDir")
    if not isinstance(output, str) or not Path(output).is_absolute():
        raise ValueError("outputDir must be an absolute local path")
    seen, ready = set(), []
    for job in jobs:
        if not isinstance(job, dict):
            raise ValueError("Each job must be an object")
        name = identifier(job.get("id"), "job.id")
        if name.casefold() in seen:
            raise ValueError(f"Duplicate job: {name}")
        seen.add(name.casefold())
        provider_id = identifier(job.get("providerId"), f"{name}.providerId")
        if provider_id not in providers:
            raise ValueError(f"{name}: provider not configured: {provider_id}")
        command = job.get("command")
        if command not in ("generate", "edit"):
            raise ValueError(f"{name}: command must be generate or edit")
        if not isinstance(job.get("prompt"), str) or not job["prompt"].strip():
            raise ValueError(f"{name}: complete prompt required")
        size = job.get("size", "1280x720")
        if size not in SUPPORTED_SIZES:
            raise ValueError(f"{name}: unsupported size")
        images = job.get("images", [])
        if not isinstance(images, list) or (command == "edit" and not images) or (command == "generate" and images):
            raise ValueError(f"{name}: edit requires images; generate must not include images")
        for image in images:
            if not isinstance(image, str) or not Path(image).is_absolute() or not Path(image).is_file():
                raise ValueError(f"{name}: each reference must be an existing absolute local image path")
            with Path(image).open("rb") as stream:
                header = stream.read(12)
            if not (header.startswith(b"\x89PNG\r\n\x1a\n") or header.startswith(b"\xff\xd8\xff")
                    or header[:6] in (b"GIF87a", b"GIF89a") or (header[:4] == b"RIFF" and header[8:12] == b"WEBP")):
                raise ValueError(f"{name}: reference must be a PNG, JPEG, GIF or WebP image, not a text/config file")
        timeout = positive_int(job.get("timeout", 180), f"{name}.timeout", 3600)
        if any(field in job for field in ("dependsOn", "n", "apiKey", "api_key", "keyFile", "apiKeyEnv", "baseUrl", "model")):
            raise ValueError(f"{name}: use ready jobs only; configure model/credentials in providers; n is fixed at 1")
        ready.append({"id": name, "providerId": provider_id, "command": command,
                      "prompt": job["prompt"], "size": size, "images": images, "timeout": timeout})
    # 先检查全部就绪任务的凭据；任一缺失时不发起部分收费批次。
    credential_groups = {}
    for provider_id in sorted({job["providerId"] for job in ready}):
        providers[provider_id]["resolvedKey"] = credentials(providers[provider_id], config_path)
        provider = providers[provider_id]
        identity = (provider["baseUrl"].rstrip("/").lower(), provider["resolvedKey"])
        if identity in credential_groups and credential_groups[identity] != provider["accountGroup"]:
            raise ValueError(f"{provider_id}: duplicate credentials must share one accountGroup")
        credential_groups[identity] = provider["accountGroup"]
    return limit, providers, groups, ready, Path(output).resolve()


def write_record(path, record):
    temporary = path.with_suffix(f".{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def run_job(job, provider, directory):
    directory.mkdir()
    record = {"id": job["id"], "providerId": provider["id"], "state": "preparing", "files": []}
    status_path = directory / "status.json"
    write_record(status_path, record)
    phase = "preparing"
    try:
        payload = {"model": provider["model"], "prompt": job["prompt"], "size": job["size"],
                   "quality": "high", "output_format": "png", "moderation": "low", "n": 1}
        if job["command"] == "edit":
            boundary, data = encode_multipart(list(payload.items()), [("image[]", image) for image in job["images"]])
            content_type = f"multipart/form-data; boundary={boundary}"
        else:
            data, content_type = json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json"
        endpoint = "/v1/images/edits" if job["command"] == "edit" else "/v1/images/generations"
        request = urllib.request.Request(provider["baseUrl"].rstrip("/") + endpoint, data=data, method="POST",
                                         headers={"Authorization": f"Bearer {provider['resolvedKey']}", "Content-Type": content_type})
        # 请求前持久化，崩溃后的 submitting 不得被当作未发起而自动重试。
        record["state"] = phase = "submitting"
        write_record(status_path, record)
        opener = urllib.request.build_opener(NoRedirect())
        with opener.open(request, timeout=job["timeout"]) as response:
            raw = response.read(MAX_IMAGE_BYTES + 1)
        if len(raw) > MAX_IMAGE_BYTES:
            raise ValueError("Response exceeds size limit")
        result = json.loads(raw)
        record["state"] = phase = "accepted_output_pending"
        write_record(status_path, record)
        items = result.get("data", [result]) if isinstance(result, dict) else []
        if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
            raise ValueError("Expected one image response")
        item = items[0]
        if item.get("b64_json"):
            image_data = base64.b64decode(item["b64_json"], validate=True)
        elif item.get("url"):
            secure_url(item["url"])
            # 下载不带服务密钥，拒绝重定向；下载失败不重新提交生图。
            with opener.open(urllib.request.Request(item["url"], headers={"User-Agent": "director-workbench"}), timeout=job["timeout"]) as response:
                image_data = response.read(MAX_IMAGE_BYTES + 1)
        else:
            raise ValueError("No image data")
        if not image_data or len(image_data) > MAX_IMAGE_BYTES:
            raise ValueError("Invalid image size")
        if image_data.startswith(b"\x89PNG\r\n\x1a\n"):
            extension = ".png"
        elif image_data.startswith(b"\xff\xd8\xff"):
            extension = ".jpg"
        elif image_data[:4] == b"RIFF" and image_data[8:12] == b"WEBP":
            extension = ".webp"
        else:
            raise ValueError("Unrecognized image format")
        target = directory / ("image" + extension)
        with target.open("xb") as stream:
            stream.write(image_data)
        record.update(state="saved_unreviewed", files=[str(target)])
    except urllib.error.HTTPError as error:
        record.update(state="acceptance_unknown" if phase == "submitting" else "accepted_output_unavailable")
        record["httpStatus"] = error.code
        record["stopAccount"] = phase == "submitting" and error.code in (401, 403, 429)
        error.close()
    except Exception:
        record["state"] = {"preparing": "not_submitted", "submitting": "acceptance_unknown"}.get(phase, "accepted_output_unavailable")
    # 不持久化服务错误正文、签名URL或异常字符串，避免泄露凭据。
    write_record(status_path, record)
    return record


def execute(limit, providers, groups, jobs, output):
    # 老版在途进程没有登记额度；升级过渡期不能绕过它的独占锁。
    if (MODULE / ".image-batch.lock").exists():
        raise ValueError("Legacy batch is not tracked by the shared pool; let it finish before the first upgraded run. Do not remove an active legacy lock.")
    pool = ConcurrencyPool(MODULE / ".image-concurrency.sqlite3")
    output.mkdir(parents=True, exist_ok=True)
    run_dir = output / f"image-batch-{uuid.uuid4().hex}"
    run_dir.mkdir()
    write_record(run_dir / "plan.json", {"jobs": jobs, "providers": [
        {"id": name, "model": value["model"], "accountGroup": value["accountGroup"]}
        for name, value in providers.items() if name in {job["providerId"] for job in jobs}]})
    print(f"Batch records: {run_dir}", flush=True)
    pending, active, results = list(jobs), {}, []
    last_notice = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=limit) as executor:
        while pending or active:
            pool.reconcile()
            for job in list(pending):
                if len(active) >= limit:
                    break
                provider = providers[job["providerId"]]
                group = provider["accountGroup"]
                token, reason = pool.reserve(limit, group, groups[group], run_dir / job["id"] / "status.json")
                if reason == "account_stopped":
                    result = {"id": job["id"], "providerId": provider["id"], "state": "not_submitted_account_stopped"}
                    results.append(result)
                    pending.remove(job)
                    print(json.dumps(result), flush=True)
                elif token:
                    try:
                        future = executor.submit(run_job, job, provider, run_dir / job["id"])
                    except BaseException:
                        pool.finish(token, {"state": "not_submitted"})
                        raise
                    active[future] = token
                    pending.remove(job)
            if active:
                done, _ = concurrent.futures.wait(active, timeout=0.5, return_when=concurrent.futures.FIRST_COMPLETED)
                for future in done:
                    token = active.pop(future)
                    result = future.result()
                    pool.finish(token, result)
                    results.append(result)
                    print(json.dumps(result, ensure_ascii=False), flush=True)
            elif pending:
                # 等待的是请求额度，不是其他批次结束；不占执行线程。
                time.sleep(0.5)
            if pending and time.monotonic() - last_notice >= 30:
                print(json.dumps({"state": "waiting_for_shared_capacity", "pending": len(pending)}), flush=True)
                last_notice = time.monotonic()
            write_record(run_dir / "results.json", results)
    return 0 if all(row["state"] == "saved_unreviewed" for row in results) else 1


def main():
    parser = argparse.ArgumentParser(description="Preflight ready image jobs; use --execute only with explicit generation authorization.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--jobs", type=Path)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--concurrency-status", action="store_true")
    parser.add_argument("--release-confirmed", metavar="TOKEN")
    parser.add_argument("--resume-account-confirmed", metavar="ACCOUNT")
    args = parser.parse_args()
    try:
        controls = (args.concurrency_status, args.release_confirmed, args.resume_account_confirmed)
        if any(controls):
            if sum(bool(value) for value in controls) != 1 or args.jobs or args.execute:
                raise ValueError("Use one concurrency control without --jobs or --execute")
            pool = ConcurrencyPool(MODULE / ".image-concurrency.sqlite3")
            if args.release_confirmed:
                pool.release_confirmed(args.release_confirmed)
            if args.resume_account_confirmed:
                pool.resume_confirmed(identifier(args.resume_account_confirmed, "account"))
            print(json.dumps(pool.snapshot(), ensure_ascii=False))
            return 0
        if args.jobs is None:
            raise ValueError("--jobs is required for preflight or execution")
        limit, providers, groups, jobs, output = preflight(args.config.resolve(), args.jobs.resolve())
        if not args.execute:
            print(json.dumps({"state": "preflight_only_no_network", "jobs": [
                {"id": job["id"], "providerId": job["providerId"]} for job in jobs], "globalConcurrency": limit}, ensure_ascii=False))
            return 0
        return execute(limit, providers, groups, jobs, output)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrupted; remote requests may have been accepted. Inspect batch status before any resubmission.", file=sys.stderr)
        return 130
    except Exception:
        print("Local execution failed; inspect batch status. Do not automatically resubmit.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
