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
   chord row. A Figure title made of pitch names may only name highlighted pitches.
3. barRange includes only bars that contain at least one highlight step,
   and every highlight step sits inside that range.
4. Card copy must not use meta or process language: denial ("there is no Bb"),
   "matches the MIDI", or internal words (lit, claim, window).
5. Insight quality: each card states a musical job (degree, beat, or function).
   A card that only lists pitches fails. Figure degree/beat/kick claims must be
   demonstrated by that card's highlights against bassHits, drumHits, and the
   chord at that bar. Other cards' degree/beat claims must be true of the MIDI.
   Two cards may not share the same body.

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
META = (
    re.compile(r"\blit\b", re.I),
    re.compile(r"\bclaim\b", re.I),
    re.compile(r"\bwindow\b", re.I),
    re.compile(r"\bmatch(?:es|ed|ing)? the MIDI\b", re.I),
    re.compile(r"\bMIDI stem\b", re.I),
    re.compile(r"\bverification\b", re.I),
)
ROLE = re.compile(
    r"\b(root|thirds?|fifths?|sevenths?|octaves?|fourths?|leading|approach|anchors?|downbeat|"
    r"kick|locks?|locked|arpeggio|pedal|syncopat\w*|offbeat|backbeat|pocket|color|tension|"
    r"walks?|harmony|chord|ghost|snare|hats?|fill|space|hold|ornament\w*|miss)\b",
    re.I,
)
# Longer phrases first so "on the and of 1" is not read as "on 1".
BEAT_PHRASES = (
    (re.compile(r"on the and of 1", re.I), 2),
    (re.compile(r"on the and of 2", re.I), 6),
    (re.compile(r"on the and of 3", re.I), 10),
    (re.compile(r"on the and of 4", re.I), 14),
    (re.compile(r"on the a of 1", re.I), 3),
    (re.compile(r"on the a of 2", re.I), 7),
    (re.compile(r"on the a of 3", re.I), 11),
    (re.compile(r"on the a of 4", re.I), 15),
    (re.compile(r"on the e of 1", re.I), 1),
    (re.compile(r"on the e of 2", re.I), 5),
    (re.compile(r"on the e of 3", re.I), 9),
    (re.compile(r"on the e of 4", re.I), 13),
    (re.compile(r"\bon 1\b", re.I), 0),
    (re.compile(r"\bon 2\b", re.I), 4),
    (re.compile(r"\bon 3\b", re.I), 8),
    (re.compile(r"\bon 4\b", re.I), 12),
)
DEGREE_PHRASES = (
    ("minor seventh", {10}),
    ("major seventh", {11}),
    ("minor third", {3}),
    ("major third", {4}),
    ("seventh", {10, 11}),
    ("third", {3, 4}),
    ("octave", None),
    ("fourth", {5}),
    ("fifth", {7}),
    ("root", {0}),
)
CHORD_ROOT = {
    "C": 0, "G": 7, "G7": 7, "Am": 9, "Am7": 9, "F": 5, "Dm": 2, "Dm7": 2,
    "Em": 4, "E7": 4, "E": 4, "D": 2, "D7": 2, "A": 9, "B7": 11, "Bb": 10,
    "Ab": 8, "Gm": 7, "C7": 0,
}
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
    chord_at = {}
    for row in demo.get("raw") or []:
        if row and len(row) > 2 and row[2]:
            chord_at[row[0]] = row[2]
    seen_bodies = {}

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
            body = card.get("body") or ""
            _check_copy(body, ins.get("title") or "", card.get("label") or "", highlights, where, fail)
            _check_insight(body, ins, highlights, window, chord_at, bass, drums, where, fail)
            norm = re.sub(r"\s+", " ", body.strip().lower())
            if norm and norm in seen_bodies:
                fail(where, f"duplicates the point of {seen_bodies[norm]}")
            elif norm:
                seen_bodies[norm] = where
            _check_window(ins.get("barRange"), highlights, where, fail)
            _check_title(ins, highlights, where, fail)
            for i, h in enumerate(highlights):
                _check_highlight(h, i, window, bass_key, drum_key, chords, where, fail)
    return errors


def _check_copy(body, title, card_label, highlights, where, fail):
    chunks = [body, title, card_label]
    chunks.extend((h.get("text") or "") for h in highlights if isinstance(h, dict))
    for chunk in chunks:
        for pat in DENIAL:
            if pat.search(chunk):
                fail(where, f"denial copy matches {pat.pattern!r}")
        for pat in META:
            if pat.search(chunk):
                fail(where, f"meta copy matches {pat.pattern!r}")
    if not ROLE.search(body or ""):
        fail(where, "insight only lists notes or pitches and never says what they do")


