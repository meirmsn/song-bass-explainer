#!/usr/bin/env python3
"""
Generic procedural analysis for bass-study jobs (non-LAP path).

Uses librosa: beat/BPM, bar grid, crude chroma chords + bass-per-beat,
simple sectioning, and a generic semantic card writer from measured features.
When faster-whisper is available (see whisper_transcribe.py), non-LAP jobs also
get lyric segments and gap-based section refinement stored in analysis/transcription.json.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import librosa
import numpy as np

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
ENH = {"C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb"}


def nm(pc: str) -> str:
    return ENH.get(pc, pc)


def chord_templates() -> tuple[np.ndarray, list[str]]:
    labs = []
    mats = []
    for r in range(12):
        for qual, iv in (("", [0, 4, 7]), ("m", [0, 3, 7])):
            v = np.zeros(12)
            for i in iv:
                v[(r + i) % 12] = 1.0
            v /= np.linalg.norm(v) + 1e-9
            mats.append(v)
            labs.append(nm(NOTE_NAMES[r]) + qual)
    return np.stack(mats), labs


TEMPLATES, TEMPLATE_LABS = chord_templates()


def estimate_key(chroma_mean: np.ndarray) -> str:
    # Major/minor profiles (Krumhansl-ish simplified)
    maj = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    c = chroma_mean / (np.linalg.norm(chroma_mean) + 1e-9)
    best = ("C", -1.0)
    for r in range(12):
        for name, prof in ((NOTE_NAMES[r], maj), (NOTE_NAMES[r] + "m", minor)):
            p = np.roll(prof, r)
            p = p / (np.linalg.norm(p) + 1e-9)
            score = float(np.dot(c, p))
            if score > best[1]:
                best = (nm(name.replace("m", "")) + ("m" if name.endswith("m") else ""), score)
    return best[0]


def beat_track(y: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time")
    tempo_f = float(np.atleast_1d(tempo)[0])
    beats = np.asarray(beats, dtype=float)
    if len(beats) < 4:
        # fallback fixed grid from onset tempo
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        tempo_f = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=onset_env, sr=sr))[0])
        period = 60.0 / max(tempo_f, 1.0)
        dur = len(y) / sr
        beats = np.arange(0.0, dur, period)
    return tempo_f, beats


def bars_from_beats(beats: np.ndarray, duration: float, beats_per_bar: int = 4) -> list[dict]:
    if len(beats) == 0:
        return [{"bar": 0, "t": 0.0, "beat_times": [0.0]}]
    bars = []
    n = len(beats)
    periods = np.diff(beats)
    med_p = float(np.median(periods)) if len(periods) else 0.5
    # Back-fill from t=0 when tracker locks late (silence / fade-in).
    beats = np.asarray(beats, dtype=float)
    if beats[0] > 0.75 and med_p > 0:
        pre = []
        t = float(beats[0]) - med_p
        while t >= -1e-6:
            pre.append(max(0.0, t))
            t -= med_p
        beats = np.unique(np.concatenate([pre[::-1], beats]))
        n = len(beats)
    bi = 0
    bar_i = 0
    while True:
        start = float(beats[bi]) if bi < n else float(beats[-1] + (bi - (n - 1)) * med_p)
        if start >= duration - 1e-3 and bar_i > 0:
            break
        beat_times = []
        for k in range(beats_per_bar):
            idx = bi + k
            if idx < n:
                beat_times.append(float(beats[idx]))
            else:
                beat_times.append(float(beats[-1] + (idx - (n - 1)) * med_p))
        bars.append({"bar": bar_i, "t": round(beat_times[0], 3), "beat_times": [round(x, 3) for x in beat_times]})
        bi += beats_per_bar
        bar_i += 1
        if bar_i > 512:
            break
        if bi >= n and beat_times[0] + med_p * beats_per_bar >= duration:
            # one more end marker bar time only
            break
    # end sentinel
    bars.append({"bar": bar_i, "t": round(duration, 3), "beat_times": []})
    return bars


def chroma_series(y: np.ndarray, sr: int, hop: int = 512) -> tuple[np.ndarray, np.ndarray]:
    yh = librosa.effects.harmonic(y)
    C = np.abs(
        librosa.cqt(
            yh,
            sr=sr,
            hop_length=hop,
            fmin=librosa.note_to_hz("C1"),
            n_bins=72,
            bins_per_octave=12,
        )
    )
    chroma = np.zeros((12, C.shape[1]))
    for i in range(C.shape[0]):
        chroma[i % 12] += C[i]
    chroma = librosa.util.normalize(chroma, axis=0)
    times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=hop)
    return chroma, times


def bass_chroma(y: np.ndarray, sr: int, hop: int = 512) -> np.ndarray:
    yh = librosa.effects.harmonic(y)
    C = np.abs(
        librosa.cqt(
            yh,
            sr=sr,
            hop_length=hop,
            fmin=librosa.note_to_hz("C1"),
            n_bins=36,
            bins_per_octave=12,
        )
    )
    # C1..B3 roughly
    chroma = np.zeros((12, C.shape[1]))
    for i in range(C.shape[0]):
        chroma[i % 12] += C[i]
    return librosa.util.normalize(chroma, axis=0)


def avg_chroma(chroma: np.ndarray, times: np.ndarray, t0: float, t1: float) -> np.ndarray:
    m = (times >= t0) & (times < t1)
    if not np.any(m):
        # nearest frame
        i = int(np.argmin(np.abs(times - t0)))
        return chroma[:, i]
    v = chroma[:, m].mean(axis=1)
    return v / (np.linalg.norm(v) + 1e-9)


def best_chord(vec: np.ndarray) -> str:
    v = vec / (np.linalg.norm(vec) + 1e-9)
    scores = TEMPLATES @ v
    return TEMPLATE_LABS[int(np.argmax(scores))]


def segment_sections(nbars: int, duration: float, bars: list[dict], y: np.ndarray, sr: int) -> list[dict]:
    """Crude sections: energy + chroma self-similarity boundaries, else even chunks."""
    if nbars <= 1:
        return [{"id": "a", "name": "A", "first": 0, "end": max(nbars, 1), "kind": "body", "ci": 0}]
    # Prefer ~4-bar chunks, merge tiny remainder
    chunk = 4 if nbars >= 8 else max(1, nbars // 2 or 1)
    secs = []
    kinds_cycle = ["intro", "body", "body", "bridge", "tag"]
    i = 0
    si = 0
    while i < nbars:
        end = min(nbars, i + chunk)
        if nbars - end < 2 and end < nbars:
            end = nbars
        kind = kinds_cycle[min(si, len(kinds_cycle) - 1)]
        if i == 0:
            kind = "intro"
        if end >= nbars and si > 0:
            kind = "tag" if nbars >= 3 else kind
        name = { "intro": "Intro", "body": f"Section {si}", "bridge": "Bridge", "tag": "Outro" }.get(kind, f"Sec {si}")
        if kind == "body":
            name = f"A{si}" if si <= 1 else f"B{si}"
        secs.append(
            {
                "id": f"s{si}",
                "name": name,
                "first": i,
                "end": end,
                "kind": kind if kind != "body" else "verse",
                "ci": si % 8,
            }
        )
        i = end
        si += 1
    # Energy-based rename: if first section is very quiet relative to peak, keep Intro
    return secs



def _maybe_transcribe(
    wav_path: Path,
    *,
    bars_meta: list[dict],
    nbars: int,
    duration: float,
    secs: list[dict],
    job_id: str | None,
    out_dir: Path | None,
    vocals_path: Path | None,
) -> tuple[dict, list[dict], dict | None]:
    """Run Whisper when available; refine secs from lyric gaps."""
    import sys

    scripts_dir = Path(__file__).resolve().parent
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from whisper_transcribe import (
            map_segments_to_sections,
            resolve_audio_for_transcription,
            run_transcription,
            skipped_transcription,
        )
    except Exception as e:
        return (
            {
                "schema": "bass.transcription.v1",
                "status": "skipped",
                "note": f"whisper_transcribe import failed: {e}",
                "segments": [],
                "jobId": job_id,
            },
            secs,
            None,
        )

    audio = vocals_path if vocals_path and Path(vocals_path).exists() else None
    if audio is None:
        audio = resolve_audio_for_transcription(out_dir, Path(wav_path))
    # Cap very long tracks for CPU box (override with BASS_WHISPER_MAX_SECONDS)
    import os

    max_s = os.environ.get("BASS_WHISPER_MAX_SECONDS")
    max_seconds = float(max_s) if max_s else None
    try:
        transcription = run_transcription(
            Path(audio), job_id=job_id, max_seconds=max_seconds
        )
    except Exception as e:
        return skipped_transcription(job_id, note=str(e)), secs, None

    meta = {
        "audio": str(audio),
        "status": transcription.get("status"),
        "segments": len(transcription.get("segments") or []),
    }
    segs = transcription.get("segments") or []
    if transcription.get("status") == "ok" and segs:
        mapped = map_segments_to_sections(
            segs, bars_meta, nbars, duration=duration
        )
        if mapped and len(mapped) >= 2:
            secs = mapped
            meta["sectionsFromWhisper"] = True
            meta["sectionCount"] = len(secs)
        else:
            meta["sectionsFromWhisper"] = False
    return transcription, secs, meta


def analyze_wav(
    wav_path: Path,
    *,
    title: str | None = None,
    artist: str | None = None,
    job_id: str | None = None,
    out_dir: Path | None = None,
    vocals_path: Path | None = None,
) -> dict[str, Any]:
    y, sr = librosa.load(str(wav_path), sr=22050, mono=True)
    duration = float(len(y) / sr)
    tempo, beats = beat_track(y, sr)
    bars_meta = bars_from_beats(beats, duration, 4)
    nbars = max(0, len(bars_meta) - 1)  # exclude end sentinel

    chroma, times = chroma_series(y, sr)
    bchroma = bass_chroma(y, sr)
    key = estimate_key(chroma.mean(axis=1))

    raw = []
    for b in bars_meta[:-1]:
        beat_times = b["beat_times"]
        if len(beat_times) < 4:
            # pad
            while len(beat_times) < 4:
                beat_times.append(beat_times[-1] + 60.0 / max(tempo, 1.0) if beat_times else b["t"])
        bass_notes = []
        for k in range(4):
            t0 = beat_times[k]
            t1 = beat_times[k + 1] if k + 1 < 4 else (bars_meta[b["bar"] + 1]["t"] if b["bar"] + 1 < len(bars_meta) else duration)
            bv = avg_chroma(bchroma, times, t0, max(t1, t0 + 0.05))
            bass_notes.append(nm(NOTE_NAMES[int(np.argmax(bv))]))
        cv = avg_chroma(chroma, times, beat_times[0], bars_meta[b["bar"] + 1]["t"] if b["bar"] + 1 < len(bars_meta) else duration)
        chord = best_chord(cv)
        raw.append([b["bar"], round(b["t"], 2), chord, ".".join(bass_notes)])

    # end row like demo-data
    if bars_meta:
        raw.append([bars_meta[-1]["bar"], round(bars_meta[-1]["t"], 2), "", ""])

    secs = segment_sections(nbars, duration, bars_meta, y, sr)

    # Whisper (optional): richer lyrics + section cues for non-LAP
    transcription, secs, lyric_meta = _maybe_transcribe(
        wav_path,
        bars_meta=bars_meta,
        nbars=nbars,
        duration=duration,
        secs=secs,
        job_id=job_id,
        out_dir=out_dir,
        vocals_path=vocals_path,
    )

    beat_json = {
        "schema": "bass.beat.v1",
        "status": "ok",
        "source": "librosa.beat.beat_track",
        "bpm": round(tempo, 2),
        "beats": [round(float(x), 4) for x in beats.tolist()],
        "downbeats": [round(float(bars_meta[i]["t"]), 4) for i in range(0, nbars)],
        "time_sig": "4/4",
        "duration": round(duration, 3),
        "jobId": job_id,
    }

    procedural = {
        "schema": "bass.procedural.v1",
        "status": "ok",
        "title": title or (job_id or "untitled"),
        "artist": artist or "unknown",
        "bpm": int(round(tempo)),
        "timeSig": "4/4",
        "keys": key,
        "duration": round(duration, 3),
        "nbars": nbars,
        "raw": raw,
        "secs": secs,
        "source": "scripts/analyze_audio.py (librosa)",
        "confidence": "low-medium — chroma chord/bass estimates; auto sections",
        "jobId": job_id,
    }

    # RMS / activity for semantic feel
    rms = librosa.feature.rms(y=y)[0]
    rms_db = 20 * np.log10(np.mean(rms) + 1e-9)
    brightness = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))

    semantic = build_semantic(procedural, rms_db=rms_db, brightness=brightness)

    if transcription.get("status") == "ok" and transcription.get("segments"):
        from whisper_transcribe import enrich_semantic_with_lyrics

        semantic = enrich_semantic_with_lyrics(
            semantic, transcription, secs, bars_meta, nbars
        )
        procedural["secs"] = secs
        procedural["source"] = (
            procedural.get("source", "scripts/analyze_audio.py") + " + whisper sections"
        )
        if lyric_meta:
            procedural["whisper"] = lyric_meta

    return {
        "beat": beat_json,
        "procedural": procedural,
        "semantic": semantic,
        "transcription": transcription,
    }


def build_semantic(proc: dict, *, rms_db: float, brightness: float) -> dict:
    """Generic cards/patterns from measured procedural — not song-specific lore."""
    bpm = proc.get("bpm") or 0
    key = proc.get("keys") or "?"
    secs = proc.get("secs") or []
    raw = proc.get("raw") or []

    feel_tempo = "slow" if bpm < 90 else ("medium" if bpm < 120 else "uptempo")
    dens = "sparse/ambient" if rms_db < -35 else ("moderate" if rms_db < -20 else "dense")
    bright = "dark/warm" if brightness < 1500 else ("balanced" if brightness < 3000 else "bright")

    # chord histogram
    chords = [r[2] for r in raw if len(r) > 2 and r[2]]
    from collections import Counter

    top = Counter(chords).most_common(5)

    cards_by_kind: dict[str, list] = {}
    patterns: dict[str, list] = {}

    # Default minimal pedal-ish pattern (root guess from key)
    root_pc = key.replace("m", "")
    midi_root = 36 + NOTE_NAMES.index(root_pc) if root_pc in NOTE_NAMES else 36 + ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"].index(root_pc) if root_pc in ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"] else 38
    # enh map back
    enh_to_pc = {v: k for k, v in ENH.items()}
    if root_pc in enh_to_pc:
        midi_root = 36 + NOTE_NAMES.index(enh_to_pc[root_pc])
    elif root_pc in NOTE_NAMES:
        midi_root = 36 + NOTE_NAMES.index(root_pc)
    else:
        midi_root = 38

    def pedal_pat(mid):
        notes = []
        for step in range(0, 32, 2):
            notes.append({"step": step, "midi": mid})
        return {"id": "pedal", "name": f"Pedal on {root_pc}", "notes": notes}

    def root_five(mid):
        notes = []
        for bar_off in (0, 16):
            for i, m in enumerate([mid, mid, mid + 7, mid]):
                notes.append({"step": bar_off + i * 4, "midi": m if m <= 60 else mid})
        return {"id": "r5", "name": "Root–5 outline", "notes": notes}

    base_pats = [pedal_pat(midi_root), root_five(midi_root)]

    for s in secs:
        kind = s.get("kind") or "verse"
        # section-local chords
        local = [r[2] for r in raw if len(r) > 2 and r[2] and s["first"] <= r[0] < s["end"]]
        local_top = Counter(local).most_common(3)
        chord_txt = ", ".join(f"{c}×{n}" for c, n in local_top) or "unclear"
        cards_by_kind[kind] = [
            {
                "label": "Drums",
                "body": f"Auto-grid {bpm} BPM 4/4 ({feel_tempo}). Kit not separated in this pass — listen for pulse against the bar line.",
            },
            {
                "label": "Bass",
                "body": f"Estimated bass PC per beat from low chroma. Try a {root_pc} pedal or root–5 outline; verify by ear (confidence low-medium).",
            },
            {
                "label": "Harmony",
                "body": f"Key guess {key}. This section chroma favors: {chord_txt}. Labels are template matches, not human transcription.",
            },
            {
                "label": "Feel",
                "body": f"{dens}, {bright} spectrum. Section bars {s['first']}–{s['end'] - 1}. Use Mute Bass (private) to check the estimate.",
            },
        ]
        patterns[s["id"]] = base_pats

    # also key by kind for player CARDS_EFF which indexes by sec.kind
    # already keyed by kind; patterns in player use sec.id — provide both
    for s in secs:
        patterns.setdefault(s["id"], base_pats)

    return {
        "schema": "bass.semantic.v1",
        "status": "ok",
        "source": "generic analyzer (librosa features + heuristics)",
        "song": proc.get("title"),
        "artist": proc.get("artist"),
        "cards": cards_by_kind,
        "patterns": patterns,
        "global": {
            "bpm": bpm,
            "key_guess": key,
            "tempo_feel": feel_tempo,
            "density": dens,
            "timbre": bright,
            "top_chords": top,
        },
        "confidence": "low-medium — automatic; not song-specific lore",
        "web": None,
    }


def write_analysis(out_dir: Path, result: dict) -> list[str]:
    ad = out_dir / "analysis"
    ad.mkdir(parents=True, exist_ok=True)
    written = []
    for name in ("beat", "procedural", "semantic", "transcription"):
        path = ad / f"{name}.json"
        path.write_text(json.dumps(result[name], indent=2))
        written.append(path.name)
    return written


def merge_study(out_dir: Path, job_id: str | None = None) -> Path:
    proc = json.loads((out_dir / "analysis" / "procedural.json").read_text())
    sem = json.loads((out_dir / "analysis" / "semantic.json").read_text())
    has_m4a = (out_dir / "stems" / "bass.m4a").exists() and (out_dir / "stems" / "no_bass.m4a").exists()
    has_wav = (out_dir / "stems" / "bass.wav").exists() and (out_dir / "stems" / "no_bass.wav").exists()
    stems = {
        "available": has_m4a or has_wav,
        "access": "private",
        "muteBassSupported": has_m4a or has_wav,
        "format": "aac" if has_m4a else ("wav" if has_wav else None),
    }
    if job_id:
        ext = "m4a" if has_m4a else "wav"
        prefix = f"/private/api/jobs/{job_id}/stems"
        stems.update(
            {
                "bass": f"{prefix}/bass.{ext}",
                "no_bass": f"{prefix}/no_bass.{ext}",
                "other": f"{prefix}/other.wav",
                "bass_wav": f"{prefix}/bass.wav",
                "no_bass_wav": f"{prefix}/no_bass.wav",
            }
        )
    tr_path = out_dir / "analysis" / "transcription.json"
    transcription_summary = None
    if tr_path.exists():
        try:
            tr = json.loads(tr_path.read_text())
            transcription_summary = {
                "status": tr.get("status"),
                "source": tr.get("source"),
                "model": tr.get("model"),
                "segmentCount": len(tr.get("segments") or []),
                "path": "analysis/transcription.json",
            }
        except Exception:
            transcription_summary = None
    resource = {
        "schema": "bass.study.v1",
        "title": proc.get("title"),
        "artist": proc.get("artist"),
        "bpm": proc.get("bpm"),
        "timeSig": proc.get("timeSig"),
        "keys": proc.get("keys"),
        "duration": proc.get("duration"),
        "nbars": proc.get("nbars"),
        "raw": proc.get("raw"),
        "secs": proc.get("secs"),
        "cards": sem.get("cards"),
        "patterns": sem.get("patterns"),
        "stems": stems,
        "semantic": {"schema": sem.get("schema"), "source": sem.get("source"), "confidence": sem.get("confidence")},
        "transcription": transcription_summary,
        "merge": {
            "procedural_only": False,
            "waiting_bot": False,
            "report": "analysis/merge-report.json",
        },
    }
    report = {
        "rules": "procedural wins timing; semantic wins cards/patterns/language",
        "conflicts": [],
        "notes": ["Generic auto-merge from analyze_audio.py"],
    }
    (out_dir / "analysis" / "merge-report.json").write_text(json.dumps(report, indent=2))
    sd = out_dir / "study"
    sd.mkdir(exist_ok=True)
    out = sd / "resource.json"
    out.write_text(json.dumps(resource, indent=2))
    return out


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--out", required=True)
    ap.add_argument("--title")
    ap.add_argument("--artist")
    ap.add_argument("--job-id")
    ap.add_argument("--vocals", help="Optional vocals stem for Whisper (else stems/vocals.wav or mix)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    vocals = Path(args.vocals) if getattr(args, "vocals", None) else None
    res = analyze_wav(
        Path(args.wav),
        title=args.title,
        artist=args.artist,
        job_id=args.job_id,
        out_dir=out,
        vocals_path=vocals,
    )
    write_analysis(out, res)
    merge_study(out, args.job_id)
    print(json.dumps({"bpm": res["procedural"]["bpm"], "nbars": res["procedural"]["nbars"], "keys": res["procedural"]["keys"], "secs": len(res["procedural"]["secs"])}, indent=2))
