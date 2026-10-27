# Make Funk — public demo ship notes

## 2026-10-27 feel-review AMT fix
- Bass anti-wobble: hysteresis + gap-merge + min dur + score_method no longer rewards dense 16ths.
  bassHits 538 → 291 (~8.0 → ~4.3 n/bar).
- Drums: backbeat prior (snare on 2/4) + kick NMS.
  snare-on-2 bar frac ~33% → ~82%; adjacent-kick bars 51 → 0.
- Catalog: Komiku dropped from **public** DEMO picker only (still private/regression + asset serve).

## Prior
Real bass AMT (librosa.pyin) absolute bassHits; Maple Leaf skipped (piano bleed).
