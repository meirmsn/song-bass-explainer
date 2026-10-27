# Komiku CC0 public demo — ship notes (2026-10-26 America/Los_Angeles)

## Track
- Title: A good bass for gambling
- Artist: Komiku
- Album: It's time for adventure ! vol 3
- License: **CC0 1.0 Universal** (confirmed on FMA track page + CDN file tags)
- FMA: https://freemusicarchive.org/music/Komiku/Its_time_for_adventure__vol_3/Komiku_-_Its_time_for_adventure_vol_3_-_06_A_good_bass_for_gambling/
- CDN: https://files.freemusicarchive.org/storage-freemusicarchive-org/music/Music_for_Video/Komiku/Its_time_for_adventure__vol_3/Komiku_-_06_-_A_good_bass_for_gambling.mp3

## Live
- Worker version: fc903d56-b676-4bf0-b9e7-23ba1251a122 (insight visuals + panel order 2026-10-26)
- Public player: https://bass.meirmsn.dev/ (also /player/)
- Catalog: https://bass.meirmsn.dev/api/demo/catalog
- Demo API: https://bass.meirmsn.dev/api/demo/a-good-bass-for-gambling
- Stem e.g.: https://bass.meirmsn.dev/api/demo/a-good-bass-for-gambling/stems/bass.m4a
- LAP remains 401 on public `/api/demo/like-a-prayer*`

## R2 (bass-demo / DEMO_BUCKET)
- demo/a-good-bass-for-gambling/study/resource.json
- demo/a-good-bass-for-gambling/demo-data.json
- demo/a-good-bass-for-gambling/ATTRIBUTION.md
- demo/a-good-bass-for-gambling/LICENSE
- demo/a-good-bass-for-gambling/stems/{bass,no_bass,drums,other}.m4a
- demo/a-good-bass-for-gambling/stems/{bass,no_bass,drums}.wav

## Analysis caveats
- No published chord/bass chart found for this track (searched 2026-10-26).
- Acoustic path: htdemucs 4-stem + librosa chroma on mix + pyin on bass stem.
- Key: Em (~123 BPM, 4/4, ~156s, 79 bars). Chord qualities preserved when functional (Em/Em7/B7/Am/A7…); Bb-bass “C7” mirages demoted to Em.
- lean-B insight cards: Pocket / Figure / Harmony / Missable for every section that has cards (12 section keys × 4 = 48).
- **Ship blocker:** every flashcard MUST include an `insight` schematic (`layer` + claim-window highlights). Prose-only `{label,body}` is not shippable — see `meta.insightRequired` in demo-data.json / study/resource.json.
- Confidence: medium — stem-verified, not third-party chart.

## Player extras this ship
- Public `/` opens Komiku study player (same UX as private: staffs, S/M/D&B, MIDI, phone drawer).
- Credit line: title · Komiku · CC0 · FMA link.
- Playback rate buttons 100/90/75/50/25% (pitch preserved via BufferSource.playbackRate).

## Tests
- npm test: 144/144 green after deploy.

## Sync tarball
- /workspace/komiku-insights-main-sync.tgz (no PR; later main sync as meirmsn-agent)

## Insight coverage (2026-10-26 America/Los_Angeles)
- Authored lean-B `insight` on **all 48** Komiku cards (intro/a1/verse/a2/b1/chorus/br/bridge/a3/b2/out/tag × Pocket/Figure/Harmony/Missable).
- PatternIds resolve to section patterns (`intro_air`, `chrom_eb`, `chrom_eb2`, `e_pedal_lift`, `drop_e`, `bb_hang`, `build_walk`, `outro_eb`) or builtin `empty` for near-silent intro pocket.
- Flashcard panel order: label → body (15px) → insight → mini-grid → Prev/Next.
- Checklist for future demos: before upload, assert `every card has insight.layer`; missing insight is a ship blocker.

## Bass AMT fix (2026-10-27 America/Los_Angeles)
- Real librosa.pyin AMT on `stems/bass.wav` → absolute `bassHits` (player prefers these over 2-bar tiled patterns).
- `meta.analysis` now reflects actual method (no false chroma-as-pyin claim).
- Pipeline: `scripts/transcribe_bass.py`; `analyze_audio.py` merges AMT when stem present.
- Regression: `tests/bass-amt-regression.test.mjs`, `tests/bass-hits-player.test.mjs`.
