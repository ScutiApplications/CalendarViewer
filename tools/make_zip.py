#!/usr/bin/env python3
"""Create a portable source ZIP from the files git tracks or would track.

Uses `git ls-files`, so every .gitignore rule is honored. tools/ (maintainer
scripts), docs/ (design notes) and older zips are left out.
Output: dist/<name>-<VERSION>.zip (dist/ is gitignored).
"""

import argparse
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def included_files():
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if result.returncode != 0:
        sys.exit(result.stderr)
    return [
        line for line in result.stdout.splitlines()
        if line and not line.startswith(("tools/", "docs/")) and not line.endswith(".zip")
    ]


def main():
    version = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist" / f"{ROOT.name}-{version}.zip")
    output = parser.parse_args().output.resolve()
    files = included_files()
    if not files:
        sys.exit("No files found to zip.")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for rel in files:
            path = ROOT / rel
            if path.is_file() and not path.is_symlink():
                archive.write(path, Path(ROOT.name) / rel)
    print(f"Created {output} ({len(files)} files)")


if __name__ == "__main__":
    main()
