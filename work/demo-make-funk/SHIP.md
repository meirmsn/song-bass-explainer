# Make Funk CC0 public demo — ship notes (2026-10-26 America/Los_Angeles)

## Track
- Title: Make Funk
- Artist: HoliznaCC0
- Album: BASSIC
- License: **CC0 1.0 Universal** (confirmed on FMA track page 2026-10-26)
- FMA: https://freemusicarchive.org/music/holiznacc0/bassic/make-funk/
- CDN: https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/gvipQswrNI4uF5PNymw5d1cWq9gqqdTIsgHDMKCJ.mp3
- Downloaded: 2026-10-26 12:16:48 PDT (America/Los_Angeles)

## Live
- Worker version: 47743e48-b6cd-408f-9681-fde936a16d8f (multi-song public catalog 2026-10-26)
- Public player: https://bass.meirmsn.dev/?song=make-funk
- Catalog: https://bass.meirmsn.dev/api/demo/catalog
- Demo API: https://bass.meirmsn.dev/api/demo/make-funk
- Stem e.g.: https://bass.meirmsn.dev/api/demo/make-funk/stems/bass.m4a
- LAP remains 401 on public `/api/demo/like-a-prayer*`

## R2 (bass-demo / DEMO_BUCKET)
- demo/make-funk/study/resource.json
- demo/make-funk/demo-data.json
- demo/make-funk/ATTRIBUTION.md
- demo/make-funk/LICENSE
- demo/make-funk/stems/{bass,no_bass,drums,other}.m4a
- demo/make-funk/stems/{bass,no_bass,drums}.wav

## Analysis
- htdemucs 4-stem: **strong bass + drums** (bass rms ~0.17, drums ~0.22). Priority bass-quality track.
- Key: Am (~99 BPM, 4/4, ~163s, 67 bars). Chord qualities include Am7/A7/D7 when chroma supports.
- lean-B insights: 9 sections × 4 = **36** (Pocket / Figure / Harmony / Missable); every card has `insight`.
- drumHits: derived from stems/drums.wav (librosa grid); **1247** hits; no LAP invent.
- Confidence: medium — stem-verified, not third-party chart.

## Caveats
- Auto chroma had some sharp-root mirages (Gbm/Dbm); demoted toward Am funk vocabulary when bass PC is A-family.
- No published bass chart found 2026-10-26.

## Tests / deploy
- See parent ship report after `npm test` + `scripts/deploy.sh`.
