#!/usr/bin/env python3
"""Derive per-song drumHits from a drums stem + beat.json (bass.drums.v1).

Band-energy grid on 16th steps; exclusive kick/snare winner per step + hat layer.
Silent bars (low RMS) become drumsOutBars and produce no hits.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import librosa
import numpy as np

MIDI = {"kick": 36, "snare": 38, "hat": 42}


def load_beat(path: Path) -> dict:
    return json.loads(path.read_text())


def bar_times(beat: dict, nbars: int) -> list[tuple[float, float]]:
    """Return (t0, t1) for bars 0..nbars-1 from downbeats or grid."""
    dbs = beat.get("downbeats") or []
    if len(dbs) >= 2:
        times = []
        for i in range(nbars):
            if i + 1 < len(dbs):
                times.append((float(dbs[i]), float(dbs[i + 1])))
            elif i < len(dbs):
                # last known downbeat → extrapolate period
                if i >= 1:
                    period = float(dbs[i]) - float(dbs[i - 1])
                else:
                    period = 60.0 / float((beat.get("grid") or {}).get("bpm") or beat.get("bpm_hint") or 120) * 4
                times.append((float(dbs[i]), float(dbs[i]) + period))
            else:
                # extrapolate beyond last downbeat
                period = float(dbs[-1]) - float(dbs[-2]) if len(dbs) >= 2 else 2.0
                t0 = float(dbs[-1]) + (i - (len(dbs) - 1)) * period
                times.append((t0, t0 + period))
        return times
    grid = beat.get("grid") or {}
    bpm = float(grid.get("bpm") or beat.get("bpm_hint") or 120)
    period = 60.0 / bpm * 4.0
    phase = float(grid.get("phase_s") or 0.0)
    return [(phase + i * period, phase + (i + 1) * period) for i in range(nbars)]


def band_rms(y: np.ndarray, sr: int, lo: float, hi: float) -> float:
    if len(y) < 16:
        return 0.0
    # FFT magnitude energy in band
    spec = np.fft.rfft(y * np.hanning(len(y)))
    freqs = np.fft.rfftfreq(len(y), 1.0 / sr)
    mask = (freqs >= lo) & (freqs < hi)
    if not np.any(mask):
        return 0.0
    return float(np.sqrt(np.mean(np.abs(spec[mask]) ** 2)) + 1e-12)


def derive(drums_wav: Path, beat_path: Path, nbars: int | None = None) -> dict:
    beat = load_beat(beat_path)
    grid = beat.get("grid") or {}
    bpm = float(grid.get("bpm") or beat.get("bpm_hint") or 120)
    if nbars is None:
        nbars = int(grid.get("nbars") or max(1, len(beat.get("downbeats") or []) - 1))
    y, sr = librosa.load(str(drums_wav), sr=22050, mono=True)
    bars = bar_times(beat, nbars)

    # Global thresholds from active (non-silent) bars
    bar_rms = []
    for t0, t1 in bars:
        i0, i1 = int(t0 * sr), max(int(t0 * sr) + 1, int(t1 * sr))
        seg = y[i0:i1]
        bar_rms.append(float(np.sqrt(np.mean(seg ** 2)) + 1e-12))
    med = float(np.median(bar_rms)) if bar_rms else 1e-3
    silent_thresh = max(0.002, med * 0.08)

    hits: list[dict] = []
    drums_out: list[list[int]] = []
    silent_run: list[int] | None = None

    for bar, ((t0, t1), rms) in enumerate(zip(bars, bar_rms)):
        if rms < silent_thresh:
            if silent_run is None:
                silent_run = [bar, bar]
            else:
                silent_run[1] = bar
            continue
        if silent_run is not None:
            drums_out.append(silent_run)
            silent_run = None

        period = max(1e-3, t1 - t0)
        step_dur = period / 16.0
        kick_e = np.zeros(16)
        snare_e = np.zeros(16)
        hat_e = np.zeros(16)
        for step in range(16):
            s0 = t0 + step * step_dur
            s1 = s0 + step_dur
            i0, i1 = int(s0 * sr), max(int(s0 * sr) + 1, int(s1 * sr))
            seg = y[i0:i1]
            # kick: low; snare: mid+crack; hat: high
            kick_e[step] = band_rms(seg, sr, 30, 120) + 0.35 * float(np.sqrt(np.mean(seg ** 2)) + 1e-12)
            snare_e[step] = band_rms(seg, sr, 150, 400) + 0.5 * band_rms(seg, sr, 2000, 6000)
            hat_e[step] = band_rms(seg, sr, 6000, 12000)

        # Normalize within bar
        def norm(a):
            m = float(a.max()) if a.max() > 0 else 1.0
            return a / m

        kick_n, snare_n, hat_n = norm(kick_e), norm(snare_e), norm(hat_e)
        # Adaptive thresholds
        k_th = max(0.35, float(np.percentile(kick_n, 70)) * 0.85)
        s_th = max(0.35, float(np.percentile(snare_n, 70)) * 0.85)
        h_th = max(0.28, float(np.percentile(hat_n, 55)) * 0.75)

        for step in range(16):
            k, s, h = kick_n[step], snare_n[step], hat_n[step]
            # Exclusive kick/snare: stronger band wins if both above thresh
            kick_on = k >= k_th
            snare_on = s >= s_th
            if kick_on and snare_on:
                if k >= s * 1.15:
                    snare_on = False
                elif s >= k * 1.15:
                    kick_on = False
                # else allow both (backbeat with kick common)
            hat_on = h >= h_th
            # Prefer hats on even 8ths when energy is middling
            if not hat_on and step % 2 == 0 and h >= h_th * 0.7:
                hat_on = True
            if kick_on:
                hits.append({"bar": bar, "step": step, "kind": "kick", "midi": MIDI["kick"]})
            if snare_on:
                hits.append({"bar": bar, "step": step, "kind": "snare", "midi": MIDI["snare"]})
            if hat_on:
                hits.append({"bar": bar, "step": step, "kind": "hat", "midi": MIDI["hat"]})

    if silent_run is not None:
        drums_out.append(silent_run)

    return {
        "schema": "bass.drums.v1",
        "source": "librosa grid on stems/drums.wav; exclusive kick/snare + hat layers; beat.json downbeats",
        "bpm": bpm,
        "nbars": nbars,
        "midi": MIDI,
        "drumsOutBars": drums_out,
        "hits": hits,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--drums", required=True, type=Path)
    ap.add_argument("--beat", required=True, type=Path)
    ap.add_argument("--nbars", type=int, default=None)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--merge-demo", type=Path, nargs="*", default=[])
    args = ap.parse_args()
    result = derive(args.drums, args.beat, args.nbars)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result))
    print(f"wrote {args.out} hits={len(result['hits'])} drumsOutBars={result['drumsOutBars']}")

    for demo_path in args.merge_demo:
        demo = json.loads(demo_path.read_text())
        demo["drumHits"] = result["hits"]
        # Keep existing drumsOutBars if present (authoritative stem silence), else use derived
        if not demo.get("drumsOutBars"):
            demo["drumsOutBars"] = result["drumsOutBars"]
        demo_path.write_text(json.dumps(demo, indent=2) + "\n")
        print(f"merged drumHits into {demo_path} ({len(result['hits'])} hits)")


if __name__ == "__main__":
    main()
