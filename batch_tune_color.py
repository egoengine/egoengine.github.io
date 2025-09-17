#!/usr/bin/env python3
import subprocess
from pathlib import Path

ROOT = Path("/mnt/data2/dexmimic/workspace/egoengine-webite/videos/blending")

# ===== Tuning knobs =====
BRIGHTNESS = -0.05   # <0 darker, >0 brighter
CONTRAST   = 1.10    # 1.0 no change, >1 more punch
CRF        = 18
PRESET     = "veryfast"

TASKS = {
    "drawer":  [1, 2, 3, 4],
    "mustard": [1, 2, 3, 4],
}

def tune_inplace(in_path: Path):
    tmp_path = in_path.with_suffix(".tmp.mp4")
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-stats",
        "-i", str(in_path),
        "-map_metadata", "0",
        "-movflags", "+faststart",
        "-vf", f"eq=brightness={BRIGHTNESS}:contrast={CONTRAST}",
        "-c:v", "libx264", "-preset", PRESET, "-crf", str(CRF),
        "-c:a", "copy",
        str(tmp_path),
    ]
    subprocess.run(cmd, check=True)
    tmp_path.replace(in_path)

def main():
    processed, missing = 0, 0
    for task, ids in TASKS.items():
        for i in ids:
            in_file = ROOT / task / str(i) / "removed_w_mask_5.mp4"
            if not in_file.exists():
                print(f"[skip] not found: {in_file}")
                missing += 1
                continue
            print(f"[overwrite] {in_file} (brightness={BRIGHTNESS}, contrast={CONTRAST})")
            tune_inplace(in_file)
            processed += 1
    print(f"\nDone. processed={processed}, missing={missing}")

if __name__ == "__main__":
    main()
