/**
 * Private song catalog grouping — Demo (public CC0/PDM) vs Processed (Access-gated studies).
 * Pure helpers so unit tests do not need R2 / Access.
 */

/** Fixed processed private demos (licensed / user studies), never listed on the public catalog. */
export const PRIVATE_PROCESSED_DEMOS = {
  "like-a-prayer": {
    id: "like-a-prayer",
    title: "Like a Prayer",
    artist: "Madonna / study",
    license: "private",
    kind: "private-demo",
    api: "/private/api/demo/like-a-prayer",
    player: "/private/player/?song=like-a-prayer",
  },
};

/**
 * @param {object} opts
 * @param {Record<string, object>|object[]} opts.publicDemos - PUBLIC_DEMOS map or array
 * @param {Record<string, object>|object[]} [opts.privateDemos] - PRIVATE_PROCESSED_DEMOS map or array
 * @param {object[]} [opts.jobs] - job meta.json objects from PRIVATE_BUCKET
 * @returns {{ demos: object[], processed: object[] }}
 */
export function buildPrivateCatalog({ publicDemos, privateDemos = PRIVATE_PROCESSED_DEMOS, jobs = [] } = {}) {
  const demoList = Array.isArray(publicDemos) ? publicDemos : Object.values(publicDemos || {});
  const demos = demoList.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist || null,
    license: s.license || null,
    kind: "public-demo",
    group: "demo",
    api: s.api || `/api/demo/${s.id}`,
    player: `/private/player/?song=${encodeURIComponent(s.id)}`,
  }));

  const privList = Array.isArray(privateDemos) ? privateDemos : Object.values(privateDemos || {});
  const processed = [];
  const seen = new Set();

  for (const s of privList) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    processed.push({
      id: s.id,
      title: s.title,
      artist: s.artist || null,
      license: s.license || "private",
      kind: s.kind || "private-demo",
      group: "processed",
      api: s.api || `/private/api/demo/${s.id}`,
      player: s.player || `/private/player/?song=${encodeURIComponent(s.id)}`,
    });
  }

  for (const job of jobs) {
    if (!job?.id) continue;
    const status = String(job.status || "");
    // Include ready studies; also waiting_bot / done aliases used by the pipeline.
    if (!/^(ready|done|waiting_bot)$/i.test(status) && !job.studyReady) continue;
    if (seen.has(job.id)) continue;
    seen.add(job.id);
    processed.push({
      id: job.id,
      title: job.title || job.id,
      artist: job.artist || (job.url ? "Processed job" : "Processed"),
      license: "private",
      kind: "job",
      group: "processed",
      status,
      api: `/private/api/jobs/${job.id}/study/resource.json`,
      player: `/private/player/?song=${encodeURIComponent(job.id)}`,
    });
  }

  return { demos, processed };
}

/** True when catalog keeps demos and processed in separate arrays with correct group labels. */
export function catalogGroupsSeparated(catalog) {
  if (!catalog || !Array.isArray(catalog.demos) || !Array.isArray(catalog.processed)) return false;
  if (catalog.demos.some((s) => s.group !== "demo")) return false;
  if (catalog.processed.some((s) => s.group !== "processed")) return false;
  // Public demos must never appear under processed by id collision with CC0 slugs only —
  // processed may intentionally hold distinct private ids.
  const demoIds = new Set(catalog.demos.map((s) => s.id));
  if (catalog.processed.some((s) => demoIds.has(s.id))) return false;
  // Licensed LAP must never be in demos
  if (catalog.demos.some((s) => /like-a-prayer/i.test(s.id || "") || /like.?a.?prayer/i.test(s.title || ""))) {
    return false;
  }
  return true;
}
