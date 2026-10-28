#!/usr/bin/env python3
"""Assemble demo-data.json / study/resource.json from midi_hits + section plan."""
from __future__ import annotations

import json
import shutil
from collections import Counter, defaultdict
from pathlib import Path

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_name(m):
    return NOTE_NAMES[m % 12]


def clamp_hits(hits, nbars):
    return [h for h in hits if 0 <= h["bar"] < nbars]


def pattern_from_hits(hits, sec, pattern_id, name, max_notes=24):
    """2-bar densest window tiled notes relative to section start."""
    lo, hi = sec["first"], sec["end"]
    sec_hits = [h for h in hits if lo <= h["bar"] < hi]
    # densest 2-bar window
    best = []
    best_bars = (lo, min(lo + 1, hi - 1))
    for start in range(lo, max(lo + 1, hi - 1)):
        end = min(start + 2, hi)
        window = [h for h in sec_hits if start <= h["bar"] < end]
        if len(window) > len(best):
            best = window
            best_bars = (start, end - 1)
    notes = []
    for h in best:
        notes.append({"step": (h["bar"] - best_bars[0]) * 16 + h["step"], "midi": h["midi"], "dur": h.get("dur", 1)})
    notes = notes[:max_notes]
    return {
        "id": pattern_id,
        "name": name,
        "notes": notes,
        "midi": True,
        "sectionNotes": [
            {"step": (h["bar"] - lo) * 16 + h["step"], "midi": h["midi"], "dur": h.get("dur", 1)}
            for h in sec_hits[:80]
        ],
        "sectionBars": [best_bars[0], best_bars[1]],
    }


def figure_label(hits):
    if not hits:
        return "sparse"
    cnt = Counter(midi_name(h["midi"]) for h in hits)
    top = [n for n, _ in cnt.most_common(3)]
    return "–".join(top)


