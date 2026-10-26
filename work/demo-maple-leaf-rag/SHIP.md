# Maple Leaf Rag PDM public demo — ship notes (2026-10-26 America/Los_Angeles)

## Track
- Title: Maple Leaf Rag (1899, Z. Brewster-Geisz version)
- Composer: Scott Joplin
- Realization: Z. Brewster-Geisz (software/piano realization on FMA)
- Album: Frog Legs: Ragtime Era Favorites
- License: **Public Domain Mark 1.0** (confirmed on FMA track page 2026-10-26)
- FMA: https://freemusicarchive.org/music/Scott_Joplin/Frog_Legs_Ragtime_Era_Favorites/03_-_scott_joplin_-_maple_leaf_rag
- CDN: https://files.freemusicarchive.org/storage-freemusicarchive-org/music/Oddio_Overplay/Scott_Joplin/Frog_Legs_Ragtime_Era_Favorites/Scott_Joplin_-_03_-_Maple_Leaf_Rag_1899_Z_Brewster-Geisz_version.mp3
- Downloaded: 2026-10-26 12:16:48 PDT (America/Los_Angeles)

## Live
- Worker version: 47743e48-b6cd-408f-9681-fde936a16d8f (multi-song public catalog 2026-10-26)
- Public player: https://bass.meirmsn.dev/?song=maple-leaf-rag
- Catalog: https://bass.meirmsn.dev/api/demo/catalog
- Demo API: https://bass.meirmsn.dev/api/demo/maple-leaf-rag
- Stem e.g.: https://bass.meirmsn.dev/api/demo/maple-leaf-rag/stems/other.m4a (piano)
- LAP remains 401 on public

## R2 (bass-demo / DEMO_BUCKET)
- demo/maple-leaf-rag/study/resource.json
- demo/maple-leaf-rag/demo-data.json
- demo/maple-leaf-rag/ATTRIBUTION.md
- demo/maple-leaf-rag/LICENSE
- demo/maple-leaf-rag/stems/{bass,no_bass,drums,other}.m4a
- demo/maple-leaf-rag/stems/{bass,no_bass,drums}.wav

## Analysis caveats (honest)
- **Demucs bass + drums stems near-empty** (rms ~0.0001). Piano energy landed in `other`.
- Bass voice = **left-hand stride** extracted from other/mix low chroma + pyin — not a separated electric bass.
- **drumHits = []**; drumsOutBars = full range [[0,72]]. **No invented backbeat.**
- Key: Ab major (~112 BPM 4/4 grid, ~154s, 73 bars). Sevenths preserved when chroma supports (Eb7/Ab7/Fm7…).
- lean-B insights: 9 sections × 4 = **36**; cards explicitly warn not to invent a kit.
- Shipped for **name recognition**; practice value is LH stride outline, not modern bass+drums mute.
- Confidence: low-medium.

## Credit
Scott Joplin (composer); Z. Brewster-Geisz realization as on FMA; Public Domain Mark 1.0.
