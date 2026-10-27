/**
 * Regression: public demos must ship real note-level AMT (bassHits), not
 * chroma-on-mix / 4-quarters-every-bar / false pyin meta claims.
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, "..");

function loadDemo(slug) {
  const p = join(repo, "work", `demo-${slug}`, "demo-data.json");
  expect(existsSync(p), `missing ${p}`).toBe(true);
  return JSON.parse(readFileSync(p, "utf8"));
}

function quarterLockFraction(bassHits) {
  if (!bassHits?.length) return 1;
  // Fraction of bars whose only steps are {0,4,8,12} with ≤4 hits (classic 4-quarters lock)
  const byBar = new Map();
  for (const h of bassHits) {
    if (!byBar.has(h.bar)) byBar.set(h.bar, []);
    byBar.get(h.bar).push(h.step);
  }
  let locked = 0;
  let scored = 0;
  for (const steps of byBar.values()) {
    if (steps.length === 0) continue;
    scored += 1;
    const uniq = [...new Set(steps)].sort((a, b) => a - b);
    const onlyQuarters = uniq.every((s) => s % 4 === 0);
    if (onlyQuarters && uniq.length <= 4 && steps.length <= 4) locked += 1;
  }
  return scored ? locked / scored : 1;
}

function sixteenthCapableFraction(bassHits) {
  if (!bassHits?.length) return 0;
  const oddOrOff = bassHits.filter((h) => h.step % 2 === 1 || h.step % 4 === 2).length;
  return oddOrOff / bassHits.length;
}

function octaveHist(bassHits) {
  const h = {};
  for (const n of bassHits) {
    const o = Math.floor(n.midi / 12) - 1;
    h[`oct${o}`] = (h[`oct${o}`] || 0) + 1;
  }
  return h;
}

describe("bass AMT regression — make-funk", () => {
  const demo = loadDemo("make-funk");

  it("has absolute bassHits (not empty)", () => {
    expect(Array.isArray(demo.bassHits)).toBe(true);
    expect(demo.bassHits.length).toBeGreaterThan(200);
  });

  it("meta.analysis reflects real stem AMT (pyin), not false chroma-only claim alone", () => {
    const a = demo.meta?.analysis || "";
    expect(a.toLowerCase()).toMatch(/pyin|amt/);
    expect(a.toLowerCase()).toMatch(/stems\/bass\.wav|bass stem|stems\/bass/);
  });

  it("is not locked to 4 quarters every bar", () => {
    const frac = quarterLockFraction(demo.bassHits);
    expect(frac).toBeLessThan(0.35);
  });

  it("has 16th-capable rhythm (off-beat / syncopation present)", () => {
    expect(sixteenthCapableFraction(demo.bassHits)).toBeGreaterThan(0.15);
  });

  it("meta.bassHitCount matches bassHits length", () => {
    expect(demo.meta?.bassHitCount).toBe(demo.bassHits.length);
  });
});

describe("bass AMT regression — a-good-bass-for-gambling (Komiku)", () => {
  const demo = loadDemo("a-good-bass-for-gambling");

  it("has absolute bassHits", () => {
    expect(Array.isArray(demo.bassHits)).toBe(true);
    expect(demo.bassHits.length).toBeGreaterThan(200);
  });

  it("is not locked to 4 quarters every bar", () => {
    // Prior published bug: exactly 4.0 notes/bar all quarters
    expect(quarterLockFraction(demo.bassHits)).toBeLessThan(0.5);
  });

  it("octave is mostly oct2 (not wrong oct1 MIDI dump)", () => {
    const h = octaveHist(demo.bassHits);
    const o1 = h.oct1 || 0;
    const o2 = h.oct2 || 0;
    expect(o2).toBeGreaterThan(o1);
  });

  it("meta.analysis does not claim pyin without bassHits", () => {
    expect(demo.bassHits.length).toBeGreaterThan(0);
    expect(String(demo.meta?.analysis || "").toLowerCase()).toMatch(/pyin|amt/);
  });

  it("drumHits present and non-invent (not empty song)", () => {
    expect(Array.isArray(demo.drumHits)).toBe(true);
    expect(demo.drumHits.length).toBeGreaterThan(100);
    expect(demo.drumsOutBars?.length).toBeGreaterThan(0); // quiet intro known
  });
});

describe("player prefers bassHits over tiled patterns", () => {
  it("exposes normalizeSongBassHits + bassNotesForView", () => {
    const src = readFileSync(join(repo, "public/js/player.js"), "utf8");
    expect(src).toMatch(/function normalizeSongBassHits/);
    expect(src).toMatch(/function bassNotesForView/);
    expect(src).toMatch(/SONG_BASS_HITS/);
    // Prefer absolute hits path
    expect(src).toMatch(/songBassHitsForView\(songBassHits/);
  });

  it("analyze_audio does not claim pyin in default confidence string", () => {
    const src = readFileSync(join(repo, "scripts/analyze_audio.py"), "utf8");
    expect(src).toMatch(/NOT note-level AMT|no note-level AMT/);
    expect(src).toMatch(/transcribe_bass/);
  });
});
