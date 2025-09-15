#!/usr/bin/env bash
# check_videos.sh — simple web-safety checker (mac compatible)
set -euo pipefail

ROOT="${1:-/Users/liuyangcen/workspace/egoengine/videos/blending}"

if ! command -v ffprobe >/dev/null; then
  echo "ffprobe not found. Install ffmpeg (e.g., 'brew install ffmpeg')." >&2
  exit 1
fi

ok=0; bad=0

is_ok() {
  local f="$1" fmt vcodec pixfmt acodec
  fmt="$(ffprobe -v error -show_entries format=format_name -of default=nk=1:nw=1 "$f" || true)"
  vcodec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=nk=1:nw=1 "$f" || true)"
  pixfmt="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt   -of default=nk=1:nw=1 "$f" || true)"
  acodec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nk=1:nw=1 "$f" || true)"

  # container must be mp4/mov; video h264; pixel yuv420p; audio aac or none
  echo "$fmt" | grep -Eqi 'mp4|mov' || return 1
  [[ "$vcodec" == "h264" ]] || return 1
  [[ "$pixfmt" == "yuv420p" ]] || return 1
  if [[ -n "$acodec" ]]; then [[ "$acodec" == "aac" ]] || return 1; fi
  return 0
}

printf 'Scanning: %s\n' "$ROOT"
# Find common video files, handle spaces safely
while IFS= read -r -d '' f; do
  if is_ok "$f"; then
    echo "OK  : $f"
    ok=$((ok+1))
  else
    # quick peek at codecs for debugging
    vcodec="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt -of default=nk=1:nw=1 "$f" || true)"
    acodec="$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nk=1:nw=1 "$f" || echo none)"
    echo "FIX : $f   [v=$vcodec, a=${acodec:-none}]"
    bad=$((bad+1))
  fi
done < <(find "$ROOT" -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.mkv' -o -iname '*.webm' -o -iname '*.avi' \) -print0)

echo "Done. OK: $ok, Need conversion: $bad"
