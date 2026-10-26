# Bass study Cloudflare setup (2026-10-23 America/Los_Angeles)

## R2 buckets (private by default; no public access)
- `bass-demo` (location WNAM, created 2026-10-24T02:50:04Z UTC)
- `bass-private` (location WNAM, created 2026-10-24T02:50:07Z UTC)

## Worker
- Name: `bass-study`
- Version ID: `7a54d346-b65f-41b8-9e6f-1f0bbda30e08`
- workers.dev: https://bass-study.meirmsn.workers.dev
- Custom domain: https://bass.meirmsn.dev
- Bindings:
  - `DEMO_BUCKET` → `bass-demo` (R2)
  - `PRIVATE_BUCKET` → `bass-private` (R2)
  - `ASSETS` → static assets from `./public`
- Source on box: `/workspace/bass-study`

## Workers Custom Domain
- Hostname: `bass.meirmsn.dev`
- Domain record id: `1f0d4a982cfa879abf7226d2cea34b6330fed7e8`
- Zone: meirmsn.dev / `268017140dc774aef2a32c07a6b993fe`
- Cert id: `4c46ef6b-c563-444d-8308-a3cfd0dd75d8`
- DNS: proxied AAAA `100::` (Workers-managed, read-only) id `235ab28263e58f27f787bce8dcf6d048`

## Verified
- https://bass.meirmsn.dev/ → 200 placeholder HTML
- https://bass.meirmsn.dev/private/ → 200 "Login required / private catalog"
- https://bass.meirmsn.dev/_health → `{"ok":true,"r2_demo":true,"r2_private":true}`
- SSL: Google Trust Services WE1, CN=meirmsn.dev (valid through Jan 2027)
- Access apps created: none

## Next step (manual Access dashboard)
Zero Trust → Access → Applications → Add application → Self-hosted:
- Application name: Bass Study Private (or similar)
- Application domain: `bass.meirmsn.dev`
- Path: `/private` and `/private/*` (or path `/private*` depending on UI)
- Do NOT protect `/` (leave public demo open)
- Policy: allow your email / IdP as desired

## Player shell deploy (2026-10-24 America/Los_Angeles)
- Version ID: 8ca64106-db62-406f-9ed0-763240d6227b
- Public: https://bass.meirmsn.dev/ — player shell (timeline, tab→chords/romans→bass→drums, playhead, loop/drag, transport, flashcards)
- Private: https://bass.meirmsn.dev/private/ — Access 302; intake UI + /private/api/jobs
- Public /api/jobs → 401 (use Access path)
- R2 demo: bass-demo/demo/like-a-prayer/demo-data.json + catalog.json
- Pipeline proposal: PIPELINE-PROPOSAL.md
