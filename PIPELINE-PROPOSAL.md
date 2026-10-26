# Bass Study — hierarchical pipeline proposal

## Goal
Private-side YouTube URL paste → Cloudflare OSS audio (Demucs/stems, beat, transcription) → artifacts in R2 `bass-private` → wake Grok Bot (Bass) for semantic analysis (training + web) → merge with procedural JSON → study resource for the player.

---

## 1. Intake UI (`/private`, Access-gated)
- Paste YouTube URL (+ optional title).
- Validate host (`youtube.com` / `youtu.be` / music / shorts).
- `POST /private/api/jobs` → create job meta in R2; show job list + stage.
- Later: progress (queued → downloading → demucs → beat → transcribe → wake → merge → ready).
- Link into private player once `study/resource.json` exists.

## 2. Job queue
- **Now (shipped stub):** R2 object keys as queue: `jobs/{id}/meta.json` + `wake/{id}.json`.
- **Next:** Cloudflare Queues producer on intake; consumer Worker drives stages; optional Durable Object per job for status.
- Job states: `queued | running | waiting_bot | merging | ready | failed`.
- Idempotent stage markers under `jobs/{id}/stages/{name}.json`.

## 3. Compute options on Cloudflare
### A. Workers + Containers (preferred CF-native)
- Container image with Demucs / beat / Whisper (or faster-whisper).
- Queue consumer pulls job → container runs → writes stems/JSON to R2.
- Pros: same account, R2 binding, no egress to random VPS.
- Cons: GPU availability / cold start / CF Containers maturity & pricing for long audio.

### B. Workers Queues + external GPU (RunPod / Modal / Fly / box)
- Worker downloads audio (or signs R2 PUT), POSTs to GPU worker with job id + callback secret.
- GPU writes results to R2 via S3 API (`bass-storage` keys).
- Pros: real GPU for Demucs; known OSS stack.
- Cons: secrets, network, ToS of YT download host, ops burden.

### C. Hybrid
- Worker: URL validate, yt-dlp on a small always-on/box or container CPU for audio fetch.
- GPU only for Demucs + optional transcription.
- Beat/chroma can stay CPU (librosa) on container or box.

**Recommendation for v1:** B or C — get stems working on known GPU; keep CF as orchestrator + R2 + Access UI. Revisit Containers when GPU SKUs fit.

## 4. Artifact layout in R2 `bass-private`
```
jobs/{jobId}/
  meta.json
  source/audio.wav          # or .m4a + normalized wav
  source/info.json          # yt metadata (title, duration, id)
  stems/bass.wav
  stems/drums.wav
  stems/other.wav
  stems/vocals.wav
  analysis/beat.json        # bpm, bars[], downbeats
  analysis/transcription.json
  analysis/procedural.json  # chords/bass-per-beat/sections (machine)
  analysis/semantic.json    # bot-written flashcards / pattern notes
  study/resource.json       # merged player payload
wake/{jobId}.json           # wake marker / poll token
```
Public demos live in `bass-demo/demo/{song}/…` (already seeded with Like a Prayer demo-data).

## 5. Bot wake mechanism options
1. **Webhook** — CF Worker `POST` to a Grok Bot / Cursor inbound URL with job id + signed HMAC; bot pulls R2 via signed URL or MCP.
2. **Email** — Worker emails bot inbox (`agent-email`) with job id; bot `SearchEmailThreads` / routine wakes on mail.
3. **Routine / poll** — scheduled routine lists `wake/*.json` via Worker admin endpoint or R2; processes newest.
4. **Manual** — private UI “Notify Bass” button copies prompt + job id (fallback).

**Recommendation:** start with (3) poll + (4) manual; add (1) webhook when inbound channel is stable. Email (2) is fine backup but slower/noisier.

## 6. Merge step
- Input: `procedural.json` (bars, chords, bass_per_beat, sections, tempo) + `semantic.json` (cards, patterns, roman overrides, feel notes).
- Output: `study/resource.json` shaped like current demo player payload (`raw`, `secs`, cards by kind, pattern ids).
- Rules: procedural wins on timing; semantic wins on language/teaching; conflict log in `analysis/merge-report.json`.
- Player loads `study/resource.json` (+ stem URLs via Worker signed GET).

## 7. Failure / retry
- Per-stage retries (3×) with backoff; mark `failed` + `lastError`.
- Partial artifacts kept for resume (skip completed stages).
- Poison jobs: max attempts → dead-letter prefix `jobs/_failed/{id}/`.
- User can “Retry from stage” in private UI.

## 8. Cost / risk (order-of-magnitude, single-user)
- R2 storage: small (wav stems ~50–200 MB/song) — cents.
- Worker requests: negligible.
- GPU Demucs ~2–10 min/song → $0.10–$2 depending on host.
- Whisper/transcription: smaller than Demucs.
- Bot wake / analysis: model usage on your account — variable.
- Risk: YT download breakage, copyright (personal study only), secret sprawl, public API footguns.

---

