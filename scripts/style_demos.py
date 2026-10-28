#!/usr/bin/env python3
"""Original CC0 pop + rock study grooves (MIDI-authored, Pocket Funk pipeline).

Polyphonic events are scheduled in absolute ticks and merged per track so
concurrent kit notes do not drift the way sequential note_on/note_off deltas did
on the first Pocket Funk pass. Bass stays monophonic. Drums are GM channel 10.
"""
from __future__ import annotations

from pathlib import Path

import mido

TPQ = 480
SIXTEENTH = TPQ // 4  # 120
SF2 = Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")

# Electric-bass register. Roots sit around E2–G2; octaves reach the D string.
ROOT = {
    "C": 36,
    "D": 38,
    "Dm": 38,
    "E": 40,
    "Em": 40,
    "F": 41,
    "G": 43,
    "G7": 43,
    "A": 45,
    "Am": 45,
    "B7": 47,
}

DEGREES = {
    "C": "C.E.G",
    "G": "G.B.D",
    "G7": "G.B.D.F",
    "Am": "A.C.E",
    "F": "F.A.C",
    "Dm": "D.F.A",
    "Em": "E.G.B",
    "D": "D.F#.A",
    "B7": "B.D#.F#.A",
}

# Closed-voicing comping (pop EP) and power-chord guitar (rock), above the bass.
POP_VOICING = {
    "C": (60, 64, 67),
    "G": (55, 59, 62),
    "G7": (55, 59, 62, 65),
    "Am": (57, 60, 64),
    "F": (53, 57, 60),
    "Dm": (50, 53, 57),
    "Em": (52, 55, 59),
}
ROCK_POWER = {
    "Em": (52, 59, 64),
    "G": (55, 62, 67),
    "D": (50, 57, 62),
    "C": (48, 55, 60),
    "Am": (45, 52, 57),
    "B7": (59, 63, 66, 69),
}

ROMAN = {
    "C": {"C": "I", "G": "V", "G7": "V7", "Am": "vi", "F": "IV", "Dm": "ii", "Em": "iii"},
    "Em": {"Em": "i", "G": "III", "D": "VII", "C": "VI", "Am": "iv", "B7": "V7"},
}


def _repeat(pairs):
    """('C','verse',2) → two chart rows."""
    rows = []
    for chord, role, n in pairs:
        rows.extend([(chord, role)] * n)
    return rows


def pop_chart():
    # 48 bars × 120 BPM = 96.0s. I–V–vi–IV radio changes, four-on-the-floor.
    return _repeat([
        ("C", "intro", 4),
        ("C", "verse", 2), ("G", "verse", 2), ("Am", "verse", 2), ("F", "verse", 2),
        ("Dm", "pre", 2), ("G7", "pre", 2),
        ("C", "chorus", 1), ("G", "chorus", 1), ("Am", "chorus", 1), ("F", "chorus", 1),
        ("C", "chorus", 1), ("G", "chorus", 1), ("Am", "chorus", 1), ("F", "chorus", 1),
        ("C", "verse", 2), ("G", "verse", 2), ("Am", "verse", 2), ("F", "verse", 2),
        ("Am", "bridge", 2), ("F", "bridge", 2), ("C", "bridge", 2), ("G7", "bridge", 2),
        ("C", "chorus", 1), ("G", "chorus", 1), ("Am", "chorus", 1), ("F", "chorus", 1),
        ("C", "chorus", 4),
    ])


def rock_chart():
    # 48 bars × 128 BPM = 90.0s. Straight 8ths, backbeat, i–III–VII–iv.
    return _repeat([
        ("Em", "intro", 4),
        ("Em", "verse", 2), ("G", "verse", 2), ("D", "verse", 2), ("Am", "verse", 2),
        ("C", "pre", 2), ("B7", "pre", 2),
        ("Em", "chorus", 1), ("C", "chorus", 1), ("G", "chorus", 1), ("D", "chorus", 1),
        ("Em", "chorus", 1), ("C", "chorus", 1), ("G", "chorus", 1), ("D", "chorus", 1),
        ("Em", "verse", 2), ("G", "verse", 2), ("D", "verse", 2), ("Am", "verse", 2),
        ("C", "bridge", 2), ("G", "bridge", 2), ("D", "bridge", 2), ("B7", "bridge", 2),
        ("Em", "chorus", 1), ("C", "chorus", 1), ("G", "chorus", 1), ("D", "chorus", 1),
        ("Em", "chorus", 4),
    ])


