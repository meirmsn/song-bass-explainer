# Bass Study

Human in the loop: @meirmsn. Robot hands: @meirmsn-agent.

![Analysis view](docs/analysis-view.png)

A practice player for learning a bass line with the recording, the staves, the chords, and a short explanation kept in time on one screen.

It exists so a bass part can be studied against the actual track. Keeping stems, notation, and soft MIDI on the same clock, and slowing the audio while the pitch stays put, took the longest to get right. The drum staff only draws hits that were measured, so silence stays silence. It is live at [bass.meirmsn.dev](https://bass.meirmsn.dev), with three public demos on `/`, and processed personal tracks behind private Access.

## Approach

This was built by talking to Grok Bot, to learn how agent-driven work feels: voice chat, raw screenshot feedback, and rapid-fire instructions. It is not the structured method in [devshop](https://github.com/meirmsn/abra-kadabra). There is no CI and no PR-gated workflow by design; this packaging pull request is an exception so the public page can be reviewed. The loop was barebones: ask, the agent ships, feedback, the next ask. A request queue showed up after rapid-fire instructions piled up. Testing was not assumed at the start; breaks prompted the question of whether tests existed, and the suite grew from there.

## What it does
- Synced bass and drum staves with key and time signatures, and a chord row of playable soft MIDI pads.
- Stem mute and solo, so bass, drums, or both can be heard against the rest of the mix.
- Pitch-preserving tempo at 100%, 90%, 75%, 50%, and 25%, a section timeline that auto-advances, and L to loop the current bar window.
- Insight flashcards (Pocket, Figure, Harmony, Missable) with a two-staff schematic of the claim window. Card Play loops that window; Bass, Drums, and Chords toggles choose what you hear.
- Public demos with no Access gate: Komiku — A good bass for gambling (CC0), HoliznaCC0 — Make Funk (CC0), and Maple Leaf Rag (Public Domain Mark). Private Access holds processed personal tracks.

## How it works
- A Cloudflare Worker (`bass-study`) serves the browser player from `public/` and reads stems and study JSON from R2 (`bass-demo` for public demos, `bass-private` for Access-gated studies). The custom domain is [bass.meirmsn.dev](https://bass.meirmsn.dev).
- Tempo uses a WSOLA time-stretch in the client, so a slower rate keeps the original pitch. Drum notation comes only from processed `drumHits`; an empty list leaves rests.
- Demucs stem splits and study JSON are prepared offline. `scripts/` and `work/` hold pieces of that pipeline. Rebuilding a track still needs the models, a machine that can run them, and the R2 buckets. The Worker does not run Demucs.
- `npm test` runs the vitest suite. `npm run deploy` runs those tests and then Wrangler from a working tree.
- The app was built in conversation with coding agents. There is no CI. The agent kept a long-lived Cloudflare deploy token so this personal tool could ship quickly. For anything shared, add CI on pull requests, replace that long-lived key with short-lived credentials (OIDC, or a deploy a person starts), and run secrets scanning in CI.

## Build log
- 2026-10 — first version: player shell and Cloudflare Worker imported; bass MIDI is a soft sine plus a quiet octave layer.
- 2026-10 — the public page needed a track that could be shared → Komiku “A good bass for gambling” (CC0) on `/`, with tempo steps.
- 2026-10 — slowing playback was shifting the pitch, and empty drum stems were growing a fake kit → WSOLA time-stretch, and the drum staff draws song hits only.
- 2026-10 — one demo was a narrow practice set → Make Funk and Maple Leaf Rag joined the public catalog; the private song list became a typeahead, and the public page dropped its Private link.
- 2026-10 — chords and cards were hard to hear and see → playable chord MIDI pads, bass key and time signatures (drums keep time only), two-staff claim-window schematics, and card Play with Bass, Drums, and Chords icons.

## Known limitations
- Stem audio is not in git. The Worker serves it from R2.
- Private Access is for the owner. There is no public YouTube paste-to-process path. A private intake form sits behind Access.
- The drum kit is only processed `drumHits`. Missing hits leave the staff empty. Maple Leaf Rag ships that way: piano, and almost no kit.
- MacBook Air speakers struggle with low bass MIDI. A presence layer was researched and left unshipped.
- No CI.

## Run it
- Open the live demo: https://bass.meirmsn.dev
- Local play needs Node, `npm install`, and Wrangler. `npm run dev` (`wrangler dev`) uses the bindings in `wrangler.toml`: `DEMO_BUCKET` → `bass-demo`, `PRIVATE_BUCKET` → `bass-private`, and static assets from `./public`. Those buckets and a Cloudflare API token have to exist; this repo does not include the audio. `npm test` runs vitest with no deploy. `npm run deploy` runs the tests, then `wrangler deploy`, and expects `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_BUILD_TOKEN`.

## Feedback
Suggestions and critiques welcome — open an issue or a discussion.

## License
MIT
