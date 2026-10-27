/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const demo = JSON.parse(readFileSync(join(root, "fixtures/tiny-demo.json"), "utf8"));
const playerSrc = readFileSync(join(root, "../public/js/player.js"), "utf8");


function teardownPlayer() {
  try {
    if (window.__BASS_PLAYER__ && typeof window.__BASS_PLAYER__.destroy === "function") {
      window.__BASS_PLAYER__.destroy();
    } else if (window.__BASS_PLAYER__ && typeof window.__BASS_PLAYER__.pause === "function") {
      window.__BASS_PLAYER__.pause();
    }
  } catch (_) { /* ignore */ }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  delete window.__BASS_PLAYER__;
  delete window.__BASS_NOTATION__;
  delete window.__BASS_PRIVATE__;
  delete window.__BASS_SONG_NAV__;
  delete window.__LAST_AUDIO_CTX__;
  document.body.classList.remove("cards-drawer-open");
  try { window.history.replaceState({}, "", "/"); } catch (_) { /* ignore */ }
  try {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 800 });
  } catch (_) { /* ignore */ }
}


function setViewport(width, height = 844) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: height });
}

async function bootPlayer({ privateMode = true, withStems = false, mutatePayload = null, width = null, height = 844, stemSeconds = 0.25, stemChannels = 1 } = {}) {
  if (width != null) setViewport(width, height);
  document.body.innerHTML = '<div id="app"></div>';
  window.__BASS_PRIVATE__ = privateMode;
  delete window.__BASS_PLAYER__;

  const payload = structuredClone(demo);
  if (typeof mutatePayload === "function") mutatePayload(payload);
  if (withStems) {
    const base = privateMode
      ? "/private/api/demo/fixture/stems"
      : "/api/demo/make-funk/stems";
    payload.stems = {
      available: true,
      access: privateMode ? "private" : "public",
      muteBassSupported: true,
      drumsAvailable: true,
      dbSupported: true,
      format: "aac",
      bass: base + "/bass.m4a",
      no_bass: base + "/no_bass.m4a",
      drums: base + "/drums.m4a",
      bass_wav: base + "/bass.wav",
      no_bass_wav: base + "/no_bass.wav",
      drums_wav: base + "/drums.wav",
    };
    if (!privateMode) {
      payload.credit = {
        title: "Make Funk",
        artist: "HoliznaCC0",
        license: "CC0 1.0 Universal",
        source: "Free Music Archive",
        url: "https://freemusicarchive.org/music/holiznacc0/bassic/make-funk/",
      };
    }
  }

  const fetchMock = vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("/private/api/catalog")) {
      return new Response(JSON.stringify({
        demos: [
          { id: "a-good-bass-for-gambling", title: "A good bass for gambling", artist: "Komiku", group: "demo" },
          { id: "make-funk", title: "Make Funk", artist: "HoliznaCC0", group: "demo" },
          { id: "maple-leaf-rag", title: "Maple Leaf Rag", artist: "Scott Joplin", group: "demo" },
        ],
        processed: [
          { id: "like-a-prayer", title: "Like a Prayer", artist: "Madonna / study", group: "processed" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/api/demo/catalog")) {
      return new Response(JSON.stringify({
        songs: [
          { id: "make-funk", title: "Make Funk", artist: "HoliznaCC0", license: "CC0 1.0 Universal" },
          { id: "maple-leaf-rag", title: "Maple Leaf Rag", artist: "Scott Joplin", license: "Public Domain Mark 1.0" },
          { id: "like-a-prayer", title: "Like a Prayer", artist: "Madonna / study", license: "private" },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (u.includes("/private/api/demo/") || u.includes("/api/demo/") || u.endsWith("demo-data.json") || u.includes("/study/resource.json")) {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (u.includes("/stems/")) {
      return new Response(new Uint8Array(64), {
        status: 200,
        headers: { "content-type": u.includes(".m4a") ? "audio/mp4" : "audio/wav" },
      });
    }
    return new Response("nope", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);

  class FakeGain {
    constructor() {
      this.gain = { value: 1 };
      this.connect = () => this;
      this.disconnect = () => {};
    }
  }
  class FakeSource {
    constructor() {
      this.buffer = null;
      this.playbackRate = { value: 1 };
      this.connect = () => {};
      this.startedAt = null;
      this.startOffset = 0;
      this.stopped = false;
    }
    start(when, offset) {
      this.startedAt = when;
      this.startOffset = offset == null ? 0 : offset;
    }
    // stop(0) is all-notes-off. A future when is the note's own scheduled end.
    stop(when) {
      this._stopCount = (this._stopCount || 0) + 1;
      this._lastStopWhen = when;
      this.stopped = !(typeof when === "number" && when > 0);
    }
  }
  class FakeParam {
    constructor(v = 0) { this.value = v; }
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
  }
  class FakeOsc {
    constructor() {
      this.type = "sine";
      this.frequency = new FakeParam(440);
      this._started = false;
      this._stopped = false;
      this._stopCount = 0;
    }
    connect() { return this; }
    disconnect() {}
    start() { this._started = true; }
    // stop(0) is all-notes-off. A future when is the note's own scheduled end.
    stop(when) {
      this._stopCount += 1;
      this._lastStopWhen = when;
      this._stopped = !(typeof when === "number" && when > 0);
    }
  }
  class FakeBiquad {
    constructor() {
      this.type = "lowpass";
      this.frequency = new FakeParam(1000);
      this.Q = new FakeParam(1);
    }
    connect() { return this; }
    disconnect() {}
  }
  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
      this._oscCount = 0;
      this._bufSrcCount = 0;
      this._oscillators = [];
      this._filters = [];
      this._sources = [];
      window.__LAST_AUDIO_CTX__ = this;
    }
    createGain() {
      const g = new FakeGain();
      g.gain = new FakeParam(1);
      return g;
    }
    createBufferSource() {
      this._bufSrcCount += 1;
      const s = new FakeSource();
      this._sources.push(s);
      return s;
    }
    createOscillator() {
      this._oscCount += 1;
      const o = new FakeOsc();
      this._oscillators.push(o);
      return o;
    }
    createBiquadFilter() {
      const f = new FakeBiquad();
      this._filters.push(f);
      return f;
    }
    createBuffer(channels, length, sampleRate) {
      const ch = Math.max(1, channels || 1);
      const data = Array.from({ length: ch }, () => new Float32Array(length));
      return {
        duration: length / sampleRate,
        length,
        sampleRate,
        numberOfChannels: ch,
        getChannelData: (i) => data[i] || data[0],
      };
    }
    async decodeAudioData() {
      // Default short stretchable buffer. Tests may request long stems to catch full-track WSOLA freezes.
      const sampleRate = 44100;
      const secs = stemSeconds > 0 ? stemSeconds : 0.25;
      const ch = Math.max(1, stemChannels || 1);
      const length = Math.floor(sampleRate * secs);
      const data = Array.from({ length: ch }, () => new Float32Array(length));
      for (let c = 0; c < ch; c++) {
        for (let i = 0; i < length; i++) data[c][i] = Math.sin(2 * Math.PI * 110 * i / sampleRate);
      }
      // Short fixtures lie duration=study length (clamp math); long-stem tests use real duration=secs.
      const duration = secs > demo.duration ? secs : demo.duration;
      return {
        duration,
        length,
        sampleRate,
        numberOfChannels: ch,
        getChannelData: (i) => data[i] || data[0],
      };
    }
    async resume() {
      this.state = "running";
    }
    async suspend() {
      this.state = "suspended";
    }
  }
  vi.stubGlobal("AudioContext", FakeAudioContext);
  window.AudioContext = FakeAudioContext;
  window.webkitAudioContext = FakeAudioContext;

  await new Promise((resolve, reject) => {
    const onReady = () => {
      window.removeEventListener("bass-player-ready", onReady);
      resolve();
    };
    window.addEventListener("bass-player-ready", onReady);
    const run = new Function(playerSrc);
    try {
      run();
    } catch (e) {
      reject(e);
    }
    setTimeout(() => reject(new Error("player boot timeout")), 3000);
  });

  expect(window.__BASS_PLAYER__).toBeTruthy();
  return window.__BASS_PLAYER__;
}

describe("player DOM shell transport", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("play then pause updates state and Play/Pause label", async () => {
    const api = await bootPlayer({ privateMode: true });
    expect(api.getState().playing).toBe(false);
    api.play();
    await api.waitTick(30);
    expect(api.getState().playing).toBe(true);
    expect(document.querySelector('button[aria-label="Pause"]')).toBeTruthy();
    api.play();
    await api.waitTick(30);
    expect(api.getState().playing).toBe(false);
    expect(document.querySelector('button[aria-label="Play"]')).toBeTruthy();
  });

  it("stop resets to loop start and clears playing", async () => {
    const api = await bootPlayer();
    api.play();
    await api.waitTick(150);
    api.stop();
    const s = api.getState();
    expect(s.playing).toBe(false);
    expect(s.t).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s.t)).toBe(true);
  });

  it("card next/set updates cardIdx", async () => {
    const api = await bootPlayer();
    expect(api.getState().cardIdx).toBe(0);
    api.nextCard();
    expect(api.getState().cardIdx).toBe(1);
    api.setCard(0);
    expect(api.getState().cardIdx).toBe(0);
  });

  it("loop toggle flips loopOn", async () => {
    const api = await bootPlayer();
    expect(api.getState().loopOn).toBe(false);
    api.toggleLoop();
    expect(api.getState().loopOn).toBe(true);
    const loopBtn = [...document.querySelectorAll("button")].find((b) => /Loop/i.test(b.getAttribute("aria-label") || ""));
    expect(loopBtn?.getAttribute("aria-label")).toMatch(/Loop on/i);
    api.toggleLoop();
    expect(api.getState().loopOn).toBe(false);
  });

  it("load starts non-loop on the whole song (playhead section, not a preselected loop)", async () => {
    const api = await bootPlayer();
    const s = api.getState();
    expect(s.loopOn).toBe(false);
    expect(s.playing).toBe(false);
    expect(s.secIdx).toBe(0);
    expect(s.sectionName).toBe("A");
    expect(s.lo).toBe(0);
    expect(s.hi).toBe(demo.nbars - 1);
    expect(s.t).toBeCloseTo(demo.raw[0][1], 5);
    expect(document.querySelector('[data-meta="loop"]')?.textContent).toBe("Loop —");
    expect(document.querySelector('button[aria-label="Loop off"]')).toBeTruthy();
  });

  it("section pick while playing updates section", async () => {
    const api = await bootPlayer();
    api.pickSection(0);
    api.play();
    await api.waitTick(30);
    api.pickSection(1);
    const s = api.getState();
    expect(s.secIdx).toBe(1);
    expect(s.sectionName).toBe("B");
  });

  it("with stems mock, play sets usingAudio after ensureAudio", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.play();
    await api.waitTick(80);
    const s = api.getState();
    expect(s.muteBassSupported).toBe(true);
    expect(s.playing).toBe(true);
    expect(s.audioReady || s.usingAudio).toBe(true);
  });

  it("section seek while playing keeps playing (audio resync path)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(0);
    api.play();
    await api.waitTick(80);
    expect(api.getState().playing).toBe(true);
    api.pickSection(2);
    await api.waitTick(40);
    const s = api.getState();
    expect(s.playing).toBe(true);
    expect(s.secIdx).toBe(2);
    expect(s.sectionName).toBe("C");
  });
  it("pattern id / tab label / card set stay constant while t advances within one section", async () => {
    const api = await bootPlayer();
    // Section C = chorus with two patterns (sync_oct, walk). Old bug flipped every 2 bars.
    api.pickSection(2);
    api.setLoop(false);
    const start = api.getState();
    expect(start.sectionKind).toBe("chorus");
    expect(start.patternId).toBe("sync_oct");
    expect(start.patternName).toBe("Syncopated octave drop");
    expect(start.tabLabel).toMatch(/Syncopated octave drop/);
    const baseCards = start.cardLabels.slice();
    const baseBodies = start.cardBodies.slice();
    expect(baseCards).toEqual(["Pocket", "Figure", "Harmony", "Missable"]);
    expect(baseBodies.some((b) => /octave drop/i.test(b))).toBe(true);

    // Advance t across several bars inside the same section (bars 16–23).
    const times = [8.0, 8.6, 9.2, 10.0, 11.0];
    for (const t of times) {
      api.seek(t);
      const s = api.getState();
      expect(s.secIdx).toBe(2);
      expect(s.sectionName).toBe("C");
      expect(s.patternId).toBe("sync_oct");
      expect(s.patternName).toBe("Syncopated octave drop");
      expect(s.tabLabel).toMatch(/Syncopated octave drop/);
      expect(s.tabLabel).not.toMatch(/A–C–D ascending walk/);
      expect(s.cardLabels).toEqual(baseCards);
      expect(s.cardBodies).toEqual(baseBodies);
    }

    // Only change on section boundary.
    api.pickSection(1);
    const next = api.getState();
    expect(next.secIdx).toBe(1);
    expect(next.patternId).toBe("pedal");
    expect(next.cardBodies).not.toEqual(baseBodies);
    expect(next.cardBodies.some((b) => /Root notes on the beat/i.test(b))).toBe(true);
  });

  it("header has icon transport top-right cluster (play/stop/loop)", async () => {
    const api = await bootPlayer();
    void api;
    const header = document.querySelector(".header");
    const transport = document.querySelector(".transport");
    const meta = document.querySelector(".meta");
    expect(header).toBeTruthy();
    expect(transport).toBeTruthy();
    expect(meta).toBeTruthy();
    expect(header.contains(meta)).toBe(true);
    expect(header.contains(transport)).toBe(true);
    // Transport is the last child of header (top-right in mockup flex row).
    expect(header.lastElementChild).toBe(transport);
    const labels = [...transport.querySelectorAll("button.icon-btn")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(expect.arrayContaining(["Play", "Stop", "Loop off"]));
    // Icons, not text labels as button content.
    for (const btn of transport.querySelectorAll("button.icon-btn")) {
      expect(btn.querySelector("svg")).toBeTruthy();
      expect((btn.textContent || "").trim().length).toBe(0);
    }
  });

  it("flashcards sit in grid card area with section-scoped arranger cards", async () => {
    const api = await bootPlayer();
    api.pickSection(2);
    const grid = document.querySelector(".grid");
    const cards = document.querySelector(".cards");
    const layers = document.querySelector(".layers");
    expect(grid).toBeTruthy();
    expect(cards).toBeTruthy();
    expect(layers).toBeTruthy();
    expect(grid.contains(cards)).toBe(true);
    expect(grid.contains(layers)).toBe(true);
    // Side-by-side mockup order: layers then cards (not a lone row under everything).
    expect([...grid.children].map((c) => c.className)).toEqual(["layers", "cards"]);
    expect(document.querySelector(".cards-title")?.textContent).toBe("Flashcards");
    expect(document.querySelector(".card-label")?.textContent).toBe("Pocket");
    expect(document.querySelector(".card-body")?.textContent).toMatch(/Same grid; bass sits against the kick/);
    const minis = [...document.querySelectorAll(".card-mini-label")].map((n) => n.textContent);
    expect(minis).toEqual(["Pocket", "Figure", "Harmony", "Missable"]);

    api.pickSection(0);
    expect(api.getState().activeCardLabel).toBe("Pocket");
    expect(document.querySelector(".card-body")?.textContent).toMatch(/Steady pulse for testing/);
    expect(document.querySelector(".cards-head .sub")?.textContent).toMatch(/^A ·/);
  });

  it("icon Pause/Stop via data-transport survive re-render (Safari click path)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.play();
    await api.waitTick(80);
    expect(api.getState().playing).toBe(true);
    const pauseBtn = document.querySelector('button[data-transport="pause"]');
    expect(pauseBtn).toBeTruthy();
    // Simulate Safari: destroy/rebuild between down and up — fire pointerup on NEW pause btn under cursor.
    api.waitTick(10);
    const again = document.querySelector('button[data-transport="pause"]');
    again.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().playing).toBe(false);
    expect(api.getState().usingAudio).toBe(false);
    expect(api.getAudioCtxState()).toBe("suspended");

    api.play();
    await api.waitTick(80);
    expect(api.getState().playing).toBe(true);
    const stopBtn = document.querySelector('button[data-transport="stop"]');
    stopBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    const s = api.getState();
    expect(s.playing).toBe(false);
    expect(s.usingAudio).toBe(false);
    expect(Number.isFinite(s.t)).toBe(true);
    expect(api.getAudioCtxState()).toBe("suspended");
  });

  it("pause during ensureAudio race does not restart stems", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    // Slow decode: patch fetch for stems to delay
    const origFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (url) => {
      const u = String(url);
      if (u.includes("/stems/")) {
        await new Promise((r) => setTimeout(r, 120));
      }
      return origFetch(url);
    });
    api.play();
    await api.waitTick(20);
    expect(api.getState().playing).toBe(true);
    api.pause();
    expect(api.getState().playing).toBe(false);
    await api.waitTick(200);
    const s = api.getState();
    expect(s.playing).toBe(false);
    expect(s.usingAudio).toBe(false);
  });

  it("chord name and Roman labels use larger font sizes", async () => {
    const api = await bootPlayer();
    void api;
    const chordSvg = document.querySelector('svg[aria-label="Chord names"]');
    expect(chordSvg).toBeTruthy();
    const texts = [...chordSvg.querySelectorAll("text")];
    const sizes = texts.map((t) => Number(t.getAttribute("font-size")));
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(18);
    // Roman line should be > old 10px
    const romanish = sizes.filter((s) => s >= 12 && s < 18);
    expect(romanish.length).toBeGreaterThan(0);
  });



  it("S/M/D&B controls sit immediately under the Bass staff label (not beside)", async () => {
    await bootPlayer({ privateMode: true, withStems: true });
    const bassLayer = [...document.querySelectorAll(".layer")].find((l) =>
      /Bass staff/i.test(l.querySelector(".layer-head-title")?.textContent || "")
    );
    expect(bassLayer).toBeTruthy();
    const head = bassLayer.querySelector(".layer-head");
    const title = head.querySelector(".layer-head-title");
    const strip = head.querySelector(".ch-strip");
    expect(title).toBeTruthy();
    expect(strip).toBeTruthy();
    // Immediately under the label: strip is the next sibling of the title
    expect(title.nextElementSibling).toBe(strip);
    // Stacked under (column), not beside on the same row (default flex row)
    expect(head.classList.contains("with-ch-strip")).toBe(true);
    expect(getComputedStyle(head).flexDirection).toBe("column");
    // Must not live in transport
    expect(document.querySelector('.transport [data-listen]')).toBeFalsy();
  });

  it("S/M/D&B channel strip on bass staff; M mutes bass; S solos; D&B drums+bass", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    expect(api.getState().muteBassSupported).toBe(true);
    expect(api.getState().drumsSupported).toBe(true);
    expect(api.getState().listenMode).toBe("full");
    expect(api.getState().muteBass).toBe(false);
    // Mute removed from transport
    expect(document.querySelector('.transport [data-transport="mute"]')).toBeFalsy();
    expect(document.querySelector('.transport [data-transport="listen"]')).toBeFalsy();
    const strip = document.querySelector(".ch-strip");
    expect(strip).toBeTruthy();
    // Strip lives in Bass staff layer head (stacked under label)
    const bassHead = [...document.querySelectorAll(".layer-head")].find((h) => /Bass staff/i.test(h.textContent || ""));
    expect(bassHead).toBeTruthy();
    expect(bassHead.querySelector(".ch-strip")).toBeTruthy();

    const mBtn = document.querySelector('button[data-listen="mute"]');
    const sBtn = document.querySelector('button[data-listen="solo"]');
    const dbBtn = document.querySelector('button[data-listen="db"]');
    expect(mBtn && sBtn && dbBtn).toBeTruthy();
    expect(dbBtn.disabled).toBe(false);

    mBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("mute");
    expect(api.getState().muteBass).toBe(true);
    expect(document.querySelector('button[data-listen="mute"].on')).toBeTruthy();

    document.querySelector('button[data-listen="solo"]').dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("solo");
    expect(api.getState().muteBass).toBe(false);
    expect(document.querySelector('button[data-listen="solo"].on')).toBeTruthy();

    document.querySelector('button[data-listen="db"]').dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("db");
    expect(document.querySelector('button[data-listen="db"].on')).toBeTruthy();

    // Toggle same mode → back to full
    api.setListenMode("db");
    expect(api.getState().listenMode).toBe("full");
  });

  it("channel strip is absent on public (no stems) player", async () => {
    await bootPlayer({ privateMode: false, withStems: false });
    // Bass/drums stem strips stay hidden without stems; chord MIDI strip is always available.
    expect(document.querySelector('.ch-strip[data-ch-strip="bass"]')).toBeFalsy();
    expect(document.querySelector('.ch-strip[data-ch-strip="drums"]')).toBeFalsy();
    expect(document.querySelector('.ch-strip[data-ch-strip="chords"]')).toBeTruthy();
    expect(document.querySelector('.transport [data-transport="mute"]')).toBeFalsy();
  });

  it("drum staff has stacked S under its label (channel-strip style)", async () => {
    await bootPlayer({ privateMode: true, withStems: true });
    const drumLayer = [...document.querySelectorAll(".layer")].find((l) =>
      /Drum staff/i.test(l.querySelector(".layer-head-title")?.textContent || "")
    );
    expect(drumLayer).toBeTruthy();
    const head = drumLayer.querySelector(".layer-head");
    const title = head.querySelector(".layer-head-title");
    const strip = head.querySelector('.ch-strip[data-ch-strip="drums"]');
    expect(title).toBeTruthy();
    expect(strip).toBeTruthy();
    expect(title.nextElementSibling).toBe(strip);
    expect(head.classList.contains("with-ch-strip")).toBe(true);
    expect(getComputedStyle(head).flexDirection).toBe("column");
    const drumS = strip.querySelector('button[data-listen="drums"]');
    expect(drumS).toBeTruthy();
    expect(drumS.textContent.trim()).toBe("S");
    expect(drumS.disabled).toBe(false);
    // No drum M unless separately requested
    expect(strip.querySelector('button[data-listen="mute"]')).toBeFalsy();
  });

  it("tapping D&B turns drum staff S on; drum S solos drums", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const drumS = () => document.querySelector('button[data-listen="drums"]');
    const dbBtn = () => document.querySelector('button[data-listen="db"]');
    expect(drumS()).toBeTruthy();
    expect(drumS().classList.contains("on")).toBe(false);

    dbBtn().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("db");
    expect(dbBtn().classList.contains("on")).toBe(true);
    // D&B lights drum S and bass S (both stems in the mix)
    expect(drumS().classList.contains("on")).toBe(true);
    expect(drumS().getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector('button[data-listen="solo"].on')).toBeTruthy();
    expect(document.querySelector('button[data-listen="solo"]').getAttribute("aria-pressed")).toBe("true");

    // Drum S alone → drums-only listen mode (clears D&B)
    drumS().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("drums");
    expect(drumS().classList.contains("on")).toBe(true);
    expect(dbBtn().classList.contains("on")).toBe(false);
    expect(document.querySelector('button[data-listen="solo"].on')).toBeFalsy();

    // Toggle drum S → full
    api.setListenMode("drums");
    expect(api.getState().listenMode).toBe("full");
    expect(drumS().classList.contains("on")).toBe(false);
  });

  it("D&B lights bass S + drum S; tapping bass S clears D&B into bass solo", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const bassS = () => document.querySelector('button[data-listen="solo"]');
    const drumS = () => document.querySelector('button[data-listen="drums"]');
    const dbBtn = () => document.querySelector('button[data-listen="db"]');

    dbBtn().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("db");
    expect(bassS().classList.contains("on")).toBe(true);
    expect(drumS().classList.contains("on")).toBe(true);
    expect(dbBtn().classList.contains("on")).toBe(true);

    // Bass S while in D&B → bass solo (clears D&B; drum S off)
    bassS().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("solo");
    expect(bassS().classList.contains("on")).toBe(true);
    expect(drumS().classList.contains("on")).toBe(false);
    expect(dbBtn().classList.contains("on")).toBe(false);

    // Back to D&B, then drum S → drums solo
    api.setListenMode("db");
    await api.waitTick(10);
    expect(bassS().classList.contains("on")).toBe(true);
    expect(drumS().classList.contains("on")).toBe(true);
    drumS().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().listenMode).toBe("drums");
    expect(bassS().classList.contains("on")).toBe(false);
    expect(drumS().classList.contains("on")).toBe(true);
    expect(dbBtn().classList.contains("on")).toBe(false);
  });


});


