/**
 * Regression: kit notes come only from per-song drumHits.
 * No invent default (kick 1+3 / snare 2+4 / 8th hats) when hits are missing.
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const playerSrc = readFileSync(join(root, "../public/js/player.js"), "utf8");
const tinyDemo = JSON.parse(readFileSync(join(root, "fixtures/tiny-demo.json"), "utf8"));
const komikuPath = join(root, "../work/demo-a-good-bass-for-gambling/demo-data.json");
const komikuDemo = JSON.parse(readFileSync(komikuPath, "utf8"));

function teardown() {
  try {
    if (window.__BASS_PLAYER__?.destroy) window.__BASS_PLAYER__.destroy();
  } catch (_) { /* ignore */ }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete window.__BASS_PLAYER__;
  delete window.__BASS_NOTATION__;
  delete window.__BASS_PRIVATE__;
}

/** Pure LAP invent signature for one bar (relative steps). */
function lapInventSignature(hat16 = false) {
  const kick = new Set([0, 8]);
  const snare = new Set([4, 12]);
  const hat = new Set(hat16
    ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
    : [0, 2, 4, 6, 8, 10, 12, 14]);
  return { kick, snare, hat };
}

function signatureFromHits(hits, barOffset = 0) {
  const kick = new Set();
  const snare = new Set();
  const hat = new Set();
  for (const h of hits) {
    const step = h.step - barOffset * 16;
    if (step < 0 || step > 15) continue;
    if (h.kind === "kick") kick.add(step);
    else if (h.kind === "snare") snare.add(step);
    else if (h.kind === "hat") hat.add(step);
  }
  return { kick, snare, hat };
}

function sameSig(a, b) {
  const eq = (x, y) => x.size === y.size && [...x].every((v) => y.has(v));
  return eq(a.kick, b.kick) && eq(a.snare, b.snare) && eq(a.hat, b.hat);
}

async function loadNotation() {
  document.body.innerHTML = '<div id="app"></div>';
  window.__BASS_PRIVATE__ = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(tinyDemo), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
  class FakeAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
    async decodeAudioData() { return { duration: tinyDemo.duration }; }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;
  await new Promise((resolve, reject) => {
    const onReady = () => {
      window.removeEventListener("bass-player-ready", onReady);
      resolve();
    };
    window.addEventListener("bass-player-ready", onReady);
    try {
      new Function(playerSrc)();
    } catch (e) {
      window.removeEventListener("bass-player-ready", onReady);
      reject(e);
    }
    setTimeout(() => reject(new Error("player boot timeout")), 5000);
  });
  return window.__BASS_NOTATION__;
}

describe("song drumHits preferred over LAP invent", () => {
  afterEach(teardown);

  it("drumHitsForView uses supplied song hits, not buildDrumHits invent", async () => {
    const N = await loadNotation();
    const invent = N.buildDrumHits(1, false);
    const inventSig = signatureFromHits(invent, 0);
    expect(sameSig(inventSig, lapInventSignature(false))).toBe(true);

    // Deliberately non-LAP song hits (four-on-floor kick, quarter hats)
    const song = [
      { bar: 5, step: 0, kind: "kick", midi: 36 },
      { bar: 5, step: 4, kind: "kick", midi: 36 },
      { bar: 5, step: 8, kind: "kick", midi: 36 },
      { bar: 5, step: 12, kind: "kick", midi: 36 },
      { bar: 5, step: 4, kind: "snare", midi: 38 },
      { bar: 5, step: 12, kind: "snare", midi: 38 },
      { bar: 5, step: 0, kind: "hat", midi: 42 },
      { bar: 5, step: 4, kind: "hat", midi: 42 },
      { bar: 5, step: 8, kind: "hat", midi: 42 },
      { bar: 5, step: 12, kind: "hat", midi: 42 },
    ];
    const view = N.drumHitsForView(1, false, 5, { drumHits: song });
    const sig = signatureFromHits(view, 0);
    expect(sameSig(sig, inventSig)).toBe(false);
    expect(sig.kick.has(4)).toBe(true); // four-on-floor includes beat 2
    expect(sig.hat.has(2)).toBe(false); // no 8th-hat wall
    expect(view.map((h) => `${h.kind}@${h.step}`).sort()).toEqual(
      song.map((h) => `${h.kind}@${h.step}`).sort(),
    );
  });

  it("without song hits, drumHitsForView returns empty (no invent default)", async () => {
    const N = await loadNotation();
    const view = N.drumHitsForView(1, false, 0, {});
    expect(view).toEqual([]);
    // Must not be the legacy LAP kick1+3/snare2+4/8th-hat invent grid
    expect(sameSig(signatureFromHits(view), lapInventSignature(false))).toBe(false);
  });

  it("demo without drumHits → empty view (not LAP invent grid)", async () => {
    const N = await loadNotation();
    expect(N.normalizeSongDrumHits({})).toBeNull();
    expect(N.normalizeSongDrumHits({ title: "no hits" })).toBeNull();
    const view = N.drumHitsForView(4, false, 0, {
      drumHits: N.normalizeSongDrumHits({}),
      drumsOutBars: [],
    });
    expect(view).toEqual([]);
    const invent = N.buildDrumHits(4, false);
    expect(invent.length).toBeGreaterThan(0);
    expect(sameSig(signatureFromHits(view, 0), signatureFromHits(invent, 0))).toBe(false);
  });

  it("demo with drumHits → uses them (not invent)", async () => {
    const N = await loadNotation();
    const song = [
      { bar: 0, step: 0, kind: "kick", midi: 36 },
      { bar: 0, step: 4, kind: "kick", midi: 36 },
      { bar: 0, step: 8, kind: "kick", midi: 36 },
      { bar: 0, step: 12, kind: "kick", midi: 36 },
      { bar: 0, step: 4, kind: "snare", midi: 38 },
      { bar: 0, step: 12, kind: "snare", midi: 38 },
      { bar: 0, step: 0, kind: "hat", midi: 42 },
      { bar: 0, step: 8, kind: "hat", midi: 42 },
    ];
    const view = N.drumHitsForView(1, false, 0, { drumHits: song });
    expect(view.length).toBe(song.length);
    expect(sameSig(signatureFromHits(view), lapInventSignature(false))).toBe(false);
    expect(signatureFromHits(view).kick.has(4)).toBe(true);
    expect(signatureFromHits(view).hat.has(2)).toBe(false);
  });

  it("normalizeSongDrumHits reads demo.drumHits", async () => {
    const N = await loadNotation();
    const hits = N.normalizeSongDrumHits({
      drumHits: [{ bar: 1, step: 0, kind: "kick" }, { bar: 1, step: 99, kind: "kick" }],
    });
    expect(hits).toEqual([{ bar: 1, step: 0, kind: "kick", midi: 36 }]);
    expect(N.normalizeSongDrumHits({})).toBeNull();
  });
});

