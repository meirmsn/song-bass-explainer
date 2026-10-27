# Pocket Funk — MIDI-first public hero demo

## 2026-10-27
- Authored MIDI funk groove (bass + GM kit + EP), 96 BPM, 40 bars, ~100s, key Am
- Rendered mix + stems via FluidSynth / FluidR3_GM
- Hits from scripts/midi_to_hits.py (1:1 with MIDI)
- Replaces Make Funk as public default/hero (Make Funk demoted to private/regression)

## 2026-10-27 (sync + insights fix)
- Root cause sync: MIDI author wrote drums with sequential note_on/note_off deltas, so concurrent kick+hat+crash drifted later vs bass. Re-authored with abs-time merge; re-rendered FluidSynth stems; hits 1:1.
- Root cause empty insight schematics: cards used absolute song `barRange` while pattern notes are claim-local (0..n). Player filters `step >= barRange[0]*16` → empty staves after intro. Fixed to claim-local `[0,1]`.
- Right-arrow while playing: hardened pickSection to seek stems/MIDI to section start; added regression tests (DOM + transport) asserting t !== song start.