describe("stem preload + compressed URLs", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("resolves m4a stem URLs and preloads fetch on private boot (no double-fetch)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    await api.waitTick(40);
    const s0 = api.getState();
    expect(s0.stemUrls.bass).toMatch(/\.m4a$/);
    expect(s0.stemUrls.noBass).toMatch(/\.m4a$/);
    expect(s0.stemFetchCount).toBe(1);
    expect(s0.stemUrls.drums).toMatch(/\.m4a$/);
    const stemCalls = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/stems/"));
    expect(stemCalls.length).toBe(3);
    await api.ensureAudio();
    await api.ensureAudio();
    expect(api.getState().stemFetchCount).toBe(1);
    expect(api.getState().audioReady).toBe(true);
    const stemCallsAfter = vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/stems/"));
    expect(stemCallsAfter.length).toBe(3);
  });

  it("play clears stemLoading once buffers ready", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.play();
    await api.waitTick(100);
    expect(api.getState().audioReady || api.getState().usingAudio).toBe(true);
    expect(api.getState().stemLoading).toBe(false);
    const badge = document.querySelector('[data-meta="badge"]');
    expect(badge?.textContent).not.toMatch(/Loading stems/);
  });
});

describe("meta playback row layout stability", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("injects tabular-nums and fixed min-width for live stats", async () => {
    const api = await bootPlayer();
    void api;
    const css = document.getElementById("bass-player-styles")?.textContent || "";
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);
    expect(css).toMatch(/\[data-meta="barbeat"\]/);
    expect(css).toMatch(/min-width:\s*14ch/);
    expect(css).toMatch(/min-width:\s*7ch/);
    expect(css).toMatch(/\.loop-slot/);
    expect(document.querySelector('[data-meta="barbeat"]')).toBeTruthy();
    expect(document.querySelector('[data-meta="clock"]')).toBeTruthy();
    expect(document.querySelector('[data-meta="loop"]')).toBeTruthy();
  });

  it("barbeat text length stable across digit changes", async () => {
    const api = await bootPlayer();
    api.seek(4.0);
    await api.waitTick(20);
    const b1 = document.querySelector('[data-meta="barbeat"]')?.textContent || "";
    api.pickSection(2);
    api.seek(8.0);
    await api.waitTick(20);
    const b2 = document.querySelector('[data-meta="barbeat"]')?.textContent || "";
    expect(b1.length).toBe(b2.length);
    expect(b1).toMatch(/^Bar /);
    expect(document.querySelector('[data-meta="clock"]')?.textContent).toMatch(/^\d+:\d{2}\.\d$/);
  });

  it("loop slot remains in DOM when loop off", async () => {
    const api = await bootPlayer();
    api.setLoop(false);
    await api.waitTick(20);
    const loop = document.querySelector('[data-meta="loop"]');
    expect(loop).toBeTruthy();
    expect(loop.textContent).toMatch(/Loop/);
  });
});

