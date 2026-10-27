import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = dirname(fileURLToPath(import.meta.url));

function load(slug) {
  return JSON.parse(
    readFileSync(join(root, `../work/demo-${slug}/demo-data.json`), "utf8"),
  );
}

function allCards(demo) {
  // Prefer section-id keys (unique); kind aliases duplicate
  const secs = demo.secs || [];
  const out = [];
  for (const s of secs) {
    for (const c of demo.cards?.[s.id] || []) out.push(c);
  }
  return out;
}

describe("Pocket Funk public demo artifacts (MIDI-authored hero)", () => {
  const demo = load("pocket-funk");
  it("has meta + credit CC0 + MIDI authoritative", () => {
    expect(demo.title).toMatch(/Pocket Funk/i);
    expect(demo.meta.license).toMatch(/CC0/);
    expect(demo.meta.insightRequired).toBe(true);
    expect(demo.meta.midiAuthoritative).toBe(true);
    expect(demo.bassHits.length).toBeGreaterThan(50);
  });
  it("every section card has lean-B insight", () => {
    const cards = allCards(demo);
    expect(cards.length).toBe(demo.meta.insightCount);
    expect(cards.every((c) => c.insight?.layer)).toBe(true);
    const layers = new Set(cards.map((c) => c.insight.layer));
    expect(layers.has("pocket")).toBe(true);
    expect(layers.has("figure")).toBe(true);
    expect(layers.has("harmony")).toBe(true);
    expect(layers.has("missable")).toBe(true);
  });
  it("drumHits from MIDI kit (not empty invent)", () => {
    expect(demo.drumHits.length).toBeGreaterThan(100);
    expect(demo.meta.drumHitCount).toBe(demo.drumHits.length);
  });
  it("preserves seventh chord qualities when present", () => {
    const chords = demo.raw.map((r) => r[2]).filter(Boolean);
    expect(chords.some((c) => /7/.test(c))).toBe(true);
  });
});

describe("Maple Leaf Rag public demo artifacts (Mutopia MIDI)", () => {
  const demo = load("maple-leaf-rag");
  it("has Public Domain license + Mutopia/MIDI realization credit", () => {
    expect(demo.title).toMatch(/Maple Leaf/i);
    expect(demo.meta.license).toMatch(/Public Domain/i);
    expect(demo.credit.realization || demo.meta.realization).toBeTruthy();
    expect(demo.meta.midiAuthoritative).toBe(true);
    expect(demo.bassHits?.length).toBeGreaterThan(100);
  });
  it("every section card has lean-B insight", () => {
    const cards = allCards(demo);
    expect(cards.length).toBe(demo.meta.insightCount);
    expect(cards.every((c) => c.insight?.layer)).toBe(true);
  });
  it("drumHits empty — no invented backbeat", () => {
    expect(demo.drumHits).toEqual([]);
    expect(demo.drumsOutBars?.length).toBeGreaterThan(0);
  });
});
