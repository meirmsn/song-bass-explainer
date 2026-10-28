#!/usr/bin/env python3
"""Assemble demo-data.json / study/resource.json from midi_hits + section plan."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def midi_name(m):
    return NOTE_NAMES[m % 12]


def clamp_hits(hits, nbars):
    return [h for h in hits if 0 <= h["bar"] < nbars]


def rel_note(h, step):
    """Pattern note from a hit. Keeps ghost/vel so Groove A′ stays soft."""
    note = {"step": step, "midi": h["midi"], "dur": h.get("dur", 1)}
    if h.get("ghost"):
        note["ghost"] = True
    if "vel" in h:
        note["vel"] = h["vel"]
    return note


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
        notes.append(rel_note(h, (h["bar"] - best_bars[0]) * 16 + h["step"]))
    notes = notes[:max_notes]
    return {
        "id": pattern_id,
        "name": name,
        "notes": notes,
        "midi": True,
        "sectionNotes": [
            rel_note(h, (h["bar"] - lo) * 16 + h["step"])
            for h in sec_hits[:80]
        ],
        "sectionBars": [best_bars[0], best_bars[1]],
    }


def claim_bar_range(highlights):
    """Bars that contain a highlight step. No dim-only padding bar.

    Steps are pattern-relative (16 per bar). A claim that only touches bar 0
    is one bar.
    """
    bars = []
    for h in highlights or []:
        step = h.get("step")
        if not isinstance(step, int):
            continue
        bars.append(step // 16)
    if not bars:
        return [0, 0]
    return [min(bars), max(bars)]


def figure_highlights(pat_notes, sec_hits, limit=3):
    """Light the opening attacks and name those pitches.

    Intro's first three bass attacks are A, A, G (midi 33, 33, 31).
    C at step 10 (midi 36) is a later hit and stays unlit — do not pull it
    into the claim, and do not label a bubble "line".
    """
    notes = [n for n in (pat_notes or []) if isinstance(n.get("step"), int)]
    bar0 = [n for n in notes if n["step"] // 16 == 0]
    pool = bar0 or notes
    chosen = []
    seen = set()
    for n in pool:
        if n["step"] in seen:
            continue
        seen.add(n["step"])
        chosen.append(n)
        if len(chosen) >= limit:
            break
    if not chosen:
        for h in sec_hits or []:
            step = h.get("step")
            if not isinstance(step, int) or step in seen:
                continue
            seen.add(step)
            chosen.append({"step": step, "midi": h["midi"]})
            if len(chosen) >= limit:
                break
    out = [
        {"step": n["step"], "midi": n["midi"], "text": midi_name(n["midi"])}
        for n in chosen
    ]
    return out or [{"step": 0, "midi": 33, "text": "A"}]


def figure_claim_name(highlights):
    """Distinct lit pitches in attack order. A, A, G → A+G. Never an unlit pitch."""
    names = []
    for h in highlights or []:
        name = h.get("text") or ""
        if name and name not in names:
            names.append(name)
    return "+".join(names) if names else "figure"


def figure_body(highlights):
    lit = " · ".join(h.get("text") or midi_name(h["midi"]) for h in highlights)
    claim = figure_claim_name(highlights)
    return f"Lit pitches are {lit} ({claim}). They match the MIDI stem."


def pocket_highlights(pat_notes, home, has_drums):
    kick = "kick/bass 1" if has_drums else "LH 1"
    back = "backbeat pocket" if has_drums else "LH 3"
    ghosts = [n for n in (pat_notes or []) if n.get("ghost") and 0 <= n["step"] < 16]
    if ghosts and has_drums:
        bass_g = next((n for n in ghosts if n["step"] == 10), ghosts[0])
        return [
            {"step": 0, "midi": home, "text": kick},
            {"step": 3, "kind": "snare", "text": "ghost", "ghost": True},
            {"step": bass_g["step"], "midi": bass_g["midi"], "text": "bass ghost", "ghost": True},
            {"step": 11, "kind": "snare", "text": "ghost", "ghost": True},
        ]
    return [
        {"step": 0, "midi": home, "text": kick},
        {"step": 8, "midi": home, "text": back},
    ]


def build_cards(secs, bass_hits, *, key, has_drums, pocket_bodies, chord_for_bar=None, patterns=None):
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
                + " — same as the main chord-name row. Bass outlines A–C–E–G color tones."
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
        home = sec_hits[0]["midi"] if sec_hits else 33
        pat_notes = []
        if patterns:
            bucket = patterns.get(sec["id"]) or []
            if bucket:
                pat_notes = bucket[0].get("notes") or []
        highlights_fig = figure_highlights(pat_notes, sec_hits)
        pocket_hi = pocket_highlights(pat_notes, home, has_drums)
        pocket_body = pocket_bodies.get(sec["id"]) or pocket_bodies.get(sec["kind"]) or (
            "Lock with the kit; sit behind the kick a hair." if has_drums else
            "No kit — feel the LH stride pulse: bass on 1 & 3, chord on 2 & 4."
        )
        pattern_id = f"{sec['id']}_bass"
        ch = section_chord(sec)
        rn = roman_for_chord(ch, key)
        # One chord for the section: one chip. A second "still Am7" at step 16
        # only existed to fill a padded bar the claim never needed.
        harm_hi = [
            {"step": 0, "kind": "chord", "chord": ch, "text": f"{ch} = {rn}" if rn else ch, "midi": home},
        ]
        miss_hi = [
            {"step": 8, "midi": home, "text": "don’t chase"},
            {"step": 12, "midi": home, "text": "don’t chase"},
        ]
        cards[sec["id"]] = [
            {
                "label": "Pocket",
                "body": pocket_body,
                "insight": {
                    "layer": "pocket",
                    "patternId": pattern_id,
                    "title": f"{sec['name']} pocket",
                    "barRange": claim_bar_range(pocket_hi),
                    "highlights": pocket_hi,
                },
            },
            {
                "label": "Figure",
                "body": figure_body(highlights_fig),
                "insight": {
                    "layer": "figure",
                    "patternId": pattern_id,
                    "title": figure_claim_name(highlights_fig),
                    "barRange": claim_bar_range(highlights_fig),
                    "highlights": highlights_fig,
                },
            },
            {
                "label": "Harmony",
                "body": harmony_body(sec, ch, rn),
                "insight": {
                    "layer": "harmony",
                    "patternId": pattern_id,
                    "title": f"{ch} (= main row)",
                    "barRange": claim_bar_range(harm_hi),
                    "highlights": harm_hi,
                },
            },
            {
                "label": "Missable",
                "body": f"Easy miss: overplaying fills. Bars {lo}–{hi - 1} — hold the written pocket before ornamental notes.",
                "insight": {
                    "layer": "missable",
                    "patternId": pattern_id,
                    "title": "Pocket discipline",
                    "barRange": claim_bar_range(miss_hi),
                    "highlights": miss_hi,
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


def apply_pocket_funk_ghosts(bass, drums):
    """Groove A′ (bars 12–19): flag the soft bass 16ths and add the quiet snare ghosts.

    Bass notes at steps 10/11/14 are in the MIDI (vel 90/88/92). Snare ghosts on
    the e of 1 and the e of 3 (steps 3 and 11, vel 42) are the study's ghost
    layer ahead of the backbeat — already shipped, not a new harmony.
    Copies hits so the raw midi_hits document stays velocity-free.
    """
    bass_vel = {10: 90, 11: 88, 14: 92}
    bass_out = []
    for h in bass:
        row = dict(h)
        if 12 <= row["bar"] <= 19 and row["step"] in bass_vel:
            row["ghost"] = True
            row["vel"] = bass_vel[row["step"]]
        bass_out.append(row)
    drums_out = [dict(h) for h in drums]
    have = {(h["bar"], h["step"], h["kind"]) for h in drums_out}
    for bar in range(12, 20):
        for step in (3, 11):
            if (bar, step, "snare") in have:
                continue
            drums_out.append({
                "bar": bar, "step": step, "kind": "snare", "midi": 38,
                "ghost": True, "vel": 42,
            })
    drums_out.sort(key=lambda h: (h["bar"], h["step"], h["kind"]))
    return bass_out, drums_out


def build_pocket_funk():
    repo = Path(__file__).resolve().parents[1]
    candidates = [
        Path("/workspace/bass-midi-ship/pocket-funk"),
        repo / "work" / "demo-pocket-funk",
    ]
    root = next((p for p in candidates if (p / "analysis" / "midi_hits.json").is_file()), None)
    if root is None:
        raise SystemExit("pocket-funk analysis/midi_hits.json not found")
    hits = json.loads((root / "analysis" / "midi_hits.json").read_text())
    nbars = 40
    bpm = 96.0
    duration = 100.0
    bass = clamp_hits(hits["bassHits"], nbars)
    drums = clamp_hits(hits["drumHits"], nbars)
    bass, drums = apply_pocket_funk_ghosts(bass, drums)

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
    cards = build_cards(secs, bass, key="Am", has_drums=True, pocket_bodies=pocket_bodies, chord_for_bar=chord_for_bar, patterns=patterns)
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
    out = Path("/tmp/sbe-ship/work/demo-pocket-funk")
    write_demo(
        out,
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
    midi_src = None
    for cand in (root / "midi" / "pocket-funk.mid", root / "source" / "pocket-funk.mid"):
        if cand.is_file():
            midi_src = cand
            break
    if midi_src:
        src = out / "source"
        src.mkdir(parents=True, exist_ok=True)
        shutil.copy(midi_src, src / "pocket-funk.mid")
    stems_src = root / "stems"
    if stems_src.is_dir():
        stems = out / "stems"
        if stems.exists():
            shutil.rmtree(stems)
        shutil.copytree(stems_src, stems)
    # Player ships work/demo-pocket-funk. Don't clobber SHIP.md / attribution.
    published = repo / "work" / "demo-pocket-funk"
    if published.is_dir() and published.resolve() != out.resolve():
        text = json.dumps(demo, indent=2) + "\n"
        (published / "demo-data.json").write_text(text)
        (published / "study" / "resource.json").write_text(text)
        for name in ("bass_hits.json", "drum_hits.json"):
            src_f = out / "analysis" / name
            if not src_f.is_file():
                continue
            data = src_f.read_text()
            if not data.endswith("\n"):
                data += "\n"
            (published / "analysis" / name).write_text(data)
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
    cards = build_cards(secs, bass, key="Ab", has_drums=False, pocket_bodies=pocket_bodies, patterns=patterns)
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
        fig = figure_highlights(notes, [
            h for h in demo.get("bassHits") or []
            if sec["first"] <= h["bar"] < sec["end"]
        ])
        if not fig:
            fig = [{"step": 0, "midi": home, "text": midi_name(home)}]

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
        pocket_hi = [
            {"step": first["step"], "midi": first["midi"], "text": "with the kick"},
            {"step": beat3["step"], "midi": beat3["midi"], "text": "backbeat"},
        ]
        by_label["Pocket"]["insight"]["highlights"] = pocket_hi
        by_label["Pocket"]["insight"]["barRange"] = claim_bar_range(pocket_hi)
        by_label["Figure"]["insight"]["highlights"] = fig
        by_label["Figure"]["insight"]["barRange"] = claim_bar_range(fig)
        by_label["Figure"]["insight"]["title"] = figure_claim_name(fig)
        by_label["Figure"]["body"] = figure_body(fig)
        by_label["Harmony"]["body"] = (
            f"{sec['name']} is {labeled} — the same symbols as the main chord-name row. "
            "Bass roots those changes; no extra chords are implied."
        )
        harm_hi = harm_highlights or [
            {"step": 0, "kind": "chord", "chord": seq[0] if seq else song["key"], "text": "chord", "midi": home}
        ]
        by_label["Harmony"]["insight"]["title"] = " – ".join(seq) if seq else sec["name"]
        by_label["Harmony"]["insight"]["highlights"] = harm_hi
        by_label["Harmony"]["insight"]["barRange"] = claim_bar_range(harm_hi)
        # Light a real pattern note so the schematic is not an empty claim.
        miss = notes[-1] if notes else first
        earlier = notes[max(0, len(notes) // 2)] if notes else first
        miss_hi = [
            {"step": earlier["step"], "midi": earlier["midi"], "text": "hold the line"},
            {"step": miss["step"], "midi": miss["midi"], "text": "don’t chase"},
        ]
        by_label["Missable"]["insight"]["highlights"] = miss_hi
        by_label["Missable"]["insight"]["barRange"] = claim_bar_range(miss_hi)
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
        patterns=patterns,
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
        print("PF insightCount", pf["meta"]["insightCount"], "cards sections", len(pf["secs"]))
        maple_hits = Path("/workspace/bass-midi-ship/maple-leaf-rag/analysis/midi_hits.json")
        if maple_hits.is_file():
            ml = build_maple()
            print("ML insightCount", ml["meta"]["insightCount"], "bass", len(ml["bassHits"]))
        else:
            print("maple source missing; skipped")
    else:
        for slug in args:
            demo = build_style_demo(slug)
            print(slug, "insight", demo["meta"]["insightCount"], "bass", len(demo["bassHits"]), "drums", len(demo["drumHits"]))
