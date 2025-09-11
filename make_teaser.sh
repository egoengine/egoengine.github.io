#!/usr/bin/env bash
# Fix EgoEngine teaser videos for web playback:
# - If duration < 3.0s, loop-repeat until >= 3.0s
# - Ensure H.264 + yuv420p + faststart
# - Keep original resolution (no scaling)

set -euo pipefail

MIN_DUR=3.0
ROOT="videos/blending/human"

shopt -s nullglob

# find all target mp4s
mapfile -d '' FILES < <(find "$ROOT" -type f \( -name 'cropped_video.mp4' -o -name 'inpainted_video.mp4' \) -print0)

if (( ${#FILES[@]} == 0 )); then
  echo "[INFO] No target videos found under $ROOT"
  exit 0
fi

fix_one() {
  local f="$1"

  # read duration (seconds, float)
  local dur
  dur="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" 2>/dev/null || echo "")"
  [[ -z "${dur}" ]] && dur="0"

  # read codec & pix_fmt
  local meta
  meta="$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,pix_fmt -of csv=p=0:s=x "$f" 2>/dev/null || echo "?,?")"
  local codec pix
  codec="$(awk -F'x' '{print $1}' <<<"$meta")"
  pix="$(awk -F'x' '{print $2}' <<<"$meta")"

  # compute extra loops needed (ffmpeg: total copies = loops + 1)
  # if dur<=0, fall back to 5 loops
  local loops
  loops="$(awk -v d="$dur" -v m="$MIN_DUR" 'BEGIN{
    if (d<=0) { print 5; exit }
    n = int( (m/d) + 0.9999 ) - 1;
    if (n < 0) n = 0;
    print n;
  }')"

  # decide action
  local need_loop="no"
  local need_norm="no"
  if awk 'BEGIN{exit !('"$dur"' < '"$MIN_DUR"') }'; then
    need_loop="yes"
  fi
  if [[ "$codec" != "h264" || "$pix" != "yuv420p" ]]; then
    need_norm="yes"
  fi

  local tmp="${f%.mp4}.tmp.mp4"

  if [[ "$need_loop" == "yes" ]]; then
    echo "[LOOP] $f (dur=${dur}s, loops=$loops) -> extend to >= ${MIN_DUR}s"
    ffmpeg -y -v error -stream_loop "$loops" -i "$f" \
      -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
      -preset veryfast -crf 20 -an \
      "$tmp"
    mv -f "$tmp" "$f"
    return
  fi

  if [[ "$need_norm" == "yes" ]]; then
    echo "[NORM] $f (codec=$codec, pix=$pix) -> h264+yuv420p+faststart"
    ffmpeg -y -v error -i "$f" \
      -c:v libx264 -pix_fmt yuv420p -movflags +faststart \
      -preset veryfast -crf 20 -an \
      "$tmp"
    mv -f "$tmp" "$f"
    return
  fi

  echo "[OK]   $f (dur=${dur}s, codec=$codec, pix=$pix)"
}

# run
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "[MISS] $f"
    continue
  fi
  fix_one "$f" || { echo "[FAIL] $f"; rm -f "${f%.mp4}.tmp.mp4"; }
done

echo "Done."
