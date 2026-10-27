# Song Bass Explainer

A practice player for learning a song and its bass line, and understanding the music theory behind it: what makes this song unique and what makes its bass line work.

The song timeline and sections allow you to see the song at a high level, and selecting a section quickly jumps to it. The main view shows the song chords and their harmonic function, the bass tab and staff, and the drum staff so you can see how the rhythm and harmony are tied together by the bass line. Insight cards highlight parts of that view to make it easier to discover and better understand the song's inner workings. Looping and pitch-preserving tempo make a difficult line easier to learn; keyboard shortcuts keep transport under your fingers.

![Analysis view](docs/analysis-view.png)

## Approach

This was built by talking to Grok Bot, to learn how personal desktop agent work (Grok Bot) felt for me: voice chat, raw screenshot feedback, and rapid-fire instructions. It is not the detailed method used in the [devshop](https://github.com/meirmsn/abra-kadabra). There is no CI and no PR-gated workflow by design; this pull request is an exception so the public page can be reviewed. The loop was barebones: ask, the agent ships, feedback, the next ask. I requested the agent to set up a simple request queue after rapid-fire instructions piled up.

## What it does
- Bass and drum staves and a song chord row, all synced in time.
- Stem mute and solo so bass, drums, or both can be heard against the rest of the mix, plus soft MIDI for the bass and drums.
- Pitch-preserving tempo at 100%, 90%, 75%, 50%, and 25%, and a section timeline that auto-advances.
- Keyboard shortcuts for transport controls and looping, and drag to select a subsection to loop.
- Insight flashcards (Pocket, Figure, Harmony, Missable) with a bass-drum schematic to see core bass-against-drums patterns. Playable on loop; Bass and Drums toggles choose what you hear.
- Public demos: Komiku — A good bass for gambling (CC0), HoliznaCC0 — Make Funk (CC0), and Maple Leaf Rag (Public Domain Mark). Private Access holds processed personal tracks.

## How it works

```text
Offline (once per song)
  source audio
       |
       v
  Demucs stems + study JSON (insights, from transcription + LLM)
       |
       v
  R2:  bass-demo  |  bass-private

Runtime
  browser  <-->  Worker (bass-study)  <-->  R2
                   |
                   serves ./public
                   @ bass.meirmsn.dev

  Tempo: WSOLA in the browser (pitch kept)
```

`npm test` runs vitest. `npm run deploy` runs the tests, then Wrangler. Rebuilding a track still needs the models, a machine that can run them, and the R2 buckets.

No CI. A Cloudflare deploy token ships this personal tool. To harden a personal deploy, add pull-request CI, short-lived deploy credentials, and a secrets scan — advice, not a feature of this site.

## Build log
- 2026-10-24 — first version: R2, Worker, domain, and the player shell live at bass.meirmsn.dev (in agent workspace, not yet in repo).
- 2026-10-25 — player and Worker copied into this repo (imported to GitHub for backup in case the agent workspace got nuked or I lost access in the future).
- 2026-10-26 — insight cards (Pocket, Figure, Harmony, Missable), phone flashcards in a bottom drawer, and Komiku “A good bass for gambling” (CC0) on `/` with tempo steps.
- 2026-10-26 — slowing playback was shifting the pitch → WSOLA time-stretch. The drum staff was showing made-up lines when the drums were quiet in a section.
- 2026-10-26 — one demo was a narrow practice set → Make Funk and Maple Leaf Rag joined the catalog.
- 2026-10-26 — chords and cards were hard to hear and see → bass key and time signatures (drums keep time only), bass-drum claim-window schematics, and card Play with Bass, Drums, and Chords icons.

## Known limitations
- There is no current way for a non-host to upload and process a custom track.
- No CI (by design, see Approach above).

## Run it
- Open the live demo: https://bass.meirmsn.dev
- Local play needs Node, `npm install`, and Wrangler. `npm run dev` (`wrangler dev`) uses the bindings in `wrangler.toml`: `DEMO_BUCKET` → `bass-demo`, `PRIVATE_BUCKET` → `bass-private`, and static assets from `./public`. Those buckets and a Cloudflare API token have to exist; this repo does not include the audio. `npm test` runs vitest with no deploy. `npm run deploy` runs the tests, then `wrangler deploy`, and expects `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_BUILD_TOKEN`.

## Feedback
Suggestions and critiques welcome — open an issue or a discussion.

## License
MIT
