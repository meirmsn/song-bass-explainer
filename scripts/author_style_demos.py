#!/usr/bin/env python3
"""Author Radio Pop + Backbeat Rock MIDI, hits, stems, and study JSON.

Pipeline (same as Pocket Funk):
  style_demos.write_midi  →  scripts/midi_to_hits.convert  →  build_style_demo
  FluidSynth / FluidR3_GM renders bass, drums, other; ffmpeg mixes no_bass and AAC.
"""
from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from build_demo_data import build_style_demo  # noqa: E402
from midi_to_hits import convert  # noqa: E402
from style_demos import SF2, SONGS, song_dir, write_midi  # noqa: E402

GAIN = {"bass": "1.15", "drums": "0.85", "other": "0.72"}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def render_wav(midi: Path, wav: Path, gain: str):
    wav.parent.mkdir(parents=True, exist_ok=True)
    if not SF2.is_file():
        raise SystemExit(f"soundfont missing: {SF2}")
    subprocess.run(
        ["fluidsynth", "-ni", "-F", str(wav), "-r", "44100", "-g", gain, str(SF2), str(midi)],
        check=True,
        capture_output=True,
    )


def ffmpeg(args):
    subprocess.run(["ffmpeg", "-y", *args], check=True, capture_output=True)


def trim_wav(src: Path, dst: Path, duration: float):
    ffmpeg(["-i", str(src), "-t", f"{duration:.3f}", "-c:a", "pcm_s16le", str(dst)])


def to_m4a(wav: Path, m4a: Path):
    ffmpeg(["-i", str(wav), "-c:a", "aac", "-b:a", "192k", str(m4a)])


def mix_no_bass(drums: Path, other: Path, out: Path, duration: float):
    ffmpeg([
        "-i", str(drums), "-i", str(other),
        "-filter_complex",
        "[0:a]volume=0.95[d];[1:a]volume=0.9[o];"
        "[d][o]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.97",
        "-t", f"{duration:.3f}",
        "-c:a", "pcm_s16le", str(out),
    ])


def peak_db(wav: Path) -> float:
    proc = subprocess.run(
        ["ffmpeg", "-i", str(wav), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    for line in (proc.stderr or "").splitlines():
        if "max_volume:" in line:
            return float(line.split("max_volume:")[1].strip().split()[0])
    raise SystemExit(f"no max_volume for {wav}\n{proc.stderr[-400:]}")


def build_one(slug: str):
    song = SONGS[slug]
    out = song_dir(song)
    source = out / "source"
    stems = out / "stems"
    analysis = out / "analysis"
    source.mkdir(parents=True, exist_ok=True)
    analysis.mkdir(parents=True, exist_ok=True)
    if stems.exists():
        shutil.rmtree(stems)
    stems.mkdir()

    full = source / f"{slug}.mid"
    write_midi(full, song)
    hits = convert(full, bass_track="bass")
    hits_path = analysis / "midi_hits.json"
    hits_path.write_text(__import__("json").dumps(hits, indent=2))
    print(
        f"{slug} midi bars={hits['nbars']} bpm={hits['bpm']} "
        f"bass={hits['bassHitCount']} drums={hits['drumHitCount']}",
        flush=True,
    )

    duration = float(song["duration"])
    tmp = out / "_render"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    parts = {
        "bass": dict(include_bass=True, include_drums=False, include_harm=False),
        "drums": dict(include_bass=False, include_drums=True, include_harm=False),
        "other": dict(include_bass=False, include_drums=False, include_harm=True),
    }
    raw_wav = {}
    for name, flags in parts.items():
        midi = tmp / f"{name}.mid"
        write_midi(midi, song, **flags)
        wav = tmp / f"{name}.wav"
        print(f"  fluidsynth {slug} {name}", flush=True)
        render_wav(midi, wav, GAIN[name])
        trimmed = stems / f"{name}.wav"
        trim_wav(wav, trimmed, duration)
        peak = peak_db(trimmed)
        if peak < -45:
            raise SystemExit(f"{slug} {name} looks silent (max_volume {peak} dB)")
        print(f"  {name} peak {peak} dB", flush=True)
        raw_wav[name] = trimmed
        to_m4a(trimmed, stems / f"{name}.m4a")

    no_bass = stems / "no_bass.wav"
    mix_no_bass(raw_wav["drums"], raw_wav["other"], no_bass, duration)
    nb_peak = peak_db(no_bass)
    if nb_peak < -45:
        raise SystemExit(f"{slug} no_bass silent ({nb_peak} dB)")
    to_m4a(no_bass, stems / "no_bass.m4a")
    shutil.rmtree(tmp)

    demo = build_style_demo(slug)
    demo_path = out / "demo-data.json"
    ship = out / "SHIP.md"
    extra = (
        f"\n## Files\n"
        f"- MIDI sha256: `{sha256(full)}`\n"
        f"- study sha256: `{sha256(demo_path)}`\n"
        f"- bassHits {len(demo['bassHits'])} · drumHits {len(demo['drumHits'])}\n"
    )
    ship.write_text(ship.read_text() + extra)
    print(f"{slug} study bars={demo['nbars']} dur={demo['duration']}", flush=True)


def main(argv):
    slugs = argv or list(SONGS)
    unknown = [s for s in slugs if s not in SONGS]
    if unknown:
        raise SystemExit(f"unknown slug(s): {unknown}; choose from {list(SONGS)}")
    for slug in slugs:
        build_one(slug)


if __name__ == "__main__":
    main(sys.argv[1:])
