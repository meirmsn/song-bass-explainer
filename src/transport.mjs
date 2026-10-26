/**
 * Pure player transport — source of truth for play/pause/stop/seek/loop/section/cards.
 * Browser player.js mirrors these rules; tests lock the behavior here.
 */

import {
  LEFT_RESTART_THRESHOLD_S,
  decideLeftArrow,
  decideRightArrow,
  decideEscapeSubsection,
} from "./keyboard.mjs";

export { LEFT_RESTART_THRESHOLD_S };

export function createTransport(opts) {
  const {
    duration,
    barTimes, // number[] length nbars — start time of each bar
    secs, // [{ first, end, name?, kind? }]
    onResyncAudio = null, // (t) => void — restart stems at t when playing with audio
  } = opts;

  const nbars = barTimes.length;
  if (!nbars) throw new Error("barTimes required");
  if (!secs?.length) throw new Error("secs required");

  const barAt = (t) => {
    for (let i = nbars - 1; i >= 0; i--) if (t >= barTimes[i]) return i;
    return 0;
  };
  const secIndexOfBar = (bar) => {
    for (let i = secs.length - 1; i >= 0; i--) if (bar >= secs[i].first) return i;
    return 0;
  };
  const sectionLoopBounds = (i) => {
    const s = secs[i];
    return { lo: s.first, hi: s.end - 1 };
  };
  const loopWindow = (lo, hi) => {
    const ls = barTimes[lo];
    const le = hi + 1 < nbars ? barTimes[hi + 1] : duration;
    return { ls, le };
  };

  let secIdx = Math.min(2, secs.length - 1);
  let { lo, hi } = sectionLoopBounds(secIdx);
  let t = barTimes[secs[secIdx].first];
  let playing = false;
  let loopOn = true;
  let cardIdx = 0;
  let playbackRate = 1;

  function applySection(i, seekToStart) {
    const s = secs[i];
    secIdx = i;
    lo = s.first;
    hi = s.end - 1;
    cardIdx = 0;
    if (seekToStart) t = barTimes[s.first];
  }

  function maybeResync() {
    if (playing && typeof onResyncAudio === "function") onResyncAudio(t);
  }

  function getState() {
    return {
      t,
      playing,
      loopOn,
      secIdx,
      cardIdx,
      lo,
      hi,
      duration,
      sectionName: secs[secIdx]?.name ?? String(secIdx),
      playbackRate,
    };
  }

  function play() {
    // toggle: pause
    if (playing) {
      playing = false;
      return getState();
    }
    const { ls, le } = loopWindow(lo, hi);
    if (loopOn && (t < ls || t >= le)) t = ls;
    if (t >= duration) t = ls;
    playing = true;
    maybeResync();
    return getState();
  }

  function pause() {
    if (!playing) return getState();
    playing = false;
    return getState();
  }

  function stop() {
    playing = false;
    t = barTimes[lo];
    return getState();
  }

  function seek(time) {
    let clamped = Math.max(0, Math.min(duration, time));
    if (loopOn) {
      const b = barAt(clamped);
      if (b < lo || b > hi) {
        t = barTimes[lo];
        maybeResync();
        return getState();
      }
    }
    t = clamped;
    if (!loopOn) {
      const i = secIndexOfBar(barAt(clamped));
      if (i !== secIdx) applySection(i, false);
    }
    maybeResync();
    return getState();
  }

  /** Timeline tap: select section, loop whole section, seek to start, resync if playing. */
  function pickSection(i) {
    if (i < 0 || i >= secs.length) throw new Error("bad section");
    applySection(i, true);
    loopOn = true;
    lo = secs[i].first;
    hi = secs[i].end - 1;
    maybeResync();
    return getState();
  }

  function setLoop(on) {
    loopOn = Boolean(on);
    if (loopOn) {
      const s = secs[secIdx];
      lo = s.first;
      hi = s.end - 1;
    }
    return getState();
  }

  function toggleLoop() {
    return setLoop(!loopOn);
  }

  function setLoopBars(a, b) {
    const sec = secs[secIdx];
    lo = Math.max(sec.first, Math.min(a, b));
    hi = Math.min(sec.end - 1, Math.max(a, b));
    loopOn = true;
    t = barTimes[lo];
    maybeResync();
    return getState();
  }

  /** Escape: clear partial subsection back to full section loop. */
  function clearSubsection() {
    const sec = secs[secIdx];
    const decision = decideEscapeSubsection({
      lo,
      hi,
      secFirst: sec.first,
      secLastBar: sec.end - 1,
    });
    if (decision.action === "clearSubsection") {
      lo = decision.lo;
      hi = decision.hi;
      loopOn = true;
      t = barTimes[lo];
      maybeResync();
    }
    return getState();
  }

  function nextSection() {
    const d = decideRightArrow({ secIdx, sectionCount: secs.length });
    if (d.action === "nextSection") return pickSection(d.secIdx);
    return getState();
  }

  function leftArrow(threshold = LEFT_RESTART_THRESHOLD_S) {
    const restartT = loopOn ? barTimes[lo] : barTimes[secs[secIdx].first];
    const d = decideLeftArrow({ t, restartT, secIdx, threshold });
    if (d.action === "prevSection") return pickSection(d.secIdx);
    return seek(d.t);
  }

  function tick(dt) {
    if (!playing) return getState();
    const { ls, le } = loopWindow(lo, hi);
    t += dt * (playbackRate > 0 ? playbackRate : 1);
    if (loopOn && t >= le) t = ls;
    if (t >= duration) {
      t = duration;
      playing = false;
    }
    if (!loopOn) {
      const i = secIndexOfBar(barAt(t));
      if (i !== secIdx) applySection(i, false);
    }
    return getState();
  }

  /** When audio clock is master, overwrite t from audio position. */
  function syncFromAudio(audioT) {
    t = Math.max(0, Math.min(duration, audioT));
    const { ls, le } = loopWindow(lo, hi);
    if (loopOn && t >= le) {
      t = ls;
      maybeResync();
    }
    if (t >= duration) {
      t = duration;
      playing = false;
    }
    if (!loopOn) {
      const i = secIndexOfBar(barAt(t));
      if (i !== secIdx) applySection(i, false);
    }
    return getState();
  }

  function nextCard() {
    cardIdx += 1;
    return getState();
  }

  function setCard(i) {
    cardIdx = i;
    return getState();
  }

  function setPlaybackRate(rate) {
    const r = Number(rate);
    if (!(r > 0)) return getState();
    playbackRate = r;
    return getState();
  }

  return {
    getState,
    play,
    pause,
    stop,
    seek,
    pickSection,
    setLoop,
    toggleLoop,
    setLoopBars,
    clearSubsection,
    nextSection,
    leftArrow,
    tick,
    syncFromAudio,
    nextCard,
    setCard,
    setPlaybackRate,
    barAt,
    loopWindow: () => loopWindow(lo, hi),
  };
}