## ADVERSARIAL REVIEW (pipeline A)

### What breaks
- **yt-dlp / YouTube** formats and bot detection change constantly; CF egress IPs may be blocked.
- **Demucs on CF Containers** may not have suitable GPU or timeout for 3–6 min tracks.
- **Queue without a consumer** (current stub): jobs sit in `queued` forever — UI lies if it implies processing.
- **Bot wake reliability:** email can delay; webhooks need auth; routines miss if schedule gaps; no human-in-loop → stuck `waiting_bot`.
- **Merge schema drift:** player shell hardcodes Like a Prayer patterns; generic songs need a schema version field.
- **Clock / tempo drift:** live performances vs studio — procedural beat tracker fails → bad loop ranges.

### Copyright / ToS
- Storing full song stems in R2 is copyright-sensitive; keep **private**, single-user, educational intent; do not publish stems on `/`.
- YouTube ToS generally forbid downloading; personal research gray area — do not productize or redistribute.
- Public demo should use licensed/original audio or **no audio** (current state).

### CF limits for heavy ML
- Worker CPU time / memory cannot run Demucs.
- Containers: check current GPU SKUs, max duration, concurrency; cold starts hurt UX.
- R2 multipart needed for large wavs; Worker `put` size limits if proxying bytes.

### Bot wake reliability
- No first-class “wake Grok Bot with R2 payload” product guarantee — design for poll + retry + manual.
- Semantic step needs web + training; offline songs / obscure live cuts → thin cards.

### Security of private bucket wake
- **Fixed this deploy:** public `POST /api/jobs` disabled; intake only under `/private/api/*` behind Access (302 without JWT).
- Wake markers in R2 must not be world-readable; Worker should mint short-lived signed URLs for the bot, not expose bucket credentials to the client.
- Access policy must cover `/private` **and** `/private/*` (including `/private/api/*`); verify dashboard paths.
- `bass-build` token must stay deploy-only; `bass-storage` S3 keys never in frontend.

### Single-user assumptions
- No multi-tenant isolation; one Access email = full private catalog.
- No quota — a buggy loop could enqueue dozens of Demucs jobs (add rate limit).
- No shared auth between Worker and bot beyond Access / secrets you place.

---

## Shipped now (2026-10-24 America/Los_Angeles)




### Phase F — Whisper non-LAP (2026-10-24 America/Los_Angeles)
- `scripts/whisper_transcribe.py` (faster-whisper via `/workspace/.venv-whisper`) for non-LAP lyrics + gap sections.
- Wired into `analyze_audio.py` / `consume_jobs.py` (vocals stem preferred); docs in `WHISPER.md`.
- Unit tests: `scripts/test_whisper_map.py`; vitest fixture contract; dry-run on short LAP vocals clip.
- Worker not redeployed (pipeline-only).

### Phase E (2026-10-24 America/Los_Angeles)
- Generic `scripts/analyze_audio.py` (librosa) for non-LAP: beat/chords/bass/sections + semantic + auto-ready.
- CC0 job marked ready with real procedural (not stubs).
- `consume_jobs.py` no longer writes analysis stubs for non-LAP.
- Review: `ADVERSARIAL-REVIEW-PHASE-E.md`.

### Phase D (2026-10-24 America/Los_Angeles)
- yt-dlp proved on CC short clip with Node JS runtime (`YTDLP-PROOF.md`); consumer wired `--js-runtimes` + `ejs:github`.
- Durable loop: `scripts/run_consumer_loop.sh` → `logs/`.
- Private stem Range/206 support in Worker.
- Review: `ADVERSARIAL-REVIEW-PHASE-D.md`.

### Phase C (2026-10-24 America/Los_Angeles)
- Public stems removed/gated (401); Mute Bass only under `/private/player/` + private stem APIs.
- Both LAP jobs marked `ready` with semantic.json + merged study/resource.json.
- Player prefers payload `cards`/`patterns`.
- Review: `ADVERSARIAL-REVIEW-PHASE-C.md`.

### Phase B (hybrid box consumer)
- Box consumer: `scripts/consume_jobs.py` (R2 poll → yt-dlp or lap fallback → Demucs two-stems → analysis → wake).
- Like a Prayer jobs processed to `waiting_bot` with stems + procedural in `bass-private`.
- Demo stems in `bass-demo`; public Mute Bass via `/api/demo/like-a-prayer/stems/*`.
- Private UI stage pills + `/private/api/wake`.
- Routine proposal: `ROUTINE-WAKE.md` (parent must create).
- Adversarial review: `ADVERSARIAL-REVIEW-PHASE-B.md`.

### Phase A

### Phase A detail
- Public player shell at `/` (Like a Prayer demo, no audio).
- Private intake UI + `POST/GET /private/api/jobs` writing `jobs/*/meta.json` + `wake/*.json` to `bass-private`.
- Demo JSON also in `bass-demo/demo/like-a-prayer/demo-data.json`.
- Not shipped: download, Demucs, beat/transcription runners, bot wake automation, merge, stem playback.
