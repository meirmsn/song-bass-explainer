import { describe, it, expect } from "vitest";
import {
  resolveStemUrls,
  buildStemsMeta,
  fmtClock,
  fmtBarBeat,
  fmtLoop,
  listenGains,
} from "../src/stems.mjs";

describe("resolveStemUrls", () => {
  it("prefers m4a / bass_m4a over wav", () => {
    const r = resolveStemUrls({
      bass: "/x/bass.wav",
      no_bass: "/x/no_bass.wav",
      bass_m4a: "/x/bass.m4a",
      no_bass_m4a: "/x/no_bass.m4a",
    });
    expect(r.bass).toBe("/x/bass.m4a");
    expect(r.noBass).toBe("/x/no_bass.m4a");
    expect(r.format).toBe("aac");
  });

  it("uses primary .m4a fields from Worker", () => {
    const r = resolveStemUrls({
      format: "aac",
      bass: "/private/api/demo/like-a-prayer/stems/bass.m4a",
      no_bass: "/private/api/demo/like-a-prayer/stems/no_bass.m4a",
      bass_wav: "/private/api/demo/like-a-prayer/stems/bass.wav",
      no_bass_wav: "/private/api/demo/like-a-prayer/stems/no_bass.wav",
    });
    expect(r.bass).toMatch(/\.m4a$/);
    expect(r.noBass).toMatch(/\.m4a$/);
    expect(r.format).toBe("aac");
  });


  it("resolves drums m4a when present", () => {
    const r = resolveStemUrls({
      bass: "/x/bass.m4a",
      no_bass: "/x/no_bass.m4a",
      drums: "/x/drums.m4a",
    });
    expect(r.drums).toBe("/x/drums.m4a");
  });
  it("falls back to wav", () => {
    const r = resolveStemUrls({
      bass: "/x/bass.wav",
      no_bass: "/x/no_bass.wav",
    });
    expect(r.bass).toBe("/x/bass.wav");
    expect(r.format).toBe("wav");
  });
});

describe("buildStemsMeta", () => {
  it("prefers aac when both m4a present", () => {
    const m = buildStemsMeta({
      hasBassM4a: true,
      hasNoBassM4a: true,
      hasBassWav: true,
      hasNoBassWav: true,
      hasDrumsM4a: true,
      hasDrumsWav: true,
      basePath: "/private/api/demo/like-a-prayer/stems",
    });
    expect(m.format).toBe("aac");
    expect(m.bass).toMatch(/bass\.m4a$/);
    expect(m.muteBassSupported).toBe(true);
    expect(m.drumsAvailable).toBe(true);
    expect(m.dbSupported).toBe(true);
    expect(m.drums).toMatch(/drums\.m4a$/);
    expect(m.bass_wav).toMatch(/bass\.wav$/);
  });

  it("wav-only when no m4a", () => {
    const m = buildStemsMeta({
      hasBassM4a: false,
      hasNoBassM4a: false,
      hasBassWav: true,
      hasNoBassWav: true,
      basePath: "/private/api/jobs/job_x/stems",
    });
    expect(m.format).toBe("wav");
    expect(m.bass).toMatch(/\.wav$/);
  });
});

describe("meta clock / bar formatting (stable widths)", () => {
  it("fmtClock keeps fixed fractional form", () => {
    expect(fmtClock(9.1)).toBe("0:09.1");
    expect(fmtClock(94.0)).toBe("1:34.0");
    expect(fmtClock(0)).toBe("0:00.0");
  });

  it("fmtBarBeat pads bar to 2 chars", () => {
    expect(fmtBarBeat(9, 0)).toBe("Bar  9 · beat 1");
    expect(fmtBarBeat(16, 0)).toBe("Bar 16 · beat 1");
    expect(fmtBarBeat(9, 0).length).toBe(fmtBarBeat(16, 0).length);
  });

  it("fmtLoop keeps slot when off", () => {
    expect(fmtLoop(12, 19, true)).toBe("Loop 12–19");
    expect(fmtLoop(12, 19, false)).toBe("Loop —");
  });
});

describe("listenGains", () => {
  it("maps full/solo/mute/db/drums", () => {
    expect(listenGains("full")).toEqual({ bass: 1, noBass: 1, drums: 0 });
    expect(listenGains("solo")).toEqual({ bass: 1, noBass: 0, drums: 0 });
    expect(listenGains("mute")).toEqual({ bass: 0, noBass: 1, drums: 0 });
    expect(listenGains("db", { drumsAvailable: true })).toEqual({ bass: 1, noBass: 0, drums: 1 });
    expect(listenGains("db", { drumsAvailable: false })).toEqual({ bass: 1, noBass: 0, drums: 0 });
    expect(listenGains("drums", { drumsAvailable: true })).toEqual({ bass: 0, noBass: 0, drums: 1 });
    expect(listenGains("drums", { drumsAvailable: false })).toEqual({ bass: 0, noBass: 0, drums: 0 });
  });
});