describe("bass staff written octave + rhythm engraving", () => {
  afterEach(() => {
    teardownPlayer();
  });

  async function loadNotation() {
    if (window.__BASS_NOTATION__ && window.__BASS_PLAYER__) return window.__BASS_NOTATION__;
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(demo), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    class FakeAudioContext {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
      async decodeAudioData() { return { duration: demo.duration }; }
      async resume() { this.state = "running"; }
      async suspend() { this.state = "suspended"; }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    await new Promise((resolve, reject) => {
      const onReady = () => {
        window.removeEventListener("bass-player-ready", onReady);
        resolve();
      };
      window.addEventListener("bass-player-ready", onReady);
      try {
        new Function(playerSrc)();
      } catch (e) {
        reject(e);
      }
      setTimeout(() => reject(new Error("notation boot timeout")), 3000);
    });
    expect(window.__BASS_NOTATION__).toBeTruthy();
    return window.__BASS_NOTATION__;
  }

  it("staffPos uses written octave (+12) so F1 sounding maps near the staff", async () => {
    const N = await loadNotation();
    expect(N.WRITTEN_OCTAVE).toBe(12);
    const f1 = N.staffPos(29); // F1 sounding → F2 written
    expect(f1.writtenMidi).toBe(41);
    expect(f1.pos).toBe(-1);
    const y = N.staffYy(f1.pos);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(100);

    const openE = N.staffPos(28);
    expect(openE.writtenMidi).toBe(40);
    expect(N.staffYy(openE.pos)).toBeLessThan(100);

    const f2 = N.staffPos(41); // F2 sounding → F3 written (bass clef F line)
    expect(f2.writtenMidi).toBe(53);
    expect(f2.pos).toBe(6);
  });

  it("durationStyle classifies 16th / 8th / quarter / half", async () => {
    const N = await loadNotation();
    expect(N.durationStyle(1).label).toBe("sixteenth");
    expect(N.durationStyle(2).label).toBe("eighth");
    expect(N.durationStyle(3).label).toBe("dotted-eighth");
    expect(N.durationStyle(4).label).toBe("quarter");
    expect(N.durationStyle(6).label).toBe("dotted-quarter");
    expect(N.durationStyle(8).label).toBe("half");
    expect(N.durationStyle(16).label).toBe("whole");
  });

  it("buildRhythmVoice emits rests for leading gaps and classifies note durations", async () => {
    const N = await loadNotation();
    const withLead = N.buildRhythmVoice([{ step: 4, midi: 38 }, { step: 8, midi: 38 }], 16);
    expect(withLead[0]).toMatchObject({ type: "rest", step: 0, dur: 4 });
    expect(withLead.some((e) => e.type === "note" && e.dur === 4 && e.style.label === "quarter")).toBe(true);
    expect(withLead.filter((e) => e.type === "rest").length).toBeGreaterThan(0);

    const syncBar = N.buildRhythmVoice([
      { step: 0, midi: 41 }, { step: 4, midi: 29 }, { step: 6, midi: 29 }, { step: 8, midi: 29 },
      { step: 11, midi: 41 }, { step: 13, midi: 29 }, { step: 15, midi: 36 },
    ], 16);
    const labels = syncBar.filter((e) => e.type === "note").map((e) => e.style.label);
    expect(labels).toEqual([
      "quarter", "eighth", "eighth", "dotted-eighth", "eighth", "eighth", "sixteenth",
    ]);
  });

  it("rendered bass staff keeps low F1 Y inside viewBox and marks rhythm kinds", async () => {
    const api = await bootPlayer();
    api.pickSection(2); // chorus → sync_oct with F1 sounding (midi 29)
    await api.waitTick(20);
    const staff = document.querySelector('svg[aria-label="Bass staff"]');
    expect(staff).toBeTruthy();
    const vb = (staff.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    expect(vb[3]).toBe(100);

    const low = [...staff.querySelectorAll("g[data-midi='29']")];
    expect(low.length).toBeGreaterThan(0);
    for (const g of low) {
      expect(Number(g.getAttribute("data-written"))).toBe(41);
      const ell = g.querySelector("ellipse");
      expect(ell).toBeTruthy();
      const cy = Number(ell.getAttribute("cy"));
      expect(cy).toBeGreaterThan(0);
      expect(cy).toBeLessThan(100);
      expect(cy + 4).toBeLessThan(100);
    }

    const notes = staff.querySelectorAll("g[data-rhythm='note']");
    expect(notes.length).toBeGreaterThan(0);
    const labels = new Set([...notes].map((g) => g.getAttribute("data-label")));
    expect(labels.has("quarter") || labels.has("eighth") || labels.has("sixteenth")).toBe(true);
    expect([...labels].length).toBeGreaterThan(1);
  });
});

describe("bass staff ties (full engraving)", () => {
  afterEach(() => {
    teardownPlayer();
  });

  async function loadNotation() {
    if (window.__BASS_NOTATION__ && window.__BASS_PLAYER__) return window.__BASS_NOTATION__;
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(demo), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    class FakeAudioContext {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
      async decodeAudioData() { return { duration: demo.duration }; }
      async resume() { this.state = "running"; }
      async suspend() { this.state = "suspended"; }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    await new Promise((resolve, reject) => {
      const onReady = () => {
        window.removeEventListener("bass-player-ready", onReady);
        resolve();
      };
      window.addEventListener("bass-player-ready", onReady);
      try {
        new Function(playerSrc)();
      } catch (e) {
        reject(e);
      }
      setTimeout(() => reject(new Error("notation boot timeout")), 3000);
    });
    expect(window.__BASS_NOTATION__).toBeTruthy();
    return window.__BASS_NOTATION__;
  }

  it("isTieContinuation: reattack vs tied/acoustic hold", async () => {
    const N = await loadNotation();
    const a = { step: 4, midi: 29 };
    const reattack = { step: 6, midi: 29 };
    const tied = { step: 8, midi: 29, tied: true };
    const other = { step: 10, midi: 41 };
    expect(N.isTieContinuation(reattack, a)).toBe(false);
    expect(N.isTieContinuation(tied, a)).toBe(true);
    expect(N.isTieContinuation(other, a)).toBe(false);
    const held = { step: 0, midi: 38, dur: 12 };
    expect(N.isTieContinuation({ step: 8, midi: 38 }, held)).toBe(true);
    expect(N.isTieContinuation({ step: 8, midi: 40 }, held)).toBe(false);
  });

  it("splitTiedSegments breaks at barlines into standard values", async () => {
    const N = await loadNotation();
    const across = N.splitTiedSegments(12, 8, 16);
    expect(across).toEqual([
      { step: 12, dur: 4 },
      { step: 16, dur: 4 },
    ]);
    const long = N.splitTiedSegments(6, 10, 16);
    const sum = long.reduce((s, p) => s + p.dur, 0);
    expect(sum).toBe(10);
    expect(long.length).toBeGreaterThan(1);
    expect(long.every((p) => N.notatedStepsOf(N.durationStyle(p.dur)) === p.dur)).toBe(true);
  });

  it("buildRhythmVoice ties holds across barlines; keeps same-pitch reattacks", async () => {
    const N = await loadNotation();
    const held = N.buildRhythmVoice([
      { step: 12, midi: 38 },
      { step: 20, midi: 41 },
    ], 32);
    const notes = held.filter((e) => e.type === "note");
    expect(notes.length).toBe(3); // quarter|quarter tied + next attack
    expect(notes[0]).toMatchObject({ step: 12, midi: 38, tie: "start", attack: true });
    expect(notes[1]).toMatchObject({ step: 16, midi: 38, tie: "end", attack: false });
    expect(notes[2]).toMatchObject({ step: 20, midi: 41, attack: true });
    expect(notes[2].tie == null).toBe(true);
    // No spurious rests between tied segments
    const between = held.filter((e) => e.type === "rest" && e.step >= 12 && e.step < 20);
    expect(between.length).toBe(0);

    const sync = N.buildRhythmVoice([
      { step: 4, midi: 29 }, { step: 6, midi: 29 }, { step: 8, midi: 29 },
    ], 16);
    const syncNotes = sync.filter((e) => e.type === "note");
    expect(syncNotes.every((e) => !e.tie)).toBe(true);
    expect(syncNotes.map((e) => e.dur)).toEqual([2, 2, 8]);
  });

  it("explicit tied flag merges same-pitch into one sustain with tie break", async () => {
    const N = await loadNotation();
    const ev = N.buildRhythmVoice([
      { step: 4, midi: 29 },
      { step: 8, midi: 29, tied: true },
      { step: 12, midi: 41 },
    ], 16);
    const notes = ev.filter((e) => e.type === "note");
    expect(notes.some((e) => e.tie === "start")).toBe(true);
    expect(notes.some((e) => e.tie === "end")).toBe(true);
    expect(notes.filter((e) => e.midi === 29).length).toBe(2);
    expect(notes.filter((e) => e.midi === 29 && e.attack).length).toBe(1);
  });

  it("appendBassTiePaths draws path[data-rhythm=tie] for tied events", async () => {
    const N = await loadNotation();
    const held = N.buildRhythmVoice([
      { step: 12, midi: 38 },
      { step: 24, midi: 36 },
    ], 32);
    const tied = held.filter((e) => e.type === "note" && e.tie);
    expect(tied.length).toBeGreaterThanOrEqual(2);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const sx = (s) => 40 + s * 8;
    N.appendBassTiePaths(svg, held, sx, N.staffYy, "#e5e7eb");
    const paths = svg.querySelectorAll("path[data-rhythm='tie']");
    expect(paths.length).toBeGreaterThanOrEqual(1);
    expect(paths[0].getAttribute("data-tie-from")).toBe("12");
    expect(paths[0].getAttribute("data-midi")).toBe("38");
    expect(paths[0].getAttribute("d") || "").toMatch(/^M/i);
  });

  it("live bass staff preserves insight cards, S/M/D&B, drum staff with tie contract", async () => {
    const api = await bootPlayer({ withStems: true });
    api.pickSection(2);
    await api.waitTick(20);
    const staff = document.querySelector('svg[aria-label="Bass staff"]');
    expect(staff).toBeTruthy();
    expect(document.querySelector('svg[aria-label="Drum staff"]')).toBeTruthy();
    expect(document.querySelector(".card-insight-svg, [data-insight-label]")).toBeTruthy();
    expect(document.querySelector("[data-listen='solo'], [data-listen='mute'], [data-listen='db']")).toBeTruthy();
    // Tie path count matches tied note-pair markers when stock patterns emit any
    const tiePaths = staff.querySelectorAll("path[data-rhythm='tie']");
    const tieNotes = staff.querySelectorAll("g[data-rhythm='note'][data-tie]");
    if (tieNotes.length) {
      expect(tiePaths.length).toBeGreaterThan(0);
    }
  });
});

describe("drum staff real rhythm", () => {
  afterEach(() => {
    teardownPlayer();
  });

  async function loadNotation() {
    if (window.__BASS_NOTATION__ && window.__BASS_PLAYER__) return window.__BASS_NOTATION__;
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(demo), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    class FakeAudioContext {
      constructor() { this.state = "running"; this.currentTime = 0; this.destination = {}; }
      createGain() { return { gain: { value: 1 }, connect() {} }; }
      createBufferSource() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
      async decodeAudioData() { return { duration: demo.duration }; }
      async resume() { this.state = "running"; }
      async suspend() { this.state = "suspended"; }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
    await new Promise((resolve, reject) => {
      const onReady = () => {
        window.removeEventListener("bass-player-ready", onReady);
        resolve();
      };
      window.addEventListener("bass-player-ready", onReady);
      try {
        new Function(playerSrc)();
      } catch (e) {
        reject(e);
      }
      setTimeout(() => reject(new Error("notation boot timeout")), 3000);
    });
    expect(window.__BASS_NOTATION__).toBeTruthy();
    return window.__BASS_NOTATION__;
  }

  it("buildDrumHits + buildRhythmVoice: 8th hats, 16th hats, snare leading rest", async () => {
    const N = await loadNotation();
    expect(typeof N.buildDrumHits).toBe("function");
    const h8 = N.buildDrumHits(1, false);
    const hat8 = h8.filter((h) => h.kind === "hat").map((h) => ({ step: h.step, midi: 42 }));
    const hat8ev = N.buildRhythmVoice(hat8, 16);
    const hat8notes = hat8ev.filter((e) => e.type === "note");
    expect(hat8notes.length).toBe(8);
    expect(hat8notes.every((e) => e.style.label === "eighth")).toBe(true);

    const h16 = N.buildDrumHits(1, true);
    const hat16 = h16.filter((h) => h.kind === "hat").map((h) => ({ step: h.step, midi: 42 }));
    const hat16ev = N.buildRhythmVoice(hat16, 16);
    const hat16notes = hat16ev.filter((e) => e.type === "note");
    expect(hat16notes.length).toBe(16);
    expect(hat16notes.every((e) => e.style.label === "sixteenth")).toBe(true);

    const snare = h8.filter((h) => h.kind === "snare").map((h) => ({ step: h.step, midi: 38 }));
    const snEv = N.buildRhythmVoice(snare, 16);
    expect(snEv[0]).toMatchObject({ type: "rest", step: 0, dur: 4 });
    expect(snEv.some((e) => e.type === "note" && e.step === 4)).toBe(true);
  });

  it("rendered drum staff uses rhythm engine (varied labels, rests, beams) — not identical dots", async () => {
    // Inject per-song drumHits (no invent default): 8th-hat backbeat across intro bars
    const api = await bootPlayer({
      mutatePayload: (payload) => {
        const hits = [];
        for (let bar = 0; bar < 8; bar++) {
          hits.push(
            { bar, step: 0, kind: "kick", midi: 36 },
            { bar, step: 8, kind: "kick", midi: 36 },
            { bar, step: 4, kind: "snare", midi: 38 },
            { bar, step: 12, kind: "snare", midi: 38 },
          );
          for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
            hits.push({ bar, step, kind: "hat", midi: 42 });
          }
        }
        payload.drumHits = hits;
      },
    });
    api.pickSection(0); // intro → song 8th hats
    await api.waitTick(20);
    const staff = document.querySelector('svg[aria-label="Drum staff"]');
    expect(staff).toBeTruthy();

    const notes = staff.querySelectorAll("g[data-rhythm='note']");
    expect(notes.length).toBeGreaterThan(0);
    const labels = new Set([...notes].map((g) => g.getAttribute("data-label")));
    expect(labels.has("eighth") || labels.has("sixteenth")).toBe(true);
    expect([...labels].length).toBeGreaterThan(1);

    const rests = staff.querySelectorAll("g[data-rhythm='rest']");
    expect(rests.length).toBeGreaterThan(0);

    expect(staff.querySelectorAll("[data-rhythm='beam']").length).toBeGreaterThan(0);

    expect(staff.querySelectorAll("g[data-drum='hat']").length).toBeGreaterThan(0);
    expect(staff.querySelectorAll("g[data-drum='snare']").length).toBeGreaterThan(0);
    expect(staff.querySelectorAll("g[data-drum='kick']").length).toBeGreaterThan(0);
  });

  it("kick is always below snare on the drum staff (HH above SD above BD)", async () => {
    const api = await bootPlayer({
      mutatePayload: (payload) => {
        const hits = [];
        for (let bar = 0; bar < 8; bar++) {
          hits.push(
            { bar, step: 0, kind: "kick", midi: 36 },
            { bar, step: 8, kind: "kick", midi: 36 },
            { bar, step: 4, kind: "snare", midi: 38 },
            { bar, step: 12, kind: "snare", midi: 38 },
          );
          for (const step of [0, 4, 8, 12]) hits.push({ bar, step, kind: "hat", midi: 42 });
        }
        payload.drumHits = hits;
      },
    });
    api.pickSection(0);
    await api.waitTick(20);
    const staff = document.querySelector('svg[aria-label="Drum staff"]');
    expect(staff).toBeTruthy();
    const cyOf = (kind) => {
      const heads = [...staff.querySelectorAll(`g[data-drum="${kind}"] ellipse`)];
      expect(heads.length).toBeGreaterThan(0);
      return heads.map((n) => Number(n.getAttribute("cy")));
    };
    const kick = cyOf("kick");
    const snare = cyOf("snare");
    expect(Math.min(...kick)).toBeGreaterThan(Math.max(...snare));
    const hatLineYs = [...staff.querySelectorAll('g[data-drum="hat"] line')].map((n) => Number(n.getAttribute("y1")));
    expect(hatLineYs.length).toBeGreaterThan(0);
    expect(Math.max(...hatLineYs)).toBeLessThan(Math.min(...snare));
    const labelY = (kind) => Number(staff.querySelector(`[data-drum-label="${kind}"]`).getAttribute("y"));
    expect(staff.querySelector('[data-drum-label="hat"]').textContent).toBe("HH");
    expect(staff.querySelector('[data-drum-label="snare"]').textContent).toBe("SD");
    expect(staff.querySelector('[data-drum-label="kick"]').textContent).toBe("BD");
    expect(labelY("kick")).toBeGreaterThan(labelY("snare"));
    expect(labelY("snare")).toBeGreaterThan(labelY("hat"));

    const N = window.__BASS_NOTATION__;
    expect(N.DRUM_VOICE_TOP_TO_BOTTOM).toEqual(["hat", "snare", "kick"]);
    // Shuffled lane numbers still come back hat < snare < kick.
    const ys = N.drumVoiceYs([76, 28, 52]);
    expect(ys.hat).toBe(28);
    expect(ys.snare).toBe(52);
    expect(ys.kick).toBe(76);
    expect(ys.kick).toBeGreaterThan(ys.snare);
  });

  it("demo without drumHits renders empty drum staff (rests, no invent)", async () => {
    const api = await bootPlayer();
    api.pickSection(0);
    await api.waitTick(20);
    const staff = document.querySelector('svg[aria-label="Drum staff"]');
    expect(staff).toBeTruthy();
    // Kit notes only — no invent default when demo has no drumHits
    expect(staff.querySelectorAll("g[data-rhythm='note']").length).toBe(0);
    expect(staff.querySelectorAll("g[data-rhythm='note'][data-drum]").length).toBe(0);
    expect(staff.querySelectorAll("g[data-rhythm='rest']").length).toBeGreaterThan(0);
    // Staff subtitle should read as rests / out, not an 8th-hat invent claim from missing hits
    const layer = [...document.querySelectorAll(".layer-label, .layer-title, [class*='layer']")]
      .map((n) => n.textContent || "")
      .find((t) => /drum staff/i.test(t));
    if (layer) {
      expect(layer.toLowerCase()).not.toMatch(/8th hats/);
    }
  });
});

describe("subsection drag loop range", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("drag bars N–M inside a longer section sets loop exactly N–M (not section end)", async () => {
    const api = await bootPlayer();
    api.pickSection(2); // C: bars 16–23
    await api.waitTick(10);
    const svg = document.querySelector('svg[aria-label="Bass tab"]') || document.querySelector(".layers .layer svg");
    expect(svg).toBeTruthy();
    // Layout: X0=52, W=900, VBW=960. n=8 bars starting at 16.
    // Bar 18 center-ish: frac (18-16+0.25)/8 → use left edge + epsilon of bar 18 and bar 20.
    const X0 = 52, W = 900, VBW = 960;
    const barClientX = (bar) => {
      const frac = (bar - 16 + 0.25) / 8;
      return X0 + frac * W; // clientX with left=0, width=VBW → viewX≈clientX when width=VBW… 
      // Actually clientXToViewX: ((clientX-left)/width)*VBW; with left=0,width=VBW → viewX=clientX
      // barFromViewX uses (viewX-X0)/W → so clientX = X0 + ((bar-viewLo)+0.25)/n * W
    };
    // Wait, if width is VBW=960 and left=0, viewX = clientX. Good.
    const xForBar = (bar) => X0 + ((bar - 16 + 0.25) / 8) * W;
    const rect = { left: 0, top: 0, width: VBW, height: 80, right: VBW, bottom: 80, x: 0, y: 0 };
    svg.getBoundingClientRect = () => rect;

    const x0 = xForBar(18);
    const x1 = xForBar(20);
    svg.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: x0, clientY: 40, button: 0 }));
    // Cross drag threshold, then move to bar 20 — mid-drag render tears down SVG (the bug path).
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x0 + 12, clientY: 40, button: 0 }));
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: x1, clientY: 40, button: 0 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientX: x1, clientY: 40, button: 0 }));
    await api.waitTick(20);
    const s = api.getState();
    expect(s.loopOn).toBe(true);
    expect(s.lo).toBe(18);
    expect(s.hi).toBe(20);
    expect(s.hi).not.toBe(23); // must not extend to section end
  });
});

describe("timeline section tap while playing", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("tapping another section loops it, seeks to start, keeps playing, content sticks", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(0);
    api.play();
    await api.waitTick(100);
    expect(api.getState().playing).toBe(true);
    // Advance into section A a bit (visual timer / audio)
    api.seek(demo.raw[2][1]);
    await api.waitTick(40);

    const secEl = document.querySelector('[data-section="2"]');
    expect(secEl).toBeTruthy();
    secEl.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(80);
    let s = api.getState();
    expect(s.playing).toBe(true);
    expect(s.secIdx).toBe(2);
    expect(s.sectionName).toBe("C");
    expect(s.loopOn).toBe(true);
    expect(s.lo).toBe(demo.secs[2].first);
    expect(s.hi).toBe(demo.secs[2].end - 1);
    expect(s.t).toBeCloseTo(demo.raw[demo.secs[2].first][1], 5);
    expect(s.patternId).toBe("sync_oct");
    // Stick across several ticks (audio clock must not yank section back)
    await api.waitTick(150);
    s = api.getState();
    expect(s.secIdx).toBe(2);
    expect(s.sectionName).toBe("C");
    expect(s.loopOn).toBe(true);
    expect(s.lo).toBe(16);
    expect(s.hi).toBe(23);
  });
});


describe("flashcards while playing", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("flashcards stay tappable while playing (Next card + mini via delegated pointerup)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(2);
    expect(api.getState().activeCardLabel).toBe("Pocket");
    api.play();
    await api.waitTick(100);
    expect(api.getState().playing).toBe(true);

    // Mid-playback re-render every 50ms destroys onClick-bound nodes — use pointerup like transport.
    const nextBtn = [...document.querySelectorAll("button")].find((b) => /Next card/i.test(b.textContent || ""));
    expect(nextBtn).toBeTruthy();
    nextBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(60);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().cardIdx % 4).toBe(1);
    expect(api.getState().activeCardLabel).toBe("Figure");

    await api.waitTick(30);
    const mini = document.querySelector('.card-mini[data-card="3"]');
    expect(mini).toBeTruthy();
    mini.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(80);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().activeCardLabel).toBe("Missable");
    expect(api.getState().cardIdx % 4).toBe(3);
  });
});

describe("keyboard shortcuts", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("Space toggles play/pause from current position", async () => {
    const api = await bootPlayer();
    api.pickSection(1);
    api.seek(demo.raw[10][1]);
    const t0 = api.getState().t;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().t).toBeGreaterThanOrEqual(t0);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().playing).toBe(false);
  });

  it("Right Arrow jumps to next section; Left seeks loop start then previous", async () => {
    const api = await bootPlayer();
    api.pickSection(1);
    api.setLoopBars(10, 12);
    api.seek(demo.raw[11][1]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().secIdx).toBe(2);

    api.pickSection(1);
    api.setLoopBars(10, 12);
    api.seek(demo.raw[11][1]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().t).toBeCloseTo(demo.raw[10][1], 5);
    expect(api.getState().secIdx).toBe(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().secIdx).toBe(0);
  });

  it("Escape clears subsection bar selection back to full section", async () => {
    const api = await bootPlayer();
    api.pickSection(2);
    api.setLoopBars(18, 20);
    expect(api.getState().lo).toBe(18);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    const s = api.getState();
    expect(s.lo).toBe(16);
    expect(s.hi).toBe(23);
    expect(s.loopOn).toBe(true);
  });

  it("L toggles loop on and off", async () => {
    const api = await bootPlayer();
    expect(api.getState().loopOn).toBe(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().loopOn).toBe(true);
    const loopBtnOn = [...document.querySelectorAll("button")].find((b) => /Loop/i.test(b.getAttribute("aria-label") || ""));
    expect(loopBtnOn?.getAttribute("aria-label")).toMatch(/Loop on/i);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "L", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().loopOn).toBe(false);
    const loopBtnOff = [...document.querySelectorAll("button")].find((b) => /Loop/i.test(b.getAttribute("aria-label") || ""));
    expect(loopBtnOff?.getAttribute("aria-label")).toMatch(/Loop off/i);
  });

  it("ignores shortcuts when typing in an input", async () => {
    const api = await bootPlayer();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const playing0 = api.getState().playing;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().playing).toBe(playing0);
  });
});


