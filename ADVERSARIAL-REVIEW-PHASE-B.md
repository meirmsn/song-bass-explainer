# ADVERSARIAL REVIEW — Phase B (hybrid box consumer + Mute Bass)

Date: 2026-10-24 America/Los_Angeles

## What works (verified)
- Box consumer `scripts/consume_jobs.py` polls R2 `jobs/*/meta.json` with `status=queued`.
- Like a Prayer jobs (`job_be8b7b8764414adc`, `job_1671bace4fd94547`) ran end-to-end: download → demucs → beat/transcribe/procedural → study stub → `wake/{id}.json` with `waiting_bot`.
- Local Demucs `htdemucs --two-stems=bass` on `/workspace/lap/lap.wav` (~33s CPU) produced `bass.wav` + `no_bass.wav`.
- Stems + demo-data uploaded to `bass-demo/demo/like-a-prayer/…`.
- Worker APIs: `/api/demo/like-a-prayer`, stem GETs, `/private/api/wake`, job detail with stages.
- Private UI shows stage pills + auto-refresh; public player loads R2 demo JSON and enables Mute Bass when stems exist.

## What's fake / stubby
- **yt-dlp path mostly unused for LAP**: consumer short-circuits to `/workspace/lap/lap.wav` for video id `C0IQm-MXh2s`. Real YouTube download is coded but not proven green on this box egress.
- **No full 4-stem Demucs**: only bass / no_bass (other is alias of no_bass). Drums/vocals stems absent.
- **Beat/transcription/procedural for LAP are precomputed lap artifacts**, not freshly recomputed from the downloaded file each run. Non-LAP songs get JSON stubs.
- **Semantic merge not done**: status stops at `waiting_bot`; flashcards in the public player are still hardcoded in `player.js` (CARDS/PATS), not loaded from `study/resource.json`.
- **Player study payload**: Mute Bass uses demo stems; private job `study/resource.json` is not yet the public player's source of truth.
- **No Cloudflare Queue / Container**: still R2-key polling + box process. If the box is asleep, queue stalls again.
- **Access**: private APIs assume dashboard Access; health is public. Routine may fail HTTP Access without a browser session.

## YouTube risks
- ToS: downloading remains a gray personal-research area; do not productize.
- Bot detection / IP blocks on datacenter egress are likely; fallback to local files is the reliable path for LAP only.
- Format churn breaks yt-dlp; pin/update the binary in `/workspace/v`.
- Copyright: full song stems in R2 (`bass-demo` public-via-Worker and `bass-private`) — keep Access on private; public Mute Bass exposes copyrighted audio to anyone who can hit `/api/demo/.../stems/*.wav`. That is a real footgun vs earlier “no audio on public” stance.

## Cost (order of magnitude, single-user)
- R2 storage: ~70MB stems × demos/jobs → still cents/month.
- R2 class A ops on each consumer run: small.
- Box CPU Demucs: ~0.5–2 min/track on CPU for two-stems; electricity only (no GPU bill).
- Worker requests for 35MB wav streaming: watch egress if you share the public URL widely.
- Bot semantic routine: model tokens per wake; weekday hourly poll is cheap if silent when empty.

## Security
- Public stem URLs are unauthenticated — intentional for Mute Bass demo, risky for copyright and bandwidth.
- R2 S3 keys stay on box env only; never in frontend (still true).
- Wake markers in private bucket; `/private/api/wake` must stay Access-gated.

## Fix-next (priority)
1. Gate public stems or move Mute Bass to `/private` player only.
2. Teach player to load `study/resource.json` (cards/patterns) when present.
3. Run consumer as a supervised loop/systemd-style on the box (or cron).
4. Prove yt-dlp on a non-LAP URL; document block page if any.
5. Parent creates routine from `ROUTINE-WAKE.md`.

## yt-dlp probe (2026-10-24 America/Los_Angeles)
- Metadata fetch for `C0IQm-MXh2s` succeeded: title + duration 203s.
- Warning: no supported JS runtime (deno default); some formats may be missing. Not a hard block on this probe, but download reliability is unproven — LAP path uses local `/workspace/lap/lap.wav` by design.