POP_SECS = [
    {"id": "intro", "name": "Intro", "first": 0, "end": 4, "kind": "intro", "ci": 0},
    {"id": "v1", "name": "Verse", "first": 4, "end": 12, "kind": "verse", "ci": 1},
    {"id": "pre", "name": "Pre-chorus", "first": 12, "end": 16, "kind": "pre", "ci": 2},
    {"id": "ch1", "name": "Chorus", "first": 16, "end": 24, "kind": "chorus", "ci": 3},
    {"id": "v2", "name": "Verse 2", "first": 24, "end": 32, "kind": "verse", "ci": 1},
    {"id": "br", "name": "Bridge", "first": 32, "end": 40, "kind": "bridge", "ci": 4},
    {"id": "ch2", "name": "Chorus out", "first": 40, "end": 48, "kind": "chorus", "ci": 3},
]

ROCK_SECS = [
    {"id": "intro", "name": "Intro", "first": 0, "end": 4, "kind": "intro", "ci": 0},
    {"id": "v1", "name": "Verse", "first": 4, "end": 12, "kind": "verse", "ci": 1},
    {"id": "pre", "name": "Turnaround", "first": 12, "end": 16, "kind": "pre", "ci": 2},
    {"id": "ch1", "name": "Chorus", "first": 16, "end": 24, "kind": "chorus", "ci": 3},
    {"id": "v2", "name": "Verse 2", "first": 24, "end": 32, "kind": "verse", "ci": 1},
    {"id": "br", "name": "Breakdown", "first": 32, "end": 40, "kind": "bridge", "ci": 4},
    {"id": "ch2", "name": "Chorus out", "first": 40, "end": 48, "kind": "chorus", "ci": 3},
]


def _song(**kwargs):
    chart = kwargs["chart"]
    nbars = len(chart)
    bpm = kwargs["bpm"]
    kwargs["nbars"] = nbars
    kwargs["duration"] = round(nbars * 4 * 60.0 / bpm, 3)
    kwargs["chart"] = chart
    return kwargs


SONGS = {
    "radio-pop": _song(
        slug="radio-pop",
        title="Radio Pop",
        artist="Song Bass Explainer",
        key="C",
        bpm=120.0,
        bass_program=33,  # Finger Bass
        harm_program=4,  # Electric Piano
        harm_name="ep",
        chart=pop_chart(),
        secs=POP_SECS,
        pocket_bodies={
            "intro": "Four-on-the-floor kick and 8th hats for two bars. Bass enters on beat 1 of bar 3 with long C roots — don’t rush it.",
            "v1": "Pop verse pocket: kick on every quarter, snare on 2 and 4. Bass is quarters and 8ths (root, fifth, octave), not funk 16ths.",
            "pre": "Pre-chorus walks the chord: Dm arpeggio then G7 (the F on top is the 7th). Lock those quarters to the kick.",
            "ch1": "Chorus hook: root on 1, octave pop on the last 16th of beat 1, fifth on 2. Changes are one bar each — C G Am F.",
            "v2": "Same four-on-the-floor pocket. Verse 2 adds a chord-tone on beat 3; don’t turn it into a fill.",
            "br": "Bridge opens the notes up (root, fifth, octave) under the same kick grid. Leave the 16th grid alone.",
            "ch2": "Chorus returns. Sit the octave pop in the pocket; the kit does not syncopate with you.",
            "verse": "Four-on-the-floor kick, snare on 2 and 4, bass in quarters and 8ths.",
            "chorus": "One-bar chord hooks. Octave pop, then move.",
        },
    ),
    "backbeat-rock": _song(
        slug="backbeat-rock",
        title="Backbeat Rock",
        artist="Song Bass Explainer",
        key="Em",
        bpm=128.0,
        bass_program=34,  # Pick Bass
        harm_program=30,  # Distortion Guitar
        harm_name="guitar",
        chart=rock_chart(),
        secs=ROCK_SECS,
        pocket_bodies={
            "intro": "Kick on 1 and 3, hats on the 8ths. Bass waits two bars, then plants E on beat 1. This is a backbeat, not four-on-the-floor.",
            "v1": "Straight 8th bass (root–fifth–octave) glued to kick 1 and 3 and snare 2 and 4. No swung 16ths.",
            "pre": "Turnaround keeps the 8ths through C then B7. Last 8th of B7 is D# — the leading tone into E.",
            "ch1": "Chorus: ride replaces the hats, kick adds the ‘and’ of 2. Bass stays straight 8ths and changes every bar.",
            "v2": "Verse 2 flips the 8th motor (fifth on the off-8th). Still locked to the backbeat.",
            "br": "Breakdown: bass holds halves while the backbeat continues. Don’t fill the space the guitar left open.",
            "ch2": "Chorus out — ride, pushed kick, straight 8th roots. End on E, not a funk lick.",
            "verse": "8th-note rock motor under a 1-and-3 kick.",
            "chorus": "Ride cymbal and a pushed kick. Bass changes every bar.",
        },
    ),
}


