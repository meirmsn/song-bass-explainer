#!/usr/bin/env python3
"""Unit tests for whisper section mapping / schema (no model download)."""
from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from whisper_transcribe import (
    bar_index_at,
    enrich_semantic_with_lyrics,
    make_transcription,
    map_segments_to_sections,
    pack_segment,
    resolve_audio_for_transcription,
)


class WhisperMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fix = json.loads((ROOT / "tests/fixtures/whisper-segments.json").read_text())

    def test_bar_index(self):
        bars = self.fix["bars"]
        nb = self.fix["nbars"]
        self.assertEqual(bar_index_at(0.0, bars, nb), 0)
        self.assertEqual(bar_index_at(8.0, bars, nb), 4)  # 2s/bar
        self.assertEqual(bar_index_at(63.9, bars, nb), 31)

    def test_map_sections_fixture(self):
        fx = self.fix
        secs = map_segments_to_sections(
            fx["segments"], fx["bars"], fx["nbars"], duration=fx["duration"]
        )
        exp = fx["expect"]
        self.assertGreaterEqual(len(secs), exp["minSections"])
        self.assertEqual(secs[0]["kind"], exp["firstKind"])
        self.assertEqual(secs[0]["first"], 0)
        self.assertEqual(secs[-1]["end"], fx["nbars"])
        kinds = {s["kind"] for s in secs}
        if exp["hasChorus"]:
            self.assertIn("chorus", kinds)
        # coverage contiguous
        for i in range(1, len(secs)):
            self.assertEqual(secs[i]["first"], secs[i - 1]["end"])

    def test_empty_segments_returns_empty(self):
        fx = self.fix
        self.assertEqual(
            map_segments_to_sections([], fx["bars"], fx["nbars"], duration=fx["duration"]),
            [],
        )

    def test_pack_and_schema(self):
        seg = pack_segment(1.0, 2.5, " hello ", [[" hi", 1.0, 1.5]])
        self.assertEqual(seg["text"], "hello")
        tr = make_transcription([seg], job_id="job_x", model="base.en")
        self.assertEqual(tr["schema"], "bass.transcription.v1")
        self.assertEqual(tr["status"], "ok")
        self.assertIn("hello", tr["text"])

    def test_enrich_semantic(self):
        fx = self.fix
        secs = map_segments_to_sections(
            fx["segments"], fx["bars"], fx["nbars"], duration=fx["duration"]
        )
        sem = {
            "schema": "bass.semantic.v1",
            "source": "generic analyzer",
            "cards": {
                "verse": [{"label": "Feel", "body": "moderate density."}],
                "chorus": [{"label": "Bass", "body": "root."}],
            },
        }
        tr = make_transcription(fx["segments"], job_id="j")
        out = enrich_semantic_with_lyrics(sem, tr, secs, fx["bars"], fx["nbars"])
        self.assertIn("whisper", out["source"].lower())
        self.assertTrue(out["lyrics"]["available"])
        # At least one of verse/chorus Feel cards carries a lyric cue
        found = False
        for kind in ("verse", "chorus"):
            for c in out["cards"].get(kind) or []:
                if c.get("label") == "Feel" and "Lyric cue:" in (c.get("body") or ""):
                    found = True
        self.assertTrue(found, msg=f"no lyric cue in cards keys={list(out['cards'])}")

    def test_resolve_prefers_vocals(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            stems = root / "stems"
            stems.mkdir()
            (stems / "vocals.wav").write_bytes(b"RIFF")
            mix = root / "mix.wav"
            mix.write_bytes(b"RIFF")
            self.assertEqual(resolve_audio_for_transcription(root, mix), stems / "vocals.wav")
            (stems / "vocals.wav").unlink()
            self.assertEqual(resolve_audio_for_transcription(root, mix), mix)


if __name__ == "__main__":
    unittest.main()
