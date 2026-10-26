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

describe("public homepage — no licensed player", () => {
  it("/", async () => {
    const { status, text } = await fetchRaw("/");
    expect(status).toBe(200);
    expect(text).toMatch(/<title>Bass Study<\/title>/);
    expect(text).toMatch(/Sign in/);
    expect(text).toMatch(/href="\/private\/"/);
    expect(text).not.toMatch(/Like a Prayer/i);
    expect(text).not.toMatch(/Madonna/i);
    expect(text).not.toMatch(/Loading player/i);
    expect(text).not.toMatch(/player\.js/);
    expect(text).not.toMatch(/\/api\/demo\/like-a-prayer/);
  });
});

describe("public demo APIs gated", () => {
  it("GET /api/demo/like-a-prayer → 401", async () => {
    const { status, text } = await fetchRaw("/api/demo/like-a-prayer");
    expect(status).toBe(401);
    expect(text).toMatch(/private/i);
  });

  it("GET /api/demo/catalog → empty songs", async () => {
    const { status, text } = await fetchRaw("/api/demo/catalog");
    expect(status).toBe(200);
    const data = JSON.parse(text);
    expect(Array.isArray(data.songs)).toBe(true);
    expect(data.songs).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/like.?a.?prayer/i);
  });

  it("public stem path blocked", async () => {
    const { status } = await fetchRaw("/api/demo/like-a-prayer/stems/bass.wav");
    expect([401, 403]).toContain(status);
  });

  it("/js/demo-data.json is not song JSON", async () => {
    const { status, text, res } = await fetchRaw("/js/demo-data.json");
    expect(status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    // SPA fallback to landing HTML, or 404-style — never LAP JSON
    if (ct.includes("json")) {
      expect(text).not.toMatch(/Like a Prayer/i);
    } else {
      expect(text).toMatch(/Bass Study/);
      expect(text).not.toMatch(/Like a Prayer/i);
    }
  });
});

describe("Access gating on /private*", () => {
  it.each(["/private/", "/private/player/", "/private/api/jobs", "/private/api/demo/like-a-prayer"])(
    "%s redirects to Access (302/401) without session",
    async (path) => {
      const { status, res } = await fetchRaw(path);
      // Cloudflare Access typically 302 to login; some configs 401/403
      expect([302, 301, 303, 307, 401, 403]).toContain(status);
      if (status >= 300 && status < 400) {
        const loc = res.headers.get("location") || "";
        expect(loc.length).toBeGreaterThan(0);
        // Access login hosts vary; just require a redirect target
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
    expect(data.public_stems_open).toBe(false);
    const pipe = JSON.stringify(data.pipeline || {});
    expect(pipe).not.toMatch(/GET \/api\/demo\/like-a-prayer \(JSON only/);
  });
});