def chord_for_bar(song, bar: int):
    if bar < 0 or bar >= song["nbars"]:
        return (None, None)
    name = song["chart"][bar][0]
    return (name, DEGREES[name])


def roman(song, chord: str) -> str:
    return ROMAN[song["key"]].get(chord, "")


def _approach(cur_root: int, nxt_root: int) -> int:
    """Chromatic step into the next root, kept in bass range."""
    if nxt_root == cur_root:
        return cur_root
    step = nxt_root - 1 if nxt_root > cur_root else nxt_root + 1
    while step < 33:
        step += 12
    while step > 55:
        step -= 12
    return step


def _pop_bass_bar(root: int, role: str, bar: int, nxt_root: int):
    if role == "intro":
        if bar < 2:
            return []
        return [(0, 8, root, 100), (8, 8, root + 7, 92)]
    if role == "pre":
        if root == ROOT["Dm"]:
            tones = (38, 41, 45, 48)  # D F A C
        else:
            tones = (43, 47, 50, 53)  # G B D F — the F is the 7th
        return [(i * 4, 4, t, 102) for i, t in enumerate(tones)]
    if role == "bridge":
        return [(0, 6, root, 100), (6, 2, root + 7, 90), (8, 8, root + 12, 96)]
    if role == "chorus":
        landing = _approach(root, nxt_root) if nxt_root != root else root
        return [
            (0, 3, root, 108),
            (3, 1, root + 12, 100),
            (4, 2, root + 7, 94),
            (6, 2, root, 90),
            (8, 4, root + 12, 102),
            (12, 2, root + 7, 92),
            (14, 2, landing, 88),
        ]
    # verse — quarters plus a fifth; verse 2 adds the 3rd under beat 3
    third = root + (3 if root in (ROOT["Am"], ROOT["Dm"], ROOT["Em"]) else 4)
    if bar >= 24:
        return [
            (0, 4, root, 104),
            (4, 2, root, 92),
            (6, 2, root + 7, 90),
            (8, 2, root, 100),
            (10, 2, third, 88),
            (12, 2, root + 12, 98),
            (14, 2, root, 86),
        ]
    return [
        (0, 4, root, 104),
        (4, 2, root, 92),
        (6, 2, root + 7, 90),
        (8, 4, root, 100),
        (12, 2, root + 12, 98),
        (14, 2, root, 86),
    ]


def _rock_bass_bar(root: int, role: str, bar: int, nxt_root: int):
    if role == "intro":
        if bar < 2:
            return []
        return [(0, 8, root, 106), (8, 8, root, 100)]
    if role == "bridge":
        return [(0, 8, root, 104), (8, 6, root + 7, 96), (14, 2, root if nxt_root == root else _approach(root, nxt_root), 90)]
    fifth = root + 7
    octave = root + 12
    if role == "chorus" or role == "pre":
        landing = _approach(root, nxt_root) if nxt_root != root else root
        seq = [root, root, root, octave, fifth, fifth, root, landing]
    elif bar >= 24:
        seq = [root, fifth, root, fifth, octave, root, fifth, root]
    else:
        seq = [root, root, fifth, root, root, root, octave, fifth]
    return [(i * 2, 2, n, 110 if i % 2 == 0 else 96) for i, n in enumerate(seq)]


def _pop_drums(bar: int, role: str, section_start: bool):
    notes = []
    for step in (0, 4, 8, 12):
        notes.append((step, 2, 36, 114))  # kick — every quarter
    snare = not (role == "intro" and bar < 2)
    if snare:
        notes.append((4, 2, 38, 108))
        notes.append((12, 2, 38, 104))
    for step in range(0, 16, 2):
        if role == "chorus" and step == 14 and bar % 2 == 0:
            notes.append((step, 2, 46, 82))  # open hat
        else:
            notes.append((step, 1, 42, 70))
    if section_start:
        notes.append((0, 8, 49, 102))
    return notes


def _rock_drums(bar: int, role: str, section_start: bool):
    notes = [(0, 2, 36, 118), (8, 2, 36, 112)]  # kick on 1 and 3
    push = role in ("chorus", "pre")
    if push:
        notes.append((6, 2, 36, 102))  # and of 2
    if not (role == "intro" and bar < 2):
        notes.append((4, 2, 38, 114))
        notes.append((12, 2, 38, 108))
    if role == "chorus":
        for step in range(0, 16, 2):
            notes.append((step, 1 if step % 4 else 2, 51, 86 if step % 4 == 0 else 72))
    else:
        for step in range(0, 16, 2):
            notes.append((step, 1, 42, 74))
    if section_start:
        notes.append((0, 8, 49, 106))
    return notes


