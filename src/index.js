/**
 * Bass Study Worker — static assets + Access-gated private jobs/stems + public CC0 demo.
 * Licensed demos (Like a Prayer) stay private-only. Public CC0 stems served from DEMO_BUCKET.
 */
import { buildStemsMeta } from "./stems.mjs";
import { buildPrivateCatalog, PRIVATE_PROCESSED_DEMOS } from "./catalog.mjs";

const ACCOUNT = "91a68408014ad4deb94e432d231f4af8";

/** Public CC0/PDM demos listed on / and /api/demo/catalog. Never add like-a-prayer.
 *  Pocket Funk stays the default hero. Maple Leaf Rag is private-only (no kit). */
const PUBLIC_DEMOS = {
  "pocket-funk": {
    id: "pocket-funk",
    title: "Pocket Funk",
    artist: "Song Bass Explainer",
    license: "CC0 1.0 Universal",
    album: "MIDI demos",
    source: "MIDI-authored (FluidSynth)",
    sourceUrl: "https://bass.meirmsn.dev/?song=pocket-funk",
    api: "/api/demo/pocket-funk",
    player: "/?song=pocket-funk",
  },
  "radio-pop": {
    id: "radio-pop",
    title: "Radio Pop",
    artist: "Song Bass Explainer",
    license: "CC0 1.0 Universal",
    album: "MIDI demos",
    source: "MIDI-authored (FluidSynth)",
    sourceUrl: "https://bass.meirmsn.dev/?song=radio-pop",
    api: "/api/demo/radio-pop",
    player: "/?song=radio-pop",
  },
  "backbeat-rock": {
    id: "backbeat-rock",
    title: "Backbeat Rock",
    artist: "Song Bass Explainer",
    license: "CC0 1.0 Universal",
    album: "MIDI demos",
    source: "MIDI-authored (FluidSynth)",
    sourceUrl: "https://bass.meirmsn.dev/?song=backbeat-rock",
    api: "/api/demo/backbeat-rock",
    player: "/?song=backbeat-rock",
  },
};

/** Private/regression DEMO tracks — kept off the public catalog/picker. */
const PRIVATE_ONLY_DEMOS = {
  "a-good-bass-for-gambling": {
    id: "a-good-bass-for-gambling",
    title: "A good bass for gambling",
    artist: "Komiku",
    license: "CC0 1.0 Universal",
    album: "It's time for adventure ! vol 3",
    source: "Free Music Archive",
    sourceUrl:
      "https://freemusicarchive.org/music/Komiku/Its_time_for_adventure__vol_3/Komiku_-_Its_time_for_adventure_vol_3_-_06_A_good_bass_for_gambling/",
    api: "/api/demo/a-good-bass-for-gambling",
    player: "/private/player/?song=a-good-bass-for-gambling",
  },
  "make-funk": {
    id: "make-funk",
    title: "Make Funk",
    artist: "HoliznaCC0",
    license: "CC0 1.0 Universal",
    album: "BASSIC",
    source: "Free Music Archive",
    sourceUrl: "https://freemusicarchive.org/music/holiznacc0/bassic/make-funk/",
    api: "/api/demo/make-funk",
    player: "/private/player/?song=make-funk",
  },
  "maple-leaf-rag": {
    id: "maple-leaf-rag",
    title: "Maple Leaf Rag",
    artist: "Scott Joplin",
    license: "Public Domain",
    album: "MIDI demos",
    source: "Mutopia Project MIDI + FluidSynth render",
    sourceUrl: "https://www.mutopiaproject.org/ftp/JoplinS/maple/maple.mid",
    api: "/api/demo/maple-leaf-rag",
    player: "/private/player/?song=maple-leaf-rag",
  },
};

/** Slugs whose study+stems still live in DEMO_BUCKET (public + private-only). */
const DEMO_ASSET_SLUGS = { ...PUBLIC_DEMOS, ...PRIVATE_ONLY_DEMOS };


function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function bad(msg, status = 400) {
  return json({ error: msg }, status);
}

function ytOk(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (!["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"].includes(host)) return false;
    if (host === "youtu.be") return u.pathname.length > 1;
    return Boolean(u.searchParams.get("v") || u.pathname.includes("/shorts/") || u.pathname.includes("/live/"));
  } catch {
    return false;
  }
}

