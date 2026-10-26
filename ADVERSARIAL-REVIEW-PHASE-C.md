# ADVERSARIAL REVIEW — Phase C (stem gate + semantic merge + resource player)

Date: 2026-10-24 America/Los_Angeles  
Deploy version: `db6c67d3-46e5-4e3b-887c-2a4de9f4111d`

## What was fixed (verified live)

### 1) Public stems gated
- `GET /api/demo/like-a-prayer/stems/*.wav` → **401** JSON error (no WAV bytes).
- Stem objects **deleted from `bass-demo`**; live only under `bass-private/demo/like-a-prayer/stems/` and job prefixes.
- Public `/api/demo/like-a-prayer` forces `muteBassSupported: false`.
- Mute Bass path: `/private/player/` + `/private/api/demo/.../stems/*` (Access **302** without JWT).
- `/_health` reports `public_stems_open: false`, `public_demo_stems_object_present: false`, `private_demo_stems: true`.

### 2) waiting_bot → ready
- `job_be8b7b8764414adc` and `job_1671bace4fd94547`: `analysis/semantic.json`, `merge-report.json`, merged `study/resource.json`, meta `status=ready`, wake `bass.job.ready`.

### 3) Player prefers study resource cards/patterns
- Public + private payloads include `cards` / `patterns`.
- `player.js` uses `CARDS_EFF` / `PATS_EFF` from payload when present; falls back to hardcoded shell.
- Public mode strips stem enablement even if a stale payload claims stems.

### 4) Deploy / Access
- `/` → 200 visual demo (no audio).
- `/private/`, `/private/player/`, private stem URL → Access **302**.

## What still works / is real
- End-to-end LAP job artifacts in private R2 including stems + study resource.
- Private player page exists and is Access-gated (browser login required to hear stems).
- Public site is visual-only for audio.

## What's still fake / thin
- **Semantic content is the same knowledge that was hardcoded in player.js** — written into R2 as `semantic.json`, not a fresh multi-source research pass per job. Both jobs share identical cards/patterns (correct for same song; not a general bot pipeline).
- **No automated routine yet** — merge was done by this executor script, not the proposed Grok Bot routine (`ROUTINE-WAKE.md` still needs parent create).
- **Private player not click-tested in a real Access session** from this box (no JWT); only 302 verified.
- **Hardcoded PATS/CARDS remain in player.js** as fallback — duplication risk vs resource.json drift.
- **Non-LAP songs** still get stub analysis from the box consumer; semantic merge path here was LAP-specific.
- **Range requests / streaming**: private stem responses still dump full objects; player buffers entire WAVs in memory (~35MB × 2).

## Residual security / copyright
- Stems remain in R2 `bass-private` (correct). Anyone with Access email still gets full-song audio — single-user assumption holds.
- Worker must not re-bind demo stems to a public route in a future deploy; health flag `public_stems_open` is a tripwire (always false by code path).
- If Access policy path is misconfigured (e.g. only `/private` without `/private/*`), stem URLs could leak — **re-check Zero Trust path covers `/private/*`**.
- Public JSON still describes a copyrighted performance (chords/timing); lower risk than WAV redistribution but not zero.

## YT / cost (unchanged delta)
- No new YT download in this phase.
- R2: deleted ~105MB from `bass-demo`; private still holds stems (jobs + demo copy) — storage cents.
- Worker: negligible; large private stem downloads only after Access.

## Fix-next
1. Parent creates routine from `ROUTINE-WAKE.md`.
2. Deduplicate: generate player fallback from resource or drop inline CARDS/PATS once resource load is mandatory.
3. Access session E2E: play Mute Bass in `/private/player/`.
4. Optional: signed short-lived stem URLs instead of long-lived Access cookie on big GETs.
5. Generalize semantic writer beyond LAP.
