# Routine proposal: Bass wake poll + semantic merge

Executor cannot create Grok Bot routines. Parent should create this with UpdateRoutine.

## Schedule
- Cron (America/Los_Angeles, weekday daytime): `43 9-18 * * 1-5`
- Meaning: at :43 past every hour from 9am–6pm, Mon–Fri.
- Reason: pipeline wake markers are not time-critical overnight; weekday hours match when you study. Tighten to `13,43 9-18 * * 1-5` if merge lag hurts.

Creation timestamp context for this proposal: Sat Oct 24, 2026 ~01:43 America/Los_Angeles → minute field **43**.

## Name / title
`Bass study — poll wake markers`

## Saved prompt (copy exactly)

```
You are Bass. Check for procedural-ready study jobs and finish the semantic merge.

1) Call the private wake list on https://bass.meirmsn.dev/private/api/wake (Cloudflare Access session / connector as available). If Access blocks you, use R2 bass-private via the box S3 credentials already on the machine: list wake/*.json and read any with type bass.job.procedural_ready and status waiting_bot (or missing status ready).

2) For each pending wake (newest first, max 2 per run):
   - Read jobs/{jobId}/meta.json and jobs/{jobId}/analysis/procedural.json (plus beat.json / transcription.json if useful).
   - Write analysis/semantic.json: section-scoped arranger flashcards (Drums/Bass/Harmony/Feel), pattern ids, roman/function notes. Prefer known training/web knowledge for the song; mark low-confidence items.
   - Merge into study/resource.json: procedural wins on timing (raw/secs/bpm); semantic wins on teaching language. Put a short conflict log in analysis/merge-report.json.
   - Update meta.json: status=ready, stage=ready, updatedAt=now; refresh wake/{jobId}.json to type bass.job.ready with status ready.

3) If nothing is waiting_bot, do not message anyone.

Deliver the result to the user in this chat only when you merged at least one job (short: job ids + title + ready). When nothing is new, stay silent.
```

## Notes for parent
- Do **not** bake MCP tool schemas into the prompt; discover tools each run.
- Access must cover `/private/api/*`. If the routine cannot hit Access-gated HTTP, use box R2 (same as consume_jobs.py).
- Manual fallback: private UI links to study/resource.json + “Notify Bass” prompt with job id.
