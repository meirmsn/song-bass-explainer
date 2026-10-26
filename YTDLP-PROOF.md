# yt-dlp proof (Phase D) — 2026-10-24 America/Los_Angeles

## Target
- URL: `https://www.youtube.com/watch?v=l4njuSveoQU`
- Title: Free Atmospheric soothing background music sound effect no copyright
- Duration: **26s**
- License (yt-dlp field): Creative Commons Attribution license (reuse allowed); uploader description claims CC0

## Runtime
- yt-dlp `2026.10.21` at `/workspace/v/bin/yt-dlp`
- JS runtime: Node `v22.23.4` via `--js-runtimes node:$NODE`
- Without EJS remote components: metadata + download still succeeded; warnings about n-challenge solver skip
- Consumer now also passes `--remote-components ejs:github` for challenge scripts

## Result
- **SUCCESS** — exit 0
- Output: `/workspace/bass-study/work/ytdlp-test/cc0.wav` (~5.0 MB, pcm_s16le 48kHz stereo, 26.08s)
- Logs: `logs/ytdlp-meta-cc0.log`, `logs/ytdlp-dl-cc0.log`

## Notes / residual risk
- n-challenge warnings may still appear; format 251 (webm/opus) was available and converted via ffmpeg.
- Datacenter IP blocks remain possible for other videos; LAP path keeps local fallback.
- YouTube ToS still applies; this proof uses an explicitly CC-licensed short clip for pipeline testing only.

## End-to-end via consume_jobs.py
- Job id: see `work/cc0_job_id.txt` (CC0 atmospheric)
- `source/info.json`: `"method": "yt-dlp", "fallback": false`, duration 26, audio_bytes 5006674
- Stages completed through demucs → analysis stubs → `waiting_bot`
- Log: `logs/ytdlp-consume-cc0.log`
