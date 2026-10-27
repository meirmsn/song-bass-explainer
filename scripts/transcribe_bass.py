#!/usr/bin/env python3
"""Real note-level AMT on a bass stem → bassHits + section patterns.

Primary: librosa.pyin on stems/bass.wav (fmin~MIDI 28, fmax~MIDI 60).
Optional: basic-pitch when installed; pick better by onset/IOI evidence.
Quantize to 16th grid from beat.json. Prefer absolute bassHits for the player.
"""
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path

import librosa
import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_name(m: int) -> str:
    return f"{NOTE_NAMES[m % 12]}{m // 12 - 1}"


def load_beat(path: Path) -> dict:
    return json.loads(path.read_text())


def bar_times(beat: dict, nbars: int) -> list[tuple[float, float]]:
    dbs = beat.get("downbeats") or []
    if len(dbs) >= 2:
        times = []
        for i in range(nbars):
            if i + 1 < len(dbs):
                times.append((float(dbs[i]), float(dbs[i + 1])))
            elif i < len(dbs):
                period = float(dbs[i]) - float(dbs[i - 1]) if i >= 1 else 2.0
                times.append((float(dbs[i]), float(dbs[i]) + period))
            else:
                period = float(dbs[-1]) - float(dbs[-2]) if len(dbs) >= 2 else 2.0
                t0 = float(dbs[-1]) + (i - (len(dbs) - 1)) * period
                times.append((t0, t0 + period))
        return times
    grid = beat.get("grid") or {}
    bpm = float(grid.get("bpm") or beat.get("bpm_hint") or 120)
    period = 60.0 / bpm * 4.0
    phase = float(grid.get("phase_s") or 0.0)
    return [(phase + i * period, phase + (i + 1) * period) for i in range(nbars)]


def pyin_notes(y: np.ndarray, sr: int, *, fmin_midi=28, fmax_midi=60) -> list[dict]:
    """Frame-wise pyin → notes with anti-wobble hysteresis.

    Tiny MIDI-round flips (vibrato crossing .5) no longer split notes. Require a
    sustained ≥HYST_SEMI change for HYST_FRAMES before a pitch split. Same-pitch
    reattacks need a strong onset. Short unvoiced gaps are bridged later.
    """
    fmin = librosa.midi_to_hz(fmin_midi)
    fmax = librosa.midi_to_hz(fmax_midi)
    hop = 256
    HYST_SEMI = 0.85  # require ~≥0.85 semitone sustained drift to split
    HYST_FRAMES = 3
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, frame_length=2048, hop_length=hop
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    hop_s = float(hop) / sr
    midi_f = np.full(len(f0), np.nan)
    for i, (hz, v) in enumerate(zip(f0, voiced_flag)):
        if v and np.isfinite(hz):
            midi_f[i] = librosa.hz_to_midi(hz)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    onset_frames = set(
        librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, units="frames")
    )
    onset_med = float(np.median(onset_env)) if len(onset_env) else 0.0
    onset_strong = float(np.percentile(onset_env, 75)) if len(onset_env) else 0.0
    notes: list[dict] = []
    i = 0
    n = len(f0)
    while i < n:
        if not np.isfinite(midi_f[i]):
            i += 1
            continue
        cur_f = float(midi_f[i])
        cur = int(round(cur_f))
        j = i + 1
        vals = [cur_f]
        pending_pitch = None
        pending_count = 0
        while j < n and np.isfinite(midi_f[j]):
            mf = float(midi_f[j])
            # Hysteresis: ignore tiny round-boundary wobble until sustained drift
            if abs(mf - cur_f) < HYST_SEMI and int(round(mf)) != cur:
                # round flip without real pitch move — stay on current note
                vals.append(mf)
                pending_pitch = None
                pending_count = 0
                j += 1
                continue
            if abs(mf - cur_f) >= HYST_SEMI and int(round(mf)) != cur:
                if pending_pitch is None or int(round(mf)) != pending_pitch:
                    pending_pitch = int(round(mf))
                    pending_count = 1
                else:
                    pending_count += 1
                if pending_count >= HYST_FRAMES:
                    break
                vals.append(mf)
                j += 1
                continue
            pending_pitch = None
            pending_count = 0
            # same-pitch reattack only on strong onsets after a real note body
            if j in onset_frames and (j - i) >= 4:
                strength = float(onset_env[j]) if j < len(onset_env) else 0.0
                if strength >= max(onset_strong, onset_med * 2.0):
                    break
            vals.append(mf)
            # track running center so slow slides can follow without split noise
            cur_f = float(np.median(vals[-min(5, len(vals)) :]))
            cur = int(round(cur_f))
            j += 1
        t0 = float(times[i])
        t1 = float(times[min(j - 1, n - 1)]) + hop_s
        dur = max(hop_s, t1 - t0)
        midi = int(round(float(np.median(vals))))
        med_prob = float(np.nanmedian(voiced_prob[i:j])) if j > i else 0.0
        # min duration ~80ms (or one hop) — drop micro-blips
        if dur >= max(0.08, hop_s * 0.9):
            notes.append({"t": t0, "dur": dur, "midi": midi, "name": midi_name(midi), "prob": med_prob})
        i = max(j, i + 1)
    return merge_note_gaps(notes, max_gap_s=0.08)


