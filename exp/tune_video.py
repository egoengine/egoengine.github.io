#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import argparse
import subprocess
from typing import Tuple, List

import cv2
import numpy as np
from tqdm import tqdm


def ensure_dir(p: str):
    os.makedirs(p, exist_ok=True)


def open_video(path: str):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    return cap, fps, w, h, n_frames


def ffmpeg_writer_cmd(out_path: str, w: int, h: int, fps: float) -> list:
    """Write raw BGR frames via stdin → H.264 (yuv420p) file."""
    return [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-s", f"{w}x{h}",
        "-r", f"{fps:.6f}",
        "-i", "pipe:0",
        "-vcodec", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        out_path,
    ]


def apply_adjust(
    frame_bgr: np.ndarray,
    exposure: float = 1.0,                # aka brightness multiplier
    contrast: float = 1.0,                # 1.0 keeps contrast
    rgb_ratio: Tuple[float, float, float] = (1.0, 1.0, 1.0),  # (R,G,B)
    gamma: float = 1.0                    # 1.0 = off
) -> np.ndarray:
    """
    Processing order:
      1) exposure (global brightness multiplier)
      2) per-channel gains (R,G,B)  [NOTE: input is BGR]
      3) contrast around mid-gray (128)
      4) gamma correction (sRGB-like; 1.0 = off)
    """
    img = frame_bgr.astype(np.float32)

    # 1) global brightness (exposure) multiplier
    img *= float(exposure)

    # 2) per-channel gains, mapping (R,G,B) to BGR memory layout
    r_gain, g_gain, b_gain = rgb_ratio
    img[..., 0] *= b_gain  # B
    img[..., 1] *= g_gain  # G
    img[..., 2] *= r_gain  # R

    # 3) contrast around 128 (mid-gray)
    if contrast != 1.0:
        img = 128.0 + (img - 128.0) * float(contrast)

    # 4) gamma (apply in [0,1] range)
    if gamma != 1.0:
        img = np.clip(img, 0, 255) / 255.0
        img = np.power(img, 1.0 / float(gamma)) * 255.0

    img = np.clip(img, 0, 255).astype(np.uint8)
    return img


def main():
    ap = argparse.ArgumentParser(
        description="Simple video color/exposure adjustment → one output."
    )
    ap.add_argument("--in", dest="inp", required=True, help="Input video path")
    ap.add_argument("--out", dest="out", required=True, help="Output video path")
    ap.add_argument("--exposure", type=float, default=1.0,
                    help="Brightness multiplier (e.g., 1.1 brighter, 0.9 darker)")
    ap.add_argument("--contrast", type=float, default=1.0,
                    help="Contrast multiplier (1.0 keeps contrast)")
    ap.add_argument("--r", type=float, default=1.0, help="Red channel multiplier")
    ap.add_argument("--g", type=float, default=1.0, help="Green channel multiplier")
    ap.add_argument("--b", type=float, default=1.0, help="Blue channel multiplier")
    ap.add_argument("--gamma", type=float, default=1.0,
                    help="Gamma (1.0 = off; >1 brightens shadows)")
    ap.add_argument("--limit", type=int, default=0,
                    help="Optional cap on frames (0 = all)")
    args = ap.parse_args()

    ensure_dir(os.path.dirname(os.path.abspath(args.out)) or ".")

    cap, fps, w, h, n_total = open_video(args.inp)
    n_frames = min(n_total, args.limit) if args.limit and args.limit > 0 else n_total

    cmd = ffmpeg_writer_cmd(args.out, w, h, fps)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

    with tqdm(total=n_frames, desc="Processing", leave=False) as pbar:
        for i in range(n_frames):
            ok, f = cap.read()
            if not ok:
                break
            adj = apply_adjust(
                f,
                exposure=args.exposure,
                contrast=args.contrast,
                rgb_ratio=(args.r, args.g, args.b),
                gamma=args.gamma,
            )
            proc.stdin.write(adj.tobytes())
            pbar.update(1)

    cap.release()
    proc.stdin.close()
    proc.wait()
    print(f"[Done] Wrote: {args.out}")


if __name__ == "__main__":
    main()
