# Komiku CC0 public demo — ship notes (2026-10-26 America/Los_Angeles)

## Track
- Title: A good bass for gambling
- Artist: Komiku
- Album: It's time for adventure ! vol 3
- License: **CC0 1.0 Universal** (confirmed on FMA track page + CDN file tags)
- FMA: https://freemusicarchive.org/music/Komiku/Its_time_for_adventure__vol_3/Komiku_-_Its_time_for_adventure_vol_3_-_06_A_good_bass_for_gambling/
- CDN: https://files.freemusicarchive.org/storage-freemusicarchive-org/music/Music_for_Video/Komiku/Its_time_for_adventure__vol_3/Komiku_-_06_-_A_good_bass_for_gambling.mp3

## Live
- Worker version: 2298a0b0-0e2d-4497-96a3-5cec8f02f2b7
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
- lean-B insight cards: Pocket / Figure / Harmony / Missable for 8 sections.
- Confidence: medium — stem-verified, not third-party chart.

## Player extras this ship
- Public `/` opens Komiku study player (same UX as private: staffs, S/M/D&B, MIDI, phone drawer).
- Credit line: title · Komiku · CC0 · FMA link.
- Playback rate buttons 100/90/75/50/25% (pitch preserved via BufferSource.playbackRate).

## Tests
- npm test: 139/139 green after deploy.

## Sync tarball
- /workspace/komiku-pd-demo-main-sync.tgz (no PR; later main sync as meirmsn-agent)

## Git
- Tracked: player, Worker, tests, attribution, `study/resource.json`, `demo-data.json`, and `analysis/*.json`.
- Not tracked: stem audio and the FMA source mix. Prior repo pattern ignores `work/` media (`*.m4a`, `*.mp3`, `*.wav`, plus `stems/` and `source/` under this demo). The Worker serves those objects from R2 `bass-demo` (`DEMO_BUCKET`) at the keys listed above.