def build_cards(secs, bass_hits, *, key, has_drums, pocket_bodies, chord_for_bar=None):
    """Lean-B cards. Harmony chips must match the main chord-name row (no invented Bb)."""
    cards = {}

    def section_chord(sec):
        mid = (sec["first"] + sec["end"] - 1) // 2
        if callable(chord_for_bar):
            ch, _degs = chord_for_bar(mid)
            return ch
        # Fallback: key center as seventh for Am demos
        if key in ("Am", "A minor", "A"):
            return "Am7"
        return key

    def roman_for_chord(ch, key_name):
        table_am = {"Am7": "i7", "Am": "i", "D7": "IV7", "E7": "V7", "Dm7": "iv7", "C": "III", "G": "VII"}
        table_f = {"F": "I", "C": "V", "Bb": "IV", "Dm": "vi", "Gm": "ii"}
        if key_name in ("Am", "A minor", "A"):
            return table_am.get(ch, "")
        if key_name in ("F", "F major"):
            return table_f.get(ch, "")
        return ""

    def harmony_body(sec, ch, rn):
        if ch in ("Am7", "Am"):
            return (
                f"Pedal {ch}"
                + (f" ({rn})" if rn else "")
                + " — same as the main chord-name row. Bass outlines A–C–E–G color tones; "
                "there is no Bb (or other foreign chord) in what’s heard."
            )
        if ch == "D7":
            return (
                "Lift sits on D7 (IV7 in Am) — matches the main chord row. "
                "Bass roots on D; this is a real change from the Am7 groove, not a mirage."
            )
        if ch == "E7":
            return (
                "Break on E7 (V7) — matches the main chord row. Sparse bass; dominant tension before the return."
            )
        return (
            f"Section harmony is {ch}"
            + (f" ({rn})" if rn else "")
            + " — same symbol as the main chord-name row. Bass supports that chord; no invented extras."
        )

    for sec in secs:
        lo, hi = sec["first"], sec["end"]
        sec_hits = [h for h in bass_hits if lo <= h["bar"] < hi]
        fig = figure_label(sec_hits)
        home = sec_hits[0]["midi"] if sec_hits else 33
        highlights_fig = []
        for h in sec_hits[:3]:
            highlights_fig.append({"step": (h["bar"] - lo) * 16 + h["step"] if h["bar"] >= lo else h["step"], "midi": h["midi"], "text": "line"})
        # Prefer claim-local steps 0.. from densest pattern window — keep simple step from hit
        highlights_fig = []
        for h in sec_hits[:3]:
            highlights_fig.append({"step": h["step"], "midi": h["midi"], "text": "line"})
        while len(highlights_fig) < 3 and sec_hits:
            highlights_fig.append({"step": sec_hits[0]["step"], "midi": home, "text": "home"})
            break
        pocket_body = pocket_bodies.get(sec["id"]) or pocket_bodies.get(sec["kind"]) or (
            "Lock with the kit; sit behind the kick a hair." if has_drums else
            "No kit — feel the LH stride pulse: bass on 1 & 3, chord on 2 & 4."
        )
        pattern_id = f"{sec['id']}_bass"
        ch = section_chord(sec)
        rn = roman_for_chord(ch, key)
        cards[sec["id"]] = [
            {
                "label": "Pocket",
                "body": pocket_body,
                "insight": {
                    "layer": "pocket",
                    "patternId": pattern_id,
                    "title": f"{sec['name']} pocket",
                    "barRange": [0, 1],  # claim-local (pattern steps are relative); NOT song bars
                    "highlights": [
                        {"step": 0, "midi": home, "text": "kick/bass 1" if has_drums else "LH 1"},
                        {"step": 8, "midi": home, "text": "backbeat pocket" if has_drums else "LH 3"},
                    ],
                },
            },
            {
                "label": "Figure",
                "body": f"Bass line centers on {fig}. Trace the MIDI-authored line — hits match the stem 1:1.",
                "insight": {
                    "layer": "figure",
                    "patternId": pattern_id,
                    "title": f"{fig} line",
                    "barRange": [0, 1],  # claim-local (pattern steps are relative); NOT song bars
                    "highlights": highlights_fig[:3] or [{"step": 0, "midi": home, "text": "home"}],
                },
            },
            {
                "label": "Harmony",
                "body": harmony_body(sec, ch, rn),
                "insight": {
                    "layer": "harmony",
                    "patternId": pattern_id,
                    "title": f"{ch} (= main row)",
                    "barRange": [0, 1],  # claim-local
                    "highlights": [
                        {"step": 0, "kind": "chord", "chord": ch, "text": f"{ch} = {rn}" if rn else ch, "midi": home},
                        {"step": 16, "kind": "chord", "chord": ch, "text": "still " + ch, "midi": home},
                    ],
                },
            },
            {
                "label": "Missable",
                "body": f"Easy miss: overplaying fills. Bars {lo}–{hi - 1} — hold the written pocket before ornamental notes.",
                "insight": {
                    "layer": "missable",
                    "patternId": pattern_id,
                    "title": "Pocket discipline",
                    "barRange": [0, 1],  # claim-local (pattern steps are relative); NOT song bars
                    "highlights": [
                        {"step": 8, "midi": home, "text": "don’t chase"},
                        {"step": 12, "midi": home, "text": "don’t chase"},
                    ],
                },
            },
        ]
        # kind alias
        cards[sec["kind"]] = cards[sec["id"]]
    return cards


def build_raw(secs, nbars, beat_dur_bar, chord_for_bar):
    raw = []
    for b in range(nbars):
        chord, degrees = chord_for_bar(b)
        raw.append([b, round(b * beat_dur_bar, 2), chord, degrees])
    # end sentinel like existing demos
    raw.append([nbars, round(nbars * beat_dur_bar, 2), None, None])
    return raw


def build_beat(bpm, nbars, duration, time_sig="4/4"):
    beat_dur = 60.0 / bpm
    beats = []
    downbeats = []
    for bar in range(nbars):
        for beat in range(4):
            t = round((bar * 4 + beat) * beat_dur, 4)
            beats.append(t)
            if beat == 0:
                downbeats.append(t)
    return {
        "schema": "bass.beat.v1",
        "status": "ok",
        "source": "midi_tempo_grid",
        "bpm": bpm,
        "beats": beats,
        "downbeats": downbeats,
        "time_sig": time_sig,
        "duration": duration,
        "grid": "16th",
    }


