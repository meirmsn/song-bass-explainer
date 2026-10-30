import { describe, it, expect } from "vitest";

const BASE = process.env.BASS_BASE_URL || "https://bass.meirmsn.dev";

async function fetchRaw(path, init = {}) {
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: { "Cache-Control": "no-cache", ...(init.headers || {}) },
    ...init,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString("utf8");
  return { res, text, status: res.status };
}

describe("public homepage — CC0 Komiku player", () => {
  it("/", async () => {
    const { status, text } = await fetchRaw("/");
    expect(status).toBe(200);
    expect(text).toMatch(/player\.js/);
    expect(text).toMatch(/__BASS_PRIVATE__\s*=\s*false/);
    expect(text).not.toMatch(/Like a Prayer/i);
    expect(text).not.toMatch(/Madonna/i);
    expect(text).not.toMatch(/\/api\/demo\/like-a-prayer/);
    const title = (text.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    expect(title.length).toBeGreaterThan(0);
    // Source contract is tests/share-meta.test.mjs. Once this shell is deployed,
    // the live document title and og:image must match (no song name).
    if (/Song Bass Explainer - Understand Bass Lines in Songs/.test(title)) {
      expect(text).toContain('property="og:title" content="Song Bass Explainer - Understand Bass Lines in Songs"');
      expect(text).toContain('property="og:image" content="https://bass.meirmsn.dev/social-preview.png"');
      expect(text).toContain('name="twitter:title" content="Song Bass Explainer - Understand Bass Lines in Songs"');
      expect(text).toContain('name="twitter:image" content="https://bass.meirmsn.dev/social-preview.png"');
      expect(title).not.toMatch(/gambling|Make Funk|Maple Leaf/i);
    }
  });

  it("/player/ also serves public player shell", async () => {
    const { status, text } = await fetchRaw("/player/");
    expect(status).toBe(200);
    expect(text).toMatch(/player\.js/);
    expect(text).toMatch(/__BASS_PRIVATE__\s*=\s*false/);
    expect(text).not.toMatch(/Like a Prayer/i);
  });
});

describe("public demo APIs — CC0 open, LAP gated", () => {
  it("GET /api/demo/like-a-prayer → 401", async () => {
    const { status, text } = await fetchRaw("/api/demo/like-a-prayer");
    expect(status).toBe(401);
    expect(text).toMatch(/private/i);
  });

  it("GET /api/demo/catalog → CC0 only", async () => {
    const { status, text } = await fetchRaw("/api/demo/catalog");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(Array.isArray(data.songs)).toBe(true);
    expect(data.songs.length).toBeGreaterThanOrEqual(1);
    expect(data.songs.every((s) => /CC0|public domain|PD/i.test(s.license || ""))).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/like.?a.?prayer/i);
    expect(data.songs.some((s) => s.id === "a-good-bass-for-gambling")).toBe(false);
    expect(data.songs.some((s) => s.id === "make-funk")).toBe(false);
    expect(data.songs.map((s) => s.id)).toEqual(["pocket-funk", "radio-pop", "backbeat-rock"]);
    expect(data.songs.some((s) => s.id === "maple-leaf-rag")).toBe(false);
    expect(data.songs.length).toBe(3);
    expect(data.songs.every((s) => s.id !== "a-good-bass-for-gambling")).toBe(true);
  });

  it("GET /api/demo/a-good-bass-for-gambling → study JSON", async () => {
    const { status, text } = await fetchRaw("/api/demo/a-good-bass-for-gambling");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.title).toMatch(/good bass for gambling/i);
    expect(data.artist).toMatch(/Komiku/i);
    expect(data.stems?.available).toBe(true);
    expect(data.stems?.access).toBe("public");
    expect(data.stems?.bass).toMatch(/\/api\/demo\/a-good-bass-for-gambling\/stems\/bass\.(m4a|wav)/);
    expect(data.stems?.drums).toBeTruthy();
    expect(JSON.stringify(data)).not.toMatch(/Like a Prayer/i);
  });

  it("public Komiku stem path serves audio", async () => {
    const { status, res } = await fetchRaw("/api/demo/a-good-bass-for-gambling/stems/bass.m4a");
    // R2/Workers may answer 200 or 206 (Accept-Ranges); both are playable.
    expect([200, 206]).toContain(status);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toMatch(/audio|mp4|mpeg/i);
    const len = Number(res.headers.get("content-length") || 0);
    expect(len).toBeGreaterThan(1000);
  });

  it("public LAP stem path blocked", async () => {
    const { status } = await fetchRaw("/api/demo/like-a-prayer/stems/bass.wav");
    expect([401, 403]).toContain(status);
  });


  it("GET /api/demo/pocket-funk → study JSON", async () => {
    const { status, text } = await fetchRaw("/api/demo/pocket-funk");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.title).toMatch(/Pocket Funk/i);
    expect(data.meta?.midiAuthoritative).toBe(true);
    expect(Array.isArray(data.bassHits)).toBe(true);
    expect(data.bassHits.length).toBeGreaterThan(50);
    expect(data.stems?.bass).toMatch(/\/api\/demo\/pocket-funk\/stems\/bass\.(m4a|wav)/);
  });

  it("public Pocket Funk stem path serves audio", async () => {
    const { status, res } = await fetchRaw("/api/demo/pocket-funk/stems/bass.m4a");
    expect([200, 206]).toContain(status);
    expect(res.headers.get("content-type")).toMatch(/audio|octet/);
  });

  it("GET /api/demo/radio-pop → study JSON with bass and kit", async () => {
    const { status, text } = await fetchRaw("/api/demo/radio-pop");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.title).toMatch(/Radio Pop/i);
    expect(data.keys).toBe("C");
    expect(data.meta?.midiAuthoritative).toBe(true);
    expect(data.bassHits.length).toBeGreaterThan(50);
    const kinds = new Set((data.drumHits || []).map((h) => h.kind));
    expect(kinds.has("kick") && kinds.has("snare") && kinds.has("hat")).toBe(true);
    const cards = Object.values(data.cards || {}).flat();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.insight && c.insight.layer)).toBe(true);
    expect(data.stems?.bass).toMatch(/\/api\/demo\/radio-pop\/stems\/bass\.(m4a|wav)/);
    expect(data.stems?.access).toBe("public");
  });

  it("public Radio Pop stem path serves audio", async () => {
    const { status, res } = await fetchRaw("/api/demo/radio-pop/stems/bass.m4a");
    expect([200, 206]).toContain(status);
    expect(res.headers.get("content-type") || "").toMatch(/audio|mp4|mpeg|octet/i);
    expect(Number(res.headers.get("content-length") || 0)).toBeGreaterThan(1000);
  });

  it("GET /api/demo/backbeat-rock → study JSON with bass and kit", async () => {
    const { status, text } = await fetchRaw("/api/demo/backbeat-rock");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.title).toMatch(/Backbeat Rock/i);
    expect(data.keys).toBe("Em");
    expect(data.meta?.midiAuthoritative).toBe(true);
    expect(data.bassHits.length).toBeGreaterThan(50);
    const kinds = new Set((data.drumHits || []).map((h) => h.kind));
    expect(kinds.has("kick") && kinds.has("snare") && kinds.has("hat")).toBe(true);
    const cards = Object.values(data.cards || {}).flat();
    expect(cards.every((c) => c.insight && c.insight.layer)).toBe(true);
    expect(data.stems?.drums).toMatch(/\/api\/demo\/backbeat-rock\/stems\/drums\.(m4a|wav)/);
    expect(data.stems?.access).toBe("public");
  });

  it("public Backbeat Rock stem path serves audio", async () => {
    const { status, res } = await fetchRaw("/api/demo/backbeat-rock/stems/bass.m4a");
    expect([200, 206]).toContain(status);
    expect(Number(res.headers.get("content-length") || 0)).toBeGreaterThan(1000);
  });

  it("GET /api/demo/make-funk → study JSON", async () => {
    const { status, text } = await fetchRaw("/api/demo/make-funk");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.title).toMatch(/make funk/i);
    expect(data.artist).toMatch(/HoliznaCC0/i);
    expect(data.stems?.available).toBe(true);
    expect(data.stems?.access).toBe("public");
    expect(data.stems?.bass).toMatch(/\/api\/demo\/make-funk\/stems\/bass\.(m4a|wav)/);
    // lean-B ship blocker: every card has insight
    const cards = Object.values(data.cards || {}).flat();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.insight && c.insight.layer)).toBe(true);
  });

  it("public Make Funk stem path serves audio", async () => {
    const { status, res } = await fetchRaw("/api/demo/make-funk/stems/bass.m4a");
    expect([200, 206]).toContain(status);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toMatch(/audio|mp4|mpeg/i);
    expect(Number(res.headers.get("content-length") || 0)).toBeGreaterThan(1000);
  });

  it("GET /api/demo/maple-leaf-rag → study JSON", async () => {
    const { status, text } = await fetchRaw("/api/demo/maple-leaf-rag");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.title).toMatch(/maple leaf/i);
    expect(data.artist).toMatch(/Joplin/i);
    expect(data.stems?.available).toBe(true);
    expect(data.stems?.access).toBe("public");
    // no invented drums
    expect(Array.isArray(data.drumHits) ? data.drumHits.length : 0).toBe(0);
    const cards = Object.values(data.cards || {}).flat();
    expect(cards.every((c) => c.insight && c.insight.layer)).toBe(true);
  });

  it("public Maple Leaf Rag stem path serves audio", async () => {
    const { status, res } = await fetchRaw("/api/demo/maple-leaf-rag/stems/other.m4a");
    expect([200, 206]).toContain(status);
    expect(Number(res.headers.get("content-length") || 0)).toBeGreaterThan(1000);
  });

  it("unknown public demo slug → 404", async () => {
    const { status } = await fetchRaw("/api/demo/not-a-real-song");
    expect([404, 401]).toContain(status);
  });

  it("/js/demo-data.json is not LAP song JSON", async () => {
    const { status, text, res } = await fetchRaw("/js/demo-data.json");
    expect(status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("json")) {
      expect(text).not.toMatch(/Like a Prayer/i);
    } else {
      expect(text).not.toMatch(/Like a Prayer/i);
    }
  });
});

describe("Access gating on /private*", () => {
  it.each(["/private/", "/private/player/", "/private/api/jobs", "/private/api/demo/like-a-prayer", "/private/api/catalog"])(
    "%s redirects to Access (302/401) without session",
    async (path) => {
      const { status, res } = await fetchRaw(path);
      expect([302, 301, 303, 307, 401, 403]).toContain(status);
      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location") || "";
        expect(loc.length).toBeGreaterThan(0);
        expect(loc).toMatch(/^https?:\/\//i);
      }
    },
  );
});

describe("health", () => {
  it("/_health ok and does not claim public LAP demo", async () => {
    const { status, text } = await fetchRaw("/_health");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(data.ok).toBe(true);
    // public_stems_open remains the LAP/licensed flag (false); CC0 is separate.
    expect(data.public_stems_open).toBe(false);
    const pipe = JSON.stringify(data.pipeline || {});
    expect(pipe).not.toMatch(/GET \/api\/demo\/like-a-prayer \(JSON only/);
    expect(pipe).toMatch(/a-good-bass-for-gambling|CC0\/PDM|allowlisted/i);
  });
});