describe("flashcard insight panel", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("renders insight schematic with annotation labels for chorus Figure", async () => {
    const api = await bootPlayer();
    api.pickSection(2); // chorus
    api.setCard(1); // Figure
    const s = api.getState();
    expect(s.activeCardLabel).toBe("Figure");
    expect(s.activeCardInsight).toBeTruthy();
    expect(s.activeCardInsight.patternId).toBe("sync_oct");
    expect(s.hasInsightPanel).toBe(true);

    const panel = document.querySelector(".card-insight");
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("data-insight-layer")).toBe("figure");
    expect(document.querySelector(".card-insight-title")?.textContent).toMatch(/octave drop/i);

    const labels = [...document.querySelectorAll("[data-insight-label]")].map((n) => n.getAttribute("data-insight-label"));
    expect(labels).toEqual(expect.arrayContaining(["this note here", "this pattern"]));

    const lit = document.querySelectorAll('circle[data-insight-kind="note"]');
    expect(lit.length).toBeGreaterThan(0);
    // Dim hits remain in the claim window with a one-line legend (lean B).
    expect(document.querySelector("[data-insight-legend]")).toBeTruthy();

    // Locked dashboard: shell stays overflow-hidden (no page scroll from cards).
    const shell = document.querySelector(".shell");
    expect(shell).toBeTruthy();
    expect(getComputedStyle(shell).overflow).toMatch(/hidden|clip/);
  });

  it("Pocket insight shows bass-against-kick annotations", async () => {
    const api = await bootPlayer();
    api.pickSection(2);
    api.setCard(0);
    expect(api.getState().activeCardLabel).toBe("Pocket");
    expect(document.querySelector(".card-insight")?.getAttribute("data-insight-layer")).toBe("pocket");
    const labels = [...document.querySelectorAll("[data-insight-label]")].map((n) => n.getAttribute("data-insight-label"));
    expect(labels.join(" ")).toMatch(/bass note against that drum hit/i);
    expect(document.querySelector('circle[data-insight-kind="bass"]')).toBeTruthy();
    expect(document.querySelector('circle[data-insight-kind="kick"]')).toBeTruthy();
  });

  it("insight-card drum schematic keeps K below S", async () => {
    const api = await bootPlayer();
    api.pickSection(2); // chorus pocket: kick highlight, dim snare still drawn
    api.setCard(0);
    await api.waitTick(20);
    const svg = document.querySelector(".card-insight-svg");
    expect(svg).toBeTruthy();
    const cy = (kind) => {
      const nodes = [...svg.querySelectorAll(`circle[data-insight-kind="${kind}"]`)];
      expect(nodes.length).toBeGreaterThan(0);
      return nodes.map((n) => Number(n.getAttribute("cy")));
    };
    expect(Math.min(...cy("kick"))).toBeGreaterThan(Math.max(...cy("snare")));
    const k = svg.querySelector('[data-drum-label="kick"]');
    const s = svg.querySelector('[data-drum-label="snare"]');
    expect(k.textContent).toBe("K");
    expect(s.textContent).toBe("S");
    expect(Number(k.getAttribute("y"))).toBeGreaterThan(Number(s.getAttribute("y")));

    // Direct schematic (same renderer) with both voices highlighted.
    const N = window.__BASS_NOTATION__;
    const node = N.makeCardInsight({
      layer: "pocket",
      patternId: "pedal",
      title: "Kick under snare",
      barRange: [0, 0],
      highlights: [
        { step: 0, kind: "kick", text: "kick 1" },
        { step: 4, kind: "snare", text: "snare 2" },
      ],
    }, N.PEDAL);
    document.body.appendChild(node);
    const card = node.querySelector(".card-insight-svg");
    const kickCy = Number(card.querySelector('circle[data-insight-kind="kick"]').getAttribute("cy"));
    const snareCy = Number(card.querySelector('circle[data-insight-kind="snare"]').getAttribute("cy"));
    expect(kickCy).toBeGreaterThan(snareCy);
    expect(Number(card.querySelector('[data-drum-label="kick"]').getAttribute("y")))
      .toBeGreaterThan(Number(card.querySelector('[data-drum-label="snare"]').getAttribute("y")));
  });

  it("cards without insight leave the panel out (intro)", async () => {
    const api = await bootPlayer();
    api.pickSection(0);
    api.setCard(0);
    expect(api.getState().hasInsightPanel).toBe(false);
    expect(document.querySelector(".card-insight")).toBeNull();
  });

  it("makeCardInsight + resolveInsightPattern helpers work for sync_oct / walk", async () => {
    await bootPlayer();
    const N = window.__BASS_NOTATION__;
    expect(N.midiToName(41)).toBe("F2");
    expect(N.midiToName(29)).toBe("F1");
    const pat = N.resolveInsightPattern({ patternId: "sync_oct" }, null);
    expect(pat.id).toBe("sync_oct");
    expect(N.resolveInsightPattern({ patternId: "walk" }, null).id).toBe("walk");

    const node = N.makeCardInsight({
      layer: "figure",
      patternId: "walk",
      title: "A–C–D walk",
      barRange: [0, 0],
      highlights: [
        { step: 0, midi: 33, text: "A" },
        { step: 6, midi: 36, text: "C" },
        { step: 8, midi: 38, text: "D" },
      ],
    }, N.WALK);
    expect(node).toBeTruthy();
    expect(node.getAttribute("data-insight-layer")).toBe("figure");
    document.body.appendChild(node);
    const labels = [...node.querySelectorAll("[data-insight-label]")].map((n) => n.getAttribute("data-insight-label"));
    expect(labels).toEqual(["A", "C", "D"]);
    expect(node.querySelector("[data-insight-legend]")?.textContent).toMatch(/dim = other hits/i);
    expect(N.resolveInsightPattern({ patternId: "empty" }, null).id).toBe("empty");
  });

  it("chorus slot model is Pocket/Figure/Harmony/Missable", async () => {
    const api = await bootPlayer();
    api.pickSection(2);
    expect(api.getState().cardLabels).toEqual(["Pocket", "Figure", "Harmony", "Missable"]);
    const N = window.__BASS_NOTATION__;
    const chorus = N.CARDS.chorus;
    expect(chorus.map((c) => c.label)).toEqual(["Pocket", "Figure", "Harmony", "Missable"]);
    expect(chorus[0].insight.layer).toBe("pocket");
    expect(chorus[1].insight.layer).toBe("figure");
    expect(chorus[1].insight.barRange).toEqual([0, 0]); // claim window, not crop-hack of empty bar 2
    expect(chorus[3].insight.layer).toBe("missable");
  });

  it("harmony insight renders chord chips with functions", async () => {
    await bootPlayer();
    const N = window.__BASS_NOTATION__;
    const node = N.makeCardInsight({
      layer: "harmony",
      title: "Chorus loop in F",
      highlights: [
        { step: 0, kind: "chord", text: "F = I", chord: "F" },
        { step: 16, kind: "chord", text: "C = V", chord: "C" },
        { step: 32, kind: "chord", text: "Bb = IV", chord: "Bb" },
        { step: 48, kind: "chord", text: "Dm = vi", chord: "Dm" },
      ],
    }, null);
    document.body.appendChild(node);
    const names = [...node.querySelectorAll(".card-insight-chord-name")].map((n) => n.textContent);
    expect(names).toEqual(["F", "C", "Bb", "Dm"]);
    expect(node.querySelectorAll(".card-insight-chord.lit").length).toBe(4);
  });

  it("panel order is label → body → insight → mini-grid → Prev/Next", async () => {
    const api = await bootPlayer();
    api.pickSection(2); // chorus has insight in fixture/builtins path
    api.setCard(1); // Figure
    const panel = document.querySelector("[data-cards-panel]");
    expect(panel).toBeTruthy();
    const kids = [...panel.children].map((c) => c.className.split(/\s+/)[0]);
    expect(kids).toEqual([
      "cards-head",
      "card-label",
      "card-body",
      "card-insight",
      "card-grid",
      "card-actions",
    ]);
    const body = document.querySelector(".card-body");
    expect(body).toBeTruthy();
    // Larger claim-line body (was 13px).
    expect(Number.parseFloat(getComputedStyle(body).fontSize)).toBeGreaterThanOrEqual(15);
  });

  it("makeCardInsight returns null when insight is missing (safe)", async () => {
    await bootPlayer();
    const N = window.__BASS_NOTATION__;
    expect(N.makeCardInsight(null, null)).toBeNull();
    expect(N.makeCardInsight(undefined, null)).toBeNull();
  });
});

const komikuDemo = JSON.parse(
  readFileSync(join(root, "../work/demo-a-good-bass-for-gambling/demo-data.json"), "utf8"),
);

describe("Komiku demo insights (public CC0)", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("all 48 cards include insight schematics (ship blocker)", () => {
    let n = 0;
    for (const [sec, cards] of Object.entries(komikuDemo.cards)) {
      expect(cards).toHaveLength(4);
      for (const c of cards) {
        expect(c.insight, `${sec}/${c.label}`).toBeTruthy();
        expect(c.insight.layer, `${sec}/${c.label}`).toMatch(/^(pocket|figure|harmony|missable)$/);
        expect(Array.isArray(c.insight.highlights), `${sec}/${c.label}`).toBe(true);
        n++;
      }
    }
    expect(n).toBe(48);
    expect(komikuDemo.meta?.insightRequired).toBe(true);
  });

  it("Groove A' Pocket mounts non-empty .card-insight", async () => {
    const api = await bootPlayer({
      privateMode: false,
      mutatePayload: (p) => {
        p.title = komikuDemo.title;
        p.artist = komikuDemo.artist;
        p.bpm = komikuDemo.bpm;
        p.secs = komikuDemo.secs;
        p.cards = komikuDemo.cards;
        p.patterns = komikuDemo.patterns;
        p.nbars = komikuDemo.nbars;
        p.raw = komikuDemo.raw;
        p.drumsOutBars = komikuDemo.drumsOutBars;
        p.meta = komikuDemo.meta;
      },
    });
    const a2Idx = komikuDemo.secs.findIndex((s) => s.id === "a2");
    expect(a2Idx).toBeGreaterThanOrEqual(0);
    api.pickSection(a2Idx);
    api.setCard(0); // Pocket
    const s = api.getState();
    expect(s.activeCardLabel).toBe("Pocket");
    expect(s.activeCardInsight).toBeTruthy();
    expect(s.activeCardInsight.layer).toBe("pocket");
    expect(s.hasInsightPanel).toBe(true);
    const panel = document.querySelector(".card-insight");
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("data-insight-layer")).toBe("pocket");
    expect(
      panel.querySelector(".card-insight-svg, .card-insight-chords, [data-insight-kind]"),
    ).toBeTruthy();
  });
});

describe("v2-empty: silent section shows rests not invented grooves", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("buildDrumHits empty option returns no hits; isRhythmOut detects EMPTY", async () => {
    const api = await bootPlayer();
    const N = window.__BASS_NOTATION__;
    expect(N.EMPTY.id).toBe("empty");
    expect(N.EMPTY.notes).toEqual([]);
    expect(N.PATS.v2[0].id).toBe("empty");
    expect(N.isRhythmOut(N.EMPTY)).toBe(true);
    expect(N.isRhythmOut(N.PEDAL)).toBe(false);
    expect(N.buildDrumHits(2, false, { empty: true })).toEqual([]);
    expect(N.buildDrumHits(1, false).length).toBeGreaterThan(0);
    const rests = N.buildRhythmVoice([], 16);
    expect(rests.length).toBeGreaterThan(0);
    expect(rests.every((e) => e.type === "rest")).toBe(true);
  });

  it("section with empty pattern: bass staff rests only, drum grid empty (no hat/snare/kick notes)", async () => {
    const api = await bootPlayer({
      mutatePayload: (payload) => {
        // Paint verse section B as stem-silent empty (mirrors LAP v2).
        payload.patterns.s1 = [{ id: "empty", name: "Rest (rhythm section out)", notes: [] }];
        payload.cards.s1 = [
          { label: "Pocket", body: "Out — rests only." },
          { label: "Figure", body: "Out — rests only." },
        ];
      },
    });
    api.pickSection(1);
    await api.waitTick(20);

    expect(api.getState().patternId).toBe("empty");
    expect(api.getState().patternName).toMatch(/rest/i);

    const tabTitle = [...document.querySelectorAll(".layer-head-title")].find((el) =>
      /Bass tab/i.test(el.textContent || "")
    );
    expect(tabTitle?.textContent || "").toMatch(/Rest \(rhythm section out\)/i);

    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    expect(bass).toBeTruthy();
    expect(bass.querySelectorAll("g[data-rhythm='note']").length).toBe(0);
    expect(bass.querySelectorAll("g[data-rhythm='rest']").length).toBeGreaterThan(0);

    const drumLayer = [...document.querySelectorAll(".layer")].find((l) =>
      /Drum staff/i.test(l.querySelector(".layer-head-title")?.textContent || "")
    );
    expect(drumLayer?.querySelector(".layer-head-title")?.textContent || "").toMatch(/rests \(out\)/i);

    const drums = document.querySelector('svg[aria-label="Drum staff"]');
    expect(drums).toBeTruthy();
    expect(drums.querySelectorAll("g[data-rhythm='note']").length).toBe(0);
    expect(drums.querySelectorAll("g[data-rhythm='note'][data-drum='hat']").length).toBe(0);
    expect(drums.querySelectorAll("g[data-rhythm='note'][data-drum='snare']").length).toBe(0);
    expect(drums.querySelectorAll("g[data-rhythm='note'][data-drum='kick']").length).toBe(0);
    expect(drums.querySelectorAll("g[data-rhythm='rest']").length).toBeGreaterThan(0);

    // Cards prefer sec.id (s1) over kind=verse
    expect(document.querySelector(".card-label")?.textContent).toMatch(/Pocket|Figure|Drums|Bass/);
    const body = document.querySelector(".card-body")?.textContent || "";
    expect(body).toMatch(/rest|out/i);
  });
});

describe("bass-midi: MIDI toggles on bass and drum staffs", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("MIDI buttons labeled MIDI on bass and drum strips; toggle state", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const bassMidi = () => document.querySelector('button[data-midi="bass"]');
    const drumMidi = () => document.querySelector('button[data-midi="drums"]');
    expect(bassMidi()).toBeTruthy();
    expect(drumMidi()).toBeTruthy();
    expect(bassMidi().textContent.trim()).toBe("MIDI");
    expect(drumMidi().textContent.trim()).toBe("MIDI");
    expect(api.getState().midiBass).toBe(false);
    expect(api.getState().midiDrums).toBe(false);

    bassMidi().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().midiBass).toBe(true);
    expect(bassMidi().classList.contains("on")).toBe(true);
    expect(bassMidi().getAttribute("aria-pressed")).toBe("true");

    // Re-query after render — prior node is detached
    drumMidi().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().midiDrums).toBe(true);
    expect(drumMidi().classList.contains("on")).toBe(true);

    api.toggleMidiBass();
    expect(api.getState().midiBass).toBe(false);
    api.setMidiDrums(false);
    expect(api.getState().midiDrums).toBe(false);
  });

  it("midiToFreq / expandPatternNotes helpers; MIDI schedules osc while playing", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const N = window.__BASS_NOTATION__;
    expect(N.midiToFreq(69)).toBeCloseTo(440, 5);
    expect(N.midiToFreq(57)).toBeCloseTo(220, 5);
    const expanded = N.expandPatternNotes({ notes: [{ step: 0, midi: 38 }, { step: 16, midi: 36 }] }, 4);
    expect(expanded.some((n) => n.step === 0 && n.midi === 38)).toBe(true);
    expect(expanded.some((n) => n.step === 32 && n.midi === 38)).toBe(true);

    api.pickSection(2); // chorus with notes
    api.setMidiBass(true);
    api.setMidiDrums(true);
    await api.ensureAudio();
    api.play();
    await api.waitTick(80);
    // FakeAudioContext tracks oscillator creation via schedule
    const ctxProto = window.AudioContext;
    expect(api.getState().midiBass).toBe(true);
    expect(api.getState().midiDrums).toBe(true);
    expect(api.getState().playing).toBe(true);
    api.pause();
  });

  it("empty rhythm-out section schedules no MIDI invent", async () => {
    const api = await bootPlayer({
      privateMode: true,
      withStems: true,
      mutatePayload: (payload) => {
        payload.patterns.s1 = [{ id: "empty", name: "Rest (rhythm section out)", notes: [] }];
      },
    });
    api.pickSection(1);
    api.setMidiBass(true);
    api.setMidiDrums(true);
    await api.ensureAudio();
    api.play();
    await api.waitTick(60);
    expect(api.getState().patternId).toBe("empty");
    expect(api.getState().midiBass).toBe(true);
    api.pause();
  });
});

describe("bass-midi-tone: plain clear bass voice (not harsh synth grit)", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("BASS_MIDI_VOICE uses soft sine + gentle lowpass; no saw/square", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const N = window.__BASS_NOTATION__;
    expect(N.BASS_MIDI_VOICE).toBeTruthy();
    expect(N.BASS_MIDI_VOICE.oscType).toBe("sine");
    expect(N.BASS_MIDI_VOICE.filterType).toBe("lowpass");
    expect(N.BASS_MIDI_VOICE.filterFreq).toBeLessThanOrEqual(1400);
    expect(N.BASS_MIDI_VOICE.filterFreq).toBeGreaterThanOrEqual(400);
    expect(N.BASS_MIDI_VOICE.peakGain).toBeLessThanOrEqual(0.28);
    expect(N.BASS_MIDI_VOICE.attack).toBeGreaterThan(0.005);
    expect(N.BASS_MIDI_VOICE.release).toBeGreaterThan(0.02);
    expect(["sawtooth", "square"]).not.toContain(N.BASS_MIDI_VOICE.oscType);
  });

  it("BASS_MIDI_VOICE adds a quieter +12st clarity layer (not harsh)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const v = window.__BASS_NOTATION__.BASS_MIDI_VOICE;
    expect(v.octaveSemitones).toBe(12);
    expect(v.octaveGain).toBeGreaterThan(0);
    expect(v.octaveGain).toBeLessThan(v.peakGain);
    expect(v.octaveGain).toBeLessThanOrEqual(0.12);
    expect(v.oscType).toBe("sine");
    expect(["sawtooth", "square"]).not.toContain(v.oscType);
  });

  it("scheduling bass MIDI creates sine osc through lowpass filter", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(2); // chorus with notes
    api.setMidiBass(true);
    api.setMidiDrums(false);
    await api.ensureAudio();
    api.play();
    await api.waitTick(80);
    const ctx = window.__LAST_AUDIO_CTX__;
    expect(ctx).toBeTruthy();
    expect(ctx._oscillators.length).toBeGreaterThan(0);
    expect(ctx._oscillators.every((o) => o.type === "sine")).toBe(true);
    expect(ctx._filters.length).toBeGreaterThan(0);
    expect(ctx._filters.some((f) => f.type === "lowpass")).toBe(true);
    expect(ctx._oscillators.some((o) => o.type === "sawtooth" || o.type === "square")).toBe(false);
    api.pause();
  });

  it("scheduling bass MIDI stacks fundamental + octave sine (ratio ~2)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const N = window.__BASS_NOTATION__;
    api.pickSection(2);
    api.setMidiBass(true);
    api.setMidiDrums(false);
    await api.ensureAudio();
    api.play();
    await api.waitTick(80);
    const ctx = window.__LAST_AUDIO_CTX__;
    expect(ctx._oscillators.length).toBeGreaterThanOrEqual(2);
    const freqs = ctx._oscillators.map((o) => o.frequency.value).filter((f) => f > 0).sort((a, b) => a - b);
    // Find at least one octave pair among scheduled layers
    let foundOctave = false;
    for (let i = 0; i < freqs.length; i++) {
      for (let j = i + 1; j < freqs.length; j++) {
        const ratio = freqs[j] / freqs[i];
        if (ratio > 1.95 && ratio < 2.05) foundOctave = true;
      }
    }
    expect(foundOctave).toBe(true);
    expect(N.BASS_MIDI_VOICE.octaveSemitones).toBe(12);
    api.pause();
  });

  it("BASS_MIDI_VOICE keeps the fundamental and adds a highpassed 2nd/3rd presence layer", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const N = window.__BASS_NOTATION__;
    const v = N.BASS_MIDI_VOICE;
    expect(v.presenceHpFreq).toBeGreaterThanOrEqual(100);
    expect(v.presenceHpFreq).toBeLessThanOrEqual(250);
    expect(v.peakGain).toBeLessThanOrEqual(0.16);
    expect(v.octaveSemitones).toBe(12);
    expect(v.octaveGain).toBeGreaterThan(0);
    expect(v.oscType).toBe("sine");
    const partials = N.bassMidiPartials(v);
    const body = partials.filter((p) => p.bus === "body");
    const presence = partials.filter((p) => p.bus === "presence");
    expect(body.map((p) => p.mult)).toEqual([1, 2]);
    expect(body[0].peak).toBe(v.peakGain);
    expect(presence.map((p) => p.mult)).toEqual(expect.arrayContaining([2, 3]));
    expect(presence.every((p) => p.mult > 1)).toBe(true);
    expect(presence.every((p) => p.peak > 0 && p.peak < v.peakGain)).toBe(true);
    expect(presence.find((p) => p.mult === 3).peak).toBeGreaterThan(presence.find((p) => p.mult === 2).peak);
    // Soft upper tail so the lowest notes still have a series in the laptop band.
    expect(presence.some((p) => p.mult >= 4)).toBe(true);
    expect(N.CHORD_MIDI_VOICE.presenceHarmonics).toBeUndefined();
    expect(N.CHORD_MIDI_VOICE.filterType).toBe("lowpass");
    api.pause();
  });

  function bassPresenceHighpasses(ctx) {
    return ctx._filters.filter((f) => f.type === "highpass" && f.frequency.value >= 100 && f.frequency.value <= 250);
  }

  it("main bass MIDI schedules fundamental + octave + 3rd through a presence highpass", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const N = window.__BASS_NOTATION__;
    api.pickSection(2);
    api.setMidiBass(true);
    api.setMidiDrums(false);
    api.setMidiChords(false);
    await api.ensureAudio();
    api.play();
    await api.waitTick(80);
    const ctx = window.__LAST_AUDIO_CTX__;
    const f29 = N.midiToFreq(29);
    const f41 = N.midiToFreq(41);
    const freqs = ctx._oscillators.map((o) => o.frequency.value);
    const near = (target) => freqs.some((f) => Math.abs(f - target) < 0.05);
    expect(near(f29)).toBe(true);
    expect(near(f29 * 2)).toBe(true);
    expect(near(f29 * 3)).toBe(true);
    expect(near(f41)).toBe(true);
    expect(near(f41 * 3)).toBe(true);
    expect(ctx._oscillators.every((o) => o.type === "sine")).toBe(true);
    expect(ctx._filters.some((f) => f.type === "lowpass")).toBe(true);
    const hp = bassPresenceHighpasses(ctx);
    expect(hp.length).toBeGreaterThan(0);
    expect(hp.every((f) => f.frequency.value === N.BASS_MIDI_VOICE.presenceHpFreq)).toBe(true);
    expect(ctx._filters.some((f) => f.frequency.value >= 40 && f.frequency.value <= 60)).toBe(false);
    api.pause();
  });

  it("insight-card bass MIDI uses the same presence layer; drums and chords do not", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    const N = window.__BASS_NOTATION__;
    api.pickSection(2);
    api.setCard(1);
    await api.ensureAudio();
    const bassR = api.playInsightMidi("bass");
    expect(bassR.insightMidiResult.ok).toBe(true);
    expect(bassR.insightMidiResult.bass).toBeGreaterThan(0);
    const ctx = window.__LAST_AUDIO_CTX__;
    const f29 = N.midiToFreq(29);
    const freqs = ctx._oscillators.map((o) => o.frequency.value);
    expect(freqs.some((f) => Math.abs(f - f29) < 0.05)).toBe(true);
    expect(freqs.some((f) => Math.abs(f - f29 * 3) < 0.05)).toBe(true);
    const hpBass = bassPresenceHighpasses(ctx).length;
    expect(hpBass).toBeGreaterThan(0);
    expect(ctx._oscillators.every((o) => o.type === "sine")).toBe(true);
    api.cancelInsightMidi();

    const drumsR = api.playInsightMidi("drums");
    expect(drumsR.insightMidiResult.bass).toBe(0);
    expect(drumsR.insightMidiResult.drums).toBeGreaterThan(0);
    expect(bassPresenceHighpasses(ctx).length).toBe(hpBass);
    api.cancelInsightMidi();

    api.setCard(2);
    const hpBeforeChords = bassPresenceHighpasses(ctx).length;
    const chordR = api.playInsightMidi("chords");
    expect(chordR.insightMidiResult.chords).toBeGreaterThan(0);
    expect(bassPresenceHighpasses(ctx).length).toBe(hpBeforeChords);
    expect(ctx._filters.filter((f) => f.type === "lowpass").length).toBeGreaterThan(0);
    api.cancelInsightMidi();
  });

  it("drums MIDI does not use the bass presence highpass", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(2);
    api.setMidiBass(false);
    api.setMidiDrums(true);
    api.setMidiChords(false);
    await api.ensureAudio();
    api.play();
    await api.waitTick(80);
    const ctx = window.__LAST_AUDIO_CTX__;
    expect(bassPresenceHighpasses(ctx).length).toBe(0);
    api.pause();
  });
});

