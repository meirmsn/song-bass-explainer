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

describe("v2-empty: Verse 2 stem silence → rests (resource)", () => {
  it("resource v2 pattern is empty (not TURN) and raw bass cleared for silent bars", () => {
    if (!existsSync(resourcePath)) return;
    const r = JSON.parse(readFileSync(resourcePath, "utf8"));
    const v2 = r.patterns?.v2;
    expect(Array.isArray(v2) && v2.length).toBeTruthy();
    expect(v2[0].id).toBe("empty");
    expect(v2[0].notes).toEqual([]);
    expect(v2[0].id).not.toBe("turn");
    for (const bar of [20, 21, 28, 32, 34, 35]) {
      const row = r.raw.find((x) => x[0] === bar);
      expect(row, `bar ${bar}`).toBeTruthy();
      expect(row[3], `bass string bar ${bar}`).toBe("");
    }
    // Invented TURN frets must not reappear in silent span
    const invented = r.raw
      .filter((row) => row[0] >= 20 && row[0] <= 35)
      .some((row) => String(row[3]).length > 0);
    expect(invented).toBe(false);
    expect(r.cards?.v2?.length).toBeGreaterThan(0);
    expect(r.cards.v2.some((c) => /out|rest|drop/i.test(c.body))).toBe(true);
  });

  it("both LAP job study resources ship empty v2", () => {
    for (const p of jobPaths) {
      if (!existsSync(p)) continue;
      const r = JSON.parse(readFileSync(p, "utf8"));
      expect(r.patterns?.v2?.[0]?.id, p).toBe("empty");
      expect(r.patterns.v2[0].notes, p).toEqual([]);
      expect(r.raw.find((row) => row[0] === 28)?.[3], `bar28 ${p}`).toBe("");
    }
  });

  it("player fallback PATS.v2 is EMPTY (no TURN invent)", () => {
    // Evaluate notation exports without full boot
    const sandbox = { window: {}, document: { createElement: () => ({ style: {}, appendChild() {}, setAttribute() {} }), head: { appendChild() {} }, getElementById: () => null, addEventListener() {}, dispatchEvent() {} }, location: { pathname: "/" }, Response, fetch: async () => new Response("{}", { status: 200 }) };
    // Minimal DOM stubs so IIFE can define __BASS_NOTATION__ before boot fails/fetches
    const g = {
      window: {
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
        AudioContext: class { constructor(){ this.state="running"; this.currentTime=0; this.destination={}; } createGain(){return{gain:{value:1},connect(){}};} createBufferSource(){return{connect(){},start(){},stop(){}};} async decodeAudioData(){return{duration:1};} async resume(){} async suspend(){} },
      },
      document: {
        createElement(tag) {
          return { tagName: tag, style: {}, className: "", textContent: "", appendChild() {}, setAttribute() {}, addEventListener() {} };
        },
        head: { appendChild() {} },
        getElementById() { return { isConnected: true, replaceChildren() {}, appendChild() {}, textContent: "" }; },
        addEventListener() {},
      },
      location: { pathname: "/private/player/" },
      fetch: async () => new Response(JSON.stringify({
        title: "t", artist: "a", bpm: 120, timeSig: "4/4", keys: "C", duration: 1, nbars: 1,
        raw: [[0, 0, "C", ""]], secs: [{ id: "v2", name: "V2", first: 0, end: 1, kind: "verse", ci: 0 }],
        stems: { available: false },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      Response,
      Event: class { constructor(t){ this.type=t; } },
    };
    // Use jsdom-less Function with bound globals — prefer asserting source + notation after player.dom loads.
    expect(playerSrc).toMatch(/v2:\[EMPTY\]/);
    expect(playerSrc).toMatch(/id: "empty"/);
    expect(playerSrc).not.toMatch(/v2:\[TURN\]/);
    expect(playerSrc).toMatch(/opts\.empty \|\| opts\.silent/);
    expect(playerSrc).toMatch(/isRhythmOut/);
    expect(playerSrc).toMatch(/rests \(out\)/);
  });
});
