import { describe, it, expect } from "vitest";
import {
  buildPrivateCatalog,
  catalogGroupsSeparated,
  PRIVATE_PROCESSED_DEMOS,
} from "../src/catalog.mjs";

/** Private DEMO group = public MIDI demos + private-only regression (Komiku, Make Funk, Maple). */
const PRIVATE_CATALOG_DEMOS = {
  "pocket-funk": {
    id: "pocket-funk",
    title: "Pocket Funk",
    artist: "Song Bass Explainer",
    license: "CC0 1.0 Universal",
    api: "/api/demo/pocket-funk",
  },
  "radio-pop": {
    id: "radio-pop",
    title: "Radio Pop",
    artist: "Song Bass Explainer",
    license: "CC0 1.0 Universal",
    api: "/api/demo/radio-pop",
  },
  "backbeat-rock": {
    id: "backbeat-rock",
    title: "Backbeat Rock",
    artist: "Song Bass Explainer",
    license: "CC0 1.0 Universal",
    api: "/api/demo/backbeat-rock",
  },
  "a-good-bass-for-gambling": {
    id: "a-good-bass-for-gambling",
    title: "A good bass for gambling",
    artist: "Komiku",
    license: "CC0 1.0 Universal",
    api: "/api/demo/a-good-bass-for-gambling",
  },
  "make-funk": {
    id: "make-funk",
    title: "Make Funk",
    artist: "HoliznaCC0",
    license: "CC0 1.0 Universal",
    api: "/api/demo/make-funk",
  },
  "maple-leaf-rag": {
    id: "maple-leaf-rag",
    title: "Maple Leaf Rag",
    artist: "Scott Joplin",
    license: "Public Domain",
    api: "/api/demo/maple-leaf-rag",
  },
};

/** Public catalog — Pocket Funk hero plus Radio Pop and Backbeat Rock. Maple stays private. */
const PUBLIC_DEMOS = {
  "pocket-funk": PRIVATE_CATALOG_DEMOS["pocket-funk"],
  "radio-pop": PRIVATE_CATALOG_DEMOS["radio-pop"],
  "backbeat-rock": PRIVATE_CATALOG_DEMOS["backbeat-rock"],
};

describe("buildPrivateCatalog grouping", () => {
  it("keeps demos and processed visually/structurally separate", () => {
    const catalog = buildPrivateCatalog({
      publicDemos: PRIVATE_CATALOG_DEMOS,
      privateDemos: PRIVATE_PROCESSED_DEMOS,
      jobs: [
        {
          id: "job_abc123",
          title: "Like a Prayer",
          status: "ready",
          studyReady: true,
          url: "https://www.youtube.com/watch?v=x",
        },
      ],
    });
    expect(catalogGroupsSeparated(catalog)).toBe(true);
    expect(catalog.demos.map((s) => s.id)).toEqual([
      "pocket-funk",
      "radio-pop",
      "backbeat-rock",
      "a-good-bass-for-gambling",
      "make-funk",
      "maple-leaf-rag",
    ]);
    expect(catalog.demos.every((s) => s.group === "demo")).toBe(true);
    expect(catalog.processed.some((s) => s.id === "like-a-prayer")).toBe(true);
    expect(catalog.processed.some((s) => s.id === "job_abc123")).toBe(true);
    expect(catalog.processed.every((s) => s.group === "processed")).toBe(true);
    expect(JSON.stringify(catalog.demos)).not.toMatch(/like.?a.?prayer/i);
  });

  it("skips queued jobs without a ready study", () => {
    const catalog = buildPrivateCatalog({
      publicDemos: PRIVATE_CATALOG_DEMOS,
      jobs: [{ id: "job_queued", title: "WIP", status: "queued" }],
    });
    expect(catalog.processed.some((s) => s.id === "job_queued")).toBe(false);
    expect(catalog.processed.some((s) => s.id === "like-a-prayer")).toBe(true);
  });

  it("private player URLs point at /private/player/?song=", () => {
    const catalog = buildPrivateCatalog({ publicDemos: PRIVATE_CATALOG_DEMOS });
    for (const s of [...catalog.demos, ...catalog.processed]) {
      expect(s.player).toMatch(/^\/private\/player\/\?song=/);
    }
  });
});

describe("public catalog scope", () => {
  it("public DEMO list is Pocket Funk + Radio Pop + Backbeat Rock", () => {
    expect(Object.keys(PUBLIC_DEMOS).sort()).toEqual(["backbeat-rock", "pocket-funk", "radio-pop"]);
    expect(PUBLIC_DEMOS["maple-leaf-rag"]).toBeUndefined();
    expect(PUBLIC_DEMOS["a-good-bass-for-gambling"]).toBeUndefined();
    expect(PUBLIC_DEMOS["make-funk"]).toBeUndefined();
    expect(PRIVATE_CATALOG_DEMOS["a-good-bass-for-gambling"]).toBeTruthy();
    expect(PRIVATE_CATALOG_DEMOS["make-funk"]).toBeTruthy();
    expect(PRIVATE_CATALOG_DEMOS["maple-leaf-rag"]).toBeTruthy();
  });
});