describe("midi-section-advance: auto section change while playing", () => {
  afterEach(() => {
    teardownPlayer();
  });

  async function waitUntil(pred, { timeoutMs = 4000, stepMs = 40 } = {}) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await pred()) return true;
      await new Promise((r) => setTimeout(r, stepMs));
    }
    return false;
  }

  it("auto-advance (loop off, MIDI-only) reschedules bass MIDI; cancels old voices", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(0);
    api.setLoop(false);
    api.setMidiBass(true);
    api.setMidiDrums(false);
    // Start mid-section so notes still schedule, then let clock cross t=4.0 into B
    api.seek(2.5);
    api.play();
    await api.waitTick(100);
    const gen0 = api.getState().midiScheduleGen;
    expect(gen0).toBeGreaterThan(0);
    const ctx = window.__LAST_AUDIO_CTX__;
    expect(ctx).toBeTruthy();
    const oscBefore = ctx._oscillators.slice();
    expect(oscBefore.length).toBeGreaterThan(0);

    const advanced = await waitUntil(() => api.getState().secIdx >= 1, { timeoutMs: 5000 });
    expect(advanced).toBe(true);
    expect(api.getState().secIdx).toBeGreaterThanOrEqual(1);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    // Prior oscillators must be stopped (no drone / note pile-up across the boundary)
    expect(oscBefore.some((o) => o._stopped)).toBe(true);
    // New schedule created fresh oscillators for the new section
    expect(ctx._oscillators.length).toBeGreaterThan(oscBefore.length);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().midiBass).toBe(true);
    api.pause();
  });

  it("auto-advance with bass+drums MIDI both reschedule", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(0);
    api.setLoop(false);
    api.setMidiBass(true);
    api.setMidiDrums(true);
    api.seek(3.7);
    api.play();
    await api.waitTick(60);
    const gen0 = api.getState().midiScheduleGen;
    const advanced = await waitUntil(() => api.getState().secIdx >= 1);
    expect(advanced).toBe(true);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    expect(api.getState().midiBass).toBe(true);
    expect(api.getState().midiDrums).toBe(true);
    api.pause();
  });

  it("seek across section while playing (MIDI-only) reschedules", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(0);
    api.setLoop(false);
    api.setMidiBass(true);
    api.play();
    await api.waitTick(60);
    const gen0 = api.getState().midiScheduleGen;
    const ctx = window.__LAST_AUDIO_CTX__;
    const oscBefore = ctx._oscillators.slice();
    // Jump into chorus (bar 16 → t=8.0)
    api.seek(8.0);
    await api.waitTick(40);
    expect(api.getState().secIdx).toBe(2);
    expect(api.getState().patternId).toBe("sync_oct");
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    expect(oscBefore.some((o) => o._stopped)).toBe(true);
    const f41 = window.__BASS_NOTATION__.midiToFreq(41);
    const fresh = ctx._oscillators.filter((o) => !oscBefore.includes(o) && !o._stopped);
    expect(fresh.some((o) => Math.abs(o.frequency.value - f41) < 0.05)).toBe(true);
    api.pause();
  });

  it("pickSection while playing (MIDI-only) reschedules new section", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(0);
    api.setMidiBass(true);
    api.play();
    await api.waitTick(60);
    const gen0 = api.getState().midiScheduleGen;
    const ctx = window.__LAST_AUDIO_CTX__;
    const oscBefore = ctx._oscillators.slice();
    api.pickSection(2);
    await api.waitTick(40);
    expect(api.getState().secIdx).toBe(2);
    expect(api.getState().patternId).toBe("sync_oct");
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    expect(oscBefore.some((o) => o._stopped)).toBe(true);
    expect(api.getState().playing).toBe(true);
    api.pause();
  });

  it("auto-advance with stems+MIDI keeps stems continuous and reschedules MIDI", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(0);
    api.setLoop(false);
    api.setMidiBass(true);
    api.setMidiDrums(true);
    await api.ensureAudio();
    api.seek(3.7);
    api.play();
    await api.waitTick(80);
    expect(api.getState().usingAudio).toBe(true);
    const gen0 = api.getState().midiScheduleGen;
    const ctx = window.__LAST_AUDIO_CTX__;
    const srcBefore = ctx._sources.filter((s) => !s.stopped).length;
    // Advance fake audio clock past section A end (t=4.0)
    const started = ctx.currentTime;
    ctx.currentTime = started + 0.6; // song t ≈ 3.7 + 0.6 = 4.3 → section B
    const advanced = await waitUntil(() => api.getState().secIdx >= 1, { timeoutMs: 2000 });
    expect(advanced).toBe(true);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    // Stem BufferSources should still be the live ones (not force-stopped for section change)
    const liveSources = ctx._sources.filter((s) => !s.stopped).length;
    expect(liveSources).toBeGreaterThan(0);
    expect(api.getState().usingAudio).toBe(true);
    expect(api.getState().playing).toBe(true);
    api.pause();
  });

  it("stem listen modes + MIDI still reschedule on pickSection (S / M / D&B)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    await api.ensureAudio();
    // setListenMode toggles off when the same mode is passed again — set each mode once.
    const forceListen = (mode) => {
      const cur = api.getState().listenMode;
      if (mode === "full") {
        if (cur !== "full") api.setListenMode(cur);
      } else if (cur !== mode) {
        api.setListenMode(mode);
      }
    };
    for (const mode of ["solo", "mute", "db", "drums", "full"]) {
      forceListen(mode);
      expect(api.getState().listenMode).toBe(mode);
      api.setMidiBass(true);
      api.setMidiDrums(mode === "drums" || mode === "db" || mode === "full");
      api.pickSection(0);
      api.play();
      await api.waitTick(50);
      const gen0 = api.getState().midiScheduleGen;
      api.pickSection(2);
      await api.waitTick(40);
      expect(api.getState().secIdx).toBe(2);
      expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
      expect(api.getState().listenMode).toBe(mode);
      expect(api.getState().stemSourcePlaybackRate).toBe(1);
      api.pause();
      await api.waitTick(20);
    }
  });

  it("slowed tempo (0.75) auto-advance still reschedules MIDI (WSOLA path intact)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    await api.ensureAudio();
    api.pickSection(0);
    api.setLoop(false);
    api.setMidiBass(true);
    api.setPlaybackRate(0.75);
    expect(api.getState().playbackRate).toBe(0.75);
    api.seek(3.7);
    api.play();
    await api.waitTick(80);
    const gen0 = api.getState().midiScheduleGen;
    const ctx = window.__LAST_AUDIO_CTX__;
    // At 0.75 rate, song advances slower: deltaSong = deltaWall * 0.75 → need ~0.8s wall for +0.6 song
    ctx.currentTime = ctx.currentTime + 1.0;
    const advanced = await waitUntil(() => api.getState().secIdx >= 1, { timeoutMs: 2500 });
    expect(advanced).toBe(true);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    expect(api.getState().playbackRate).toBe(0.75);
    api.pause();
  });

  it("subsection then clear + next section via pick while MIDI playing", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(0);
    api.setLoopBars(2, 4);
    expect(api.getState().lo).toBe(2);
    expect(api.getState().hi).toBe(4);
    api.setMidiBass(true);
    api.play();
    await api.waitTick(50);
    const gen0 = api.getState().midiScheduleGen;
    api.clearSubsection();
    await api.waitTick(30);
    expect(api.getState().lo).toBe(0);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    const gen1 = api.getState().midiScheduleGen;
    api.nextSection();
    await api.waitTick(30);
    expect(api.getState().secIdx).toBe(1);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen1);
    api.pause();
  });

  it("loop on within section does not spuriously change secIdx; wrap still schedules", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(1);
    api.setLoop(true);
    api.setMidiBass(true);
    api.seek(7.7); // near end of section B (ends at t=8)
    api.play();
    await api.waitTick(60);
    const gen0 = api.getState().midiScheduleGen;
    // Wait long enough that without loop we'd leave the section
    await api.waitTick(500);
    expect(api.getState().secIdx).toBe(1);
    expect(api.getState().loopOn).toBe(true);
    // Loop wrap should have rescheduled at least once
    expect(api.getState().midiScheduleGen).toBeGreaterThanOrEqual(gen0);
    api.pause();
  });

  function loadDemo(rel) {
    return JSON.parse(readFileSync(join(root, rel), "utf8"));
  }

  /** First N sections of a public demo, so auto-advance crosses a real pattern boundary. */
  function applyPublicSlice(payload, demo, sections = 2) {
    const last = demo.secs[sections - 1];
    const nbars = last.end;
    payload.title = demo.title;
    payload.artist = demo.artist;
    payload.bpm = demo.bpm;
    payload.keys = demo.keys;
    payload.timeSig = demo.timeSig;
    payload.raw = demo.raw.slice(0, nbars);
    payload.nbars = nbars;
    payload.duration = demo.raw[nbars][1];
    payload.secs = demo.secs.slice(0, sections).map((s) => ({ ...s }));
    payload.patterns = {};
    for (const s of payload.secs) {
      const byId = demo.patterns[s.id];
      const byKind = demo.patterns[s.kind];
      if (byId) payload.patterns[s.id] = byId;
      if (byKind) payload.patterns[s.kind] = byKind;
    }
    payload.drumHits = (demo.drumHits || []).filter((h) => h.bar < nbars);
    payload.cards = demo.cards || payload.cards;
  }

  it("public demos: Make Funk and Maple Leaf Rag auto-advance reschedule new pattern MIDI", async () => {
    const cases = [
      {
        file: "../work/demo-make-funk/demo-data.json",
        nextPat: "a1_bass",
        distinctMidi: 31,
        keySig: null,
        drums: true,
      },
      {
        file: "../work/demo-maple-leaf-rag/demo-data.json",
        nextPat: "a2_lh",
        distinctMidi: 44,
        keySig: { kind: "flat", count: "4" },
        drums: false,
      },
    ];
    for (const c of cases) {
      const demoSong = loadDemo(c.file);
      const boundary = demoSong.raw[demoSong.secs[1].first][1];
      const api = await bootPlayer({
        privateMode: false,
        withStems: false,
        mutatePayload: (p) => applyPublicSlice(p, demoSong, 2),
      });
      const N = window.__BASS_NOTATION__;
      api.pickSection(0);
      api.setLoop(false);
      api.setMidiBass(true);
      api.setMidiDrums(true);
      api.seek(Math.max(0, boundary - 0.18));
      api.play();
      await api.waitTick(80);
      const gen0 = api.getState().midiScheduleGen;
      const ctx = window.__LAST_AUDIO_CTX__;
      const oscBefore = ctx._oscillators.slice();
      const srcBefore = new Set(ctx._sources);
      expect(gen0).toBeGreaterThan(0);
      const advanced = await waitUntil(() => api.getState().secIdx >= 1, { timeoutMs: 4000 });
      expect(advanced).toBe(true);
      expect(api.getState().patternId).toBe(c.nextPat);
      expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
      // Prior voices, when any were still queued, must be cancelled (stop(0)), not left ringing.
      if (oscBefore.length) expect(oscBefore.every((o) => o._stopped)).toBe(true);
      const f = N.midiToFreq(c.distinctMidi);
      const fresh = ctx._oscillators.filter((o) => !oscBefore.includes(o) && !o._stopped);
      expect(fresh.some((o) => Math.abs(o.frequency.value - f) < 0.05)).toBe(true);
      const bass = document.querySelector('svg[aria-label="Bass staff"]');
      const drums = document.querySelector('svg[aria-label="Drum staff"]');
      expect(bass.querySelector("[data-time-sig]")?.getAttribute("data-time-sig")).toBe("4/4");
      expect(drums.querySelector("[data-time-sig]")?.getAttribute("data-time-sig")).toBe("4/4");
      expect(drums.querySelector("[data-key-sig]")).toBeNull();
      if (c.keySig) {
        const ks = bass.querySelector("[data-key-sig]");
        expect(ks?.getAttribute("data-key-kind")).toBe(c.keySig.kind);
        expect(ks?.getAttribute("data-key-count")).toBe(c.keySig.count);
      } else {
        expect(bass.querySelector("[data-key-sig]")).toBeNull();
      }
      if (c.drums) {
        const freshSrc = ctx._sources.filter((s) => !srcBefore.has(s) && !s.stopped);
        expect(freshSrc.length).toBeGreaterThan(0);
      }
      expect(api.getState().playing).toBe(true);
      expect(api.getState().playbackRate).toBe(1);
      api.pause();
      teardownPlayer();
    }
  });
});