describe("Komiku fixture: real kit, not LAP invent", () => {
  it("ships drumHits when stems exist (public CC0)", () => {
    expect(existsSync(komikuPath)).toBe(true);
    expect(Array.isArray(komikuDemo.drumHits)).toBe(true);
    expect(komikuDemo.drumHits.length).toBeGreaterThan(100);
    expect(komikuDemo.stems?.drumsAvailable || komikuDemo.stems?.drums || komikuDemo.stems?.available).toBeTruthy();
    expect(komikuDemo.meta?.insightRequired).toBe(true);
    // drumsOutBars must be range pairs, not a flat bar list
    for (const r of komikuDemo.drumsOutBars || []) {
      expect(Array.isArray(r)).toBe(true);
      expect(r.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("Groove A′ (a2) hit signature ≠ pure procedural kick1+3/snare2+4/8th-hat grid", () => {
    const a2 = komikuDemo.secs.find((s) => s.id === "a2");
    expect(a2).toBeTruthy();
    const lap = lapInventSignature(false);
    let compared = 0;
    let lapLike = 0;
    for (let bar = a2.first; bar < a2.end; bar++) {
      const barHits = komikuDemo.drumHits.filter((h) => h.bar === bar);
      if (!barHits.length) continue;
      compared++;
      const sig = {
        kick: new Set(barHits.filter((h) => h.kind === "kick").map((h) => h.step)),
        snare: new Set(barHits.filter((h) => h.kind === "snare").map((h) => h.step)),
        hat: new Set(barHits.filter((h) => h.kind === "hat").map((h) => h.step)),
      };
      if (sameSig(sig, lap)) lapLike++;
    }
    expect(compared).toBeGreaterThan(0);
    // None of the Groove A′ bars may be the pure LAP invent
    expect(lapLike).toBe(0);
    // Structural: four-on-floor kick (beat 2 present) and hat density < 8ths
    const sampleBar = a2.first + 1;
    const sample = komikuDemo.drumHits.filter((h) => h.bar === sampleBar);
    const kicks = new Set(sample.filter((h) => h.kind === "kick").map((h) => h.step));
    const hats = new Set(sample.filter((h) => h.kind === "hat").map((h) => h.step));
    expect(kicks.has(4) || kicks.has(12)).toBe(true); // not kick-only 1+3
    expect(hats.size).toBeLessThan(8);
  });

  it("Groove A′ pocket insight does not claim LAP 8th-hat / kick-only-1+3 grid", () => {
    const pocket = komikuDemo.cards.a2.find((c) => /pocket/i.test(c.label));
    expect(pocket).toBeTruthy();
    const body = (pocket.body || "").toLowerCase();
    const texts = (pocket.insight?.highlights || []).map((h) => (h.text || "").toLowerCase()).join(" ");
    expect(body + " " + texts).toMatch(/four-on-floor|four on floor|gambling pulse/);
    expect(body).not.toMatch(/8th hats keep|wall of 8ths keep/);
    // Must not be the old "kick on 1" + "kick on 3" only schematic without four-floor language
    const hl = pocket.insight.highlights || [];
    const kickTexts = hl.filter((h) => h.kind === "kick").map((h) => h.text || "");
    expect(kickTexts.some((t) => /four-on-floor|kick 1|kick on 1/i.test(t))).toBe(true);
  });
});

describe("player staff path with Komiku drumHits", () => {
  afterEach(teardown);

  it("drumHitsForView on a2 bars equals stored song hits (not invent)", async () => {
    const N = await loadNotation();
    const song = N.normalizeSongDrumHits(komikuDemo);
    expect(song).toBeTruthy();
    const a2 = komikuDemo.secs.find((s) => s.id === "a2");
    const n = a2.end - a2.first;
    const view = N.drumHitsForView(n, false, a2.first, {
      drumHits: song,
      drumsOutBars: N.normalizeDrumsOutBars(komikuDemo),
    });
    const invent = N.buildDrumHits(n, false);
    expect(sameSig(signatureFromHits(view, 0), signatureFromHits(invent, 0))).toBe(false);

    // Equality to stored hits remapped into view
    const expected = song
      .filter((h) => h.bar >= a2.first && h.bar < a2.end)
      .filter((h) => !N.isBarDrumsSilent(h.bar, N.normalizeDrumsOutBars(komikuDemo)))
      .map((h) => ({ step: (h.bar - a2.first) * 16 + h.step, kind: h.kind }));
    const got = view.map((h) => ({ step: h.step, kind: h.kind }));
    const key = (x) => `${x.kind}@${x.step}`;
    expect(got.map(key).sort()).toEqual(expected.map(key).sort());
  });
});
