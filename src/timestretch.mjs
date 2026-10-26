/**
 * Pitch-preserving tempo change via WSOLA (Waveform Similarity Overlap-Add).
 * tempo < 1 slows; tempo > 1 speeds. Musical pitch is kept (not a resample).
 *
 * Player mirrors this in public/js/player.js — keep both in sync.
 */

/**
 * @param {Float32Array|ArrayLike<number>} input
 * @param {number} tempo playback tempo ratio (e.g. 0.5 = half speed)
 * @param {number} sampleRate
 * @param {{ frameLen?: number, seekWin?: number, synthHop?: number }} [options]
 * @returns {Float32Array}
 */
export function stretchChannel(input, tempo, sampleRate, options = {}) {
  const t = Number(tempo);
  if (!(t > 0) || !Number.isFinite(t)) {
    throw new Error("tempo must be a positive finite number");
  }
  const src = input instanceof Float32Array ? input : Float32Array.from(input);
  if (src.length === 0) return new Float32Array(0);
  if (Math.abs(t - 1) < 1e-9) return Float32Array.from(src);

  const sr = sampleRate > 0 ? sampleRate : 44100;
  const frameLen = options.frameLen || Math.max(64, Math.round(sr * 0.025));
  const seekWin = options.seekWin != null ? options.seekWin : Math.max(0, Math.round(sr * 0.012));
  const synthHop = options.synthHop || Math.max(1, Math.floor(frameLen / 2));
  const analHop = Math.max(1, Math.round(synthHop * t));

  const outLen = Math.max(frameLen, Math.ceil(src.length / t) + frameLen);
  const output = new Float32Array(outLen);
  const weight = new Float32Array(outLen);

  const window = new Float32Array(frameLen);
  for (let i = 0; i < frameLen; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1 || 1));
  }

  let readPos = 0;
  let writePos = 0;
  let first = true;

  while (writePos + frameLen < outLen && readPos + frameLen <= src.length) {
    let usePos = readPos;
    if (!first && seekWin > 0 && writePos > 0) {
      const searchStart = Math.max(0, readPos - seekWin);
      const searchEnd = Math.min(src.length - frameLen, readPos + seekWin);
      const overlapLen = Math.min(synthHop, writePos, frameLen);
      let bestCorr = -Infinity;
      let bestPos = readPos;
      for (let cand = searchStart; cand <= searchEnd; cand++) {
        let corr = 0;
        for (let i = 0; i < overlapLen; i++) {
          corr += output[writePos - overlapLen + i] * src[cand + i];
        }
        if (corr > bestCorr) {
          bestCorr = corr;
          bestPos = cand;
        }
      }
      usePos = bestPos;
    }

    for (let i = 0; i < frameLen; i++) {
      const w = window[i];
      const si = usePos + i;
      if (si >= src.length) break;
      output[writePos + i] += src[si] * w;
      weight[writePos + i] += w;
    }

    readPos = usePos + analHop;
    writePos += synthHop;
    first = false;
  }

  const exactLen = Math.max(1, Math.round(src.length / t));
  const trimmed = new Float32Array(exactLen);
  for (let i = 0; i < exactLen; i++) {
    const w = weight[i];
    trimmed[i] = w > 1e-8 ? output[i] / w : output[i];
  }
  return trimmed;
}

/**
 * Stretch an AudioBuffer-like object. Channels share analysis positions from ch0
 * (applied independently per channel for a simple, stable stretch).
 *
 * @param {{ numberOfChannels: number, length: number, sampleRate: number, duration?: number, getChannelData: (c:number)=>Float32Array }} buffer
 * @param {number} tempo
 * @param {(channels:number, length:number, sampleRate:number) => any} createBuffer
 * @param {object} [options]
 */
export function stretchAudioBuffer(buffer, tempo, createBuffer, options = {}) {
  const t = Number(tempo);
  if (!(t > 0) || !Number.isFinite(t)) {
    throw new Error("tempo must be a positive finite number");
  }
  if (Math.abs(t - 1) < 1e-9) return buffer;

  const chans = buffer.numberOfChannels || 1;
  const sr = buffer.sampleRate || 44100;
  const stretched = [];
  for (let c = 0; c < chans; c++) {
    stretched.push(stretchChannel(buffer.getChannelData(c), t, sr, options));
  }
  const len = stretched[0].length;
  const out = createBuffer(chans, len, sr);
  for (let c = 0; c < chans; c++) {
    const dest = out.getChannelData(c);
    dest.set(stretched[c].subarray(0, Math.min(dest.length, stretched[c].length)));
  }
  return out;
}

/** True when stem playback should use raw BufferSource.playbackRate for tempo (always false — that shifts pitch). */
export function stemTempoUsesRawPlaybackRate() {
  return false;
}

/**
 * Zero-crossing rate → rough dominant frequency estimate (Hz).
 * Used by tests to assert pitch preservation vs naive resample.
 */
export function estimateFreqHz(samples, sampleRate) {
  if (!samples || samples.length < 4) return 0;
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) crossings += 1;
  }
  const duration = samples.length / sampleRate;
  if (duration <= 0) return 0;
  return (crossings / 2) / duration;
}

/**
 * Naive resample that changes pitch the same way BufferSource.playbackRate does
 * when length is adjusted for the same wall-clock duration (test oracle).
 */
export function naiveResample(input, tempo) {
  const t = Number(tempo);
  const outLen = Math.max(1, Math.round(input.length / t));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * t;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = srcIdx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}
