
/* Bass Study player shell — port of locked canvas mockup (Like a Prayer). No canvas kit. */
(function () {
  "use strict";

  const CAT = ["#3b82f6","#22c55e","#a855f7","#f59e0b","#06b6d4","#ef4444","#84cc16","#64748b"];
  const NEG = "#ef4444";
  const X0 = 52, W = 900, VBW = X0 + W + 8;
  const DRAG_THRESHOLD_PX = 8;
  const LEFT_RESTART_THRESHOLD_S = 0.25;
  const OPEN = [43, 38, 33, 28];
  const STRING_NAMES = ["G", "D", "A", "E"];
  const PC = [[0,0],[1,-1],[1,0],[2,-1],[2,0],[3,0],[4,-1],[4,0],[5,-1],[5,0],[6,-1],[6,0]];

  // Pitch-preserving tempo (WSOLA). Mirrors src/timestretch.mjs — keep in sync.
  // AudioBufferSourceNode.playbackRate alone ALWAYS shifts pitch; do not use it for "slow without pitch change".
  function stretchChannel(input, tempo, sampleRate, options) {
    options = options || {};
    const t = Number(tempo);
    if (!(t > 0) || !Number.isFinite(t)) throw new Error("tempo must be a positive finite number");
    const src = input instanceof Float32Array ? input : Float32Array.from(input);
    if (src.length === 0) return new Float32Array(0);
    if (Math.abs(t - 1) < 1e-9) return Float32Array.from(src);
    const sr = sampleRate > 0 ? sampleRate : 44100;
    const frameLen = options.frameLen || Math.max(64, Math.round(sr * 0.025));
    const seekWin = options.seekWin != null ? options.seekWin : Math.max(0, Math.round(sr * 0.012));
    const synthHop = options.synthHop || Math.max(1, Math.floor(frameLen / 2));
    const analHop = Math.max(1, Math.round(synthHop * t));
    const outLen = Math.max(frameLen, Math.ceil(src.length / t) + frameLen);
    const output = new Float32Array(outLen);
    const weight = new Float32Array(outLen);
    const window = new Float32Array(frameLen);
    for (let i = 0; i < frameLen; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frameLen - 1 || 1));
    let readPos = 0, writePos = 0, first = true;
    while (writePos + frameLen < outLen && readPos + frameLen <= src.length) {
      let usePos = readPos;
      if (!first && seekWin > 0 && writePos > 0) {
        const searchStart = Math.max(0, readPos - seekWin);
        const searchEnd = Math.min(src.length - frameLen, readPos + seekWin);
        const overlapLen = Math.min(synthHop, writePos, frameLen);
        let bestCorr = -Infinity, bestPos = readPos;
        for (let cand = searchStart; cand <= searchEnd; cand++) {
          let corr = 0;
          for (let i = 0; i < overlapLen; i++) corr += output[writePos - overlapLen + i] * src[cand + i];
          if (corr > bestCorr) { bestCorr = corr; bestPos = cand; }
        }
        usePos = bestPos;
      }
      for (let i = 0; i < frameLen; i++) {
        const w = window[i];
        const si = usePos + i;
        if (si >= src.length) break;
        output[writePos + i] += src[si] * w;
        weight[writePos + i] += w;
      }
      readPos = usePos + analHop;
      writePos += synthHop;
      first = false;
    }
    const exactLen = Math.max(1, Math.round(src.length / t));
    const trimmed = new Float32Array(exactLen);
    for (let i = 0; i < exactLen; i++) {
      const w = weight[i];
      trimmed[i] = w > 1e-8 ? output[i] / w : output[i];
    }
    return trimmed;
  }
  function stretchAudioBuffer(buffer, tempo, createBuffer, options) {
    options = options || {};
    const t = Number(tempo);
    if (!(t > 0) || !Number.isFinite(t)) throw new Error("tempo must be a positive finite number");
    if (Math.abs(t - 1) < 1e-9) return buffer;
    const chans = buffer.numberOfChannels || 1;
    const sr = buffer.sampleRate || 44100;
    const stretched = [];
    for (let c = 0; c < chans; c++) stretched.push(stretchChannel(buffer.getChannelData(c), t, sr, options));
    const len = stretched[0].length;
    const out = createBuffer(chans, len, sr);
    for (let c = 0; c < chans; c++) {
      const dest = out.getChannelData(c);
      dest.set(stretched[c].subarray(0, Math.min(dest.length, stretched[c].length)));
    }
    return out;
  }
  function stemTempoUsesRawPlaybackRate() { return false; }


  const eighths = (ms, off) => ms.map((m, i) => ({ step: off + i * 2, midi: m }));
  const B7_BAR = [[0,38],[2,38],[3,36],[4,38],[6,38],[8,38],[10,38],[11,36],[12,38],[14,38]];
  // Chorus groove from bass-stem measurement: high→low octave drop + syncopated 16ths (~6 hits/bar), not straight 8th octaves.
  // Concert/sounding midis. midi 24 (C1) is below open E (28) on a 4-string — keep C2 (36) for that drop hit.
  const SYNC_OCT = { id: "sync_oct", name: "Syncopated octave drop", notes: [
    {step:0,midi:41},{step:4,midi:29},{step:6,midi:29},{step:8,midi:29},{step:11,midi:41},{step:13,midi:29},{step:15,midi:36},
    {step:16,midi:36},{step:20,midi:36},{step:22,midi:36},{step:24,midi:36},{step:27,midi:36},{step:30,midi:33}
  ] };
  const WALK = { id: "walk", name: "A–C–D ascending walk", notes: [
    {step:0,midi:33},{step:4,midi:33},{step:6,midi:36},{step:8,midi:38},{step:12,midi:38},{step:14,midi:40},
    {step:16,midi:41},{step:20,midi:29},{step:22,midi:29},{step:24,midi:29},{step:27,midi:41},{step:30,midi:36}
  ] };
  const OCT = SYNC_OCT; // back-compat alias
  const DESC = WALK;
  const B7 = { id: "b7", name: "Root-b7 16ths", notes: [...B7_BAR.map(n=>({step:n[0],midi:n[1]})), ...B7_BAR.map(n=>({step:n[0]+16,midi:n[1]}))] };
  const PEDAL = { id: "pedal", name: "Pedal point on D", notes: [...eighths([38,38,38,38,38,38,38,38],0), ...eighths([38,38,38,38,38,38,38,38],16)] };
  const TURN = { id: "turn", name: "Shifted root-5-8 turnaround", notes: [...eighths([36,43,48,43,36,43,48,43],0), ...eighths([34,41,46,41,34,41,46,41],16)] };
  // Verse 2 (Miley live): bass+drums stems are acoustically silent — show rests, do not invent TURN / backbeat.
  const EMPTY = { id: "empty", name: "Rest (rhythm section out)", notes: [] };
  const PATS = { intro:[PEDAL], verse:[PEDAL], chorus:[OCT,DESC], bridge:[B7,PEDAL], vamp:[B7,OCT], tag:[B7], ah:[B7], v1:[PEDAL], c1:[OCT,DESC], v2:[EMPTY], c2:[OCT,DESC], v3:[PEDAL,B7], br:[B7,PEDAL] };

  const CARDS = {
    intro: [
      { label: "Pocket", body: "Kit is out at the top — no kick/snare/hats under the fade; staff shows rests until the groove enters." },
      { label: "Figure", body: "D pedal with an A–A–D–D pickup into the verse — tonic stated before the vocal." },
      { label: "Harmony", body: "Dm (i). The A→D pickup is a miniature V→i push." },
      { label: "Missable", body: "Leave air on purpose: bass alone carries the open until the kit lands — empty kit is vocabulary, not a gap to fill." },
    ],
    verse: [
      {
        label: "Pocket",
        body: "Straight backbeat locks the grid: kick 1+3, snare 2+4, hat on every 8th — bass sits on that kick frame.",
        insight: {
          layer: "pocket",
          patternId: "pedal",
          title: "Kick locks the grid",
          barRange: [0, 0],
          highlights: [
            { step: 0, kind: "kick", text: "kick on 1" },
            { step: 8, kind: "kick", text: "kick on 3" },
            { step: 4, kind: "snare", text: "snare 2" },
            { step: 12, kind: "snare", text: "snare 4" },
          ],
        },
      },
      {
        label: "Figure",
        body: "Mostly D pedal, with C as flat-seven color. Pedal keeps the vocal roomy.",
        insight: {
          layer: "figure",
          patternId: "pedal",
          title: "D pedal · C as color",
          barRange: [0, 0],
          highlights: [
            { step: 0, midi: 38, text: "this note — D pedal" },
            { step: 8, midi: 38, text: "holds the grid" },
            { step: 14, midi: 38, text: "still on D" },
          ],
        },
      },
      { label: "Harmony", body: "Dm / C / Gm / Bb territory in D minor (i, bVII, iv, bVI) — estimates; bass stays near the tonic." },
      { label: "Missable", body: "Bass stays simple so the lyric carries; lift comes from the bVII, not busyness." },
    ],
    v1: [
      {
        label: "Pocket",
        body: "Drums stay out through most of Verse 1 (stem-silent). Kit enters on the last bar as a pickup into the chorus — do not invent a full 8th-hat grid earlier.",
      },
      {
        label: "Figure",
        body: "Mostly D pedal under the vocal — bass is present while the kit is still out.",
      },
      { label: "Harmony", body: "Dm / C / Gm / Bb territory in D minor (i, bVII, iv, bVI) — estimates." },
      { label: "Missable", body: "Thin on purpose: bass + vocal first, then the kit slams the door into Chorus 1." },
    ],
    v2: [
      {
        label: "Pocket",
        body: "Rhythm section out — no kick, snare, or hats under the vocal. Staff shows rests, not a ghost backbeat.",
        insight: {
          layer: "pocket",
          patternId: "empty",
          title: "Rhythm section out",
          barRange: [0, 0],
          highlights: [],
        },
      },
      {
        label: "Figure",
        body: "Bass is out with the drums. Leave the tab/staff empty (rests) — do not invent a turnaround here.",
        insight: {
          layer: "figure",
          patternId: "empty",
          title: "Empty",
          barRange: [0, 0],
          highlights: [],
        },
      },
      {
        label: "Harmony",
        body: "Chords still move (Bb / F / C / Dm color) under the vocal; no bass statement of the roots.",
      },
      {
        label: "Missable",
        body: "Intentional dropout: voice and pads carry Verse 2 until kit and bass slam back for Chorus 2 — empty is the insight.",
      },
    ],
    chorus: [
      {
        label: "Pocket",
        body: "Kick on 1 and 3; bass drop on the & of 1 sits against the kick, and a late pickup on the e of 3 pushes into the next chord.",
        insight: {
          layer: "pocket",
          patternId: "sync_oct",
          title: "Against kick",
          barRange: [0, 0],
          highlights: [
            { step: 0, kind: "kick", text: "kick on 1" },
            { step: 4, kind: "bass", midi: 29, text: "bass drop against kick" },
            { step: 8, kind: "kick", text: "kick on 3" },
            { step: 11, kind: "bass", midi: 41, text: "late pickup" },
          ],
        },
      },
      {
        label: "Figure",
        body: "Syncopated high→low octave drop on the roots (~6 hits/bar) with late pickups into the next chord — not straight 8th octaves.",
        insight: {
          layer: "figure",
          patternId: "sync_oct",
          title: "Syncopated octave drop",
          barRange: [0, 0],
          highlights: [
            { step: 0, midi: 41, text: "this note — high F" },
            { step: 4, midi: 29, text: "octave drop" },
            { step: 11, midi: 41, text: "late pickup" },
            { step: 15, midi: 36, text: "into next chord" },
          ],
        },
      },
      {
        label: "Harmony",
        body: "F–C–Bb–Dm reads I–V–IV–vi in F (or bIII–bVII–bVI–i in Dm); bass states roots with an octave drop, not a walking line.",
        insight: {
          layer: "harmony",
          title: "Chorus loop in F",
          barRange: [0, 3],
          highlights: [
            { step: 0, kind: "chord", text: "F = I", chord: "F" },
            { step: 16, kind: "chord", text: "C = V", chord: "C" },
            { step: 32, kind: "chord", text: "Bb = IV", chord: "Bb" },
            { step: 48, kind: "chord", text: "Dm = vi", chord: "Dm" },
          ],
        },
      },
      {
        label: "Missable",
        body: "Easy to misread as straight 8th octaves — count ~6 hits/bar; the reattack after the drop is the trap.",
        insight: {
          layer: "missable",
          patternId: "sync_oct",
          title: "Not straight 8ths",
          barRange: [0, 0],
          highlights: [
            { step: 0, midi: 41, text: "this note" },
            { step: 4, midi: 29, text: "octave drop" },
            { step: 6, midi: 29, text: "reattack" },
            { step: 11, midi: 41, text: "this pattern" },
          ],
        },
      },
    ],
    ah: [
      { label: "Pocket", body: "Backbeat with busier 16th-hat surface; kick/snare stay put while hats climb." },
      { label: "Figure", body: "One-chord Dm vamp — D with C passing. Energy from rhythm, not changes." },
      { label: "Harmony", body: "Static i. Passing C/F in the bass are color, not real chord moves." },
      { label: "Missable", body: "Build without leaving Dm; hats and dynamics do the climb — do not invent a new progression." },
    ],
    bridge: [
      { label: "Pocket", body: "16th hats over the same kick 1+3 / snare 2+4 grid; bass pushes sit against that backbeat." },
      { label: "Figure", body: "Root–b7 16ths on D; pushes on the & of 1 and 3 syncopate the backbeat." },
      { label: "Harmony", body: "Dm pedal with C/D color, then a short turnaround into the loop." },
      { label: "Missable", body: "Motion lives in the bass subdivisions while harmony holds still — easy to overplay chords that are not moving." },
    ],
    vamp: [
      { label: "Pocket", body: "Chorus backbeat with busier hats — extra energy on the kit while bass keeps the pocket." },
      { label: "Figure", body: "Same chorus octave-drop groove on F–C–Bb–Dm; leave space for the hats." },
      { label: "Harmony", body: "Same chorus loop again; Bb→Dm turns the phrase back to the top." },
      { label: "Missable", body: "Bass anchors; vocal and hats carry the lift — do not thicken the figure just because hats get busy." },
    ],
    tag: [
      { label: "Pocket", body: "16th-hat backbeat into the hard cut." },
      { label: "Figure", body: "Back to the Dm pedal and b7 motion — settle on tonic." },
      { label: "Harmony", body: "Dm = i, with a brief Ab flavor in the estimate. Ends on i." },
      { label: "Missable", body: "Close the circle: same tonic the song opened on — resist inventing a final fill." },
    ],
  };

  function tabPos(m) {
    let best = { s: 3, f: 99 };
    for (let i = 0; i < 4; i++) {
      const f = m - OPEN[i];
      if (f >= 0 && f < best.f) best = { s: i, f };
    }
    // Below open E (or otherwise unmappable): clamp to open E rather than invent a fret.
    return best.f === 99 ? { s: 3, f: 0, clamped: true } : best;
  }

  // Bass guitar convention: notation is written one octave above sounding (concert) pitch.
  const WRITTEN_OCTAVE = 12;

  function staffPos(soundingMidi) {
    const m = soundingMidi + WRITTEN_OCTAVE;
    const pc = PC[((m % 12) + 12) % 12];
    const oct = Math.floor(m / 12) - 1;
    return { pos: oct * 7 + pc[0] - 18, flat: pc[1] < 0, writtenMidi: m };
  }

  // Staff lines at pos 0,2,4,6,8. Padding keeps ±1–2 ledger lines inside viewBox height 100.
  function staffYy(pos) {
    return 72 - pos * 5.2;
  }

  /** Parse demo.timeSig like "4/4" → { num, den, label }. */
  function parseTimeSig(raw) {
    if (raw == null) return { num: 4, den: 4, label: "4/4" };
    const s = String(raw).trim();
    const m = s.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) return { num: 4, den: 4, label: s || "4/4" };
    return { num: Number(m[1]), den: Number(m[2]), label: m[1] + "/" + m[2] };
  }

  // Bass-clef staff positions for key-signature accidentals (pos matches staffYy).
  const BASS_SHARP_POS = [6, 3, 7, 4, 1, 5, 2]; // F C G D A E B
  const BASS_FLAT_POS = [2, 5, 8, 4, 7, 3, 6]; // B E A D G C F
  const MAJOR_SHARP_COUNT = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7 };
  const MAJOR_FLAT_COUNT = { C: 0, F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7 };
  const MINOR_SHARP_COUNT = { A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7 };
  const MINOR_FLAT_COUNT = { A: 0, D: 1, G: 2, C: 3, F: 4, Bb: 5, Eb: 6, Ab: 7 };

  /**
   * Key signature from demo.keys / key (e.g. "Em", "Dm/F", "Ab").
   * Returns { label, kind: "sharp"|"flat"|"none", count, positions: number[] }.
   * Drums/percussion omit key sig — callers decide.
   */
  function keySigFromKeys(raw) {
    if (raw == null || raw === "") {
      return { label: "C", kind: "none", count: 0, positions: [] };
    }
    const head = String(raw).trim().split(/[\/\s,|]/)[0].trim();
    const m = head.match(/^([A-Ga-g])([#b♯♭]?)(m|min|minor|maj|major)?$/i);
    if (!m) {
      return { label: head || "C", kind: "none", count: 0, positions: [] };
    }
    const letter = m[1].toUpperCase();
    let acc = m[2] || "";
    if (acc === "♯") acc = "#";
    if (acc === "♭") acc = "b";
    const tonic = letter + acc;
    const qual = (m[3] || "").toLowerCase();
    const minor = qual === "m" || qual === "min" || qual === "minor";
    let count = 0;
    let kind = "none";
    if (minor) {
      if (Object.prototype.hasOwnProperty.call(MINOR_SHARP_COUNT, tonic)) {
        count = MINOR_SHARP_COUNT[tonic];
        kind = count ? "sharp" : "none";
      } else if (Object.prototype.hasOwnProperty.call(MINOR_FLAT_COUNT, tonic)) {
        count = MINOR_FLAT_COUNT[tonic];
        kind = count ? "flat" : "none";
      }
    } else {
      if (Object.prototype.hasOwnProperty.call(MAJOR_SHARP_COUNT, tonic)) {
        count = MAJOR_SHARP_COUNT[tonic];
        kind = count ? "sharp" : "none";
      } else if (Object.prototype.hasOwnProperty.call(MAJOR_FLAT_COUNT, tonic)) {
        count = MAJOR_FLAT_COUNT[tonic];
        kind = count ? "flat" : "none";
      }
    }
    const positions = kind === "sharp"
      ? BASS_SHARP_POS.slice(0, count)
      : kind === "flat"
        ? BASS_FLAT_POS.slice(0, count)
        : [];
    return { label: tonic + (minor ? "m" : ""), kind, count, positions };
  }

  /** Draw stacked time signature (num/den) into an SVG group. Returns next x. */
  function appendTimeSignature(svg, x, yNum, yDen, timeSig, ink, fontSize) {
    const ts = typeof timeSig === "object" && timeSig ? timeSig : parseTimeSig(timeSig);
    const fs = fontSize || 15;
    const g = svgEl("g", {
      "data-time-sig": ts.label,
      "aria-label": "Time signature " + ts.label,
    });
    g.appendChild(svgEl("text", {
      x: x, y: yNum, "font-size": fs, "font-weight": "700",
      fill: ink, "text-anchor": "middle", "font-family": "Georgia, 'Times New Roman', serif",
    }, [document.createTextNode(String(ts.num))]));
    g.appendChild(svgEl("text", {
      x: x, y: yDen, "font-size": fs, "font-weight": "700",
      fill: ink, "text-anchor": "middle", "font-family": "Georgia, 'Times New Roman', serif",
    }, [document.createTextNode(String(ts.den))]));
    svg.appendChild(g);
    return x + fs * 0.85;
  }

  /** Draw bass-clef key signature accidentals. Returns next x after glyphs (or x if none). */
  function appendKeySignature(svg, x, keySig, yyFn, ink) {
    const ks = keySig && typeof keySig === "object" ? keySig : keySigFromKeys(keySig);
    if (!ks || ks.kind === "none" || !ks.count) {
      return x;
    }
    const g = svgEl("g", {
      "data-key-sig": ks.label,
      "data-key-kind": ks.kind,
      "data-key-count": String(ks.count),
      "aria-label": "Key signature " + ks.label,
    });
    const glyph = ks.kind === "sharp" ? "♯" : "♭";
    const step = ks.kind === "sharp" ? 5.5 : 5.2;
    const fs = ks.kind === "sharp" ? 14 : 16;
    ks.positions.forEach((pos, i) => {
      const cx = x + i * step;
      const cy = yyFn(pos) + (ks.kind === "sharp" ? 4.5 : 5);
      g.appendChild(svgEl("text", {
        x: cx, y: cy, "font-size": fs, fill: ink,
        "text-anchor": "middle",
        "font-family": "Georgia, 'Times New Roman', serif",
        "data-accidental": ks.kind,
        "data-acc-index": String(i),
      }, [document.createTextNode(glyph)]));
    });
    svg.appendChild(g);
    return x + ks.count * step + 2;
  }


  function noteDurationSteps(notes, index, barSteps) {
    const bs = barSteps == null ? 16 : barSteps;
    const note = notes[index];
    // Acoustic length: to next onset (may cross barlines). Optional note.dur wins when shorter/equal.
    let next = null;
    for (let j = index + 1; j < notes.length; j++) {
      if (notes[j].step > note.step) {
        next = notes[j].step;
        break;
      }
    }
    let dur;
    if (next == null) {
      const barEnd = Math.floor(note.step / bs) * bs + bs;
      dur = Math.max(1, barEnd - note.step);
    } else {
      dur = Math.max(1, next - note.step);
    }
    if (Number.isFinite(note.dur) && note.dur > 0) {
      dur = Math.max(1, Math.min(dur, note.dur | 0));
    }
    return dur;
  }

  function durationStyle(steps) {
    const d = Math.max(1, steps | 0);
    if (d >= 16) return { unit: 16, dots: 0, label: "whole" };
    if (d >= 12) return { unit: 8, dots: 1, label: "dotted-half" };
    if (d >= 8) return { unit: 8, dots: 0, label: "half" };
    if (d >= 6) return { unit: 4, dots: 1, label: "dotted-quarter" };
    if (d >= 4) return { unit: 4, dots: 0, label: "quarter" };
    if (d >= 3) return { unit: 2, dots: 1, label: "dotted-eighth" };
    if (d >= 2) return { unit: 2, dots: 0, label: "eighth" };
    return { unit: 1, dots: 0, label: "sixteenth" };
  }

  function notatedStepsOf(style) {
    return style.unit + (style.dots ? style.unit / 2 : 0);
  }

  /** True when this onset is a notation tie continuation (held), not a re-attack. */
  function isTieContinuation(note, prev) {
    if (!note || !prev) return false;
    if (note.midi !== prev.midi) return false;
    if (note.tied === true || note.tie === true || note.attack === false) return true;
    // Acoustic sustain covering this step (analysis dur on the prior onset).
    if (Number.isFinite(prev.dur) && prev.dur > 0 && prev.step + prev.dur > note.step) return true;
    return false;
  }

  const TIE_UNITS = [16, 12, 8, 6, 4, 3, 2, 1];

  /**
   * Split a sustained duration into engraved noteheads with ties:
   * always at barlines; within a bar when one durationStyle cannot express the length.
   */
  function splitTiedSegments(step, dur, barSteps) {
    const bs = barSteps == null ? 16 : barSteps;
    const out = [];
    let s = step;
    let rem = Math.max(1, dur | 0);
    while (rem > 0) {
      const barEnd = Math.floor(s / bs) * bs + bs;
      const room = Math.min(rem, barEnd - s);
      let left = room;
      let at = s;
      while (left > 0) {
        let take = 1;
        for (let i = 0; i < TIE_UNITS.length; i++) {
          const cand = TIE_UNITS[i];
          if (cand > left) continue;
          // Prefer values whose notated length matches exactly.
          if (notatedStepsOf(durationStyle(cand)) !== cand) continue;
          take = cand;
          break;
        }
        out.push({ step: at, dur: take });
        at += take;
        left -= take;
      }
      rem -= room;
      s += room;
    }
    return out;
  }

  function restsForGap(from, to) {
    const out = [];
    let s = from;
    while (s < to) {
      const remain = to - s;
      let dur;
      if (s % 16 === 0 && remain >= 16) dur = 16;
      else if (s % 8 === 0 && remain >= 8) dur = 8;
      else if (s % 4 === 0 && remain >= 4) dur = 4;
      else if (s % 2 === 0 && remain >= 2) {
        const toBeat = 4 - (s % 4);
        dur = Math.min(2, toBeat, remain);
      } else {
        dur = 1;
      }
      if (dur > remain) dur = remain;
      out.push({ type: "rest", step: s, dur, style: durationStyle(dur) });
      s += dur;
    }
    return out;
  }

  function buildRhythmVoice(notes, totalSteps) {
    const sorted = notes.slice().sort((a, b) => a.step - b.step || a.midi - b.midi);
    const uniq = [];
    for (let i = 0; i < sorted.length; i++) {
      if (uniq.length && uniq[uniq.length - 1].step === sorted[i].step) continue;
      uniq.push(sorted[i]);
    }
    // Collapse tie-continuations into the prior same-pitch attack (keep split points for engraving).
    const logical = [];
    for (let i = 0; i < uniq.length; i++) {
      const n = uniq[i];
      const prev = logical.length ? logical[logical.length - 1] : null;
      if (prev && isTieContinuation(n, prev)) {
        if (!prev._tieAt) prev._tieAt = [];
        prev._tieAt.push(n.step);
        // Extend explicit dur if continuation carries one.
        if (Number.isFinite(n.dur) && n.dur > 0) {
          const through = n.step + (n.dur | 0);
          const curEnd = prev.step + (Number.isFinite(prev.dur) ? prev.dur : 0);
          if (!Number.isFinite(prev.dur) || through > curEnd) prev.dur = through - prev.step;
        }
        continue;
      }
      logical.push(Object.assign({}, n));
    }
    const events = [];
    let cursor = 0;
    for (let i = 0; i < logical.length; i++) {
      const n = logical[i];
      if (n.step < cursor) continue;
      if (n.step > cursor) {
        const rests = restsForGap(cursor, n.step);
        for (let r = 0; r < rests.length; r++) events.push(rests[r]);
      }
      const dur = noteDurationSteps(logical, i, 16);
      const forceAt = (n._tieAt || []).filter((t) => t > n.step && t < n.step + dur);
      // Split at barlines / non-notatable spans, then ensure forced tie-break points.
      let segs = splitTiedSegments(n.step, dur, 16);
      if (forceAt.length) {
        const cuts = new Set(forceAt);
        const refined = [];
        for (let s = 0; s < segs.length; s++) {
          let seg = segs[s];
          const end = seg.step + seg.dur;
          const inner = forceAt.filter((t) => t > seg.step && t < end).sort((a, b) => a - b);
          if (!inner.length) {
            refined.push(seg);
            continue;
          }
          let from = seg.step;
          for (let k = 0; k < inner.length; k++) {
            refined.push({ step: from, dur: inner[k] - from });
            from = inner[k];
          }
          refined.push({ step: from, dur: end - from });
        }
        segs = refined;
      }
      for (let s = 0; s < segs.length; s++) {
        const seg = segs[s];
        let tie = null;
        if (segs.length > 1) {
          if (s === 0) tie = "start";
          else if (s === segs.length - 1) tie = "end";
          else tie = "mid";
        }
        events.push({
          type: "note",
          step: seg.step,
          dur: seg.dur,
          midi: n.midi,
          style: durationStyle(seg.dur),
          tie: tie,
          attack: s === 0,
        });
      }
      cursor = n.step + dur;
    }
    if (cursor < totalSteps) {
      const rests = restsForGap(cursor, totalSteps);
      for (let r = 0; r < rests.length; r++) events.push(rests[r]);
    }
    return events;
  }

  function beamGroups(noteEvents) {
    const groups = [];
    let i = 0;
    while (i < noteEvents.length) {
      const e = noteEvents[i];
      if (e.style.unit > 2) {
        groups.push([e]);
        i++;
        continue;
      }
      const beat = Math.floor(e.step / 4);
      const group = [e];
      let j = i + 1;
      while (j < noteEvents.length) {
        const n = noteEvents[j];
        if (Math.floor(n.step / 4) !== beat) break;
        if (n.style.unit > 2) break;
        const prev = group[group.length - 1];
        if (n.step !== prev.step + prev.dur) break;
        group.push(n);
        j++;
      }
      groups.push(group);
      i = j;
    }
    return groups;
  }


  /** Draw SVG tie curves for note events that carry tie start/mid → mid/end. */
  function appendBassTiePaths(svg, noteEvents, sx, yy, ink) {
    const tiedNotes = noteEvents.filter((e) => e && e.type === "note" && e.tie);
    for (let ti = 0; ti < tiedNotes.length - 1; ti++) {
      const a = tiedNotes[ti];
      const b = tiedNotes[ti + 1];
      if (a.midi !== b.midi) continue;
      if (a.tie !== "start" && a.tie !== "mid") continue;
      if (b.tie !== "end" && b.tie !== "mid") continue;
      if (a.step + a.dur !== b.step) continue;
      const spa = staffPos(a.midi);
      const x1 = sx(a.step) + 5;
      const x2 = sx(b.step) - 5;
      const y = yy(spa.pos) + (spa.pos < 4 ? 8 : -8);
      const arch = spa.pos < 4 ? 7 : -7;
      const midX = (x1 + x2) / 2;
      const d = "M" + x1 + " " + y + " Q " + midX + " " + (y + arch) + " " + x2 + " " + y;
      svg.appendChild(svgEl("path", {
        d: d,
        fill: "none",
        stroke: ink || "#e5e7eb",
        "stroke-width": 1.4,
        "stroke-linecap": "round",
        "data-rhythm": "tie",
        "data-tie-from": String(a.step),
        "data-tie-to": String(b.step),
        "data-midi": String(a.midi),
      }));
    }
  }

  /**
   * Procedural backbeat hits (legacy LAP invent). Dead/test helper only —
   * never called from drumHitsForView / staff / MIDI player paths.
   */
  function buildDrumHits(nBars, hat16, opts) {
    if (opts && (opts.empty || opts.silent)) return [];
    const hits = [];
    for (let bar = 0; bar < nBars; bar++) {
      const base = bar * 16;
      hits.push({ step: base, kind: "kick", midi: 36 }, { step: base + 8, kind: "kick", midi: 36 });
      hits.push({ step: base + 4, kind: "snare", midi: 38 }, { step: base + 12, kind: "snare", midi: 38 });
      const hatSteps = hat16
        ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
        : [0, 2, 4, 6, 8, 10, 12, 14];
      for (let h = 0; h < hatSteps.length; h++) {
        hits.push({ step: base + hatSteps[h], kind: "hat", midi: 42 });
      }
    }
    return hits;
  }

  const DRUM_MIDI = { kick: 36, snare: 38, hat: 42 };

  /**
   * Normalize per-song drum transcription from demo-data / resource.
   * Accepts demo.drumHits | demo.drums.hits | demo.drums — array of
   * { bar, step, kind, midi? } (bar absolute, step 0–15 within bar).
   */
  function normalizeSongDrumHits(demoOrHits) {
    let raw = null;
    if (Array.isArray(demoOrHits)) raw = demoOrHits;
    else if (demoOrHits && typeof demoOrHits === "object") {
      if (Array.isArray(demoOrHits.drumHits)) raw = demoOrHits.drumHits;
      else if (demoOrHits.drums && Array.isArray(demoOrHits.drums.hits)) raw = demoOrHits.drums.hits;
      else if (Array.isArray(demoOrHits.drums)) raw = demoOrHits.drums;
      else if (Array.isArray(demoOrHits.hits)) raw = demoOrHits.hits;
    }
    if (!Array.isArray(raw) || !raw.length) return null;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const h = raw[i];
      if (!h || typeof h !== "object") continue;
      const bar = Number(h.bar);
      const step = Number(h.step);
      const kind = String(h.kind || "").toLowerCase();
      if (!Number.isFinite(bar) || bar < 0) continue;
      if (!Number.isFinite(step) || step < 0 || step > 15) continue;
      if (kind !== "kick" && kind !== "snare" && kind !== "hat") continue;
      const midi = Number.isFinite(Number(h.midi)) ? Number(h.midi) : DRUM_MIDI[kind];
      out.push({ bar: Math.floor(bar), step: Math.floor(step), kind, midi });
    }
    return out.length ? out : null;
  }

  /** Map absolute song hits into view-relative {step, kind, midi} for nBars starting at viewLo. */
  function songDrumHitsForView(songHits, nBars, viewLo) {
    if (!songHits || !songHits.length) return null;
    const lo = Number(viewLo) || 0;
    const n = Number(nBars) || 0;
    const out = [];
    for (let i = 0; i < songHits.length; i++) {
      const h = songHits[i];
      if (h.bar < lo || h.bar >= lo + n) continue;
      out.push({
        step: (h.bar - lo) * 16 + h.step,
        kind: h.kind,
        midi: h.midi || DRUM_MIDI[h.kind] || 42,
      });
    }
    return out;
  }

  /** Staff subtitle from actual hits (avoid claiming "8th hats" when song kit differs). */
  function drumHatLabel(hits, hat16Fallback) {
    if (!hits || !hits.length) return hat16Fallback ? "16th hats" : "8th hats";
    const byBar = new Map();
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (h.kind !== "hat") continue;
      const b = Math.floor(h.step / 16);
      if (!byBar.has(b)) byBar.set(b, new Set());
      byBar.get(b).add(h.step % 16);
    }
    if (!byBar.size) return "kit";
    let sum = 0;
    byBar.forEach((s) => { sum += s.size; });
    const avg = sum / byBar.size;
    if (avg >= 14) return "16th hats";
    if (avg >= 7) return "8th hats";
    if (avg >= 3.5) return "quarter hats";
    return "kit";
  }

  /** True when the section pattern has no notes (stem-verified silence → rests, not invented grooves). */
  function isRhythmOut(pat) {
    if (!pat) return false;
    if (pat.id === "empty" || pat.id === "rest" || pat.id === "silent") return true;
    return !Array.isArray(pat.notes) || pat.notes.length === 0;
  }

  /** Drums-out independent of bass: section/pattern flag (bass may still be PEDAL). */
  function isDrumsOut(sec, pat) {
    if (isRhythmOut(pat)) return true;
    if (pat && (pat.drumsOut === true || pat.drums_out === true)) return true;
    if (sec && (sec.drumsOut === true || sec.drums_out === true)) return true;
    return false;
  }

  /** Inclusive [[lo, hi], ...] bar ranges where the drums stem is silent. */
  function normalizeDrumsOutBars(demoOrBars) {
    const raw = Array.isArray(demoOrBars)
      ? demoOrBars
      : (demoOrBars && (demoOrBars.drumsOutBars || demoOrBars.drums_out_bars)) || null;
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      if (!Array.isArray(r) || r.length < 2) continue;
      const a = Number(r[0]);
      const b = Number(r[1]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      out.push([Math.min(a, b), Math.max(a, b)]);
    }
    return out;
  }

  function isBarDrumsSilent(bar, drumsOutBars) {
    if (!drumsOutBars || !drumsOutBars.length) return false;
    for (let i = 0; i < drumsOutBars.length; i++) {
      const a = drumsOutBars[i][0];
      const b = drumsOutBars[i][1];
      if (bar >= a && bar <= b) return true;
    }
    return false;
  }

  /**
   * Drum hits for a staff/MIDI view. Uses per-song drumHits only.
   * No song hits → empty (rests), same as drums-out — never invent a default grid.
   * Supports full drums-out and per-bar silence (drumsOutBars).
   */
  function drumHitsForView(nBars, hat16, viewLo, opts) {
    const o = opts || {};
    if (o.empty || o.silent || o.rhythmOut || o.drumsOut) return [];
    const lo = Number(viewLo) || 0;
    const song = o.drumHits || o.songHits || null;
    let hits = [];
    if (song && song.length) {
      const mapped = songDrumHitsForView(song, nBars, lo);
      hits = mapped || [];
    }
    // No invent fallback: missing/empty song hits → rests.
    const ranges = o.drumsOutBars || [];
    if (!ranges.length) return hits;
    return hits.filter((h) => !isBarDrumsSilent(lo + Math.floor(h.step / 16), ranges));
  }

  /** Plain clear electric/acoustic-like bass MIDI voice (not harsh saw/square grit).
   *  Fundamental sine + quieter +12st layer so the line reads clearly without grit. */
  const BASS_MIDI_VOICE = {
    oscType: "sine",
    filterType: "lowpass",
    filterFreq: 1200,
    filterQ: 0.7,
    peakGain: 0.16,
    octaveSemitones: 12,
    octaveGain: 0.07,
    attack: 0.018,
    release: 0.06,
    minDur: 0.08,
  };

  /** Soft clear chord-pad voice (sine, gentle LP) — not harsh synth grit. */
  const CHORD_MIDI_VOICE = {
    oscType: "sine",
    filterType: "lowpass",
    filterFreq: 2200,
    filterQ: 0.5,
    peakGain: 0.05,
    attack: 0.035,
    release: 0.14,
    minDur: 0.18,
  };
  const SOUNDING_HL = "#60a5fa";

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (Number(midi) - 69) / 12);
  }

  /** Tile a ≤2-bar pattern across nBars (same tiling as tab/staff). */
  function expandPatternNotes(pat, nBars) {
    const notes = [];
    const srcNotes = (pat && Array.isArray(pat.notes)) ? pat.notes : [];
    for (let b = 0; b < nBars; b += 2) {
      const off = b * 16;
      for (let i = 0; i < srcNotes.length; i++) {
        const note = srcNotes[i];
        if (note.step < 32) notes.push({ step: note.step + off, midi: note.midi, dur: note.dur });
      }
    }
    return notes;
  }

  function stepToSongTime(viewLo, step, barTimeAt) {
    const bar = viewLo + Math.floor(step / 16);
    const within = (step % 16) / 16;
    const t0 = barTimeAt(bar);
    const t1 = barTimeAt(bar + 1);
    return t0 + within * Math.max(0.001, t1 - t0);
  }

  function romanFor(chord, kind, nextChord) {
    if (!chord) return "";
    const inF = kind === "chorus" || kind === "vamp";
    if (inF && chord === "G") return "II (V of V)";
    if (inF && chord === "D" && (nextChord === "Gm" || nextChord === "G")) return "V/ii";
    if (inF && chord === "A" && (nextChord === "Dm" || nextChord === "D")) return "V/vi";
    if (!inF && chord === "E") return "II (V of V)";
    if (!inF && chord === "A") return "V";
    if (!inF && chord === "C" && nextChord === "F") return "♭VII (→♭III)";
    const dm = { Dm:"i", D:"I", Am:"v", A:"V", C:"♭VII", Cm:"♭vii", Bb:"♭VI", Bbm:"♭vi", Gm:"iv", G:"IV", F:"♭III", Ab:"♭V", Eb:"♭II", Db:"♭i", Em:"ii" };
    const f = { F:"I", C:"V", Cm:"v", Bb:"IV", Bbm:"iv", Dm:"vi", D:"VI", Am:"iii", A:"III", Gm:"ii", G:"II", Ab:"♭III", Eb:"♭VII", Db:"♭VI" };
    return (inF ? f : dm)[chord] || "";
  }
  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function fmt(s) {
    const tenths = Math.round(Math.max(0, Number(s) || 0) * 10);
    const m = Math.floor(tenths / 600);
    const rem = tenths % 600;
    return m + ":" + pad2(Math.floor(rem / 10)) + "." + (rem % 10);
  }
  function fmtBarBeat(bar, beat) {
    const b = String(Math.max(0, bar | 0)).padStart(2, " ");
    return "Bar " + b + " · beat " + ((beat | 0) + 1);
  }
  function fmtLoopLabel(lo, hi, loopOn) {
    return loopOn ? ("Loop " + lo + "–" + hi) : "Loop —";
  }
  /** Prefer AAC/m4a over WAV (Safari + Chrome Web Audio). Mirrors src/stems.mjs. */
  function resolveStemUrls(stemsMeta) {
    const meta = stemsMeta || {};
    const compressed = /\.(m4a|mp4|aac|mp3)$/i;
    const wav = /\.wav$/i;
    function pick(compKey, primaryKey, wavKey) {
      const c = meta[compKey], prim = meta[primaryKey], w = meta[wavKey];
      if (typeof c === "string" && c) return c;
      if (typeof prim === "string" && prim && compressed.test(prim)) return prim;
      if (typeof prim === "string" && prim && !wav.test(prim)) return prim;
      if (typeof w === "string" && w) return w;
      if (typeof prim === "string" && prim) return prim;
      return null;
    }
    return {
      bass: pick("bass_m4a", "bass", "bass_wav"),
      noBass: pick("no_bass_m4a", "no_bass", "no_bass_wav"),
      drums: pick("drums_m4a", "drums", "drums_wav"),
    };
  }
  function listenGains(mode, drumsAvailable) {
    if (mode === "solo") return { bass: 1, noBass: 0, drums: 0 };
    if (mode === "mute") return { bass: 0, noBass: 1, drums: 0 };
    if (mode === "db") return drumsAvailable ? { bass: 1, noBass: 0, drums: 1 } : { bass: 1, noBass: 0, drums: 0 };
    if (mode === "drums") return drumsAvailable ? { bass: 0, noBass: 0, drums: 1 } : { bass: 0, noBass: 0, drums: 0 };
    return { bass: 1, noBass: 1, drums: 0 };
  }
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k === "className") n.className = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    (kids || []).forEach((c) => n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }
  function svgEl(tag, attrs, kids) {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === "style" && typeof v === "object") Object.assign(n.style, v);
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, String(v));
    }
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
  }



  const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  function midiToName(m) {
    const n = Number(m);
    if (!Number.isFinite(n)) return "";
    return NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  /** Pitch-class map for chord roots / slash bass (enharmonics used in demos). */
  const CHORD_PC = {
    C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
    "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
  };
  const CHORD_QUALITY_INTERVALS = {
    maj: [0, 4, 7],
    min: [0, 3, 7],
    dom7: [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    min7: [0, 3, 7, 10],
    dim: [0, 3, 6],
    dim7: [0, 3, 6, 9],
    aug: [0, 4, 8],
    sus4: [0, 5, 7],
    maj6: [0, 4, 7, 9],
    dom9: [0, 4, 7, 10, 14],
  };
  /**
   * Parse demo chord symbols (C, Dm, Bb, A7, Fm7, Abm7, slash C/E when present).
   * Returns { rootPc, quality, bassPc, symbol } or null.
   */
  function parseChordSymbol(sym) {
    const s = String(sym || "").trim();
    if (!s) return null;
    const m = s.match(/^([A-G](?:b|#)?)(maj7|maj|min7|min|m7|m|dim7|dim|aug|sus4|sus2|sus|add9|add2|7|6|9)?(?:\/([A-G](?:b|#)?))?$/i);
    if (!m) return null;
    const rootName = m[1];
    const qRaw = (m[2] || "").toLowerCase();
    const bassName = m[3] || null;
    let quality = "maj";
    if (qRaw === "m" || qRaw === "min") quality = "min";
    else if (qRaw === "m7" || qRaw === "min7") quality = "min7";
    else if (qRaw === "7") quality = "dom7";
    else if (qRaw === "maj7") quality = "maj7";
    else if (qRaw === "maj") quality = "maj";
    else if (qRaw === "dim7") quality = "dim7";
    else if (qRaw === "dim") quality = "dim";
    else if (qRaw === "aug") quality = "aug";
    else if (qRaw === "sus" || qRaw === "sus4" || qRaw === "sus2") quality = "sus4";
    else if (qRaw === "6") quality = "maj6";
    else if (qRaw === "9") quality = "dom9";
    else if (qRaw === "add9" || qRaw === "add2") quality = "maj";
    const rootPc = CHORD_PC[rootName];
    if (rootPc == null) return null;
    const bassPc = bassName != null ? CHORD_PC[bassName] : null;
    return { rootPc, quality, bassPc: bassPc == null ? null : bassPc, symbol: s, rootName, bassName };
  }
  /** Concert MIDI chord tones in a clear mid register (not harsh; sits above bass). */
  function chordToneMidis(sym, opts) {
    const o = opts || {};
    const prefer = Number.isFinite(o.rootMidi) ? o.rootMidi : 52; // ~E3
    const parsed = parseChordSymbol(sym);
    if (!parsed) return [];
    const ints = CHORD_QUALITY_INTERVALS[parsed.quality] || CHORD_QUALITY_INTERVALS.maj;
    let root = prefer - (((prefer % 12) + 12) % 12) + parsed.rootPc;
    while (root > prefer + 6) root -= 12;
    while (root < prefer - 6) root += 12;
    const tones = ints.map((iv) => {
      let m = root + iv;
      while (m > 71) m -= 12;
      while (m < 48) m += 12;
      return m;
    });
    // Optional slash bass below the voicing
    if (parsed.bassPc != null) {
      let bass = prefer - 12 - ((((prefer - 12) % 12) + 12) % 12) + parsed.bassPc;
      while (bass > 48) bass -= 12;
      while (bass < 36) bass += 12;
      if (!tones.some((t) => ((t % 12) + 12) % 12 === parsed.bassPc)) tones.unshift(bass);
    }
    return Array.from(new Set(tones)).sort((a, b) => a - b);
  }
  function chordPitchClasses(sym) {
    return chordToneMidis(sym).map((m) => ((m % 12) + 12) % 12);
  }

  function resolveInsightPattern(insight, patsEff) {
    if (!insight || typeof insight !== "object") return null;
    const builtins = {
      sync_oct: SYNC_OCT, walk: WALK, pedal: PEDAL, b7: B7, turn: TURN, empty: EMPTY,
      oct: SYNC_OCT, desc: WALK,
    };
    if (insight.patternId && builtins[insight.patternId]) return builtins[insight.patternId];
    if (insight.patternId && patsEff && typeof patsEff === "object") {
      for (const key of Object.keys(patsEff)) {
        const raw = patsEff[key];
        const arr = Array.isArray(raw) ? raw : [raw];
        for (let i = 0; i < arr.length; i++) {
          if (arr[i] && arr[i].id === insight.patternId) return arr[i];
        }
      }
    }
    return null;
  }

  /**
   * Compact flashcard insight schematic — two staves (bass on top, drums below)
   * mirroring the main left layout. Claim-window highlights stay lit; dim = other
   * hits in the figure. Hand annotations explain the claim.
   * insight: { layer, patternId?, title?, barRange?, highlights:[{step,text,kind?,midi?,chord?}] }
   * Layers: pocket | figure | harmony | missable (plus legacy drums/bass/feel).
   */
  function makeCardInsight(insight, pattern) {
    if (!insight || typeof insight !== "object") return null;
    const layer = insight.layer || "figure";
    const isPocket = layer === "pocket" || layer === "drums";
    const isHarmony = layer === "harmony";
    const highlightsAll = Array.isArray(insight.highlights) ? insight.highlights : [];
    const highlights = highlightsAll.filter((h) => h && (h.text || h.kind || h.chord || Number.isFinite(h.step))).slice(0, 4);
    const barRange = Array.isArray(insight.barRange) && insight.barRange.length >= 2
      ? [insight.barRange[0] | 0, insight.barRange[1] | 0]
      : [0, 0];
    const nBars = Math.max(1, barRange[1] - barRange[0] + 1);
    const step0 = barRange[0] * 16;
    const totalSteps = nBars * 16;
    const wrap = el("div", { className: "card-insight", "data-insight-layer": layer });
    const head = el("div", { className: "card-insight-head" });
    if (insight.title) head.appendChild(el("div", { className: "card-insight-title" }, [insight.title]));
    else head.appendChild(el("div", { className: "card-insight-title" }, [layer]));
    const midiStrip = el("div", { className: "card-insight-midi-strip", "data-insight-midi-strip": "1" });
    // Play is the primary affordance; Bass/Drums (or Chords) are independent toggles (default ON).
    // Icons: classic triangle play / stop square; tiny bass guitar; drum kit; chord triad bars.
    const ICON_PLAY = '<svg class="card-insight-icon" data-icon="play" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="2.5,1 10.5,6 2.5,11" fill="currentColor"/></svg>';
    const ICON_STOP = '<svg class="card-insight-icon" data-icon="stop" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor"/></svg>';
    const ICON_BASS = '<svg class="card-insight-icon" data-icon="bass" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><ellipse cx="4.2" cy="6.2" rx="3.2" ry="3.6" fill="currentColor" opacity=".92"/><rect x="6.8" y="5.2" width="5.2" height="1.8" rx=".4" fill="currentColor"/><rect x="11.6" y="4.2" width="1.6" height="3.8" rx=".3" fill="currentColor"/><circle cx="3.2" cy="5.4" r=".55" fill="#0a0e13"/><circle cx="4.6" cy="7.2" r=".45" fill="#0a0e13"/></svg>';
    const ICON_DRUMS = '<svg class="card-insight-icon" data-icon="drums" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true"><ellipse cx="7" cy="7.6" rx="4.6" ry="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><ellipse cx="7" cy="5.4" rx="4.6" ry="2.2" fill="currentColor" opacity=".88"/><line x1="2.4" y1="5.4" x2="2.4" y2="7.6" stroke="currentColor" stroke-width="1.1"/><line x1="11.6" y1="5.4" x2="11.6" y2="7.6" stroke="currentColor" stroke-width="1.1"/><line x1="3.2" y1="1.6" x2="6.2" y2="5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/><line x1="10.8" y1="1.6" x2="7.8" y2="5" stroke="currentColor" stroke-width="1.15" stroke-linecap="round"/></svg>';
    const ICON_CHORDS = '<svg class="card-insight-icon" data-icon="chords" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2" width="1.4" height="8" rx=".3" fill="currentColor"/><rect x="5.3" y="4" width="1.4" height="6" rx=".3" fill="currentColor"/><rect x="9.1" y="3" width="1.4" height="7" rx=".3" fill="currentColor"/></svg>';
    function insightIconBtn(attrs, iconHtml, visibleLabel) {
      const b = el("button", Object.assign({ type: "button", className: "ch-btn card-insight-midi" }, attrs));
      b.innerHTML = iconHtml + (visibleLabel
        ? '<span class="card-insight-midi-label">' + visibleLabel + '</span>'
        : '');
      return b;
    }
    const playBtn0 = insightIconBtn({
      className: "ch-btn card-insight-midi play-btn",
      "data-transport": "insight-midi-play",
      "data-insight-play": "1",
      "aria-label": "Play card claim-window MIDI",
      title: "Play — loop this card’s claim window (pauses the main player)",
    }, ICON_PLAY, null);
    playBtn0.__insightIcons = { play: ICON_PLAY, stop: ICON_STOP };
    midiStrip.appendChild(playBtn0);
    if (isHarmony) {
      midiStrip.appendChild(insightIconBtn({
        "data-transport": "insight-midi-tog",
        "data-insight-voice": "chords",
        "aria-label": "Toggle chords voice for card MIDI",
        title: "Chords — include chord pads when playing",
      }, ICON_CHORDS, "Chords"));
    } else {
      midiStrip.appendChild(insightIconBtn({
        "data-transport": "insight-midi-tog",
        "data-insight-voice": "bass",
        "aria-label": "Toggle bass voice for card MIDI",
        title: "Bass — include bass line when playing",
      }, ICON_BASS, "Bass"));
      midiStrip.appendChild(insightIconBtn({
        "data-transport": "insight-midi-tog",
        "data-insight-voice": "drums",
        "aria-label": "Toggle drums voice for card MIDI",
        title: "Drums — include drums when playing",
      }, ICON_DRUMS, "Drums"));
    }
    head.appendChild(midiStrip);
    wrap.appendChild(head);

    if (isHarmony) {
      const row = el("div", { className: "card-insight-chords" });
      const chords = highlights.filter((h) => h && (h.kind === "chord" || h.chord));
      const list = chords.length ? chords : [
        { chord: "F", text: "I" }, { chord: "C", text: "V" },
        { chord: "Bb", text: "IV" }, { chord: "Dm", text: "vi" },
      ];
      list.forEach((h, i) => {
        const chip = el("div", { className: "card-insight-chord" + (h.text ? " lit" : "") });
        chip.appendChild(el("div", { className: "card-insight-chord-name" }, [h.chord || "?"]));
        chip.appendChild(el("div", { className: "card-insight-chord-fn" }, [h.text || ""]));
        chip.setAttribute("data-insight-step", String(h.step != null ? h.step : i * 16));
        row.appendChild(chip);
      });
      wrap.appendChild(row);
      return wrap;
    }

    const VW = 320;
    const VH = 168;
    const gx0 = 28, gw = VW - 40;
    const bassY = 52;   // center of bass staff band
    const drumY = 118;  // center of drums staff band
    const svg = svgEl("svg", {
      viewBox: "0 0 " + VW + " " + VH,
      width: "100%",
      height: "100%",
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": insight.title || "Pattern insight",
      class: "card-insight-svg",
      "data-insight-two-staff": "1",
    });
    const sx = (s) => gx0 + ((s - step0 + 0.5) / totalSteps) * gw;

    function drawStaffBand(y0, h, label) {
      for (let b = 0; b < nBars; b++) {
        const x = gx0 + (b / nBars) * gw;
        svg.appendChild(svgEl("rect", {
          x: x, y: y0, width: gw / nBars, height: h,
          fill: b % 2 === 0 ? "#111827" : "#0f172a", rx: 3,
        }));
      }
      for (let s = 0; s <= totalSteps; s++) {
        if (s % 4 !== 0) continue;
        const x = gx0 + (s / totalSteps) * gw;
        const barline = s % 16 === 0;
        svg.appendChild(svgEl("line", {
          x1: x, x2: x, y1: y0, y2: y0 + h,
          stroke: barline ? "#6b7280" : "#374151",
          "stroke-width": barline ? 1.4 : 1,
        }));
      }
      svg.appendChild(svgEl("text", {
        x: 4, y: y0 + h / 2 + 3, "font-size": 8, "font-weight": 700, fill: "#9ca3af",
      }, [document.createTextNode(label)]));
    }

    drawStaffBand(bassY - 22, 44, "Bass");
    drawStaffBand(drumY - 22, 44, "Drums");

    // Beat numbers under drums
    for (let s = 0; s < totalSteps; s += 4) {
      const beat = ((s % 16) / 4) + 1;
      svg.appendChild(svgEl("text", {
        x: sx(step0 + s), y: drumY + 30, "text-anchor": "middle",
        "font-size": 8, fill: "#6b7280",
      }, [document.createTextNode(String(beat))]));
    }

    const patNotes = (pattern && Array.isArray(pattern.notes)) ? pattern.notes : [];
    const hiByStep = new Map();
    highlights.forEach((h) => {
      if (h && Number.isFinite(h.step)) {
        const st = h.step | 0;
        if (!hiByStep.has(st)) hiByStep.set(st, []);
        hiByStep.get(st).push(h);
      }
    });
    const hasHi = (st, kind) => {
      const arr = hiByStep.get(st) || [];
      if (!kind) return arr.length > 0;
      return arr.some((h) => h.kind === kind || (!h.kind && kind === "note"));
    };
    let dimCount = 0;
    let litCount = 0;

    const patternEmpty = insight.patternId === "empty" || (pattern && pattern.id === "empty");

    // --- Bass staff (top) ---
    if (patternEmpty) {
      for (let bar = 0; bar < nBars; bar++) {
        const cx = gx0 + ((bar + 0.5) / nBars) * gw;
        svg.appendChild(svgEl("text", {
          x: cx, y: bassY + 4, "text-anchor": "middle",
          "font-size": 11, "font-weight": 700, fill: "#9ca3af",
          "data-insight-kind": "empty",
          "data-insight-staff": "bass",
        }, [document.createTextNode("rest")]));
      }
    } else {
      const inRange = patNotes.filter((n) => n.step >= step0 && n.step < step0 + totalSteps);
      // Also include bass-kind highlights not already in pattern
      const midis = inRange.map((n) => n.midi);
      highlights.forEach((h) => {
        if (h && (h.kind === "bass" || h.kind === "note" || (!h.kind && Number.isFinite(h.midi))) && Number.isFinite(h.midi)) {
          midis.push(h.midi);
        }
      });
      const loM = midis.length ? Math.min.apply(null, midis) : 28;
      const hiM = midis.length ? Math.max.apply(null, midis) : 48;
      const py = (m) => {
        if (hiM === loM) return bassY;
        return bassY + 10 - ((m - loM) / (hiM - loM)) * 28;
      };
      inRange.forEach((n) => {
        const arr = hiByStep.get(n.step) || [];
        const bassHi = arr.find((h) => h.kind === "bass");
        const litBass = arr.some((h) => {
          if (h.kind === "kick" || h.kind === "snare" || h.kind === "hat" || h.kind === "chord") return false;
          return true; // bass / note / untyped highlight
        });
        const isLit = Boolean(litBass);
        if (isLit) litCount++; else dimCount++;
        const kind = bassHi ? "bass" : "note";
        svg.appendChild(svgEl("circle", {
          cx: sx(n.step), cy: py(n.midi), r: isLit ? 6 : 3.2,
          fill: isLit ? "#3b82f6" : "#4b5563",
          stroke: isLit ? "#93c5fd" : "none",
          "stroke-width": isLit ? 1.5 : 0,
          "data-insight-step": String(n.step),
          "data-insight-kind": kind,
          "data-insight-midi": String(n.midi),
          "data-insight-lit": isLit ? "1" : "0",
          "data-insight-staff": "bass",
        }));
      });
      // Bass highlights that aren't pattern notes (e.g. pocket bass overlay)
      highlights.forEach((h) => {
        if (!h || !Number.isFinite(h.step)) return;
        if (h.kind === "kick" || h.kind === "snare" || h.kind === "hat" || h.kind === "chord") return;
        const st = h.step | 0;
        if (st < step0 || st >= step0 + totalSteps) return;
        if (inRange.some((n) => n.step === st)) return;
        const m = Number.isFinite(h.midi) ? h.midi : loM;
        litCount++;
        const kind = h.kind === "bass" ? "bass" : (h.kind || "note");
        svg.appendChild(svgEl("circle", {
          cx: sx(st), cy: py(m), r: 5.5,
          fill: "#3b82f6", stroke: "#93c5fd", "stroke-width": 1.5,
          "data-insight-step": String(st),
          "data-insight-kind": kind,
          "data-insight-midi": String(m),
          "data-insight-lit": "1",
          "data-insight-staff": "bass",
        }));
      });
      if (!inRange.length && !highlights.some((h) => h && h.kind === "bass")) {
        // No bass material — rest
        for (let bar = 0; bar < nBars; bar++) {
          const cx = gx0 + ((bar + 0.5) / nBars) * gw;
          svg.appendChild(svgEl("text", {
            x: cx, y: bassY + 4, "text-anchor": "middle",
            "font-size": 11, "font-weight": 700, fill: "#9ca3af",
            "data-insight-kind": "empty",
            "data-insight-staff": "bass",
          }, [document.createTextNode("rest")]));
        }
      }
    }

    // --- Drums staff (bottom) ---
    const lane = { kick: drumY - 10, snare: drumY + 6, hat: drumY - 18 };
    if (patternEmpty) {
      for (let bar = 0; bar < nBars; bar++) {
        const cx = gx0 + ((bar + 0.5) / nBars) * gw;
        svg.appendChild(svgEl("text", {
          x: cx, y: drumY + 4, "text-anchor": "middle",
          "font-size": 11, "font-weight": 700, fill: "#9ca3af",
          "data-insight-kind": "empty",
          "data-insight-staff": "drums",
        }, [document.createTextNode("rest")]));
      }
    } else {
      svg.appendChild(svgEl("text", { x: 4, y: lane.kick + 3, "font-size": 7, fill: "#6b7280" }, [document.createTextNode("K")]));
      svg.appendChild(svgEl("text", { x: 4, y: lane.snare + 3, "font-size": 7, fill: "#6b7280" }, [document.createTextNode("S")]));
      for (let bar = 0; bar < nBars; bar++) {
        const base = step0 + bar * 16;
        [0, 8].forEach((off) => {
          const st = base + off;
          const litKick = hasHi(st, "kick");
          if (litKick) litCount++; else dimCount++;
          svg.appendChild(svgEl("circle", {
            cx: sx(st), cy: lane.kick, r: litKick ? 5.5 : 3,
            fill: litKick ? "#f59e0b" : "#4b5563",
            "data-insight-step": String(st),
            "data-insight-kind": "kick",
            "data-insight-lit": litKick ? "1" : "0",
            "data-insight-staff": "drums",
          }));
        });
        [4, 12].forEach((off) => {
          const st = base + off;
          const litSnare = hasHi(st, "snare");
          if (litSnare) litCount++; else dimCount++;
          svg.appendChild(svgEl("circle", {
            cx: sx(st), cy: lane.snare, r: litSnare ? 5 : 2.8,
            fill: litSnare ? "#a855f7" : "#4b5563",
            "data-insight-step": String(st),
            "data-insight-kind": "snare",
            "data-insight-lit": litSnare ? "1" : "0",
            "data-insight-staff": "drums",
          }));
        });
      }
    }

    // Annotation labels (top band) with leader lines — max 4
    const labelSlots = highlights.filter((h) => h && h.text && Number.isFinite(h.step)
      && h.step >= step0 && h.step < step0 + totalSteps).slice(0, 4);
    labelSlots.forEach((h, i) => {
      const st = h.step | 0;
      const x = sx(st);
      const row = i % 2;
      const ty = 12 + row * 14;
      const isDrum = h.kind === "kick" || h.kind === "snare" || h.kind === "hat";
      const color = h.kind === "kick" ? "#f59e0b"
        : h.kind === "snare" ? "#a855f7"
        : h.kind === "bass" ? "#3b82f6"
        : "#93c5fd";
      const yTarget = isDrum ? drumY - 24 : bassY - 24;
      svg.appendChild(svgEl("line", {
        x1: x, x2: x, y1: ty + 3, y2: yTarget,
        stroke: color, "stroke-width": 1, "stroke-dasharray": "2 2", opacity: 0.85,
      }));
      const label = h.text;
      const tw = Math.min(120, 6 + label.length * 5.0);
      svg.appendChild(svgEl("rect", {
        x: x - tw / 2, y: ty - 9, width: tw, height: 13, rx: 3,
        fill: "#1f2937", stroke: color, "stroke-width": 1,
      }));
      svg.appendChild(svgEl("text", {
        x: x, y: ty, "text-anchor": "middle",
        "font-size": 8, "font-weight": 700, fill: "#e5e7eb",
        "data-insight-label": label,
      }, [document.createTextNode(label)]));
    });

    wrap.appendChild(svg);
    if (dimCount > 0 && litCount > 0) {
      wrap.appendChild(el("div", {
        className: "card-insight-legend",
        "data-insight-legend": "1",
      }, ["dim = other hits in the figure · lit = this card’s point"]));
    } else if (patternEmpty) {
      wrap.appendChild(el("div", {
        className: "card-insight-legend",
        "data-insight-legend": "empty",
      }, ["empty = silence / rhythm section out"]));
    }
    return wrap;
  }

  /**
   * Collect claim-window MIDI events for an insight card (no invent on empty).
   * voice: "all" | "bass" | "drums" | "chords"
   * Returns { bass:[{step,midi}], drums:[{step,kind}], chords:[{step,chord,tones}], step0, totalSteps, empty }
   */
  function buildInsightMidiEvents(insight, pattern, voice) {
    const v = voice || "all";
    const out = { bass: [], drums: [], chords: [], step0: 0, totalSteps: 16, empty: false, layer: "figure" };
    if (!insight || typeof insight !== "object") { out.empty = true; return out; }
    const layer = insight.layer || "figure";
    out.layer = layer;
    const barRange = Array.isArray(insight.barRange) && insight.barRange.length >= 2
      ? [insight.barRange[0] | 0, insight.barRange[1] | 0]
      : [0, 0];
    const nBars = Math.max(1, barRange[1] - barRange[0] + 1);
    const step0 = barRange[0] * 16;
    const totalSteps = nBars * 16;
    out.step0 = step0;
    out.totalSteps = totalSteps;
    const patternEmpty = insight.patternId === "empty" || (pattern && pattern.id === "empty");
    out.empty = Boolean(patternEmpty);
    const highlights = Array.isArray(insight.highlights) ? insight.highlights : [];

    if (layer === "harmony" || v === "chords") {
      const chords = highlights.filter((h) => h && (h.kind === "chord" || h.chord));
      const list = chords.length ? chords : [];
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        const tones = chordToneMidis(h.chord || "");
        if (!tones.length) continue;
        out.chords.push({
          step: Number.isFinite(h.step) ? (h.step | 0) : step0 + i * 16,
          chord: h.chord || "",
          tones,
        });
      }
      if (v === "chords" || layer === "harmony") return out;
    }

    if (patternEmpty) return out; // no invent

    if (v === "all" || v === "bass") {
      const patNotes = (pattern && Array.isArray(pattern.notes)) ? pattern.notes : [];
      const inRange = patNotes.filter((n) => n.step >= step0 && n.step < step0 + totalSteps);
      const seen = new Set();
      for (let i = 0; i < inRange.length; i++) {
        const n = inRange[i];
        const key = n.step + ":" + n.midi;
        if (seen.has(key)) continue;
        seen.add(key);
        out.bass.push({ step: n.step, midi: n.midi });
      }
      // Bass highlights not in pattern
      for (let i = 0; i < highlights.length; i++) {
        const h = highlights[i];
        if (!h || !Number.isFinite(h.step)) continue;
        if (h.kind === "kick" || h.kind === "snare" || h.kind === "hat" || h.kind === "chord") continue;
        const st = h.step | 0;
        if (st < step0 || st >= step0 + totalSteps) continue;
        const m = Number.isFinite(h.midi) ? h.midi : null;
        if (m == null) continue;
        const key = st + ":" + m;
        if (seen.has(key)) continue;
        seen.add(key);
        out.bass.push({ step: st, midi: m });
      }
      out.bass.sort((a, b) => a.step - b.step);
    }

    if (v === "all" || v === "drums") {
      // Play the schematic drum grid for non-empty cards (what’s drawn), not song invent
      // when empty — already returned. Pedagogical claim-window kicks/snares.
      for (let bar = 0; bar < nBars; bar++) {
        const base = step0 + bar * 16;
        out.drums.push({ step: base, kind: "kick" });
        out.drums.push({ step: base + 8, kind: "kick" });
        out.drums.push({ step: base + 4, kind: "snare" });
        out.drums.push({ step: base + 12, kind: "snare" });
      }
      // Extra drum highlights outside the grid
      for (let i = 0; i < highlights.length; i++) {
        const h = highlights[i];
        if (!h || !Number.isFinite(h.step)) continue;
        if (h.kind !== "kick" && h.kind !== "snare" && h.kind !== "hat") continue;
        const st = h.step | 0;
        if (st < step0 || st >= step0 + totalSteps) continue;
        if (out.drums.some((d) => d.step === st && d.kind === h.kind)) continue;
        out.drums.push({ step: st, kind: h.kind });
      }
      out.drums.sort((a, b) => a.step - b.step || String(a.kind).localeCompare(String(b.kind)));
    }
    return out;
  }


  // Phone breakpoint: ≤640 CSS px. iPad (768+) and desktop keep the fixed 2-col dashboard.
  const PHONE_MAX_WIDTH = 640;
  function isPhoneLayout() {
    if (typeof window === "undefined") return false;
    return (window.innerWidth | 0) <= PHONE_MAX_WIDTH;
  }

  function ensurePlayerStyles() {
    if (document.getElementById("bass-player-styles")) return;
    const css = `
:root { color-scheme: dark; }
html, body { margin:0; height:100%; background:#0b0f14; color:#e5e7eb; font-family:ui-sans-serif,system-ui,sans-serif; }
#app { height:100%; }
.shell { height:clamp(640px,100dvh,900px); width:100%; box-sizing:border-box; overflow:hidden; display:flex; flex-direction:column; gap:6px; padding:10px; border:1px solid #374151; border-radius:10px; background:#0b0f14; color:#e5e7eb; }
.header { display:flex; align-items:center; justify-content:space-between; flex:0 0 auto; flex-wrap:nowrap; gap:8px; }
.meta { display:flex; align-items:baseline; gap:10px; flex-wrap:nowrap; min-width:0; overflow:hidden; }
.meta .title { font-size:20px; font-weight:700; flex:0 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.meta .sub { font-size:12px; color:#9ca3af; white-space:nowrap; }
.meta .stat, .meta .clock, .meta .loop-slot { font-size:12px; font-weight:600; font-variant-numeric:tabular-nums; font-feature-settings:"tnum" 1; white-space:nowrap; }
.meta .stat[data-meta="barbeat"] { min-width:14ch; }
.meta .clock { min-width:7ch; display:inline-block; }
.meta .loop-slot { min-width:11ch; display:inline-block; }
.meta .sec-slot { min-width:10ch; display:inline-block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.meta .badge { font-size:11px; color:#93c5fd; border:1px solid #374151; border-radius:999px; padding:2px 8px; white-space:nowrap; flex:0 0 auto; }
.meta .badge.loading { color:#fbbf24; border-color:#92400e; }
.transport { display:flex; align-items:center; gap:6px; flex:0 0 auto; flex-wrap:wrap; }
.rate-strip { display:inline-flex; align-items:center; gap:3px; margin-left:4px; }
.rate-btn { min-width:36px; height:28px; padding:0 6px; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; border-radius:6px; border:1px solid #374151; background:#111827; color:#9ca3af; cursor:pointer; line-height:1; -webkit-user-select:none; user-select:none; touch-action:manipulation; }
.rate-btn.on { background:#1e3a5f; border-color:#3b82f6; color:#93c5fd; }
.credit-line { font-size:11px; color:#6b7280; line-height:1.35; }
.credit-line a { color:#93c5fd; text-decoration:none; font-weight:600; }
.credit-line a:hover { text-decoration:underline; }
.icon-btn { width:40px; height:40px; padding:0; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; border-radius:8px; border:1px solid #374151; background:#111827; color:#e5e7eb; -webkit-user-select:none; user-select:none; touch-action:manipulation; }
.icon-btn svg, .icon-btn svg * { pointer-events:none; }
.icon-btn.bass-tog { opacity:0.92; }
.icon-btn.bass-tog.on { background:#1e3a5f; border-color:#3b82f6; color:#93c5fd; opacity:1; }
.icon-btn.bass-tog.muted { background:#111827; border-color:#4b5563; color:#9ca3af; opacity:0.75; }
.icon-btn.on { background:#3b82f6; color:#fff; border-color:#3b82f6; }
.layer-head-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ch-strip { display:inline-flex; align-items:center; gap:3px; flex:0 0 auto; }
.ch-btn { min-width:28px; height:22px; padding:0 6px; font-size:10px; font-weight:800; letter-spacing:.02em; border-radius:5px; border:1px solid #374151; background:#111827; color:#9ca3af; cursor:pointer; line-height:1; -webkit-user-select:none; user-select:none; touch-action:manipulation; }
.ch-btn.on { background:#1e3a5f; border-color:#3b82f6; color:#93c5fd; }
.ch-btn:disabled { opacity:0.35; cursor:not-allowed; }
.ch-btn[data-listen="mute"].on { background:#3f1d1d; border-color:#ef4444; color:#fca5a5; }
.ch-btn[data-listen="solo"].on { background:#14532d; border-color:#22c55e; color:#86efac; }
.ch-btn[data-listen="drums"].on { background:#14532d; border-color:#22c55e; color:#86efac; }
.ch-btn[data-listen="db"].on { background:#4a1d3a; border-color:#e879f9; color:#f0abfc; }
.ch-btn[data-transport="midi"] { min-width:36px; font-size:9px; letter-spacing:0.02em; }
.ch-btn[data-transport="midi"].on { background:#1e3a5f; border-color:#3b82f6; color:#93c5fd; }
.timeline { flex:0 0 auto; min-height:0; overflow:hidden; }
.grid { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1.7fr) minmax(0,1fr); gap:8px; overflow:hidden; }
.layers { display:flex; flex-direction:column; gap:4px; min-height:0; overflow:hidden; }
.layer { flex:1; min-height:0; display:flex; flex-direction:column; border:1px solid #374151; border-radius:10px; overflow:hidden; background:#0b0f14; }
.layer.chords { flex:0 0 120px; }
.layer-head { flex:0 0 auto; padding:2px 8px; font-size:11px; font-weight:600; color:#9ca3af; border-bottom:1px solid #1f2937; display:flex; align-items:center; justify-content:space-between; gap:8px; }
.layer-head.with-ch-strip { flex-direction:column; align-items:flex-start; justify-content:flex-start; gap:4px; padding-top:4px; padding-bottom:4px; }
.layer-body { flex:1; min-height:0; padding:2px 4px; }
.layer.chords .layer-body { min-height:64px; }
.cards { display:flex; flex-direction:column; gap:8px; min-height:0; overflow:hidden; border:1px solid #374151; border-radius:10px; padding:10px; }
.cards-head { display:flex; align-items:center; justify-content:space-between; flex:0 0 auto; }
.cards-title { font-size:14px; font-weight:700; }
.card-label { font-size:11px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; color:#9ca3af; flex:0 0 auto; }
.card-body { flex:0 1 auto; max-height:5.4em; min-height:0; overflow:hidden; font-size:15px; line-height:1.4; color:#d1d5db; }
.card-insight { flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column; gap:4px; border:1px solid #1f2937; border-radius:8px; background:#0a0e13; padding:6px 6px 4px; }
.card-insight-head { display:flex; align-items:center; justify-content:space-between; gap:6px; flex:0 0 auto; }
.card-insight-title { font-size:10px; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:#93c5fd; flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.card-insight-midi-strip { display:inline-flex; align-items:center; gap:3px; flex:0 0 auto; flex-wrap:wrap; }
.card-insight-midi { min-width:36px; height:22px; padding:0 5px; font-size:9px; font-weight:800; letter-spacing:.02em; display:inline-flex; align-items:center; justify-content:center; gap:3px; }
.card-insight-midi .card-insight-icon { display:block; flex:0 0 auto; pointer-events:none; }
.card-insight-midi .card-insight-midi-label { line-height:1; pointer-events:none; }
.card-insight-midi.on { background:#1e3a5f; border-color:#3b82f6; color:#93c5fd; }
.card-insight-midi.play-btn { min-width:28px; padding:0 7px; background:#14532d; border-color:#22c55e; color:#86efac; }
.card-insight-midi.play-btn.on { background:#3f1d1d; border-color:#ef4444; color:#fca5a5; }
.card-insight-svg { flex:1; min-height:0; width:100%; }
.card-insight-chords { flex:1; min-height:0; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; align-content:center; }
.card-insight-chord { border:1px solid #374151; border-radius:8px; padding:8px 4px; text-align:center; background:#111827; }
.card-insight-chord.lit { border-color:#3b82f6; background:#1e3a5f; }
.card-insight-chord-name { font-size:16px; font-weight:800; color:#e5e7eb; }
.card-insight-chord-fn { font-size:10px; font-weight:700; color:#93c5fd; margin-top:2px; }
.card-insight-legend { flex:0 0 auto; font-size:9px; line-height:1.25; color:#6b7280; padding:0 2px 2px; }
.card-actions { display:flex; align-items:center; gap:8px; flex:0 0 auto; }
.btn { min-height:36px; min-width:100px; padding:0 12px; cursor:pointer; border-radius:8px; border:1px solid #374151; background:#111827; color:#e5e7eb; font-size:13px; font-weight:600; }
.btn.primary { background:#3b82f6; border-color:#3b82f6; color:#fff; }
.card-grid { flex:0 0 auto; display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.card-mini { text-align:left; padding:8px; cursor:pointer; border-radius:8px; border:1px solid #374151; background:#0b0f14; color:#e5e7eb; font:inherit; }
.card-mini.active { border-color:#ef4444; background:#111827; }
.card-mini-label { font-size:10px; font-weight:700; color:#9ca3af; margin-bottom:2px; }
.card-mini-body { font-size:11px; line-height:1.3; color:#9ca3af; }
/* Phone ≤640px: fixed no-scroll score stack; cards live in bottom sheet. iPad/desktop keep 2-col. */
@media (max-width:640px) {
  .shell { height:100dvh; max-height:100dvh; overflow:hidden; gap:4px; padding:6px 8px; padding-bottom:56px; border-radius:0; border-left:0; border-right:0; }
  .shell[data-phone="1"] { /* marker for tests / JS */ }
  .grid { grid-template-columns:1fr; gap:4px; }
  .grid > .cards { display:none; }
  .credit-line { display:none; }
  .header {
    flex-direction:column; align-items:stretch; justify-content:flex-start;
    flex-wrap:nowrap; gap:4px; flex:0 0 auto;
  }
  .meta {
    flex-wrap:nowrap; width:100%; gap:6px; align-items:center;
    overflow:hidden; min-width:0;
  }
  .meta .title { font-size:15px; flex:1 1 auto; min-width:0; }
  .meta .sub:not(.sec-slot) { display:none; }
  .meta .stat[data-meta="barbeat"],
  .meta .clock,
  .meta .loop-slot { font-size:11px; }
  .meta .sec-slot { min-width:0; max-width:9ch; font-size:11px; }
  .meta .badge {
    flex:0 0 auto; max-width:11ch; overflow:hidden; text-overflow:ellipsis;
    white-space:nowrap; font-size:10px; padding:2px 7px;
  }
  .transport {
    width:100%; flex-wrap:nowrap; gap:4px; overflow-x:auto; overflow-y:hidden;
    -webkit-overflow-scrolling:touch; padding-bottom:2px;
  }
  .icon-btn { width:36px; height:36px; flex:0 0 auto; }
  .rate-strip { margin-left:2px; flex:0 0 auto; }
  .rate-btn { min-width:32px; height:26px; padding:0 5px; font-size:10px; }
  .timeline { flex:0 0 auto; }
  .timeline svg { max-height:88px !important; }
  .layers { gap:3px; }
  .layer.chords { flex:0 0 104px; }
  .layer-head { font-size:10px; padding:1px 6px; }
  .layer-head.with-ch-strip { gap:2px; padding-top:2px; padding-bottom:2px; }
  .layer-body { padding:1px 2px; }
  .ch-btn { min-width:26px; height:20px; padding:0 5px; font-size:9px; }
}
.phone-cards-peek {
  display:none; position:fixed; left:0; right:0; bottom:0; z-index:40;
  min-height:52px; padding:10px 14px calc(10px + env(safe-area-inset-bottom, 0px));
  box-sizing:border-box; border:0; border-top:1px solid #374151; border-radius:14px 14px 0 0;
  background:#111827; color:#e5e7eb; cursor:pointer; text-align:left;
  font:inherit; -webkit-user-select:none; user-select:none; touch-action:manipulation;
  box-shadow:0 -8px 24px rgba(0,0,0,.35);
}
.phone-cards-peek-kicker { font-size:10px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; color:#9ca3af; }
.phone-cards-peek-row { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:2px; }
.phone-cards-peek-label { font-size:14px; font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.phone-cards-peek-count { font-size:12px; color:#93c5fd; white-space:nowrap; flex:0 0 auto; }
.cards-drawer-backdrop {
  display:none; position:fixed; inset:0; z-index:50; border:0; padding:0; margin:0;
  background:rgba(0,0,0,.45); cursor:pointer; -webkit-user-select:none; user-select:none; touch-action:manipulation;
}
.cards-drawer {
  display:none; position:fixed; left:0; right:0; bottom:0; z-index:60;
  max-height:min(85vh, 640px); box-sizing:border-box;
  padding:0 10px calc(10px + env(safe-area-inset-bottom, 0px));
  border-top:1px solid #374151; border-radius:16px 16px 0 0;
  background:#0b0f14; color:#e5e7eb;
  transform:translateY(105%); transition:transform .22s ease;
  box-shadow:0 -12px 40px rgba(0,0,0,.5);
  overflow:hidden; flex-direction:column;
}
.cards-drawer.open { transform:translateY(0); }
.cards-drawer-handle {
  flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 4px 6px; cursor:grab; -webkit-user-select:none; user-select:none;
}
.cards-drawer-grip {
  width:40px; height:4px; border-radius:999px; background:#4b5563; margin:0 auto 4px;
}
.cards-drawer-title { font-size:13px; font-weight:700; color:#9ca3af; }
.cards-drawer-close {
  min-width:36px; height:32px; padding:0 10px; border-radius:8px; border:1px solid #374151;
  background:#111827; color:#e5e7eb; font-size:18px; line-height:1; cursor:pointer;
  -webkit-user-select:none; user-select:none; touch-action:manipulation;
}
.cards-drawer .cards {
  flex:1; min-height:0; overflow:auto; -webkit-overflow-scrolling:touch;
  border:0; border-radius:0; padding:4px 2px 8px;
}
/* Keep lean-B insight schematic visible in the drawer (do not flex-crush to 0). */
.cards-drawer .card-body { max-height:3.6em; font-size:13px; line-height:1.35; flex:0 0 auto; }
.cards-drawer .card-insight {
  flex:1 0 auto; min-height:196px; overflow:hidden;
}
.cards-drawer .card-insight-svg { flex:1 1 auto; min-height:148px; width:100%; }
.cards-drawer .card-insight-chords { min-height:88px; }
.cards-drawer .card-grid { flex:0 0 auto; }
.cards-drawer .card-actions { flex:0 0 auto; }
.cards-drawer .cards-head { flex:0 0 auto; }
.cards-drawer .card-label { flex:0 0 auto; }
@media (max-width:640px) {
  .phone-cards-peek { display:block; }
  .phone-cards-peek[hidden], .cards-drawer-backdrop[hidden], .cards-drawer[hidden] { display:none !important; }
  .cards-drawer-backdrop:not([hidden]) { display:block; }
  .cards-drawer:not([hidden]) { display:flex; }
  body.cards-drawer-open { overflow:hidden; }
}
.song-picker-row { display:flex; align-items:center; gap:8px; flex:0 0 auto; min-width:0; }
.song-picker-row label { font-size:10px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#6b7280; flex:0 0 auto; }
.song-typeahead { position:relative; flex:0 1 auto; min-width:160px; max-width:min(320px,70vw); }
.song-typeahead-input {
  width:100%; box-sizing:border-box; font-size:12px; background:#111827; color:#e5e7eb;
  border:1px solid #374151; border-radius:6px; padding:5px 8px; outline:none;
}
.song-typeahead-input:focus { border-color:#60a5fa; box-shadow:0 0 0 2px rgba(96,165,250,.25); }
.song-typeahead-list {
  position:absolute; z-index:50; left:0; right:0; top:calc(100% + 4px);
  max-height:min(280px,50vh); overflow:auto; background:#0b1220;
  border:1px solid #374151; border-radius:8px; box-shadow:0 10px 28px rgba(0,0,0,.5);
}
.song-typeahead-group { padding:0 0 4px; }
.song-typeahead-group-label {
  position:sticky; top:0; z-index:1; padding:6px 10px 4px; font-size:10px; font-weight:700;
  letter-spacing:.04em; text-transform:uppercase; color:#9ca3af; background:#0b1220;
  border-bottom:1px solid #1f2937;
}
.song-typeahead-option {
  display:block; width:100%; text-align:left; padding:6px 10px; font:inherit; font-size:12px;
  color:#e5e7eb; background:transparent; border:0; cursor:pointer; line-height:1.3;
}
.song-typeahead-option[aria-selected="true"],
.song-typeahead-option:hover { background:#1f2937; }
.song-typeahead-empty { padding:8px 10px; font-size:12px; color:#6b7280; }
@media (max-width:640px) {
  .song-typeahead { max-width:75vw; }
  .song-typeahead-input { font-size:11px; }
}
`;
    const style = document.createElement("style");
    style.id = "bass-player-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function boot() {
    ensurePlayerStyles();
    const privateMode = Boolean(window.__BASS_PRIVATE__) || location.pathname.startsWith("/private/");
    let demo;
    // Multi-song: ?song= / ?id=. Public allowlist only. Private: demos + processed (LAP/jobs). (Tempo/WSOLA path untouched.)
    const PUBLIC_SONG_RE = /^(a-good-bass-for-gambling|make-funk|maple-leaf-rag)$/;
    const q = new URLSearchParams(location.search);
    const songParam = String(q.get("song") || q.get("id") || "").trim();
    const publicSlug = PUBLIC_SONG_RE.test(songParam) ? songParam : "a-good-bass-for-gambling";
    let songCatalog = { demos: [], processed: [] };
    let activeSongId = privateMode
      ? (songParam || "like-a-prayer")
      : publicSlug;
    if (privateMode) {
      try {
        const cres = await fetch("/private/api/catalog");
        if (cres.ok) songCatalog = await cres.json();
      } catch (_) { /* Access / offline — picker falls back to known entries */ }
      if (!songCatalog.demos?.length) {
        songCatalog.demos = [
          { id: "a-good-bass-for-gambling", title: "A good bass for gambling", artist: "Komiku", group: "demo" },
          { id: "make-funk", title: "Make Funk", artist: "HoliznaCC0", group: "demo" },
          { id: "maple-leaf-rag", title: "Maple Leaf Rag", artist: "Scott Joplin", group: "demo" },
        ];
      }
      if (!songCatalog.processed?.length) {
        songCatalog.processed = [
          { id: "like-a-prayer", title: "Like a Prayer", artist: "Madonna / study", group: "processed" },
        ];
      }
    }
    function resolvePrivateEndpoints(id) {
      if (PUBLIC_SONG_RE.test(id)) {
        return [`/api/demo/${id}`, `/api/demo/a-good-bass-for-gambling`, "/js/demo-data.json"];
      }
      if (/^job_[a-zA-Z0-9_]+$/.test(id)) {
        return [`/private/api/jobs/${id}/study/resource.json`, "/private/api/demo/like-a-prayer", "/js/demo-data.json"];
      }
      // Default / unknown → LAP private demo
      const slug = id || "like-a-prayer";
      return [`/private/api/demo/${slug}`, "/private/api/demo/like-a-prayer", "/js/demo-data.json"];
    }
    const endpoints = privateMode
      ? resolvePrivateEndpoints(activeSongId)
      : [`/api/demo/${publicSlug}`, "/api/demo/a-good-bass-for-gambling", "/js/demo-data.json"];
    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep);
        if (!res.ok) throw new Error(ep + " " + res.status);
        demo = await res.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!demo) throw lastErr || new Error("no demo data");
    demo.stems = demo.stems || { available: false };
    // Public pages: allow CC0/public stems only. Never enable licensed/private stems on the public player.
    if (!privateMode) {
      const access = String(demo.stems.access || "");
      const publicOk = access === "public" || (demo.stems.available && /\/api\/demo\/(a-good-bass-for-gambling|make-funk|maple-leaf-rag)\//.test(String(demo.stems.bass || "")));
      if (!publicOk) {
        demo.stems = { available: false, muteBassSupported: false, access: "blocked" };
      }
    }
    const BARS = demo.raw.map((r) => ({ bar: r[0], t: r[1], chord: r[2], bass: r[3] === "" ? [] : String(r[3]).split(".") }));
    const SECS = demo.secs;
    const NBARS = demo.nbars;
    const DURATION = demo.duration;
    const barTime = (i) => (i >= NBARS ? DURATION : BARS[Math.max(0, i)].t);
    // Prefer study/resource.json cards & patterns when present on the payload.
    const CARDS_EFF = (demo.cards && typeof demo.cards === "object") ? demo.cards : CARDS;
    const PATS_EFF = (demo.patterns && typeof demo.patterns === "object") ? demo.patterns : PATS;
    const DRUMS_OUT_BARS = normalizeDrumsOutBars(demo);
    const SONG_DRUM_HITS = normalizeSongDrumHits(demo);
    const secStart = (s) => (s.first === 0 ? 0 : BARS[s.first].t);
    const secEnd = (s) => (s.end >= NBARS ? DURATION : BARS[s.end].t);
    const barAt = (t) => { for (let i = NBARS - 1; i >= 0; i--) if (t >= BARS[i].t) return i; return 0; };
    const secIndexOfBar = (bar) => { for (let i = SECS.length - 1; i >= 0; i--) if (bar >= SECS[i].first) return i; return 0; };
    const sectionBars = (secIdx) => { const s = SECS[secIdx]; return { viewLo: s.first, viewHi: s.end - 1, n: s.end - s.first }; };
    const playheadX = (t, viewLo, n) => {
      const b = barAt(t);
      const t0 = BARS[b].t, t1 = barTime(b + 1);
      const frac = Math.max(0, Math.min(0.999, (t - t0) / Math.max(0.001, t1 - t0)));
      return X0 + Math.max(0, Math.min(1, (b - viewLo + frac) / n)) * W;
    };
    const clientXToViewX = (svg, clientX) => {
      const rect = svg.getBoundingClientRect();
      return ((clientX - rect.left) / Math.max(rect.width, 1)) * VBW;
    };
    const barFromViewX = (viewX, viewLo, viewHi) => {
      const n = viewHi - viewLo + 1;
      const frac = Math.max(0, Math.min(0.999, (viewX - X0) / W));
      return Math.min(viewHi, Math.max(viewLo, Math.floor(viewLo + frac * n)));
    };
    const timeFromViewX = (viewX, viewLo, viewHi) => {
      const n = viewHi - viewLo + 1;
      const frac = Math.max(0, Math.min(0.999, (viewX - X0) / W));
      const pos = viewLo + frac * n;
      const b = Math.min(viewHi, Math.max(viewLo, Math.floor(pos)));
      const barFrac = pos - Math.floor(pos);
      return BARS[b].t + barFrac * (barTime(b + 1) - BARS[b].t);
    };
    const barEdgeX = (bar, viewLo, viewHi) => X0 + ((bar - viewLo) / (viewHi - viewLo + 1)) * W;

    const root = document.getElementById("app");
    let secIdx = Math.min(2, SECS.length - 1);
    let lo = SECS[secIdx].first, hi = SECS[secIdx].end - 1;
    let t = BARS[SECS[secIdx].first].t, playing = false, loopOn = true, cardIdx = 0;
    let cardsDrawerOpen = false;
    let timer = null;
    const dragSession = { current: null };

    // Stem audio listen modes: full | solo (bass S) | mute (bass M) | db (D&B) | drums (drum S).
    const stemsMeta = demo.stems || {};
    const muteBassSupported = Boolean(stemsMeta.muteBassSupported || stemsMeta.available);
    const stemUrls = resolveStemUrls(stemsMeta);
    const drumsSupported = Boolean(stemUrls.drums);
    let listenMode = "full"; // full | solo | mute | db | drums
    let muteBass = false; // derived: listenMode === "mute" (compat)
    let midiBass = false;
    let midiDrums = false;
    let midiChords = false;
    const PLAYBACK_RATES = [1, 0.9, 0.75, 0.5, 0.25];
    let playbackRate = 1; // song tempo ratio; stems use WSOLA (not BufferSource.playbackRate) so pitch stays
    let audioCtx = null;
    let bassBuf = null, noBassBuf = null, drumsBuf = null;
    let bassSrc = null, noBassSrc = null, drumsSrc = null;
    let bassGain = null, noBassGain = null, drumsGain = null;
    let midiBassGain = null, midiDrumsGain = null, midiChordsGain = null;
    let midiNodes = [];
    let midiScheduleGen = 0;
    let insightMidiNodes = [];
    let insightMidiGen = 0;
    let insightMidiVoice = null;
    let insightMidiPlaying = false;
    let insightMidiLoopTimer = null;
    let insightMidiBassOn = true;
    let insightMidiDrumsOn = true;
    let insightMidiChordsOn = true;
    let insightBassGain = null, insightDrumsGain = null, insightChordsGain = null;
    let audioReady = false;
    let stemLoading = false;
    let audioStartedAt = 0;
    let audioOffset = 0;
    let usingAudio = false;
    let stemFetchPromise = null;
    let stemRawBuffers = null; // { bass, noBass, drums? } ArrayBuffers after fetch
    let ensureAudioPromise = null;
    let stemFetchCount = 0;
    let stretchCache = new Map(); // key -> { bass, noBass, drums, windowSongStart, windowSongEnd }
    let lastStemSourcePlaybackRate = 1; // always 1 when pitch-preserved WSOLA path is used
    let pitchPreserveMode = "wsola"; // not "playbackRate"
    // Full-track WSOLA on ~156s stereo×3 stems freezes the main thread for ~1min and can OOM phones.
    // Interactive tempo changes stretch only a song-time window ahead of the playhead (seekWin:0 OLA).
    const STRETCH_WINDOW_SONG_S = 16;
    const STRETCH_RELOAD_MARGIN_S = 1.25;
    const INTERACTIVE_STRETCH_OPTS = { seekWin: 0 };
    let stretchWindowSongStart = 0;
    let stretchWindowSongEnd = 0;

    function applyListenGains() {
      const g = listenGains(listenMode, drumsSupported && !!drumsBuf);
      muteBass = listenMode === "mute";
      if (midiBass) g.bass = 0;
      if (midiDrums) g.drums = 0;
      if (bassGain) bassGain.gain.value = g.bass;
      if (noBassGain) noBassGain.gain.value = g.noBass;
      if (drumsGain) drumsGain.gain.value = g.drums;
      if (midiBassGain) midiBassGain.gain.value = midiBass ? 1 : 0;
      if (midiDrumsGain) midiDrumsGain.gain.value = midiDrums ? 1 : 0;
      if (midiChordsGain) midiChordsGain.gain.value = midiChords ? 1 : 0;
    }
    function ensureMidiGraph() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (!midiBassGain) {
        midiBassGain = audioCtx.createGain();
        midiDrumsGain = audioCtx.createGain();
        midiChordsGain = audioCtx.createGain();
        midiBassGain.connect(audioCtx.destination);
        midiDrumsGain.connect(audioCtx.destination);
        midiChordsGain.connect(audioCtx.destination);
      }
      applyListenGains();
      return audioCtx;
    }
    function cancelMidi() {
      for (let i = 0; i < midiNodes.length; i++) {
        const n = midiNodes[i];
        try { if (n.stop) n.stop(0); } catch (e) {}
        try { if (n.disconnect) n.disconnect(); } catch (e) {}
      }
      midiNodes = [];
    }
    function playBassSynthNote(when, dur, midi) {
      const v = BASS_MIDI_VOICE;
      const filt = audioCtx.createBiquadFilter();
      filt.type = v.filterType;
      filt.frequency.value = v.filterFreq;
      if (filt.Q) filt.Q.value = v.filterQ;
      filt.connect(midiBassGain);
      const len = Math.max(v.minDur, dur || 0.2);
      const attack = Math.min(v.attack, len * 0.35);
      const release = Math.min(v.release, len * 0.45);
      const peakAt = when + attack;
      const releaseAt = Math.max(peakAt, when + len - release);
      const layers = [
        { midiOffset: 0, peak: v.peakGain },
        { midiOffset: v.octaveSemitones || 0, peak: v.octaveGain || 0 },
      ];
      for (const layer of layers) {
        if (!(layer.peak > 0)) continue;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = v.oscType; // soft sine — no saw/square grit
        osc.frequency.value = midiToFreq(Number(midi) + layer.midiOffset);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(layer.peak, peakAt);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, layer.peak * 0.9), releaseAt);
        g.gain.exponentialRampToValueAtTime(0.0001, when + len);
        osc.connect(g);
        g.connect(filt);
        osc.start(when);
        osc.stop(when + len + 0.02);
        midiNodes.push(osc);
        midiNodes.push(g);
      }
      midiNodes.push(filt);
    }
    function playChordSynthNote(when, dur, midi) {
      const v = CHORD_MIDI_VOICE;
      if (!midiChordsGain) return;
      const filt = audioCtx.createBiquadFilter();
      filt.type = v.filterType;
      filt.frequency.value = v.filterFreq;
      if (filt.Q) filt.Q.value = v.filterQ;
      filt.connect(midiChordsGain);
      const len = Math.max(v.minDur, dur || 0.4);
      const attack = Math.min(v.attack, len * 0.35);
      const release = Math.min(v.release, len * 0.4);
      const peakAt = when + attack;
      const releaseAt = Math.max(peakAt, when + len - release);
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = v.oscType;
      osc.frequency.value = midiToFreq(Number(midi));
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(v.peakGain, peakAt);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v.peakGain * 0.85), releaseAt);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      osc.connect(g);
      g.connect(filt);
      osc.start(when);
      osc.stop(when + len + 0.03);
      midiNodes.push(osc);
      midiNodes.push(g);
      midiNodes.push(filt);
    }
    function playDrumSynthHit(when, kind) {
      const g = audioCtx.createGain();
      g.connect(midiDrumsGain);
      if (kind === "kick") {
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(140, when);
        osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.7, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
        osc.connect(g);
        osc.start(when);
        osc.stop(when + 0.2);
        midiNodes.push(osc);
      } else if (kind === "snare") {
        const bufLen = Math.max(1, Math.floor(audioCtx.sampleRate * 0.12));
        const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        const srcN = audioCtx.createBufferSource();
        srcN.buffer = buf;
        const filt = audioCtx.createBiquadFilter();
        filt.type = "bandpass";
        filt.frequency.value = 1800;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.45, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
        srcN.connect(filt);
        filt.connect(g);
        srcN.start(when);
        srcN.stop(when + 0.13);
        midiNodes.push(srcN);
        midiNodes.push(filt);
      } else {
        const bufLen = Math.max(1, Math.floor(audioCtx.sampleRate * 0.04));
        const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        const srcN = audioCtx.createBufferSource();
        srcN.buffer = buf;
        const filt = audioCtx.createBiquadFilter();
        filt.type = "highpass";
        filt.frequency.value = 7000;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.22, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
        srcN.connect(filt);
        filt.connect(g);
        srcN.start(when);
        srcN.stop(when + 0.05);
        midiNodes.push(srcN);
        midiNodes.push(filt);
      }
      midiNodes.push(g);
    }
    function currentPatAndHat() {
      const sec = SECS[secIdx];
      const patsRaw = PATS_EFF[sec.id] || PATS_EFF[sec.kind] || PATS[sec.id] || PATS[sec.kind] || PATS.intro;
      const pats = Array.isArray(patsRaw) ? patsRaw : [patsRaw];
      const pat = pats[0] || PEDAL;
      const rhythmOut = isRhythmOut(pat);
      const drumsOut = isDrumsOut(sec, pat);
      const hat16 = !rhythmOut && !drumsOut && (sec.kind === "bridge" || sec.kind === "vamp" || sec.kind === "ah" || sec.kind === "tag");
      return { pat, hat16, rhythmOut, drumsOut, sec };
    }
    function scheduleMidi(atSongTime) {
      cancelMidi();
      if (!midiBass && !midiDrums && !midiChords) return;
      midiScheduleGen += 1;
      ensureMidiGraph();
      const { pat, hat16, rhythmOut, drumsOut } = currentPatAndHat();
      const viewLo = lo;
      const viewHi = hi;
      const n = viewHi - viewLo + 1;
      const steps = n * 16;
      const when0 = audioCtx.currentTime;
      const song0 = atSongTime;
      const rate = playbackRate > 0 ? playbackRate : 1;
      const barTimeAt = (i) => (i >= NBARS ? DURATION : BARS[Math.max(0, Math.min(NBARS - 1, i))].t);
      // Full rhythm-out: skip bass/drums MIDI (no invent). Chord MIDI still allowed (harmony line).
      if (!rhythmOut && midiBass) {
        const notes = expandPatternNotes(pat, n).filter((note) => note.step < steps);
        notes.sort((a, b) => a.step - b.step);
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          const songT = stepToSongTime(viewLo, note.step, barTimeAt);
          if (songT + 0.001 < song0) continue;
          const nextStep = i + 1 < notes.length ? notes[i + 1].step : note.step + 4;
          const nextT = stepToSongTime(viewLo, Math.min(nextStep, steps), barTimeAt);
          const dur = Math.max(0.06, Math.min(0.45, (nextT - songT) * 0.9));
          playBassSynthNote(when0 + (songT - song0) / rate, dur / rate, note.midi);
        }
      }
      if (!rhythmOut && midiDrums) {
        const hits = drumHitsForView(n, hat16, viewLo, {
          rhythmOut, drumsOut, drumsOutBars: DRUMS_OUT_BARS, drumHits: SONG_DRUM_HITS,
        }).filter((h) => h.step < steps);
        for (let i = 0; i < hits.length; i++) {
          const h = hits[i];
          const songT = stepToSongTime(viewLo, h.step, barTimeAt);
          if (songT + 0.001 < song0) continue;
          playDrumSynthHit(when0 + (songT - song0) / rate, h.kind);
        }
      }
      if (midiChords) {
        for (let i = 0; i < n; i++) {
          const barIdx = viewLo + i;
          const row = BARS[barIdx];
          if (!row || !row.chord) continue;
          const tones = chordToneMidis(row.chord);
          if (!tones.length) continue;
          const songT = barTimeAt(barIdx);
          const songEnd = barTimeAt(barIdx + 1);
          if (songEnd + 0.001 < song0) continue;
          const startSong = Math.max(songT, song0);
          const durSong = Math.max(0.12, (songEnd - startSong) * 0.92);
          const when = when0 + (startSong - song0) / rate;
          const dur = durSong / rate;
          for (let ti = 0; ti < tones.length; ti++) {
            playChordSynthNote(when, dur, tones[ti]);
          }
        }
      }
    }
    function setMidi(which, on) {
      if (which === "bass") midiBass = Boolean(on);
      else if (which === "drums") midiDrums = Boolean(on);
      else if (which === "chords" || which === "chord") midiChords = Boolean(on);
      else return;
      applyListenGains();
      if (playing) {
        ensureMidiGraph();
        if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
        scheduleMidi(t);
      }
      render();
    }
    function toggleMidi(which) {
      if (which === "bass") setMidi("bass", !midiBass);
      else if (which === "drums") setMidi("drums", !midiDrums);
      else if (which === "chords" || which === "chord") setMidi("chords", !midiChords);
    }
    /** Cancel old MIDI voices and schedule the current section/view from song time.
     *  Used on section boundaries (auto-advance and MIDI-only seeks) without restarting stems. */
    function rescheduleMidiForTransport(atSongTime) {
      if (!playing) return;
      if (!midiBass && !midiDrums && !midiChords) return;
      try {
        ensureMidiGraph();
        if (audioCtx && audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
        scheduleMidi(atSongTime != null ? atSongTime : t);
      } catch (err) {
        console.warn("midi reschedule failed", err);
      }
    }
    function ensureInsightMidiGraph() {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (!insightBassGain) {
        insightBassGain = audioCtx.createGain();
        insightDrumsGain = audioCtx.createGain();
        insightChordsGain = audioCtx.createGain();
        insightBassGain.gain.value = 1;
        insightDrumsGain.gain.value = 1;
        insightChordsGain.gain.value = 1;
        insightBassGain.connect(audioCtx.destination);
        insightDrumsGain.connect(audioCtx.destination);
        insightChordsGain.connect(audioCtx.destination);
      }
      return audioCtx;
    }
    function cancelInsightMidi() {
      if (insightMidiLoopTimer) {
        clearTimeout(insightMidiLoopTimer);
        insightMidiLoopTimer = null;
      }
      for (let i = 0; i < insightMidiNodes.length; i++) {
        const n = insightMidiNodes[i];
        try { if (n.stop) n.stop(0); } catch (e) {}
        try { if (n.disconnect) n.disconnect(); } catch (e) {}
      }
      insightMidiNodes = [];
      insightMidiVoice = null;
      insightMidiPlaying = false;
    }
    function insightVoiceFromToggles(layer) {
      if (layer === "harmony") return insightMidiChordsOn ? "chords" : null;
      if (insightMidiBassOn && insightMidiDrumsOn) return "all";
      if (insightMidiBassOn) return "bass";
      if (insightMidiDrumsOn) return "drums";
      return null;
    }
    function stopInsightMidiNodesOnly() {
      for (let i = 0; i < insightMidiNodes.length; i++) {
        const n = insightMidiNodes[i];
        try { if (n.stop) n.stop(0); } catch (e) {}
        try { if (n.disconnect) n.disconnect(); } catch (e) {}
      }
      insightMidiNodes = [];
    }
    function playInsightBassNote(when, dur, midi) {
      const v = BASS_MIDI_VOICE;
      const filt = audioCtx.createBiquadFilter();
      filt.type = v.filterType;
      filt.frequency.value = v.filterFreq;
      if (filt.Q) filt.Q.value = v.filterQ;
      filt.connect(insightBassGain);
      const len = Math.max(v.minDur, dur || 0.2);
      const attack = Math.min(v.attack, len * 0.35);
      const release = Math.min(v.release, len * 0.45);
      const peakAt = when + attack;
      const releaseAt = Math.max(peakAt, when + len - release);
      const layers = [
        { midiOffset: 0, peak: v.peakGain },
        { midiOffset: v.octaveSemitones || 0, peak: v.octaveGain || 0 },
      ];
      for (const layer of layers) {
        if (!(layer.peak > 0)) continue;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = v.oscType;
        osc.frequency.value = midiToFreq(Number(midi) + layer.midiOffset);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(layer.peak, peakAt);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0001, layer.peak * 0.9), releaseAt);
        g.gain.exponentialRampToValueAtTime(0.0001, when + len);
        osc.connect(g);
        g.connect(filt);
        osc.start(when);
        osc.stop(when + len + 0.02);
        insightMidiNodes.push(osc);
        insightMidiNodes.push(g);
      }
      insightMidiNodes.push(filt);
    }
    function playInsightChordNote(when, dur, midi) {
      const v = CHORD_MIDI_VOICE;
      const filt = audioCtx.createBiquadFilter();
      filt.type = v.filterType;
      filt.frequency.value = v.filterFreq;
      if (filt.Q) filt.Q.value = v.filterQ;
      filt.connect(insightChordsGain);
      const len = Math.max(v.minDur, dur || 0.4);
      const attack = Math.min(v.attack, len * 0.35);
      const release = Math.min(v.release, len * 0.4);
      const peakAt = when + attack;
      const releaseAt = Math.max(peakAt, when + len - release);
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = v.oscType;
      osc.frequency.value = midiToFreq(Number(midi));
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(v.peakGain, peakAt);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v.peakGain * 0.85), releaseAt);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      osc.connect(g);
      g.connect(filt);
      osc.start(when);
      osc.stop(when + len + 0.03);
      insightMidiNodes.push(osc);
      insightMidiNodes.push(g);
      insightMidiNodes.push(filt);
    }
    function playInsightDrumHit(when, kind) {
      const g = audioCtx.createGain();
      g.connect(insightDrumsGain);
      if (kind === "kick") {
        const osc = audioCtx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(140, when);
        osc.frequency.exponentialRampToValueAtTime(45, when + 0.12);
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.7, when + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
        osc.connect(g);
        osc.start(when);
        osc.stop(when + 0.2);
        insightMidiNodes.push(osc);
      } else if (kind === "snare") {
        const bufLen = Math.max(1, Math.floor(audioCtx.sampleRate * 0.12));
        const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        const srcN = audioCtx.createBufferSource();
        srcN.buffer = buf;
        const filt = audioCtx.createBiquadFilter();
        filt.type = "bandpass";
        filt.frequency.value = 1800;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.45, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
        srcN.connect(filt);
        filt.connect(g);
        srcN.start(when);
        srcN.stop(when + 0.13);
        insightMidiNodes.push(srcN);
        insightMidiNodes.push(filt);
      } else {
        const bufLen = Math.max(1, Math.floor(audioCtx.sampleRate * 0.04));
        const buf = audioCtx.createBuffer(1, bufLen, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        const srcN = audioCtx.createBufferSource();
        srcN.buffer = buf;
        const filt = audioCtx.createBiquadFilter();
        filt.type = "highpass";
        filt.frequency.value = 7000;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(0.22, when + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
        srcN.connect(filt);
        filt.connect(g);
        srcN.start(when);
        srcN.stop(when + 0.05);
        insightMidiNodes.push(srcN);
        insightMidiNodes.push(filt);
      }
      insightMidiNodes.push(g);
    }
    /** Schedule one claim-window pass of insight MIDI at audio time when0. */
    function scheduleInsightMidiPass(events, which, when0, secPerStep) {
      const step0 = events.step0;
      if (which === "all" || which === "bass") {
        const notes = events.bass.slice().sort((a, b) => a.step - b.step);
        for (let i = 0; i < notes.length; i++) {
          const note = notes[i];
          const next = i + 1 < notes.length ? notes[i + 1].step : note.step + 4;
          const dur = Math.max(0.06, Math.min(0.45, (next - note.step) * secPerStep * 0.9));
          playInsightBassNote(when0 + (note.step - step0) * secPerStep, dur, note.midi);
        }
      }
      if (which === "all" || which === "drums") {
        for (let i = 0; i < events.drums.length; i++) {
          const h = events.drums[i];
          playInsightDrumHit(when0 + (h.step - step0) * secPerStep, h.kind);
        }
      }
      if (which === "chords" || (which === "all" && events.chords.length)) {
        const chords = events.chords;
        for (let i = 0; i < chords.length; i++) {
          const c = chords[i];
          const nextStep = i + 1 < chords.length ? chords[i + 1].step : c.step + 16;
          const dur = Math.max(0.18, (nextStep - c.step) * secPerStep * 0.92);
          const when = when0 + (c.step - step0) * secPerStep;
          for (let ti = 0; ti < c.tones.length; ti++) {
            playInsightChordNote(when, dur, c.tones[ti]);
          }
        }
      }
    }
    /**
     * Play the active insight card claim-window as MIDI (scoped; does not invent on empty).
     * Loops while insightMidiPlaying. Pauses the main transport if it is running.
     * voice: optional override; otherwise derived from Bass/Drums/Chords toggles.
     */
    function playInsightMidi(voice) {
      const sec = SECS[secIdx];
      const deck = CARDS_EFF[sec.id] || CARDS_EFF[sec.kind] || CARDS[sec.id] || CARDS[sec.kind] || CARDS.intro;
      const card = deck[cardIdx % deck.length];
      const insight = card && card.insight;
      if (!insight) return { ok: false, reason: "no-insight" };
      const patsRaw = PATS_EFF[sec.id] || PATS_EFF[sec.kind] || PATS[sec.id] || PATS[sec.kind] || PATS.intro;
      const pats = Array.isArray(patsRaw) ? patsRaw : [patsRaw];
      const secPat = pats[0] || PEDAL;
      const pat = resolveInsightPattern(insight, PATS_EFF) || secPat;
      const which = voice || insightVoiceFromToggles(insight.layer || "figure");
      if (!which) return { ok: false, reason: "no-voice" };
      const events = buildInsightMidiEvents(insight, pat, which);
      // Card Play must stop/pause the main player if it is running.
      if (playing) onPause();
      cancelInsightMidi();
      insightMidiGen += 1;
      const myGen = insightMidiGen;
      insightMidiVoice = which;
      insightMidiPlaying = true;
      ensureInsightMidiGraph();
      if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
      const bpm = Number(demo.bpm) > 0 ? Number(demo.bpm) : 120;
      const secPerBar = (60 / bpm) * 4; // 4/4 claim window
      const secPerStep = secPerBar / 16;
      const windowDur = Math.max(0.25, (events.totalSteps || 16) * secPerStep);
      function armPass() {
        if (myGen !== insightMidiGen || !insightMidiPlaying) return;
        stopInsightMidiNodesOnly();
        const when0 = audioCtx.currentTime + 0.04;
        scheduleInsightMidiPass(events, which, when0, secPerStep);
        if (insightMidiLoopTimer) clearTimeout(insightMidiLoopTimer);
        insightMidiLoopTimer = setTimeout(armPass, Math.round(windowDur * 1000));
      }
      armPass();
      render();
      return {
        ok: true,
        voice: which,
        bass: events.bass.length,
        drums: events.drums.length,
        chords: events.chords.length,
        empty: events.empty,
        looping: true,
        playing: true,
        gen: insightMidiGen,
        nodeCount: insightMidiNodes.length,
        windowDur,
      };
    }
    function toggleInsightMidiPlay() {
      if (insightMidiPlaying) {
        cancelInsightMidi();
        render();
        return { ok: true, playing: false };
      }
      return playInsightMidi();
    }
    function toggleInsightMidiVoice(voice) {
      const v = String(voice || "");
      if (v === "bass") insightMidiBassOn = !insightMidiBassOn;
      else if (v === "drums") insightMidiDrumsOn = !insightMidiDrumsOn;
      else if (v === "chords" || v === "chord") insightMidiChordsOn = !insightMidiChordsOn;
      else return { ok: false, reason: "bad-voice" };
      if (insightMidiPlaying) {
        const r = playInsightMidi();
        return Object.assign({ toggled: v }, r);
      }
      render();
      return {
        ok: true,
        toggled: v,
        playing: false,
        bassOn: insightMidiBassOn,
        drumsOn: insightMidiDrumsOn,
        chordsOn: insightMidiChordsOn,
      };
    }
    function setListenMode(mode) {
      const next = mode === listenMode ? "full" : mode;
      if ((next === "db" || next === "drums") && !drumsSupported) return listenMode;
      listenMode = next;
      applyListenGains();
      render();
      return listenMode;
    }

    function beginStemFetch() {
      if (!muteBassSupported) return null;
      if (stemFetchPromise) return stemFetchPromise;
      if (!stemUrls.bass || !stemUrls.noBass) return null;
      stemFetchCount += 1;
      const jobs = [
        fetch(stemUrls.bass).then((r) => { if (!r.ok) throw new Error("bass stem " + r.status); return r.arrayBuffer(); }),
        fetch(stemUrls.noBass).then((r) => { if (!r.ok) throw new Error("no_bass stem " + r.status); return r.arrayBuffer(); }),
      ];
      if (stemUrls.drums) {
        jobs.push(fetch(stemUrls.drums).then((r) => { if (!r.ok) throw new Error("drums stem " + r.status); return r.arrayBuffer(); }));
      }
      stemFetchPromise = Promise.all(jobs).then((bufs) => {
        stemRawBuffers = { bass: bufs[0], noBass: bufs[1], drums: bufs[2] || null };
        return stemRawBuffers;
      }).catch((err) => {
        stemFetchPromise = null;
        throw err;
      });
      return stemFetchPromise;
    }

    async function ensureAudio() {
      if (!muteBassSupported) return false;
      if (audioReady) return true;
      if (ensureAudioPromise) return ensureAudioPromise;
      stemLoading = true;
      ensureAudioPromise = (async () => {
        try {
          if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const bufs = stemRawBuffers || (await beginStemFetch());
          if (!bufs) throw new Error("no stem urls");
          // Decode both stems in parallel (AAC/m4a preferred).
          const decodeJobs = [
            audioCtx.decodeAudioData(bufs.bass.slice(0)),
            audioCtx.decodeAudioData(bufs.noBass.slice(0)),
          ];
          if (bufs.drums) decodeJobs.push(audioCtx.decodeAudioData(bufs.drums.slice(0)));
          const decoded = await Promise.all(decodeJobs);
          bassBuf = decoded[0];
          noBassBuf = decoded[1];
          drumsBuf = decoded[2] || null;
          stretchCache = new Map();
          if (!bassGain) {
            bassGain = audioCtx.createGain();
            noBassGain = audioCtx.createGain();
            drumsGain = audioCtx.createGain();
            bassGain.connect(audioCtx.destination);
            noBassGain.connect(audioCtx.destination);
            drumsGain.connect(audioCtx.destination);
          }
          applyListenGains();
          audioReady = true;
          return true;
        } finally {
          stemLoading = false;
        }
      })();
      try {
        return await ensureAudioPromise;
      } catch (err) {
        ensureAudioPromise = null;
        throw err;
      }
    }

    // Private player: start compressed stem fetch on load; warm decode on first gesture.
    if (muteBassSupported && privateMode) {
      beginStemFetch();
      const warmDecode = () => {
        document.removeEventListener("pointerdown", warmDecode, true);
        ensureAudio().catch(() => {});
      };
      document.addEventListener("pointerdown", warmDecode, true);
    }
    let playGen = 0;

    function stopStemNodes() {
      try { if (bassSrc) bassSrc.stop(0); } catch (e) {}
      try { if (noBassSrc) noBassSrc.stop(0); } catch (e) {}
      try { if (drumsSrc) drumsSrc.stop(0); } catch (e) {}
      bassSrc = noBassSrc = drumsSrc = null;
      usingAudio = false;
      cancelMidi();
    }
    function suspendAudioCtx() {
      if (!audioCtx) return;
      try {
        if (audioCtx.state === "running" && typeof audioCtx.suspend === "function") {
          const p = audioCtx.suspend();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }
      } catch (e) {}
    }
    function haltPlayback({ syncTime = false, resetToLoopStart = false } = {}) {
      playGen += 1;
      playing = false;
      if (timer) { clearInterval(timer); timer = null; }
      if (syncTime && usingAudio) syncTransportFromAudio();
      stopStemNodes();
      suspendAudioCtx();
      if (resetToLoopStart) t = BARS[lo].t;
    }
    function sliceAudioBuffer(buffer, songStart, songEnd, createBuf) {
      const sr = buffer.sampleRate || 44100;
      const chans = buffer.numberOfChannels || 1;
      // Map song-time through reported duration → real samples. Test fixtures (and
      // some decoders) may set buffer.duration to study length while length is short;
      // real stems have duration ≈ length/sampleRate (scale ≈ 1).
      const realDur = buffer.length > 0 ? buffer.length / sr : 0;
      const reportedDur = (buffer.duration > 0 ? buffer.duration : realDur) || realDur || 1;
      const scale = realDur / reportedDur;
      const a0 = Math.max(0, Math.min(realDur, (songStart || 0) * scale));
      const a1 = Math.max(a0 + (1 / sr), Math.min(realDur, (songEnd || 0) * scale));
      const i0 = Math.max(0, Math.min(buffer.length, Math.floor(a0 * sr)));
      const i1 = Math.max(i0 + 1, Math.min(buffer.length, Math.ceil(a1 * sr)));
      const len = Math.max(1, i1 - i0);
      const out = createBuf(chans, len, sr);
      for (let c = 0; c < chans; c++) {
        const ch = buffer.getChannelData(c);
        const dest = out.getChannelData(c);
        dest.set(ch.subarray(i0, Math.min(i0 + dest.length, ch.length)));
      }
      return out;
    }
    function getStretchedStemBuffers(rate, songStart) {
      const createBuf = (ch, len, sr) => audioCtx.createBuffer(ch, len, sr);
      const maxSong = Math.min(
        DURATION,
        bassBuf.duration || DURATION,
        noBassBuf.duration || DURATION,
        drumsBuf ? (drumsBuf.duration || DURATION) : DURATION,
      );
      const start = Math.max(0, Math.min(Math.max(0, maxSong - 0.01), songStart || 0));
      if (rate === 1) {
        stretchWindowSongStart = 0;
        stretchWindowSongEnd = maxSong;
        return {
          bass: bassBuf,
          noBass: noBassBuf,
          drums: drumsBuf,
          windowSongStart: 0,
          windowSongEnd: maxSong,
          bufferOffsetSong: start,
          fullBuffer: true,
        };
      }
      const sr0 = bassBuf.sampleRate || 44100;
      const realDur = bassBuf.length > 0 ? bassBuf.length / sr0 : maxSong;
      // Short stems (≤ window): full stretch is cheap — used by fixtures and short demos.
      // Long stems: ONLY stretch a playhead window (full-track WSOLA freezes/OOMs the page).
      if (realDur <= STRETCH_WINDOW_SONG_S + 0.05) {
        const key = String(rate) + "@full";
        if (stretchCache.has(key)) {
          const hit = stretchCache.get(key);
          stretchWindowSongStart = hit.windowSongStart;
          stretchWindowSongEnd = hit.windowSongEnd;
          return hit;
        }
        const packed = {
          bass: stretchAudioBuffer(bassBuf, rate, createBuf, INTERACTIVE_STRETCH_OPTS),
          noBass: stretchAudioBuffer(noBassBuf, rate, createBuf, INTERACTIVE_STRETCH_OPTS),
          drums: drumsBuf ? stretchAudioBuffer(drumsBuf, rate, createBuf, INTERACTIVE_STRETCH_OPTS) : null,
          windowSongStart: 0,
          windowSongEnd: maxSong,
          bufferOffsetSong: start,
          fullBuffer: true,
        };
        stretchCache.set(key, packed);
        stretchWindowSongStart = 0;
        stretchWindowSongEnd = maxSong;
        return packed;
      }
      const winEnd = Math.min(maxSong, start + STRETCH_WINDOW_SONG_S);
      const key = String(rate) + "@" + start.toFixed(2) + "-" + winEnd.toFixed(2);
      if (stretchCache.has(key)) {
        const hit = stretchCache.get(key);
        stretchWindowSongStart = hit.windowSongStart;
        stretchWindowSongEnd = hit.windowSongEnd;
        return hit;
      }
      // Pitch-preserving path: WSOLA/OLA-stretch a playhead window, play at source rate 1.
      // Never drive tempo via BufferSource.playbackRate alone (that shifts pitch).
      // Never stretch the full track synchronously (freeze/OOM on multi-minute stems).
      const packed = {
        bass: stretchAudioBuffer(sliceAudioBuffer(bassBuf, start, winEnd, createBuf), rate, createBuf, INTERACTIVE_STRETCH_OPTS),
        noBass: stretchAudioBuffer(sliceAudioBuffer(noBassBuf, start, winEnd, createBuf), rate, createBuf, INTERACTIVE_STRETCH_OPTS),
        drums: drumsBuf
          ? stretchAudioBuffer(sliceAudioBuffer(drumsBuf, start, winEnd, createBuf), rate, createBuf, INTERACTIVE_STRETCH_OPTS)
          : null,
        windowSongStart: start,
        windowSongEnd: winEnd,
        bufferOffsetSong: start,
        fullBuffer: false,
      };
      // Keep a couple of recent windows only — full-track cache was a memory bomb.
      stretchCache.set(key, packed);
      if (stretchCache.size > 4) {
        const first = stretchCache.keys().next().value;
        stretchCache.delete(first);
      }
      stretchWindowSongStart = start;
      stretchWindowSongEnd = winEnd;
      return packed;
    }
    function startStemNodes(atTime) {
      if (!audioReady || !audioCtx || !bassBuf || !noBassBuf) return;
      const rate = playbackRate > 0 ? playbackRate : 1;
      // Clamp to both study duration and *original* buffer lengths (song time domain).
      const maxStart = Math.min(
        DURATION,
        bassBuf.duration || DURATION,
        noBassBuf.duration || DURATION,
        drumsBuf ? (drumsBuf.duration || DURATION) : DURATION,
      ) - 0.01;
      const start = Math.max(0, Math.min(maxStart, atTime));
      let playBufs;
      try {
        // Build stretched window BEFORE stopping current audio so a slow/failed stretch
        // does not leave the player silent/broken mid-tap.
        playBufs = getStretchedStemBuffers(rate, start);
      } catch (err) {
        console.warn("stem stretch failed", err);
        return;
      }
      // rate=1 / short full-stretch: offset into buffer. Long windowed stretch: offset 0.
      let bufferOffset = 0;
      if (rate === 1) {
        bufferOffset = start;
      } else if (playBufs.fullBuffer) {
        const reported = bassBuf.duration > 0 ? bassBuf.duration : (bassBuf.length / (bassBuf.sampleRate || 44100));
        const real = bassBuf.length / (bassBuf.sampleRate || 44100);
        const scale = reported > 0 ? real / reported : 1;
        bufferOffset = (start * scale) / rate;
      }
      const maxBuf = Math.min(
        playBufs.bass.duration || bufferOffset,
        playBufs.noBass.duration || bufferOffset,
        playBufs.drums ? (playBufs.drums.duration || bufferOffset) : bufferOffset,
      ) - 0.01;
      const bufStart = Math.max(0, Math.min(Math.max(0, maxBuf), bufferOffset));
      stopStemNodes();
      bassSrc = audioCtx.createBufferSource();
      noBassSrc = audioCtx.createBufferSource();
      bassSrc.buffer = playBufs.bass;
      noBassSrc.buffer = playBufs.noBass;
      bassSrc.connect(bassGain);
      noBassSrc.connect(noBassGain);
      if (playBufs.drums && drumsGain) {
        drumsSrc = audioCtx.createBufferSource();
        drumsSrc.buffer = playBufs.drums;
        drumsSrc.connect(drumsGain);
      } else {
        drumsSrc = null;
      }
      applyListenGains();
      // Source rate stays 1 — tempo came from WSOLA length, pitch unchanged.
      lastStemSourcePlaybackRate = 1;
      try {
        bassSrc.playbackRate.value = 1;
        noBassSrc.playbackRate.value = 1;
        if (drumsSrc) drumsSrc.playbackRate.value = 1;
      } catch (e) { /* older engines */ }
      const when = audioCtx.currentTime;
      try {
        bassSrc.start(when, bufStart);
        noBassSrc.start(when, bufStart);
        if (drumsSrc) drumsSrc.start(when, bufStart);
      } catch (err) {
        console.warn("stem start failed", err);
        bassSrc = noBassSrc = drumsSrc = null;
        usingAudio = false;
        return;
      }
      audioStartedAt = when;
      audioOffset = start;
      usingAudio = true;
      if (midiBass || midiDrums || midiChords) scheduleMidi(start);
    }
    function syncTransportFromAudio() {
      if (!usingAudio || !audioCtx) return;
      const rate = playbackRate > 0 ? playbackRate : 1;
      t = audioOffset + (audioCtx.currentTime - audioStartedAt) * rate;
    }
    function setPlaybackRate(rate) {
      const r = Number(rate);
      if (!PLAYBACK_RATES.includes(r)) return;
      // Keep song position continuous across rate changes.
      if (usingAudio && audioCtx) syncTransportFromAudio();
      const prev = playbackRate;
      playbackRate = r;
      try {
        if (playing) {
          if (audioReady && bassBuf && noBassBuf) startStemNodes(t);
          else if (midiBass || midiDrums || midiChords) scheduleMidi(t);
        }
      } catch (err) {
        console.warn("setPlaybackRate failed", err);
        playbackRate = prev;
      }
      render();
    }

    // Prefer cached layout rect: mid-drag render() tears down the SVG, so live
    // getBoundingClientRect() returns 0×0 and barFromViewX clamps to viewHi (section end).
    function viewXFromClient(clientX, sess) {
      const w = Math.max(sess.rectWidth, 1);
      return ((clientX - sess.rectLeft) / w) * VBW;
    }
    function bindStaffDrag(svg, getView, onSeek, onLoopBars) {
      svg.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const { viewLo, viewHi } = getView();
        const rect = svg.getBoundingClientRect();
        const sess = {
          svg,
          rectLeft: rect.left,
          rectWidth: Math.max(rect.width, 1),
          startClientX: e.clientX,
          startClientY: e.clientY,
          startBar: barFromViewX(viewXFromClient(e.clientX, { rectLeft: rect.left, rectWidth: Math.max(rect.width, 1) }), viewLo, viewHi),
          curBar: 0,
          moved: false,
        };
        sess.curBar = sess.startBar;
        dragSession.current = sess;
        const onMove = (ev) => {
          const s = dragSession.current; if (!s) return;
          ev.preventDefault();
          if (!s.moved && Math.hypot(ev.clientX - s.startClientX, ev.clientY - s.startClientY) >= DRAG_THRESHOLD_PX) s.moved = true;
          const v = getView();
          s.curBar = barFromViewX(viewXFromClient(ev.clientX, s), v.viewLo, v.viewHi);
          if (s.moved) render();
        };
        const onUp = (ev) => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
          const s = dragSession.current; dragSession.current = null;
          if (!s) return;
          const v = getView();
          const endBar = barFromViewX(viewXFromClient(ev.clientX, s), v.viewLo, v.viewHi);
          const moved = s.moved || Math.hypot(ev.clientX - s.startClientX, ev.clientY - s.startClientY) >= DRAG_THRESHOLD_PX;
          if (!moved) onSeek(timeFromViewX(viewXFromClient(ev.clientX, s), v.viewLo, v.viewHi));
          else onLoopBars(Math.min(s.startBar, endBar), Math.max(s.startBar, endBar));
          render();
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      });
      // touch — same cached-rect rule
      svg.addEventListener("touchstart", (e) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const { viewLo, viewHi } = getView();
        const rect = svg.getBoundingClientRect();
        const sess = {
          svg,
          rectLeft: rect.left,
          rectWidth: Math.max(rect.width, 1),
          startClientX: touch.clientX,
          startClientY: touch.clientY,
          startBar: barFromViewX(viewXFromClient(touch.clientX, { rectLeft: rect.left, rectWidth: Math.max(rect.width, 1) }), viewLo, viewHi),
          curBar: 0,
          moved: false,
          touch: true,
        };
        sess.curBar = sess.startBar;
        dragSession.current = sess;
      }, { passive: true });
      svg.addEventListener("touchmove", (e) => {
        const s = dragSession.current; if (!s || !s.touch) return;
        const touch = e.touches[0];
        if (!s.moved && Math.hypot(touch.clientX - s.startClientX, touch.clientY - s.startClientY) >= DRAG_THRESHOLD_PX) s.moved = true;
        const v = getView();
        s.curBar = barFromViewX(viewXFromClient(touch.clientX, s), v.viewLo, v.viewHi);
        if (s.moved) { e.preventDefault(); render(); }
      }, { passive: false });
      svg.addEventListener("touchend", (e) => {
        const s = dragSession.current; dragSession.current = null;
        if (!s || !s.touch) return;
        const touch = e.changedTouches[0];
        const v = getView();
        const endBar = barFromViewX(viewXFromClient(touch.clientX, s), v.viewLo, v.viewHi);
        if (!s.moved) onSeek(timeFromViewX(viewXFromClient(touch.clientX, s), v.viewLo, v.viewHi));
        else onLoopBars(Math.min(s.startBar, endBar), Math.max(s.startBar, endBar));
        render();
      });
    }

    function applySection(i, seekToStart) {
      const s = SECS[i];
      secIdx = i; lo = s.first; hi = s.end - 1; cardIdx = 0;
      if (seekToStart) t = BARS[s.first].t;
    }
    function pickSection(i) {
      if (i < 0 || i >= SECS.length) return;
      cancelInsightMidi();
      applySection(i, true);
      // Timeline tap: always loop the whole section and dim others (locked UX).
      loopOn = true;
      lo = SECS[i].first;
      hi = SECS[i].end - 1;
      // While playing with stems, restart audio at the new section time (visual t alone is overwritten by audio clock).
      // MIDI-only (no stems / audio not ready): still cancel+reschedule so the new section is audible.
      if (playing && audioReady) startStemNodes(t);
      else if (playing) rescheduleMidiForTransport(t);
      render();
    }
    function clearSubsection() {
      const sec = SECS[secIdx];
      const partial = lo > sec.first || hi < sec.end - 1;
      if (!partial) return;
      lo = sec.first;
      hi = sec.end - 1;
      loopOn = true;
      t = BARS[lo].t;
      if (playing && audioReady) startStemNodes(t);
      else if (playing) rescheduleMidiForTransport(t);
      render();
    }
    function nextSection() {
      if (secIdx + 1 < SECS.length) pickSection(secIdx + 1);
    }
    function leftArrowNav() {
      const restartT = loopOn ? BARS[lo].t : BARS[SECS[secIdx].first].t;
      if (t > restartT + LEFT_RESTART_THRESHOLD_S) {
        onSeek(restartT);
        return;
      }
      if (secIdx > 0) pickSection(secIdx - 1);
      else onSeek(restartT);
    }
    function onSeek(time) {
      let clamped = Math.max(0, Math.min(DURATION, time));
      if (loopOn) {
        const b = barAt(clamped);
        if (b < lo || b > hi) { t = BARS[lo].t; render(); return; }
      }
      t = clamped;
      if (!loopOn) {
        const i = secIndexOfBar(barAt(clamped));
        if (i !== secIdx) applySection(i, false);
      }
      if (playing && audioReady) startStemNodes(t);
      else if (playing) rescheduleMidiForTransport(t);
      render();
    }
    function onLoopBars(a, b) {
      const sec = SECS[secIdx];
      lo = Math.max(sec.first, Math.min(a, b));
      hi = Math.min(sec.end - 1, Math.max(a, b));
      loopOn = true; t = BARS[lo].t;
      if (playing && audioReady) startStemNodes(t);
      else if (playing) rescheduleMidiForTransport(t);
      render();
    }
    function onPause() {
      if (!playing && !timer && !usingAudio) { render(); return; }
      haltPlayback({ syncTime: true, resetToLoopStart: false });
      render();
    }
    function onPlay() {
      // Toggle: while playing (or kick in flight), pause must win for Safari.
      if (playing) { onPause(); return; }
      if (insightMidiPlaying) cancelInsightMidi();
      const ls = BARS[lo].t, le = barTime(hi + 1);
      if (loopOn && (t < ls || t >= le)) t = ls;
      if (t >= DURATION) t = ls;
      playing = true;
      const myGen = ++playGen;
      const kick = async () => {
        if (muteBassSupported) {
          try {
            if (!audioReady) { stemLoading = true; render(); }
            await ensureAudio();
            if (myGen === playGen) render();
            if (myGen !== playGen || !playing) return;
            if (audioCtx && audioCtx.state === "suspended") await audioCtx.resume();
            if (myGen !== playGen || !playing) return;
            startStemNodes(t);
          } catch (err) {
            console.warn("stem audio failed, visual-only", err);
          }
        }
        if (myGen !== playGen || !playing) return;
        if ((midiBass || midiDrums || midiChords) && !usingAudio) {
          try {
            ensureMidiGraph();
            if (audioCtx.state === "suspended" && audioCtx.resume) await audioCtx.resume();
            if (myGen === playGen && playing) scheduleMidi(t);
          } catch (err) { console.warn("midi schedule failed", err); }
        }
        if (myGen !== playGen || !playing) return;
        if (timer) { clearInterval(timer); timer = null; }
        timer = setInterval(() => {
          if (!playing || myGen !== playGen) {
            clearInterval(timer); timer = null;
            return;
          }
          const ls2 = BARS[lo].t, le2 = barTime(hi + 1);
          if (usingAudio) {
            syncTransportFromAudio();
            if (loopOn && t >= le2) { t = ls2; startStemNodes(t); }
            else if (
              playbackRate !== 1 &&
              stretchWindowSongEnd > stretchWindowSongStart &&
              t >= stretchWindowSongEnd - STRETCH_RELOAD_MARGIN_S
            ) {
              startStemNodes(t);
            }
          } else {
            t += 0.05 * (playbackRate > 0 ? playbackRate : 1);
            if (loopOn && t >= le2) {
              t = ls2;
              if (midiBass || midiDrums || midiChords) scheduleMidi(t);
            }
          }
          if (t >= DURATION) {
            t = DURATION;
            haltPlayback({ syncTime: false, resetToLoopStart: false });
          }
          if (playing && !loopOn) {
            const i = secIndexOfBar(barAt(t));
            if (i !== secIdx) {
              // Section patterns/view changed — cancel old MIDI voices and schedule the new section.
              // Do NOT restart stem BufferSources here (continuous song audio must keep playing).
              applySection(i, false);
              rescheduleMidiForTransport(t);
            }
          }
          render();
        }, 50);
        render();
      };
      kick();
      render();
    }
    function onStop() {
      haltPlayback({ syncTime: false, resetToLoopStart: true });
      render();
    }

    // persistent layer svg refs rebuilt each render — simpler full re-render for shell
    function selectionOverlay(viewLo, viewHi, y, h) {
      const g = svgEl("g", {});
      const partial = loopOn && (lo > viewLo || hi < viewHi);
      if (partial) {
        const x0 = barEdgeX(lo, viewLo, viewHi), x1 = barEdgeX(hi + 1, viewLo, viewHi);
        g.appendChild(svgEl("rect", { x: x0, y, width: Math.max(x1 - x0, 2), height: h, fill: NEG, opacity: 0.3, stroke: NEG, "stroke-width": 2.5, "pointer-events": "none" }));
      }
      const d = dragSession.current;
      if (d && d.moved) {
        const a = Math.min(d.startBar, d.curBar), b = Math.max(d.startBar, d.curBar);
        const x0 = barEdgeX(a, viewLo, viewHi), x1 = barEdgeX(b + 1, viewLo, viewHi);
        g.appendChild(svgEl("rect", { x: x0, y, width: Math.max(x1 - x0, 2), height: h, fill: NEG, opacity: 0.22, stroke: NEG, "stroke-width": 2, "stroke-dasharray": "5 3", "pointer-events": "none" }));
      }
      return g;
    }

    function makeTimeline() {
      const phone = isPhoneLayout();
      const vh = phone ? 88 : 72;
      const svg = svgEl("svg", {
        viewBox: "0 0 1000 " + vh,
        width: "100%",
        role: "img",
        "aria-label": "Section timeline",
        "data-timeline-phone": phone ? "1" : "0",
        style: { display: "block", maxHeight: vh + "px" },
      });
      const X = (time) => (time / DURATION) * 1000;
      const dimOthers = loopOn;
      const nameFs = phone ? 15 : 11;
      const nameFsShort = phone ? 13 : 10;
      const barFs = phone ? 12 : 10;
      const barY = phone ? 18 : 20;
      const barH = phone ? 44 : 36;
      const labelY = phone ? 14 : 14;
      const barLabelY = phone ? 82 : 66;
      SECS.forEach((s, i) => {
        const x0 = X(secStart(s)), w = X(secEnd(s)) - x0;
        const active = i === secIdx;
        const opacity = dimOthers ? (active ? 1 : 0.22) : (active ? 1 : 0.55);
        const g = svgEl("g", { style: { cursor: "pointer" }, "data-section": String(i) });
        g.appendChild(svgEl("rect", { x: x0, y: barY, width: Math.max(w - 2, 1), height: barH, rx: 4, fill: CAT[s.ci % CAT.length], opacity }));
        const nameFill = dimOthers && !active ? "#6b7280" : "#e5e7eb";
        // Phone: always paint a readable label (abbr when narrow); desktop keeps prior thresholds.
        if (phone) {
          const label = w >= 70 ? s.name : (w >= 36 ? s.name.slice(0, 4) : s.name.slice(0, 2));
          const fs = w >= 70 ? nameFs : nameFsShort;
          g.appendChild(svgEl("text", { x: x0 + 4, y: labelY, "font-size": fs, "font-weight": 700, fill: nameFill, "data-tl-label": label }, [document.createTextNode(label)]));
          if (w >= 40) g.appendChild(svgEl("text", { x: x0 + 4, y: barLabelY, "font-size": barFs, "font-weight": 600, fill: "#9ca3af" }, [document.createTextNode(String(s.first))]));
        } else {
          if (w >= 42) g.appendChild(svgEl("text", { x: x0 + 5, y: labelY, "font-size": nameFs, "font-weight": 600, fill: nameFill }, [document.createTextNode(s.name)]));
          else if (w >= 22) g.appendChild(svgEl("text", { x: x0 + 3, y: labelY, "font-size": nameFsShort, "font-weight": 600, fill: nameFill }, [document.createTextNode(s.name.slice(0, 3))]));
          if (w >= 28) g.appendChild(svgEl("text", { x: x0 + 4, y: barLabelY, "font-size": barFs, fill: "#6b7280" }, [document.createTextNode("bar " + s.first)]));
        }
        svg.appendChild(g);
      });
      if (loopOn) {
        const cur = SECS[secIdx];
        const secXs = X(secStart(cur)), secXe = X(secEnd(cur));
        const g = svgEl("g", { "pointer-events": "none" });
        g.appendChild(svgEl("rect", { x: secXs, y: barY - 2, width: Math.max(secXe - secXs, 2), height: barH + 4, fill: "none", stroke: "#e5e7eb", "stroke-width": 1.5, opacity: 0.55 }));
        const partial = lo > cur.first || hi < cur.end - 1;
        if (partial) {
          const xs = X(BARS[lo].t), xe = X(barTime(hi + 1));
          g.appendChild(svgEl("rect", { x: xs, y: barY - 2, width: Math.max(xe - xs, 2), height: barH + 4, fill: NEG, opacity: 0.34, stroke: NEG, "stroke-width": 2 }));
        }
        svg.appendChild(g);
      }
      const xp = X(Math.min(t, DURATION));
      const y1 = phone ? 6 : 8, y2 = phone ? 84 : 68;
      svg.appendChild(svgEl("line", { x1: xp, x2: xp, y1, y2, stroke: NEG, "stroke-width": 2.5 }));
      svg.appendChild(svgEl("polygon", { points: (xp - 5) + ",2 " + (xp + 5) + ",2 " + xp + ",10", fill: NEG }));
      return svg;
    }


    /** Steps of bass pattern notes whose scheduled MIDI window contains songTime. */
    function soundingBassNoteSteps(songTime, viewLo, n, pat) {
      const steps = n * 16;
      const barTimeAt = (i) => (i >= NBARS ? DURATION : BARS[Math.max(0, Math.min(NBARS - 1, i))].t);
      const notes = expandPatternNotes(pat, n).filter((note) => note.step < steps);
      notes.sort((a, b) => a.step - b.step);
      const out = new Set();
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const songT = stepToSongTime(viewLo, note.step, barTimeAt);
        const nextStep = i + 1 < notes.length ? notes[i + 1].step : note.step + 4;
        const nextT = stepToSongTime(viewLo, Math.min(nextStep, steps), barTimeAt);
        const dur = Math.max(0.06, Math.min(0.45, (nextT - songT) * 0.9));
        if (songTime >= songT - 0.02 && songTime < songT + dur) out.add(note.step);
      }
      return out;
    }
    /** Drum hit steps currently in a short attack window around songTime. */
    function soundingDrumHitSteps(songTime, viewLo, n, hat16, rhythmOut, drumsOut) {
      const steps = n * 16;
      const barTimeAt = (i) => (i >= NBARS ? DURATION : BARS[Math.max(0, Math.min(NBARS - 1, i))].t);
      const hits = drumHitsForView(n, hat16, viewLo, {
        rhythmOut, drumsOut, drumsOutBars: DRUMS_OUT_BARS, drumHits: SONG_DRUM_HITS,
      }).filter((h) => h.step < steps);
      const out = new Set();
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        const songT = stepToSongTime(viewLo, h.step, barTimeAt);
        if (songTime >= songT - 0.02 && songTime < songT + 0.14) out.add(h.step + ":" + h.kind);
      }
      return out;
    }

    function makeChords(viewLo, viewHi, n, playX, bar, kind) {
      const svg = svgEl("svg", { viewBox: "0 0 " + VBW + " 64", width: "100%", height: "100%", preserveAspectRatio: "xMidYMid meet", role: "img", "aria-label": "Chord names", style: { cursor: "crosshair", userSelect: "none", touchAction: "none" } });
      svg.appendChild(selectionOverlay(viewLo, viewHi, 2, 60));
      const bw = W / n;
      for (let i = 0; i < n; i++) {
        const b = BARS[viewLo + i];
        const next = i + 1 < n ? BARS[viewLo + i + 1].chord : "";
        const x = X0 + i * bw;
        const hot = b.bar === bar;
        const sounding = Boolean(midiChords && playing && hot && b.chord);
        const partial = loopOn && (lo > viewLo || hi < viewHi);
        const inSub = partial && b.bar >= lo && b.bar <= hi;
        const g = svgEl("g", {
          "data-chord": b.chord || "",
          "data-bar": String(b.bar),
          "data-sounding": sounding ? "1" : "0",
        });
        g.appendChild(svgEl("rect", { x, y: 2, width: bw - 2, height: 60, rx: 4,
          fill: sounding ? "#1e3a5f" : hot ? "#1f2937" : inSub ? NEG : "transparent",
          opacity: hot || sounding ? 1 : inSub ? 0.18 : 1,
          stroke: sounding ? SOUNDING_HL : (hot || inSub ? NEG : "#374151"),
          "stroke-width": sounding || hot || inSub ? 2 : 1 }));
        g.appendChild(svgEl("text", { x: x + bw / 2, y: 14, "text-anchor": "middle", "font-size": 10, fill: sounding ? "#93c5fd" : "#6b7280" }, [document.createTextNode("bar " + b.bar)]));
        g.appendChild(svgEl("text", { x: x + bw / 2, y: 34, "text-anchor": "middle", "font-size": 20, "font-weight": 700, fill: sounding ? SOUNDING_HL : "#e5e7eb" }, [document.createTextNode(b.chord)]));
        g.appendChild(svgEl("text", { x: x + bw / 2, y: 52, "text-anchor": "middle", "font-size": 13, "font-weight": 600, fill: sounding ? "#93c5fd" : "#d1d5db" }, [document.createTextNode(romanFor(b.chord, kind, next))]));
        svg.appendChild(g);
      }
      svg.appendChild(svgEl("line", { x1: playX, x2: playX, y1: 2, y2: 62, stroke: NEG, "stroke-width": 2.5, "pointer-events": "none" }));
      bindStaffDrag(svg, () => ({ viewLo, viewHi }), onSeek, onLoopBars);
      return svg;
    }

    function makeTab(viewLo, viewHi, n, playX, pat) {
      const svg = svgEl("svg", { viewBox: "0 0 " + VBW + " 96", width: "100%", height: "100%", preserveAspectRatio: "none", role: "img", "aria-label": "Bass tab", style: { cursor: "crosshair", userSelect: "none", touchAction: "none" } });
      const sy = (i) => 22 + i * 16;
      const steps = 16 * n;
      const sx = (s) => X0 + ((s + 0.5) / steps) * W;
      svg.appendChild(selectionOverlay(viewLo, viewHi, 8, sy(3) + 2));
      STRING_NAMES.forEach((name, i) => {
        svg.appendChild(svgEl("text", { x: 14, y: sy(i) + 4, "font-size": 12, fill: "#9ca3af" }, [document.createTextNode(name)]));
        svg.appendChild(svgEl("line", { x1: X0, x2: X0 + W, y1: sy(i), y2: sy(i), stroke: "#4b5563", "stroke-width": 1 }));
      });
      for (let i = 0; i <= n; i++) svg.appendChild(svgEl("line", { x1: X0 + (i / n) * W, x2: X0 + (i / n) * W, y1: sy(0), y2: sy(3), stroke: "#4b5563", "stroke-width": i === 0 || i === n ? 1.5 : 1 }));
      const notes = [];
      for (let b = 0; b < n; b += 2) {
        const off = b * 16;
        pat.notes.forEach((note) => { if (note.step < 32) notes.push({ step: note.step + off, midi: note.midi }); });
      }
      const soundingSteps = (midiBass && playing) ? soundingBassNoteSteps(t, viewLo, n, pat) : new Set();
      notes.filter((note) => note.step < steps).forEach((note) => {
        const pos = tabPos(note.midi);
        const label = String(pos.f);
        const isSounding = soundingSteps.has(note.step);
        const lit = isSounding;
        const g = svgEl("g", {
          "data-midi": String(note.midi),
          "data-step": String(note.step),
          "data-sounding": isSounding ? "1" : "0",
        });
        g.appendChild(svgEl("rect", { x: sx(note.step) - 6 - (label.length - 1) * 3, y: sy(pos.s) - 8, width: 12 + (label.length - 1) * 6, height: 15, fill: lit ? "#1e3a5f" : "#0b0f14", stroke: lit ? SOUNDING_HL : "none", "stroke-width": lit ? 1.5 : 0 }));
        g.appendChild(svgEl("text", { x: sx(note.step), y: sy(pos.s) + 4, "text-anchor": "middle", "font-size": 12, "font-weight": 700, fill: lit ? SOUNDING_HL : "#e5e7eb" }, [document.createTextNode(label)]));
        svg.appendChild(g);
      });
      svg.appendChild(svgEl("line", { x1: playX, x2: playX, y1: 8, y2: sy(3) + 10, stroke: NEG, "stroke-width": 2.5, "pointer-events": "none" }));
      bindStaffDrag(svg, () => ({ viewLo, viewHi }), onSeek, onLoopBars);
      return svg;
    }

    function makeBassStaff(viewLo, viewHi, n, playX, pat) {
      const svg = svgEl("svg", { viewBox: "0 0 " + VBW + " 100", width: "100%", height: "100%", preserveAspectRatio: "none", role: "img", "aria-label": "Bass staff", style: { cursor: "crosshair", userSelect: "none", touchAction: "none" } });
      const steps = 16 * n;
      const sx = (s) => X0 + 10 + ((s + 0.5) / steps) * (W - 10);
      const yy = staffYy;
      const f = yy(6);
      const ink = "#e5e7eb";
      svg.appendChild(selectionOverlay(viewLo, viewHi, 8, 84));
      [0, 2, 4, 6, 8].forEach((pos) => svg.appendChild(svgEl("line", { x1: 10, x2: X0 + W, y1: yy(pos), y2: yy(pos), stroke: "#6b7280", "stroke-width": 1 })));
      svg.appendChild(svgEl("circle", { cx: 22, cy: f, r: 3.5, fill: ink }));
      svg.appendChild(svgEl("path", { d: "M22 " + f + " C 22 " + (f - 12) + ", 38 " + (f - 8) + ", 38 " + (f + 6) + " C 38 " + (f + 18) + ", 28 " + (f + 26) + ", 16 " + (f + 34), fill: "none", stroke: ink, "stroke-width": 2 }));
      // Key + time signatures (engraving after clef). Key on pitched bass only.
      {
        let sigX = 40;
        const ks = keySigFromKeys(demo && (demo.keys || demo.key));
        sigX = appendKeySignature(svg, sigX, ks, yy, ink);
        appendTimeSignature(svg, sigX + 6, yy(6) + 4, yy(2) + 4, parseTimeSig(demo && demo.timeSig), ink, 14);
      }
      for (let i = 0; i <= n; i++) svg.appendChild(svgEl("line", { x1: X0 + 10 + (i / n) * (W - 10), x2: X0 + 10 + (i / n) * (W - 10), y1: yy(8), y2: yy(0), stroke: "#4b5563", "stroke-width": i === 0 || i === n ? 1.5 : 1 }));

      const notes = [];
      for (let b = 0; b < n; b += 2) {
        const off = b * 16;
        pat.notes.forEach((note) => { if (note.step < 32) notes.push({ step: note.step + off, midi: note.midi }); });
      }
      const inView = notes.filter((note) => note.step < steps);
      const bassSoundingSteps = (midiBass && playing) ? soundingBassNoteSteps(t, viewLo, n, pat) : new Set();
      const events = buildRhythmVoice(inView, steps);
      const noteEvents = events.filter((e) => e.type === "note");
      const groups = beamGroups(noteEvents);

      function drawLedgers(g, pos, cx) {
        if (pos < 0) {
          for (let p = -2; p >= pos; p -= 2) {
            g.appendChild(svgEl("line", { x1: cx - 8, x2: cx + 8, y1: yy(p), y2: yy(p), stroke: "#6b7280", "stroke-width": 1 }));
          }
        } else if (pos > 8) {
          for (let p = 10; p <= pos; p += 2) {
            g.appendChild(svgEl("line", { x1: cx - 8, x2: cx + 8, y1: yy(p), y2: yy(p), stroke: "#6b7280", "stroke-width": 1 }));
          }
        }
      }

      function drawRest(ev) {
        const cx = sx(ev.step);
        const cy = yy(4);
        const g = svgEl("g", { "data-rhythm": "rest", "data-dur": String(ev.dur), "data-label": ev.style.label });
        const u = ev.style.unit;
        if (u >= 16) {
          g.appendChild(svgEl("rect", { x: cx - 5, y: cy - 5.2, width: 10, height: 4, fill: ink }));
        } else if (u >= 8) {
          g.appendChild(svgEl("rect", { x: cx - 5, y: cy + 1, width: 10, height: 4, fill: ink }));
        } else if (u >= 4) {
          g.appendChild(svgEl("path", {
            d: "M" + (cx - 1) + " " + (cy - 12) + " c2 4 2 6 -1 9 c4 0 4 5 1 8 c-1 1 -2 2 -2 3 l2 2 c3 -3 5 -7 3 -12 c3 -2 3 -6 0 -9 c-1 -3 -3 -4 -3 -5z",
            fill: ink,
          }));
        } else if (u >= 2) {
          g.appendChild(svgEl("path", {
            d: "M" + (cx + 2) + " " + (cy - 10) + " q-6 4 -6 9 q0 4 4 5 l1 -2 q-3 -1 -3 -4 q0 -3 4 -6z",
            fill: ink,
          }));
          g.appendChild(svgEl("circle", { cx: cx - 2, cy: cy + 5, r: 1.8, fill: ink }));
        } else {
          g.appendChild(svgEl("path", {
            d: "M" + (cx + 2) + " " + (cy - 12) + " q-6 3 -6 8 q0 3 3 4 l1 -2 q-2 -1 -2 -3 q0 -3 4 -5z M" + (cx + 2) + " " + (cy - 4) + " q-6 3 -6 7 q0 3 3 4 l1 -2 q-2 -1 -2 -2.5 q0 -2.5 4 -4.5z",
            fill: ink,
          }));
          g.appendChild(svgEl("circle", { cx: cx - 2, cy: cy + 6, r: 1.6, fill: ink }));
        }
        if (ev.style.dots) g.appendChild(svgEl("circle", { cx: cx + 8, cy: cy, r: 1.6, fill: ink }));
        svg.appendChild(g);
      }

      function flagPath(cx, stemEnd, up, beams) {
        // Simple curved flags hanging from stem end.
        const dir = up ? 1 : -1;
        const x0 = cx;
        const y0 = stemEnd;
        let d = "";
        for (let b = 0; b < beams; b++) {
          const y = y0 + dir * b * 5;
          if (up) d += "M" + x0 + " " + y + " q6 2 8 8 q-6 -2 -8 -1z ";
          else d += "M" + x0 + " " + y + " q6 -2 8 -8 q-6 2 -8 1z ";
        }
        return d.trim();
      }

      events.filter((e) => e.type === "rest").forEach(drawRest);

      groups.forEach((group) => {
        const beamable = group.length >= 2 && group.every((e) => e.style.unit <= 2);
        const laid = group.map((ev) => {
          const sp = staffPos(ev.midi);
          const cx = sx(ev.step);
          const cy = yy(sp.pos);
          const up = sp.pos < 4;
          const stemLen = 22;
          const stemX = up ? cx + 4 : cx - 4;
          const stemEnd = up ? cy - stemLen : cy + stemLen;
          return { ev, sp, cx, cy, up, stemX, stemEnd };
        });

        laid.forEach((L) => {
          const isSounding = bassSoundingSteps.has(L.ev.step);
          const lit = isSounding;
          const noteInk = lit ? SOUNDING_HL : ink;
          const gAttrs = {
            "data-rhythm": "note",
            "data-dur": String(L.ev.dur),
            "data-label": L.ev.style.label,
            "data-midi": String(L.ev.midi),
            "data-written": String(L.sp.writtenMidi),
            "data-pos": String(L.sp.pos),
            "data-step": String(L.ev.step),
            "data-sounding": isSounding ? "1" : "0",
          };
          if (L.ev.tie) gAttrs["data-tie"] = L.ev.tie;
          if (L.ev.attack === false) gAttrs["data-attack"] = "0";
          const g = svgEl("g", gAttrs);
          drawLedgers(g, L.sp.pos, L.cx);
          if (L.sp.flat) g.appendChild(svgEl("text", { x: L.cx - 12, y: L.cy + 4, "font-size": 11, fill: noteInk }, [document.createTextNode("b")]));
          const open = L.ev.style.unit >= 8;
          g.appendChild(svgEl("ellipse", {
            cx: L.cx, cy: L.cy, rx: lit ? 5.2 : 4.5, ry: lit ? 3.6 : 3.2,
            fill: open ? "none" : noteInk,
            stroke: noteInk,
            "stroke-width": open || lit ? 1.6 : 0,
            transform: "rotate(-20 " + L.cx + " " + L.cy + ")",
          }));
          if (L.ev.style.unit < 16) {
            g.appendChild(svgEl("line", {
              x1: L.stemX, x2: L.stemX, y1: L.cy, y2: L.stemEnd,
              stroke: noteInk, "stroke-width": lit ? 1.6 : 1.2,
            }));
          }
          if (L.ev.style.dots) {
            g.appendChild(svgEl("circle", { cx: L.cx + 8, cy: L.cy + (L.sp.pos % 2 === 0 ? -2 : 0), r: 1.7, fill: noteInk }));
          }
          if (!beamable && L.ev.style.unit <= 2) {
            const beams = L.ev.style.unit === 1 ? 2 : 1;
            g.appendChild(svgEl("path", { d: flagPath(L.stemX, L.stemEnd, L.up, beams), fill: noteInk }));
          }
          svg.appendChild(g);
        });

        if (beamable) {
          const up = laid[0].up;
          const yBeam = up
            ? Math.min.apply(null, laid.map((L) => L.stemEnd)) - 1
            : Math.max.apply(null, laid.map((L) => L.stemEnd)) + 1;
          // Extend stems to beam
          laid.forEach((L) => {
            // stem already drawn to stemEnd; add extension if needed
            const need = up ? yBeam : yBeam;
            if ((up && L.stemEnd > need) || (!up && L.stemEnd < need)) {
              svg.appendChild(svgEl("line", {
                x1: L.stemX, x2: L.stemX, y1: L.stemEnd, y2: need,
                stroke: ink, "stroke-width": 1.2,
              }));
            }
          });
          const x0 = laid[0].stemX;
          const x1 = laid[laid.length - 1].stemX;
          const has16 = laid.some((L) => L.ev.style.unit === 1);
          svg.appendChild(svgEl("line", {
            x1: x0, x2: x1, y1: yBeam, y2: yBeam,
            stroke: ink, "stroke-width": 3, "stroke-linecap": "square",
            "data-rhythm": "beam",
          }));
          if (has16) {
            const y2 = up ? yBeam + 5 : yBeam - 5;
            // Partial or full second beam per 16th run
            let runStart = null;
            for (let i = 0; i <= laid.length; i++) {
              const is16 = i < laid.length && laid[i].ev.style.unit === 1;
              if (is16 && runStart == null) runStart = i;
              if ((!is16 || i === laid.length) && runStart != null) {
                const a = laid[runStart];
                const b = laid[i - 1];
                let xa = a.stemX, xb = b.stemX;
                if (runStart === i - 1) {
                  // partial flag-beam for lone 16th inside an 8th beam group
                  const dir = a === laid[0] ? 1 : -1;
                  xb = xa + dir * 7;
                }
                svg.appendChild(svgEl("line", {
                  x1: xa, x2: xb, y1: y2, y2: y2,
                  stroke: ink, "stroke-width": 3, "stroke-linecap": "square",
                  "data-rhythm": "beam16",
                }));
                runStart = null;
              }
            }
          }
        }
      });

      appendBassTiePaths(svg, events, sx, yy, ink);

      // Chord MIDI pads still sound; no diamond / chord-tone markers on the main bass staff.
      svg.appendChild(svgEl("line", { x1: playX, x2: playX, y1: 6, y2: 94, stroke: NEG, "stroke-width": 2.5, "pointer-events": "none" }));
      bindStaffDrag(svg, () => ({ viewLo, viewHi }), onSeek, onLoopBars);
      return svg;
    }

    function makeDrumStaff(viewLo, viewHi, n, playX, hat16, rhythmOut, drumsOpts) {
      const svg = svgEl("svg", { viewBox: "0 0 " + VBW + " 100", width: "100%", height: "100%", preserveAspectRatio: "none", role: "img", "aria-label": "Drum staff", style: { cursor: "crosshair", userSelect: "none", touchAction: "none" } });
      const steps = 16 * n;
      const sx = (s) => X0 + ((s + 0.5) / steps) * W;
      const yHat = 28, ySnare = 52, yKick = 76;
      const ink = "#e5e7eb";
      svg.appendChild(selectionOverlay(viewLo, viewHi, 18, 70));
      [28, 40, 52, 64, 76].forEach((y) => svg.appendChild(svgEl("line", { x1: X0, x2: X0 + W, y1: y, y2: y, stroke: "#6b7280", "stroke-width": 1 })));
      svg.appendChild(svgEl("text", { x: 8, y: 32, "font-size": 10, fill: "#6b7280" }, [document.createTextNode("HH")]));
      svg.appendChild(svgEl("text", { x: 8, y: 56, "font-size": 10, fill: "#6b7280" }, [document.createTextNode("SD")]));
      svg.appendChild(svgEl("text", { x: 8, y: 80, "font-size": 10, fill: "#6b7280" }, [document.createTextNode("BD")]));
      // Time signature only (percussion: no key signature).
      appendTimeSignature(svg, 38, 44, 68, parseTimeSig(demo && demo.timeSig), ink, 14);
      for (let i = 0; i <= n; i++) svg.appendChild(svgEl("line", { x1: X0 + (i / n) * W, x2: X0 + (i / n) * W, y1: 28, y2: 76, stroke: "#4b5563", "stroke-width": i === 0 || i === n ? 1.5 : 1 }));

      function drumFlagPath(cx, stemEnd, up, beams) {
        const dir = up ? 1 : -1;
        let d = "";
        for (let b = 0; b < beams; b++) {
          const y = stemEnd + dir * b * 4.5;
          if (up) d += "M" + cx + " " + y + " q5 2 7 7 q-5 -2 -7 -1z ";
          else d += "M" + cx + " " + y + " q5 -2 7 -7 q-5 2 -7 1z ";
        }
        return d.trim();
      }

      function drawDrumRest(ev, cy) {
        const cx = sx(ev.step);
        const g = svgEl("g", { "data-rhythm": "rest", "data-dur": String(ev.dur), "data-label": ev.style.label, "data-drum": ev.kind || "" });
        const u = ev.style.unit;
        if (u >= 16) {
          g.appendChild(svgEl("rect", { x: cx - 5, y: cy - 5.2, width: 10, height: 4, fill: ink }));
        } else if (u >= 8) {
          g.appendChild(svgEl("rect", { x: cx - 5, y: cy + 1, width: 10, height: 4, fill: ink }));
        } else if (u >= 4) {
          g.appendChild(svgEl("path", {
            d: "M" + (cx - 1) + " " + (cy - 10) + " c2 3 2 5 -1 7 c3 0 3 4 1 7 c-1 1 -2 2 -2 2.5 l1.5 1.5 c2.5 -2.5 4 -6 2.5 -10 c2.5 -1.5 2.5 -5 0 -7.5 c-1 -2.5 -2.5 -3 -2.5 -4z",
            fill: ink,
          }));
        } else if (u >= 2) {
          g.appendChild(svgEl("path", {
            d: "M" + (cx + 2) + " " + (cy - 8) + " q-5 3 -5 7 q0 3 3.5 4 l1 -1.5 q-2.5 -1 -2.5 -3 q0 -2.5 3 -5z",
            fill: ink,
          }));
          g.appendChild(svgEl("circle", { cx: cx - 1.5, cy: cy + 4, r: 1.5, fill: ink }));
        } else {
          g.appendChild(svgEl("path", {
            d: "M" + (cx + 2) + " " + (cy - 10) + " q-5 2.5 -5 6.5 q0 2.5 2.5 3.5 l1 -1.5 q-1.5 -0.8 -1.5 -2.5 q0 -2.5 3 -4.5z M" + (cx + 2) + " " + (cy - 3) + " q-5 2.5 -5 6 q0 2.5 2.5 3.5 l1 -1.5 q-1.5 -0.8 -1.5 -2 q0 -2 3 -4z",
            fill: ink,
          }));
          g.appendChild(svgEl("circle", { cx: cx - 1.5, cy: cy + 5, r: 1.4, fill: ink }));
        }
        if (ev.style.dots) g.appendChild(svgEl("circle", { cx: cx + 7, cy: cy, r: 1.4, fill: ink }));
        svg.appendChild(g);
      }

      function drawDrumHead(g, kind, cx, cy, open) {
        if (kind === "hat") {
          g.appendChild(svgEl("line", { x1: cx - 4, x2: cx + 4, y1: cy - 4, y2: cy + 4, stroke: ink, "stroke-width": 1.5 }));
          g.appendChild(svgEl("line", { x1: cx - 4, x2: cx + 4, y1: cy + 4, y2: cy - 4, stroke: ink, "stroke-width": 1.5 }));
        } else if (kind === "snare") {
          g.appendChild(svgEl("ellipse", {
            cx, cy, rx: 4.2, ry: 3,
            fill: open ? "none" : ink,
            stroke: ink,
            "stroke-width": open ? 1.4 : 0,
            transform: "rotate(-20 " + cx + " " + cy + ")",
          }));
        } else {
          g.appendChild(svgEl("ellipse", {
            cx, cy, rx: 5, ry: 3.4,
            fill: open ? "none" : ink,
            stroke: ink,
            "stroke-width": open ? 1.5 : 0,
            transform: "rotate(-20 " + cx + " " + cy + ")",
          }));
        }
      }

      const voices = [
        { kind: "hat", y: yHat, up: true, stemLen: 14 },
        { kind: "snare", y: ySnare, up: true, stemLen: 14 },
        { kind: "kick", y: yKick, up: false, stemLen: 14 },
      ];
      const dOpts = drumsOpts || {};
      const allHits = drumHitsForView(n, hat16, viewLo, {
        rhythmOut,
        drumsOut: dOpts.drumsOut,
        drumsOutBars: dOpts.drumsOutBars,
        drumHits: dOpts.drumHits || dOpts.songHits || null,
        empty: rhythmOut || dOpts.drumsOut ? true : false,
      }).filter((h) => h.step < steps);
      const drumSounding = (midiDrums && playing)
        ? soundingDrumHitSteps(t, viewLo, n, hat16, rhythmOut, dOpts.drumsOut)
        : new Set();

      voices.forEach((voice) => {
        const notes = allHits
          .filter((h) => h.kind === voice.kind)
          .map((h) => ({ step: h.step, midi: h.midi }));
        const events = buildRhythmVoice(notes, steps).map((e) => Object.assign({}, e, { kind: voice.kind }));
        const noteEvents = events.filter((e) => e.type === "note");
        const groups = beamGroups(noteEvents);

        events.filter((e) => e.type === "rest").forEach((ev) => drawDrumRest(ev, voice.y));

        groups.forEach((group) => {
          const beamable = group.length >= 2 && group.every((e) => e.style.unit <= 2);
          const laid = group.map((ev) => {
            const cx = sx(ev.step);
            const cy = voice.y;
            const up = voice.up;
            const stemX = up ? cx + 3.5 : cx - 3.5;
            const stemEnd = up ? cy - voice.stemLen : cy + voice.stemLen;
            return { ev, cx, cy, up, stemX, stemEnd };
          });

          laid.forEach((L) => {
            const isSounding = drumSounding.has(L.ev.step + ":" + voice.kind);
            const noteInk = isSounding ? SOUNDING_HL : ink;
            const g = svgEl("g", {
              "data-rhythm": "note",
              "data-dur": String(L.ev.dur),
              "data-label": L.ev.style.label,
              "data-drum": voice.kind,
              "data-step": String(L.ev.step),
              "data-sounding": isSounding ? "1" : "0",
            });
            const open = L.ev.style.unit >= 8;
            drawDrumHead(g, voice.kind, L.cx, L.cy, open);
            if (isSounding) {
              // Recolor child strokes/fills to highlight
              Array.prototype.forEach.call(g.childNodes, (node) => {
                if (node.setAttribute) {
                  if (node.getAttribute("stroke")) node.setAttribute("stroke", noteInk);
                  if (node.getAttribute("fill") && node.getAttribute("fill") !== "none") node.setAttribute("fill", noteInk);
                }
              });
            }
            if (L.ev.style.unit < 16) {
              g.appendChild(svgEl("line", {
                x1: L.stemX, x2: L.stemX, y1: L.cy, y2: L.stemEnd,
                stroke: noteInk, "stroke-width": isSounding ? 1.5 : 1.15,
              }));
            }
            if (L.ev.style.dots) {
              g.appendChild(svgEl("circle", { cx: L.cx + 7, cy: L.cy, r: 1.5, fill: noteInk }));
            }
            if (!beamable && L.ev.style.unit <= 2) {
              const beams = L.ev.style.unit === 1 ? 2 : 1;
              g.appendChild(svgEl("path", { d: drumFlagPath(L.stemX, L.stemEnd, L.up, beams), fill: noteInk }));
            }
            svg.appendChild(g);
          });

          if (beamable) {
            const up = laid[0].up;
            const yBeam = up
              ? Math.min.apply(null, laid.map((L) => L.stemEnd)) - 1
              : Math.max.apply(null, laid.map((L) => L.stemEnd)) + 1;
            laid.forEach((L) => {
              if ((up && L.stemEnd > yBeam) || (!up && L.stemEnd < yBeam)) {
                svg.appendChild(svgEl("line", {
                  x1: L.stemX, x2: L.stemX, y1: L.stemEnd, y2: yBeam,
                  stroke: ink, "stroke-width": 1.15,
                }));
              }
            });
            const x0 = laid[0].stemX;
            const x1 = laid[laid.length - 1].stemX;
            svg.appendChild(svgEl("line", {
              x1: x0, x2: x1, y1: yBeam, y2: yBeam,
              stroke: ink, "stroke-width": 2.8, "stroke-linecap": "square",
              "data-rhythm": "beam",
              "data-drum": voice.kind,
            }));
            if (laid.some((L) => L.ev.style.unit === 1)) {
              const y2 = up ? yBeam + 4.5 : yBeam - 4.5;
              let runStart = null;
              for (let i = 0; i <= laid.length; i++) {
                const is16 = i < laid.length && laid[i].ev.style.unit === 1;
                if (is16 && runStart == null) runStart = i;
                if ((!is16 || i === laid.length) && runStart != null) {
                  const a = laid[runStart];
                  const b = laid[i - 1];
                  let xa = a.stemX, xb = b.stemX;
                  if (runStart === i - 1) {
                    const dir = a === laid[0] ? 1 : -1;
                    xb = xa + dir * 6;
                  }
                  svg.appendChild(svgEl("line", {
                    x1: xa, x2: xb, y1: y2, y2: y2,
                    stroke: ink, "stroke-width": 2.8, "stroke-linecap": "square",
                    "data-rhythm": "beam16",
                    "data-drum": voice.kind,
                  }));
                  runStart = null;
                }
              }
            }
          }
        });
      });

      svg.appendChild(svgEl("line", { x1: playX, x2: playX, y1: 18, y2: 88, stroke: NEG, "stroke-width": 2.5, "pointer-events": "none" }));
      bindStaffDrag(svg, () => ({ viewLo, viewHi }), onSeek, onLoopBars);
      return svg;
    }

    function iconBtn(label, active, action, innerHTML) {
      const b = el("button", {
        type: "button",
        className: "icon-btn" + (active ? " on" : ""),
        "aria-label": label,
        "data-transport": action,
      });
      b.innerHTML = innerHTML;
      return b;
    }

    // Stable delegated handlers survive 50ms replaceChildren (Safari drops mid-click otherwise).
    if (!root.__bassTransportBound) {
      root.__bassTransportBound = true;
      let lastTransportTs = 0;
      let lastTransportKey = "";
      const handleTransport = (e) => {
        const tEl = e.target && e.target.closest ? e.target.closest("[data-transport], [data-section], [data-card], [data-card-next], [data-card-prev], [data-drawer]") : null;
        if (!tEl || !root.contains(tEl)) return;
        const key = tEl.hasAttribute("data-section") ? "sec:" + tEl.getAttribute("data-section")
          : tEl.hasAttribute("data-card-next") ? "card-next"
          : tEl.hasAttribute("data-card-prev") ? "card-prev"
          : tEl.hasAttribute("data-card") ? "card:" + tEl.getAttribute("data-card")
          : tEl.hasAttribute("data-drawer") ? "drawer:" + tEl.getAttribute("data-drawer")
          : "tr:" + (tEl.getAttribute("data-transport") || "") + ":" + (tEl.getAttribute("data-listen") || "") + ":" + (tEl.getAttribute("data-midi") || "") + ":" + (tEl.getAttribute("data-insight-voice") || "");
        const now = Date.now();
        // Debounce only the same control's pointerup+click double-fire — not a quick tap on a different control.
        if (key === lastTransportKey && now - lastTransportTs < 80) return;
        lastTransportTs = now;
        lastTransportKey = key;
        e.preventDefault();
        if (tEl.hasAttribute("data-section")) {
          const i = Number(tEl.getAttribute("data-section"));
          if (Number.isFinite(i)) pickSection(i);
          return;
        }
        if (tEl.hasAttribute("data-drawer")) {
          const act = tEl.getAttribute("data-drawer");
          if (act === "open") cardsDrawerOpen = true;
          else if (act === "close") cardsDrawerOpen = false;
          else if (act === "toggle") cardsDrawerOpen = !cardsDrawerOpen;
          render();
          return;
        }
        if (tEl.hasAttribute("data-card-next")) {
          cardIdx++;
          cancelInsightMidi();
          render();
          return;
        }
        if (tEl.hasAttribute("data-card-prev")) {
          const deckLen = (() => {
            const sec = SECS[secIdx];
            const d = CARDS_EFF[sec.id] || CARDS_EFF[sec.kind] || CARDS[sec.id] || CARDS[sec.kind] || CARDS.intro;
            return Math.max(1, d.length);
          })();
          cardIdx = (cardIdx % deckLen + deckLen - 1) % deckLen;
          cancelInsightMidi();
          render();
          return;
        }
        if (tEl.hasAttribute("data-card")) {
          const i = Number(tEl.getAttribute("data-card"));
          if (Number.isFinite(i)) { cardIdx = i; cancelInsightMidi(); render(); }
          return;
        }
        const action = tEl.getAttribute("data-transport");
        if (!action) return;
        if (action === "play") onPlay();
        else if (action === "pause") onPause();
        else if (action === "stop") onStop();
        else if (action === "loop") {
          loopOn = !loopOn;
          if (loopOn) { lo = SECS[secIdx].first; hi = SECS[secIdx].end - 1; }
          render();
        } else if (action === "listen") {
          const mode = tEl.getAttribute("data-listen") || "full";
          setListenMode(mode);
        } else if (action === "midi") {
          toggleMidi(tEl.getAttribute("data-midi") || "bass");
        } else if (action === "insight-midi-play") {
          toggleInsightMidiPlay();
        } else if (action === "insight-midi-tog") {
          toggleInsightMidiVoice(tEl.getAttribute("data-insight-voice") || "bass");
        } else if (action === "insight-midi") {
          // Legacy: treat voice buttons as play-with-that-voice (tests / old bookmarks).
          playInsightMidi(tEl.getAttribute("data-insight-voice") || "all");
        } else if (action === "rate") {
          const r = Number(tEl.getAttribute("data-rate"));
          if (Number.isFinite(r)) setPlaybackRate(r);
        }
      };
      root.addEventListener("pointerup", handleTransport);
      root.addEventListener("click", handleTransport);
    }
    if (!root.__bassKeysBound) {
      root.__bassKeysBound = true;
      window.addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ")) return;
        const tag = e.target && e.target.tagName ? String(e.target.tagName).toLowerCase() : "";
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (e.target && e.target.isContentEditable) return;
        if (e.key === " ") {
          e.preventDefault();
          onPlay();
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          nextSection();
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          leftArrowNav();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          if (isPhoneLayout() && cardsDrawerOpen) {
            cardsDrawerOpen = false;
            render();
            return;
          }
          clearSubsection();
          return;
        }
        if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          loopOn = !loopOn;
          if (loopOn) { lo = SECS[secIdx].first; hi = SECS[secIdx].end - 1; }
          render();
        }
      });
    }

    if (!root.__bassResizeBound) {
      root.__bassResizeBound = true;
      let lastPhone = isPhoneLayout();
      window.addEventListener("resize", () => {
        const nowPhone = isPhoneLayout();
        if (nowPhone !== lastPhone) {
          lastPhone = nowPhone;
          if (!nowPhone) cardsDrawerOpen = false;
          render();
        }
      });
    }

    let destroyed = false;
    function render() {
      if (destroyed || !root.isConnected) return;
      const sec = SECS[secIdx];
      const bar = barAt(t);
      const nextT = barTime(bar + 1);
      const frac = Math.max(0, Math.min(0.999, (t - BARS[bar].t) / Math.max(0.001, nextT - BARS[bar].t)));
      const beat = Math.floor(frac * 4);
      // Pattern is stable for the whole section — only change when secIdx / section id changes.
      // Do not index by bar/beat (pairIdx thrash caused pattern flips mid-chorus).
      const patsRaw = PATS_EFF[sec.id] || PATS_EFF[sec.kind] || PATS[sec.id] || PATS[sec.kind] || PATS.intro;
      const pats = Array.isArray(patsRaw) ? patsRaw : [patsRaw];
      const pat = pats[0] || PEDAL;
      const rhythmOut = isRhythmOut(pat);
      const drumsOut = isDrumsOut(sec, pat);
      const hat16 = !rhythmOut && !drumsOut && (sec.kind === "bridge" || sec.kind === "vamp" || sec.kind === "ah" || sec.kind === "tag");
      const lay = sectionBars(secIdx);
      const viewDrumHits = drumHitsForView(lay.n, hat16, lay.viewLo, {
        rhythmOut, drumsOut, drumsOutBars: DRUMS_OUT_BARS, drumHits: SONG_DRUM_HITS,
      });
      const drumsViewOut = rhythmOut || drumsOut || viewDrumHits.length === 0;
      const playX = playheadX(t, lay.viewLo, lay.n);
      const deck = CARDS_EFF[sec.id] || CARDS_EFF[sec.kind] || CARDS[sec.id] || CARDS[sec.kind] || CARDS.intro;
      const card = deck[cardIdx % deck.length];

      root.replaceChildren();
      const phoneLayout = isPhoneLayout();
      const shell = el("div", { className: "shell", "data-phone": phoneLayout ? "1" : "0" });

      const header = el("div", { className: "header" });
      const meta = el("div", { className: "meta" });
      meta.appendChild(el("span", { className: "title" }, [demo.title]));
      meta.appendChild(el("span", { className: "sub" }, [demo.artist]));
      meta.appendChild(el("span", { className: "sub" }, [demo.bpm + " BPM · " + demo.timeSig + " · " + demo.keys]));
      meta.appendChild(el("span", { className: "stat", "data-meta": "barbeat" }, [fmtBarBeat(bar, beat)]));
      meta.appendChild(el("span", { className: "clock", "data-meta": "clock" }, [fmt(t)]));
      meta.appendChild(el("span", { className: "sub sec-slot", "data-meta": "section" }, [sec.name]));
      meta.appendChild(el("span", { className: "stat loop-slot", "data-meta": "loop" }, [fmtLoopLabel(lo, hi, loopOn)]));
      meta.appendChild(el("span", { className: "sub", title: "Keyboard: Space play/pause · ← loop/section start (again = prev) · → next section · Esc clear bar selection · L toggle loop" }, ["Space · ← → · Esc · L"]));
      const phoneChrome = isPhoneLayout();
      const badgeText = stemLoading
        ? (phoneChrome ? "loading…" : "Loading stems…")
        : (muteBassSupported
          ? (phoneChrome
            ? (listenMode === "solo" ? "solo"
              : listenMode === "mute" ? "muted"
              : listenMode === "db" ? "D+B"
              : listenMode === "drums" ? "drums"
              : "stems")
            : (listenMode === "solo" ? "stems · bass solo"
              : listenMode === "mute" ? "stems · bass muted"
              : listenMode === "db" ? "stems · drums+bass"
              : listenMode === "drums" ? "stems · drums solo"
              : "stems · full"))
          : (phoneChrome ? "demo" : "demo · no audio"));
      meta.appendChild(el("span", {
        className: "badge" + (stemLoading ? " loading" : ""),
        "data-meta": "badge",
        title: muteBassSupported ? ("Listen: " + (listenMode || "full")) : "Demo (no stems)",
      }, [badgeText]));
      header.appendChild(meta);

      const transport = el("div", { className: "transport" });
      transport.appendChild(iconBtn(playing ? "Pause" : "Play", playing, playing ? "pause" : "play",
        playing
          ? '<svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="2" width="4" height="14" rx="1" fill="currentColor"/><rect x="11" y="2" width="4" height="14" rx="1" fill="currentColor"/></svg>'
          : '<svg width="18" height="18" viewBox="0 0 18 18"><polygon points="4,2 16,9 4,16" fill="currentColor"/></svg>'));
      transport.appendChild(iconBtn("Stop", false, "stop",
        '<svg width="18" height="18" viewBox="0 0 18 18"><rect x="3" y="3" width="12" height="12" rx="1.5" fill="currentColor"/></svg>'));
      transport.appendChild(iconBtn(loopOn ? "Loop on" : "Loop off", loopOn, "loop",
        '<svg width="18" height="18" viewBox="0 0 18 18"><path d="M4 9a5 5 0 0 1 8.5-3.5L14 7M14 9a5 5 0 0 1-8.5 3.5L4 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><polyline points="11,4 14,7 11,7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="7,14 4,11 7,11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'));
      const rateStrip = el("div", { className: "rate-strip", "aria-label": "Playback speed (pitch preserved)", "data-rate-strip": "1" });
      const rateLabels = { 1: "100%", 0.9: "90%", 0.75: "75%", 0.5: "50%", 0.25: "25%" };
      for (const r of PLAYBACK_RATES) {
        rateStrip.appendChild(el("button", {
          type: "button",
          className: "rate-btn" + (playbackRate === r ? " on" : ""),
          "data-transport": "rate",
          "data-rate": String(r),
          "aria-pressed": playbackRate === r ? "true" : "false",
          title: "Playback " + rateLabels[r] + " (same pitch)",
        }, [rateLabels[r]]));
      }
      transport.appendChild(rateStrip);
      header.appendChild(transport);
      shell.appendChild(header);
      const credit = demo.credit || (demo.meta && demo.meta.license ? {
        title: demo.title, artist: demo.artist, license: demo.meta.license, url: demo.meta.sourceUrl, source: demo.meta.source,
      } : null);
      if (credit && !privateMode) {
        const creditRow = el("div", { className: "credit-line", "data-credit": "1" });
        const bits = [credit.title || demo.title, credit.artist || demo.artist, credit.license || "CC0"].filter(Boolean);
        creditRow.appendChild(document.createTextNode(bits.join(" · ") + " · "));
        if (credit.url) {
          creditRow.appendChild(el("a", { href: credit.url, target: "_blank", rel: "noopener noreferrer" }, [credit.source || "source"]));
        } else if (credit.source) {
          creditRow.appendChild(document.createTextNode(credit.source));
        }
        // Public must not advertise private entry — bookmark / Access URL only.
        shell.appendChild(creditRow);
      }

      if (privateMode) {
        const row = el("div", { className: "song-picker-row", "data-song-picker-row": "1" });
        row.appendChild(el("label", { for: "bass-song-picker" }, ["Song"]));
        const wrap = el("div", {
          className: "song-typeahead",
          "data-song-picker": "1",
          "data-song-typeahead": "1",
        });
        const listId = "bass-song-listbox";
        const input = el("input", {
          id: "bass-song-picker",
          type: "text",
          className: "song-typeahead-input",
          role: "combobox",
          "aria-autocomplete": "list",
          "aria-expanded": "false",
          "aria-controls": listId,
          "aria-label": "Type to find a demo or processed song",
          autocomplete: "off",
          spellcheck: "false",
          "data-song-typeahead-input": "1",
        });
        const listbox = el("div", {
          id: listId,
          className: "song-typeahead-list",
          role: "listbox",
          "data-song-listbox": "1",
          hidden: "true",
        });
        wrap.appendChild(input);
        wrap.appendChild(listbox);
        row.appendChild(wrap);
        shell.appendChild(row);

        function songLabel(s) {
          if (!s) return "";
          return (s.artist ? s.artist + " — " : "") + (s.title || s.id);
        }
        // Ensure active id appears under Processed if catalog lags a new job.
        const known = new Set([...(songCatalog.demos || []), ...(songCatalog.processed || [])].map((s) => s.id));
        if (activeSongId && !known.has(activeSongId)) {
          songCatalog.processed = [...(songCatalog.processed || []), {
            id: activeSongId,
            title: demo.title || activeSongId,
            artist: demo.artist || "",
            group: "processed",
          }];
        }
        const allSongs = [
          ...(songCatalog.demos || []).map((s) => Object.assign({}, s, { group: "demo" })),
          ...(songCatalog.processed || []).map((s) => Object.assign({}, s, { group: "processed" })),
        ];
        const activeMeta = allSongs.find((s) => s.id === activeSongId) || { id: activeSongId, title: demo.title || activeSongId };
        input.value = songLabel(activeMeta);

        let open = false;
        let highlightIdx = -1;
        let visible = [];
        let blurTimer = 0;

        function goToSong(id) {
          const next = String(id || "").trim();
          if (!next || next === activeSongId) {
            closeList(true);
            return;
          }
          const u = new URL(location.href);
          u.searchParams.set("song", next);
          const target = u.pathname + "?" + u.searchParams.toString() + u.hash;
          if (typeof window.__BASS_SONG_NAV__ === "function") {
            window.__BASS_SONG_NAV__(target, next);
            return;
          }
          location.assign(target);
        }

        function filterSongs(query) {
          const q = String(query || "").trim().toLowerCase();
          if (!q) return allSongs.slice();
          return allSongs.filter((s) => {
            const hay = [s.id, s.title, s.artist, songLabel(s)].filter(Boolean).join(" ").toLowerCase();
            return hay.includes(q);
          });
        }

        function setExpanded(isOpen) {
          open = isOpen;
          input.setAttribute("aria-expanded", isOpen ? "true" : "false");
          if (isOpen) listbox.removeAttribute("hidden");
          else listbox.setAttribute("hidden", "true");
        }

        function closeList(restore) {
          setExpanded(false);
          highlightIdx = -1;
          visible = [];
          listbox.innerHTML = "";
          if (restore) input.value = songLabel(activeMeta);
        }

        function renderList(query) {
          visible = filterSongs(query);
          listbox.innerHTML = "";
          if (!visible.length) {
            listbox.appendChild(el("div", { className: "song-typeahead-empty", "data-song-empty": "1" }, ["No matches"]));
            highlightIdx = -1;
            setExpanded(true);
            return;
          }
          const demos = visible.filter((s) => s.group === "demo");
          const processed = visible.filter((s) => s.group === "processed");
          let flatIdx = 0;
          function addGroup(label, groupKey, items) {
            if (!items.length) return;
            const group = el("div", { className: "song-typeahead-group", "data-group": groupKey });
            group.appendChild(el("div", {
              className: "song-typeahead-group-label",
              role: "presentation",
              "data-group-label": groupKey,
            }, [label]));
            for (const s of items) {
              const idx = flatIdx++;
              const opt = el("button", {
                type: "button",
                className: "song-typeahead-option",
                role: "option",
                id: "bass-song-opt-" + idx,
                "data-song-id": s.id,
                "data-group": groupKey,
                "data-option-index": String(idx),
                "aria-selected": idx === highlightIdx ? "true" : "false",
              }, [songLabel(s)]);
              opt.addEventListener("mousedown", (e) => {
                e.preventDefault(); // keep focus; avoid blur before click
                goToSong(s.id);
              });
              group.appendChild(opt);
            }
            listbox.appendChild(group);
          }
          addGroup("Demo", "demo", demos);
          addGroup("Processed", "processed", processed);
          if (highlightIdx < 0 || highlightIdx >= visible.length) highlightIdx = 0;
          syncHighlight();
          setExpanded(true);
        }

        function syncHighlight() {
          const opts = [...listbox.querySelectorAll('[role="option"]')];
          opts.forEach((opt, i) => {
            const on = i === highlightIdx;
            opt.setAttribute("aria-selected", on ? "true" : "false");
            if (on) {
              input.setAttribute("aria-activedescendant", opt.id);
              try { opt.scrollIntoView({ block: "nearest" }); } catch (_) { /* jsdom */ }
            }
          });
          if (highlightIdx < 0) input.removeAttribute("aria-activedescendant");
        }

        function openList(seedQuery) {
          if (blurTimer) { clearTimeout(blurTimer); blurTimer = 0; }
          highlightIdx = Math.max(0, visible.length ? highlightIdx : 0);
          renderList(seedQuery != null ? seedQuery : input.value);
        }

        input.addEventListener("focus", () => {
          openList("");
          try { input.select(); } catch (_) { /* ignore */ }
        });
        input.addEventListener("input", () => {
          highlightIdx = 0;
          renderList(input.value);
        });
        input.addEventListener("keydown", (e) => {
          const key = e.key;
          if (key === "ArrowDown") {
            e.preventDefault();
            if (!open) openList(input.value);
            else if (visible.length) {
              highlightIdx = (highlightIdx + 1) % visible.length;
              syncHighlight();
            }
            return;
          }
          if (key === "ArrowUp") {
            e.preventDefault();
            if (!open) openList(input.value);
            else if (visible.length) {
              highlightIdx = (highlightIdx - 1 + visible.length) % visible.length;
              syncHighlight();
            }
            return;
          }
          if (key === "Enter") {
            if (!open) return;
            e.preventDefault();
            const pick = visible[highlightIdx] || visible[0];
            if (pick) goToSong(pick.id);
            return;
          }
          if (key === "Escape") {
            if (!open) return;
            e.preventDefault();
            closeList(true);
            return;
          }
        });
        input.addEventListener("blur", () => {
          blurTimer = setTimeout(() => closeList(true), 120);
        });
      }

      shell.appendChild(el("div", { className: "timeline" }, [makeTimeline()]));

      const grid = el("div", { className: "grid" });
      const layers = el("div", { className: "layers" });
      function layer(title, body, extraClass, headExtra) {
        const box = el("div", { className: "layer" + (extraClass ? " " + extraClass : "") });
        // with-ch-strip stacks S/M/D&B immediately under the label (not beside it).
        const head = el("div", { className: "layer-head" + (headExtra ? " with-ch-strip" : "") });
        head.appendChild(el("span", { className: "layer-head-title" }, [title]));
        if (headExtra) head.appendChild(headExtra);
        box.appendChild(head);
        box.appendChild(el("div", { className: "layer-body" }, [body]));
        return box;
      }
      function makeBassChannelStrip() {
        if (!muteBassSupported) return null;
        const strip = el("div", { className: "ch-strip", "aria-label": "Bass listen modes", "data-ch-strip": "bass" });
        const mk = (mode, label, title, enabled) => {
          // D&B lights both staff S buttons (bass is in the mix); tapping S exits D&B into that stem's solo.
          const on = mode === "solo"
            ? (listenMode === "solo" || listenMode === "db")
            : listenMode === mode;
          const b = el("button", {
            type: "button",
            className: "ch-btn" + (on ? " on" : ""),
            "aria-label": title,
            "aria-pressed": on ? "true" : "false",
            "data-transport": "listen",
            "data-listen": mode,
            title: title,
          }, [label]);
          if (!enabled) b.disabled = true;
          return b;
        };
        strip.appendChild(mk("solo", "S", "Solo bass stem", true));
        strip.appendChild(mk("mute", "M", "Mute bass (hear the rest)", true));
        strip.appendChild(mk("db", "D&B", drumsSupported ? "Drums + bass only" : "Drums stem not available yet", drumsSupported));
        strip.appendChild(el("button", {
          type: "button",
          className: "ch-btn" + (midiBass ? " on" : ""),
          "aria-label": "Bass MIDI synth from transcribed notes",
          "aria-pressed": midiBass ? "true" : "false",
          "data-transport": "midi",
          "data-midi": "bass",
          title: "MIDI — hear transcribed bass (WebAudio) instead of the bass stem",
        }, ["MIDI"]));
        return strip;
      }
      function makeChordChannelStrip() {
        const strip = el("div", { className: "ch-strip", "aria-label": "Chord MIDI", "data-ch-strip": "chords" });
        strip.appendChild(el("button", {
          type: "button",
          className: "ch-btn" + (midiChords ? " on" : ""),
          "aria-label": "Chord MIDI from chord symbols",
          "aria-pressed": midiChords ? "true" : "false",
          "data-transport": "midi",
          "data-midi": "chords",
          title: "MIDI — hear chord tones (WebAudio) for the harmony line",
        }, ["MIDI"]));
        return strip;
      }
      function makeDrumChannelStrip() {
        if (!muteBassSupported) return null;
        const strip = el("div", { className: "ch-strip", "aria-label": "Drum listen modes", "data-ch-strip": "drums" });
        // Lit for drums-only solo, and also when D&B is active (drums are part of that listen).
        const on = listenMode === "drums" || listenMode === "db";
        const title = drumsSupported ? "Solo drums stem" : "Drums stem not available yet";
        const b = el("button", {
          type: "button",
          className: "ch-btn" + (on ? " on" : ""),
          "aria-label": title,
          "aria-pressed": on ? "true" : "false",
          "data-transport": "listen",
          "data-listen": "drums",
          title: title,
        }, ["S"]);
        if (!drumsSupported) b.disabled = true;
        strip.appendChild(b);
        strip.appendChild(el("button", {
          type: "button",
          className: "ch-btn" + (midiDrums ? " on" : ""),
          "aria-label": "Drums MIDI synth from grid",
          "aria-pressed": midiDrums ? "true" : "false",
          "data-transport": "midi",
          "data-midi": "drums",
          title: "MIDI — hear drum grid (WebAudio) instead of the drums stem",
        }, ["MIDI"]));
        return strip;
      }
      layers.appendChild(layer("Bass tab · " + pat.name + " · drag to loop bars", makeTab(lay.viewLo, lay.viewHi, lay.n, playX, pat)));
      layers.appendChild(layer("Chord names · estimate · Roman fn", makeChords(lay.viewLo, lay.viewHi, lay.n, playX, bar, sec.kind), "chords", makeChordChannelStrip()));
      layers.appendChild(layer("Bass staff", makeBassStaff(lay.viewLo, lay.viewHi, lay.n, playX, pat), null, makeBassChannelStrip()));
      const drumLabel = rhythmOut ? "rests (out)" : (drumsViewOut ? "rests (drums out)" : drumHatLabel(viewDrumHits, hat16));
      layers.appendChild(layer("Drum staff · " + drumLabel, makeDrumStaff(lay.viewLo, lay.viewHi, lay.n, playX, hat16, rhythmOut, { drumsOut, drumsOutBars: DRUMS_OUT_BARS, drumHits: SONG_DRUM_HITS }), null, makeDrumChannelStrip()));
      grid.appendChild(layers);

      const cards = el("div", { className: "cards", "data-cards-panel": "1" });
      const cardsHead = el("div", { className: "cards-head" });
      cardsHead.appendChild(el("span", { className: "cards-title" }, ["Flashcards"]));
      cardsHead.appendChild(el("span", { className: "sub" }, [sec.name + " · " + ((cardIdx % deck.length) + 1) + "/" + deck.length]));
      cards.appendChild(cardsHead);
      cards.appendChild(el("div", { className: "card-label" }, [card.label]));
      cards.appendChild(el("div", { className: "card-body" }, [card.body]));
      const insightPat = resolveInsightPattern(card.insight, PATS_EFF) || pat;
      const insightView = makeCardInsight(card.insight, insightPat);
      if (insightView) {
        const playBtn = insightView.querySelector("[data-insight-play]");
        if (playBtn) {
          const icons = playBtn.__insightIcons || {};
          const iconPlay = icons.play || '<svg class="card-insight-icon" data-icon="play" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><polygon points="2.5,1 10.5,6 2.5,11" fill="currentColor"/></svg>';
          const iconStop = icons.stop || '<svg class="card-insight-icon" data-icon="stop" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="currentColor"/></svg>';
          if (insightMidiPlaying) {
            playBtn.classList.add("on");
            playBtn.innerHTML = iconStop;
            playBtn.setAttribute("aria-label", "Stop card MIDI");
            playBtn.title = "Stop — end looping card MIDI";
          } else {
            playBtn.classList.remove("on");
            playBtn.innerHTML = iconPlay;
            playBtn.setAttribute("aria-label", "Play card claim-window MIDI");
            playBtn.title = "Play — loop this card’s claim window (pauses the main player)";
          }
        }
        const bassBtn = insightView.querySelector('[data-insight-voice="bass"]');
        if (bassBtn && insightMidiBassOn) bassBtn.classList.add("on");
        const drumsBtn = insightView.querySelector('[data-insight-voice="drums"]');
        if (drumsBtn && insightMidiDrumsOn) drumsBtn.classList.add("on");
        const chordsBtn = insightView.querySelector('[data-insight-voice="chords"]');
        if (chordsBtn && insightMidiChordsOn) chordsBtn.classList.add("on");
        cards.appendChild(insightView);
      }
      // Panel order (desktop + drawer): label → body → insight → mini-grid → Prev/Next.
      const gridCards = el("div", { className: "card-grid" });
      deck.forEach((c, i) => {
        const active = i === cardIdx % deck.length;
        const b = el("button", { type: "button", className: "card-mini" + (active ? " active" : ""), "data-card": String(i) });
        b.appendChild(el("div", { className: "card-mini-label" }, [c.label]));
        b.appendChild(el("div", { className: "card-mini-body" }, [c.body.slice(0, 64) + (c.body.length > 64 ? "…" : "")]));
        gridCards.appendChild(b);
      });
      cards.appendChild(gridCards);
      const cardActions = el("div", { className: "card-actions" });
      cardActions.appendChild(el("button", { type: "button", className: "btn", "data-card-prev": "1" }, ["Prev"]));
      cardActions.appendChild(el("button", { type: "button", className: "btn primary", "data-card-next": "1" }, ["Next card"]));
      cardActions.appendChild(el("span", { className: "sub" }, ["Arranger notes for this section"]));
      cards.appendChild(cardActions);

      const phone = isPhoneLayout();
      document.body.classList.toggle("cards-drawer-open", phone && cardsDrawerOpen);
      if (phone) {
        // Score stack only — cards move into the slide-away bottom sheet.
        shell.appendChild(grid);
        root.appendChild(shell);

        const peek = el("button", {
          type: "button",
          className: "phone-cards-peek",
          "data-drawer": "open",
          "aria-label": "Open flashcards",
          "aria-expanded": cardsDrawerOpen ? "true" : "false",
        });
        const peekInsight = card.insight && typeof card.insight === "object" ? card.insight : null;
        const peekLayer = peekInsight ? (peekInsight.layer || "figure") : "";
        // Kicker hints that opening the drawer reveals the lean-B schematic (not prose-only).
        peek.appendChild(el("div", {
          className: "phone-cards-peek-kicker",
          "data-peek-insight": peekInsight ? "1" : "0",
          "data-insight-layer": peekLayer || "",
        }, [
          peekLayer ? ("Flashcards · " + String(peekLayer) + " schematic") : "Flashcards",
        ]));
        const peekRow = el("div", { className: "phone-cards-peek-row" });
        peekRow.appendChild(el("span", { className: "phone-cards-peek-label" }, [card.label + " · " + sec.name]));
        peekRow.appendChild(el("span", { className: "phone-cards-peek-count" }, [((cardIdx % deck.length) + 1) + "/" + deck.length + " · open"]));
        peek.appendChild(peekRow);
        if (cardsDrawerOpen) peek.hidden = true;
        root.appendChild(peek);

        const backdrop = el("button", {
          type: "button",
          className: "cards-drawer-backdrop",
          "data-drawer": "close",
          "aria-label": "Close flashcards",
        });
        if (!cardsDrawerOpen) backdrop.hidden = true;
        root.appendChild(backdrop);

        const drawer = el("div", {
          className: "cards-drawer" + (cardsDrawerOpen ? " open" : ""),
          "data-cards-drawer": "1",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Flashcards",
        });
        if (!cardsDrawerOpen) drawer.hidden = true;
        const handle = el("div", { className: "cards-drawer-handle" });
        const handleLeft = el("div", {});
        handleLeft.appendChild(el("div", { className: "cards-drawer-grip" }));
        handleLeft.appendChild(el("div", { className: "cards-drawer-title" }, [sec.name + " · flashcards"]));
        handle.appendChild(handleLeft);
        handle.appendChild(el("button", {
          type: "button",
          className: "cards-drawer-close",
          "data-drawer": "close",
          "aria-label": "Close flashcards",
        }, ["×"]));
        drawer.appendChild(handle);
        drawer.appendChild(cards);
        root.appendChild(drawer);
      } else {
        cardsDrawerOpen = false;
        document.body.classList.remove("cards-drawer-open");
        grid.appendChild(cards);
        shell.appendChild(grid);
        root.appendChild(shell);
      }
    }

    render();

    // Test / debug hooks (used by vitest jsdom suite). Harmless in production.
    window.__BASS_PLAYER__ = {
      getState: () => {
        const sec = SECS[secIdx];
        const patsRaw = PATS_EFF[sec.id] || PATS_EFF[sec.kind] || PATS[sec.id] || PATS[sec.kind] || PATS.intro;
        const pats = Array.isArray(patsRaw) ? patsRaw : [patsRaw];
        const pat = pats[0] || PEDAL;
        const deck = CARDS_EFF[sec.id] || CARDS_EFF[sec.kind] || CARDS[sec.id] || CARDS[sec.kind] || CARDS.intro;
        const tabHead = document.querySelector(".layer-head");
        return {
          t, playing, loopOn, secIdx, cardIdx, lo, hi,
          usingAudio, audioReady, stemLoading, muteBass, muteBassSupported, privateMode, activeSongId,
          songCatalog,
          listenMode, drumsSupported, midiBass, midiDrums, midiChords, midiScheduleGen, midiNodeCount: midiNodes.length,
          insightMidiGen, insightMidiNodeCount: insightMidiNodes.length, insightMidiVoice,
          insightMidiPlaying, insightMidiLooping: Boolean(insightMidiPlaying && insightMidiLoopTimer),
          insightMidiBassOn, insightMidiDrumsOn, insightMidiChordsOn, playbackRate,
          pitchPreserveMode, stemSourcePlaybackRate: lastStemSourcePlaybackRate, stemTempoUsesRawPlaybackRate: stemTempoUsesRawPlaybackRate(),
          stretchWindowSongSec: STRETCH_WINDOW_SONG_S,
          stretchWindowSongStart, stretchWindowSongEnd,
          stemUrls: { bass: stemUrls.bass, noBass: stemUrls.noBass, drums: stemUrls.drums },
          stemFetchCount,
          audioCtxState: audioCtx ? audioCtx.state : null,
          duration: DURATION, sectionName: sec.name, sectionKind: sec.kind, sectionId: sec.id,
          patternId: pat.id, patternName: pat.name,
          tabLabel: tabHead ? tabHead.textContent : "",
          cardLabels: deck.map((c) => c.label),
          cardBodies: deck.map((c) => c.body),
          activeCardLabel: deck[cardIdx % deck.length].label,
          activeCardInsight: deck[cardIdx % deck.length].insight || null,
          hasInsightPanel: Boolean(document.querySelector(".card-insight")),
          isPhoneLayout: isPhoneLayout(),
          phoneMaxWidth: PHONE_MAX_WIDTH,
          cardsDrawerOpen: Boolean(cardsDrawerOpen),
          cardsInDrawer: Boolean(document.querySelector("[data-cards-drawer] .cards, [data-cards-drawer] [data-cards-panel]")),
          cardsInGrid: Boolean(document.querySelector(".grid > .cards, .grid > [data-cards-panel]")),
        };
      },
      play: onPlay,
      pause: onPause,
      stop: onStop,
      getAudioCtxState: () => (audioCtx ? audioCtx.state : null),
      setMuteBass: (on) => {
        listenMode = on ? "mute" : "full";
        applyListenGains();
        render();
        return window.__BASS_PLAYER__.getState();
      },
      toggleMuteBass: () => {
        listenMode = listenMode === "mute" ? "full" : "mute";
        applyListenGains();
        render();
        return window.__BASS_PLAYER__.getState();
      },
      setListenMode: (mode) => {
        setListenMode(mode);
        return window.__BASS_PLAYER__.getState();
      },
      toggleListenMode: (mode) => {
        setListenMode(mode);
        return window.__BASS_PLAYER__.getState();
      },
      setPlaybackRate: (r) => { setPlaybackRate(r); return window.__BASS_PLAYER__.getState(); },
      setMidiBass: (on) => { setMidi("bass", on); return window.__BASS_PLAYER__.getState(); },
      setMidiDrums: (on) => { setMidi("drums", on); return window.__BASS_PLAYER__.getState(); },
      setMidiChords: (on) => { setMidi("chords", on); return window.__BASS_PLAYER__.getState(); },
      toggleMidiBass: () => { toggleMidi("bass"); return window.__BASS_PLAYER__.getState(); },
      toggleMidiDrums: () => { toggleMidi("drums"); return window.__BASS_PLAYER__.getState(); },
      toggleMidiChords: () => { toggleMidi("chords"); return window.__BASS_PLAYER__.getState(); },
      playInsightMidi: (voice) => {
        const r = playInsightMidi(voice);
        return Object.assign({}, window.__BASS_PLAYER__.getState(), { insightMidiResult: r });
      },
      toggleInsightMidiPlay: () => {
        const r = toggleInsightMidiPlay();
        return Object.assign({}, window.__BASS_PLAYER__.getState(), { insightMidiResult: r });
      },
      toggleInsightMidiVoice: (voice) => {
        const r = toggleInsightMidiVoice(voice);
        return Object.assign({}, window.__BASS_PLAYER__.getState(), { insightMidiResult: r });
      },
      cancelInsightMidi: () => { cancelInsightMidi(); return window.__BASS_PLAYER__.getState(); },
      seek: onSeek,
      pickSection,
      clearSubsection,
      nextSection,
      leftArrow: leftArrowNav,
      setLoopBars: onLoopBars,
      setLoop: (on) => {
        loopOn = Boolean(on);
        if (loopOn) { lo = SECS[secIdx].first; hi = SECS[secIdx].end - 1; }
        render();
        return window.__BASS_PLAYER__.getState();
      },
      toggleLoop: () => {
        loopOn = !loopOn;
        if (loopOn) { lo = SECS[secIdx].first; hi = SECS[secIdx].end - 1; }
        render();
        return window.__BASS_PLAYER__.getState();
      },
      nextCard: () => { cardIdx++; render(); return window.__BASS_PLAYER__.getState(); },
      prevCard: () => {
        const sec = SECS[secIdx];
        const deck = CARDS_EFF[sec.id] || CARDS_EFF[sec.kind] || CARDS[sec.id] || CARDS[sec.kind] || CARDS.intro;
        const n = Math.max(1, deck.length);
        cardIdx = (cardIdx % n + n - 1) % n;
        render();
        return window.__BASS_PLAYER__.getState();
      },
      setCard: (i) => { cardIdx = i; cancelInsightMidi(); render(); return window.__BASS_PLAYER__.getState(); },
      openCardsDrawer: () => { cardsDrawerOpen = true; render(); return window.__BASS_PLAYER__.getState(); },
      closeCardsDrawer: () => { cardsDrawerOpen = false; render(); return window.__BASS_PLAYER__.getState(); },
      toggleCardsDrawer: () => { cardsDrawerOpen = !cardsDrawerOpen; render(); return window.__BASS_PLAYER__.getState(); },
      isPhoneLayout,
      waitTick: (ms = 60) => new Promise((r) => setTimeout(r, ms)),
      ensureAudio: () => ensureAudio(),
      beginStemFetch: () => beginStemFetch(),
      destroy: () => {
        destroyed = true;
        cardsDrawerOpen = false;
        document.body.classList.remove("cards-drawer-open");
        cancelInsightMidi();
        haltPlayback({ syncTime: false, resetToLoopStart: false });
        if (timer) { clearInterval(timer); timer = null; }
      },
    };
    window.dispatchEvent(new Event("bass-player-ready"));
  }

  window.__BASS_NOTATION__ = {
    PHONE_MAX_WIDTH,
    isPhoneLayout,
    WRITTEN_OCTAVE,
    staffPos,
    staffYy,
    parseTimeSig,
    keySigFromKeys,
    appendTimeSignature,
    appendKeySignature,
    noteDurationSteps,
    durationStyle,
    notatedStepsOf,
    isTieContinuation,
    splitTiedSegments,
    appendBassTiePaths,
    restsForGap,
    buildRhythmVoice,
    beamGroups,
    buildDrumHits,
    drumHitsForView,
    normalizeSongDrumHits,
    songDrumHitsForView,
    drumHatLabel,
    isRhythmOut,
    isDrumsOut,
    normalizeDrumsOutBars,
    isBarDrumsSilent,
    BASS_MIDI_VOICE,
    CHORD_MIDI_VOICE,
    parseChordSymbol,
    chordToneMidis,
    chordPitchClasses,
    midiToFreq,
    expandPatternNotes,
    stepToSongTime,
    listenGains,
    stretchChannel,
    stretchAudioBuffer,
    stemTempoUsesRawPlaybackRate,
    STRETCH_WINDOW_SONG_S: 16,
    INTERACTIVE_STRETCH_OPTS: { seekWin: 0 },
    tabPos,
    OPEN: OPEN.slice(),
    midiToName,
    resolveInsightPattern,
    makeCardInsight,
    buildInsightMidiEvents,
    CARDS,
    PATS,
    EMPTY,
    TURN,
    SYNC_OCT,
    WALK,
    PEDAL,
  };

  boot().catch((err) => {
    const root = document.getElementById("app");
    if (root) root.textContent = "Failed to load demo: " + err.message;
  });
})();