def merge_note_gaps(notes: list[dict], *, max_gap_s: float = 0.08) -> list[dict]:
    """Merge same-MIDI notes separated by a short unvoiced/gap (anti-wobble)."""
    if not notes:
        return notes
    notes = sorted(notes, key=lambda n: n["t"])
    out = [dict(notes[0])]
    for n in notes[1:]:
        prev = out[-1]
        gap = float(n["t"]) - (float(prev["t"]) + float(prev["dur"]))
        if n["midi"] == prev["midi"] and gap <= max_gap_s:
            end = max(float(prev["t"]) + float(prev["dur"]), float(n["t"]) + float(n["dur"]))
            prev["dur"] = end - float(prev["t"])
            prev["prob"] = max(float(prev.get("prob") or 0), float(n.get("prob") or 0))
        else:
            out.append(dict(n))
    return out




def detect_octave_pops(y: np.ndarray, sr: int) -> list[dict]:
    """Onset-gated high-register fundamentals via highpass + short-window yin.

    Funk octave leaps are short and quieter than the low sustain, so raw pyin
    locks to the low fundamental. Highpass (~180 Hz) + yin around strong onsets
    recovers MIDI ~43–55 pops that are ~+12 from the simultaneous low pitch.
    Rejects 3rd/4th-harmonic false positives of the low fund.
    """
    try:
        from scipy import signal as sp_signal
    except Exception:
        return []
    hop = 256
    sos = sp_signal.butter(4, 180.0, btype="high", fs=sr, output="sos")
    y_hp = sp_signal.sosfilt(sos, y)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    if len(onset_env) == 0:
        return []
    onset_frames = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=hop, units="frames"
    )
    th = float(np.percentile(onset_env, 55))
    pops: list[dict] = []
    for fr in onset_frames:
        if fr >= len(onset_env) or float(onset_env[fr]) < th:
            continue
        t0 = float(librosa.frames_to_time(fr, sr=sr, hop_length=hop))
        i0 = int(t0 * sr)
        i1 = min(len(y), i0 + int(0.09 * sr))
        if i1 - i0 < 512:
            continue
        seg_hp = y_hp[i0:i1]
        seg_lo = y[i0:i1]
        try:
            f0_hi = librosa.yin(
                seg_hp,
                fmin=librosa.midi_to_hz(40),
                fmax=librosa.midi_to_hz(58),
                sr=sr,
                frame_length=1024,
                hop_length=128,
            )
            f0_lo = librosa.yin(
                seg_lo,
                fmin=librosa.midi_to_hz(28),
                fmax=librosa.midi_to_hz(48),
                sr=sr,
                frame_length=1024,
                hop_length=256,
            )
        except Exception:
            continue
        f0_hi = f0_hi[np.isfinite(f0_hi)]
        f0_lo = f0_lo[np.isfinite(f0_lo)]
        if len(f0_hi) == 0:
            continue
        midi_hi = int(round(float(np.median(librosa.hz_to_midi(f0_hi)))))
        midi_lo = int(round(float(np.median(librosa.hz_to_midi(f0_lo))))) if len(f0_lo) else None
        if midi_hi < 43 or midi_hi > 55:
            continue
        # Prefer real octave leaps (+12±1.2); allow independent mid-high attacks
        keep = False
        if midi_lo is None:
            keep = True
        else:
            delta = midi_hi - midi_lo
            if abs(delta - 12) <= 1.2:
                keep = True
            elif 7 <= delta <= 14:
                # Reject 3rd/4th harmonic of low fund (≈ +19 / +24)
                harm_false = False
                for r in (3, 4, 5):
                    expected = midi_lo + 12.0 * math.log2(r)
                    if abs(midi_hi - expected) < 0.9:
                        harm_false = True
                        break
                keep = not harm_false and midi_hi <= 52
            elif delta <= 2 and 43 <= midi_hi <= 52:
                # Already in upper register at onset
                keep = True
        if not keep:
            continue
        strength = float(onset_env[fr])
        pops.append(
            {
                "t": t0,
                "dur": 0.12,
                "midi": midi_hi,
                "name": midi_name(midi_hi),
                "prob": min(0.99, 0.75 + 0.05 * min(5.0, strength)),
                "lo": midi_lo,
                "kind": "octave_pop",
            }
        )
    # Dedup pops within 40ms — keep higher midi / stronger
    pops.sort(key=lambda p: p["t"])
    dedup: list[dict] = []
    for p in pops:
        if dedup and abs(p["t"] - dedup[-1]["t"]) < 0.04:
            if p["prob"] >= dedup[-1]["prob"]:
                dedup[-1] = p
            continue
        dedup.append(p)
    return dedup


