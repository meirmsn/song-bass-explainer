# Whisper / non-LAP transcription

## What ships
- `scripts/whisper_transcribe.py` — faster-whisper runner + lyric→section mapping + semantic lyric cues
- `scripts/analyze_audio.py` — non-LAP path calls Whisper after librosa beat/chords; writes `analysis/transcription.json`; may replace crude `secs` with gap-based sections; enrich Feel cards with lyric cues
- `scripts/consume_jobs.py` — passes `stems/vocals.wav` when Demucs 4-stem produced it; uploads vocals; longer analyze timeout

## Where transcripts land
Per job (private R2 `bass-private` + local `work/jobs/<id>/`):
- `analysis/transcription.json` — `bass.transcription.v1` (`status`, `segments[]` with start/end/text/words, `model`)
- `analysis/procedural.json` — `secs` may include `source: "whisper-gaps"` + `lyricCue`
- `analysis/semantic.json` — `lyrics` block + Feel cards with `Lyric cue: “…”`
- `study/resource.json` — `transcription` summary `{status, model, segmentCount, path}`

LAP jobs still use precomputed `work/transcription.json` / bot semantic; Whisper auto-path is for **non-LAP** auto-ready jobs.

## Runtime
- Preferred venv: `BASS_WHISPER_PYTHON=/workspace/.venv-whisper/bin/python` (faster-whisper 1.2.x)
- Model default: `BASS_WHISPER_MODEL=base.en` (cached under `~/.cache/huggingface/hub/models--Systran--faster-whisper-base.en`)
- Audio decode: ffmpeg → 16 kHz mono float32 (avoids PyAV `metadata_errors` skew)
- CPU-only box: int8 compute (`BASS_WHISPER_COMPUTE=int8`)
- Optional cap: `BASS_WHISPER_MAX_SECONDS` for long tracks

## How a future job picks it up
1. Private intake enqueues a non-LAP YouTube URL → `status=queued`
2. `consume_jobs.py` download → Demucs 4-stem (writes `stems/vocals.wav`) → `analyze_audio.py`
3. Analyzer prefers vocals stem, else mix; runs Whisper (inline or subprocess to whisper venv)
4. Job auto-readies with richer `secs` / lyric cues (no bot wait), same as other non-LAP generics
5. Public site never lists private catalog; artifacts stay under Access `/private`

## Tests
```bash
# Pure mapping/schema (no model)
 /workspace/.venv-whisper/bin/python scripts/test_whisper_map.py -v

# Fixture contract (vitest; included in npm test)
npm test -- tests/whisper.fixture.test.mjs

# Optional dry-run on a short clip
 /workspace/.venv-whisper/bin/python scripts/whisper_transcribe.py /path/to/vocals.wav --out /tmp/tr.json
```

## Blockers / notes
- No GPU on this box — CPU int8 is fine for `base.en` on short/medium clips; full-song may take minutes
- Instrumental/CC0 clips correctly return `status=ok` with empty segments + note
- Do not expose licensed catalog on public `/`
