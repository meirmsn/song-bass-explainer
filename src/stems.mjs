/**
 * Stem URL resolution for listen modes (full / solo bass / mute bass / drums+bass / drums solo).
 * Prefer AAC/m4a (Safari + Chrome Web Audio) over WAV; player.js mirrors this.
 */

const COMPRESSED_EXT = /\.(m4a|mp4|aac|mp3)$/i;
const WAV_EXT = /\.wav$/i;

/**
 * @param {Record<string, unknown>} stemsMeta
 * @returns {{ bass: string|null, noBass: string|null, drums: string|null, format: 'aac'|'mp3'|'wav'|null }}
 */
export function resolveStemUrls(stemsMeta = {}) {
  const pick = (compressedKey, primaryKey, wavKey) => {
    const compressed = stemsMeta[compressedKey];
    const primary = stemsMeta[primaryKey];
    const wav = stemsMeta[wavKey];
    if (typeof compressed === "string" && compressed) return compressed;
    if (typeof primary === "string" && primary && COMPRESSED_EXT.test(primary)) return primary;
    if (typeof primary === "string" && primary && !WAV_EXT.test(primary)) return primary;
    if (typeof wav === "string" && wav) return wav;
    if (typeof primary === "string" && primary) return primary;
    return null;
  };

  const bass = pick("bass_m4a", "bass", "bass_wav");
  const noBass = pick("no_bass_m4a", "no_bass", "no_bass_wav");
  const drums = pick("drums_m4a", "drums", "drums_wav");

  let format = null;
  if (bass && COMPRESSED_EXT.test(bass)) {
    format = /\.mp3$/i.test(bass) ? "mp3" : "aac";
  } else if (bass && WAV_EXT.test(bass)) {
    format = "wav";
  } else if (stemsMeta.format === "aac" || stemsMeta.format === "mp3" || stemsMeta.format === "wav") {
    format = stemsMeta.format;
  }

  return { bass, noBass, drums, format };
}

/**
 * Build stems API payload from R2 head presence flags.
 * @param {{
 *   hasBassM4a: boolean, hasNoBassM4a: boolean, hasBassWav: boolean, hasNoBassWav: boolean,
 *   hasDrumsM4a?: boolean, hasDrumsWav?: boolean,
 *   basePath: string
 * }} opts
 */
export function buildStemsMeta(opts) {
  const base = opts.basePath.replace(/\/$/, "");
  const useM4a = Boolean(opts.hasBassM4a && opts.hasNoBassM4a);
  const useWav = Boolean(opts.hasBassWav && opts.hasNoBassWav);
  const available = useM4a || useWav;
  const hasDrumsM4a = Boolean(opts.hasDrumsM4a);
  const hasDrumsWav = Boolean(opts.hasDrumsWav);
  const drumsAvailable = hasDrumsM4a || hasDrumsWav;
  return {
    available,
    access: opts.access || "private",
    muteBassSupported: available,
    drumsAvailable,
    dbSupported: available && drumsAvailable,
    format: useM4a ? "aac" : useWav ? "wav" : null,
    bass: useM4a ? `${base}/bass.m4a` : useWav ? `${base}/bass.wav` : null,
    no_bass: useM4a ? `${base}/no_bass.m4a` : useWav ? `${base}/no_bass.wav` : null,
    drums: hasDrumsM4a ? `${base}/drums.m4a` : hasDrumsWav ? `${base}/drums.wav` : null,
    bass_wav: opts.hasBassWav ? `${base}/bass.wav` : null,
    no_bass_wav: opts.hasNoBassWav ? `${base}/no_bass.wav` : null,
    drums_wav: hasDrumsWav ? `${base}/drums.wav` : null,
    other: `${base}/other.wav`,
  };
}

/** Fixed-width clock for meta row (tabular-nums + stable ch width). */
export function fmtClock(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const tenths = Math.round(s * 10);
  const m = Math.floor(tenths / 600);
  const rem = tenths % 600;
  const mm = String(m);
  const ss = String(Math.floor(rem / 10)).padStart(2, "0");
  const d = String(rem % 10);
  return `${mm}:${ss}.${d}`;
}

export function fmtBarBeat(bar, beat) {
  const b = String(Math.max(0, bar | 0)).padStart(2, " ");
  const bt = String((beat | 0) + 1);
  return `Bar ${b} · beat ${bt}`;
}

export function fmtLoop(lo, hi, loopOn) {
  if (!loopOn) return "Loop —";
  return `Loop ${lo}–${hi}`;
}

/** Apply listen-mode gains: full | solo | mute | db | drums */
export function listenGains(mode, { drumsAvailable = false } = {}) {
  const m = mode || "full";
  if (m === "solo") return { bass: 1, noBass: 0, drums: 0 };
  if (m === "mute") return { bass: 0, noBass: 1, drums: 0 };
  if (m === "db") {
    if (!drumsAvailable) return { bass: 1, noBass: 0, drums: 0 }; // degrade to solo-ish
    return { bass: 1, noBass: 0, drums: 1 };
  }
  if (m === "drums") {
    if (!drumsAvailable) return { bass: 0, noBass: 0, drums: 0 };
    return { bass: 0, noBass: 0, drums: 1 };
  }
  return { bass: 1, noBass: 1, drums: 0 };
}
