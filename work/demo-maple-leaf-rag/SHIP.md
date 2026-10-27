# Maple Leaf Rag — MIDI-first refresh

## 2026-10-27
- Replaced FMA audio with FluidSynth render of Mutopia maple.mid (120 BPM, 144s, 72×4/4 bars)
- bassHits from LH (`down:`), midi≤55; drumHits=[]
- No FMA tempo-align / DTW hack

## 2026-10-27 (insights fix)
- Insight card schematics empty after strain A: `barRange` was absolute song bars; patterns are claim-local. Fixed to `[0,1]`.
