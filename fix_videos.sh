#!/usr/bin/env bash
# fix_videos_v2.sh — macOS 安全修复：只处理不合规 MP4，路径先清洗，再转码，再二次校验
set -euo pipefail

ROOT="${1:-/Users/liuyangcen/workspace/egoengine/videos/blending}"
CRF="${CRF:-20}"                 # libx264 质量（数值越小越清晰）
VIDEOBITRATE="${VIDEOBITRATE:-6M}"  # h264_videotoolbox 目标码率
AUDIOBITRATE="${AUDIOBITRATE:-128k}"

need_bins() { for b in "$@"; do command -v "$b" >/dev/null || { echo "Missing: $b" >&2; exit 1; }; done; }
need_bins ffmpeg ffprobe

choose_encoder() {
  if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\blibx264\b'; then
    echo "libx264"
  elif ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\bh264_videotoolbox\b'; then
    echo "h264_videotoolbox"
  else
    echo ""
  fi
}
ENC="$(choose_encoder)"
[[ -n "$ENC" ]] || { echo "No H.264 encoder (need libx264 or h264_videotoolbox). brew install ffmpeg" >&2; exit 1; }

# ---- 路径清洗：去掉 \r / \n / 尾随空白；若缺少前导 / 则补上；并返回绝对路径
clean_path() {
  local p="$1"
  # 去掉结尾的 CR/LF 和空白
  p="${p%$'\r'}"; p="${p%$'\n'}"; p="${p%%+([[:space:]])}"
  # 若不是绝对路径，尽量补全（常见是丢了最前面的 /）
  case "$p" in
    /*) : ;;
    Users/*) p="/$p" ;;       # 兼容 “Users/...” 的常见错误
    *) p="$(cd "$(dirname "$p" 2>/dev/null || echo .)" 2>/dev/null && pwd -P)/$(basename "$p")" ;;
  esac
  printf '%s' "$p"
}

is_ok() {
  local f="$1" fmt vcodec pixfmt acodec
  fmt="$(ffprobe -v error -show_entries format=format_name -of default=nk=1:nw=1 "$f" || true)"
  vcodec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nk=1:nw=1 "$f" || true)"
  pixfmt="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt   -of default=nk=1:nw=1 "$f" || true)"
  acodec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nk=1:nw=1 "$f" || true)"
  echo "$fmt" | grep -Eqi '(^|,)mp4(,|$)' || return 1
  [[ "$vcodec" == "h264" ]] || return 1
  [[ "$pixfmt" == "yuv420p" ]] || return 1
  if [[ -n "$acodec" ]]; then [[ "$acodec" == "aac" ]] || return 1; fi
  return 0
}

has_audio() {
  ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$1" >/dev/null 2>&1
}

convert_one() {
  local in_raw="$1"
  local in="$(clean_path "$in_raw")"
  if [[ ! -f "$in" ]]; then
    echo "MISS: $(printf '%q' "$in_raw") → $(printf '%q' "$in") (file not found)" >&2
    return 0
  fi

  local dir base tmp
  dir="$(dirname "$in")"; base="$(basename "$in")"
  tmp="$dir/.tmp.$base"

  echo "  → Converting: $in  (encoder=$ENC)"
  if has_audio "$in"; then
    if [[ "$ENC" == "libx264" ]]; then
      ffmpeg -hide_banner -loglevel error -y -i "$in" \
        -vf "format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
        -c:v libx264 -preset medium -crf "$CRF" -profile:v high -level 4.1 \
        -c:a aac -b:a "$AUDIOBITRATE" -ac 2 -ar 48000 \
        -movflags +faststart "$tmp"
    else
      ffmpeg -hide_banner -loglevel error -y -i "$in" \
        -vf "format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
        -c:v h264_videotoolbox -b:v "$VIDEOBITRATE" -maxrate "$VIDEOBITRATE" -bufsize 2M -allow_sw 1 -profile:v high \
        -c:a aac -b:a "$AUDIOBITRATE" -ac 2 -ar 48000 \
        -movflags +faststart "$tmp"
    fi
  else
    if [[ "$ENC" == "libx264" ]]; then
      ffmpeg -hide_banner -loglevel error -y -i "$in" \
        -vf "format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
        -c:v libx264 -preset medium -crf "$CRF" -profile:v high -level 4.1 \
        -an -movflags +faststart "$tmp"
    else
      ffmpeg -hide_banner -loglevel error -y -i "$in" \
        -vf "format=yuv420p,scale=trunc(iw/2)*2:trunc(ih/2)*2" \
        -c:v h264_videotoolbox -b:v "$VIDEOBITRATE" -maxrate "$VIDEOBITRATE" -bufsize 2M -allow_sw 1 -profile:v high \
        -an -movflags +faststart "$tmp"
    fi
  fi

  mv -f "$tmp" "$in"

  # 二次校验
  if ! is_ok "$in"; then
    echo "  !! Post-check failed (still not web-safe): $in" >&2
    return 1
  fi
  echo "  ✓ Fixed: $in"
}

echo "Fixing non-websafe MP4s under: $ROOT"
found=0; skipped=0; fixed=0
while IFS= read -r -d '' raw; do
  f="$(clean_path "$raw")"
  if [[ ! -f "$f" ]]; then
    echo "MISS: $(printf '%q' "$raw") → $(printf '%q' "$f") (file not found)" >&2
    continue
  fi
  ((found++))
  if is_ok "$f"; then
    echo "SKIP: $f (already web-safe)"
    ((skipped++))
  else
    convert_one "$f" && ((fixed++))
  fi
done < <(find -L "$ROOT" -type f -iname '*.mp4' -print0)

echo "Done. Found: $found ; Skipped: $skipped ; Fixed: $fixed"