def merge_octave_pops(notes: list[dict], pops: list[dict]) -> list[dict]:
    """Lift or inject high-octave groove notes into the timed note list.

    When a pop lands near an existing low note onset, raise that note by an
    octave (or to the detected high MIDI). Otherwise inject a short high note
    so quantize_to_hits can place it on the 16th grid.
    """
    if not pops:
        return notes
    out = [dict(n) for n in notes]
    used_pop = [False] * len(pops)
    for n in out:
        for i, p in enumerate(pops):
            if used_pop[i]:
                continue
            if abs(float(n["t"]) - float(p["t"])) > 0.06:
                continue
            # Same pitch class or ~octave below the pop → lift
            if n["midi"] == p["midi"] or abs(n["midi"] - (p["midi"] - 12)) <= 1 or abs((n["midi"] % 12) - (p["midi"] % 12)) == 0 and p["midi"] - n["midi"] >= 10:
                n["midi"] = int(p["midi"])
                n["name"] = midi_name(n["midi"])
                n["prob"] = max(float(n.get("prob") or 0), float(p["prob"]))
                used_pop[i] = True
                break
    for i, p in enumerate(pops):
        if used_pop[i]:
            continue
        # Avoid stacking on an already-high note at same time
        if any(abs(float(n["t"]) - float(p["t"])) < 0.05 and n["midi"] >= 43 for n in out):
            continue
        out.append(
            {
                "t": float(p["t"]),
                "dur": float(p["dur"]),
                "midi": int(p["midi"]),
                "name": p["name"],
                "prob": float(p["prob"]),
            }
        )
    out.sort(key=lambda n: n["t"])
    return out

def try_basic_pitch(wav: Path) -> list[dict] | None:
    try:
        from basic_pitch.inference import predict
        from basic_pitch import ICASSP_2022_MODEL_PATH
    except Exception:
        return None
    try:
        _model_out, midi_data, note_events = predict(str(wav), ICASSP_2022_MODEL_PATH)
    except Exception:
        try:
            _model_out, midi_data, note_events = predict(str(wav))
        except Exception:
            return None
    notes = []
    # note_events: list of (start, end, pitch, amplitude, ...)
    for ev in note_events:
        if len(ev) < 3:
            continue
        t0, t1, pitch = float(ev[0]), float(ev[1]), int(round(float(ev[2])))
        amp = float(ev[3]) if len(ev) > 3 else 0.5
        if pitch < 24 or pitch > 60:
            continue
        if t1 - t0 < 0.04 and amp < 0.3:
            continue
        notes.append({"t": t0, "dur": max(0.03, t1 - t0), "midi": pitch, "name": midi_name(pitch), "prob": amp})
    notes.sort(key=lambda n: n["t"])
    return notes


