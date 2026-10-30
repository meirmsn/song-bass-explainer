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
  it("Groove A′ ghost notes are in the bass and drum hits", () => {
    const bassGhosts = demo.bassHits.filter((h) => h.ghost);
    expect(bassGhosts.length).toBe(24);
    expect(bassGhosts.every((h) => h.bar >= 12 && h.bar < 20)).toBe(true);
    expect(new Set(bassGhosts.map((h) => h.step))).toEqual(new Set([10, 11, 14]));
    const snareGhosts = demo.drumHits.filter((h) => h.ghost && h.kind === "snare");
    expect(snareGhosts.length).toBe(16);
    expect(new Set(snareGhosts.map((h) => h.step))).toEqual(new Set([3, 11]));
    expect(demo.meta.drumHitCount).toBe(demo.drumHits.length);
    const pocket = demo.cards.a2.find((c) => c.label === "Pocket");
    expect(pocket.body).toMatch(/ghost/i);
    expect(pocket.insight.highlights.some((h) => h.ghost && h.kind === "snare")).toBe(true);
    expect(pocket.insight.highlights.some((h) => h.ghost && h.midi === 36)).toBe(true);
    const pat = demo.patterns.a2[0];
    expect(pat.notes.filter((n) => n.ghost).map((n) => n.step).sort((a, b) => a - b)).toEqual([10, 11, 14, 26, 27, 30]);
  });

  const PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  function highlightSpan(insight) {
    const steps = (insight.highlights || []).map((h) => h.step).filter((n) => Number.isFinite(n));
    return [Math.floor(Math.min(...steps) / 16), Math.floor(Math.max(...steps) / 16)];
  }

  it("each card window is exactly the bars its highlights land in", () => {
    for (const sec of demo.secs) {
      for (const c of demo.cards[sec.id]) {
        expect(c.insight.barRange, `${sec.id}/${c.label}`).toEqual(highlightSpan(c.insight));
      }
    }
  });

  it("Intro Figure lights A A G and leaves C unlit", () => {
    const pocket = demo.cards.intro.find((c) => c.label === "Pocket");
    const figure = demo.cards.intro.find((c) => c.label === "Figure");
    const entered = demo.bassHits.filter((h) => h.bar === 2).sort((a, b) => a.step - b.step);
    expect(entered.slice(0, 3).map((h) => [h.step, h.midi])).toEqual([[0, 33], [6, 33], [7, 31]]);
    expect(entered.find((h) => h.step === 10).midi).toBe(36);
    expect(pocket.insight.barRange).toEqual([0, 0]);
    expect(pocket.insight.highlights.map((h) => h.step)).toEqual([0, 8]);
    expect(figure.insight.barRange).toEqual([0, 0]);
    expect(figure.insight.title).toBe("A+G");
    expect(figure.insight.title).not.toMatch(/C|line/i);
    expect(figure.body).not.toMatch(/\bline\b/i);
    expect(figure.body).not.toMatch(/\bC\b/);
    expect(figure.insight.highlights.map((h) => [h.step, h.midi, h.text])).toEqual([
      [0, 33, "A"],
      [6, 33, "A"],
      [7, 31, "G"],
    ]);
    const notes = new Set(demo.patterns.intro[0].notes.map((n) => `${n.step}:${n.midi}`));
    expect(notes.has("10:36")).toBe(true);
    for (const h of figure.insight.highlights) {
      expect(notes.has(`${h.step}:${h.midi}`)).toBe(true);
      expect(h.text).toBe(PITCH[h.midi % 12]);
      expect(h.text).not.toBe("line");
      expect(h.midi).not.toBe(36);
    }
  });

  it("figure bubbles name lit pitches and Am7 harmony does not deny a Bb", () => {
    for (const sec of demo.secs) {
      const fig = demo.cards[sec.id].find((c) => c.label === "Figure");
      const notes = new Set(demo.patterns[sec.id][0].notes.map((n) => `${n.step}:${n.midi}`));
      const lit = new Set();
      for (const h of fig.insight.highlights) {
        expect(h.text, sec.id).toBe(PITCH[h.midi % 12]);
        expect(h.text, sec.id).not.toBe("line");
        expect(notes.has(`${h.step}:${h.midi}`)).toBe(true);
        lit.add(h.text);
      }
      expect(fig.insight.title, sec.id).toBe([...lit].join("+") || fig.insight.title);
      expect(fig.body, sec.id).not.toMatch(/\bline\b/i);
      for (const name of fig.insight.title.split("+")) {
        expect(lit.has(name), `${sec.id} title ${fig.insight.title}`).toBe(true);
      }
      const harm = demo.cards[sec.id].find((c) => c.label === "Harmony");
      expect(harm.body, sec.id).not.toMatch(/foreign chord/);
      expect(harm.body, sec.id).not.toMatch(/\bBb\b/);
      expect(harm.body, sec.id).not.toMatch(/main chord-name row|same symbols as/i);
      if (sec.id === "intro") {
        expect(harm.body).toMatch(/Am7/);
        expect(harm.body).toMatch(/i7/);
        expect(harm.body).toMatch(/A–C–E–G/);
      }
    }
  });
});

