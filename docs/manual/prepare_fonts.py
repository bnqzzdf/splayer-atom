#!/usr/bin/env python3
"""Generate ReportLab-compatible TrueType CJK fonts from system Noto CJK TTC files."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from fontTools.ttLib import TTCollection

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "fonts"
FONT_DIR = Path(os.environ.get("ATOM_CJK_FONT_DIR", Path.home() / ".fonts"))
SOURCES = {
    "Regular": FONT_DIR / "NotoSansCJK-Regular.ttc",
    "Bold": FONT_DIR / "NotoSansCJK-Bold.ttc",
}
UNICODES = (
    "U+0000-00FF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,"
    "U+2200-22FF,U+25A0-25FF,U+2600-26FF,U+3000-303F,U+4E00-9FFF,U+FF00-FFEF"
)


def need(command: str) -> None:
    if shutil.which(command) is None:
        raise SystemExit(f"missing command: {command} (install fonttools/cu2qu/otf2ttf)")


def main() -> None:
    for command in ("pyftsubset", "otf2ttf"):
        need(command)
    for path in SOURCES.values():
        if not path.exists():
            raise SystemExit(f"missing Noto CJK font: {path} (set ATOM_CJK_FONT_DIR)")
    OUT.mkdir(parents=True, exist_ok=True)
    for weight, source in SOURCES.items():
        collection = TTCollection(str(source))
        sc_face = next(
            face
            for face in collection.fonts
            if face["name"].getDebugName(1) == "Noto Sans CJK SC"
        )
        full = Path("/tmp") / f"NotoSansSC-{weight}.otf"
        subset = Path("/tmp") / f"NotoSansSC-{weight}-subset.otf"
        sc_face.save(str(full))
        subprocess.run(
            [
                "pyftsubset",
                str(full),
                f"--unicodes={UNICODES}",
                "--layout-features=*",
                f"--output-file={subset}",
            ],
            check=True,
        )
        subprocess.run(
            ["otf2ttf", str(subset), "-o", str(OUT / f"NotoSansSC-{weight}.ttf")],
            check=True,
        )
        full.unlink(missing_ok=True)
        subset.unlink(missing_ok=True)
        print(f"generated {OUT / f'NotoSansSC-{weight}.ttf'}")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        raise SystemExit(f"font conversion failed: {error}") from error