def ioi_stats(notes: list[dict]) -> dict:
    if len(notes) < 2:
        return {"median_ioi_ms": None, "frac_ioi_le_16th": 0.0, "n": len(notes)}
    iois = np.diff([n["t"] for n in notes]) * 1000.0
    return {
        "median_ioi_ms": float(np.median(iois)),
        "p25_ioi_ms": float(np.percentile(iois, 25)),
        "p75_ioi_ms": float(np.percentile(iois, 75)),
        "frac_ioi_le_16th": float(np.mean(iois <= 200)),
        "frac_ioi_le_8th": float(np.mean(iois <= 350)),
        "n": len(notes),
    }


def octave_hist(notes: list[dict]) -> dict:
    c: Counter = Counter()
    for n in notes:
        octv = n["midi"] // 12 - 1
        c[f"oct{octv}"] += 1
    return dict(c)


def shift_octave(notes: list[dict], semitones: int) -> list[dict]:
    out = []
    for n in notes:
        m = n["midi"] + semitones
        if m < 24 or m > 72:
            continue
        nn = dict(n)
        nn["midi"] = m
        nn["name"] = midi_name(m)
        out.append(nn)
    return out


def choose_octave(notes: list[dict], *, prefer_oct2: bool) -> tuple[list[dict], str]:
    """Pick 0 or ±12 shift so mode lands in bass guitar register."""
    if not notes:
        return notes, "empty"
    candidates = [
        (notes, 0, "as-detected"),
        (shift_octave(notes, -12), -12, "down-12"),
        (shift_octave(notes, 12), 12, "up-12"),
    ]
    best = None
    best_score = -1e9
    for cand, shift, label in candidates:
        if not cand:
            continue
        midis = np.array([n["midi"] for n in cand])
        # Ideal electric bass melody register ~ MIDI 28–48 (E1–C3)
        in_range = float(np.mean((midis >= 28) & (midis <= 50)))
        med = float(np.median(midis))
        # prefer median near 36–43 (oct1–low oct2) unless prefer_oct2
        target = 43.0 if prefer_oct2 else 36.0
        med_pen = -abs(med - target) / 12.0
        score = in_range * 3.0 + med_pen + 0.01 * len(cand)
        if prefer_oct2 and 40 <= med <= 48:
            score += 0.5
        if score > best_score:
            best_score = score
            best = (cand, f"{label} (median={med:.1f}, in_range={in_range:.2f})")
    assert best is not None
    return best[0], best[1]


def quantize_to_hits(
    notes: list[dict], bars: list[tuple[float, float]], *, min_vel=1
) -> list[dict]:
    """Map timed notes → {bar, step, midi, durSteps} on 16th grid. Dedupe same bar/step keep longest/highest conf."""
    cell: dict[tuple[int, int], dict] = {}
    for n in notes:
        t = n["t"]
        # find bar
        bar_i = None
        for i, (t0, t1) in enumerate(bars):
            if t0 - 1e-3 <= t < t1:
                bar_i = i
                b0, b1 = t0, t1
                break
        if bar_i is None:
            continue
        period = max(1e-3, b1 - b0)
        frac = (t - b0) / period
        step = int(round(frac * 16))
        if step >= 16:
            # spill to next bar
            if bar_i + 1 < len(bars):
                bar_i += 1
                step = 0
            else:
                step = 15
        if step < 0:
            step = 0
        dur_steps = max(1, int(round(n["dur"] / (period / 16.0))))
        key = (bar_i, step)
        prev = cell.get(key)
        cand = {
            "bar": bar_i,
            "step": step,
            "midi": int(n["midi"]),
            "dur": min(16, dur_steps),
            "prob": float(n.get("prob") or 0),
            "t": t,
        }
        if prev is None or cand["prob"] >= prev.get("prob", 0) or (cand["prob"] == prev.get("prob", 0) and cand["dur"] > prev.get("dur", 0)):
            cell[key] = cand
    hits = []
    for (bar, step) in sorted(cell.keys()):
        h = cell[(bar, step)]
        hits.append({"bar": bar, "step": step, "midi": h["midi"], "dur": h["dur"]})
    return hits