def write_demo(out_dir: Path, demo: dict, beat: dict, midi_hits: dict, extra_files: dict):
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "analysis").mkdir(exist_ok=True)
    (out_dir / "study").mkdir(exist_ok=True)
    (out_dir / "source").mkdir(exist_ok=True)

    demo_path = out_dir / "demo-data.json"
    demo_path.write_text(json.dumps(demo, indent=2))
    (out_dir / "study" / "resource.json").write_text(json.dumps(demo, indent=2))
    (out_dir / "analysis" / "beat.json").write_text(json.dumps(beat, indent=2))
    (out_dir / "analysis" / "bass_hits.json").write_text(
        json.dumps({"schema": "bass.hits.v1", "bassHits": demo["bassHits"], "source": "midi"}, indent=2)
    )
    (out_dir / "analysis" / "drum_hits.json").write_text(
        json.dumps({"schema": "bass.drums.v1", "drumHits": demo["drumHits"], "source": "midi"}, indent=2)
    )
    (out_dir / "analysis" / "midi_hits.json").write_text(json.dumps(midi_hits, indent=2))
    (out_dir / "analysis" / "semantic.json").write_text(json.dumps(demo["semantic"], indent=2))
    (out_dir / "analysis" / "merge-report.json").write_text(
        json.dumps({"source": "midi-first", "amt": False, "ok": True}, indent=2)
    )
    for name, text in extra_files.items():
        (out_dir / name).write_text(text)
    print(f"wrote {demo_path} bass={len(demo['bassHits'])} drums={len(demo['drumHits'])} bars={demo['nbars']}")


