#!/usr/bin/env python3
"""
Hybrid box GPU/CPU consumer for bass-private job queue.

Polls R2 bass-private for jobs/*/meta.json with status=queued (or resume running),
downloads audio via yt-dlp (falls back to /workspace/lap for Like a Prayer),
runs Demucs htdemucs 4-stem (bass/drums/other/vocals + mixed no_bass) + copies existing lap analysis when applicable,
Whisper (faster-whisper via BASS_WHISPER_PYTHON) for non-LAP lyric/section cues,
uploads artifacts, updates meta stages, writes wake/{id}.json when procedural ready.

Usage:
  /workspace/bass-tools/bin/python /workspace/bass-study/scripts/consume_jobs.py
  /workspace/bass-tools/bin/python /workspace/bass-study/scripts/consume_jobs.py --once
  /workspace/bass-tools/bin/python /workspace/bass-study/scripts/consume_jobs.py --job job_xxx
Env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
Optional: BASS_VENV=/workspace/v  BASS_WORK=/workspace/bass-study/work
          BASS_WHISPER_PYTHON=/workspace/.venv-whisper/bin/python  BASS_WHISPER_MODEL=base.en
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

try:
    import boto3
    from botocore.config import Config
except ImportError:
    # Prefer bass-tools venv
    alt = Path("/workspace/bass-tools/bin/python")
    if alt.exists() and Path(sys.executable).resolve() != alt.resolve():
        os.execv(str(alt), [str(alt), *sys.argv])
    raise

ACCOUNT = "91a68408014ad4deb94e432d231f4af8"
BUCKET = "bass-private"
ENDPOINT = f"https://{ACCOUNT}.r2.cloudflarestorage.com"
VENV = Path(os.environ.get("BASS_VENV", "/workspace/v"))
WORK = Path(os.environ.get("BASS_WORK", "/workspace/bass-study/work"))
LAP = Path("/workspace/lap")
DEMO_DATA = Path("/workspace/bass-study/public/js/demo-data.json")
YT_DLP = VENV / "bin" / "yt-dlp"
DEMUCS = VENV / "bin" / "demucs"
PY = VENV / "bin" / "python"
# Prefer nvm Node 22 for yt-dlp JS challenges; fall back to PATH node.
def _find_node() -> str | None:
    candidates = [
        os.environ.get("BASS_NODE"),
        str(Path.home() / ".nvm/versions/node/v22.23.4/bin/node"),
        shutil.which("node"),
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    return None
NODE_BIN = _find_node()

# Known fallback: Miley Cyrus Like a Prayer live (test URL used in queued jobs)
LAP_FALLBACK_VIDEO_IDS = {"C0IQm-MXh2s"}
LAP_TITLE_HINTS = ("like a prayer",)


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def s3_client():
    key = os.environ.get("R2_ACCESS_KEY_ID")
    secret = os.environ.get("R2_SECRET_ACCESS_KEY")
    if not key or not secret:
        raise SystemExit("R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY required")
    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id=key,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def put_json(s3, key: str, data: dict):
    body = json.dumps(data, indent=2).encode("utf-8")
    s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType="application/json")


def put_file(s3, key: str, path: Path, content_type: str):
    extra = {"ContentType": content_type}
    s3.upload_file(str(path), BUCKET, key, ExtraArgs=extra)


def get_json(s3, key: str):
    obj = s3.get_object(Bucket=BUCKET, Key=key)
    return json.loads(obj["Body"].read())


def list_job_metas(s3):
    metas = []
    token = None
    while True:
        kw = {"Bucket": BUCKET, "Prefix": "jobs/", "MaxKeys": 200}
        if token:
            kw["ContinuationToken"] = token
        r = s3.list_objects_v2(**kw)
        for o in r.get("Contents") or []:
            if o["Key"].endswith("/meta.json"):
                try:
                    metas.append(get_json(s3, o["Key"]))
                except Exception as e:
                    print("skip meta", o["Key"], e)
        if not r.get("IsTruncated"):
            break
        token = r.get("NextContinuationToken")
    return metas


def stage_done(s3, job_id: str, name: str) -> bool:
    try:
        s3.head_object(Bucket=BUCKET, Key=f"jobs/{job_id}/stages/{name}.json")
        return True
    except Exception:
        return False


def mark_stage(s3, job: dict, name: str, ok: bool = True, detail: dict | None = None):
    job_id = job["id"]
    payload = {
        "stage": name,
        "ok": ok,
        "at": utcnow(),
        "detail": detail or {},
    }
    put_json(s3, f"jobs/{job_id}/stages/{name}.json", payload)
    job.setdefault("stages", {})[name] = {"ok": ok, "at": payload["at"]}
    job["stage"] = name
    job["updatedAt"] = payload["at"]
    if ok:
        job["status"] = "running" if name not in ("wake", "ready") else job.get("status", "running")
    put_json(s3, f"jobs/{job_id}/meta.json", job)
    print(f"[{job_id}] stage={name} ok={ok}")


def fail_job(s3, job: dict, err: str):
    job["status"] = "failed"
    job["lastError"] = err[:2000]
    job["updatedAt"] = utcnow()
    job["stage"] = "failed"
    put_json(s3, f"jobs/{job['id']}/meta.json", job)
    put_json(
        s3,
        f"jobs/{job['id']}/stages/failed.json",
        {"stage": "failed", "ok": False, "at": job["updatedAt"], "error": err[:2000]},
    )
    print(f"[{job['id']}] FAILED: {err[:200]}")


def video_id_from_url(url: str) -> str | None:
    from urllib.parse import urlparse, parse_qs

    try:
        u = urlparse(url)
        if "youtu.be" in u.netloc:
            return u.path.strip("/").split("/")[0] or None
        qs = parse_qs(u.query)
        if "v" in qs:
            return qs["v"][0]
        parts = u.path.strip("/").split("/")
        if "shorts" in parts or "live" in parts:
            return parts[-1]
    except Exception:
        return None
    return None


def use_lap_fallback(job: dict) -> bool:
    vid = video_id_from_url(job.get("url") or "")
    if vid in LAP_FALLBACK_VIDEO_IDS:
        return True
    title = (job.get("title") or "").lower()
    if any(h in title for h in LAP_TITLE_HINTS):
        return True
    return False


def download_audio(job: dict, out_dir: Path) -> tuple[Path, dict]:
    """Return (wav_path, info_dict). Uses yt-dlp; falls back to lap.wav."""
    out_dir.mkdir(parents=True, exist_ok=True)
    info = {
        "url": job.get("url"),
        "title": job.get("title"),
        "method": None,
        "fallback": False,
        "yt_error": None,
    }
    wav = out_dir / "audio.wav"
    vid = video_id_from_url(job.get("url") or "")

    # Prefer local fallback for known LAP to avoid YT blocks / save time in v1
    if use_lap_fallback(job) and (LAP / "lap.wav").exists():
        shutil.copy2(LAP / "lap.wav", wav)
        if (LAP / "mono.wav").exists():
            shutil.copy2(LAP / "mono.wav", out_dir / "mono.wav")
        info.update(
            {
                "method": "local_fallback",
                "fallback": True,
                "video_id": vid,
                "local_source": str(LAP / "lap.wav"),
                "note": "yt-dlp skipped for known Like a Prayer test; used /workspace/lap/lap.wav",
            }
        )
        return wav, info

    # Try yt-dlp
    if not YT_DLP.exists():
        info["yt_error"] = "yt-dlp binary missing"
    else:
        tmpl = str(out_dir / "dl.%(ext)s")
        cmd = [
            str(YT_DLP),
            "-f",
            "bestaudio/best",
            "-x",
            "--audio-format",
            "wav",
            "--audio-quality",
            "0",
            "-o",
            tmpl,
            "--no-playlist",
            "--write-info-json",
        ]
        if NODE_BIN:
            cmd += ["--js-runtimes", f"node:{NODE_BIN}", "--remote-components", "ejs:github"]
        cmd.append(job["url"])
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if proc.returncode == 0:
                # find wav
                found = list(out_dir.glob("dl*.wav"))
                if found:
                    found[0].rename(wav)
                    info["method"] = "yt-dlp"
                    info["video_id"] = vid
                    ij = list(out_dir.glob("dl*.info.json"))
                    if ij:
                        try:
                            meta = json.loads(ij[0].read_text())
                            info["yt_title"] = meta.get("title")
                            info["duration"] = meta.get("duration")
                            info["uploader"] = meta.get("uploader")
                        except Exception:
                            pass
                    return wav, info
            info["yt_error"] = (proc.stderr or proc.stdout or "yt-dlp failed")[-1500:]
        except Exception as e:
            info["yt_error"] = str(e)

    # Fallback path for LAP if yt failed
    if (LAP / "lap.wav").exists() and (
        use_lap_fallback(job) or "like a prayer" in (info.get("yt_title") or "").lower()
    ):
        shutil.copy2(LAP / "lap.wav", wav)
        info["method"] = "local_fallback_after_yt_fail"
        info["fallback"] = True
        info["local_source"] = str(LAP / "lap.wav")
        info["note"] = "yt-dlp blocked/failed; used /workspace/lap/lap.wav"
        return wav, info

    raise RuntimeError(f"download failed: {info.get('yt_error') or 'no audio'}")




def _job_stems_meta(out_dir: Path, job_id: str | None) -> dict:
    stems_dir = out_dir / "stems"
    has_m4a = (stems_dir / "bass.m4a").exists() and (stems_dir / "no_bass.m4a").exists()
    has_drums_m4a = (stems_dir / "drums.m4a").exists()
    has_drums_wav = (stems_dir / "drums.wav").exists()
    prefix = f"/private/api/jobs/{job_id}/stems" if job_id else "stems"
    ext = "m4a" if has_m4a else "wav"
    drums_ext = "m4a" if has_drums_m4a else ("wav" if has_drums_wav else None)
    meta = {
        "bass": f"{prefix}/bass.{ext}",
        "no_bass": f"{prefix}/no_bass.{ext}",
        "other": f"{prefix}/other.wav",
        "bass_wav": f"{prefix}/bass.wav",
        "no_bass_wav": f"{prefix}/no_bass.wav",
        "available": True,
        "access": "private",
        "muteBassSupported": True,
        "drumsAvailable": bool(drums_ext),
        "dbSupported": bool(drums_ext),
        "format": "aac" if has_m4a else "wav",
    }
    if drums_ext:
        meta["drums"] = f"{prefix}/drums.{drums_ext}"
        meta["drums_wav"] = f"{prefix}/drums.wav"
    return meta

def encode_stems_m4a(stems_dir: Path, bitrate: str = "160k") -> list[str]:
    """Encode bass/no_bass/drums WAV stems to AAC m4a for fast Web Audio decode (Safari/Chrome)."""
    written = []
    for name in ("bass", "no_bass", "drums"):
        wav = stems_dir / f"{name}.wav"
        m4a = stems_dir / f"{name}.m4a"
        if not wav.exists():
            continue
        if m4a.exists() and m4a.stat().st_mtime >= wav.stat().st_mtime:
            written.append(m4a.name)
            continue
        cmd = [
            "ffmpeg", "-y", "-i", str(wav),
            "-c:a", "aac", "-b:a", bitrate,
            "-movflags", "+faststart",
            str(m4a),
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg m4a {name} failed: {(proc.stderr or '')[-400:]}")
        written.append(m4a.name)
    return written

def _mix_no_bass(drums: Path, other: Path, vocals: Path, dest: Path) -> None:
    """Mix drums+other+vocals → no_bass.wav (full mix minus bass)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", str(drums), "-i", str(other), "-i", str(vocals),
        "-filter_complex", "amix=inputs=3:duration=longest:normalize=0",
        "-c:a", "pcm_s16le",
        str(dest),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg no_bass mix failed: {(proc.stderr or '')[-400:]}")


