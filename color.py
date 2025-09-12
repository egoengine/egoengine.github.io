#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
批量处理所有 cropped_video.mp4：
1) 逐帧读取，按你的代码做通道均衡（不改时长、不拼接）
2) 先用 OpenCV 写临时 mp4v 文件
3) 若系统有 ffmpeg，则转成 H.264 + yuv420p + faststart（网页更稳）并原地覆盖

用法：
  python fix_cropped_videos.py \
    --root /mnt/data2/dexmimic/workspace/egoengine-webite/videos/blending/human
"""

import os
import sys
import cv2
import glob
import shutil
import subprocess as sp
from pathlib import Path

def color_fix(im):
    # === 按你给的公式逐帧处理（不加其它“聪明”操作）===
    imf = im.astype('float32')
    p = 6.0
    eps = 1e-6
    m = ( (imf ** p).mean(axis=(0, 1)) + eps ) ** (1.0 / p)   # per-channel “gray”
    scale = (m.mean() / (m + eps))                            # 拉到相近灰度
    im_corr = (imf * scale).clip(0, 255)
    # 你原文这里没有真正 gamma，只是保持数值范围；我忠实保留
    im_out = im_corr.clip(0, 255).astype('uint8')
    return im_out

def has_ffmpeg():
    return shutil.which("ffmpeg") is not None

def transcode_h264(src_mp4: Path):
    """用 ffmpeg 转成 H.264 / yuv420p / faststart；尽量不动分辨率。
       若宽或高为奇数，自动用 scale 调成偶数（yuv420p 需要）。"""
    # 先探测分辨率
    try:
        import json
        prob = sp.run([
            "ffprobe","-v","error","-select_streams","v:0",
            "-show_entries","stream=width,height","-of","json",str(src_mp4)
        ], check=True, capture_output=True, text=True)
        info = json.loads(prob.stdout)
        w = info["streams"][0]["width"]
        h = info["streams"][0]["height"]
    except Exception:
        w = h = None

    tmp = src_mp4.with_suffix(".h264.tmp.mp4")
    vf = []
    if w and h and (w % 2 or h % 2):
        vf = ["-vf", f"scale=trunc(iw/2)*2:trunc(ih/2)*2"]

    cmd = [
        "ffmpeg","-y","-v","error","-i", str(src_mp4),
        *vf,
        "-c:v","libx264","-pix_fmt","yuv420p","-movflags","+faststart",
        "-preset","veryfast","-crf","20","-an",
        str(tmp)
    ]
    sp.run(cmd, check=True)
    tmp.replace(src_mp4)

def process_one(fpath: Path):
    cap = cv2.VideoCapture(str(fpath))
    if not cap.isOpened():
        print(f"[SKIP] cannot open: {fpath}")
        return False

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    w   = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h   = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if w <= 0 or h <= 0:
        cap.release()
        print(f"[SKIP] bad size: {fpath}")
        return False

    # 先写到 mp4v 临时文件（保持原 fps/尺寸）
    tmp_mp4v = fpath.with_suffix(".tmp.mp4")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(tmp_mp4v), fourcc, fps, (w, h))
    frames = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame.ndim == 2:  # 灰度保险
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        out = color_fix(frame)
        writer.write(out)
        frames += 1

    writer.release()
    cap.release()

    if frames == 0:
        tmp_mp4v.unlink(missing_ok=True)
        print(f"[WARN] 0 frames: {fpath}")
        return False

    # 用临时覆盖原文件（先备份）
    bak = fpath.with_suffix(".bak.mp4")
    try:
        fpath.replace(bak)
        tmp_mp4v.replace(fpath)
    except Exception as e:
        print(f"[ERR] replace failed: {fpath} -> {e}")
        # 尝试回滚
        if fpath.exists(): fpath.unlink(missing_ok=True)
        if bak.exists(): bak.replace(fpath)
        return False
    finally:
        if tmp_mp4v.exists():
            tmp_mp4v.unlink(missing_ok=True)

    # 若有 ffmpeg，则再转成 H.264（网页最稳）
    if has_ffmpeg():
        try:
            transcode_h264(fpath)
        except sp.CalledProcessError as e:
            print(f"[WARN] ffmpeg transcode failed for {fpath}: {e}")
            # 失败也不回滚，先保持 mp4v，可浏览器上测试
    else:
        print("[INFO] ffmpeg 不在 PATH，已保留 mp4v 编码（多数浏览器可播，但不如 H.264 稳）。")

    # 成功后删备份
    if bak.exists():
        bak.unlink(missing_ok=True)
    print(f"[OK]  {fpath}  ({frames} frames @ {fps:.3f} fps)")
    return True

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=str, required=True,
                    help="包含若干子文件夹的根目录，每个子文件夹里有 cropped_video.mp4")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    files = sorted(root.glob("*/cropped_video.mp4"))
    if not files:
        print(f"[INFO] no files under: {root}")
        sys.exit(0)

    print(f"[RUN] total {len(files)} files\n")
    ok = fail = 0
    for f in files:
        try:
            if process_one(f):
                ok += 1
            else:
                fail += 1
        except KeyboardInterrupt:
            print("\n[INTERRUPTED]")
            break
        except Exception as e:
            print(f"[ERR] {f}: {e}")
            fail += 1

    print(f"\n[SUMMARY] ok={ok}, fail={fail}")

if __name__ == "__main__":
    main()