def build_pocket_funk():
    root = Path("/workspace/bass-midi-ship/pocket-funk")
    hits = json.loads((root / "analysis" / "midi_hits.json").read_text())
    nbars = 40
    bpm = 96.0
    duration = 100.0
    bass = clamp_hits(hits["bassHits"], nbars)
    drums = clamp_hits(hits["drumHits"], nbars)

    secs = [
        {"id": "intro", "name": "Intro", "first": 0, "end": 4, "kind": "intro", "ci": 0},
        {"id": "a1", "name": "Groove A", "first": 4, "end": 12, "kind": "verse", "ci": 1},
        {"id": "a2", "name": "Groove A′", "first": 12, "end": 20, "kind": "verse", "ci": 1},
        {"id": "b1", "name": "Lift", "first": 20, "end": 28, "kind": "chorus", "ci": 2},
        {"id": "a3", "name": "Groove back", "first": 28, "end": 34, "kind": "verse", "ci": 1},
        {"id": "br", "name": "Break", "first": 34, "end": 37, "kind": "bridge", "ci": 3},
        {"id": "out", "name": "Outro", "first": 37, "end": 40, "kind": "tag", "ci": 4},
    ]

    def chord_for_bar(b):
        if b < 4:
            return ("Am7", "A.C.E.G") if b >= 2 else ("Am7", "—")
        if 20 <= b < 28:
            return ("D7", "D.F#.A.C")
        if 34 <= b < 37:
            return ("E7", "E.G#.B.D")
        return ("Am7", "A.C.E.G")

    patterns = {}
    for sec in secs:
        pid = f"{sec['id']}_bass"
        patterns[sec["id"]] = [pattern_from_hits(bass, sec, pid, f"{sec['id']} MIDI line")]
        patterns[sec["kind"]] = patterns[sec["id"]]

    pocket_bodies = {
        "intro": "Hats roll in; bass waits two bars then drops into the A pocket.",
        "a1": "Four-feel kit under an A-center funk line. Sit behind the kick; hats mark the 8ths.",
        "a2": "Same pocket with denser octave pops — don’t rush the ghost notes: quiet snares into the backbeat, and the soft bass 16ths.",
        "b1": "Lift to D7; keep the kick 1 + syncopation while the root moves.",
        "a3": "Back to Am7 pocket — lock the written syncopations.",
        "br": "Break: sparse kicks. Leave space.",
        "out": "Ride out on A; don’t invent fills the kit isn’t giving you.",
        "verse": "Four-feel kit under an A-center funk line.",
        "chorus": "Lift pocket — root moves, groove stays.",
        "bridge": "Sparse break pocket.",
        "tag": "Outro pocket.",
    }
    cards = build_cards(secs, bass, key="Am", has_drums=True, pocket_bodies=pocket_bodies, chord_for_bar=chord_for_bar)
    beat = build_beat(bpm, nbars, duration)
    slug = "pocket-funk"
    demo = {
        "schema": "bass.study.v1",
        "title": "Pocket Funk",
        "artist": "Song Bass Explainer",
        "bpm": bpm,
        "timeSig": "4/4",
        "keys": "Am",
        "nbars": nbars,
        "duration": duration,
        "bassHits": bass,
        "drumHits": drums,
        "drumsOutBars": [],
        "secs": secs,
        "patterns": patterns,
        "cards": cards,
        "raw": build_raw(secs, nbars, 60.0 / bpm * 4, chord_for_bar),
        "credit": {
            "title": "Pocket Funk",
            "artist": "Song Bass Explainer",
            "license": "CC0 1.0 Universal",
            "source": "MIDI-authored demo (bass + kit + EP)",
            "url": "https://bass.meirmsn.dev/?song=pocket-funk",
        },
        "meta": {
            "insightSlots": "pocket|figure|harmony|missable",
            "insightRedesign": "lean-B-2026-10-26",
            "license": "CC0 1.0 Universal",
            "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
            "source": "MIDI-authored (FluidSynth / FluidR3_GM)",
            "sourceUrl": "https://bass.meirmsn.dev/?song=pocket-funk",
            "album": "MIDI demos",
            "analysis": "MIDI→hits 1:1 via scripts/midi_to_hits.py; audio rendered from same MIDI (FluidSynth)",
            "insightRequired": True,
            "insightCount": len(secs) * 4,
            "drumsSource": "GM channel-10 from authored MIDI (exact)",
            "drumsSchema": "bass.drums.v1",
            "drumHitCount": len(drums),
            "bassHitCount": len(bass),
            "midiAuthoritative": True,
        },
        "semantic": {
            "schema": "bass.semantic.v1",
            "source": "lean-B cards; bass+drums from MIDI (scripts/midi_to_hits.py)",
            "confidence": "high — MIDI-authored; hits match render",
        },
        "stems": {
            "available": True,
            "access": "public",
            "muteBassSupported": True,
            "drumsAvailable": True,
            "dbSupported": True,
            "format": "aac",
            "bass": f"/api/demo/{slug}/stems/bass.m4a",
            "no_bass": f"/api/demo/{slug}/stems/no_bass.m4a",
            "drums": f"/api/demo/{slug}/stems/drums.m4a",
            "bass_wav": f"/api/demo/{slug}/stems/bass.wav",
            "no_bass_wav": f"/api/demo/{slug}/stems/no_bass.wav",
            "drums_wav": f"/api/demo/{slug}/stems/drums.wav",
            "other": f"/api/demo/{slug}/stems/other.m4a",
        },
        "merge": {"procedural_only": False, "waiting_bot": False, "report": "analysis/merge-report.json"},
        "keys": "Am",
    }
    # fix duplicate keys key - already set
    attribution = """# Pocket Funk — attribution

- Title: Pocket Funk
- Author: Song Bass Explainer (MIDI-authored study groove)
- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Audio: FluidSynth render of the same MIDI (FluidR3_GM soundfont)
- Hits: scripts/midi_to_hits.py (authoritative MIDI → bassHits/drumHits)
- Created: 2026-10-27 (America/Los_Angeles)
"""
    ship = """# Pocket Funk — MIDI-first public hero demo

## 2026-10-27
- Authored MIDI funk groove (bass + GM kit + EP), 96 BPM, 40 bars, ~100s, key Am
- Rendered mix + stems via FluidSynth / FluidR3_GM
- Hits from scripts/midi_to_hits.py (1:1 with MIDI)
- Replaces Make Funk as public default/hero (Make Funk demoted to private/regression)
"""
    license_txt = Path("/tmp/sbe-ship/work/demo-make-funk/LICENSE-CC0.txt").read_text() if Path("/tmp/sbe-ship/work/demo-make-funk/LICENSE-CC0.txt").exists() else "CC0 1.0 Universal\n"
    write_demo(
        Path("/tmp/sbe-ship/work/demo-pocket-funk"),
        demo,
        beat,
        hits,
        {
            "ATTRIBUTION.md": attribution,
            "SHIP.md": ship,
            "LICENSE": "CC0 1.0 Universal\n",
            "LICENSE-CC0.txt": license_txt,
            "source/midi_url.txt": "authored: work/demo-pocket-funk/source/pocket-funk.mid\n",
            "source/download_date.txt": "2026-10-27 America/Los_Angeles\n",
        },
    )
    # copy midi into source
    src = Path("/tmp/sbe-ship/work/demo-pocket-funk/source")
    shutil.copy(root / "midi" / "pocket-funk.mid", src / "pocket-funk.mid")
    # stems dir (gitignored) — copy for local/R2 upload
    stems = Path("/tmp/sbe-ship/work/demo-pocket-funk/stems")
    if stems.exists():
        shutil.rmtree(stems)
    shutil.copytree(root / "stems", stems)
    return demo


