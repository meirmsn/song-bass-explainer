/**
 * Player: absolute bassHits win over sparse tiled patterns.
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const playerSrc = readFileSync(join(root, "../public/js/player.js"), "utf8");
const tinyDemo = JSON.parse(readFileSync(join(root, "fixtures/tiny-demo.json"), "utf8"));

function teardown() {
  try { window.__BASS_PLAYER__?.destroy?.(); } catch (_) {}
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete window.__BASS_PLAYER__;
  delete window.__BASS_NOTATION__;
  delete window.__BASS_PRIVATE__;
}

async function loadNotation(demo) {
  document.body.innerHTML = '<div id="app"></div>';
  window.__BASS_PRIVATE__ = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(demo), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
  class FakeAudioContext {
    constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
    async decodeAudioData() { return { duration: demo.duration || 4 }; }
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
      return;
    }
    setTimeout(() => reject(new Error("player ready timeout")), 8000);
  });
  expect(window.__BASS_NOTATION__).toBeTruthy();
  return window.__BASS_NOTATION__;
}

afterEach(teardown);

describe("bassHits player preference", () => {
  it("bassNotesForView uses absolute hits when present", async () => {
    const demo = {
      ...tinyDemo,
      patterns: {
        ...tinyDemo.patterns,
        intro: [{ id: "sparse", name: "sparse", notes: [
          { step: 0, midi: 28 }, { step: 4, midi: 28 }, { step: 8, midi: 28 }, { step: 12, midi: 28 },
        ] }],
      },
      bassHits: [
        { bar: 0, step: 0, midi: 33 },
        { bar: 0, step: 2, midi: 36 },
        { bar: 0, step: 3, midi: 38 },
        { bar: 0, step: 6, midi: 33 },
        { bar: 0, step: 10, midi: 31 },
        { bar: 0, step: 14, midi: 33 },
      ],
    };
    const N = await loadNotation(demo);
    expect(N.normalizeSongBassHits(demo)?.length).toBe(6);
    const sparsePat = demo.patterns.intro[0];
    const notes = N.bassNotesForView(1, 0, sparsePat, N.normalizeSongBassHits(demo));
    expect(notes.length).toBe(6);
    expect(notes.map((n) => n.midi)).toEqual([33, 36, 38, 33, 31, 33]);
    expect(notes.some((n) => n.step === 2)).toBe(true);
  });

  it("falls back to expandPatternNotes when no bassHits", async () => {
    const demo = { ...tinyDemo };
    delete demo.bassHits;
    const N = await loadNotation(demo);
    expect(N.normalizeSongBassHits(demo)).toBe(null);
    const pat = { id: "x", notes: [{ step: 0, midi: 40 }, { step: 16, midi: 41 }] };
    const notes = N.bassNotesForView(4, 0, pat, null);
    expect(notes.length).toBe(4);
  });
});
