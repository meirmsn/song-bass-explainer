import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTransport } from "../src/transport.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(readFileSync(join(root, "fixtures/tiny-demo.json"), "utf8"));
const barTimes = demo.raw.map((r) => r[1]);

function make(resync) {
  return createTransport({
    duration: demo.duration,
    barTimes,
    secs: demo.secs,
    onResyncAudio: resync,
  });
}

describe("initial load", () => {
  it("starts at the whole song with loop off and no section loop", () => {
    const tr = make();
    const s = tr.getState();
    expect(s.playing).toBe(false);
    expect(s.loopOn).toBe(false);
    expect(s.secIdx).toBe(0);
    expect(s.lo).toBe(0);
    expect(s.hi).toBe(demo.nbars - 1);
    expect(s.t).toBeCloseTo(barTimes[0], 5);
    expect(s.sectionName).toBe(demo.secs[0].name);
  });
});

describe("transport play/pause/stop", () => {
  it("starts paused and play toggles to playing", () => {
    const tr = make();
    expect(tr.getState().playing).toBe(false);
    tr.play();
    expect(tr.getState().playing).toBe(true);
    tr.play(); // pause toggle
    expect(tr.getState().playing).toBe(false);
  });

  it("pause is idempotent", () => {
    const tr = make();
    tr.play();
    tr.pause();
    expect(tr.getState().playing).toBe(false);
    tr.pause();
    expect(tr.getState().playing).toBe(false);
  });

  it("stop resets to loop start and clears playing", () => {
    const tr = make();
    tr.play();
    tr.tick(1.2);
    const before = tr.getState();
    expect(before.t).toBeGreaterThan(before.lo === 0 ? 0 : barTimes[before.lo]);
    tr.stop();
    const s = tr.getState();
    expect(s.playing).toBe(false);
    expect(s.t).toBe(barTimes[s.lo]);
  });

  it("tick advances time while playing and not while paused", () => {
    const tr = make();
    const t0 = tr.getState().t;
    tr.tick(0.5);
    expect(tr.getState().t).toBe(t0);
    tr.play();
    tr.tick(0.5);
    expect(tr.getState().t).toBeCloseTo(t0 + 0.5, 5);
  });
});

describe("loop and seek", () => {
  it("loop on wraps within section window", () => {
    const tr = make();
    tr.setLoop(true);
    const { lo, hi } = tr.getState();
    const { le } = tr.loopWindow();
    tr.seek(barTimes[lo]);
    tr.play();
    // jump near end of loop via sync-like ticks
    let guard = 0;
    while (tr.getState().t < le - 0.05 && guard++ < 500) tr.tick(0.05);
    tr.tick(0.1);
    const s = tr.getState();
    expect(s.t).toBeGreaterThanOrEqual(barTimes[lo]);
    expect(s.t).toBeLessThan(le);
  });

  it("seek outside loop snaps to loop start when loop on", () => {
    const tr = make();
    tr.setLoop(true);
    tr.pickSection(0);
    const s0 = tr.getState();
    // section B starts at bar 8 — outside loop of section A
    tr.seek(barTimes[8]);
    expect(tr.getState().t).toBe(barTimes[s0.lo]);
  });

  it("seek while playing calls onResyncAudio", () => {
    const resync = vi.fn();
    const tr = make(resync);
    tr.pickSection(0);
    tr.play();
    resync.mockClear();
    tr.seek(barTimes[2]);
    expect(resync).toHaveBeenCalled();
    expect(resync.mock.calls[0][0]).toBeCloseTo(barTimes[2], 5);
  });

  it("toggle loop off then on restores section bounds", () => {
    const tr = make();
    tr.pickSection(1);
    tr.setLoop(false);
    expect(tr.getState().loopOn).toBe(false);
    tr.setLoop(true);
    const s = tr.getState();
    expect(s.loopOn).toBe(true);
    expect(s.lo).toBe(demo.secs[1].first);
    expect(s.hi).toBe(demo.secs[1].end - 1);
  });
});

describe("section timeline seek while playing", () => {
  it("pickSection updates t and resyncs audio (no silent/stuck audio clock)", () => {
    const resync = vi.fn();
    const tr = make(resync);
    tr.pickSection(0);
    tr.play();
    resync.mockClear();
    tr.pickSection(1);
    const s = tr.getState();
    expect(s.secIdx).toBe(1);
    expect(s.t).toBe(barTimes[demo.secs[1].first]);
    expect(resync).toHaveBeenCalledWith(s.t);
  });

  it("setLoopBars while playing resyncs", () => {
    const resync = vi.fn();
    const tr = make(resync);
    tr.pickSection(1);
    tr.play();
    resync.mockClear();
    tr.setLoopBars(10, 12);
    expect(tr.getState().lo).toBe(10);
    expect(tr.getState().hi).toBe(12);
    expect(resync).toHaveBeenCalled();
  });
});