def _pop_harm(chord: str):
    tones = POP_VOICING[chord]
    out = []
    for step, dur, vel in ((0, 6, 76), (8, 6, 72)):
        for n in tones:
            out.append((step, dur, n, vel))
    return out


def _rock_harm(chord: str, role: str):
    tones = ROCK_POWER[chord]
    if role == "bridge":
        return [(0, 16, n, 80) for n in tones]
    out = []
    for i in range(8):
        step = i * 2
        vel = 88 if i % 2 == 0 else 68
        for n in tones:
            out.append((step, 1, n, vel))
    return out


def events_for(song):
    """Return {bass, drums, harm} lists of (bar, step, dur_steps, midi, vel)."""
    chart = song["chart"]
    nbars = song["nbars"]
    section_starts = {s["first"] for s in song["secs"]}
    bass, drums, harm = [], [], []
    pop = song["slug"] == "radio-pop"
    for bar, (chord, role) in enumerate(chart):
        root = ROOT[chord]
        nxt = ROOT[chart[bar + 1][0]] if bar + 1 < nbars else root
        bass_fn = _pop_bass_bar if pop else _rock_bass_bar
        for step, dur, midi, vel in bass_fn(root, role, bar, nxt):
            bass.append((bar, step, dur, midi, vel))
        drum_fn = _pop_drums if pop else _rock_drums
        for step, dur, midi, vel in drum_fn(bar, role, bar in section_starts):
            drums.append((bar, step, dur, midi, vel))
        harm_fn = _pop_harm if pop else _rock_harm
        harm_notes = harm_fn(chord) if pop else harm_fn(chord, role)
        for step, dur, midi, vel in harm_notes:
            harm.append((bar, step, dur, midi, vel))
    _assert_monophonic(bass, song["slug"])
    return {"bass": bass, "drums": drums, "harm": harm}


def _assert_monophonic(bass, slug):
    by_bar = {}
    for bar, step, dur, midi, _vel in bass:
        by_bar.setdefault(bar, []).append((step, step + dur, midi))
    for bar, notes in by_bar.items():
        notes.sort()
        for i in range(1, len(notes)):
            if notes[i][0] < notes[i - 1][1]:
                raise SystemExit(f"{slug} bass overlap bar {bar}: {notes[i-1]} vs {notes[i]}")


def _track(name, channel, program, notes, end_tick):
    """Absolute-tick merge. note_off sorts before note_on at the same tick."""
    events = []
    if program is not None and channel != 9:
        events.append((0, 0, mido.Message("program_change", channel=channel, program=program, time=0)))
    for bar, step, dur, midi, vel in notes:
        start = (bar * 16 + step) * SIXTEENTH
        end = start + max(1, dur) * SIXTEENTH
        events.append((start, 2, mido.Message("note_on", channel=channel, note=midi, velocity=vel, time=0)))
        events.append((end, 1, mido.Message("note_off", channel=channel, note=midi, velocity=0, time=0)))
    events.sort(key=lambda item: (item[0], item[1]))
    tr = mido.MidiTrack()
    tr.append(mido.MetaMessage("track_name", name=name, time=0))
    last = 0
    for tick, _pri, msg in events:
        msg.time = max(0, tick - last)
        last = tick
        tr.append(msg)
    tr.append(mido.MetaMessage("end_of_track", time=max(0, end_tick - last)))
    return tr


def write_midi(path: Path, song, *, include_bass=True, include_drums=True, include_harm=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    ev = events_for(song)
    end_tick = song["nbars"] * 4 * TPQ
    mid = mido.MidiFile(type=1, ticks_per_beat=TPQ)
    control = mido.MidiTrack()
    control.append(mido.MetaMessage("track_name", name="control", time=0))
    control.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(song["bpm"]), time=0))
    control.append(mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    control.append(mido.MetaMessage("end_of_track", time=end_tick))
    mid.tracks.append(control)
    if include_bass:
        mid.tracks.append(_track("bass", 0, song["bass_program"], ev["bass"], end_tick))
    if include_drums:
        mid.tracks.append(_track("drums", 9, None, ev["drums"], end_tick))
    if include_harm:
        mid.tracks.append(_track(song["harm_name"], 1, song["harm_program"], ev["harm"], end_tick))
    mid.save(str(path))
    return path


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def song_dir(song) -> Path:
    return repo_root() / "work" / f"demo-{song['slug']}"
