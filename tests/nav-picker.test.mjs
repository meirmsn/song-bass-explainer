import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const playerSrc = readFileSync(join(root, "../public/js/player.js"), "utf8");
const workerSrc = readFileSync(join(root, "../src/index.js"), "utf8");

describe("quiet public→private link + private song picker (source)", () => {
  it("player.js ships subtle private entry (not a CTA button)", () => {
    expect(playerSrc).toMatch(/data-private-entry/);
    expect(playerSrc).toMatch(/className:\s*"private-entry"/);
    expect(playerSrc).toMatch(/href:\s*"\/private\/player\/"/);
    // muted / quiet styling
    expect(playerSrc).toMatch(/\.private-entry\s*\{[^}]*color:#4b5563/);
  });

  it("player.js private song picker separates Demo vs Processed optgroups", () => {
    expect(playerSrc).toMatch(/data-song-picker/);
    expect(playerSrc).toMatch(/demoGroup\.label\s*=\s*"Demo"/);
    expect(playerSrc).toMatch(/procGroup\.label\s*=\s*"Processed"/);
    expect(playerSrc).toMatch(/\/private\/api\/catalog/);
  });

  it("Worker exposes Access-gated /private/api/catalog", () => {
    expect(workerSrc).toMatch(/\/private\/api\/catalog/);
    expect(workerSrc).toMatch(/buildPrivateCatalog/);
  });
});
