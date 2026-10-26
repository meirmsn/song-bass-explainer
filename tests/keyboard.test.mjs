import { describe, it, expect } from "vitest";
import {
  LEFT_RESTART_THRESHOLD_S,
  shouldHandleTransportKey,
  decideLeftArrow,
  decideRightArrow,
  decideEscapeSubsection,
  clientXToViewXWithRect,
  barFromViewX,
} from "../src/keyboard.mjs";

describe("shouldHandleTransportKey", () => {
  it("accepts Space / arrows / Escape / L without modifiers", () => {
    expect(shouldHandleTransportKey({ key: " ", target: { tagName: "DIV", isContentEditable: false } })).toBe(true);
    expect(shouldHandleTransportKey({ key: "ArrowLeft", target: { tagName: "DIV", isContentEditable: false } })).toBe(true);
    expect(shouldHandleTransportKey({ key: "ArrowRight", target: { tagName: "DIV", isContentEditable: false } })).toBe(true);
    expect(shouldHandleTransportKey({ key: "Escape", target: { tagName: "DIV", isContentEditable: false } })).toBe(true);
    expect(shouldHandleTransportKey({ key: "l", target: { tagName: "DIV", isContentEditable: false } })).toBe(true);
    expect(shouldHandleTransportKey({ key: "L", target: { tagName: "DIV", isContentEditable: false } })).toBe(true);
  });

  it("ignores modifiers and editable targets", () => {
    expect(shouldHandleTransportKey({ key: " ", metaKey: true, target: { tagName: "DIV", isContentEditable: false } })).toBe(false);
    expect(shouldHandleTransportKey({ key: "l", metaKey: true, target: { tagName: "DIV", isContentEditable: false } })).toBe(false);
    expect(shouldHandleTransportKey({ key: "ArrowLeft", ctrlKey: true, target: { tagName: "DIV", isContentEditable: false } })).toBe(false);
    expect(shouldHandleTransportKey({ key: "ArrowRight", altKey: true, target: { tagName: "DIV", isContentEditable: false } })).toBe(false);
    expect(shouldHandleTransportKey({ key: "ArrowLeft", shiftKey: true, target: { tagName: "DIV", isContentEditable: false } })).toBe(false);
    const input = { tagName: "INPUT", isContentEditable: false };
    expect(shouldHandleTransportKey({ key: " ", target: input })).toBe(false);
    const area = { tagName: "TEXTAREA", isContentEditable: false };
    expect(shouldHandleTransportKey({ key: "ArrowRight", target: area })).toBe(false);
  });
});

describe("decideLeftArrow", () => {
  it("seeks to restart when playhead is past threshold", () => {
    const d = decideLeftArrow({ t: 1.0, restartT: 0.5, secIdx: 2 });
    expect(d).toEqual({ action: "seek", t: 0.5 });
  });

  it("goes to previous section when within threshold of restart", () => {
    const d = decideLeftArrow({
      t: 0.5 + LEFT_RESTART_THRESHOLD_S,
      restartT: 0.5,
      secIdx: 2,
    });
    expect(d).toEqual({ action: "prevSection", secIdx: 1 });
    const d2 = decideLeftArrow({ t: 0.5 + 0.1, restartT: 0.5, secIdx: 2 });
    expect(d2.action).toBe("prevSection");
  });

  it("stays / seeks restart on first section near start", () => {
    const d = decideLeftArrow({ t: 0.05, restartT: 0, secIdx: 0 });
    expect(d).toEqual({ action: "seek", t: 0 });
  });
});

describe("decideRightArrow", () => {
  it("advances section index or no-ops on last", () => {
    expect(decideRightArrow({ secIdx: 1, sectionCount: 3 })).toEqual({
      action: "nextSection",
      secIdx: 2,
    });
    expect(decideRightArrow({ secIdx: 2, sectionCount: 3 })).toEqual({ action: "noop" });
  });
});

describe("decideEscapeSubsection", () => {
  it("clears partial bar range back to full section", () => {
    expect(
      decideEscapeSubsection({ lo: 18, hi: 20, secFirst: 16, secLastBar: 23 }),
    ).toEqual({ action: "clearSubsection", lo: 16, hi: 23 });
  });

  it("no-ops when already full section", () => {
    expect(
      decideEscapeSubsection({ lo: 16, hi: 23, secFirst: 16, secLastBar: 23 }),
    ).toEqual({ action: "noop" });
  });
});

describe("drag geometry (subsection selection)", () => {
  const X0 = 52, W = 900, VBW = 960;

  it("maps clientX through cached rect to exact bars (not section end)", () => {
    // Section C bars 16–23 (n=8). Bar 18 at frac 2/8, bar 20 at frac 4/8.
    const viewLo = 16, viewHi = 23;
    const x18 = X0 + (2 / 8) * W + 1; // slightly into bar 18
    const x20 = X0 + (4 / 8) * W + 1;
    // Simulate dead SVG (width 0) — cached rect still 960px wide
    const v18 = clientXToViewXWithRect(x18, 0, VBW, VBW);
    const v20 = clientXToViewXWithRect(x20, 0, VBW, VBW);
    expect(barFromViewX(v18, viewLo, viewHi, X0, W)).toBe(18);
    expect(barFromViewX(v20, viewLo, viewHi, X0, W)).toBe(20);
    // Broken live-rect path: width 0 → clamp to viewHi (the bug)
    const broken = clientXToViewXWithRect(x20, 0, 0, VBW); // width coerced to 1 inside helper... 
    // With width 1, clientX 502 maps way past viewBox → frac 0.999 → viewHi
    const brokenBar = barFromViewX(broken, viewLo, viewHi, X0, W);
    expect(brokenBar).toBe(viewHi);
  });
});
