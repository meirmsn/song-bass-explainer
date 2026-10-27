#!/usr/bin/env python3
"""MIDI → bassHits / drumHits matching the Song Bass Explainer player schema.

bassHits: {bar, step, midi, dur}   — step is 16th within a 4/4-equivalent bar (0..15)
drumHits: {bar, step, kind, midi}  — kind in kick|snare|hat|tom|crash|ride

Handles:
  - Explicit bass track / channel
  - Piano LH ("down:") as bass (Maple Leaf style), optional pitch ceiling
  - GM channel-10 drums → kind map
  - 2/4 (and other) scores by pairing beats into 4/4-equivalent bars so the
    player’s hard-coded 16-steps-per-bar grid stays honest.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

try:
    import mido
except ImportError as e:  # pragma: no cover
    raise SystemExit("mido required: pip install mido") from e

DRUM_KIND = {
    35: "kick",
    36: "kick",
    38: "snare",
    40: "snare",
    37: "snare",  # side stick → snare bucket
    41: "tom",
    43: "tom",
    45: "tom",
    47: "tom",
    48: "tom",
    50: "tom",
    42: "hat",
    44: "hat",
    46: "hat",
    49: "crash",
    57: "crash",
    51: "ride",
    53: "ride",
    59: "ride",
}

BASS_PROGRAMS = {32, 33, 34, 35, 36, 37, 38, 39}  # GM bass family


def _tempo_bpm(tempo_us: int) -> float:
    return 60_000_000.0 / tempo_us


def _collect_events(mid: mido.MidiFile):
    """Absolute-tick note events + tempo/timesig map."""
    tpq = mid.ticks_per_beat
    # Merge tracks keeping track index / name / channel
    track_meta = []
    for i, tr in enumerate(mid.tracks):
        name = next((m.name for m in tr if m.type == "track_name"), f"track{i}")
        track_meta.append({"index": i, "name": name})

    # Absolute ticks per track
    notes = []  # {start, end, midi, vel, channel, track, name}
    tempo_map = []  # (tick, tempo_us)
    timesig_map = []  # (tick, num, den)

    for ti, tr in enumerate(mid.tracks):
        t = 0
        active = {}  # (ch, note) -> (start_tick, vel)
        name = track_meta[ti]["name"]
        for msg in tr:
            t += msg.time
            if msg.type == "set_tempo":
                tempo_map.append((t, msg.tempo))
            elif msg.type == "time_signature":
                timesig_map.append((t, msg.numerator, msg.denominator))
            elif msg.type == "note_on" and msg.velocity > 0:
                active[(msg.channel, msg.note)] = (t, msg.velocity)
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                key = (msg.channel, msg.note)
                if key in active:
                    start, vel = active.pop(key)
                    notes.append(
                        {
                            "start": start,
                            "end": t,
                            "midi": msg.note,
                            "vel": vel,
                            "channel": msg.channel,
                            "track": ti,
                            "name": name,
                        }
                    )
        # dangling notes
        for (ch, note), (start, vel) in active.items():
            notes.append(
                {
                    "start": start,
                    "end": t,
                    "midi": note,
                    "vel": vel,
                    "channel": ch,
                    "track": ti,
                    "name": name,
                }
            )

    if not tempo_map:
        tempo_map = [(0, 500000)]
    if not timesig_map:
        timesig_map = [(0, 4, 4)]
    tempo_map.sort()
    timesig_map.sort()
    # Prefer the last tempo/timesig declared at tick 0 (authors often emit after defaults).
    return notes, tempo_map, timesig_map, tpq, track_meta


def _value_at(map_, tick):
    v = map_[0]
    for item in map_:
        if item[0] <= tick:
            v = item
        else:
            break
    return v


def _ticks_to_seconds(tick: int, tempo_map, tpq: int) -> float:
    """Integrate tempo map up to tick."""
    if tick <= 0:
        return 0.0
    # Build segments
    points = sorted({0, tick, *[t for t, _ in tempo_map if t < tick]})
    sec = 0.0
    for i in range(len(points) - 1):
        a, b = points[i], points[i + 1]
        tempo = _value_at(tempo_map, a)[1]
        sec += (b - a) * (tempo / 1_000_000.0) / tpq
    # final partial if tick beyond last point (tick is in points)
    return sec


def _classify_tracks(notes, track_meta, bass_track=None, bass_channel=None, drums_channel=9):
    """Decide which notes are bass vs drums vs other."""
    by_track = defaultdict(list)
    for n in notes:
        by_track[n["track"]].append(n)

    bass_tracks = set()
    drum_channels = {drums_channel}

    if bass_track is not None:
        # by name substring or index
        for tm in track_meta:
            if str(bass_track) == str(tm["index"]) or str(bass_track).lower() in tm["name"].lower():
                bass_tracks.add(tm["index"])
    else:
        # Heuristics: name contains bass / down; or bass program channels (we don't track programs per note easily)
        for tm in track_meta:
            nm = tm["name"].lower()
            if any(k in nm for k in ("bass", "down", "lh", "left")):
                bass_tracks.add(tm["index"])
        # channel override
        if bass_channel is not None:
            pass  # filtered later

    return bass_tracks, drum_channels


def convert(
    mid_path: Path,
    *,
    bass_track: str | None = None,
    bass_channel: int | None = None,
    drums_channel: int = 9,
    bass_max_midi: int | None = None,
    force_4_4: bool = True,
) -> dict:
    mid = mido.MidiFile(str(mid_path))
    notes, tempo_map, timesig_map, tpq, track_meta = _collect_events(mid)
    bass_tracks, drum_channels = _classify_tracks(
        notes, track_meta, bass_track=bass_track, bass_channel=bass_channel, drums_channel=drums_channel
    )

    # Initial timesig / tempo at tick 0 (last declaration wins)
    num0, den0 = 4, 4
    for tick, num, den in timesig_map:
        if tick == 0:
            num0, den0 = num, den
        else:
            break
    tempo0 = 500000
    for tick, tempo in tempo_map:
        if tick == 0:
            tempo0 = tempo
        else:
            break
    bpm0 = _tempo_bpm(tempo0)

    # Build beat grid: each MIDI beat (quarter at den=4) is one beat.
    # For player we always emit 4/4-equivalent bars (16 sixteenths).
    # beats_per_player_bar = 4 when force_4_4 else num0
    beats_per_player_bar = 4 if force_4_4 else num0
    steps_per_bar = 16  # player hardcode
    steps_per_beat = steps_per_bar / beats_per_player_bar  # 4 for 4/4

    duration = mid.length
    beat_dur = 60.0 / bpm0
    # Prefer last note end (avoids FluidSynth pad / trailing meta) then duration.
    max_tick = max((n["end"] for n in notes), default=0)
    total_beats_notes = max_tick / tpq
    total_beats_dur = duration / beat_dur
    total_beats = max(total_beats_notes, min(total_beats_dur, total_beats_notes + beats_per_player_bar))
    nbars = int(math.ceil(total_beats / beats_per_player_bar - 1e-9))
    nbars = max(nbars, 1)

    def tick_to_bar_step(start_tick: int, end_tick: int):
        # Convert ticks → beats from start using constant bpm0 / tpq (good for Mutopia + our authored MIDI)
        start_beats = start_tick / tpq
        end_beats = end_tick / tpq
        bar = int(start_beats // beats_per_player_bar)
        beat_in_bar = start_beats - bar * beats_per_player_bar
        step = int(round(beat_in_bar * steps_per_beat))
        if step >= steps_per_bar:
            bar += 1
            step = 0
        if step < 0:
            step = 0
        dur_beats = max(end_beats - start_beats, 0)
        dur_steps = max(1, int(round(dur_beats * steps_per_beat)))
        return bar, step, dur_steps

    bass_hits = []
    drum_hits = []
    other_notes = []

    for n in notes:
        is_drum = n["channel"] in drum_channels
        is_bass = False
        if not is_drum:
            if bass_tracks and n["track"] in bass_tracks:
                is_bass = True
            elif bass_channel is not None and n["channel"] == bass_channel:
                is_bass = True
            elif not bass_tracks and bass_channel is None:
                # fallback: lowest channel non-drum as bass if named ambiguously — skip
                pass

        if is_drum:
            kind = DRUM_KIND.get(n["midi"])
            if not kind:
                continue
            bar, step, _ = tick_to_bar_step(n["start"], n["end"])
            if bar < 0 or bar >= nbars + 2:
                continue
            drum_hits.append({"bar": bar, "step": step, "kind": kind, "midi": n["midi"]})
            continue

        if is_bass:
            if bass_max_midi is not None and n["midi"] > bass_max_midi:
                other_notes.append(n)
                continue
            bar, step, dur = tick_to_bar_step(n["start"], n["end"])
            if bar < 0:
                continue
            bass_hits.append({"bar": bar, "step": step, "midi": n["midi"], "dur": dur})
        else:
            other_notes.append(n)

    # Dedupe identical hits (same bar/step/midi)
    def dedupe_bass(hits):
        seen = set()
        out = []
        for h in sorted(hits, key=lambda x: (x["bar"], x["step"], x["midi"])):
            key = (h["bar"], h["step"], h["midi"])
            if key in seen:
                continue
            seen.add(key)
            out.append(h)
        return out

    def dedupe_drums(hits):
        seen = set()
        out = []
        for h in sorted(hits, key=lambda x: (x["bar"], x["step"], x["kind"])):
            key = (h["bar"], h["step"], h["kind"])
            if key in seen:
                continue
            seen.add(key)
            out.append(h)
        return out

    bass_hits = dedupe_bass(bass_hits)
    drum_hits = dedupe_drums(drum_hits)

    # Clamp bars to computed nbars (extend if hits spill)
    max_bar = max([0, *[h["bar"] for h in bass_hits], *[h["bar"] for h in drum_hits]])
    nbars = max(nbars, max_bar + 1)

    return {
        "schema": "bass.midi_hits.v1",
        "source": str(mid_path),
        "bpm": round(bpm0, 3),
        "timeSig": f"{beats_per_player_bar}/4" if force_4_4 else f"{num0}/{den0}",
        "midiTimeSig": f"{num0}/{den0}",
        "ticksPerBeat": tpq,
        "duration": round(duration, 3),
        "nbars": nbars,
        "tracks": track_meta,
        "bassTracks": sorted(bass_tracks),
        "bassHits": bass_hits,
        "drumHits": drum_hits,
        "bassHitCount": len(bass_hits),
        "drumHitCount": len(drum_hits),
        "otherNoteCount": len(other_notes),
        "force_4_4": force_4_4,
        "bass_max_midi": bass_max_midi,
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("midi", type=Path)
    ap.add_argument("-o", "--out", type=Path, help="Write JSON (default stdout)")
    ap.add_argument("--bass-track", default=None, help="Track index or name substring (e.g. down)")
    ap.add_argument("--bass-channel", type=int, default=None)
    ap.add_argument("--drums-channel", type=int, default=9)
    ap.add_argument("--bass-max-midi", type=int, default=None, help="Drop bass notes above this MIDI")
    ap.add_argument("--no-force-4-4", action="store_true")
    args = ap.parse_args(argv)

    result = convert(
        args.midi,
        bass_track=args.bass_track,
        bass_channel=args.bass_channel,
        drums_channel=args.drums_channel,
        bass_max_midi=args.bass_max_midi,
        force_4_4=not args.no_force_4_4,
    )
    text = json.dumps(result, indent=2)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
        print(f"wrote {args.out} bass={result['bassHitCount']} drums={result['drumHitCount']} bars={result['nbars']}", file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