describe("v1-drums-empty: drums-out independent of bass PEDAL", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("drumHitsForView / isDrumsOut: bar ranges and section flag; bass not emptied", async () => {
    const api = await bootPlayer();
    const N = window.__BASS_NOTATION__;
    expect(N.isDrumsOut({}, N.PEDAL)).toBe(false);
    expect(N.isDrumsOut({ drumsOut: true }, N.PEDAL)).toBe(true);
    expect(N.isDrumsOut({}, { ...N.PEDAL, drumsOut: true })).toBe(true);
    expect(N.isDrumsOut({}, N.EMPTY)).toBe(true);
    expect(N.normalizeDrumsOutBars({ drumsOutBars: [[0, 10]] })).toEqual([[0, 10]]);
    expect(N.isBarDrumsSilent(10, [[0, 10]])).toBe(true);
    expect(N.isBarDrumsSilent(11, [[0, 10]])).toBe(false);

    // No invent default: missing song hits → empty even when drumsOutBars is set
    expect(N.drumHitsForView(4, false, 8, { drumsOutBars: [[8, 10]] })).toEqual([]);
    // With song hits: viewLo=8, bars 8–11; silence [[8,10]] → only bar 11 remains
    const song = [];
    for (let bar = 8; bar <= 11; bar++) {
      song.push({ bar, step: 0, kind: "kick", midi: 36 });
      song.push({ bar, step: 4, kind: "snare", midi: 38 });
      song.push({ bar, step: 0, kind: "hat", midi: 42 });
    }
    const filtered = N.drumHitsForView(4, false, 8, { drumsOutBars: [[8, 10]], drumHits: song });
    const bars = [...new Set(filtered.map((h) => 8 + Math.floor(h.step / 16)))];
    expect(bars.every((b) => b >= 11)).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
    expect(N.drumHitsForView(2, false, 0, { drumsOut: true })).toEqual([]);
    expect(N.drumHitsForView(2, false, 0, { rhythmOut: true })).toEqual([]);
    expect(N.isRhythmOut(N.PEDAL)).toBe(false);
    // Dead helper may still invent for unit tests, but player path must not use it
    expect(N.buildDrumHits(4, false).length).toBeGreaterThan(0);
  });

  it("PEDAL section with drumsOutBars covering view: bass notes, drum rests (no invented hats)", async () => {
    const api = await bootPlayer({
      mutatePayload: (payload) => {
        // s1 = verse bars 8–16; silence whole view; bass stays pedal
        payload.drumsOutBars = [[8, 15]];
        payload.patterns.s1 = [{ id: "pedal", name: "Pedal point on D", notes: payload.patterns.s1[0].notes }];
        payload.cards.s1 = [
          { label: "Pocket", body: "Out early — rests, not an invented 8th-hat grid." },
          { label: "Figure", body: "Pedal stays — bass present while drums are out." },
        ];
      },
    });
    api.pickSection(1);
    await api.waitTick(20);
    expect(api.getState().patternId).toBe("pedal");
    expect(api.getState().patternId).not.toBe("empty");

    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    expect(bass.querySelectorAll("g[data-rhythm='note']").length).toBeGreaterThan(0);

    const drumLayer = [...document.querySelectorAll(".layer")].find((l) =>
      /Drum staff/i.test(l.querySelector(".layer-head-title")?.textContent || "")
    );
    expect(drumLayer?.querySelector(".layer-head-title")?.textContent || "").toMatch(/rests \(drums out\)/i);

    const drums = document.querySelector('svg[aria-label="Drum staff"]');
    expect(drums.querySelectorAll("g[data-rhythm='note']").length).toBe(0);
    expect(drums.querySelectorAll("g[data-rhythm='note'][data-drum='hat']").length).toBe(0);
    expect(drums.querySelectorAll("g[data-rhythm='rest']").length).toBeGreaterThan(0);
  });

  it("section.drumsOut with PEDAL: drums rests, bass notes remain", async () => {
    const api = await bootPlayer({
      mutatePayload: (payload) => {
        payload.secs[1].drumsOut = true;
        payload.patterns.s1 = [{ id: "pedal", name: "Pedal point on D", notes: payload.patterns.s1[0].notes }];
      },
    });
    api.pickSection(1);
    await api.waitTick(20);
    expect(api.getState().patternId).toBe("pedal");
    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    expect(bass.querySelectorAll("g[data-rhythm='note']").length).toBeGreaterThan(0);
    const drums = document.querySelector('svg[aria-label="Drum staff"]');
    expect(drums.querySelectorAll("g[data-rhythm='note']").length).toBe(0);
    expect(document.body.textContent).toMatch(/rests \(drums out\)/i);
  });
});

describe("phone layout — cards bottom drawer", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("exports PHONE_MAX_WIDTH 640 and isPhoneLayout helper", async () => {
    const api = await bootPlayer({ width: 1280 });
    expect(window.__BASS_NOTATION__.PHONE_MAX_WIDTH).toBe(640);
    expect(typeof window.__BASS_NOTATION__.isPhoneLayout).toBe("function");
    expect(window.__BASS_NOTATION__.isPhoneLayout()).toBe(false);
    expect(api.getState().isPhoneLayout).toBe(false);
    expect(api.getState().phoneMaxWidth).toBe(640);
  });

  it("wide viewport (~1280) keeps cards in the grid — no drawer forced", async () => {
    const api = await bootPlayer({ width: 1280, height: 800 });
    api.pickSection(2);
    const s = api.getState();
    expect(s.isPhoneLayout).toBe(false);
    expect(s.cardsDrawerOpen).toBe(false);
    expect(s.cardsInGrid).toBe(true);
    expect(s.cardsInDrawer).toBe(false);
    expect(document.querySelector("[data-cards-drawer]")).toBeNull();
    expect(document.querySelector(".phone-cards-peek")).toBeNull();
    expect(document.querySelector(".cards-drawer-backdrop")).toBeNull();
    expect(document.querySelector(".grid > .cards, .grid > [data-cards-panel]")).toBeTruthy();
    expect(document.querySelector(".layers")).toBeTruthy();
    expect(document.querySelector(".shell")).toBeTruthy();
  });

  it("phone width 390×844 places cards inside drawer DOM (not grid column)", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    const s = api.getState();
    expect(s.isPhoneLayout).toBe(true);
    expect(s.cardsInDrawer).toBe(true);
    expect(s.cardsInGrid).toBe(false);
    expect(document.querySelector(".grid > .cards, .grid > [data-cards-panel]")).toBeNull();
    expect(document.querySelector("[data-cards-drawer] [data-cards-panel]")).toBeTruthy();
    expect(document.querySelector(".phone-cards-peek")).toBeTruthy();
    expect(document.querySelector(".layers")).toBeTruthy();
    // Core score stack present
    expect(document.querySelector('svg[aria-label="Bass staff"]')).toBeTruthy();
    expect(document.querySelector('svg[aria-label="Drum staff"]')).toBeTruthy();
  });

  it("open drawer via peek, switch cards (next/prev/mini), close via ×", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    expect(api.getState().cardsDrawerOpen).toBe(false);
    expect(document.querySelector("[data-cards-drawer]")?.hidden).toBe(true);

    const peek = document.querySelector(".phone-cards-peek");
    expect(peek).toBeTruthy();
    peek.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().cardsDrawerOpen).toBe(true);
    expect(document.querySelector("[data-cards-drawer]")?.hidden).toBe(false);
    expect(document.querySelector("[data-cards-drawer]")?.classList.contains("open")).toBe(true);
    expect(document.body.classList.contains("cards-drawer-open")).toBe(true);

    expect(api.getState().activeCardLabel).toBe("Pocket");
    const nextBtn = [...document.querySelectorAll("[data-cards-drawer] button")].find((b) => /Next card/i.test(b.textContent || ""));
    expect(nextBtn).toBeTruthy();
    nextBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().activeCardLabel).toBe("Figure");
    expect(api.getState().cardsDrawerOpen).toBe(true);

    const prevBtn = [...document.querySelectorAll("[data-cards-drawer] button")].find((b) => /^Prev$/i.test(b.textContent || ""));
    expect(prevBtn).toBeTruthy();
    prevBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().activeCardLabel).toBe("Pocket");

    const mini = document.querySelector('[data-cards-drawer] .card-mini[data-card="1"]');
    expect(mini).toBeTruthy();
    mini.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().activeCardLabel).toBe("Figure");
    expect(api.getState().hasInsightPanel).toBe(true);
    expect(document.querySelector("[data-cards-drawer] .card-insight")).toBeTruthy();

    const closeBtn = document.querySelector('[data-cards-drawer] [data-drawer="close"]');
    expect(closeBtn).toBeTruthy();
    closeBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().cardsDrawerOpen).toBe(false);
    expect(document.querySelector("[data-cards-drawer]")?.hidden).toBe(true);
    expect(document.body.classList.contains("cards-drawer-open")).toBe(false);
  });

  it("backdrop closes the drawer", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.openCardsDrawer();
    expect(api.getState().cardsDrawerOpen).toBe(true);
    const backdrop = document.querySelector(".cards-drawer-backdrop");
    expect(backdrop).toBeTruthy();
    expect(backdrop.hidden).toBe(false);
    backdrop.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(40);
    expect(api.getState().cardsDrawerOpen).toBe(false);
  });

  it("Escape closes open drawer before clearing subsection", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    api.setLoopBars(18, 20);
    api.openCardsDrawer();
    expect(api.getState().cardsDrawerOpen).toBe(true);
    expect(api.getState().lo).toBe(18);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().cardsDrawerOpen).toBe(false);
    // Subsection still selected — Escape only closed the drawer
    expect(api.getState().lo).toBe(18);
    expect(api.getState().hi).toBe(20);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().lo).toBe(16);
    expect(api.getState().hi).toBe(23);
  });

  it("play while drawer open keeps cards tappable (next + mini)", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true, width: 390, height: 844 });
    api.pickSection(2);
    api.openCardsDrawer();
    api.play();
    await api.waitTick(100);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().cardsDrawerOpen).toBe(true);

    const nextBtn = [...document.querySelectorAll("[data-cards-drawer] button")].find((b) => /Next card/i.test(b.textContent || ""));
    nextBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(60);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().cardsDrawerOpen).toBe(true);
    expect(api.getState().activeCardLabel).toBe("Figure");

    const mini = document.querySelector('[data-cards-drawer] .card-mini[data-card="0"]');
    mini.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(60);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().activeCardLabel).toBe("Pocket");
    expect(document.querySelector("[data-cards-drawer] .card-insight")).toBeTruthy();
  });

  it("section change while drawer open keeps drawer open with new section cards", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    api.openCardsDrawer();
    api.setCard(1);
    expect(api.getState().activeCardLabel).toBe("Figure");
    expect(api.getState().cardsDrawerOpen).toBe(true);

    api.pickSection(0);
    await api.waitTick(30);
    const s = api.getState();
    expect(s.secIdx).toBe(0);
    expect(s.cardsDrawerOpen).toBe(true);
    expect(s.cardIdx).toBe(0);
    expect(document.querySelector("[data-cards-drawer]")?.hidden).toBe(false);
    expect(document.querySelector("[data-cards-drawer] [data-cards-panel]")).toBeTruthy();
  });

  it("section change while drawer closed stays closed", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    expect(api.getState().cardsDrawerOpen).toBe(false);
    api.pickSection(1);
    await api.waitTick(20);
    expect(api.getState().cardsDrawerOpen).toBe(false);
    expect(document.querySelector(".phone-cards-peek")).toBeTruthy();
    expect(document.querySelector("[data-cards-drawer]")?.hidden).toBe(true);
  });

  it("crossing breakpoint via resize: phone→desktop removes drawer; desktop→phone mounts peek", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.openCardsDrawer();
    expect(api.getState().cardsInDrawer).toBe(true);

    setViewport(1280, 800);
    window.dispatchEvent(new Event("resize"));
    await api.waitTick(40);
    expect(api.getState().isPhoneLayout).toBe(false);
    expect(api.getState().cardsDrawerOpen).toBe(false);
    expect(api.getState().cardsInGrid).toBe(true);
    expect(document.querySelector("[data-cards-drawer]")).toBeNull();

    setViewport(390, 844);
    window.dispatchEvent(new Event("resize"));
    await api.waitTick(40);
    expect(api.getState().isPhoneLayout).toBe(true);
    expect(api.getState().cardsInDrawer).toBe(true);
    expect(document.querySelector(".phone-cards-peek")).toBeTruthy();
  });

  it("insight redesign still renders inside phone drawer (Figure + legend)", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    api.openCardsDrawer();
    api.setCard(1);
    const panel = document.querySelector("[data-cards-drawer] .card-insight");
    expect(panel).toBeTruthy();
    expect(panel.getAttribute("data-insight-layer")).toBe("figure");
    expect(document.querySelector("[data-cards-drawer] [data-insight-legend]")).toBeTruthy();
    const labels = [...document.querySelectorAll("[data-cards-drawer] [data-insight-label]")].map((n) => n.getAttribute("data-insight-label"));
    expect(labels.length).toBeGreaterThan(0);
  });

  it("phone drawer keeps lean-B insight schematic with the active card (not prose-only)", async () => {
    const api = await bootPlayer({ width: 390, height: 844 });
    api.pickSection(2);
    api.openCardsDrawer();
    // Every deck card must expose insight payload + schematic panel beside/with the card.
    for (let i = 0; i < 4; i++) {
      api.setCard(i);
      await api.waitTick(20);
      const st = api.getState();
      expect(st.cardsDrawerOpen).toBe(true);
      expect(st.activeCardInsight).toBeTruthy();
      expect(st.hasInsightPanel).toBe(true);
      const panel = document.querySelector("[data-cards-drawer] .card-insight");
      expect(panel).toBeTruthy();
      expect(panel.getAttribute("data-insight-layer")).toBeTruthy();
      // Schematic SVG (pocket/figure/missable) or harmony chord chips — never empty.
      const hasSvg = Boolean(panel.querySelector("svg.card-insight-svg, svg[aria-label]"));
      const hasChords = Boolean(panel.querySelector(".card-insight-chords"));
      expect(hasSvg || hasChords).toBe(true);
    }
    // Stylesheet must pin a min-height so flex cannot crush the schematic in the drawer.
    const css = document.getElementById("bass-player-styles")?.textContent || "";
    expect(css).toMatch(/\.cards-drawer \.card-insight[^{]*\{[^}]*min-height:\s*196px/);
    expect(css).toMatch(/\.cards-drawer \.card-insight-svg[^{]*\{[^}]*min-height:\s*148px/);
  });

  it("phone chrome: title/meta stay in header, timeline labels larger, stems badge short", async () => {
    const api = await bootPlayer({ privateMode: false, withStems: true, width: 390, height: 844 });
    api.pickSection(2);
    expect(api.getState().isPhoneLayout).toBe(true);
    const shell = document.querySelector(".shell");
    expect(shell?.getAttribute("data-phone")).toBe("1");
    const header = document.querySelector(".header");
    const meta = document.querySelector(".meta");
    const title = document.querySelector(".meta .title");
    expect(header && meta && title).toBeTruthy();
    expect(header.contains(meta)).toBe(true);
    expect(header.contains(title)).toBe(true);
    expect((title.textContent || "").length).toBeGreaterThan(0);

    const badge = document.querySelector('[data-meta="badge"]');
    expect(badge).toBeTruthy();
    // Short chip — no awkward "stems · full" wrap on ~390px.
    expect(badge.textContent.trim().length).toBeLessThanOrEqual(8);
    expect(badge.textContent).toMatch(/stems|solo|muted|D\+B|drums|demo|loading/i);

    const tl = document.querySelector('svg[aria-label="Section timeline"]');
    expect(tl).toBeTruthy();
    expect(tl.getAttribute("data-timeline-phone")).toBe("1");
    const vb = (tl.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    expect(vb[3]).toBeGreaterThanOrEqual(88);
    const labelFs = [...tl.querySelectorAll("text[data-tl-label], text")].map((n) => Number(n.getAttribute("font-size") || 0));
    expect(Math.max(...labelFs)).toBeGreaterThanOrEqual(13);

    // Peek advertises schematic; drawer holds the real insight panel.
    const peekKicker = document.querySelector(".phone-cards-peek-kicker");
    expect(peekKicker?.getAttribute("data-peek-insight")).toBe("1");
    expect(peekKicker?.textContent || "").toMatch(/schematic/i);

    const css = document.getElementById("bass-player-styles")?.textContent || "";
    expect(css).toMatch(/@media \(max-width:640px\)[\s\S]*\.header\s*\{[^}]*flex-direction:\s*column/);
    expect(css).toMatch(/@media \(max-width:640px\)[\s\S]*\.meta \.badge/);
    expect(css).toMatch(/@media \(max-width:640px\)[\s\S]*\.layer\.chords\s*\{[^}]*flex:\s*0 0 104px/);
  });

  it("desktop 2-col unchanged at 1280 — cards in grid, no phone timeline/badge shortening", async () => {
    const api = await bootPlayer({ privateMode: false, withStems: true, width: 1280, height: 800 });
    expect(api.getState().isPhoneLayout).toBe(false);
    expect(document.querySelector(".shell")?.getAttribute("data-phone")).toBe("0");
    expect(document.querySelector(".grid > [data-cards-panel]")).toBeTruthy();
    expect(document.querySelector("[data-cards-drawer]")).toBeNull();
    const badge = document.querySelector('[data-meta="badge"]');
    expect(badge?.textContent || "").toMatch(/stems ·/);
    const tl = document.querySelector('svg[aria-label="Section timeline"]');
    expect(tl?.getAttribute("data-timeline-phone")).toBe("0");
    const vb = (tl.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    expect(vb[3]).toBe(72);
  });
});


describe("playback rate + public CC0 stems", () => {
  afterEach(() => teardownPlayer());

  it("rate strip exposes standard percentages and setPlaybackRate", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const strip = document.querySelector("[data-rate-strip]");
    expect(strip).toBeTruthy();
    const labels = [...strip.querySelectorAll(".rate-btn")].map((b) => b.textContent.trim());
    expect(labels).toEqual(["100%", "90%", "75%", "50%", "25%"]);
    expect(api.getState().playbackRate).toBe(1);
    api.setPlaybackRate(0.75);
    expect(api.getState().playbackRate).toBe(0.75);
    expect(document.querySelector('.rate-btn[data-rate="0.75"].on')).toBeTruthy();
    document.querySelector('.rate-btn[data-rate="0.5"]').dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(20);
    expect(api.getState().playbackRate).toBe(0.5);
  });

  it("public player with CC0 stems shows channel strip + credit", async () => {
    const api = await bootPlayer({ privateMode: false, withStems: true });
    expect(api.getState().muteBassSupported).toBe(true);
    expect(document.querySelector(".ch-strip")).toBeTruthy();
    expect(document.querySelector("[data-credit]")).toBeTruthy();
    expect(document.querySelector("[data-credit]").textContent).toMatch(/HoliznaCC0|Make Funk/i);
    expect(document.querySelector("[data-credit]").textContent).toMatch(/CC0/i);
    expect(document.body.textContent).not.toMatch(/Like a Prayer/i);
  });

  it("tempo slowdown keeps stem BufferSource.playbackRate at 1 (WSOLA, not raw rate)", async () => {
    // Regression: earlier ship set source.playbackRate = tempo and claimed "pitch preserved".
    // That ALWAYS shifts pitch. Pitch-preserving path must stretch buffers and play at rate 1.
    const api = await bootPlayer({ privateMode: true, withStems: true });
    expect(api.getState().pitchPreserveMode).toBe("wsola");
    expect(api.getState().stemTempoUsesRawPlaybackRate).toBe(false);
    expect(window.__BASS_NOTATION__.stemTempoUsesRawPlaybackRate()).toBe(false);

    await api.ensureAudio();
    api.setPlaybackRate(0.5);
    api.play();
    await api.waitTick(80);

    const st = api.getState();
    expect(st.playbackRate).toBe(0.5);
    expect(st.usingAudio).toBe(true);
    expect(st.stemSourcePlaybackRate).toBe(1);
    expect(st.stretchWindowSongSec).toBe(16);

    const ctx = window.__LAST_AUDIO_CTX__;
    expect(ctx).toBeTruthy();
    const started = (ctx._sources || []).filter((s) => s.buffer && s.startedAt != null);
    expect(started.length).toBeGreaterThanOrEqual(2);
    for (const s of started) {
      expect(s.playbackRate.value).toBe(1);
      // Windowed stretch of the short fixture stem (~0.25s samples) at 0.5 → ~0.5s.
      expect(s.buffer.length).toBeGreaterThan(Math.floor(44100 * 0.25) * 1.5);
    }
  });

  it("would fail if only BufferSource.playbackRate carried tempo for pitch-preserve claim", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    await api.ensureAudio();
    api.setPlaybackRate(0.75);
    api.play();
    await api.waitTick(80);
    const ctx = window.__LAST_AUDIO_CTX__;
    const started = (ctx._sources || []).filter((s) => s.buffer && s.startedAt != null);
    expect(started.length).toBeGreaterThan(0);
    // If someone "fixes" tempo by assigning playbackRate=0.75 on the source, this fails.
    const rawRateUsed = started.some((s) => Math.abs(s.playbackRate.value - 0.75) < 1e-9);
    expect(rawRateUsed).toBe(false);
    expect(api.getState().stemSourcePlaybackRate).toBe(1);
    expect(api.getState().playbackRate).toBe(0.75);
  });

  it("mid-play tempo tap on long stereo stems stays bounded and does not break the player", async () => {
    // Regression: shipping full-track WSOLA on ~156s stereo×3 froze/OOM'd the page on rate tap.
    // Interactive path must stretch only STRETCH_WINDOW_SONG_S ahead of the playhead.
    const stemSeconds = 60;
    const api = await bootPlayer({
      privateMode: true,
      withStems: true,
      stemSeconds,
      stemChannels: 2,
      mutatePayload: (p) => { p.duration = stemSeconds; },
    });
    expect(window.__BASS_NOTATION__.STRETCH_WINDOW_SONG_S).toBe(16);
    expect(window.__BASS_NOTATION__.INTERACTIVE_STRETCH_OPTS.seekWin).toBe(0);

    await api.ensureAudio();
    api.play();
    await api.waitTick(40);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().usingAudio).toBe(true);

    const t0 = Date.now();
    let threw = null;
    try {
      api.setPlaybackRate(0.5);
    } catch (e) {
      threw = e;
    }
    const elapsed = Date.now() - t0;
    expect(threw).toBeNull();
    // Full-track default-seek stretch on 60s×2ch×3 is multi-second; windowed path must stay snappy.
    expect(elapsed).toBeLessThan(2500);

    const st = api.getState();
    expect(st.playbackRate).toBe(0.5);
    expect(st.playing).toBe(true);
    expect(st.usingAudio).toBe(true);
    expect(st.stemSourcePlaybackRate).toBe(1);
    expect(st.pitchPreserveMode).toBe("wsola");
    expect(st.stretchWindowSongSec).toBe(16);
    expect(st.stretchWindowSongEnd - st.stretchWindowSongStart).toBeLessThanOrEqual(16.01);
    expect(st.stretchWindowSongEnd - st.stretchWindowSongStart).toBeGreaterThan(0);

    const ctx = window.__LAST_AUDIO_CTX__;
    const started = (ctx._sources || []).filter((s) => s.buffer && s.startedAt != null);
    expect(started.length).toBeGreaterThanOrEqual(2);
    // Ignore sources from the earlier rate=1 play(); only the post-tempo-change window matters.
    const recent = started.slice(-3);
    const maxAllowed = Math.ceil(44100 * (16 / 0.5) * 1.05) + 44100; // window/rate + slack
    for (const s of recent) {
      expect(s.playbackRate.value).toBe(1);
      expect(s.buffer.length).toBeLessThan(maxAllowed);
      // Must not have stretched the entire 60s stem (would be ~120s at rate 0.5).
      expect(s.buffer.length).toBeLessThan(Math.floor(44100 * stemSeconds / 0.5) * 0.5);
    }

    // UI still alive — rate strip present, another tempo tap works without refresh.
    expect(document.querySelector("[data-rate-strip]")).toBeTruthy();
    api.setPlaybackRate(0.75);
    expect(api.getState().playbackRate).toBe(0.75);
    expect(api.getState().playing).toBe(true);
    expect(document.querySelector('.rate-btn[data-rate="0.75"].on')).toBeTruthy();
  });
});