def run_demucs(wav: Path, out_dir: Path) -> dict:
    """Run htdemucs 4-stem; write bass/drums/other/vocals + mixed no_bass."""
    out_dir.mkdir(parents=True, exist_ok=True)
    stems_dir = out_dir / "stems"
    stems_dir.mkdir(exist_ok=True)

    # Reuse LAP shared stems (2-stem + drums from 4-stem pass) when source matches.
    existing_bass = WORK / "stems" / "htdemucs" / "lap" / "bass.wav"
    existing_nobass = WORK / "stems" / "htdemucs" / "lap" / "no_bass.wav"
    existing_drums = WORK / "stems" / "htdemucs" / "lap" / "drums.wav"
    shared4 = WORK / "stems4" / "htdemucs" / "lap"
    if use_shared_lap(wav) and existing_bass.exists() and existing_nobass.exists():
        shutil.copy2(existing_bass, stems_dir / "bass.wav")
        shutil.copy2(existing_nobass, stems_dir / "no_bass.wav")
        shutil.copy2(existing_nobass, stems_dir / "other.wav")
        files = ["bass.wav", "no_bass.wav", "other.wav"]
        if existing_drums.exists():
            shutil.copy2(existing_drums, stems_dir / "drums.wav")
            files.append("drums.wav")
        elif (shared4 / "drums.wav").exists():
            shutil.copy2(shared4 / "drums.wav", stems_dir / "drums.wav")
            files.append("drums.wav")
        return {
            "model": "htdemucs",
            "mode": "4-stem+reuse",
            "reused": str(existing_bass.parent),
            "files": files,
        }

    cmd = [
        str(DEMUCS),
        "-n",
        "htdemucs",
        "-o",
        str(out_dir / "demucs_out"),
        str(wav),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    log_path = out_dir / "demucs.log"
    log_path.write_text((proc.stdout or "") + "\n" + (proc.stderr or ""))
    if proc.returncode != 0:
        raise RuntimeError(f"demucs failed rc={proc.returncode}: {(proc.stderr or '')[-800:]}")

    found_bass = list((out_dir / "demucs_out").rglob("bass.wav"))
    found_drums = list((out_dir / "demucs_out").rglob("drums.wav"))
    found_other = list((out_dir / "demucs_out").rglob("other.wav"))
    found_vocals = list((out_dir / "demucs_out").rglob("vocals.wav"))
    if not found_bass or not found_drums or not found_other or not found_vocals:
        raise RuntimeError("demucs 4-stem missing bass/drums/other/vocals")
    shutil.copy2(found_bass[0], stems_dir / "bass.wav")
    shutil.copy2(found_drums[0], stems_dir / "drums.wav")
    shutil.copy2(found_other[0], stems_dir / "other.wav")
    shutil.copy2(found_vocals[0], stems_dir / "vocals.wav")
    _mix_no_bass(found_drums[0], found_other[0], found_vocals[0], stems_dir / "no_bass.wav")
    return {
        "model": "htdemucs",
        "mode": "4-stem",
        "reused": False,
        "files": ["bass.wav", "drums.wav", "other.wav", "vocals.wav", "no_bass.wav"],
        "log": "demucs.log",
    }


def use_shared_lap(wav: Path) -> bool:
    # Same size as lap.wav ⇒ reuse shared demucs output
    try:
        return wav.resolve() == (LAP / "lap.wav").resolve() or (
            wav.stat().st_size == (LAP / "lap.wav").stat().st_size
        )
    except Exception:
        return False


def _import_analyze():
    """Load scripts/analyze_audio.py (librosa stack in BASS_VENV)."""
    import importlib.util

    path = Path(__file__).resolve().parent / "analyze_audio.py"
    # Prefer analyzing with /workspace/v python deps — this process may be bass-tools.
    # analyze_audio imports librosa; if missing, run as subprocess with VENV python.
    try:
        import librosa  # noqa: F401
    except ImportError:
        return None
    spec = importlib.util.spec_from_file_location("bass_analyze_audio", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(mod)
    return mod


def run_generic_analysis(job: dict, out_dir: Path) -> dict:
    """Compute beat/procedural/semantic via analyze_audio (subprocess if needed)."""
    wav = out_dir / "source" / "audio.wav"
    if not wav.exists():
        raise FileNotFoundError(f"missing {wav}")
    title = job.get("title")
    info_path = out_dir / "source" / "info.json"
    artist = None
    if info_path.exists():
        try:
            info = json.loads(info_path.read_text())
            title = title or info.get("yt_title") or info.get("title")
            artist = info.get("uploader")
        except Exception:
            pass
    vocals = out_dir / "stems" / "vocals.wav"
    vocals_path = vocals if vocals.exists() else None
    mod = _import_analyze()
    if mod is not None:
        res = mod.analyze_wav(
            wav,
            title=title,
            artist=artist,
            job_id=job["id"],
            out_dir=out_dir,
            vocals_path=vocals_path,
        )
        written = mod.write_analysis(out_dir, res)
        mod.merge_study(out_dir, job["id"])
        tr = res.get("transcription") or {}
        return {
            "files": written + ["merge-report.json"],
            "used": ["analyze_audio.py", "whisper_transcribe.py"],
            "mode": "generic_inline",
            "bpm": res["procedural"].get("bpm"),
            "nbars": res["procedural"].get("nbars"),
            "transcription": tr.get("status"),
            "whisperSegments": len(tr.get("segments") or []),
            "auto_ready": True,
        }
    # Subprocess with ML venv
    cmd = [
        str(PY),
        str(Path(__file__).resolve().parent / "analyze_audio.py"),
        str(wav),
        "--out",
        str(out_dir),
        "--job-id",
        job["id"],
    ]
    if title:
        cmd += ["--title", str(title)]
    if artist:
        cmd += ["--artist", str(artist)]
    if vocals_path is not None:
        cmd += ["--vocals", str(vocals_path)]
    # Allow longer wall time when Whisper runs on CPU
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=2400)
    if proc.returncode != 0:
        raise RuntimeError(f"analyze_audio failed: {(proc.stderr or proc.stdout)[-1200:]}")
    ad = out_dir / "analysis"
    return {
        "files": sorted(p.name for p in ad.glob("*.json")),
        "used": ["analyze_audio.py:subprocess"],
        "mode": "generic_subprocess",
        "stdout": (proc.stdout or "")[-500:],
        "auto_ready": True,
    }


def build_analysis(job: dict, out_dir: Path) -> dict:
    """Copy LAP precomputed analysis, else run generic librosa analyzer (no stubs)."""
    ad = out_dir / "analysis"
    ad.mkdir(exist_ok=True)

    if use_lap_fallback(job):
        used = []
        for name, src in [
            ("beat.json", WORK / "beat.json"),
            ("transcription.json", WORK / "transcription.json"),
            ("procedural.json", WORK / "procedural.json"),
        ]:
            if src.exists():
                shutil.copy2(src, ad / name)
                used.append(f"work/{name}")
            elif name == "beat.json" and (LAP / "bt_librosa.json").exists():
                bt = json.loads((LAP / "bt_librosa.json").read_text())
                (ad / name).write_text(
                    json.dumps({"source": "bt_librosa.json", "raw_keys": list(bt)[:5], "grid": {"bpm": 112}}, indent=2)
                )
                used.append("lap/bt_librosa.json")
            elif name == "transcription.json" and (LAP / "whisper.json").exists():
                wh = json.loads((LAP / "whisper.json").read_text())
                (ad / name).write_text(json.dumps({"source": "whisper.small.en", "segments": wh}, indent=2))
                used.append("lap/whisper.json")
            elif name == "procedural.json" and DEMO_DATA.exists():
                demo = json.loads(DEMO_DATA.read_text())
                proc = {
                    "schema": "bass.procedural.v1",
                    "status": "ok",
                    "title": demo["title"],
                    "artist": demo["artist"],
                    "bpm": demo["bpm"],
                    "timeSig": demo["timeSig"],
                    "keys": demo["keys"],
                    "duration": demo["duration"],
                    "nbars": demo["nbars"],
                    "raw": demo["raw"],
                    "secs": demo["secs"],
                    "source": "demo-data.json",
                }
                (ad / name).write_text(json.dumps(proc, indent=2))
                used.append("demo-data.json")
        return {
            "files": sorted(p.name for p in ad.glob("*.json")),
            "used": used,
            "mode": "lap_precomputed",
            "auto_ready": False,
        }

    return run_generic_analysis(job, out_dir)


def write_study_resource(out_dir: Path, job_id: str | None = None) -> Path | None:
    """Merge procedural (+ semantic if present) into study/resource.json."""
    # Prefer analyzer merge if already written
    existing = out_dir / "study" / "resource.json"
    sem_path = out_dir / "analysis" / "semantic.json"
    if existing.exists() and sem_path.exists():
        try:
            res = json.loads(existing.read_text())
            if res.get("cards") and res.get("merge", {}).get("waiting_bot") is False:
                return existing
        except Exception:
            pass
    if sem_path.exists():
        mod = _import_analyze()
        if mod is not None:
            return mod.merge_study(out_dir, job_id)
        # subprocess merge already done by analyze_audio CLI
        if existing.exists():
            return existing
    proc_path = out_dir / "analysis" / "procedural.json"
    if not proc_path.exists():
        return None
    proc = json.loads(proc_path.read_text())
    if proc.get("status") == "stub":
        return None
    resource = {
        "schema": "bass.study.v1",
        "title": proc.get("title"),
        "artist": proc.get("artist"),
        "bpm": proc.get("bpm"),
        "timeSig": proc.get("timeSig"),
        "keys": proc.get("keys"),
        "duration": proc.get("duration"),
        "nbars": proc.get("nbars"),
        "raw": proc.get("raw"),
        "secs": proc.get("secs"),
        "stems": _job_stems_meta(out_dir, job_id),
        "semantic": None,
        "merge": {"procedural_only": True, "waiting_bot": True},
    }
    sd = out_dir / "study"
    sd.mkdir(exist_ok=True)
    out = sd / "resource.json"
    out.write_text(json.dumps(resource, indent=2))
    return out


def upload_job_artifacts(s3, job_id: str, out_dir: Path):
    mapping = []
    # source
    for name in ("audio.wav", "mono.wav", "info.json"):
        p = out_dir / "source" / name if name != "info.json" else out_dir / "source" / "info.json"
        # we store info under source/
        pass
    src = out_dir / "source"
    if src.exists():
        for p in src.iterdir():
            if p.is_file():
                ct = "audio/wav" if p.suffix == ".wav" else "application/json"
                key = f"jobs/{job_id}/source/{p.name}"
                put_file(s3, key, p, ct)
                mapping.append(key)
    stems = out_dir / "stems"
    if stems.exists():
        for p in stems.glob("*.wav"):
            key = f"jobs/{job_id}/stems/{p.name}"
            put_file(s3, key, p, "audio/wav")
            mapping.append(key)
        for p in stems.glob("*.m4a"):
            key = f"jobs/{job_id}/stems/{p.name}"
            put_file(s3, key, p, "audio/mp4")
            mapping.append(key)
    analysis = out_dir / "analysis"
    if analysis.exists():
        for p in analysis.glob("*.json"):
            key = f"jobs/{job_id}/analysis/{p.name}"
            put_file(s3, key, p, "application/json")
            mapping.append(key)
    study = out_dir / "study"
    if study.exists():
        for p in study.glob("*.json"):
            key = f"jobs/{job_id}/study/{p.name}"
            put_file(s3, key, p, "application/json")
            mapping.append(key)
    return mapping


def process_job(s3, job: dict):
    job_id = job["id"]
    out_dir = WORK / "jobs" / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    job["status"] = "running"
    job["updatedAt"] = utcnow()
    job["worker"] = {"host": "box-hybrid", "venv": str(VENV)}
    put_json(s3, f"jobs/{job_id}/meta.json", job)

    try:
        # download
        if not stage_done(s3, job_id, "download"):
            src_dir = out_dir / "source"
            wav, info = download_audio(job, src_dir)
            # normalize name
            if wav.name != "audio.wav":
                dest = src_dir / "audio.wav"
                if wav != dest:
                    shutil.copy2(wav, dest)
                wav = dest
            (src_dir / "info.json").write_text(json.dumps(info, indent=2))
            put_file(s3, f"jobs/{job_id}/source/audio.wav", wav, "audio/wav")
            put_json(s3, f"jobs/{job_id}/source/info.json", info)
            mark_stage(s3, job, "download", True, {"method": info.get("method"), "fallback": info.get("fallback")})
        else:
            print(f"[{job_id}] skip download")

        # demucs
        if not stage_done(s3, job_id, "demucs"):
            wav = out_dir / "source" / "audio.wav"
            if not wav.exists():
                # re-fetch from R2
                wav.parent.mkdir(parents=True, exist_ok=True)
                s3.download_file(BUCKET, f"jobs/{job_id}/source/audio.wav", str(wav))
            detail = run_demucs(wav, out_dir)
            for name in ("bass.wav", "no_bass.wav", "other.wav", "drums.wav", "vocals.wav"):
                p = out_dir / "stems" / name
                if p.exists():
                    put_file(s3, f"jobs/{job_id}/stems/{name}", p, "audio/wav")
            try:
                m4as = encode_stems_m4a(out_dir / "stems")
                for name in m4as:
                    put_file(s3, f"jobs/{job_id}/stems/{name}", out_dir / "stems" / name, "audio/mp4")
                detail = {**detail, "m4a": m4as}
            except Exception as enc_err:
                print(f"[{job_id}] m4a encode skipped: {enc_err}")
            mark_stage(s3, job, "demucs", True, detail)
        else:
            print(f"[{job_id}] skip demucs")

        # beat + transcribe + procedural (+ generic semantic for non-LAP)
        detail = {"auto_ready": False, "used": [], "files": []}
        if not stage_done(s3, job_id, "beat"):
            detail = build_analysis(job, out_dir)
            for p in (out_dir / "analysis").glob("*.json"):
                put_file(s3, f"jobs/{job_id}/analysis/{p.name}", p, "application/json")
            mark_stage(s3, job, "beat", True, {"files": detail.get("files"), "mode": detail.get("mode")})
            mark_stage(s3, job, "transcribe", True, {"used": detail.get("used")})
            mark_stage(s3, job, "procedural", True, {"used": detail.get("used"), "bpm": detail.get("bpm")})
            if (out_dir / "analysis" / "semantic.json").exists():
                mark_stage(s3, job, "semantic", True, {"mode": detail.get("mode")})
        else:
            print(f"[{job_id}] skip analysis")
            # If analysis exists locally from a prior partial run, detect auto_ready
            sem = out_dir / "analysis" / "semantic.json"
            proc = out_dir / "analysis" / "procedural.json"
            if sem.exists() and proc.exists():
                try:
                    pr = json.loads(proc.read_text())
                    detail["auto_ready"] = pr.get("status") == "ok" and not use_lap_fallback(job)
                except Exception:
                    pass

        res = write_study_resource(out_dir, job_id)
        if res:
            put_file(s3, f"jobs/{job_id}/study/resource.json", res, "application/json")

        auto_ready = bool(detail.get("auto_ready")) or (
            (out_dir / "analysis" / "semantic.json").exists() and not use_lap_fallback(job)
        )

        if auto_ready and res:
            mark_stage(s3, job, "merge", True, {"analyzer": "analyze_audio.py"})
            mark_stage(s3, job, "ready", True, {})
            wake = {
                "type": "bass.job.ready",
                "jobId": job_id,
                "at": utcnow(),
                "status": "ready",
                "artifacts": {
                    "procedural": f"jobs/{job_id}/analysis/procedural.json",
                    "semantic": f"jobs/{job_id}/analysis/semantic.json",
                    "study": f"jobs/{job_id}/study/resource.json",
                    "stems": f"jobs/{job_id}/stems/",
                },
                "analyzer": "scripts/analyze_audio.py",
                "next": [],
            }
            put_json(s3, f"wake/{job_id}.json", wake)
            job["status"] = "ready"
            job["stage"] = "ready"
            job["updatedAt"] = utcnow()
            job["notes"] = "Generic librosa analysis + semantic merge complete (auto-ready)."
            job.setdefault("artifacts", {})["uploaded"] = True
            put_json(s3, f"jobs/{job_id}/meta.json", job)
            print(f"[{job_id}] ready — generic analysis merged")
            return True

        # LAP / bot path: procedural ready, wait for richer semantic
        if res:
            mark_stage(s3, job, "study_stub", True, {"waiting_bot": True})
        wake = {
            "type": "bass.job.procedural_ready",
            "jobId": job_id,
            "at": utcnow(),
            "status": "waiting_bot",
            "artifacts": {
                "procedural": f"jobs/{job_id}/analysis/procedural.json",
                "beat": f"jobs/{job_id}/analysis/beat.json",
                "transcription": f"jobs/{job_id}/analysis/transcription.json",
                "stems": f"jobs/{job_id}/stems/",
                "study": f"jobs/{job_id}/study/resource.json",
            },
            "instruction": "Pull procedural.json + analysis; write analysis/semantic.json (flashcards/patterns); merge into study/resource.json; set meta status=ready.",
            "next": ["semantic_bot", "merge", "ready"],
        }
        put_json(s3, f"wake/{job_id}.json", wake)
        job["status"] = "waiting_bot"
        job["stage"] = "wake"
        job["updatedAt"] = utcnow()
        job["notes"] = "Procedural pipeline done on box; waiting for Bass bot semantic merge."
        job.setdefault("artifacts", {})["uploaded"] = True
        put_json(s3, f"jobs/{job_id}/meta.json", job)
        mark_stage(s3, job, "wake", True, {"wake_key": f"wake/{job_id}.json"})
        print(f"[{job_id}] waiting_bot — wake written")
        return True
    except Exception as e:
        traceback.print_exc()
        fail_job(s3, job, f"{type(e).__name__}: {e}")
        return False


def pick_jobs(s3, only: str | None = None):
    metas = list_job_metas(s3)
    if only:
        return [m for m in metas if m.get("id") == only]
    # Prefer queued; also resume stuck running older than nothing for now
    queued = [m for m in metas if m.get("status") == "queued"]
    # Process one at a time for CPU demucs
    queued.sort(key=lambda m: m.get("createdAt") or "")
    return queued


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="Process available jobs then exit")
    ap.add_argument("--job", help="Process a specific job id")
    ap.add_argument("--poll", type=int, default=30, help="Poll seconds when looping")
    ap.add_argument("--limit", type=int, default=2, help="Max jobs per cycle")
    args = ap.parse_args()
    s3 = s3_client()
    WORK.mkdir(parents=True, exist_ok=True)

    while True:
        jobs = pick_jobs(s3, args.job)
        if args.job and not jobs:
            # load directly
            try:
                jobs = [get_json(s3, f"jobs/{args.job}/meta.json")]
            except Exception:
                print("job not found", args.job)
                return 1
        if not jobs:
            print(utcnow(), "no queued jobs")
            if args.once or args.job:
                return 0
            time.sleep(args.poll)
            continue
        for job in jobs[: args.limit]:
            print(utcnow(), "processing", job["id"], job.get("title") or job.get("url"))
            process_job(s3, job)
        if args.once or args.job:
            return 0
        time.sleep(args.poll)


if __name__ == "__main__":
    sys.exit(main() or 0)
