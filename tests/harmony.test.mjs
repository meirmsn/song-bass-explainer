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

describe("Like a Prayer chorus IV quality", () => {
  it("chorus IV bars are Bb major (not Bbm stub)", () => {
    if (!existsSync(resourcePath)) return; // optional if work tree trimmed
    const r = JSON.parse(readFileSync(resourcePath, "utf8"));
    const chord = (bar) => r.raw.find((row) => row[0] === bar)?.[2];
    // Chorus 1/2 IV + vamp Bb roots formerly mislabeled Bbm
    for (const bar of [14, 18, 38, 42, 66, 70, 74, 78]) {
      expect(chord(bar), `bar ${bar}`).toBe("Bb");
    }
    expect(r.raw.some((row) => row[2] === "Bbm")).toBe(false);
    const harmony = (r.cards?.chorus || []).find((c) => c.label === "Harmony");
    expect(harmony?.body).toMatch(/F–C–Bb–Dm|F-C-Bb-Dm/);
    expect(harmony?.body).toMatch(/I–V–IV–vi|I-V-IV-vi/);
  });

  it("both LAP job study resources have no Bbm", () => {
    for (const p of jobPaths) {
      if (!existsSync(p)) continue;
      const r = JSON.parse(readFileSync(p, "utf8"));
      expect(r.raw.some((row) => row[2] === "Bbm"), p).toBe(false);
      expect(r.raw.find((row) => row[0] === 14)?.[2], `bar14 in ${p}`).toBe("Bb");
    }
  });
});