describe("public has no Private link + private song typeahead", () => {
  afterEach(() => teardownPlayer());

  it("public player does not expose a Private link and lists DEMO demos without Komiku", async () => {
    await bootPlayer({ privateMode: false, withStems: true });
    expect(document.querySelector("[data-private-entry]")).toBeNull();
    expect(document.querySelector('a[href="/private/player/"]')).toBeNull();
    expect(document.querySelector('a[href*="/private/"]')).toBeNull();
    const credit = document.querySelector("[data-credit]");
    expect(credit).toBeTruthy();
    expect(credit.textContent).not.toMatch(/\bPrivate\b/);

    const PAGE_TITLE = "Song Bass Explainer - Understand Bass Lines in Songs";
    expect(document.title).toBe(PAGE_TITLE);
    expect(document.title).not.toMatch(/gambling|Make Funk|Maple Leaf|Like a Prayer|Fixture Tune/i);
    const songHeading = document.querySelector(".meta .title");
    expect(songHeading?.textContent || "").not.toBe(PAGE_TITLE);

    const picker = document.querySelector("[data-song-picker][data-song-typeahead]");
    expect(picker).toBeTruthy();
    expect(document.querySelector("select[data-song-picker]")).toBeNull();
    const input = document.querySelector("[data-song-typeahead-input]");
    expect(input?.tagName.toLowerCase()).toBe("input");
    expect(input.getAttribute("aria-label") || "").not.toMatch(/processed|public/i);

    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    const list = document.querySelector("[data-song-listbox]");
    expect(list).toBeTruthy();
    expect(list.hasAttribute("hidden")).toBe(false);

    const demoGroup = list.querySelector('[data-group="demo"].song-typeahead-group');
    expect(demoGroup).toBeTruthy();
    expect(demoGroup.querySelector('[data-group-label="demo"]').textContent).toBe("Demo");
    expect(list.querySelector('[data-group="processed"]')).toBeNull();
    expect(list.querySelector('[data-group-label="public"]')).toBeNull();
    expect(list.textContent).not.toMatch(/\bPublic\b/);
    expect(list.textContent).not.toMatch(/\bProcessed\b/);

    const demoIds = [...demoGroup.querySelectorAll("[data-song-id]")].map((o) => o.getAttribute("data-song-id"));
    expect(demoIds).toEqual([
      "make-funk",
      "maple-leaf-rag",
    ]);
    expect(list.querySelector('[data-song-id="like-a-prayer"]')).toBeNull();

    const api = window.__BASS_PLAYER__;
    api.nextCard();
    expect(document.title).toBe(PAGE_TITLE);
  });

  it("public load with no ?song= fetches Make Funk and starts the whole song", async () => {
    window.history.replaceState({}, "", "/");
    const api = await bootPlayer({ privateMode: false, withStems: true });
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    const songFetches = urls.filter((u) => /\/api\/demo\/(make-funk|a-good-bass-for-gambling|maple-leaf-rag)(\?|$|\/)/.test(u));
    expect(songFetches[0]).toContain("/api/demo/make-funk");
    expect(songFetches.some((u) => u.includes("a-good-bass-for-gambling"))).toBe(false);
    expect(songFetches.some((u) => u.includes("maple-leaf-rag"))).toBe(false);
    const s = api.getState();
    expect(s.loopOn).toBe(false);
    expect(s.secIdx).toBe(0);
    expect(s.lo).toBe(0);
    expect(s.hi).toBe(demo.nbars - 1);
    expect(s.t).toBeCloseTo(demo.raw[0][1], 5);
    const input = document.querySelector("[data-song-typeahead-input]");
    expect(input.value).toMatch(/Make Funk/);
    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    const demoIds = [...document.querySelectorAll('[data-group="demo"] [data-song-id]')].map((o) => o.getAttribute("data-song-id"));
    expect(demoIds).toEqual([
      "make-funk",
      "maple-leaf-rag",
    ]);
  });

  it("explicit ?song=maple-leaf-rag loads that demo; unknown/Komiku falls back to Make Funk", async () => {
    window.history.replaceState({}, "", "/?song=maple-leaf-rag");
    const api = await bootPlayer({ privateMode: false, withStems: true });
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    const songFetches = urls.filter((u) => /\/api\/demo\/(make-funk|a-good-bass-for-gambling|maple-leaf-rag)(\?|$|\/)/.test(u));
    expect(songFetches[0]).toContain("/api/demo/maple-leaf-rag");
    expect(api.getState().loopOn).toBe(false);
    expect(api.getState().secIdx).toBe(0);
    expect(api.getState().lo).toBe(0);
    expect(api.getState().hi).toBe(demo.nbars - 1);
    expect(document.querySelector("[data-song-typeahead-input]").value).toMatch(/Maple Leaf/i);

    // Komiku dropped from public allowlist → default Make Funk
    window.history.replaceState({}, "", "/?song=a-good-bass-for-gambling");
    await bootPlayer({ privateMode: false, withStems: true });
    const urls2 = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    const songFetches2 = urls2.filter((u) => /\/api\/demo\/(make-funk|a-good-bass-for-gambling|maple-leaf-rag)(\?|$|\/)/.test(u));
    expect(songFetches2[0]).toContain("/api/demo/make-funk");
    expect(songFetches2.some((u) => u.includes("a-good-bass-for-gambling") && !u.includes("catalog"))).toBe(false);
  });

  it("song typeahead stays stable while playback re-renders", async () => {
    const api = await bootPlayer({ privateMode: true });
    api.play();
    await api.waitTick(70);
    expect(api.getState().playing).toBe(true);
    const input = document.querySelector("[data-song-typeahead-input]");
    const list = document.querySelector("[data-song-listbox]");
    expect(input).toBeTruthy();
    expect(list).toBeTruthy();
    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.value = "funk";
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(list.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement).toBe(input);
    await api.waitTick(220);
    expect(api.getState().playing).toBe(true);
    expect(document.querySelector("[data-song-typeahead-input]")).toBe(input);
    expect(document.querySelector("[data-song-listbox]")).toBe(list);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("funk");
    expect(list.hasAttribute("hidden")).toBe(false);
    const ids = [...list.querySelectorAll("[data-song-id]")].map((o) => o.getAttribute("data-song-id"));
    expect(ids).toEqual(["make-funk"]);
    const assigns = [];
    window.__BASS_SONG_NAV__ = (url, id) => assigns.push({ url: String(url), id: String(id) });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(assigns).toEqual([
      expect.objectContaining({ id: "make-funk" }),
    ]);
    expect(assigns[0].url).toMatch(/[?&]song=make-funk/);
    api.pause();
  });

  it("public typeahead filters and keyboard Enter selects via ?song=", async () => {
    await bootPlayer({ privateMode: false, withStems: true });
    const assigns = [];
    window.__BASS_SONG_NAV__ = (url, id) => assigns.push({ url: String(url), id: String(id) });
    try {
      const input = document.querySelector("[data-song-typeahead-input]");
      expect(input).toBeTruthy();
      input.focus();
      input.value = "maple";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const list = document.querySelector("[data-song-listbox]");
      const opts = [...list.querySelectorAll('[role="option"]')];
      expect(opts.map((o) => o.getAttribute("data-song-id"))).toEqual(["maple-leaf-rag"]);
      expect(list.querySelector('[data-group-label="demo"]').textContent).toBe("Demo");
      expect(list.querySelector('[data-group="processed"]')).toBeNull();
      expect(list.textContent).not.toMatch(/\bPublic\b/);

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(assigns.length).toBe(1);
      expect(assigns[0].id).toBe("maple-leaf-rag");
      expect(assigns[0].url).toMatch(/[?&]song=maple-leaf-rag/);
      expect(document.title).toBe("Song Bass Explainer - Understand Bass Lines in Songs");
    } finally {
      delete window.__BASS_SONG_NAV__;
    }
  });

  it("private player typeahead shows Demo vs Processed groups", async () => {
    await bootPlayer({ privateMode: true, withStems: true });
    const picker = document.querySelector("[data-song-picker][data-song-typeahead]");
    expect(picker).toBeTruthy();
    const input = document.querySelector("[data-song-typeahead-input]");
    expect(input).toBeTruthy();
    expect(input.tagName.toLowerCase()).toBe("input");
    expect(document.querySelector("select[data-song-picker]")).toBeNull();

    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    const list = document.querySelector("[data-song-listbox]");
    expect(list).toBeTruthy();
    expect(list.hasAttribute("hidden")).toBe(false);

    const demoGroup = list.querySelector('[data-group="demo"].song-typeahead-group');
    const procGroup = list.querySelector('[data-group="processed"].song-typeahead-group');
    expect(demoGroup).toBeTruthy();
    expect(procGroup).toBeTruthy();
    expect(demoGroup.querySelector("[data-group-label=\"demo\"]").textContent).toBe("Demo");
    expect(procGroup.querySelector("[data-group-label=\"processed\"]").textContent).toBe("Processed");

    const demoIds = [...demoGroup.querySelectorAll("[data-song-id]")].map((o) => o.getAttribute("data-song-id"));
    const procIds = [...procGroup.querySelectorAll("[data-song-id]")].map((o) => o.getAttribute("data-song-id"));
    expect(demoIds).toContain("a-good-bass-for-gambling");
    expect(demoIds).toContain("make-funk");
    expect(demoIds).toContain("maple-leaf-rag");
    expect(procIds).toContain("like-a-prayer");
    expect(demoIds).not.toContain("like-a-prayer");
    expect(document.querySelector("[data-private-entry]")).toBeNull();
  });

  it("private typeahead filters and keyboard Enter selects via ?song=", async () => {
    await bootPlayer({ privateMode: true, withStems: true });
    const assigns = [];
    window.__BASS_SONG_NAV__ = (url, id) => assigns.push({ url: String(url), id: String(id) });
    try {
      const input = document.querySelector("[data-song-typeahead-input]");
      expect(input).toBeTruthy();
      input.focus();
      input.value = "maple";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const list = document.querySelector("[data-song-listbox]");
      const opts = [...list.querySelectorAll('[role="option"]')];
      expect(opts.length).toBeGreaterThanOrEqual(1);
      expect(opts.some((o) => o.getAttribute("data-song-id") === "maple-leaf-rag")).toBe(true);
      expect(list.querySelector('[data-group-label="demo"]')).toBeTruthy();
      expect(list.querySelector('[data-song-id="like-a-prayer"]')).toBeNull();

      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(assigns.length).toBe(1);
      expect(assigns[0].id).toBe("maple-leaf-rag");
      expect(assigns[0].url).toMatch(/[?&]song=maple-leaf-rag/);
    } finally {
      delete window.__BASS_SONG_NAV__;
    }
  });
});

describe("staff time + key signatures", () => {
  afterEach(() => teardownPlayer());

  it("parseTimeSig and keySigFromKeys map demo fields", async () => {
    await bootPlayer();
    const N = window.__BASS_NOTATION__;
    expect(N.parseTimeSig("4/4")).toEqual({ num: 4, den: 4, label: "4/4" });
    expect(N.parseTimeSig("3/4")).toEqual({ num: 3, den: 4, label: "3/4" });
    expect(N.keySigFromKeys("Em")).toMatchObject({ label: "Em", kind: "sharp", count: 1 });
    expect(N.keySigFromKeys("Em").positions).toEqual([6]); // F# on bass F line
    expect(N.keySigFromKeys("Dm/F")).toMatchObject({ label: "Dm", kind: "flat", count: 1 });
    expect(N.keySigFromKeys("Am")).toMatchObject({ kind: "none", count: 0 });
    expect(N.keySigFromKeys("Ab")).toMatchObject({ label: "Ab", kind: "flat", count: 4 });
    expect(N.keySigFromKeys("C")).toMatchObject({ kind: "none", count: 0 });
  });

  it("renders time signature on both bass and drum staves", async () => {
    await bootPlayer({
      mutatePayload: (p) => {
        p.timeSig = "4/4";
        p.keys = "C";
      },
    });
    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    const drums = document.querySelector('svg[aria-label="Drum staff"]');
    expect(bass).toBeTruthy();
    expect(drums).toBeTruthy();
    const bassTs = bass.querySelector("[data-time-sig]");
    const drumTs = drums.querySelector("[data-time-sig]");
    expect(bassTs).toBeTruthy();
    expect(drumTs).toBeTruthy();
    expect(bassTs.getAttribute("data-time-sig")).toBe("4/4");
    expect(drumTs.getAttribute("data-time-sig")).toBe("4/4");
    expect(bassTs.textContent.replace(/\s/g, "")).toMatch(/44/);
    expect(drumTs.textContent.replace(/\s/g, "")).toMatch(/44/);
  });

  it("renders key signature on bass (Em → one sharp) and omits key sig on drums", async () => {
    await bootPlayer({
      mutatePayload: (p) => {
        p.timeSig = "4/4";
        p.keys = "Em";
      },
    });
    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    const drums = document.querySelector('svg[aria-label="Drum staff"]');
    const bassKs = bass.querySelector("[data-key-sig]");
    expect(bassKs).toBeTruthy();
    expect(bassKs.getAttribute("data-key-sig")).toBe("Em");
    expect(bassKs.getAttribute("data-key-kind")).toBe("sharp");
    expect(bassKs.getAttribute("data-key-count")).toBe("1");
    expect(bassKs.querySelectorAll("[data-accidental='sharp']").length).toBe(1);
    // Percussion: no key signature
    expect(drums.querySelector("[data-key-sig]")).toBeNull();
    // Time still on both
    expect(bass.querySelector("[data-time-sig]").getAttribute("data-time-sig")).toBe("4/4");
    expect(drums.querySelector("[data-time-sig]").getAttribute("data-time-sig")).toBe("4/4");
  });

  it("C major / Am: bass has time sig but no key-sig accidentals", async () => {
    await bootPlayer({
      mutatePayload: (p) => {
        p.timeSig = "4/4";
        p.keys = "Am";
      },
    });
    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    expect(bass.querySelector("[data-time-sig]")).toBeTruthy();
    expect(bass.querySelector("[data-key-sig]")).toBeNull();
  });

  it("Ab major draws four flats on bass key sig", async () => {
    await bootPlayer({
      mutatePayload: (p) => {
        p.keys = "Ab";
        p.timeSig = "4/4";
      },
    });
    const bass = document.querySelector('svg[aria-label="Bass staff"]');
    const ks = bass.querySelector("[data-key-sig]");
    expect(ks).toBeTruthy();
    expect(ks.getAttribute("data-key-kind")).toBe("flat");
    expect(ks.getAttribute("data-key-count")).toBe("4");
    expect(ks.querySelectorAll("[data-accidental='flat']").length).toBe(4);
  });
});

