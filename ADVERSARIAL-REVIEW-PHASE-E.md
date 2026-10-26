# ADVERSARIAL REVIEW — Phase E (generic non-LAP analysis)

Date: 2026-10-24 America/Los_Angeles  
Deploy version: `28114427-3b58-4d09-bda0-e6595f78b138`

## Goal
Stop stubbing non–Like-a-Prayer jobs. Compute real procedural analysis + generic semantic merge.

## What works (verified)

### Analyzer
- New `scripts/analyze_audio.py` (librosa): tempo/beats, 4/4 bar grid with late-lock backfill, chroma chord templates, low-band bass-per-beat, crude sections, generic flashcards/patterns, study merge.
- Transcription: explicit `skipped` (faster-whisper not in venv) — not a silent stub lie.

### CC0 job (`job_cc0ytdlp85455.336Z`)
- Was `waiting_bot` with stub JSON → now **`ready`**
- Example measured: ~**78 BPM**, **8 bars**, key guess **Bm**, 2 sections (Intro/Outro)
- Artifacts in R2: `analysis/{beat,procedural,semantic,transcription,merge-report}.json`, `study/resource.json`
- `procedural.status` = `ok` (not stub); cards keyed by section kind

### Consumer wiring
- `consume_jobs.py` **LAP path** still uses precomputed lap/demo artifacts → `waiting_bot` for rich lore merge
- **Non-LAP path** calls `analyze_audio` (inline if librosa present, else subprocess via `/workspace/v/bin/python`) → writes semantic + merge → **`auto_ready`**
- Smoke test: `mode=generic_subprocess`, `SMOKE_OK` bpm/nbars/keys/cards

### Worker
- No API contract break; health pipeline string mentions `analyze_audio.py`
- Public stems remain gated (Phase C)

## What's still fake / weak

| Area | Reality |
|------|---------|
| Chords / bass PC | Template chroma matches — wrong often on pads/ambient (CC0 is mostly B pedal) |
| Sections | Fixed ~4-bar chunks + intro/tag heuristics — not SSM novelty segmentation |
| Patterns | Generic pedal / root–5 MIDI outlines, not transcribed grooves |
| Semantic “feel” | RMS + spectral centroid heuristics — not arranger listening |
| Web research | `semantic.web: null` — no tool/web pass this phase |
| Lyrics | Skipped without whisper |
| Key | Krumhansl-ish profile on mean chroma — ambiguous for short pads |
| Player patterns by `sec.id` | Analyzer writes patterns under section ids; cards under `kind` — OK for current player which uses `sec.kind` for cards and `sec.id` for PATS |

## Risks
- Auto-ready non-LAP may mark garbage analysis as `ready` with no human/bot gate — UI should show confidence flags (`procedural.confidence`, `semantic.confidence`).
- Librosa CPU time grows with track length; 3–6 min songs may block the consumer loop for minutes (one job `--limit 1` mitigates).
- Beat backfill assumes constant tempo; rubato/live still drifts (LAP still special-cased for a reason).

## Cost
- CC0 re-analysis: seconds of CPU, few KB JSON R2 overwrites — negligible.
- No new GPU; Demucs unchanged.

## Fix-next
1. Optional whisper install for vocal tracks.
2. Stronger section boundaries (chroma recurrence / FOOTLIGHT-style SSM).
3. Confidence UI on private player; don’t present auto chords as truth.
4. Parent still should create `ROUTINE-WAKE.md` for LAP lore enrichment (generic path no longer blocks on bot).
5. Deduplicate pattern keys vs player fallbacks.