function jobId() {
  return "job_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

async function listJobs(bucket, limit = 40) {
  const listed = await bucket.list({ prefix: "jobs/", limit: 500 });
  const objs = (listed.objects || []).filter((o) => o.key.endsWith("/meta.json"));
  objs.sort((a, b) => (b.uploaded || "").localeCompare(a.uploaded || ""));
  const jobs = [];
  for (const o of objs.slice(0, limit)) {
    const obj = await bucket.get(o.key);
    if (!obj) continue;
    try {
      jobs.push(JSON.parse(await obj.text()));
    } catch {
      /* skip */
    }
  }
  return jobs;
}

async function putJob(bucket, job) {
  await bucket.put(`jobs/${job.id}/meta.json`, JSON.stringify(job, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
  return job;
}

async function getObject(bucket, key, request) {
  const opts = {};
  if (request && request.headers && request.headers.has("range")) {
    // R2 Workers binding accepts Request headers for byte-range GETs → 206.
    opts.range = request.headers;
  }
  return bucket.get(key, opts);
}

function objectResponse(obj, fallbackType, { privateAudio = false } = {}) {
  if (!obj) return null;
  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType || fallbackType || "application/octet-stream";
  headers.set("content-type", ct);
  headers.set("cache-control", privateAudio ? "private, max-age=300" : "public, max-age=3600");
  headers.set("accept-ranges", "bytes");
  if (!privateAudio) headers.set("access-control-allow-origin", "*");
  if (obj.httpEtag) headers.set("etag", obj.httpEtag);

  const ranged = Boolean(obj.range && typeof obj.range.offset === "number");
  if (ranged) {
    const start = obj.range.offset;
    const length = obj.range.length;
    const end = start + length - 1;
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  if (obj.size != null) headers.set("content-length", String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/_health") {
      let demoOk = false;
      let privateOk = false;
      let jobCount = null;
      let wakeCount = null;
      let privateDemoStems = false;
      let publicDemoStemsPresent = false;
      try {
        demoOk = Boolean(env.DEMO_BUCKET);
        if (env.DEMO_BUCKET) {
          publicDemoStemsPresent = Boolean(
            (await env.DEMO_BUCKET.head("demo/a-good-bass-for-gambling/stems/bass.m4a")) ||
            (await env.DEMO_BUCKET.head("demo/pocket-funk/stems/bass.m4a")) ||
            (await env.DEMO_BUCKET.head("demo/radio-pop/stems/bass.m4a")) ||
            (await env.DEMO_BUCKET.head("demo/backbeat-rock/stems/bass.m4a")) ||
            (await env.DEMO_BUCKET.head("demo/make-funk/stems/bass.m4a")) ||
            (await env.DEMO_BUCKET.head("demo/maple-leaf-rag/stems/other.m4a"))
          );
        }
      } catch {
        /* */
      }
      try {
        privateOk = Boolean(env.PRIVATE_BUCKET);
        if (env.PRIVATE_BUCKET) {
          const listed = await env.PRIVATE_BUCKET.list({ prefix: "jobs/", limit: 100 });
          jobCount = (listed.objects || []).filter((o) => o.key.endsWith("/meta.json")).length;
          const wakes = await env.PRIVATE_BUCKET.list({ prefix: "wake/", limit: 50 });
          wakeCount = (wakes.objects || []).length;
          privateDemoStems = Boolean(
            (await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/bass.m4a")) ||
            (await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/bass.wav"))
          );
        }
      } catch {
        /* */
      }
      return json({
        ok: true,
        host: url.host,
        r2_demo: demoOk,
        r2_private: privateOk,
        jobs_meta_count: jobCount,
        wake_count: wakeCount,
        public_stems_open: false,
        public_demo_stems_object_present: publicDemoStemsPresent,
        private_demo_stems: privateDemoStems,
        pipeline: {
          intake: "POST /private/api/jobs (Access)",
          list: "GET /private/api/jobs (Access)",
          get: "GET /private/api/jobs/:id (Access)",
          wake_list: "GET /private/api/wake (Access)",
          compute: "box hybrid consumer + scripts/analyze_audio.py (librosa generic)",
          demo_public: "GET /api/demo/:slug for allowlisted CC0/PDM (+ public stems); catalog lists public demos only",
          demo_private: "GET /private/api/catalog (demos vs processed); GET /private/api/demo/like-a-prayer (+ stems)",
          stems: "Access-gated /private/api/.../stems (Accept-Ranges + 206 when Range present)",
        },
        account_hint: ACCOUNT.slice(0, 8) + "…",
      });
    }

    // Licensed demo stems must never be public (any slug containing like-a-prayer).
    if (path.startsWith("/api/demo/") && path.includes("/stems/") && /like-a-prayer/i.test(path)) {
      return json(
        {
          error: "Stems are Access-gated. Use /private/api/demo/like-a-prayer/stems/… or /private/player/",
        },
        401,
      );
    }

    // Licensed demos (e.g. Like a Prayer) are private-only.
    if (path === "/api/demo/like-a-prayer" || path === "/api/demo/like-a-prayer/") {
      return json(
        {
          error: "This demo is private. Sign in at /private/player/",
        },
        401,
      );
    }

    if (path === "/api/demo/catalog") {
      // Public face: CC0 / PD only — never Like a Prayer.
      return json({
        songs: Object.values(PUBLIC_DEMOS).map((s) => ({ ...s })),
      });
    }

    // Public allowlisted demo meta: /api/demo/:slug
    const pubDemoMeta = path.match(/^\/api\/demo\/([a-z0-9-]+)\/?$/);
    if (pubDemoMeta && !path.includes("/stems/")) {
      const slug = pubDemoMeta[1];
      if (slug === "catalog") {
        /* handled above */
      } else if (/like-a-prayer/i.test(slug)) {
        return json({ error: "This demo is private. Sign in at /private/player/" }, 401);
      } else if (!DEMO_ASSET_SLUGS[slug]) {
        return json({ error: "Unknown or private demo" }, 404);
      } else {
        if (!env.DEMO_BUCKET) return bad("DEMO_BUCKET binding missing", 500);
        let data = null;
        const study = await env.DEMO_BUCKET.get(`demo/${slug}/study/resource.json`);
        if (study) data = JSON.parse(await study.text());
        if (!data) {
          const obj = await env.DEMO_BUCKET.get(`demo/${slug}/demo-data.json`);
          if (obj) data = JSON.parse(await obj.text());
        }
        if (!data) return bad("public demo missing", 404);
        const hasBassM4a = Boolean(await env.DEMO_BUCKET.head(`demo/${slug}/stems/bass.m4a`));
        const hasNoBassM4a = Boolean(await env.DEMO_BUCKET.head(`demo/${slug}/stems/no_bass.m4a`));
        const hasBassWav = Boolean(await env.DEMO_BUCKET.head(`demo/${slug}/stems/bass.wav`));
        const hasNoBassWav = Boolean(await env.DEMO_BUCKET.head(`demo/${slug}/stems/no_bass.wav`));
        const hasDrumsM4a = Boolean(await env.DEMO_BUCKET.head(`demo/${slug}/stems/drums.m4a`));
        const hasDrumsWav = Boolean(await env.DEMO_BUCKET.head(`demo/${slug}/stems/drums.wav`));
        data.stems = buildStemsMeta({
          hasBassM4a,
          hasNoBassM4a,
          hasBassWav,
          hasNoBassWav,
          hasDrumsM4a,
          hasDrumsWav,
          basePath: `/api/demo/${slug}/stems`,
          access: "public",
        });
        return json(data);
      }
    }

    const pubDemoStem = path.match(
      /^\/api\/demo\/([a-z0-9-]+)\/stems\/(bass|no_bass|drums|other)\.(wav|m4a|mp3)$/,
    );
    if (pubDemoStem && request.method === "GET") {
      const slug = pubDemoStem[1];
      if (/like-a-prayer/i.test(slug)) {
        return json(
          {
            error: "Stems are Access-gated. Use /private/api/demo/like-a-prayer/stems/… or /private/player/",
          },
          401,
        );
      }
      if (!DEMO_ASSET_SLUGS[slug]) {
        return json({ error: "Unknown or private demo stems" }, 404);
      }
      if (!env.DEMO_BUCKET) return bad("DEMO_BUCKET binding missing", 500);
      const stem = pubDemoStem[2];
      const ext = pubDemoStem[3];
      const key = `demo/${slug}/stems/${stem}.${ext}`;
      const obj = await getObject(env.DEMO_BUCKET, key, request);
      if (!obj) return bad("stem not found", 404);
      const ct = ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : "audio/wav";
      return objectResponse(obj, ct, { privateAudio: false });
    }

    if (path === "/api/jobs" || path.startsWith("/api/jobs/")) {
      return json({ error: "Use /private/api/jobs (Cloudflare Access)" }, 401);
    }

    // ---- Access-gated private APIs ----

    // Private catalog: Demo (public CC0/PDM) vs Processed (LAP + ready jobs) — Access-gated.
    if (path === "/private/api/catalog" || path === "/private/api/catalog/") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      let jobs = [];
      try {
        jobs = await listJobs(env.PRIVATE_BUCKET, 80);
      } catch {
        jobs = [];
      }
      // Only surface jobs that actually have a study resource.
      const ready = [];
      for (const job of jobs) {
        const st = String(job.status || "");
        if (!/^(ready|done|waiting_bot)$/i.test(st)) continue;
        try {
          const head = await env.PRIVATE_BUCKET.head(`jobs/${job.id}/study/resource.json`);
          if (head) ready.push({ ...job, studyReady: true });
        } catch {
          /* skip */
        }
      }
      const catalog = buildPrivateCatalog({
        publicDemos: { ...PUBLIC_DEMOS, ...PRIVATE_ONLY_DEMOS },
        privateDemos: PRIVATE_PROCESSED_DEMOS,
        jobs: ready,
      });
      return json(catalog);
    }

    if (path === "/private/api/demo/like-a-prayer" || path === "/private/api/demo/like-a-prayer/") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      // Prefer full study resource; fall back to demo-data shape
      let data = null;
      const study = await env.PRIVATE_BUCKET.get("demo/like-a-prayer/study/resource.json");
      if (study) data = JSON.parse(await study.text());
      if (!data && env.DEMO_BUCKET) {
        const obj = await env.DEMO_BUCKET.get("demo/like-a-prayer/demo-data.json");
        if (obj) data = JSON.parse(await obj.text());
      }
      if (!data) return bad("private demo missing", 404);
      const hasBassM4a = Boolean(await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/bass.m4a"));
      const hasNoBassM4a = Boolean(await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/no_bass.m4a"));
      const hasBassWav = Boolean(await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/bass.wav"));
      const hasNoBassWav = Boolean(await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/no_bass.wav"));
      const hasDrumsM4a = Boolean(await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/drums.m4a"));
      const hasDrumsWav = Boolean(await env.PRIVATE_BUCKET.head("demo/like-a-prayer/stems/drums.wav"));
      data.stems = buildStemsMeta({
        hasBassM4a,
        hasNoBassM4a,
        hasBassWav,
        hasNoBassWav,
        hasDrumsM4a,
        hasDrumsWav,
        basePath: "/private/api/demo/like-a-prayer/stems",
      });
      return json(data);
    }

    const privDemoStem = path.match(/^\/private\/api\/demo\/like-a-prayer\/stems\/(bass|no_bass|drums|other)\.(wav|m4a|mp3)$/);
    if (privDemoStem && request.method === "GET") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      const stem = privDemoStem[1];
      const ext = privDemoStem[2];
      const key = `demo/like-a-prayer/stems/${stem}.${ext}`;
      const obj = await getObject(env.PRIVATE_BUCKET, key, request);
      if (!obj) return bad("stem not found", 404);
      const ct = ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : "audio/wav";
      return objectResponse(obj, ct, { privateAudio: true });
    }

    if (path === "/private/api/jobs" && request.method === "GET") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      return json({ jobs: await listJobs(env.PRIVATE_BUCKET) });
    }

    if (path === "/private/api/wake" && request.method === "GET") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      const listed = await env.PRIVATE_BUCKET.list({ prefix: "wake/", limit: 50 });
      const wakes = [];
      for (const o of listed.objects || []) {
        if (!o.key.endsWith(".json")) continue;
        const obj = await env.PRIVATE_BUCKET.get(o.key);
        if (!obj) continue;
        try {
          wakes.push(JSON.parse(await obj.text()));
        } catch {
          /* */
        }
      }
      wakes.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
      return json({ wakes });
    }

    if (path === "/private/api/jobs" && request.method === "POST") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      let body;
      try {
        body = await request.json();
      } catch {
        return bad("Invalid JSON");
      }
      const yt = String(body.url || "").trim();
      if (!ytOk(yt)) return bad("Need a valid YouTube URL");
      const id = jobId();
      const createdAt = nowIso();
      const job = {
        id,
        url: yt,
        title: body.title ? String(body.title).slice(0, 200) : null,
        status: "queued",
        stage: "intake",
        stages: { intake: { ok: true, at: createdAt } },
        createdAt,
        updatedAt: createdAt,
        artifacts: {
          prefix: `jobs/${id}/`,
          layout: [
            "meta.json",
            "source/audio.wav",
            "stems/{bass,no_bass,drums,other}.wav",
            "analysis/beat.json",
            "analysis/transcription.json",
            "analysis/procedural.json",
            "analysis/semantic.json",
            "study/resource.json",
          ],
        },
        notes: "Queued for box hybrid consumer (yt-dlp → demucs → analysis → wake).",
      };
      await putJob(env.PRIVATE_BUCKET, job);
      await env.PRIVATE_BUCKET.put(
        `wake/${id}.json`,
        JSON.stringify(
          {
            type: "bass.job.queued",
            jobId: id,
            at: createdAt,
            status: "queued",
            next: ["download", "demucs", "beat", "transcribe", "procedural", "wake_bot", "merge"],
          },
          null,
          2,
        ),
        { httpMetadata: { contentType: "application/json" } },
      );
      return json({ job }, 201);
    }

    const jobMatch = path.match(/^\/private\/api\/jobs\/([a-zA-Z0-9_]+)$/);
    if (jobMatch && request.method === "GET") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      const id = jobMatch[1];
      const obj = await env.PRIVATE_BUCKET.get(`jobs/${id}/meta.json`);
      if (!obj) return bad("Job not found", 404);
      const job = JSON.parse(await obj.text());
      const stagesListed = await env.PRIVATE_BUCKET.list({ prefix: `jobs/${id}/stages/`, limit: 50 });
      const stageFiles = {};
      for (const o of stagesListed.objects || []) {
        const so = await env.PRIVATE_BUCKET.get(o.key);
        if (!so) continue;
        try {
          const name = o.key.split("/").pop().replace(/\.json$/, "");
          stageFiles[name] = JSON.parse(await so.text());
        } catch {
          /* */
        }
      }
      return json({ job, stages: stageFiles });
    }

    const privStem = path.match(/^\/private\/api\/jobs\/([a-zA-Z0-9_]+)\/stems\/(bass|no_bass|drums|other)\.(wav|m4a|mp3)$/);
    if (privStem && request.method === "GET") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      const jobId = privStem[1];
      const stem = privStem[2];
      const ext = privStem[3];
      const key = `jobs/${jobId}/stems/${stem}.${ext}`;
      const obj = await getObject(env.PRIVATE_BUCKET, key, request);
      if (!obj) return bad("stem not found", 404);
      const ct = ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : "audio/wav";
      return objectResponse(obj, ct, { privateAudio: true });
    }

    const privArt = path.match(/^\/private\/api\/jobs\/([a-zA-Z0-9_]+)\/(analysis|study)\/([a-zA-Z0-9_.-]+\.json)$/);
    if (privArt && request.method === "GET") {
      if (!env.PRIVATE_BUCKET) return bad("PRIVATE_BUCKET binding missing", 500);
      const key = `jobs/${privArt[1]}/${privArt[2]}/${privArt[3]}`;
      const obj = await env.PRIVATE_BUCKET.get(key);
      if (!obj) return bad("artifact not found", 404);
      return objectResponse(obj, "application/json");
    }

    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    if (path === "/private" || path === "/private/" || path.startsWith("/private/")) {
      return new Response(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Private Catalog</title></head>
<body><h1>Login required / private catalog</h1>
<p>Placeholder. Cloudflare Access should protect /private and /private/*.</p>
</body></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    return new Response("Not found", { status: 404 });
  },
};
