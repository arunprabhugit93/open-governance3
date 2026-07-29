# Handover notes — Open Governance3 build-out

This file is maintained by the autonomous /loop session working toward full
Promptfoo feature parity (see `open-governance3-user-manual.txt` in the
conversation for the product spec). Read this first if you're picking up
mid-stream.

## Environment facts worth knowing

- The GitHub repo (`arunprabhugit93/open-governance3`) started **completely
  empty**. The first real commit (`36c14db`) contains the whole scaffolded
  product — Express backend, React/Vite frontend, vendored `promptfoo-source/`,
  Postgres schema. It was NOT built by this iteration; a prior iteration in
  this same session (before a context compaction) built it.
- Local dev stack: Postgres via `docker compose up -d postgres` (port 15432,
  see `docker-compose.yml`), backend `node app/server.cjs` (port 18080),
  frontend `npm run frontend:dev` (Vite, port 5173, proxies `/api` to 18080).
- **Gotcha already hit once**: there was a stray *native* (non-docker)
  Postgres running on port 5432 with real target data in it from earlier
  work, while a fresh empty Docker Postgres also existed on 15432. I
  `pg_dump`'d the native one and `pg_restore`'d into the Docker one, then
  killed the stray backend process that was pointed at the native DB. Going
  forward, **the Docker Postgres on 15432 is canonical** — don't recreate a
  native one.
- `.env` is gitignored and currently holds `APP_SECRET` = the placeholder
  from `.env.example` (`change-this-32-byte-secret-for-provider-key-...`).
  Provider secrets in the DB are AES-encrypted with whatever `APP_SECRET` was
  active when they were saved — if `APP_SECRET` ever changes, previously
  stored provider keys become undecryptable ("Unsupported state or unable to
  authenticate data" on provider test). This already happened once with the
  Groq key on target `a50b6599-0c19-41fc-ba27-721d5a402a1e` ("Browser
  readiness model") — fixed by re-saving the key through
  `PATCH /stages/eval/config`.
- The user gave a **real Groq API key** (`gsk_...JBuT`) for testing. It is
  stored *only* encrypted in Postgres (`provider_secrets` table), reachable
  via target `a50b6599-0c19-41fc-ba27-721d5a402a1e`. It is **not** and must
  **never** be written into any tracked file. It's currently verified working
  end-to-end (provider test + full eval run both pass against
  `llama-3.1-8b-instant` on `https://api.groq.com/openai/v1`).
- User explicitly asked: (1) push to GitHub periodically as work lands —
  standing permission granted for this task, no need to ask each time; (2)
  never stop and wait for confirmation on routine dev work; (3) don't commit
  the Groq key to source. Pushing to remote is otherwise normally a
  confirm-first action — this task is the documented exception.

## What's actually true about the codebase (verified by reading, not assuming)

The product is **not a stub/skeleton** — it's a real, working implementation:

- `app/server.cjs` (~4600 lines): every assertion type from the manual's
  catalog (section 9.3) has a real `case` in `evaluateAssertion`. Only two
  were genuinely placeholder-quality: `similar`/`similar:cosine`/`similar:dot`
  /`similar:euclidean` (was pure Jaccard word-overlap) and `moderation` (still
  a local heuristic, not a real moderation API — **not yet fixed**).
- Provider adapters: `app/shared/provider-catalog.cjs` maps ~50 cataloged
  providers to adapters. Most OpenAI-shaped providers (groq, openrouter,
  together, fireworks, mistral, deepinfra, nvidia-nim, cerebras, sambanova,
  xai, moonshot, deepseek, local runtimes, etc.) already route through the
  real `openai-compatible` adapter and are genuinely executable today. Only
  a smaller set is still `adapter-required` (stub): azure-openai, vertex-ai,
  aws-bedrock, aws-sagemaker, watsonx, databricks, snowflake-cortex,
  cloudflare-workers-ai, graphql, websocket-chat, browser-chatbot,
  mcp-server, huggingface-inference, replicate, fal, voyage, ai21.
- Full flow (Registry → Onboarding → Target Detail → Eval/Red-team/Model-audit
  workspaces → Evidence) works end-to-end against a live provider — verified
  by running a real eval against Groq through the UI's own API.
- Known UX gap confirmed by hand-testing in the browser: the frontend has
  **no real client-side routing** — everything is client state with no URL
  changes, so refresh always drops back to the Registry root, no deep links,
  no browser back/forward. Not fixed yet. Good candidate for the UX task.
- The whole frontend lives in one 3700+ line `app/frontend/src/main.tsx`.
  Not broken, just a maintainability/velocity concern — flagged in task #7,
  not yet acted on.

## Change log (this iteration only — see `git log` for the rest)

1. Recovered/migrated the native-Postgres data into the Docker Postgres,
   fixed the stray-process port conflict.
2. Re-saved the Groq provider key so it decrypts under the current
   `APP_SECRET` (was previously undecryptable).
3. Verified full eval pipeline end-to-end against live Groq API — passing.
4. Implemented real embedding-based similarity for the `similar*` assertion
   family (`app/server.cjs`: `cosineSimilarityVec`, `dotProductVec`,
   `euclideanSimilarityVec`, `callOpenAICompatibleEmbedding`,
   `embeddingSimilarity`), wired to a new "Embedding model" field in Target
   Settings → Judge section (`app/frontend/src/main.tsx`,
   `app/frontend/src/api.ts`). Falls back cleanly to the old Jaccard
   approximation (with a visible `approximationReason`) when no
   embedding-capable judge provider is configured. Verified both the
   fallback path and that it doesn't regress existing eval runs. Committed
   as `2a6b900` and pushed to `origin/main`.

## Task list (see TaskList tool — these IDs are live, not just notes)

- #1 [done] Get product running locally + smoke test
- #2 [pending] Audit server.cjs/main.tsx for stubs — **partially done above**,
  main remaining known gap is `moderation` assertion (still local heuristic)
  and the `adapter-required` provider list above
- #3 [pending] Expand provider adapters (azure-openai, bedrock, vertex, etc.)
- #4 [pending] Assertion engine — `similar*` done, `moderation` still open
- #5 [pending] Red-team plugin/strategy depth (currently generic
  refusal-vs-non-refusal grading per the manual's own admission)
- #6 [pending] Model-audit real scanner integration (currently metadata-only
  checks)
- #7 [pending] UX pass — routing/deep-links is the top known issue; also
  consider splitting `main.tsx`
- #8 [pending] Multi-user/roles, auth hardening beyond single admin login
- #9 [pending] CI/CD integration screens, webhook/custom-assertion hardening

## How to resume

```bash
cd /Users/arunprabhu/Documents/opngov/open-governance3
docker ps | grep open-governance3-postgres || npm run db:up
node app/server.cjs &            # if not already running (check :18080)
npm run frontend:dev &           # if not already running (check :5173)
curl -s http://localhost:18080/api/health
```

Login: `admin@example.com` / `admin123`. Pick up the next task from
`TaskList`, prefer lowest pending ID unless something more urgent surfaced.
Commit + push after each verified, working increment — don't batch huge
unverified diffs.
