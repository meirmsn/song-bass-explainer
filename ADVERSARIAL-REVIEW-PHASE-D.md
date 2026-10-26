# ADVERSARIAL REVIEW — Phase D (yt-dlp proof + durable consumer + Range)

Date: 2026-10-24 America/Los_Angeles  
Deploy version: `bd766d5c-d4a8-4c7b-8794-f08ed73a2fa1`

## 1) yt-dlp — PROVED (non-LAP, CC short clip)

| Item | Result |
|------|--------|
| URL | `https://www.youtube.com/watch?v=l4njuSveoQU` (26s, CC / described CC0) |
| Runtime | Node v22.23.4 via `--js-runtimes node:…` |
| Also set | `--remote-components ejs:github` in consumer |
| Direct download | **OK** → `work/ytdlp-test/cc0.wav` (pcm_s16le 48kHz, 26.08s) |
| Via `consume_jobs.py` | **OK** — `method: yt-dlp`, `fallback: false`, audio in R2 |
| Docs | `YTDLP-PROOF.md`, logs under `logs/ytdlp-*.log` |

### Residual YT risk (still real)
- n-challenge warnings appeared before EJS remote components; some videos may still miss formats or hard-fail.
- Datacenter egress can be blocked per-video; LAP local fallback remains.
- YouTube ToS unchanged — CC clip used only to prove the pipeline.

## 2) Durable consumer loop — SHIPPED
- Script: `scripts/run_consumer_loop.sh` (poll default 30s, PID file, daily log).
- Running on box: pid in `logs/consumer.pid`, log `logs/consumer-YYYYMMDD.log`.
- **Not systemd** — dies if the box/session is killed; no crash restart supervisor beyond shell. Good enough for single-user hybrid v1.
- Cycles with `--once --limit 1`; idle log shows `no queued jobs`.

## 3) Range / streaming — CODE SHIPPED, Access-session not E2E’d
- Worker `getObject()` passes `Range` headers into R2 binding; `objectResponse` returns **206** + `Content-Range` when `obj.range` is set; `Accept-Ranges: bytes` always.
- Applies to `/private/api/demo/.../stems/*` and `/private/api/jobs/:id/stems/*`.
- **Not verified with a real Access JWT** from this box (private paths 302). Quick win in code; browser Range behavior pending human login.
- Player still `decodeAudioData`’s full buffers — Range helps progressive download clients / future `<audio>` seek, not current WebAudio path.

## 4) Deploy / regression
- `/_health` ok; `public_stems_open: false`
- Public stem URL still **401**
- `/private/` still Access **302**

## What's still thin
- CC0 job left at `waiting_bot` with **stub** beat/transcription/procedural (non-LAP has no lap analysis). Semantic merge not run for it (LAP-only knowledge writer).
- Consumer loop has no log rotation beyond daily filename; no alert on repeated failures.
- Deno not installed; Node is sufficient for the proved path.
- Duplicate stems for CC0 job (~demucs bass/no_bass) stored in private R2 — cost still small.

## Cost delta
- One 26s Demucs CPU run (~seconds) + ~5MB source + ~stem pair in R2 — negligible.
- Loop idle: one R2 list/get cycle per 30s — still cents.

## Fix-next
1. Parent creates `ROUTINE-WAKE.md` routine (still open).
2. Access-session check: `curl -H "Range: bytes=0-1023"` on private stem with JWT → expect 206 / 1024 body.
3. Optional: skip demucs for jobs tagged `download-proof-only`.
4. Supervised restart (tmux/systemd user unit) if box reboots matter.
