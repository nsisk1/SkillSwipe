"""Publish action/screenshot-only Playwright traces, never raw auth/network data.

Deliberately allowlist fields instead of attempting to recognize every possible
credential format. DOM snapshots, network, sources, evaluation arguments,
results, console output, attachments and raw error text are not retained.
"""
import json
import os
from pathlib import Path
import re
import shutil
import zipfile


FIELDS = {
    "context-options": {
        "version", "type", "origin", "browserName", "channel", "platform",
        "wallTime", "monotonicTime", "sdkLanguage", "contextId",
    },
    "before": {
        "type", "callId", "startTime", "apiName", "class", "method",
        "pageId", "parentId", "stepId",
    },
    "after": {"type", "callId", "endTime"},
    "screencast-frame": {
        "type", "pageId", "sha1", "file", "width", "height", "timestamp", "frameSwapWallTime",
    },
}


def sanitize(source: Path, destination: Path):
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(source) as raw, zipfile.ZipFile(
            destination, "w", zipfile.ZIP_DEFLATED
        ) as clean:
            images = set()
            for name in raw.namelist():
                if not re.fullmatch(r"[\w-]+\.trace", name):
                    continue
                events = []
                for line in raw.read(name).splitlines():
                    event = json.loads(line)
                    kind = event.get("type")
                    if kind not in FIELDS:
                        continue
                    safe = {key: value for key, value in event.items() if key in FIELDS[kind]}
                    if kind == "before":
                        safe["params"] = {}
                    if kind == "after" and event.get("error"):
                        safe["error"] = {"message": "Action failed; sensitive error details omitted."}
                    if kind == "context-options":
                        safe["options"] = {}
                    if kind == "screencast-frame":
                        # Playwright 1.64 uses file; older versions use sha1.
                        file = event.get("file", "")
                        sha1 = event.get("sha1", "")
                        if re.fullmatch(r"screencast/page@[a-f0-9]+-\d+\.jpeg", file):
                            images.add(file)
                        elif re.fullmatch(r"[a-f0-9]{40}\.(jpeg|jpg|png)", sha1):
                            images.add(f"resources/{sha1}")
                        else:
                            continue
                    events.append(json.dumps(safe))
                clean.writestr(name, "\n".join(events) + "\n")
            for name in images:
                data = raw.read(name)
                if not (data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n")):
                    raise ValueError("Invalid trace screenshot")
                clean.writestr(name, data)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    source_dir = Path(os.environ.get("ACCOUNTS_TEST_TRACE_DIR", "/tmp/skillswipe-account-traces"))
    output_dir = Path(__file__).resolve().parents[4] / "generated-artifacts/account-traces"
    try:
        for source in source_dir.glob("*.zip"):
            sanitize(source, output_dir / source.name)
    except BaseException:
        # Never leave a partially prepared upload on a sanitizer failure.
        shutil.rmtree(output_dir, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(source_dir, ignore_errors=True)