describe("cards", () => {
  it("nextCard and setCard update index", () => {
    const tr = make();
    expect(tr.getState().cardIdx).toBe(0);
    tr.nextCard();
    expect(tr.getState().cardIdx).toBe(1);
    tr.setCard(3);
    expect(tr.getState().cardIdx).toBe(3);
  });

  it("pickSection resets cardIdx", () => {
    const tr = make();
    tr.setCard(2);
    tr.pickSection(1);
    expect(tr.getState().cardIdx).toBe(0);
  });
});

describe("last section edge", () => {
  it("play on final section does not NaN and can stop", () => {
    const tr = make();
    tr.pickSection(demo.secs.length - 1);
    const s0 = tr.play();
    expect(s0.playing).toBe(true);
    expect(Number.isFinite(s0.t)).toBe(true);
    tr.tick(0.2);
    expect(Number.isFinite(tr.getState().t)).toBe(true);
    tr.stop();
    expect(tr.getState().playing).toBe(false);
  });
});

describe("pause while audio resync pending", () => {
  it("pause clears playing even if resync was scheduled on play", () => {
    const resync = vi.fn();
    const tr = make(resync);
    tr.play();
    expect(tr.getState().playing).toBe(true);
    tr.pause();
    expect(tr.getState().playing).toBe(false);
    tr.tick(0.5);
    expect(tr.getState().playing).toBe(false);
  });
});

describe("keyboard navigation helpers on transport", () => {
  it("Space-equivalent play toggles playing without resetting t", () => {
    const tr = make();
    tr.pickSection(1);
    tr.seek(barTimes[10]);
    const t0 = tr.getState().t;
    tr.play();
    expect(tr.getState().playing).toBe(true);
    expect(tr.getState().t).toBe(t0);
    tr.play(); // pause
    expect(tr.getState().playing).toBe(false);
    expect(tr.getState().t).toBe(t0);
  });

  it("nextSection advances; no-op on last", () => {
    const tr = make();
    tr.pickSection(0);
    tr.nextSection();
    expect(tr.getState().secIdx).toBe(1);
    tr.nextSection();
    expect(tr.getState().secIdx).toBe(2);
    tr.nextSection();
    expect(tr.getState().secIdx).toBe(2);
  });

  it("nextSection while playing seeks t to next section start (not 0) and resyncs", () => {
    const resync = vi.fn();
    const tr = make(resync);
    tr.pickSection(0);
    tr.play();
    tr.seek(barTimes[2]);
    resync.mockClear();
    const nextStart = barTimes[demo.secs[1].first];
    expect(nextStart).toBeGreaterThan(0);
    tr.nextSection();
    const s = tr.getState();
    expect(s.secIdx).toBe(1);
    expect(s.playing).toBe(true);
    expect(s.t).toBe(nextStart);
    expect(s.t).not.toBe(0);
    expect(resync).toHaveBeenCalledWith(nextStart);
  });

  it("leftArrow seeks to loop start, then previous section within threshold", () => {
    const tr = make();
    tr.pickSection(1);
    tr.setLoopBars(10, 12);
    tr.seek(barTimes[11]);
    tr.leftArrow();
    expect(tr.getState().t).toBe(barTimes[10]);
    expect(tr.getState().secIdx).toBe(1);
    // second left near start → previous section
    tr.leftArrow();
    expect(tr.getState().secIdx).toBe(0);
    expect(tr.getState().t).toBe(barTimes[demo.secs[0].first]);
  });

  it("clearSubsection restores full section loop bounds", () => {
    const tr = make();
    tr.pickSection(2);
    tr.setLoopBars(18, 20);
    expect(tr.getState().lo).toBe(18);
    expect(tr.getState().hi).toBe(20);
    tr.clearSubsection();
    const s = tr.getState();
    expect(s.lo).toBe(demo.secs[2].first);
    expect(s.hi).toBe(demo.secs[2].end - 1);
    expect(s.loopOn).toBe(true);
  });

  it("pickSection forces loop on whole section (timeline tap UX)", () => {
    const tr = make();
    tr.setLoop(false);
    tr.pickSection(1);
    const s = tr.getState();
    expect(s.loopOn).toBe(true);
    expect(s.lo).toBe(demo.secs[1].first);
    expect(s.hi).toBe(demo.secs[1].end - 1);
    expect(s.t).toBe(barTimes[demo.secs[1].first]);
  });
});

describe("playbackRate", () => {
  it("tick advances slower at 50%", () => {
    const tr = make();
    tr.setPlaybackRate(0.5);
    const t0 = tr.getState().t;
    tr.play();
    tr.tick(1.0);
    expect(tr.getState().t).toBeCloseTo(t0 + 0.5, 5);
    expect(tr.getState().playbackRate).toBe(0.5);
  });

  it("100% is identity", () => {
    const tr = make();
    tr.setPlaybackRate(1);
    const t0 = tr.getState().t;
    tr.play();
    tr.tick(0.4);
    expect(tr.getState().t).toBeCloseTo(t0 + 0.4, 5);
  });
});
