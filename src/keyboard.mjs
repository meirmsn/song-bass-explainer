/**
 * Pure keyboard / navigation helpers for the bass study player.
 * player.js mirrors these rules in its keydown handler.
 */

export const LEFT_RESTART_THRESHOLD_S = 0.25;

export function isEditableKeyTarget(target) {
  if (!target || typeof target !== "object") return false;
  const tag = String(target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;
  return false;
}

/** True when Space / arrows / Escape / L should drive the player (not the browser). */
export function shouldHandleTransportKey(e) {
  if (!e || typeof e.key !== "string") return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ")) return false;
  if (isEditableKeyTarget(e.target)) return false;
  const k = e.key;
  return k === " " || k === "ArrowLeft" || k === "ArrowRight" || k === "Escape"
    || k === "l" || k === "L";
}

/**
 * Left arrow: seek to loop/section start, or previous section if already near that start.
 * restartT = loop start when a loop/selection is active, else current section start.
 */
export function decideLeftArrow({ t, restartT, secIdx, threshold = LEFT_RESTART_THRESHOLD_S }) {
  const nearStart = t <= restartT + threshold;
  if (!nearStart) return { action: "seek", t: restartT };
  if (secIdx > 0) return { action: "prevSection", secIdx: secIdx - 1 };
  return { action: "seek", t: restartT };
}

export function decideRightArrow({ secIdx, sectionCount }) {
  if (secIdx + 1 < sectionCount) return { action: "nextSection", secIdx: secIdx + 1 };
  return { action: "noop" };
}

/**
 * Escape: clear dragged subsection (partial bar range) back to the full section loop.
 * No-op when there is no partial selection.
 */
export function decideEscapeSubsection({ lo, hi, secFirst, secLastBar }) {
  const partial = lo > secFirst || hi < secLastBar;
  if (!partial) return { action: "noop" };
  return { action: "clearSubsection", lo: secFirst, hi: secLastBar };
}

/** Map clientX through a cached layout rect (survives SVG teardown mid-drag). */
export function clientXToViewXWithRect(clientX, rectLeft, rectWidth, viewBoxWidth) {
  const w = Math.max(rectWidth, 1);
  return ((clientX - rectLeft) / w) * viewBoxWidth;
}

export function barFromViewX(viewX, viewLo, viewHi, x0, plotW) {
  const n = viewHi - viewLo + 1;
  const frac = Math.max(0, Math.min(0.999, (viewX - x0) / plotW));
  return Math.min(viewHi, Math.max(viewLo, Math.floor(viewLo + frac * n)));
}
