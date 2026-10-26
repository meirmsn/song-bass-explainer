#!/usr/bin/env python3
"""
Whisper transcription helpers for non-LAP bass-study jobs.

Uses faster-whisper when available (preferred venv: BASS_WHISPER_PYTHON or
/workspace/.venv-whisper). Decodes audio via ffmpeg → 16 kHz mono float32 to
avoid PyAV version skew in decode_audio().

Pure helpers (section mapping, schema packing) have no model dependency and are
unit-tested from fixtures.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any

DEFAULT_WHISPER_PYTHON = Path(
    os.environ.get("BASS_WHISPER_PYTHON", "/workspace/.venv-whisper/bin/python")
)
DEFAULT_MODEL = os.environ.get("BASS_WHISPER_MODEL", "base.en")
DEFAULT_COMPUTE = os.environ.get("BASS_WHISPER_COMPUTE", "int8")


def load_audio_mono_16k(path: Path, *, max_seconds: float | None = None) -> tuple[Any, int]:
    """Return (float32 mono @ 16kHz, 16000). Requires ffmpeg + numpy."""
    import numpy as np

    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    cmd = ["ffmpeg", "-y", "-i", str(path), "-ac", "1", "-ar", "16000"]
    if max_seconds is not None and max_seconds > 0:
        cmd += ["-t", str(max_seconds)]
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out = Path(tmp.name)
    try:
        cmd += [str(out)]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg decode failed: {(proc.stderr or '')[-400:]}")
        with wave.open(str(out), "rb") as w:
            if w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise RuntimeError("expected 16-bit mono wav from ffmpeg")
            sr = w.getframerate()
            raw = w.readframes(w.getnframes())
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        return audio, sr
    finally:
        try:
            out.unlink(missing_ok=True)
        except Exception:
            pass


def pack_segment(start: float, end: float, text: str, words: list | None = None) -> dict:
    seg: dict[str, Any] = {
        "start": round(float(start), 2),
        "end": round(float(end), 2),
        "text": (text or "").strip(),
    }
    if words:
        packed = []
        for w in words:
            if isinstance(w, (list, tuple)) and len(w) >= 3:
                packed.append([str(w[0]), round(float(w[1]), 2), round(float(w[2]), 2)])
            elif isinstance(w, dict):
                packed.append(
                    [
                        str(w.get("word") or w.get("text") or ""),
                        round(float(w.get("start", 0)), 2),
                        round(float(w.get("end", 0)), 2),
                    ]
                )
        if packed:
            seg["words"] = packed
    return seg


def make_transcription(
    segments: list[dict],
    *,
    job_id: str | None = None,
    source: str = "faster-whisper",
    model: str | None = None,
    audio_path: str | None = None,
    status: str = "ok",
    note: str | None = None,
    language: str | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "schema": "bass.transcription.v1",
        "status": status,
        "source": source,
        "model": model or DEFAULT_MODEL,
        "segments": segments,
        "jobId": job_id,
    }
    if note:
        out["note"] = note
    if language:
        out["language"] = language
    if audio_path:
        out["audio"] = audio_path
    out["text"] = " ".join(s.get("text", "") for s in segments if s.get("text")).strip()
    return out


def skipped_transcription(job_id: str | None = None, note: str = "") -> dict[str, Any]:
    return make_transcription(
        [],
        job_id=job_id,
        source="none",
        status="skipped",
        note=note or "whisper unavailable",
    )


def bar_index_at(t: float, bars: list[dict], nbars: int) -> int:
    """Map time (s) → bar index using bars meta (last entry may be end sentinel)."""
    if nbars <= 0 or not bars:
        return 0
    # bars[i]["t"] is start of bar i; sentinel at bars[nbars]
    best = 0
    for i in range(nbars):
        if float(bars[i].get("t", 0)) <= t + 1e-6:
            best = i
        else:
            break
    return min(best, nbars - 1)


def map_segments_to_sections(
    segments: list[dict],
    bars: list[dict],
    nbars: int,
    *,
    duration: float,
    gap_sec: float = 2.5,
    min_bars: int = 2,
) -> list[dict]:
    """
    Rough sections from lyric timestamps.

    - Leading silence → Intro
    - Gaps ≥ gap_sec between segments → new section boundary
    - Trailing silence → Outro/tag when long enough
    - Kind cycle: intro / verse / chorus / bridge / tag (heuristic by position + density)
    """
    if nbars <= 0:
        return [{"id": "a", "name": "A", "first": 0, "end": 1, "kind": "body", "ci": 0}]

    if not segments:
        return []  # caller keeps energy/chunk sections

    # Collect vocal activity intervals in bar space
    events: list[tuple[int, int, str]] = []  # (first_bar, end_bar_exclusive, text)
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        b0 = bar_index_at(float(seg["start"]), bars, nbars)
        b1 = bar_index_at(float(seg["end"]), bars, nbars) + 1
        b1 = max(b1, b0 + 1)
        b1 = min(b1, nbars)
        events.append((b0, b1, text))

    if not events:
        return []

    # Merge overlapping / nearby (by time gap on original segments)
    clusters: list[dict] = []
    cur_start = events[0][0]
    cur_end = events[0][1]
    cur_texts = [events[0][2]]
    prev_seg_end = float(segments[0].get("end") or 0)

    seg_i = 0
    # Walk segments with text in order
    text_segs = [s for s in segments if (s.get("text") or "").strip()]
    for i, seg in enumerate(text_segs):
        b0 = bar_index_at(float(seg["start"]), bars, nbars)
        b1 = min(nbars, bar_index_at(float(seg["end"]), bars, nbars) + 1)
        b1 = max(b1, b0 + 1)
        if i == 0:
            cur_start, cur_end, cur_texts = b0, b1, [seg["text"].strip()]
            prev_seg_end = float(seg["end"])
            continue
        gap = float(seg["start"]) - prev_seg_end
        if gap >= gap_sec and b0 > cur_end:
            clusters.append({"first": cur_start, "end": cur_end, "texts": cur_texts})
            cur_start, cur_end, cur_texts = b0, b1, [seg["text"].strip()]
        else:
            cur_end = max(cur_end, b1)
            cur_texts.append(seg["text"].strip())
        prev_seg_end = float(seg["end"])
    clusters.append({"first": cur_start, "end": cur_end, "texts": cur_texts})

    # Expand tiny clusters; insert Intro / Outro
    secs: list[dict] = []
    cursor = 0
    first_vocal = clusters[0]["first"]
    if first_vocal >= min_bars:
        secs.append(_sec(len(secs), 0, first_vocal, "intro", "Intro"))
        cursor = first_vocal

    # Lines that repeat later → chorus on 2nd+ occurrence; first hit stays verse
    from collections import Counter

    line_counts = Counter()
    for c in clusters:
        for t in c["texts"]:
            norm = " ".join(t.lower().split())
            if len(norm) >= 8:
                line_counts[norm] += 1
    repeatable = {t for t, n in line_counts.items() if n >= 2}
    seen_repeatable: set[str] = set()

    body_i = 0
    for ci, c in enumerate(clusters):
        first = max(cursor, c["first"])
        end = max(first + 1, min(nbars, c["end"]))
        # pad short bodies to min_bars when room allows
        if end - first < min_bars and end + (min_bars - (end - first)) <= nbars:
            # don't overrun next cluster start
            nxt = clusters[ci + 1]["first"] if ci + 1 < len(clusters) else nbars
            end = min(nxt, max(end, first + min_bars))
        if first < cursor:
            first = cursor
        if end <= first:
            continue
        if first > cursor:
            # instrumental gap between vocal clusters (or pre-vocal lead-in if no Intro)
            gap_end = first
            if gap_end - cursor >= 1:
                if cursor == 0 and body_i == 0:
                    kind, name = "intro", "Intro"
                elif body_i > 0:
                    kind, name = "bridge", "Bridge"
                else:
                    kind, name = "verse", f"A{body_i}"
                secs.append(_sec(len(secs), cursor, gap_end, kind, name))
                if kind != "intro":
                    body_i += 1
        texts = c["texts"]
        norms = [" ".join(t.lower().split()) for t in texts]
        hit_repeat = [n for n in norms if n in repeatable]
        is_chorus = bool(hit_repeat) and any(n in seen_repeatable for n in hit_repeat)
        for n in hit_repeat:
            seen_repeatable.add(n)
        if is_chorus:
            n_chorus = sum(1 for s in secs if s.get("kind") == "chorus") + 1
            kind, name = "chorus", "Chorus" if n_chorus == 1 else f"Chorus {n_chorus}"
        else:
            n_verse = sum(1 for s in secs if s.get("kind") == "verse") + 1
            kind, name = "verse", "Verse" if n_verse == 1 else f"Verse {n_verse}"
        # lyric cue stored for semantic merge
        cue = texts[0][:80]
        secs.append(_sec(len(secs), first, end, kind, name, lyric_cue=cue))
        cursor = end
        body_i += 1

    if cursor < nbars:
        rem = nbars - cursor
        if rem >= min_bars:
            secs.append(_sec(len(secs), cursor, nbars, "tag", "Outro"))
        elif secs:
            secs[-1]["end"] = nbars
        else:
            secs.append(_sec(0, 0, nbars, "verse", "A"))

    # Ensure full coverage 0..nbars
    if not secs:
        return []
    secs[0]["first"] = 0
    secs[-1]["end"] = nbars
    for i in range(1, len(secs)):
        if secs[i]["first"] < secs[i - 1]["end"]:
            secs[i]["first"] = secs[i - 1]["end"]
        if secs[i]["first"] > secs[i - 1]["end"]:
            # close hole into previous
            secs[i - 1]["end"] = secs[i]["first"]
        if secs[i]["end"] <= secs[i]["first"]:
            secs[i]["end"] = min(nbars, secs[i]["first"] + 1)

    return [s for s in secs if s["end"] > s["first"]]


def _sec(
    si: int,
    first: int,
    end: int,
    kind: str,
    name: str,
    *,
    lyric_cue: str | None = None,
) -> dict:
    d: dict[str, Any] = {
        "id": f"s{si}",
        "name": name,
        "first": int(first),
        "end": int(end),
        "kind": kind,
        "ci": si % 8,
        "source": "whisper-gaps",
    }
    if lyric_cue:
        d["lyricCue"] = lyric_cue
    return d


def lyric_cues_by_section(secs: list[dict], segments: list[dict], bars: list[dict], nbars: int) -> dict[str, str]:
    """Map section id → short lyric snippet overlapping that section."""
    cues: dict[str, str] = {}
    for s in secs:
        t0 = float(bars[s["first"]]["t"]) if s["first"] < len(bars) else 0.0
        end_i = min(s["end"], nbars)
        t1 = float(bars[end_i]["t"]) if end_i < len(bars) else t0 + 1.0
        bits = []
        for seg in segments:
            st, en = float(seg.get("start", 0)), float(seg.get("end", 0))
            if en < t0 or st > t1:
                continue
            tx = (seg.get("text") or "").strip()
            if tx:
                bits.append(tx)
        if bits:
            cues[s["id"]] = bits[0][:100]
            cues[s.get("kind") or s["id"]] = cues[s["id"]]
    return cues


def enrich_semantic_with_lyrics(semantic: dict, transcription: dict, secs: list[dict], bars: list[dict], nbars: int) -> dict:
    """Add lyric cues into Feel cards; annotate semantic source."""
    segs = transcription.get("segments") or []
    if not segs or transcription.get("status") != "ok":
        return semantic
    cues = lyric_cues_by_section(secs, segs, bars, nbars)
    # Prefer per-section lyricCue stamped during mapping
    for s in secs:
        if s.get("lyricCue"):
            cues.setdefault(s["id"], s["lyricCue"])
            cues.setdefault(s.get("kind") or s["id"], s["lyricCue"])
    cards = dict(semantic.get("cards") or {})

    def apply_cue(kind: str, cue: str) -> None:
        card_list = list(cards.get(kind) or [])
        updated = []
        felt = False
        for c in card_list:
            if c.get("label") == "Feel":
                body = c.get("body") or ""
                if "Lyric cue:" not in body:
                    body = f"{body} Lyric cue: “{cue}”."
                updated.append({**c, "body": body})
                felt = True
            else:
                updated.append(c)
        if not felt:
            updated.append({"label": "Feel", "body": f"Lyric cue: “{cue}”."})
        cards[kind] = updated

    for kind, cue in list(cues.items()):
        if kind.startswith("s") and kind[1:].isdigit():
            continue  # apply via kind below; id-only keys still in lyrics.cues
        apply_cue(kind, cue)
    # Ensure every section kind in secs gets a cue card if we have one
    for s in secs:
        kind = s.get("kind") or s["id"]
        cue = s.get("lyricCue") or cues.get(kind) or cues.get(s["id"])
        if cue:
            apply_cue(kind, cue)

    semantic = {**semantic, "cards": cards}
    src = semantic.get("source") or ""
    if "whisper" not in src.lower():
        semantic["source"] = (src + " + whisper lyrics").strip(" +")
    semantic["lyrics"] = {
        "available": True,
        "model": transcription.get("model"),
        "segmentCount": len(segs),
        "cues": cues,
    }
    return semantic


def transcribe_path(
    audio_path: Path,
    *,
    job_id: str | None = None,
    model_size: str | None = None,
    max_seconds: float | None = None,
    language: str | None = "en",
) -> dict[str, Any]:
    """Run faster-whisper on a path; return bass.transcription.v1."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        return skipped_transcription(job_id, note=f"faster-whisper not importable: {e}")

    model_size = model_size or DEFAULT_MODEL
    try:
        audio, _sr = load_audio_mono_16k(audio_path, max_seconds=max_seconds)
    except Exception as e:
        return skipped_transcription(job_id, note=f"audio decode failed: {e}")

    try:
        model = WhisperModel(model_size, device="cpu", compute_type=DEFAULT_COMPUTE)
        seg_iter, info = model.transcribe(
            audio,
            language=language,
            word_timestamps=True,
            vad_filter=True,
        )
        segments = []
        for s in seg_iter:
            words = None
            if s.words:
                words = [[w.word, w.start, w.end] for w in s.words]
            text = (s.text or "").strip()
            if not text:
                continue
            segments.append(pack_segment(s.start, s.end, text, words))
        if not segments:
            return make_transcription(
                [],
                job_id=job_id,
                source="faster-whisper",
                model=model_size,
                audio_path=str(audio_path),
                status="ok",
                note="no speech segments (instrumental or silence)",
                language=getattr(info, "language", language),
            )
        return make_transcription(
            segments,
            job_id=job_id,
            source="faster-whisper",
            model=model_size,
            audio_path=str(audio_path),
            status="ok",
            language=getattr(info, "language", language),
        )
    except Exception as e:
        return skipped_transcription(job_id, note=f"whisper failed: {type(e).__name__}: {e}")


