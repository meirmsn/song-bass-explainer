import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const playerSrc = readFileSync(join(root, "../public/js/player.js"), "utf8");
const workerSrc = readFileSync(join(root, "../src/index.js"), "utf8");

describe("public has no Private link + private song typeahead (source)", () => {
  it("player.js does not ship a public Private entry link", () => {
    expect(playerSrc).not.toMatch(/data-private-entry/);
    expect(playerSrc).not.toMatch(/className:\s*"private-entry"/);
    expect(playerSrc).not.toMatch(/\.private-entry\s*\{/);
    // Public credit line must not advertise /private/player/
    expect(playerSrc).not.toMatch(/href:\s*"\/private\/player\/"/);
  });

  it("player.js private song typeahead keeps Demo vs Processed groups", () => {
    expect(playerSrc).toMatch(/data-song-typeahead/);
    expect(playerSrc).toMatch(/data-song-typeahead-input/);
    expect(playerSrc).toMatch(/data-song-listbox/);
    expect(playerSrc).toMatch(/addGroup\("Demo",\s*"demo"/);
    expect(playerSrc).toMatch(/addGroup\("Processed",\s*"processed"/);
    expect(playerSrc).toMatch(/\/private\/api\/catalog/);
    // No select/optgroup song picker
    expect(playerSrc).not.toMatch(/demoGroup\.label\s*=\s*"Demo"/);
    expect(playerSrc).not.toMatch(/createElement\("optgroup"\)/);
  });

  it("Worker exposes Access-gated /private/api/catalog", () => {
    expect(workerSrc).toMatch(/\/private\/api\/catalog/);
    expect(workerSrc).toMatch(/buildPrivateCatalog/);
  });
});

describe("public DEMO catalog drops Komiku", () => {
  it("Komiku absent from public DEMO picker; Pocket Funk is default hero", () => {
    expect(playerSrc).toContain("PUBLIC_SONG_RE = /^(pocket-funk)$/");
    expect(playerSrc).toMatch(/PUBLIC_DEFAULT_SONG = "pocket-funk"/);
    const pubFallback = playerSrc.match(/const PUBLIC_DEMO_FALLBACK = \[([\s\S]*?)\];/);
    expect(pubFallback).toBeTruthy();
    expect(pubFallback[1]).not.toMatch(/a-good-bass-for-gambling/);
    expect(pubFallback[1]).not.toMatch(/make-funk/);
    expect(pubFallback[1]).not.toMatch(/maple-leaf-rag/);
    expect(pubFallback[1]).toMatch(/pocket-funk/);
    expect(workerSrc).toMatch(/PRIVATE_ONLY_DEMOS/);
    expect(workerSrc).toMatch(/DEMO_ASSET_SLUGS/);
    const pubDemos = workerSrc.match(/const PUBLIC_DEMOS = \{([\s\S]*?)\n\};/);
    expect(pubDemos).toBeTruthy();
    expect(pubDemos[1]).not.toMatch(/a-good-bass-for-gambling/);
    expect(pubDemos[1]).not.toMatch(/["']make-funk["']/);
    expect(pubDemos[1]).not.toMatch(/maple-leaf-rag/);
    expect(pubDemos[1]).toMatch(/pocket-funk/);
    expect(workerSrc).toMatch(/PRIVATE_ONLY_DEMOS = \{[\s\S]*maple-leaf-rag/);
  });
});