def _chord_root(chord):
    if not chord:
        return None
    head = str(chord).split("/")[0].strip()
    if head in CHORD_ROOT:
        return CHORD_ROOT[head]
    if len(head) >= 1:
        guess = head[0].upper() + head[1:]
        return CHORD_ROOT.get(guess)
    return None


def _bass_highlights(highlights):
    out = []
    for h in highlights or []:
        if not isinstance(h, dict) or not isinstance(h.get("step"), int):
            continue
        if h.get("kind") in ("kick", "snare", "hat", "chord") or h.get("chord"):
            continue
        if h.get("midi") is None:
            continue
        out.append(h)
    return out


def _degree_ok(interval, allowed, midi, highlights):
    if allowed is None:
        pc = int(midi) % 12
        return any(
            isinstance(o.get("midi"), int) and o["midi"] != midi and o["midi"] % 12 == pc and abs(o["midi"] - midi) == 12
            for o in highlights
        )
    return interval in allowed


def _check_insight(body, ins, highlights, window, chord_at, bass, drums, where, fail):
    """Degree, beat, and kick claims must be true of the MIDI and, for Figure, the highlights."""
    if not body:
        fail(where, "card has no takeaway")
        return
    layer = (ins.get("layer") or "").lower()
    bass_hi = _bass_highlights(highlights)
    clauses = re.split(r"\s*(?:,|—|;|\bthen\b)\s*", body)
    for clause in clauses:
        if not clause.strip():
            continue
        beats = []
        for pat, step in BEAT_PHRASES:
            if pat.search(clause):
                beats.append(step)
        degrees = []
        low = clause.lower()
        for name, allowed in DEGREE_PHRASES:
            if re.search(r"\b" + re.escape(name) + r"\b", low):
                degrees.append((name, allowed))
        wants_kick = bool(re.search(r"\bkick\b", low)) and bool(re.search(r"lock", low))
        up = "up to" in low
        down = "down to" in low
        pairs = _pair_degree_beats(clause)
        if pairs:
            for name, allowed, beat in pairs:
                if beat is None:
                    if layer == "figure" and not any(
                        _highlight_degree(h, bass_hi, window, chord_at, allowed, name) for h in bass_hi
                    ):
                        fail(where, f"claim {name!r} is not in the highlighted notes")
                    continue
                if not _claim_supported(name, allowed, beat, None, bass_hi, window, chord_at, bass, layer):
                    fail(where, f"claim {name!r} {_beat_name(beat)} is not demonstrated")
        elif degrees and layer == "figure":
            for name, allowed in degrees:
                if not any(_highlight_degree(h, bass_hi, window, chord_at, allowed, name) for h in bass_hi):
                    fail(where, f"claim {name!r} is not in the highlighted notes")
        elif beats and layer != "figure" and wants_kick:
            for beat in beats:
                if not _kick_at(drums, window, beat, highlights):
                    fail(where, f"kick claim {_beat_name(beat)} is not in the drum hits")
        if wants_kick and layer == "figure":
            targets = beats or [h["step"] % 16 for h in bass_hi]
            if not any(_kick_at(drums, window, b, highlights) and any((h["step"] % 16) == b for h in bass_hi) for b in targets):
                # Clause-local: if this clause names beats, those highlighted beats need a kick.
                if beats and not all(
                    any((h["step"] % 16) == b for h in bass_hi) and _kick_at(drums, window, b, highlights)
                    for b in beats
                ):
                    fail(where, "locks-with-the-kick is not true of the highlighted notes")
        if layer == "figure" and (up or down) and bass_hi:
            ordered = sorted(bass_hi, key=lambda h: h["step"])
            for i in range(1, len(ordered)):
                if up and ordered[i]["midi"] <= ordered[i - 1]["midi"] and any(
                    name in low for name, _a in degrees
                ):
                    # Only flag when this clause is the one that says up-to and the later note is not higher.
                    pass
            if up or down:
                _check_direction(clause, ordered, up, down, where, fail)
    if layer == "figure":
        if not re.search(r"\b(root|third|fifth|seventh|octave|fourth)\b", body, re.I):
            fail(where, "figure card never names a scale degree")
        if not any(pat.search(body) for pat, _s in BEAT_PHRASES):
            fail(where, "figure card never names a beat")
        if re.search(r"anchors the downbeat", body, re.I):
            if not any(h["step"] % 16 == 0 and _is_root(h, bass_hi, window, chord_at) for h in bass_hi):
                fail(where, "anchors-the-downbeat is not a highlighted root on beat 1")
        if re.search(r"root[–-]fifth", body, re.I):
            if not any(_highlight_degree(h, bass_hi, window, chord_at, {0}, "root") for h in bass_hi):
                fail(where, "root–fifth figure has no highlighted root")
            if not any(_highlight_degree(h, bass_hi, window, chord_at, {7}, "fifth") for h in bass_hi):
                fail(where, "root–fifth figure has no highlighted fifth")