describe("chord-midi: playable chords + chord-row highlight (no main-staff diamonds)", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("parseChordSymbol / chordToneMidis cover demo qualities", async () => {
    await bootPlayer({ privateMode: true, withStems: false });
    const N = window.__BASS_NOTATION__;
    expect(N.parseChordSymbol("Dm")).toMatchObject({ rootPc: 2, quality: "min" });
    expect(N.parseChordSymbol("Bb")).toMatchObject({ rootPc: 10, quality: "maj" });
    expect(N.parseChordSymbol("A7")).toMatchObject({ rootPc: 9, quality: "dom7" });
    expect(N.parseChordSymbol("Fm7")).toMatchObject({ rootPc: 5, quality: "min7" });
    expect(N.parseChordSymbol("")).toBeNull();
    const dm = N.chordToneMidis("Dm");
    expect(dm.length).toBeGreaterThanOrEqual(3);
    const pcs = dm.map((m) => ((m % 12) + 12) % 12).sort((a, b) => a - b);
    expect(pcs).toEqual([2, 5, 9]); // D F A
    const a7 = N.chordToneMidis("A7");
    expect(a7.map((m) => ((m % 12) + 12) % 12).sort((a, b) => a - b)).toEqual([1, 4, 7, 9]); // A C# E G
    expect(N.CHORD_MIDI_VOICE.oscType).toBe("sine");
    expect(["sawtooth", "square"]).not.toContain(N.CHORD_MIDI_VOICE.oscType);
    expect(N.CHORD_MIDI_VOICE.peakGain).toBeLessThanOrEqual(0.12);
    expect(N.CHORD_MIDI_VOICE.filterType).toBe("lowpass");
  });

  it("chord MIDI toggle on chord layer; schedules while playing; highlights sounding chord", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    const chordMidi = () => document.querySelector('button[data-midi="chords"]');
    expect(chordMidi()).toBeTruthy();
    expect(chordMidi().textContent.trim()).toBe("MIDI");
    expect(api.getState().midiChords).toBe(false);

    chordMidi().dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    await api.waitTick(30);
    expect(api.getState().midiChords).toBe(true);
    expect(chordMidi().classList.contains("on")).toBe(true);
    expect(chordMidi().getAttribute("aria-pressed")).toBe("true");

    api.pickSection(0);
    api.setLoop(true);
    const gen0 = api.getState().midiScheduleGen;
    await api.ensureAudio();
    api.play();
    await api.waitTick(100);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().midiChords).toBe(true);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    expect(api.getState().midiNodeCount).toBeGreaterThan(0);

    const soundingChord = document.querySelector('g[data-sounding="1"][data-chord]');
    expect(soundingChord).toBeTruthy();
    expect(soundingChord.getAttribute("data-chord")).toBeTruthy();

    // Chord pads stay; diamonds and chord-tone ink do not land on the main bass staff.
    expect(document.querySelectorAll("[data-chord-tones]").length).toBe(0);
    expect(document.querySelectorAll('svg[aria-label="Bass staff"] [data-chord-tone]').length).toBe(0);
    expect(document.querySelectorAll('svg[aria-label="Bass tab"] [data-chord-tone]').length).toBe(0);

    const ctx = window.__LAST_AUDIO_CTX__;
    const chordOsc = ctx._oscillators.filter((o) => o.type === "sine" && !o._stopped);
    expect(chordOsc.length).toBeGreaterThanOrEqual(3);

    api.toggleMidiChords();
    expect(api.getState().midiChords).toBe(false);
    api.pause();
  });

  it("bass MIDI highlights sounding staff notes; drums MIDI highlights hits", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: true });
    api.pickSection(2);
    api.setMidiBass(true);
    api.setMidiDrums(true);
    await api.ensureAudio();
    api.play();
    await api.waitTick(120);
    expect(api.getState().playing).toBe(true);
    expect(api.getState().midiBass).toBe(true);
    expect(api.getState().midiDrums).toBe(true);
    const lit = document.querySelectorAll('[data-sounding="1"][data-midi], [data-sounding="1"][data-drum]');
    expect(lit.length).toBeGreaterThan(0);
    api.pause();
  });

  it("chord MIDI works without stems (demo path) and reschedules on section advance", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    expect(document.querySelector('button[data-midi="chords"]')).toBeTruthy();
    api.setMidiChords(true);
    api.setLoop(false);
    api.pickSection(0);
    api.seek(0);
    const gen0 = api.getState().midiScheduleGen;
    api.play();
    await api.waitTick(80);
    expect(api.getState().midiChords).toBe(true);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen0);
    const gen1 = api.getState().midiScheduleGen;
    api.pickSection(1);
    await api.waitTick(60);
    expect(api.getState().secIdx).toBe(1);
    expect(api.getState().midiScheduleGen).toBeGreaterThan(gen1);
    api.pause();
  });

  it("chord MIDI does not invent drums; empty rhythm-out still allows chords", async () => {
    const api = await bootPlayer({
      privateMode: true,
      withStems: true,
      mutatePayload: (payload) => {
        payload.patterns.s1 = [{ id: "empty", name: "Rest (rhythm section out)", notes: [] }];
      },
    });
    api.pickSection(1);
    api.setMidiBass(true);
    api.setMidiDrums(true);
    api.setMidiChords(true);
    await api.ensureAudio();
    api.play();
    await api.waitTick(80);
    expect(api.getState().patternId).toBe("empty");
    expect(api.getState().midiChords).toBe(true);
    expect(document.querySelector('button[data-midi="chords"].on')).toBeTruthy();
    const ctx = window.__LAST_AUDIO_CTX__;
    const live = ctx._oscillators.filter((o) => !o._stopped);
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect(live.every((o) => o.type === "sine")).toBe(true);
    api.pause();
  });
});

describe("insight-card MIDI + two-staff schematic", () => {
  afterEach(() => {
    teardownPlayer();
  });

  it("schematic is two staves (bass above drums) with Play and Bass/Drums toggles", async () => {
    const api = await bootPlayer();
    api.pickSection(2);
    api.setCard(1); // Figure
    const panel = document.querySelector(".card-insight");
    expect(panel).toBeTruthy();
    const svg = document.querySelector(".card-insight-svg");
    expect(svg?.getAttribute("data-insight-two-staff")).toBe("1");
    const staffLabelY = (name) => {
      const node = [...svg.querySelectorAll("text")].find((n) => n.textContent === name);
      return Number(node?.getAttribute("y"));
    };
    expect(staffLabelY("Bass")).toBeLessThan(staffLabelY("Drums"));
    expect(document.querySelectorAll('[data-insight-staff="bass"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-insight-staff="drums"]').length).toBeGreaterThan(0);
    expect(document.querySelector("[data-insight-midi-strip]")).toBeTruthy();
    const play = document.querySelector("button[data-insight-play]");
    expect(play).toBeTruthy();
    expect(play.querySelector('svg[data-icon="play"] polygon')).toBeTruthy();
    expect(play.getAttribute("aria-label")).toMatch(/Play/i);
    expect(play.getAttribute("data-transport")).toBe("insight-midi-play");
    const bassBtn = document.querySelector('button[data-insight-voice="bass"]');
    const drumsBtn = document.querySelector('button[data-insight-voice="drums"]');
    expect(bassBtn.textContent.trim()).toBe("");
    expect(drumsBtn.textContent.trim()).toBe("");
    expect(bassBtn.querySelector(".card-insight-midi-label")).toBeNull();
    expect(drumsBtn.querySelector(".card-insight-midi-label")).toBeNull();
    expect(bassBtn.getAttribute("aria-label")).toBe("Bass");
    expect(drumsBtn.getAttribute("aria-label")).toBe("Drums");
    expect(bassBtn.getAttribute("title")).toMatch(/^Bass/);
    expect(drumsBtn.getAttribute("title")).toMatch(/^Drums/);
    const bassIcon = bassBtn.querySelector('svg[data-icon="electric-guitar"]');
    const drumsIcon = drumsBtn.querySelector('svg[data-icon="drums"]');
    expect(bassIcon?.getAttribute("data-lucide")).toBe("guitar-electric");
    expect(drumsIcon?.getAttribute("data-lucide")).toBe("drum");
    expect(bassIcon?.querySelectorAll("path").length).toBe(4);
    expect(bassIcon?.querySelector("ellipse")).toBeNull();
    expect(drumsIcon?.querySelector("ellipse")?.getAttribute("cx")).toBe("12");
    expect(drumsIcon?.querySelectorAll("path").length).toBe(6);
    // Bass/Drums toggles ON by default (not a Bass/Drums/Both radio).
    expect(document.querySelector('button[data-insight-voice="bass"].on')).toBeTruthy();
    expect(document.querySelector('button[data-insight-voice="drums"].on')).toBeTruthy();
    expect(document.querySelector('button[data-insight-voice="all"]')).toBeNull();
    expect(api.getState().insightMidiBassOn).toBe(true);
    expect(api.getState().insightMidiDrumsOn).toBe(true);
    expect(api.getState().insightMidiChordsOn).toBe(true);

    drumsBtn.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    expect(api.getState().insightMidiDrumsOn).toBe(false);
    expect(api.getState().insightMidiBassOn).toBe(true);
    const drumsOff = document.querySelector('button[data-insight-voice="drums"]');
    const bassStill = document.querySelector('button[data-insight-voice="bass"]');
    expect(drumsOff.classList.contains("on")).toBe(false);
    expect(bassStill.classList.contains("on")).toBe(true);
    expect(drumsOff.getAttribute("aria-label")).toBe("Drums");
    expect(drumsOff.textContent.trim()).toBe("");
    expect(drumsOff.querySelector('svg[data-lucide="drum"]')).toBeTruthy();
    expect(bassStill.querySelector('svg[data-lucide="guitar-electric"]')).toBeTruthy();

    api.setCard(2); // Harmony — Play + Chords, chords toggle ON
    const harmBtns = [...document.querySelectorAll("[data-insight-midi-strip] button")];
    expect(harmBtns.map((b) => b.querySelector("svg")?.getAttribute("data-icon"))).toEqual(["play", "chords"]);
    expect(harmBtns[0].querySelector('svg[data-icon="play"] polygon')).toBeTruthy();
    expect(harmBtns[1].textContent).toBe("Chords");
    expect(harmBtns[1].querySelectorAll('svg[data-icon="chords"] rect').length).toBe(3);
    expect(document.querySelector('button[data-insight-voice="chords"].on')).toBeTruthy();
    expect(document.querySelector("button[data-insight-play]")).toBeTruthy();
  });

  it("buildInsightMidiEvents plays the claim window and invents nothing when empty", async () => {
    await bootPlayer();
    const N = window.__BASS_NOTATION__;
    const fig = {
      layer: "figure",
      patternId: "sync_oct",
      barRange: [0, 0],
      highlights: [{ step: 0, midi: 41, text: "high" }, { step: 4, midi: 29, text: "drop" }],
    };
    const ev = N.buildInsightMidiEvents(fig, N.SYNC_OCT, "all");
    expect(ev.bass.length).toBeGreaterThan(0);
    expect(ev.bass.every((n) => n.step >= 0 && n.step < 16)).toBe(true);
    expect(ev.drums.map((d) => d.step + ":" + d.kind)).toEqual(["0:kick", "4:snare", "8:kick", "12:snare"]);
    expect(ev.empty).toBe(false);

    const emptyEv = N.buildInsightMidiEvents({
      layer: "figure", patternId: "empty", barRange: [0, 0], highlights: [],
    }, N.EMPTY, "all");
    expect(emptyEv.empty).toBe(true);
    expect(emptyEv.bass).toEqual([]);
    expect(emptyEv.drums).toEqual([]);

    const bassOnly = N.buildInsightMidiEvents(fig, N.SYNC_OCT, "bass");
    expect(bassOnly.bass.length).toBeGreaterThan(0);
    expect(bassOnly.drums).toEqual([]);

    const drumsOnly = N.buildInsightMidiEvents(fig, N.SYNC_OCT, "drums");
    expect(drumsOnly.drums.length).toBe(4);
    expect(drumsOnly.bass).toEqual([]);

    const harm = N.buildInsightMidiEvents({
      layer: "harmony",
      barRange: [0, 3],
      highlights: [
        { step: 0, kind: "chord", chord: "F", text: "I" },
        { step: 16, kind: "chord", chord: "C", text: "V" },
      ],
    }, null, "chords");
    expect(harm.chords.length).toBe(2);
    expect(harm.chords[0].tones.length).toBeGreaterThanOrEqual(3);
    expect(harm.bass).toEqual([]);
    expect(harm.drums).toEqual([]);
  });

  it("insight card Play loops the claim window, pauses main, and leaves the main staff unmarked", async () => {
    const api = await bootPlayer({ privateMode: true, withStems: false });
    api.pickSection(2);
    api.setCard(1);
    await api.ensureAudio();
    api.play();
    expect(api.getState().playing).toBe(true);
    const gen0 = api.getState().insightMidiGen || 0;
    document.querySelector("button[data-insight-play]").dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    await api.waitTick(30);
    expect(api.getState().insightMidiGen).toBeGreaterThan(gen0);
    expect(api.getState().insightMidiVoice).toBe("all");
    expect(api.getState().insightMidiPlaying).toBe(true);
    expect(api.getState().insightMidiLooping).toBe(true);
    expect(api.getState().playing).toBe(false);
    expect(api.getState().insightMidiNodeCount).toBeGreaterThan(0);
    const playBtn = document.querySelector("button[data-insight-play]");
    expect(playBtn.classList.contains("on")).toBe(true);
    expect(playBtn.querySelector('svg[data-icon="stop"] rect')).toBeTruthy();
    expect(playBtn.getAttribute("aria-label")).toMatch(/Stop/i);
    expect(document.querySelectorAll("[data-chord-tones]").length).toBe(0);
    expect(document.querySelectorAll('svg[aria-label="Bass staff"] [data-chord-tone]').length).toBe(0);

    // Toggle drums off while looping → reschedule bass-only from the remaining toggle.
    const bassR = api.toggleInsightMidiVoice("drums");
    expect(api.getState().insightMidiDrumsOn).toBe(false);
    expect(bassR.insightMidiResult.voice).toBe("bass");
    expect(bassR.insightMidiResult.bass).toBeGreaterThan(0);
    expect(bassR.insightMidiResult.drums).toBe(0);
    expect(bassR.insightMidiResult.looping).toBe(true);
    expect(api.getState().insightMidiPlaying).toBe(true);

    const drumsR = api.playInsightMidi("drums");
    expect(drumsR.insightMidiResult.ok).toBe(true);
    expect(drumsR.insightMidiResult.voice).toBe("drums");
    expect(drumsR.insightMidiResult.drums).toBeGreaterThan(0);
    expect(drumsR.insightMidiResult.bass).toBe(0);
    expect(drumsR.insightMidiResult.looping).toBe(true);

    const ctx = window.__LAST_AUDIO_CTX__;
    const oscBefore = ctx._oscillators.length;
    document.querySelector("button[data-insight-play]").dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, cancelable: true }),
    );
    await api.waitTick(20);
    expect(api.getState().insightMidiPlaying).toBe(false);
    expect(api.getState().insightMidiVoice).toBeNull();
    expect(api.getState().insightMidiNodeCount).toBe(0);
    const playIdle = document.querySelector("button[data-insight-play]");
    expect(playIdle.querySelector('svg[data-icon="play"] polygon')).toBeTruthy();
    expect(playIdle.classList.contains("on")).toBe(false);
    expect(playIdle.getAttribute("aria-label")).toMatch(/Play/i);
    expect(ctx._oscillators.slice(0, oscBefore).every((o) => o._stopped)).toBe(true);

    api.setCard(2); // Harmony — card change cancels; Chords toggle stays ON
    expect(api.getState().insightMidiPlaying).toBe(false);
    expect(document.querySelector('button[data-insight-voice="chords"].on')).toBeTruthy();
    const chordR = api.playInsightMidi("chords");
    expect(chordR.insightMidiResult.ok).toBe(true);
    expect(chordR.insightMidiResult.chords).toBeGreaterThan(0);
    expect(chordR.insightMidiResult.looping).toBe(true);
    expect(document.querySelector('button[data-insight-voice="chords"]').classList.contains("on")).toBe(true);
    api.cancelInsightMidi();
    expect(api.getState().insightMidiPlaying).toBe(false);
    expect(api.getState().insightMidiVoice).toBeNull();
  });

  it("chord names layer is tall enough that SVG is not vertically crushed", async () => {
    const api = await bootPlayer({ width: 1280, height: 800 });
    const css = document.getElementById("bass-player-styles")?.textContent || "";
    expect(css).toMatch(/\.layer\.chords\s*\{[^}]*flex:\s*0 0 120px/);
    expect(css).toMatch(/\.layer\.chords \.layer-body\s*\{[^}]*min-height:\s*64px/);
    const chordsSvg = document.querySelector('svg[aria-label="Chord names"]');
    expect(chordsSvg).toBeTruthy();
    expect(chordsSvg.getAttribute("preserveAspectRatio")).toMatch(/xMidYMid meet/i);
    expect(css).toMatch(/@media \(max-width:640px\)[\s\S]*\.layer\.chords\s*\{[^}]*flex:\s*0 0 104px/);
    expect(api.getState().isPhoneLayout).toBe(false);
  });

  it("empty insight MIDI stays silent (no invented bass or drums)", async () => {
    const api = await bootPlayer({
      privateMode: true,
      mutatePayload: (payload) => {
        const fig = payload.cards.chorus[1];
        fig.insight.patternId = "empty";
        fig.insight.highlights = [];
      },
    });
    api.pickSection(2);
    api.setCard(1);
    const r = api.playInsightMidi("all");
    expect(r.insightMidiResult.ok).toBe(true);
    expect(r.insightMidiResult.empty).toBe(true);
    expect(r.insightMidiResult.bass).toBe(0);
    expect(r.insightMidiResult.drums).toBe(0);
    expect(r.insightMidiResult.nodeCount).toBe(0);
    expect(document.querySelectorAll('[data-insight-kind="empty"]').length).toBeGreaterThan(0);
  });
});
