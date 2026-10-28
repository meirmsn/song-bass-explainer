#!/usr/bin/env python3
"""Adversarial review for insight cards. Required before a study ships.

Song analysis and demo authoring must pass this review before ship.
`npm test` runs it (tests/adversarial-review.test.mjs), and
`scripts/build_demo_data.py` refuses to write a demo that fails.

The gate exists because learner-facing cards contradicted the MIDI:
a Harmony sentence denying Bb, a Figure titled A–G–C while the lit
attacks were A/A/G, and two-bar windows with nothing highlighted in bar 2.

Rules, per insight card:
1. Every highlight midi matches a bassHit or drumHit at that claim-local
   step. Claim-local step 0 is pattern sectionBars[0]; 16 steps per bar.
   A drum-kind highlight must match that drum hit instead.
2. Highlight text that is a pitch name must match that midi's pitch class.
   Text that is a chord symbol (or "Chord = roman") must be the section's
   chord row. A Figure title made of pitch names may only name lit pitches.
3. barRange includes only bars that contain at least one highlight step,
   and every highlight step sits inside that range.
4. Card bodies must not use meta denial ("there is no Bb", "no invented",
   "not a mirage", "no extra chords are implied", "foreign chord").

Default targets: Pocket Funk, Radio Pop, Backbeat Rock.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLATS = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
DRUM_KINDS = {"kick", "snare", "hat", "tom", "crash", "ride"}
DRUM_ALIAS = {"hihat": "hat", "hi-hat": "hat", "hh": "hat"}
PITCH_ONLY = re.compile(r"^[A-G](?:#|b)?$")
CHORD_TOKEN = re.compile(
    r"^([A-G](?:#|b)?(?:maj7|min7|m7|dim7|maj|min|m|dim|aug|sus4|sus2|7|9|6)?)\b"
)
DENIAL = (
    re.compile(r"there is no\b", re.I),
    re.compile(r"\bno invented\b", re.I),
    re.compile(r"foreign chord", re.I),
    re.compile(r"\bnot a mirage\b", re.I),
    re.compile(r"no extra chords are implied", re.I),
)
DEFAULT_SLUGS = ("pocket-funk", "radio-pop", "backbeat-rock")


def pitch_class(name: str):
    n = FLATS.get(name.strip(), name.strip())
    if n not in NOTE_NAMES:
        return None
    return NOTE_NAMES.index(n)


def drum_kind(kind: str) -> str:
    k = (kind or "").strip().lower()
    return DRUM_ALIAS.get(k, k)


def review_demo(demo: dict, label: str = "demo") -> list[str]:
    """Return human-readable failures. Empty list means the study may ship."""
    errors = []
    bass = demo.get("bassHits") or []
    drums = demo.get("drumHits") or []
    bass_key = {(h["bar"], h["step"], h["midi"]) for h in bass}
    drum_key = {(h["bar"], h["step"], h.get("kind"), h.get("midi")) for h in drums}

    def fail(where, msg):
        errors.append(f"{label}: {where}: {msg}")

    for sec in demo.get("secs") or []:
        sid = sec["id"]
        cards = (demo.get("cards") or {}).get(sid) or []
        pat = ((demo.get("patterns") or {}).get(sid) or [{}])[0]
        window = (pat.get("sectionBars") or [sec.get("first", 0), sec.get("first", 0)])[0]
        chords = set()
        for row in demo.get("raw") or []:
            if row and row[2] and sec["first"] <= row[0] < sec["end"]:
                chords.add(row[2])
        for card in cards:
            ins = card.get("insight") or {}
            where = f"{sid}/{card.get('label')}"
            highlights = ins.get("highlights") or []
            _check_copy(card.get("body") or "", where, fail)
            _check_window(ins.get("barRange"), highlights, where, fail)
            _check_title(ins, highlights, where, fail)
            for i, h in enumerate(highlights):
                _check_highlight(h, i, window, bass_key, drum_key, chords, where, fail)
    return errors


def _check_copy(body, where, fail):
    for pat in DENIAL:
        if pat.search(body):
            fail(where, f"denial copy matches {pat.pattern!r}")


def _check_window(bar_range, highlights, where, fail):
    if not isinstance(bar_range, list) or len(bar_range) < 2:
        fail(where, "barRange missing")
        return
    lo, hi = int(bar_range[0]), int(bar_range[1])
    if hi < lo:
        fail(where, f"barRange {bar_range} is reversed")
        return
    bars = set()
    for h in highlights:
        step = h.get("step")
        if isinstance(step, int):
            bars.add(step // 16)
    if not bars:
        fail(where, "no highlight steps")
        return
    for bar in range(lo, hi + 1):
        if bar not in bars:
            fail(where, f"bar {bar} in barRange {bar_range} has no highlight")
    for bar in bars:
        if bar < lo or bar > hi:
            fail(where, f"highlight in bar {bar} is outside barRange {bar_range}")


def _check_title(ins, highlights, where, fail):
    if (ins.get("layer") or "") != "figure":
        return
    title = ins.get("title") or ""
    lit = set()
    for h in highlights:
        text = (h.get("text") or "").strip()
        if PITCH_ONLY.match(text):
            lit.add(text)
    for part in re.split(r"[+–\-/]", title):
        name = part.strip()
        if PITCH_ONLY.match(name) and name not in lit:
            fail(where, f"title names pitch {name} that is not highlighted")


def _check_highlight(h, index, window, bass_key, drum_key, chords, where, fail):
    step = h.get("step")
    if not isinstance(step, int):
        fail(where, f"highlight[{index}] has no step")
        return
    song_bar = int(window) + step // 16
    step_in_bar = step % 16
    kind = drum_kind(h.get("kind") or "")
    midi = h.get("midi")
    loc = f"highlight[{index}] step {step} (song bar {song_bar} step {step_in_bar})"

    if kind in DRUM_KINDS:
        ok = any(
            d[0] == song_bar and d[1] == step_in_bar and d[2] == kind and (midi is None or d[3] == midi)
            for d in drum_key
        )
        if not ok:
            fail(where, f"{loc} drum {kind} midi={midi} does not match a drumHit")
    elif midi is not None:
        if (song_bar, step_in_bar, midi) not in bass_key:
            drum_midi = any(d[0] == song_bar and d[1] == step_in_bar and d[3] == midi for d in drum_key)
            if not drum_midi:
                fail(where, f"{loc} midi {midi} does not match a bassHit or drumHit")

    text = (h.get("text") or "").strip()
    if PITCH_ONLY.match(text) and kind not in DRUM_KINDS and h.get("kind") != "chord" and not h.get("chord"):
        pc = pitch_class(text)
        if midi is None or pc is None or (midi % 12) != pc:
            fail(where, f"{loc} pitch label {text} does not match midi {midi}")
        return

    chord = h.get("chord")
    token = None
    matched = CHORD_TOKEN.match(text) if text else None
    if matched and (h.get("kind") == "chord" or chord or "=" in text or matched.group(1) != text):
        # A bare pitch was already handled. A longer token or "= roman" is a chord claim.
        if matched.group(1) != text or h.get("kind") == "chord" or chord or "=" in text:
            token = matched.group(1)
    if h.get("kind") == "chord" or chord:
        symbol = chord or token
        if not symbol:
            fail(where, f"{loc} chord highlight has no chord symbol")
        elif symbol not in chords:
            fail(where, f"{loc} chord {symbol} is not on the section chord row {sorted(chords)}")
        elif token and chord and token != chord:
            fail(where, f"{loc} text chord {token} does not match chord field {chord}")


def load_demo(path: Path) -> dict:
    return json.loads(path.read_text())


def default_paths(root: Path) -> list[Path]:
    return [root / "work" / f"demo-{slug}" / "demo-data.json" for slug in DEFAULT_SLUGS]


def main(argv=None) -> int:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("paths", nargs="*", type=Path, help="demo-data.json files (default: public MIDI demos)")
    args = ap.parse_args(argv)
    paths = args.paths or default_paths(root)
    errors = []
    for path in paths:
        if not path.is_file():
            errors.append(f"{path}: missing")
            continue
        errors.extend(review_demo(load_demo(path), str(path)))
    if errors:
        print(f"adversarial review failed ({len(errors)})", file=sys.stderr)
        for err in errors:
            print(err, file=sys.stderr)
        return 1
    print(f"adversarial review ok ({len(paths)} studies)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