def patterns_from_hits(
    hits: list[dict], secs: list[dict], *, max_pattern_bars: int = 2
) -> dict[str, list]:
    """Build section patterns from absolute hits.

    For player tiling: store first `max_pattern_bars` of each section as step 0..(32-1).
    Also attach full section notes under pattern.sectionNotes (absolute-within-section steps)
    when section longer — player prefers bassHits though.
    """
    patterns: dict[str, list] = {}
    for s in secs:
        sid = s["id"]
        first = int(s["first"])
        end = int(s["end"])
        n_bars = max(1, end - first)
        sec_hits = [h for h in hits if first <= h["bar"] < end]
        # 2-bar window for classic tiling (prefer densest pair)
        best_notes = []
        best_dens = -1
        if n_bars <= max_pattern_bars:
            windows = [(first, end)]
        else:
            windows = [(b, min(b + max_pattern_bars, end)) for b in range(first, end, 1)]
            windows = [(a, b) for a, b in windows if b - a >= 1]
        for a, b in windows:
            local = [h for h in sec_hits if a <= h["bar"] < b]
            dens = len(local)
            # prefer windows with 16th activity
            steps_mod = [h["step"] for h in local]
            sync = sum(1 for st in steps_mod if st % 2 == 1 or st % 4 == 2)
            score = dens + 0.25 * sync
            if score > best_dens:
                best_dens = score
                best_notes = [
                    {
                        "step": (h["bar"] - a) * 16 + h["step"],
                        "midi": h["midi"],
                        "dur": h.get("dur"),
                    }
                    for h in local
                    if (h["bar"] - a) * 16 + h["step"] < max_pattern_bars * 16
                ]
        # full section relative notes (for documentation / future non-tiling)
        section_notes = [
            {
                "step": (h["bar"] - first) * 16 + h["step"],
                "midi": h["midi"],
                "dur": h.get("dur"),
            }
            for h in sec_hits
        ]
        name = f"{sid} AMT line"
        if not best_notes:
            pat = {
                "id": f"{sid}_bass",
                "name": f"{sid} (rest)",
                "notes": [],
                "amt": True,
                "tiling": "empty",
            }
        else:
            pat = {
                "id": f"{sid}_bass",
                "name": name,
                "notes": best_notes,
                "amt": True,
                "tiling": "2bar-from-densest",
                "sectionNotes": section_notes,
                "sectionBars": [first, end - 1],
            }
        patterns[sid] = [pat]
        # also by kind for player fallbacks
        kind = s.get("kind")
        if kind and kind not in patterns:
            patterns[kind] = [dict(pat, id=f"{kind}_bass")]
    return patterns


def score_method(notes: list[dict], onset_count: int) -> float:
    if not notes:
        return -1e9
    st = ioi_stats(notes)
    n = len(notes)
    # Prefer onset-count agreement; stop rewarding hectic 16th density / raw note count
    onset_agree = 1.0 - min(1.0, abs(n - max(onset_count, 1)) / max(onset_count, 1))
    med = st.get("median_ioi_ms") or 999
    frac16 = st.get("frac_ioi_le_16th") or 0
    quarter_lock_pen = 1.0 if 450 <= med <= 550 and frac16 < 0.05 else 0.0
    # Mild density penalty when notes ≫ onsets (wobble micro-splits)
    over_dense = max(0.0, (n - max(onset_count, 1)) / max(onset_count, 1))
    # Small bonus for having some syncopation without requiring dense 16ths
    sync_bonus = 0.35 if 0.1 <= frac16 <= 0.7 else 0.0
    return onset_agree * 3.0 + sync_bonus - quarter_lock_pen * 3.0 - over_dense * 1.5