function expectMidiKitDemo(demo, { title, key, sevenths }) {
  expect(demo.title).toMatch(title);
  expect(demo.keys).toBe(key);
  expect(demo.meta.license).toMatch(/CC0/);
  expect(demo.meta.insightRequired).toBe(true);
  expect(demo.meta.midiAuthoritative).toBe(true);
  expect(demo.bassHits.length).toBeGreaterThan(50);
  expect(demo.drumHits.length).toBeGreaterThan(100);
  expect(demo.meta.drumHitCount).toBe(demo.drumHits.length);
  expect(demo.meta.bassHitCount).toBe(demo.bassHits.length);
  const kinds = new Set(demo.drumHits.map((h) => h.kind));
  expect(kinds.has("kick")).toBe(true);
  expect(kinds.has("snare")).toBe(true);
  expect(kinds.has("hat")).toBe(true);
  const cards = allCards(demo);
  expect(cards.length).toBe(demo.meta.insightCount);
  expect(cards.every((c) => c.insight?.layer && Array.isArray(c.insight.barRange))).toBe(true);
  for (const c of cards) {
    const bars = new Set(
      (c.insight.highlights || [])
        .filter((h) => Number.isFinite(h.step))
        .map((h) => Math.floor(h.step / 16)),
    );
    const [lo, hi] = c.insight.barRange;
    for (let bar = lo; bar <= hi; bar++) {
      expect(bars.has(bar), `${c.label} bar ${bar}`).toBe(true);
    }
  }
  const layers = new Set(cards.map((c) => c.insight.layer));
  for (const layer of ["pocket", "figure", "harmony", "missable"]) {
    expect(layers.has(layer)).toBe(true);
  }
  const rawChords = new Set(demo.raw.map((r) => r[2]).filter(Boolean));
  for (const sec of demo.secs) {
    const harm = (demo.cards[sec.id] || []).find((c) => c.insight.layer === "harmony");
    const chips = (harm.insight.highlights || []).map((h) => h.chord).filter(Boolean);
    expect(chips.length).toBeGreaterThan(0);
    for (const ch of chips) expect(rawChords.has(ch)).toBe(true);
    const notes = new Set((demo.patterns[sec.id]?.[0]?.notes || []).map((n) => `${n.step}:${n.midi}`));
    expect(notes.size).toBeGreaterThan(0);
    const fig = (demo.cards[sec.id] || []).find((c) => c.insight.layer === "figure");
    for (const h of fig.insight.highlights) {
      expect(notes.has(`${h.step}:${h.midi}`)).toBe(true);
    }
  }
  const chords = [...rawChords];
  expect(chords.some((c) => sevenths.test(c))).toBe(true);
}

describe("Radio Pop public demo artifacts (MIDI-authored)", () => {
  const demo = load("radio-pop");
  it("is a CC0 pop kit study with claim-local insights", () => {
    expectMidiKitDemo(demo, { title: /Radio Pop/i, key: "C", sevenths: /7/ });
    const verseKick = demo.drumHits.filter((h) => h.bar === 6 && h.kind === "kick").map((h) => h.step);
    expect(verseKick).toEqual([0, 4, 8, 12]);
  });
});

describe("Backbeat Rock public demo artifacts (MIDI-authored)", () => {
  const demo = load("backbeat-rock");
  it("is a CC0 rock kit study with claim-local insights", () => {
    expectMidiKitDemo(demo, { title: /Backbeat Rock/i, key: "Em", sevenths: /7/ });
    const verseKick = demo.drumHits.filter((h) => h.bar === 6 && h.kind === "kick").map((h) => h.step);
    expect(verseKick).toEqual([0, 8]);
    expect(demo.drumHits.some((h) => h.kind === "ride")).toBe(true);
  });
});

describe("Maple Leaf Rag study artifact (kept in repo, not a public demo)", () => {
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
