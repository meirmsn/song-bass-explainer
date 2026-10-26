import { describe, it, expect } from "vitest";
import {
  stretchChannel,
  stretchAudioBuffer,
  estimateFreqHz,
  naiveResample,
  stemTempoUsesRawPlaybackRate,
} from "../src/timestretch.mjs";

function makeSine(freq, seconds, sampleRate = 44100) {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return out;
}

describe("timestretch WSOLA", () => {
  it("stemTempoUsesRawPlaybackRate is false (playbackRate alone is not pitch-preserving)", () => {
    expect(stemTempoUsesRawPlaybackRate()).toBe(false);
  });

  it("tempo 1 returns equal-length copy", () => {
    const s = makeSine(220, 0.05);
    const out = stretchChannel(s, 1, 44100);
    expect(out.length).toBe(s.length);
    expect(out[10]).toBeCloseTo(s[10], 5);
  });

  it("tempo 0.5 roughly doubles length", () => {
    const s = makeSine(220, 0.2);
    const out = stretchChannel(s, 0.5, 44100);
    expect(out.length).toBeGreaterThan(s.length * 1.8);
    expect(out.length).toBeLessThan(s.length * 2.2);
  });

  it("preserves pitch vs naive resample (which shifts like BufferSource.playbackRate)", () => {
    const sr = 44100;
    const freq = 220;
    const s = makeSine(freq, 0.6, sr);
    // Skip transient edges from overlap-add when estimating pitch.
    const mid = (arr) => arr.subarray(Math.floor(arr.length * 0.2), Math.floor(arr.length * 0.8));
    const stretched = stretchChannel(s, 0.5, sr);
    const naive = naiveResample(s, 0.5);

    const f0 = estimateFreqHz(mid(s), sr);
    const fStretch = estimateFreqHz(mid(stretched), sr);
    const fNaive = estimateFreqHz(mid(naive), sr);

    // Original ~220Hz
    expect(f0).toBeGreaterThan(200);
    expect(f0).toBeLessThan(240);

    // WSOLA should stay near original pitch (zero-crossing is approximate).
    expect(Math.abs(fStretch - f0) / f0).toBeLessThan(0.18);
    // Must remain well above the octave-down failure mode.
    expect(fStretch).toBeGreaterThan(f0 * 0.75);

    // Naive resample at 0.5 halves pitch (~110Hz) — the playbackRate failure mode
    expect(fNaive).toBeLessThan(f0 * 0.7);
    expect(Math.abs(fNaive - f0 / 2) / (f0 / 2)).toBeLessThan(0.15);

    // And WSOLA must not look like the naive (pitch-shifted) path
    expect(Math.abs(fStretch - fNaive)).toBeGreaterThan(40);
  });

  it("stretchAudioBuffer creates longer buffer via createBuffer", () => {
    const sr = 8000;
    const len = sr; // 1s
    const data = [makeSine(200, 1, sr)];
    const buf = {
      numberOfChannels: 1,
      length: len,
      sampleRate: sr,
      duration: 1,
      getChannelData: (i) => data[i] || data[0],
    };
    const createBuffer = (ch, length, sampleRate) => {
      const chans = Array.from({ length: ch }, () => new Float32Array(length));
      return {
        numberOfChannels: ch,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (i) => chans[i],
      };
    };
    const out = stretchAudioBuffer(buf, 0.5, createBuffer);
    expect(out.duration).toBeCloseTo(2, 1);
    expect(out.length).toBeGreaterThan(len * 1.8);
  });
});