def transcribe(
    bass_wav: Path,
    beat_path: Path,
    *,
    secs: list[dict] | None = None,
    nbars: int | None = None,
    prefer_oct2: bool = False,
    try_bp: bool = True,
) -> dict:
    beat = load_beat(beat_path)
    grid = beat.get("grid") or {}
    if nbars is None:
        nbars = int(grid.get("nbars") or max(1, len(beat.get("downbeats") or []) - 1))
    y, sr = librosa.load(str(bass_wav), sr=22050, mono=True)
    # onset reference
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time")
    onset_count = int(len(onsets))

    pyin = pyin_notes(y, sr)
    pops = detect_octave_pops(y, sr)
    pyin_dual = merge_octave_pops(pyin, pops)
    methods = {"pyin": pyin_dual}
    if try_bp:
        bp = try_basic_pitch(bass_wav)
        if bp is not None:
            methods["basic-pitch"] = bp

    scored = []
    for name, notes in methods.items():
        notes2, oct_label = choose_octave(notes, prefer_oct2=prefer_oct2)
        sc = score_method(notes2, onset_count)
        # Dual-band octave pops are intentional high-register adds — small bonus
        if name == "pyin" and pops:
            sc += 0.15
        scored.append((sc, name, notes2, oct_label, notes))
    # Evidence-only: low-only pyin (no octave pops) for before/after comparison
    low2, low_ol = choose_octave(pyin, prefer_oct2=prefer_oct2)
    scored_evidence = list(scored)
    scored_evidence.append((score_method(low2, onset_count), "pyin-low-only", low2, low_ol, pyin))

    scored.sort(key=lambda x: -x[0])
    best_score, method, notes, oct_label, raw_notes = scored[0]

    bars = bar_times(beat, nbars)
    hits = quantize_to_hits(notes, bars)

    if secs is None:
        secs = [{"id": "all", "kind": "verse", "first": 0, "end": nbars}]
    patterns = patterns_from_hits(hits, secs)

    comparison = {}
    for sc, name, notes2, ol, raw in scored_evidence:
        comparison[name] = {
            "score": round(sc, 3),
            "note_count_raw": len(raw),
            "note_count_octave_fixed": len(notes2),
            "octave_choice": ol,
            "octave_hist": octave_hist(notes2),
            "ioi": ioi_stats(notes2),
        }

    return {
        "schema": "bass.amt.v1",
        "method": method,
        "methodEvidence": comparison,
        "octaveFix": oct_label,
        "onsetCount": onset_count,
        "noteCount": len(notes),
        "hitCount": len(hits),
        "notes": notes,  # timed
        "bassHits": hits,
        "patterns": patterns,
        "octavePopCount": len(pops),
        "analysis": (
            f"AMT on stems/bass.wav via {method} "
            f"(librosa.pyin + dual-band octave-pop" + (" + basic-pitch compare" if "basic-pitch" in methods else "") + "); "
            f"octave {oct_label}; {len(pops)} octave pops; quantized to beat.json 16ths; absolute bassHits"
        ),
        "bpm": float(grid.get("bpm") or beat.get("bpm") or beat.get("bpm_hint") or 0),
        "nbars": nbars,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bass", type=Path, required=True)
    ap.add_argument("--beat", type=Path, required=True)
    ap.add_argument("--demo", type=Path, help="demo-data.json or study/resource.json for secs")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--prefer-oct2", action="store_true")
    ap.add_argument("--no-basic-pitch", action="store_true")
    ap.add_argument("--nbars", type=int, default=None)
    args = ap.parse_args()

    secs = None
    nbars = args.nbars
    if args.demo and args.demo.exists():
        demo = json.loads(args.demo.read_text())
        secs = demo.get("secs")
        if nbars is None:
            nbars = demo.get("nbars")

    result = transcribe(
        args.bass,
        args.beat,
        secs=secs,
        nbars=nbars,
        prefer_oct2=args.prefer_oct2,
        try_bp=not args.no_basic_pitch,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2))
    print(json.dumps({
        "out": str(args.out),
        "method": result["method"],
        "octaveFix": result["octaveFix"],
        "hitCount": result["hitCount"],
        "noteCount": result["noteCount"],
        "evidence": result["methodEvidence"],
    }, indent=2))


if __name__ == "__main__":
    main()
