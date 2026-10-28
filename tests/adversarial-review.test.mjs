import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/adversarial_review.py");

function run(args) {
  try {
    const stdout = execFileSync("python3", [script, ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, out: stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      out: `${err.stdout || ""}\n${err.stderr || ""}`,
    };
  }
}

describe("adversarial insight review", () => {
  it("accepts Pocket Funk, Radio Pop, and Backbeat Rock", () => {
    const result = run([]);
    expect(result.out).toMatch(/adversarial review ok/);
    expect(result.status).toBe(0);
  });

  it("rejects a padded bar, a false pitch, a missing hit, and denial copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "adv-review-"));
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({
      secs: [{ id: "s", name: "S", first: 0, end: 1 }],
      bassHits: [{ bar: 0, step: 0, midi: 33 }],
      drumHits: [],
      raw: [[0, 0, "Am7", "A.C.E.G"], [1, 0, null, null]],
      patterns: { s: [{ notes: [{ step: 0, midi: 33 }], sectionBars: [0, 0] }] },
      cards: {
        s: [{
          label: "Figure",
          body: "there is no Bb (or other foreign chord) in what’s heard",
          insight: {
            layer: "figure",
            title: "A–G–C",
            barRange: [0, 1],
            highlights: [
              { step: 0, midi: 33, text: "C" },
              { step: 4, midi: 40, text: "E" },
            ],
          },
        }],
      },
    }));
    const result = run([path]);
    expect(result.status).not.toBe(0);
    expect(result.out).toMatch(/has no highlight/);
    expect(result.out).toMatch(/does not match a bassHit/);
    expect(result.out).toMatch(/pitch label C does not match midi/);
    expect(result.out).toMatch(/title names pitch/);
    expect(result.out).toMatch(/denial copy/);
  });
});
