#!/usr/bin/env python3
import json, subprocess as sp, sys, os, shlex, math
from pathlib import Path

# --------- Config (edit if you like) ----------
ROOT = Path("videos/blending/human")
FOLDERS = [
    "Cassie-bartending","Cassie-bartending2","Cassie-blinds","Cassie-boardgame","Cassie-cat2","Cassie-cat_food",
    "Cassie-cooking2","Cassie-door","Cassie-earbuds","Cassie-eyedrops","Cassie-flower","Cassie-fridge",
    "Cassie-laptop","Cassie-microwave","Cassie-oven","Cassie-subway","Cassie-yogurt","Cassie-Rowan-Allen",
]
COLS, ROWS = 6, 3       # 6 x 3 = 18
FPS_OUT     = 30        # mosaic output fps (inputs keep native; we align PTS)
CRF         = "20"      # H.264 quality (lower=better/bigger)
PRESET      = "veryfast"
OUT_DIR     = Path("videos")
OUT_ORIG    = OUT_DIR / "teaser_original.mp4"    # from cropped_video.mp4
OUT_INPAINT = OUT_DIR / "teaser_inpainted.mp4"   # from inpainted_video.mp4
TMP_DIR     = OUT_DIR / ".teaser_tmp"            # normalized tiles live here
DUR_FALLBACK= 10.0      # seconds for filler tiles if we can't read any duration
# ----------------------------------------------

def run(cmd):
    return sp.run(cmd, check=True)

def run_out(cmd):
    return sp.check_output(cmd)

def ffprobe_json(path):
    return json.loads(run_out([
        "ffprobe","-v","error","-show_streams","-show_format","-print_format","json",str(path)
    ]).decode("utf-8", "ignore"))

def get_w_h_dur(path: Path):
    try:
        j = ffprobe_json(path)
        v = next(s for s in j["streams"] if s.get("codec_type")=="video")
        w, h = int(v["width"]), int(v["height"])
        dur = float(j.get("format",{}).get("duration") or v.get("duration") or 0.0)
        return w, h, dur
    except Exception:
        return None, None, None

def even(x):  # ffmpeg likes even sizes for yuv420
    return int(math.ceil((x or 0)/2.0)*2)

def ensure_norm_tile(src: Path, dst: Path, W: int, H: int):
    """Pad (no downscale) to WxH, H.264, yuv420p, faststart."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.exists():
        vf = f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p"
        cmd = [
            "ffmpeg","-y","-v","error","-i",str(src),
            "-vf",vf,"-c:v","libx264","-preset",PRESET,"-crf",CRF,
            "-movflags","+faststart","-an",str(dst)
        ]
    else:
        # create black tile if missing
        cmd = [
            "ffmpeg","-y","-v","error","-f","lavfi","-i",
            f"color=black:s={W}x{H}:r={FPS_OUT}",
            "-t",str(DUR_FALLBACK),
            "-c:v","libx264","-preset",PRESET,"-crf",CRF,
            "-movflags","+faststart","-an",str(dst)
        ]
    run(cmd)

def build_xstack(inputs, out_path: Path, W: int, H: int):
    """Stack N normalized tiles with xstack (no scaling)."""
    n = len(inputs)
    assert n == COLS*ROWS, f"Expected {COLS*ROWS} inputs, got {n}"

    # filter chains: setpts only (sizes already normalized)
    chains = []
    for i in range(n):
        chains.append(f"[{i}:v]setpts=PTS-STARTPTS[v{i}]")
    # layout "x_y|x_y|..." with tile size W x H
    layout = []
    idx = 0
    for r in range(ROWS):
        for c in range(COLS):
            layout.append(f"{c*W}_{r*H}")
            idx += 1
    layout = "|".join(layout)
    vs = "".join(f"[v{i}]" for i in range(n))

    fc = f"{';'.join(chains)};{vs}xstack=inputs={n}:layout={layout}[vout]"


    cmd = ["ffmpeg","-y","-v","error"]
    for p in inputs:
        cmd += ["-i", str(p)]
    cmd += ["-filter_complex", fc,
            "-map","[vout]","-r",str(FPS_OUT),
            "-c:v","libx264","-preset",PRESET,"-crf",CRF,
            "-pix_fmt","yuv420p","-movflags","+faststart","-an",
            "-shortest", str(out_path)]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    print("xstack:", " ".join(shlex.quote(x) for x in cmd))
    run(cmd)

def main():
    # Collect sizes/durations across BOTH kinds to choose one max tile
    sizes = []
    durs  = []
    for name in FOLDERS:
        for kind in ("cropped_video.mp4","inpainted_video.mp4"):
            p = ROOT / name / kind
            if p.exists():
                w,h,d = get_w_h_dur(p)
                if w and h: sizes.append((w,h))
                if d: durs.append(d)

    if not sizes:
        print("No videos found. Check ROOT/FOLDERS.", file=sys.stderr); sys.exit(1)

    W = even(max(w for w,_ in sizes))
    H = even(max(h for _,h in sizes))
    print(f"[info] tile size = {W}x{H} (max across inputs)")
    if durs:
        global DUR_FALLBACK
        DUR_FALLBACK = max(durs)
        print(f"[info] filler duration = {DUR_FALLBACK:.2f}s")

    # Prepare normalized tiles
    orig_tiles, inpaint_tiles = [], []
    for name in FOLDERS:
        src_o = ROOT / name / "cropped_video.mp4"
        src_i = ROOT / name / "inpainted_video.mp4"
        dst_o = TMP_DIR / "orig"    / f"{name}.mp4"
        dst_i = TMP_DIR / "inpaint" / f"{name}.mp4"
        print(f"[norm] {name} (orig)")
        ensure_norm_tile(src_o, dst_o, W, H)
        print(f"[norm] {name} (inpaint)")
        ensure_norm_tile(src_i, dst_i, W, H)
        orig_tiles.append(dst_o)
        inpaint_tiles.append(dst_i)

    # Stack two mosaics
    print("[mosaic] building teaser_original.mp4")
    build_xstack(orig_tiles, OUT_ORIG, W, H)
    print("[mosaic] building teaser_inpainted.mp4")
    build_xstack(inpaint_tiles, OUT_INPAINT, W, H)
    print(f"[done] wrote:\n  - {OUT_ORIG}\n  - {OUT_INPAINT}")

if __name__ == "__main__":
    main()
