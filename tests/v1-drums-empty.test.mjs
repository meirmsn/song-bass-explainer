import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const resourcePath = join(root, "../work/demo-like-a-prayer/resource.json");
const jobPaths = [
  join(root, "../work/jobs/job_be8b7b8764414adc/study/resource.json"),
  join(root, "../work/jobs/job_1671bace4fd94547/study/resource.json"),
];
const playerSrc = readFileSync(join(root, "../public/js/player.js"), "utf8");

describe("v1-drums-empty: resource drumsOut independent of bass PEDAL", () => {
  it("resource keeps v1 PEDAL and ships drumsOutBars [[0,10]]", () => {
    if (!existsSync(resourcePath)) return;
    const r = JSON.parse(readFileSync(resourcePath, "utf8"));
    expect(r.patterns?.v1?.[0]?.id).toBe("pedal");
    expect(r.patterns.v1[0].notes.length).toBeGreaterThan(0);
    expect(r.patterns?.v1?.[0]?.id).not.toBe("empty");
    expect(r.drumsOutBars).toEqual([[0, 10]]);
    const intro = r.secs.find((s) => s.id === "intro");
    expect(intro?.drumsOut).toBe(true);
    const v1 = r.secs.find((s) => s.id === "v1");
    expect(v1?.drumsOut).not.toBe(true);
    expect(r.cards?.v1?.some((c) => /drums stay out|kit enters|stem-silent/i.test(c.body))).toBe(true);
    expect(r.merge?.v1_drums_empty?.bars).toEqual([0, 10]);
  });

  it("both LAP job study resources ship drumsOutBars + pedal v1", () => {
    for (const p of jobPaths) {
      if (!existsSync(p)) continue;
      const r = JSON.parse(readFileSync(p, "utf8"));
      expect(r.patterns?.v1?.[0]?.id, p).toBe("pedal");
      expect(r.drumsOutBars, p).toEqual([[0, 10]]);
    }
  });

  it("player models drumsOut independent of EMPTY / isRhythmOut", () => {
    expect(playerSrc).toMatch(/function isDrumsOut/);
    expect(playerSrc).toMatch(/function drumHitsForView/);
    expect(playerSrc).toMatch(/drumsOutBars/);
    expect(playerSrc).toMatch(/rests \(drums out\)/);
    expect(playerSrc).toMatch(/v1:\[PEDAL\]/);
    expect(playerSrc).not.toMatch(/v1:\[EMPTY\]/);
    expect(playerSrc).toMatch(/BASS_MIDI_VOICE/);
    expect(playerSrc).toMatch(/oscType:\s*"sine"/);
  });
});