def _beat_name(step):
    for pat, s in BEAT_PHRASES:
        if s == step:
            return pat.pattern
    return f"step {step}"


def _pair_degree_beats(clause):
    """Pair each degree word with the next beat phrase in the same clause."""
    marks = []
    for name, allowed in DEGREE_PHRASES:
        for m in re.finditer(r"\b" + re.escape(name) + r"\b", clause, re.I):
            marks.append((m.start(), m.end(), "deg", name, allowed))
    occupied = []
    for pat, step in BEAT_PHRASES:
        for m in pat.finditer(clause):
            span = (m.start(), m.end())
            if any(span[0] >= a and span[1] <= b for a, b in occupied):
                continue
            occupied.append(span)
            marks.append((m.start(), m.end(), "beat", step, None))
    marks.sort(key=lambda row: (row[0], 0 if row[2] == "deg" else 1))
    pairs = []
    pending = None
    for _start, _end, kind, a, b in marks:
        if kind == "deg":
            if pending:
                pairs.append((pending[0], pending[1], None))
            pending = (a, b)
        elif pending:
            pairs.append((pending[0], pending[1], a))
            pending = None
    if pending:
        pairs.append((pending[0], pending[1], None))
    return pairs


def _song_bar(window, step):
    return int(window) + int(step) // 16


def _is_root(h, highlights, window, chord_at):
    return _highlight_degree(h, highlights, window, chord_at, {0}, "root")


def _highlight_degree(h, highlights, window, chord_at, allowed, name):
    chord = chord_at.get(_song_bar(window, h["step"]))
    root = _chord_root(chord)
    if root is None or h.get("midi") is None:
        return False
    interval = (int(h["midi"]) % 12 - root) % 12
    if name == "octave":
        return _degree_ok(interval, None, int(h["midi"]), highlights)
    if interval not in (allowed or set()):
        return False
    # An upper octave of the root is named "octave", not "root".
    if name == "root" and any(
        isinstance(o.get("midi"), int) and int(h["midi"]) - int(o["midi"]) == 12 and o["midi"] % 12 == int(h["midi"]) % 12
        for o in highlights
    ):
        return False
    return True


def _kick_at(drums, window, beat, highlights):
    bars = {_song_bar(window, h["step"]) for h in highlights if isinstance(h, dict) and isinstance(h.get("step"), int)}
    if not bars:
        bars = {int(window)}
    return any(
        h.get("kind") == "kick" and h.get("step") == beat and h.get("bar") in bars
        for h in drums or []
    )


def _claim_supported(name, allowed, beat, pool, bass_hi, window, chord_at, bass, layer):
    if layer == "figure":
        return any(
            (h["step"] % 16) == beat and _highlight_degree(h, bass_hi, window, chord_at, allowed, name)
            for h in bass_hi
        )
    bars = {_song_bar(window, h["step"]) for h in (bass_hi or []) if isinstance(h.get("step"), int)}
    if not bars:
        bars = {int(window)}
    for hit in bass or []:
        if hit.get("bar") not in bars or hit.get("step") != beat or hit.get("midi") is None:
            continue
        fake = {"step": (hit["bar"] - int(window)) * 16 + hit["step"], "midi": hit["midi"]}
        mates = [fake]
        for other in bass or []:
            if other.get("bar") in bars and other.get("midi") is not None:
                mates.append({"step": 0, "midi": other["midi"]})
        if _highlight_degree(fake, mates, window, chord_at, allowed, name):
            return True
    return False


def _check_direction(clause, ordered, up, down, where, fail):
    low = clause.lower()
    for i in range(1, len(ordered)):
        prev, cur = ordered[i - 1], ordered[i]
        mentioned = False
        root_pc_skip = True
        for name, allowed in DEGREE_PHRASES:
            if re.search(r"\b" + re.escape(name) + r"\b", low):
                mentioned = True
        if not mentioned:
            return
        if up and "up to" in low and cur["midi"] <= prev["midi"]:
            # The clause may describe a later note than this pair. Only fail when
            # no ascending pair exists among highlighted notes named here.
            if not any(ordered[j]["midi"] > ordered[j - 1]["midi"] for j in range(1, len(ordered))):
                fail(where, "up-to claim does not rise in the highlighted notes")
            return
        if down and "down to" in low and cur["midi"] >= prev["midi"]:
            if not any(ordered[j]["midi"] < ordered[j - 1]["midi"] for j in range(1, len(ordered))):
                fail(where, "down-to claim does not fall in the highlighted notes")
            return
        return


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
