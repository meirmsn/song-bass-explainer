# Access limit for automated tests

Cloudflare Access protects `/private` and `/private/*` (OTP for allowlisted email).

**What CI/unit tests can prove without a session**
- Unauthenticated requests to `/private*` receive `302`/`401` (see `routes.integration.test.mjs`).
- Player transport/mute/seek logic with mocked stems + FakeAudioContext (see `player.dom.test.mjs`).

**What requires a human Access login (not automatable here)**
- Real WebAudio playback from `/private/api/demo/like-a-prayer/stems/*.wav`.
- Mute Bass against live private stems.
- End-to-end “I hear sound” verification in a browser after OTP.

Manual check after deploy:
1. Open `https://bass.meirmsn.dev/private/player/` and complete Access.
2. Press Play — stems should load (badge `stems · full`).
3. Toggle Mute Bass — bass gain drops; bed continues.
4. Seek via section timeline while playing — audio restarts at the section (not stuck/silent).
