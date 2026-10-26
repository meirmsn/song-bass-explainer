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
    expect(text).toMatch(/Bass Study/i);
    expect(text).toMatch(/player\.js/);
    expect(text).toMatch(/__BASS_PRIVATE__\s*=\s*false/);
    expect(text).not.toMatch(/Like a Prayer/i);
    expect(text).not.toMatch(/Madonna/i);
    expect(text).not.toMatch(/\/api\/demo\/like-a-prayer/);
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
    expect(data.songs.some((s) => s.id === "a-good-bass-for-gambling")).toBe(true);
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
  it.each(["/private/", "/private/player/", "/private/api/jobs", "/private/api/demo/like-a-prayer"])(
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
    expect(pipe).toMatch(/a-good-bass-for-gambling/);
  });
});
