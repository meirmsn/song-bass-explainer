import { describe, it, expect } from "vitest";
import {
  buildPrivateCatalog,
  catalogGroupsSeparated,
  PRIVATE_PROCESSED_DEMOS,
} from "../src/catalog.mjs";

/** Private DEMO group = public demos + private-only regression (Komiku). */
const PRIVATE_CATALOG_DEMOS = {
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
    license: "Public Domain Mark 1.0",
    api: "/api/demo/maple-leaf-rag",
  },
};

/** Public catalog scope — Komiku dropped from public DEMO picker. */
const PUBLIC_DEMOS = {
  "make-funk": PRIVATE_CATALOG_DEMOS["make-funk"],
  "maple-leaf-rag": PRIVATE_CATALOG_DEMOS["maple-leaf-rag"],
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
  it("public DEMO list excludes Komiku but keeps Make Funk + Maple Leaf", () => {
    expect(Object.keys(PUBLIC_DEMOS).sort()).toEqual(["make-funk", "maple-leaf-rag"]);
    expect(PUBLIC_DEMOS["a-good-bass-for-gambling"]).toBeUndefined();
    expect(PRIVATE_CATALOG_DEMOS["a-good-bass-for-gambling"]).toBeTruthy();
  });
});
