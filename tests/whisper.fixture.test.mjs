import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = JSON.parse(readFileSync(join(root, "tests/fixtures/whisper-segments.json"), "utf8"));

describe("whisper fixture (pipeline contract)", () => {
  it("has bars covering nbars + sentinel", () => {
    expect(fx.nbars).toBe(32);
    expect(fx.bars.length).toBe(fx.nbars + 1);
    expect(fx.bars[0].t).toBe(0);
    expect(fx.bars[fx.nbars].beat_times).toEqual([]);
  });

  it("segments carry start/end/text for transcription.v1", () => {
    expect(fx.segments.length).toBeGreaterThan(2);
    for (const s of fx.segments) {
      expect(s.start).toBeLessThan(s.end);
      expect(String(s.text).length).toBeGreaterThan(0);
    }
  });

  it("documents expected section mapping outcomes", () => {
    expect(fx.expect.minSections).toBeGreaterThanOrEqual(3);
    expect(fx.expect.firstKind).toBe("intro");
    expect(fx.expect.hasChorus).toBe(true);
  });
});

describe("whisper transcription schema sample", () => {
  it("matches bass.transcription.v1 shape used by analyze_audio", () => {
    const sample = {
      schema: "bass.transcription.v1",
      status: "ok",
      source: "faster-whisper",
      model: "base.en",
      segments: fx.segments.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      })),
      jobId: "job_fixture",
      text: fx.segments.map((s) => s.text).join(" "),
    };
    expect(sample.schema).toBe("bass.transcription.v1");
    expect(sample.segments[0]).toHaveProperty("start");
    expect(sample.text.toLowerCase()).toContain("avenue");
  });
});