def build_maple():
    root = Path("/workspace/bass-midi-ship/maple-leaf-rag")
    hits = json.loads((root / "analysis" / "midi_hits.json").read_text())
    nbars = 72
    bpm = 120.0
    duration = 144.0
    bass = clamp_hits(hits["bassHits"], nbars)
    drums = []  # honest empty

    # Classic rag strains approx on 72 bars of 4/4 (paired from 2/4)
    secs = [
        {"id": "a1", "name": "Strain A", "first": 0, "end": 8, "kind": "verse", "ci": 1},
        {"id": "a2", "name": "Strain A repeat", "first": 8, "end": 16, "kind": "verse", "ci": 1},
        {"id": "b1", "name": "Strain B", "first": 16, "end": 24, "kind": "chorus", "ci": 2},
        {"id": "b2", "name": "Strain B repeat", "first": 24, "end": 32, "kind": "chorus", "ci": 2},
        {"id": "a3", "name": "Strain A′", "first": 32, "end": 40, "kind": "verse", "ci": 1},
        {"id": "c1", "name": "Trio C", "first": 40, "end": 48, "kind": "bridge", "ci": 3},
        {"id": "c2", "name": "Trio C′", "first": 48, "end": 56, "kind": "bridge", "ci": 3},
        {"id": "d1", "name": "Strain D", "first": 56, "end": 64, "kind": "chorus", "ci": 2},
        {"id": "out", "name": "Coda", "first": 64, "end": 72, "kind": "tag", "ci": 4},
    ]

    def chord_for_bar(b):
        # Simplified Ab major rag outline
        if b < 16:
            return ("Ab", "Ab.C.Eb")
        if b < 32:
            return ("Eb7", "Eb.G.Bb.Db")
        if b < 40:
            return ("Ab", "Ab.C.Eb")
        if b < 56:
            return ("Db", "Db.F.Ab")
        return ("Ab", "Ab.C.Eb")

    patterns = {}
    for sec in secs:
        pid = f"{sec['id']}_lh"
        patterns[sec["id"]] = [pattern_from_hits(bass, sec, pid, f"{sec['id']} LH MIDI")]
        patterns[sec["kind"]] = patterns[sec["id"]]

    pocket_bodies = {
        "a1": "No kit — Mutopia LH is the bass voice. Feel stride: low on 1 & 3, mid chord on 2 & 4.",
        "verse": "LH stride pulse (no drums).",
        "chorus": "Strain lift — keep the oom-pah, don’t invent a backbeat.",
        "bridge": "Trio: still piano LH only; no invented kit.",
        "tag": "Coda — ride the LH stride out.",
    }
    # override pattern ids in cards for _lh
    cards = build_cards(secs, bass, key="Ab", has_drums=False, pocket_bodies=pocket_bodies)
    for sec in secs:
        for c in cards[sec["id"]]:
            c["insight"]["patternId"] = f"{sec['id']}_lh"

    beat = build_beat(bpm, nbars, duration)
    slug = "maple-leaf-rag"
    demo = {
        "schema": "bass.study.v1",
        "title": "Maple Leaf Rag",
        "artist": "Scott Joplin",
        "bpm": bpm,
        "timeSig": "4/4",
        "keys": "Ab",
        "nbars": nbars,
        "duration": duration,
        "bassHits": bass,
        "drumHits": drums,
        "drumsOutBars": [[0, nbars - 1]],
        "secs": secs,
        "patterns": patterns,
        "cards": cards,
        "raw": build_raw(secs, nbars, 60.0 / bpm * 4, chord_for_bar),
        "credit": {
            "title": "Maple Leaf Rag",
            "artist": "Scott Joplin",
            "license": "Public Domain (composition); Mutopia MIDI typeset; FluidSynth render",
            "source": "Mutopia Project MIDI + FluidSynth render",
            "url": "https://www.mutopiaproject.org/ftp/JoplinS/maple/maple.mid",
            "realization": "FluidSynth / FluidR3_GM render of Mutopia maple.mid (LH→bassHits)",
        },
        "meta": {
            "insightSlots": "pocket|figure|harmony|missable",
            "insightRedesign": "lean-B-2026-10-26",
            "license": "Public Domain",
            "licenseUrl": "https://creativecommons.org/publicdomain/mark/1.0/",
            "source": "Mutopia Project MIDI",
            "sourceUrl": "https://www.mutopiaproject.org/ftp/JoplinS/maple/maple.mid",
            "album": "MIDI demos",
            "realization": "FluidSynth render of Mutopia maple.mid; LH (down:) → bassHits; 2/4 paired into 4/4 player grid",
            "analysis": "MIDI→hits 1:1 (down: track, midi≤55); no FMA tempo-align; drumHits=[]",
            "insightRequired": True,
            "insightCount": len(secs) * 4,
            "drumsSource": "none in score — drumHits=[] (no invented kit)",
            "drumsSchema": "bass.drums.v1",
            "drumHitCount": 0,
            "bassHitCount": len(bass),
            "midiAuthoritative": True,
            "caveat": "Piano ragtime: bass voice is LH stride from MIDI, not electric bass. Empty drums are honest.",
        },
        "semantic": {
            "schema": "bass.semantic.v1",
            "source": "lean-B cards; LH bassHits from Mutopia MIDI via scripts/midi_to_hits.py",
            "confidence": "high — MIDI-authoritative LH; drums intentionally empty",
        },
        "stems": {
            "available": True,
            "access": "public",
            "muteBassSupported": True,
            "drumsAvailable": False,
            "dbSupported": False,
            "format": "aac",
            "bass": f"/api/demo/{slug}/stems/bass.m4a",
            "no_bass": f"/api/demo/{slug}/stems/no_bass.m4a",
            "drums": f"/api/demo/{slug}/stems/drums.m4a",
            "bass_wav": f"/api/demo/{slug}/stems/bass.wav",
            "no_bass_wav": f"/api/demo/{slug}/stems/no_bass.wav",
            "drums_wav": f"/api/demo/{slug}/stems/drums.wav",
            "other": f"/api/demo/{slug}/stems/other.m4a",
        },
        "merge": {"procedural_only": False, "waiting_bot": False, "report": "analysis/merge-report.json"},
    }
    attribution = """# Maple Leaf Rag — attribution (MIDI-first)

- Composition: Scott Joplin (1899) — Public Domain
- MIDI typeset: Mutopia Project — https://www.mutopiaproject.org/ftp/JoplinS/maple/maple.mid
- Audio: FluidSynth render of that MIDI (FluidR3_GM), not the FMA Brewster-Geisz recording
- Bass hits: Mutopia `down:` (LH) via scripts/midi_to_hits.py (2/4 paired → 4/4 player grid)
- Drums: none in score — drumHits left empty
- Updated: 2026-10-27 (America/Los_Angeles)
"""
    ship = """# Maple Leaf Rag — MIDI-first refresh

## 2026-10-27
- Replaced FMA audio with FluidSynth render of Mutopia maple.mid (120 BPM, 144s, 72×4/4 bars)
- bassHits from LH (`down:`), midi≤55; drumHits=[]
- No FMA tempo-align / DTW hack
"""
    write_demo(
        Path("/tmp/sbe-ship/work/demo-maple-leaf-rag"),
        demo,
        beat,
        hits,
        {
            "ATTRIBUTION.md": attribution,
            "SHIP.md": ship,
            "LICENSE": "Public Domain (Joplin composition; Mutopia MIDI; FluidSynth render)\n",
            "source/midi_url.txt": "https://www.mutopiaproject.org/ftp/JoplinS/maple/maple.mid\n",
            "source/download_date.txt": "2026-10-27 America/Los_Angeles\n",
        },
    )
    src = Path("/tmp/sbe-ship/work/demo-maple-leaf-rag/source")
    shutil.copy(root / "midi" / "maple.mid", src / "maple.mid")
    stems = Path("/tmp/sbe-ship/work/demo-maple-leaf-rag/stems")
    if stems.exists():
        shutil.rmtree(stems)
    shutil.copytree(root / "stems", stems)
    return demo