def whisper_python() -> Path | None:
    p = DEFAULT_WHISPER_PYTHON
    if p.is_file():
        return p
    # same interpreter if it has faster_whisper
    return None


def transcribe_via_subprocess(
    audio_path: Path,
    *,
    job_id: str | None = None,
    model_size: str | None = None,
    max_seconds: float | None = None,
) -> dict[str, Any]:
    """Invoke this module under BASS_WHISPER_PYTHON when current env lacks faster-whisper."""
    py = whisper_python()
    if py is None:
        return skipped_transcription(
            job_id,
            note="faster-whisper not installed; set BASS_WHISPER_PYTHON to a venv with it",
        )
    payload = {
        "audio": str(audio_path),
        "jobId": job_id,
        "model": model_size or DEFAULT_MODEL,
        "maxSeconds": max_seconds,
    }
    cmd = [str(py), str(Path(__file__).resolve()), "--json-in", "-"]
    proc = subprocess.run(
        cmd,
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if proc.returncode != 0:
        return skipped_transcription(
            job_id,
            note=f"whisper subprocess rc={proc.returncode}: {(proc.stderr or proc.stdout)[-600:]}",
        )
    try:
        return json.loads(proc.stdout)
    except Exception as e:
        return skipped_transcription(job_id, note=f"bad whisper stdout: {e}")


def resolve_audio_for_transcription(out_dir: Path | None, mix_path: Path) -> Path:
    """Prefer vocals stem, else mix."""
    if out_dir is not None:
        vocals = out_dir / "stems" / "vocals.wav"
        if vocals.exists():
            return vocals
    return mix_path


def run_transcription(
    audio_path: Path,
    *,
    job_id: str | None = None,
    model_size: str | None = None,
    max_seconds: float | None = None,
) -> dict[str, Any]:
    """Import-path first; fall back to whisper venv subprocess."""
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        return transcribe_via_subprocess(
            audio_path, job_id=job_id, model_size=model_size, max_seconds=max_seconds
        )
    return transcribe_path(
        audio_path, job_id=job_id, model_size=model_size, max_seconds=max_seconds
    )


if __name__ == "__main__":
    import argparse
    import sys

    ap = argparse.ArgumentParser(description="Transcribe audio with faster-whisper")
    ap.add_argument("audio", nargs="?")
    ap.add_argument("--json-in", help="Read JSON payload from file or -")
    ap.add_argument("--job-id")
    ap.add_argument("--model", default=None)
    ap.add_argument("--max-seconds", type=float, default=None)
    ap.add_argument("--out", help="Write JSON to path (default stdout)")
    args = ap.parse_args()

    if args.json_in:
        raw = sys.stdin.read() if args.json_in == "-" else Path(args.json_in).read_text()
        payload = json.loads(raw)
        result = transcribe_path(
            Path(payload["audio"]),
            job_id=payload.get("jobId"),
            model_size=payload.get("model"),
            max_seconds=payload.get("maxSeconds"),
        )
    else:
        if not args.audio:
            ap.error("audio path required")
        result = transcribe_path(
            Path(args.audio),
            job_id=args.job_id,
            model_size=args.model,
            max_seconds=args.max_seconds,
        )
    text = json.dumps(result, indent=2)
    if args.out:
        Path(args.out).write_text(text)
    else:
        print(text)
