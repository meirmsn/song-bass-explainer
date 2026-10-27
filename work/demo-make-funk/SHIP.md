# Make Funk — public demo ship notes

## 2026-10-27 octave + drum density
- Bass dual-band: highpass+onset yin octave pops merged into pyin groove.
  bassHits 291 → 367; MIDI≥48 ~1.7% → ~21.0%; oct3 5 → 77.
- Drums: keep backbeat snare + kick NMS (adjacent-kick bars 0); add 8th-hat fill + ghost snares.
  drumHits 1249 → 1533 (kick/snare/hat denser without 32nd kick spam).

## 2026-10-27 feel-review AMT fix
- Bass anti-wobble: hysteresis + gap-merge + min dur + score_method no longer rewards dense 16ths.
- Drums: backbeat prior (snare on 2/4) + kick NMS.
- Catalog: Komiku dropped from **public** DEMO picker only (still private/regression + asset serve).

## Prior
Real bass AMT (librosa.pyin) absolute bassHits; Maple Leaf skipped (piano bleed).

## 2026-10-27 MIDI-first ship
- Demoted from public hero to private/regression (AMT hits unchanged; not hand-fixed).
- Public hero is now Pocket Funk (MIDI-authored).