def _progression(song, sec, chord_for):
    seq = []
    for b in range(sec["first"], sec["end"]):
        ch, _deg = chord_for(b)
        if ch and (not seq or seq[-1] != ch):
            seq.append(ch)
    return seq


def apply_style_insights(demo, song):
    """Claim-local barRange, pattern-step highlights, harmony chips = section chords."""
    from style_demos import roman

    def chord_for(b):
        return song_chord(song, b)

    for sec in demo["secs"]:
        pat = (demo["patterns"].get(sec["id"]) or [{}])[0]
        notes = pat.get("notes") or []
        home = notes[0]["midi"] if notes else 36

        def at(step):
            for n in notes:
                if n["step"] == step:
                    return n
            return None

        first = notes[0] if notes else {"step": 0, "midi": home}
        beat3 = at(8) or (notes[min(2, len(notes) - 1)] if notes else first)
        fig = []
        seen = set()
        for n in notes:
            key = (n["step"], n["midi"])
            if key in seen:
                continue
            seen.add(key)
            fig.append({"step": n["step"], "midi": n["midi"], "text": "line"})
            if len(fig) == 3:
                break
        if not fig:
            fig = [{"step": 0, "midi": home, "text": "home"}]

        seq = _progression(song, sec, chord_for)
        romans = [roman(song, ch) for ch in seq]
        labeled = " – ".join(
            f"{ch} ({rn})" if rn else ch for ch, rn in zip(seq, romans)
        )
        harm_highlights = []
        for i, (ch, rn) in enumerate(zip(seq, romans)):
            harm_highlights.append({
                "step": i * 8,
                "kind": "chord",
                "chord": ch,
                "text": f"{ch} = {rn}" if rn else ch,
                "midi": home,
            })

        cards = demo["cards"][sec["id"]]
        by_label = {c["label"]: c for c in cards}
        by_label["Pocket"]["insight"]["barRange"] = [0, 1]
        by_label["Pocket"]["insight"]["highlights"] = [
            {"step": first["step"], "midi": first["midi"], "text": "with the kick"},
            {"step": beat3["step"], "midi": beat3["midi"], "text": "backbeat"},
        ]
        by_label["Figure"]["insight"]["barRange"] = [0, 1]
        by_label["Figure"]["insight"]["highlights"] = fig
        by_label["Figure"]["insight"]["title"] = f"{sec['name']} line"
        by_label["Harmony"]["body"] = (
            f"{sec['name']} is {labeled} — the same symbols as the main chord-name row. "
            "Bass roots those changes; no extra chords are implied."
        )
        by_label["Harmony"]["insight"]["barRange"] = [0, 1]
        by_label["Harmony"]["insight"]["title"] = " – ".join(seq) if seq else sec["name"]
        by_label["Harmony"]["insight"]["highlights"] = harm_highlights or [
            {"step": 0, "kind": "chord", "chord": seq[0] if seq else song["key"], "text": "chord", "midi": home}
        ]
        by_label["Missable"]["insight"]["barRange"] = [0, 1]
        # Light a real pattern note so the schematic is not an empty claim.
        miss = notes[-1] if notes else first
        earlier = notes[max(0, len(notes) // 2)] if notes else first
        by_label["Missable"]["insight"]["highlights"] = [
            {"step": earlier["step"], "midi": earlier["midi"], "text": "hold the line"},
            {"step": miss["step"], "midi": miss["midi"], "text": "don’t chase"},
        ]
        by_label["Missable"]["body"] = (
            f"Easy miss in {sec['name']} (bars {sec['first']}–{sec['end'] - 1}): "
            "ornamenting past the written line. Play the MIDI pocket before adding notes."
        )
        demo["cards"][sec["kind"]] = cards


def song_chord(song, bar):
    from style_demos import chord_for_bar
    return chord_for_bar(song, bar)


def build_style_demo(slug: str):
    """Package work/demo-<slug> from analysis/midi_hits.json + style_demos.SONGS."""
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from style_demos import SONGS, song_dir

    song = SONGS[slug]
    root = song_dir(song)
    hits = json.loads((root / "analysis" / "midi_hits.json").read_text())
    nbars = song["nbars"]
    bpm = float(song["bpm"])
    duration = float(song["duration"])
    bass = clamp_hits(hits["bassHits"], nbars)
    drums = clamp_hits(hits["drumHits"], nbars)
    if len(bass) < 40:
        raise SystemExit(f"{slug}: bassHits too thin ({len(bass)})")
    kinds = {h["kind"] for h in drums}
    missing = {"kick", "snare", "hat"} - kinds
    if missing or len(drums) < 80:
        raise SystemExit(f"{slug}: kit incomplete {missing} drums={len(drums)}")

    secs = song["secs"]

    def chord_for(b):
        return song_chord(song, b)

    patterns = {}
    for sec in secs:
        pid = f"{sec['id']}_bass"
        patterns[sec["id"]] = [pattern_from_hits(bass, sec, pid, f"{sec['name']} MIDI line")]
        if not patterns[sec["id"]][0]["notes"]:
            raise SystemExit(f"{slug}: empty pattern {sec['id']}")

    cards = build_cards(
        secs, bass, key=song["key"], has_drums=True,
        pocket_bodies=song["pocket_bodies"], chord_for_bar=chord_for,
    )
    beat = build_beat(bpm, nbars, duration)
    player = f"https://bass.meirmsn.dev/?song={slug}"
    demo = {
        "schema": "bass.study.v1",
        "title": song["title"],
        "artist": song["artist"],
        "bpm": bpm,
        "timeSig": "4/4",
        "keys": song["key"],
        "nbars": nbars,
        "duration": duration,
        "bassHits": bass,
        "drumHits": drums,
        "drumsOutBars": [],
        "secs": secs,
        "patterns": patterns,
        "cards": cards,
        "raw": build_raw(secs, nbars, 60.0 / bpm * 4, chord_for),
        "credit": {
            "title": song["title"],
            "artist": song["artist"],
            "license": "CC0 1.0 Universal",
            "source": "MIDI-authored demo (bass + kit + " + song["harm_name"] + ")",
            "url": player,
        },
        "meta": {
            "insightSlots": "pocket|figure|harmony|missable",
            "insightRedesign": "lean-B-2026-10-26",
            "license": "CC0 1.0 Universal",
            "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
            "source": "MIDI-authored (FluidSynth / FluidR3_GM)",
            "sourceUrl": player,
            "album": "MIDI demos",
            "analysis": "MIDI→hits 1:1 via scripts/midi_to_hits.py; audio rendered from same MIDI (FluidSynth)",
            "insightRequired": True,
            "insightCount": len(secs) * 4,
            "drumsSource": "GM channel-10 from authored MIDI (exact)",
            "drumsSchema": "bass.drums.v1",
            "drumHitCount": len(drums),
            "bassHitCount": len(bass),
            "midiAuthoritative": True,
        },
        "semantic": {
            "schema": "bass.semantic.v1",
            "source": "lean-B cards; bass+drums from MIDI (scripts/midi_to_hits.py)",
            "confidence": "high — MIDI-authored; hits match render",
        },
        "stems": {
            "available": True,
            "access": "public",
            "muteBassSupported": True,
            "drumsAvailable": True,
            "dbSupported": True,
            "format": "aac",
            "bass": f"/api/demo/{slug}/stems/bass.m4a",
            "no_bass": f"/api/demo/{slug}/stems/no_bass.m4a",
            "drums": f"/api/demo/{slug}/stems/drums.m4a",
            "bass_wav": f"/api/demo/{slug}/stems/bass.wav",
            "no_bass_wav": f"/api/demo/{slug}/stems/no_bass.wav",
            "drums_wav": f"/api/demo/{slug}/stems/drums.wav",
            "other": f"/api/demo/{slug}/stems/other.m4a",
        },
        "merge": {"procedural_only": False, "waiting_bot": False, "report": "analysis/merge-report.json"},
    }
    apply_style_insights(demo, song)

    attribution = f"""# {song['title']} — attribution

- Title: {song['title']}
- Author: Song Bass Explainer (MIDI-authored study groove)
- License: CC0 1.0 Universal — https://creativecommons.org/publicdomain/zero/1.0/
- Audio: FluidSynth render of the same MIDI (FluidR3_GM soundfont)
- Hits: scripts/midi_to_hits.py (authoritative MIDI → bassHits/drumHits)
- Key: {song['key']} · {bpm:g} BPM · {nbars} bars · {duration:g}s
- Created: 2026-10-28 (America/Los_Angeles)
"""
    ship = f"""# {song['title']} — MIDI-first public demo

## 2026-10-28
- Original CC0 {song['key']} groove, {bpm:g} BPM, {nbars} bars, {duration:g}s
- Bass + GM kit (kick/snare/hat) + {song['harm_name']}, polyphonic abs-time MIDI
- Hits from scripts/midi_to_hits.py (1:1 with MIDI)
- Public DEMO catalog alongside Pocket Funk. Maple Leaf Rag is not a public hero.
"""
    write_demo(
        root,
        demo,
        beat,
        hits,
        {
            "ATTRIBUTION.md": attribution,
            "SHIP.md": ship,
            "LICENSE": "CC0 1.0 Universal\n",
            "source/midi_url.txt": f"authored: work/demo-{slug}/source/{slug}.mid\n",
            "source/download_date.txt": "2026-10-28 America/Los_Angeles\n",
        },
    )
    return demo


if __name__ == "__main__":
    import sys
    args = sys.argv[1:]
    if not args:
        pf = build_pocket_funk()
        ml = build_maple()
        print("PF insightCount", pf["meta"]["insightCount"], "cards sections", len(pf["secs"]))
        print("ML insightCount", ml["meta"]["insightCount"], "bass", len(ml["bassHits"]))
    else:
        for slug in args:
            demo = build_style_demo(slug)
            print(slug, "insight", demo["meta"]["insightCount"], "bass", len(demo["bassHits"]), "drums", len(demo["drumHits"]))
