#!/usr/bin/env python3
"""Package runtime files from a committed revision; --ref also rebuilds older releases."""

import argparse
import hashlib
import asyncio
from copy import copy
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "CalendarViewer/"
ROOT_FILES = frozenset({"LICENSE", "README.md", "SECURITY.md", "THIRD-PARTY-NOTICES.md", "VERSION", "run.bat"})
RUNTIME_DIRS = frozenset({"src", "scripts", "vendor"})


async def git(*args):
    process = await asyncio.create_subprocess_exec(
        "git", *args, cwd=ROOT, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    if process.returncode:
        raise RuntimeError(stderr.decode("utf-8", errors="replace").strip())
    return stdout


async def included_files(revision):
    files = []
    for entry in (await git("ls-tree", "-r", "-z", revision)).split(b"\0"):
        if not entry:
            continue
        metadata, raw_name = entry.split(b"\t", 1)
        name = raw_name.decode("utf-8")
        parts = name.split("/")
        if name not in ROOT_FILES and parts[0] not in RUNTIME_DIRS:
            continue
        if any(part.startswith(".") or part.lower() in {"secrets", "__pycache__", "node_modules"} for part in parts) or name.lower().endswith((".key", ".pem", ".pyc", ".zip")):
            raise RuntimeError("Unexpected private or generated runtime file: " + name)
        if metadata.split()[0] not in {b"100644", b"100755"}:
            raise RuntimeError("Runtime files must be regular files: " + name)
        files.append(name)
    required = ROOT_FILES | {"src/server/server.js", "scripts/calendar.ps1"}
    missing = required - set(files)
    if missing:
        raise RuntimeError("Missing release files: " + ", ".join(sorted(missing)))
    return files


def write_portable_zip(source, destination, files, version):
    """Stream committed files into a ZIP and preserve Windows launcher line endings."""
    expected = {PREFIX + name for name in files}
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        seen = set()
        for info in original.infolist():
            if info.is_dir():
                continue
            if info.filename not in expected or info.filename in seen:
                raise RuntimeError("Unexpected archive entry: " + info.filename)
            seen.add(info.filename)
            packed = copy(info)
            packed.compress_type = zipfile.ZIP_DEFLATED
            if info.filename.endswith((".bat", ".ps1")):
                contents = original.read(info).replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
                archive.writestr(packed, contents, compresslevel=9)
            else:
                with original.open(info) as reader, archive.open(packed, "w") as writer:
                    shutil.copyfileobj(reader, writer, 64 * 1024)
        if seen != expected or original.read(PREFIX + "VERSION").decode("utf-8").strip() != version:
            raise RuntimeError("Release contents or version do not match the selected revision.")


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="Committed revision or release tag (default: HEAD)")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    revision = (await git("rev-parse", "--verify", "--end-of-options", args.ref + "^{commit}")).decode().strip()
    version = (await git("show", revision + ":VERSION")).decode("utf-8").strip()
    if not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise RuntimeError("Selected revision must have an X.Y.Z VERSION.")
    output = (args.output or ROOT / "dist" / f"CalendarViewer-{version}.zip").resolve()
    files = await included_files(revision)
    await asyncio.to_thread(output.parent.mkdir, parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".calendar-package-", dir=output.parent) as temporary:
        work = Path(temporary).resolve()
        if work.parent != output.parent:
            raise RuntimeError("Package staging directory is outside the output directory.")
        source, destination = work / "source.zip", work / "release.zip"
        await git("archive", "--format=zip", "--prefix=" + PREFIX, "--output=" + str(source), revision, "--", *files)
        await asyncio.to_thread(write_portable_zip, source, destination, files, version)
        await asyncio.to_thread(destination.replace, output)
    digest = await asyncio.to_thread(lambda: hashlib.sha256(output.read_bytes()).hexdigest())
    checksum = output.with_name("SHA256SUMS")
    await asyncio.to_thread(checksum.write_text, f"{digest}  {output.name}\n", encoding="utf-8")
    print(f"Created {output} ({len(files)} files) and {checksum}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        sys.exit(str(error))
