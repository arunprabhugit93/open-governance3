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
  /`similar:euclidean` (was pure Jaccard word-overlap) and `moderation` (was
  a local heuristic, not a real moderation API) — **both fixed later this
  session**, see iteration 1 change log below.
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
- Known UX gap confirmed by hand-testing in the browser: the frontend had
  **no real client-side routing** — everything was client state with no URL
  changes, so refresh always dropped back to the Registry root, no deep
  links, no browser back/forward. **Fixed later this session**, see
  iteration 2 change log below (hash-based routing).
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
5. Implemented real moderation-API support for the `moderation` assertion
   (`callOpenAICompatibleModeration`, `moderationCheck` in `app/server.cjs`),
   reusing the same judge-provider config as embeddings (calls
   `${judgeBaseUrl}/moderations`). Falls back to the existing local
   keyword-heuristic (`evaluator: 'local-moderation-approx'`) with a visible
   reason when no judge provider is configured. Verified the fallback path
   live. Task #4 (assertion engine parity) marked complete — the two known
   placeholder assertions are now real-API-backed with honest fallbacks;
   the n-gram metrics (bleu/gleu/rouge/meteor) and model-graded assertions
   were already legitimate local/judge implementations, not placeholders.

## Change log — iteration 2 (routing/UX)

6. Added real hash-based client-side routing (`#/registry`, `#/onboard`,
   `#/targets/:id`, `#/targets/:id/:stage`) to `app/frontend/src/main.tsx`.
   Fixes the routing gap noted above: refresh now restores the exact view
   (including active workspace tab), deep links work, browser back/forward
   works. Deliberately hash-based (not History API) so the Express static
   server needs zero changes — no catch-all route required.
   - Caught and fixed a real bug during manual testing: navigating back to
     a stage-less URL left the previous stage's workspace panel showing
     instead of resetting to Eval. Fixed by making the `initialStage`-sync
     effect in `TargetDetailPage` unconditional instead of guarded on
     truthiness.
   - Also fixed: naively refetching the full target on every stage-tab
     click (because changing `window.location.hash` fires `hashchange`,
     which the App-level listener also handles) — now only refetches when
     the URL's target id actually differs from the currently open one.
   - Verified all of the above live in the browser (screenshots + JS
     inspection of `window.location.hash` and rendered headings), not just
     by reading the diff.
7. Added `aria-label` to registry row buttons (were exposed as unlabeled
   "button" in the accessibility tree despite visible text content).
   Committed as `f7af5be` (routing) and `3471615` (a11y), pushed.

`main.tsx` is still one ~3800-line file — splitting it into per-page
modules is still open and would meaningfully help velocity on future UX
work, but wasn't done this iteration (routing was higher value and lower
risk to land first).

## Change log — iteration 3 (provider adapters)

8. Found and fixed a real bug while starting task #3: `azure-openai` was
   already marked `executable: true` in `app/shared/provider-catalog.cjs`
   (in `OPENAI_COMPATIBLE_KEYS`), but it was silently wrong — the generic
   `openai-compatible` adapter sends `Authorization: Bearer` with no
   `api-version` query param, while Azure requires an `api-key` header and
   `?api-version=`. It would have looked "ready" in the UI and then failed
   against any real Azure resource. (Earlier in this file I'd claimed
   azure-openai was `adapter-required` — that was wrong; the real bug was
   subtler: mislabeled as generically-executable, not marked unexecutable.)
   Fixed by adding a dedicated `azure-openai` adapter (`callAzureOpenAI` in
   `app/server.cjs` and `providers/native-target.cjs`), wired through
   `callProviderAdapter`, both `nativeAdapters` sets, and a new optional
   "API version" field in the Eval workspace provider row (only shown when
   provider type is Azure OpenAI; defaults to `2024-06-01` if left blank).
   Also aliased `huggingface-inference` (updated its default base URL to
   HF's OpenAI-compatible router, `https://router.huggingface.co/v1`) and
   `ai21` onto the existing `openai-compatible` adapter — both have real
   documented OpenAI-compatible chat endpoints, so this is a legitimate
   alias, not a guess.
   Verified via `/api/targets/:id/providers/:providerIndex/test` against a
   fake Azure resource (`fake-resource-xyz.openai.azure.com`): confirmed
   adapter selection, a real DNS-level network attempt (not a code crash),
   and that the live Groq provider on the same target still passes
   afterward (no regression). Could not do a full live-credential Azure
   test — no Azure resource/key available in this environment. Committed
   as `89df3e0`, pushed.

Still `adapter-required` / not yet real: vertex-ai, aws-bedrock,
aws-sagemaker, watsonx, databricks, snowflake-cortex,
cloudflare-workers-ai, graphql, websocket-chat, browser-chatbot,
mcp-server, replicate (plain, not replicate-openai), fal, voyage. These
mostly need provider-specific auth (AWS SigV4, GCP OAuth2 service
accounts, IBM IAM) or non-chat protocols (GraphQL query construction,
WebSocket, async prediction polling) — higher risk to get subtly wrong
without live credentials to test against, so left alone rather than
guessed at.

## Change log — iteration 4 (red-team grading)

9. Replaced the one-size-fits-all refusal-heuristic red-team grader with
   plugin-specific graders in `assessRedTeamOutput` (`app/server.cjs`):
   - `system-prompt-override` / `prompt-extraction` / `indirect-prompt-injection`
     now grade by real token overlap between the output and the target's
     actual `systemPrompt` (`systemPromptOverlapScore`) — a direct leak
     signal instead of refusal-wording guesswork.
   - `pii:*` / `canary` now check PII-shaped regex patterns
     (`looksLikePII`) or the declared protected entity appearing outside
     a refusal.
   - Everything else still uses the old generic heuristic, now explicitly
     labeled `grader: 'refusal-heuristic'` in the result so it's clear
     which plugins have real grading vs. the fallback.
   Verified live against the Groq target for both new paths. **Caught and
   fixed a real bug while testing**: the PII grader's first version
   flagged a correct refusal as a leak because the model's reply echoed
   the entity name back ("I can't provide... related to protected
   canary") — entity mention alone isn't a leak signal, since models
   naturally restate what was asked even while refusing. Fixed by only
   counting entity mentions as a leak when *not* paired with refusal
   language. Committed as `9815768`, pushed.

Still on the generic fallback (real grading not yet worth building without
something to execute against): rbac, bfla, bola, ssrf, sql-injection,
shell-injection, excessive-agency, tool-discovery, contracts, competitors,
debug-access. These are harder because "did the bypass actually succeed"
depends on a downstream system (a real DB, a real tool call) that this
product doesn't execute — grading them well would need the target's own
declared `allowedTools`/`retrievalSources` to simulate a fake resource and
check whether the model's plan-of-action references it, which is a bigger
piece of work than the plugins above.

## Change log — iteration 5 (model audit scanners)

10. Replaced the metadata-only model-audit checks with real local static
    analysis when `audit.artifactPath` resolves to an actual file/directory
    on disk (`resolveLocalArtifactPath` + `scanArtifactForSecrets` /
    `scanArtifactForUnsafeSerialization` / `findArtifactFile` in
    `app/server.cjs`):
    - Secret exposure: regex scan for AWS/GitHub/Slack keys, generic
      api_key-shaped assignments, PEM private key headers.
    - Unsafe code / serialization format: flags pickle-based weight files
      (.pkl/.pt/.pth/.ckpt/.h5/.joblib — these execute arbitrary code on
      load) vs. safe formats (safetensors/onnx/gguf/ggml).
    - SBOM/MBOM and Model card: look for an actual file instead of a
      metadata checkbox.
    Falls back to the old metadata-only SBOM check when the path isn't a
    readable local file (registry references, vendor model names, etc. —
    most targets), so this is additive for those.
    **Investigated real promptfoo's own modelaudit**: it's a *separate
    Python package* (`pip install modelaudit`) that promptfoo's CLI shells
    out to — not vendored JS source. Reimplementing it wholesale would mean
    adding a Python runtime dependency to this Node product, which is a
    much bigger and riskier lift than this session should take on
    unreviewed. What's implemented here covers the checks that are
    genuinely doable as local static analysis in this stack; anything else
    selected as a "scanner" without a dedicated check now says so honestly
    instead of auto-passing silently (previous behavior: every selected
    scanner auto-passed with a canned "recorded for evidence collection"
    message regardless of whether it did anything).
    Verified against a real fixture directory in scratchpad (not committed):
    planted a fake AWS key and a `.pkl` file, confirmed both flagged;
    removed them and added a real SBOM + model card file, confirmed both
    checks flip to passing. Re-ran against the actual live test target
    afterward — 6/6 passing, same as before the change (no regression).
    Committed as `23ddda6`, pushed. Task #6 marked done.

## Change log — iteration 6 (auth hardening + multi-user)

11. Found and fixed a real crash + info-disclosure bug while starting task
    #8: a malformed-but-dotted `Authorization: Bearer` header made
    `verifyToken` call `crypto.timingSafeEqual` on two differently-sized
    buffers, which throws instead of returning false — and since the app
    had *no* error-handling middleware at all, Express's default handler
    turned that into a 500 with the full stack trace (real server file
    paths included) sent straight to an unauthenticated client. Fixed
    `verifyToken` to guard buffer lengths and wrapped it so any malformed
    token degrades to a clean 401, and added a last-resort JSON error
    handler at the end of the middleware chain so any other unhandled
    error also returns a generic `{error: "Internal server error"}"`
    instead of leaking a stack trace, while still logging full details
    server-side. Verified: malformed/no/valid token cases all behave
    correctly now. Committed as `caa9c53`.
12. Replaced the single hardcoded admin/password pair with real multi-user
    accounts: `app_users` table (scrypt-hashed passwords, no new
    dependency), `admin`/`viewer` roles, `requireAdmin` middleware, and
    `/api/users` CRUD (list/create/update-role-or-password/delete) —
    guarded so you can't delete or demote the last admin, or delete your
    own currently-signed-in account. First boot seeds one admin from
    `APP_ADMIN_EMAIL`/`APP_ADMIN_PASSWORD` if `app_users` is empty, so
    existing deployments keep working with the same login after the
    upgrade — verified the original `admin@example.com`/`admin123` still
    logs in. Added an admin-only "Users" page in the frontend (nav item
    only rendered when `user.role === 'admin'`), wired into the hash
    router as `#/users`. Verified end-to-end in the actual browser: logged
    out and back in to pick up the new `id` field on the session, created
    a viewer user through the UI form, confirmed it shows up, confirmed a
    viewer's token gets 403 from `/api/users` but 200 from normal
    endpoints, confirmed self-delete is blocked, deleted the test user
    through the UI. Committed as `57c52ae`, pushed.

13. Closed the scope gap from the previous entry: added `requireAdmin` to
    all 21 POST/PATCH/DELETE routes under `/api/targets` (GET routes
    untouched, so viewers keep read access). Verified with a real viewer
    account: GET still 200s, every tested mutating route now 403s, admin
    re-verified unaffected (ran a full eval successfully afterward).
    **Caught a real data-loss bug while testing**: `PATCH
    /stages/eval/config` replaced `testCases` with `evalBody.testCases ||
    []` — unlike `providers`, which correctly falls back to the existing
    value when omitted from the request body, `testCases` did not. A
    stray `-d '{}'` call earlier in *this session's own testing* (in the
    red-team grading iteration) had already silently wiped the live Groq
    target's test cases with no error surfaced anywhere. Fixed the
    fallback to match `providers`, restored the test cases, verified a
    follow-up empty-body PATCH now correctly leaves them alone, and
    re-ran the full eval (4/4 passing). Committed as `bc80070`, pushed.

**Remaining for task #8** (smaller, lower-urgency items now): no rate
limiting on `/api/auth/login` (brute-force is possible), no token
revocation/logout list (a token stays valid until its 12h expiry even
after "sign out", since sign-out just clears client-side storage), no
password reset flow, and the frontend doesn't yet hide/disable
write-action buttons for a signed-in viewer — they're fully blocked
server-side (403 + the page's existing error banner), just not hidden
proactively in the UI.

## Task list (see TaskList tool — these IDs are live, not just notes)

- #1 [done] Get product running locally + smoke test
- #2 [pending] Audit server.cjs/main.tsx for stubs — the two known
  placeholder assertions are now fixed (see #4); remaining known gap is the
  `adapter-required` provider list above
- #3 [in_progress] Expand provider adapters — azure-openai (was mislabeled,
  now real), huggingface-inference and ai21 (aliased) done; bedrock,
  vertex, watsonx, databricks, snowflake-cortex, cloudflare-workers-ai,
  graphql, websocket-chat, browser-chatbot, mcp-server, replicate, fal,
  voyage still open (see iteration 3 above for why they're harder)
- #4 [done] Assertion engine — `similar*` and `moderation` now real-API-backed
  with graceful fallback
- #5 [in_progress] Red-team plugin/strategy depth — system-prompt-override/
  extraction and pii/canary now have real graders (see iteration 4); the
  agency/injection/tool-abuse plugins still on the generic fallback
- #6 [done] Model-audit real scanner integration — secret exposure, unsafe
  serialization, SBOM, model-card now do real local scans when the artifact
  path is a local file/dir (see iteration 5)
- #7 [in_progress] UX pass — routing/deep-links **done** (see iteration 2
  above); still open: splitting `main.tsx`, broader flow/copy review
- #8 [in_progress] User management/roles/auth hardening — real multi-user
  accounts, admin/viewer roles enforced on every mutating endpoint, a
  fixed crash/info-leak bug, and a fixed data-loss bug are all done
  (iterations 6-7); login rate limiting, token revocation, and
  viewer-aware frontend button hiding are still open (minor, lower
  urgency)
- #9 [pending] CI/CD integration screens, webhook/custom-assertion hardening

## Change log — iteration 8 (E2E test pass + defect fixes)

14. Ran a full live end-to-end test pass across every module (see
    `EVIDENCE.md` for the complete log) — real browser + live Groq API,
    not code review. 11/12 modules passed clean; found and fixed the
    model-audit scanner key-mismatch bug (see iteration 5.1 in
    `EVIDENCE.md`/commit `d556ec1`) during the pass itself.
15. Fixed the one remaining documented-but-unfixed defect from that pass:
    Onboarding's "Initial risk tier" dropdown
    (Basic/Enhanced/Mission-Critical) didn't match Target Settings' "Risk
    tier" dropdown (Basic/Regulated/Critical) for the same
    `metadata.riskTier` field. Reconciled onto Onboarding's option set.
    Checked all existing targets first — none had ever used
    "regulated"/"critical", so no data migration was needed. Verified live:
    a target saved with `riskTier: "enhanced"` now correctly shows
    "Enhanced" selected in Target Settings instead of no match. Committed
    as `2559a6b`, pushed.
16. Cleaned up two stale "not fixed yet" notes higher up in this file
    (the `moderation` assertion and the routing gap) that had actually
    been fixed in iterations 1 and 2 respectively — the notes just hadn't
    been updated at the time. No code changes, just accuracy.

**As of this entry, every defect surfaced by explicit testing this session
has been fixed and re-verified.** Remaining work is scope expansion
(more provider adapters, deeper red-team grading for the agency/tool-abuse
plugins, CI/CD screens, `main.tsx` splitting, login rate limiting/token
revocation) rather than known bugs — see the task list above for what's
still open.

## MAJOR ARCHITECTURAL DISCOVERY — iteration 9, read this before doing more parity work

The user pushed back on the "hand-write every adapter/plugin" approach this
whole session had been taking, correctly pointing out `promptfoo` is
already a project dependency (`app/server.cjs` `require`s it). That was
right, and it changes the playbook for everything below.

**`node_modules/promptfoo` is a real, usable programmatic library, not
just a CLI.** Confirmed by direct testing (`node -e "require('promptfoo')..."`):
- `pf.loadApiProvider(providerPath, {options:{config}})` — the REAL
  provider loader for all ~86 promptfoo provider files (bedrock, vertex,
  watsonx, databricks, cloudflare-ai, snowflake, mcp, fal, voyage, every
  OpenAI-compatible-shaped one, all of it). Verified end-to-end with a live
  Groq call — correct output, real token usage, latency, even guardrails
  metadata this product's own hand-rolled adapters don't produce.
- `pf.redteam.generate({config: <yaml path>, write:false, cache:false})` —
  the REAL redteam engine, all 157 plugin ids / 35 strategy ids, with
  actually sophisticated on-topic adversarial generation (see the commit
  below for a real example). It's CLI-oriented: it resolves its config
  from a **file path**, not inline options — write a temp YAML, point it
  there, clean up after.
- `pf.assertions` and `pf.evaluate` also exist and are very likely
  similarly usable — **not yet exploited, see "Next" below.**

**A real bug in the vendored library, now understood and fixed generally**:
promptfoo's bundled `dist/src/index.cjs` double-wraps chalk's ESM interop,
so `chalk.default` inside their bundle ends up equal to the *raw* required
chalk module rather than chalk's actual `.default` export — and the raw
module doesn't carry chalk's color methods (verified directly: `chalk.red`
is undefined, `chalk.default.red` is defined). Every `chalk.default.X(...)`
call in their bundle throws `chalk.default.X is not a function` — which
hits constantly, since they use it for routine progress/warning logging,
not just error paths. **Fixed once, generally, in `shimChalkForPromptfoo()`**
(called from `loadPromptfooLibrary()` in `app/server.cjs`) by injecting a
plain always-string-returning shim into Node's `require.cache` for
`'chalk'` before promptfoo is first required. **Any future code that calls
into the `promptfoo` library must go through `loadPromptfooLibrary()`,
not a bare `require('promptfoo')`**, or it will hit this bug again.

**What's now wired through this**, both shipped and verified live this
iteration (commits `4f1c8b0`, `d1faf1b`):
- 10 more providers execute via `pf.loadApiProvider` instead of being
  `adapter-required` stubs: vertex-ai, aws-bedrock, aws-sagemaker, watsonx,
  databricks, snowflake-cortex, cloudflare-workers-ai, mcp-server, fal,
  voyage. A new "Provider-specific config (JSON)" field in the Eval
  workspace lets the admin pass whatever auth shape each one actually
  needs (AWS keys, GCP service account, IBM project id, ...) straight
  through to promptfoo's own provider config — verified against the real
  Databricks provider code (got its real "workspace URL required" error,
  then a real timeout once past that, both handled cleanly).
- Red team workspace has a new opt-in "Use real adversarial generation"
  checkbox (`redteam.useRealGeneration`). When on, `buildRedTeamCases`
  calls the real engine using the target's own provider as the attacker
  model; falls back automatically to the existing ~20-template local
  generator on any failure. Default is off — this costs a real generation
  call, so it should stay opt-in, not silently change existing behavior.

**Next, in priority order, if picking this up**:
1. Real assertion grading via `pf.assertions` — would replace the
   remaining approximations (bleu/gleu/rouge/meteor are legitimate local
   n-gram math already, but `similar` still needs a configured embedding
   judge or it approximates, and there may be other assertion types worth
   swapping to the real implementation). Same pattern as the provider
   bridge: try the real one, fall back to local on failure.
2. Real red-team **grading** via `pf.redteam.Graders` — right now,
   real-generated probes (`source: 'generated-live'`) still get graded by
   this product's own plugin-specific heuristics
   (`system-prompt-overlap`/`pii-pattern`/`refusal-heuristic`), not
   promptfoo's own graders, even though the generated test cases come back
   with a `promptfoo:redteam:<plugin>` assert type that implies real
   grading is available. Wiring that up would give proper grading for all
   157 plugins instead of ~20.
3. Expand `PROMPTFOO_NATIVE_GENERATION_PREFIXES` / add more entries to
   `PROMPTFOO_LIBRARY_PROVIDERS` if new gaps are found — the pattern is
   proven, it's now mostly a matter of confirming more prefixes against
   `promptfoo-source/src/providers/registry.ts`.

Given this, re-scope task #3 (providers) and #5 (redteam) as "library
integration, not hand-written adapters" — writing more bespoke HTTP
adapters by hand is no longer the right move for filling gaps; check
whether `pf.loadApiProvider`/`pf.redteam`/`pf.assertions` already covers
it first.

(While restarting to test this, also discovered and recovered from an
unrelated environment issue: the Docker daemon had stopped during this
long-running session — probably a sleep/wake cycle — taking the Postgres
container down with it. Restarted both; confirmed no data loss.)

## How to resume

```bash
cd /Users/arunprabhu/Documents/opngov/open-governance3
docker ps | grep open-governance3-postgres || (open -a Docker && sleep 15 && npm run db:up)
node app/server.cjs &            # if not already running (check :18080)
npm run frontend:dev &           # if not already running (check :5173)
curl -s http://localhost:18080/api/health
```

If Docker/Postgres was down (check `docker ps -a` for an Exited container
before assuming data loss — `docker start open-governance3-postgres` first,
data lives in a named volume and survives container restarts).

## Change log — iteration 10 (catalog expansion + a graders investigation)

17. Expanded the red-team plugin/strategy catalog from 20/10 to 145/37,
    extracted directly from `promptfoo-source`'s own constants (not
    hand-transcribed) — see commit `26cc0d1`. Since real generation
    (iteration 9) already handles any real plugin id, this was the actual
    remaining bottleneck: the UI only exposed 20 plugins to select from.
    Kept 4 of this product's pre-existing non-real custom keys (canary,
    harmful:violence, roleplay, encoded) under a "Legacy (this product)"
    bucket so existing saved targets don't lose their configuration.
    Verified live: existing target's old-plugin redteam run still passes
    (no regression), and a brand-new catalog plugin ("hallucination",
    unreachable before) generates a real probe via live Groq in ~6.5s.
18. **Investigated (not shipped) real red-team grading via
    `pf.redteam.Graders`** — the other "Next" item from iteration 9. It
    works (verified: real rubric-based grading, correct pass/fail,
    reasonable `reason` text, using our own Groq provider as judge) for at
    least one code path, but hit a real snag: `grader.getResult(...)`
    sometimes throws "API key is not set... OPENAI_API_KEY" **even when a
    working `provider` argument is passed** — reproduced with the *same*
    grader on two different outputs (a refusing response worked with only
    the passed-in Groq provider; a non-refusing response demanded
    OPENAI_API_KEY instead). Hypothesis: a refusal pre-check short-circuits
    without needing the LLM judge, but the full rubric-grading path uses a
    separate, not-yet-understood default-provider resolution (possibly a
    `redteamProviderManager`-style singleton that `pf.redteam.generate()`
    populates as a side effect, which a standalone `getResult()` call never
    triggers). **Do not ship this integration until that's understood** —
    better to keep this product's own working plugin-specific graders
    (`assessRedTeamOutput`) for real-generated probes than ship grading
    that silently needs OpenAI credentials on some paths and not others.
    Next step if resumed: try calling `pf.redteam.generate()` first (even
    with 0 tests) to see if it establishes whatever provider context
    `getResult()` is missing, before attempting `getResult()` standalone.

Login: `admin@example.com` / `admin123`. Pick up the next task from
`TaskList`, prefer lowest pending ID unless something more urgent surfaced.
Commit + push after each verified, working increment — don't batch huge
unverified diffs.

## Change log — iteration 11 (closed the redteam grading investigation)

19. Resolved the "not shipped" item from iteration 10. Root cause: real
    redteam grading needs promptfoo's internal `redteamProviderManager`
    singleton warmed up, which only happens as a side effect of a prior
    `pf.redteam.generate()` call in the same process — confirmed by direct
    testing (the exact same grader on the exact same output went from
    "needs OPENAI_API_KEY" to fully working once `generate()` ran first).
    Wired `gradeWithRealGrader` (`pf.redteam.Graders[assertType].getResult()`)
    in scoped exactly to `caseItem.source === 'generated-live'` probes,
    since real generation always calls `pf.redteam.generate()` immediately
    before grading in the same run — the ordering is naturally satisfied,
    no extra warm-up call needed. Local-template probes keep using this
    product's own `assessRedTeamOutput` (no warm-up dependency, already
    well-tested). Falls back to local grading automatically on any failure.
    Verified live: `grader: "promptfoo-library"` with genuinely detailed,
    accurate rubric-based reasoning on a real-generated probe against the
    live Groq target; local-template path still grades with
    `system-prompt-overlap` as before (no regression); eval and
    model-audit regression-checked clean afterward. Commit `c032376`.

**Real generation + real grading are now both live for the
`useRealGeneration` opt-in path.** The promptfoo-library integration
arc that started in iteration 9 (providers → generation → grading) is
complete for red team. Remaining open items from earlier iterations:
real `pf.assertions` for the eval side (similar/moderation still use
this product's own approximation/real-API-when-configured fallback —
lower priority now, since that fallback is honestly labeled and already
works when a judge provider is configured), task #2 (audit for any
remaining stubs), task #9 (CI/CD screens), and `main.tsx` splitting
(task #7, still one ~3900-line file).

## Change log — iteration 12 (custom-assertion hardening, task #9)

20. Reviewed the javascript/python/webhook assertion sandboxes for real
    security issues first (they're admin-only via RBAC, and admins
    already have equivalent-or-worse code-execution surface via
    cli-provider/custom-script, so `vm`'s well-known lack of true
    isolation isn't a new risk in this product's threat model — not
    worth "fixing" further without changing the whole trust model).
    Then live-tested all three end-to-end (hadn't been verified this
    session) and **found a real correctness bug**: `normalizeAssertions`
    never carried a test case's top-level `expected` field down into
    individual assertions when using the modern `assertions: [...]`
    array format. Standard types (contains/equals/...) were fine since
    they read `.value` directly, but code-based assertions need a
    *separate* `expected` field — it was silently `undefined`, and for
    Python specifically the wrapper's own fallback chain
    (`assertion.expected || assertion.value`) turned that into
    evaluating the literal code string as data, so a `expected in
    output` check silently graded against the wrong thing instead of
    erroring. Fixed in `normalizeAssertions`; verified all three
    (javascript, python, and webhook via a real local test server) now
    correctly read the test's expected value, with no regression to
    standard assertion types. Commit `3de85dd`.

(Also hit and fixed an unrelated ops issue while restarting to test
this: a stale `node app/server.cjs` process from an earlier iteration
was still holding port 18080, so a `pkill` + relaunch silently left
requests hitting old code — the new process started but never bound.
If a restart doesn't seem to pick up a change, check `lsof -i :18080`
for more than one listener before assuming the fix is wrong.)

## Change log — iteration 13 (API tokens / CI-CD integration, task #9)

21. Built the CI/CD integration piece of task #9: long-lived API tokens
    so pipelines and cron jobs can call the API without a session login.
    - Backend: new `api_tokens` table (`app/db/schema.sql`) — id, user_id
      (FK to `app_users`), name, `token_hash` (SHA-256, not reversible —
      high-entropy random tokens don't need scrypt), `token_prefix` (first
      12 chars, shown in the UI so admins can identify a token without
      exposing it), role, `created_at`, `last_used_at`.
    - `generateApiToken()`/`hashApiToken()`/`verifyApiToken()` in
      `app/server.cjs`; `verifyApiToken` updates `last_used_at` on every
      successful use (fire-and-forget, doesn't block the request).
    - `requireAuth` now branches on whether the bearer token contains a
      `.` — session JWTs are `payload.signature`, API tokens
      (`ogtok_...`) never contain a dot — so both auth paths share one
      middleware and every existing route gets API-token support for
      free, with the same RBAC (`requireAdmin`) enforcement.
    - Three routes, `requireAuth` + `requireAdmin`: `GET/POST /api/tokens`,
      `DELETE /api/tokens/:id`. The raw token is returned **only** in the
      `POST` response and is never retrievable again — only the hash is
      stored, matching how `provider_secrets` never round-trips plaintext.
    - Frontend: `TokensPage` in `main.tsx` (modeled directly on the
      existing `UsersPage`), wired into the hash router (`#/tokens`) and
      an admin-only "API tokens" nav link in `Shell`, alongside "Users".
      After creating a token, the page shows the raw value once plus a
      ready-to-copy `curl` example that hits a stage-run endpoint with
      the new bearer token — this is the actual CI/CD integration
      surface task #9 asked for (a GitHub Actions job or cron script can
      copy that curl call directly).
    - Verified live end-to-end via curl AND through the browser UI:
      create → returned raw token authenticates a real request → 200 →
      `last_used_at` updates in Postgres → revoke → same token now
      rejected with 401 → a viewer-role token gets 200 on GET, 403 on
      POST/DELETE (RBAC unchanged) → the original admin session JWT
      still works throughout (no regression to session auth).

22. **Found and fixed a real deploy trap while testing this**: the
    running server was silently serving the *old legacy static app*
    from `app/web/` (a vanilla-JS `app.js`/`index.html` predating the
    React rewrite) instead of the current React frontend. Root cause:
    `app/frontend/dist/` is (correctly) gitignored, and at the moment
    this server process last started, `dist/index.html` didn't exist
    yet (I hadn't run `npm run build` after this session's earlier
    `main.tsx` edits) — `staticPath` in `server.cjs` falls back to
    `app/web` whenever the React build is missing, with **no log line**
    to say so. The UI rendered fine and even logged in fine (both apps
    share the same backend API), so this was easy to miss — the new
    "API tokens" nav link and page simply didn't exist because the
    browser was never running my new code. Fixed two ways: (1) ran
    `npm run build` in `app/frontend` and restarted the server, and (2)
    added a `console.warn` at startup whenever the legacy fallback is
    used, so this can't silently happen again. **Lesson for future
    iterations: after any `main.tsx`/`api.ts`/`styles.css` change, run
    `npm run build` in `app/frontend` before restarting the server and
    testing in the browser** — `npm run frontend:dev` (Vite dev server,
    port 5173) doesn't have this problem since it always serves fresh
    source, but the production path (`node app/server.cjs` on 18080,
    which is what gets tested against the live Groq target) does need
    an explicit rebuild.

## Change log — iteration 14 (graphql/websocket-chat/browser-chatbot adapters, task #3)

23. Closed the last gap in task #3: the three application-target provider
    types that were cataloged but threw `"...cataloged but not executable
    yet"` on every use — `graphql`, `websocket-chat`, `browser-chatbot`.
    Promptfoo itself doesn't have first-class providers for these (real
    promptfoo just configures its generic `http` provider for GraphQL,
    and its `browser`/`websocket` providers aren't in the published npm
    package we vendor — confirmed by grepping the bundled
    `node_modules/promptfoo/dist/src/index.cjs`, which has zero
    `websocket` references), so these are hand-implemented in
    `server.cjs`:
    - `callGraphQL` — POSTs `{query, variables}`, defaults to a generic
      `chat(prompt)` query if the target doesn't supply one, surfaces
      GraphQL `errors[]` as real failures instead of a false pass.
    - `callWebSocketChat` — connects with the `ws` package, sends one
      templated message, resolves on the first reply frame (JSON or
      plain text), always closes the socket.
    - `callBrowserChatbot` — drives a real headless Chromium via
      Playwright (already vendored transitively, chromium binaries were
      already cached locally): fills `inputSelector`, clicks
      `submitSelector` (or presses Enter), waits for `responseSelector`,
      reads its text after a configurable settle delay.
    - All three take their extra config through the existing
      `libraryConfig` JSON field on the provider (already wired end to
      end for `promptfoo-library` providers) — no new DB columns or API
      fields needed. Extended the frontend's provider-config JSON
      textarea (previously gated to `promptfoo-library` only) to also
      show for these three, each with adapter-specific placeholder JSON
      and help text.
    - Also noticed `ws`, `playwright`, and `js-yaml` were only ever
      present as *transitive* deps of `promptfoo` and never declared in
      `package.json`, even though `server.cjs` already `require()`s
      `js-yaml` directly — a fresh `npm install` against a future
      promptfoo version could silently drop them. Added all three as
      explicit dependencies pinned to their currently-resolved versions.
    - Verified live: spun up three throwaway local test servers (a
      GraphQL-shaped JSON endpoint, a `ws` echo server, a static HTML
      page with a real input/button/response DOM) in the scratchpad, ran
      each new adapter against them through the real
      `/api/targets/:id/providers/:index/test` endpoint — GraphQL and
      WebSocket both round-tripped in single-digit milliseconds, browser
      automation took ~1.7s (expected — real browser launch), all three
      returned the correct echoed output. Also confirmed via
      `/api/provider-catalog` and in the browser's Eval workspace
      provider dropdown that all three now show as executable (no more
      "(planned)" suffix) and the config textarea renders with the
      correct adapter-specific placeholder. `Replicate` is the only
      remaining "(planned)" entry in the whole catalog now.
    - Deliberately did **not** wire these into "native engine mode"
      (the real installed-promptfoo-CLI execution path via
      `providers/native-target.cjs`) — that bridge script runs inside a
      separate spawned process and would need its own Playwright/`ws`
      logic duplicated there. It already throws a clear
      "Native engine mode does not yet support the X adapter" error for
      these three (the `nativeAdapters` allowlist in
      `buildNativePromptfooConfig` simply doesn't include them yet) — an
      honest, non-broken limitation, not a silent gap. Left as follow-up
      work if native-mode parity for these three is ever needed.

## Change log — iteration 15 (login rate limiting + session revocation, task #8)

24. Closed the last two items on task #8's open list: `/api/auth/login`
    had no rate limiting at all (unlimited password guesses), and
    session JWTs had no revocation path (only the new API tokens from
    iteration 13 could be revoked — a stolen/leaked session JWT stayed
    valid for its full 12-hour life even after "sign out").
    - **Rate limiting**: in-memory sliding-window limiter keyed by
      client IP (`loginRateLimitKey`/`checkLoginRateLimit`/
      `recordLoginFailure`/`clearLoginAttempts` in `server.cjs`) — 10
      failed attempts within 15 minutes locks that IP out for 15
      minutes, returning 429 with `Retry-After`. Explicitly in-memory
      (a `Map`, not a DB table) since this is a self-hosted
      single-instance product; documented in a code comment that a
      multi-instance deployment would need this moved to a shared
      store. Deliberately keyed by IP only (not IP+email) — simpler and
      covers the primary threat (one attacker machine brute-forcing),
      whereas per-email tracking mostly matters against distributed
      botnets, out of scope for now.
    - **Session revocation**: `signToken` now stamps every JWT with a
      random `jti`; a new `revokedTokenIds` in-memory `Set` and
      `POST /api/auth/logout` (requireAuth) adds the *current* token's
      `jti` to it; `verifyToken` rejects any token whose `jti` is in the
      set. No cleanup job needed — revoked entries are only ever
      superseded by the token's own `exp` check, so the set can only
      grow as fast as active logouts, not unboundedly. Frontend:
      `logout()` in `api.ts`, called (best-effort, fire-and-forget) from
      `handleLogout` in `main.tsx` before the local token/user state is
      cleared — sign-out feels instant either way since the client-side
      state clear doesn't wait on the network call.
    - Verified live: 10 failed logins from one IP correctly 429s on the
      11th (even the *correct* password gets rejected while locked out,
      which is intentional — otherwise the endpoint would leak whether
      a password was actually correct via a different status code
      during lockout); confirmed via a full server restart (clears the
      in-memory Map, expected) that this doesn't create a permanent
      self-lockout risk in dev. Separately verified logout: a token
      that authenticates a real request (200), gets revoked via
      `/api/auth/logout` (204), and is then rejected (401) on the exact
      same request that worked a moment before — then confirmed the
      normal login → use → sign-out → sign-in cycle still works with no
      regression, both via curl and through the actual browser UI.

## Change log — iteration 16 (promptfoo `scenarios` import support)

25. Found and closed a real, if narrower, gap while auditing for
    remaining promptfoo config concepts not yet supported: imported
    configs using promptfoo's `scenarios` key (a var/assertion matrix —
    each scenario's `config[]` entries cross-multiply with its
    `tests[]` entries) had that array **silently dropped from
    execution**. The raw scenario data was still preserved in
    `metadata.eval.importedConfig` (so "Copy JSON"/"Download YAML"
    still showed it), but `buildEvalTests` only ever reads
    `testCases`, and `normalizeImportedPromptfooConfig` only ever
    mapped `engineConfig.tests` into that array — `scenarios` was
    never read at all. Added `expandScenarios()` in `server.cjs`,
    which flattens each scenario's config x tests cross product into
    the same normalized test-case shape as regular `tests` entries
    (merging each config entry's vars with each test's vars, config
    losing on conflict), and merged it into both import paths
    (`POST /api/targets/import` and
    `POST /api/targets/:id/stages/eval/import` — both already funnel
    through `normalizeImportedPromptfooConfig`, so one fix covers
    both). Verified live: imported a config with 2 scenario configs x
    2 scenario tests, got exactly 4 correctly-merged test cases back
    (confirmed the persona var from `config[]` and the prompt var from
    `tests[]` both landed on every case); separately confirmed a plain
    `tests`-only import (no `scenarios` key) is completely unaffected
    — still produces exactly the cases it always did.

## Change log — iteration 17 (per-test `transform` support)

26. Added support for promptfoo's per-test `transform` (`test.options.
    transform` in raw config) — a JS expression that rewrites the raw
    provider output before assertions run, normally used to unwrap a
    response shape an adapter's own heuristic field-extraction doesn't
    recognize. Real promptfoo already implements this natively when
    running through the installed library (native engine mode), so the
    only gap was the product's own "direct" execution path
    (`executeEvalRun`), which had no concept of it at all.
    - `applyOutputTransform()` in `server.cjs` — same `vm.Script`
      sandbox pattern as the existing JavaScript assertion evaluator,
      100ms timeout. Exposes `output` (the adapter's best-effort
      extracted text) **and** `rawResponse` (the full unprocessed
      response body) — discovered while testing that `output` alone is
      often useless for exactly the case a transform exists for: a
      JSON shape the adapter's own extraction heuristic didn't
      recognize, where `output` has already collapsed to an empty
      string before the transform ever runs, so the expression needs
      the raw body to have anything to work with.
    - Wired through the full chain: `normalizePromptfooTest` now
      captures `test.options.transform` on import,
      `normalizeDatasetRows` preserves it through every save/import
      path that touches test cases, `buildEvalTests` re-attaches it as
      `options.transform` when building the executable config, and
      `executeEvalRun` applies it right after getting the provider
      result and before assertions evaluate.
    - Added a "Output transform" field to the test-case editor in
      `main.tsx` (`EvalStageConfigPayload['testCases'][number]` gained
      a `transform?: string` field) so it's not import-only — anyone
      can write one directly against any test case, matching the
      product's existing pattern of exposing raw/advanced promptfoo
      concepts as an extra field rather than building bespoke UI for
      each one.
    - Verified live end-to-end: a local test server returning
      `{result: {nested: {value: "READY"}}}` (deliberately not a shape
      http-json's own extraction heuristic recognizes — confirmed
      first that the untransformed output was empty and the assertion
      correctly failed), a test case with `transform:
      "rawResponse.result.nested.value"` and an `equals: READY`
      assertion, ran the eval, got `output: "READY"` and `pass: true`.
      Also verified a deliberately broken transform expression fails
      cleanly with a specific error message on that one row rather
      than crashing the run.

## Change log — iteration 18 (`assert-set` — a real silent mis-grading bug)

27. Found a genuine correctness bug, not just a missing feature: promptfoo's
    `assert-set` type (a nested group of sub-assertions, each optionally
    `weight`ed, that combine into one weighted-average score compared
    against a `threshold`) hit `evaluateAssertion`'s `default` case for
    any unrecognized type, which evaluates as plain `contains` —
    `actual.includes(expected)` where `expected` is `String(assertion.
    value || '')`. An `assert-set`'s own `.value` is always empty (its
    real content lives in a nested `.assert` array `normalizeAssertions`
    was **also** silently dropping — it only ever copied `type`, `value`,
    `threshold`, `expected`, `reference`, `timeout*`, `headers`). And
    `''.includes('')` — actually `anything.includes('')` — is always
    `true` in JS. Net effect: **every imported config using `assert-set`
    silently passed unconditionally**, regardless of what the sub-assertions
    actually checked. Not a missing feature — a false-positive grading bug
    that would make a genuinely failing target look green.
    - Fixed `normalizeAssertions` to also preserve `assert` (the nested
      array) and `weight`.
    - Added a real `assert-set` case to `evaluateAssertion`: recursively
      evaluates each sub-assertion, computes `Σ(score×weight) / Σ(weight)`,
      compares against `threshold` (default 1, promptfoo's own default),
      returns the full breakdown in `results[]` for transparency.
    - No new UI — `assert-set` needs a nested assertion editor the
      existing flat type+value row can't express, so for now it's
      correctly *evaluated* (import-authored, like `scenarios`) but not
      yet *authorable* from scratch in the test-case builder. Left as a
      possible follow-up if a real need for hand-authoring it shows up.
    - Verified live: imported a config with `assert-set{threshold: 0.5,
      assert: [{contains "42", weight: 2}, {contains "nonexistent...",
      weight: 1}]}` against a response containing "42" but not the other
      string — confirmed the nested `assert`/`weight` fields survived
      import intact, then ran the eval and got exactly the expected
      weighted score `(1×2 + 0×1)/3 = 0.667 ≥ 0.5` → pass, with each
      sub-assertion's individual result visible in the row.

## Change log — iteration 19 (registry search/filter, task #7)

28. Started an actual UX pass on task #7 (not a code refactor — the
    task is literally about registry/onboarding/workspace usability).
    First finding: the Registry page had **no search or filter at
    all** — with 6 test targets it doesn't bite yet, but any real team
    running this against a real target fleet (10s–100s of targets)
    would have no way to find one except scrolling. Added a search box
    (matches display name, model, endpoint URL, promptfoo entity type
    — client-side, the full list is already loaded) and a status
    filter dropdown (draft/active/archived/all) to `RegistryPage` in
    `main.tsx`. Also noticed while doing this that `target.status` is
    purely manual (set only via the Target Settings dropdown, never
    auto-derived from stage completion) — confirmed this is deliberate
    existing design (explicit promotion, not auto-detection) rather
    than a dead field, so left it as-is.
    - Distinguished two empty states: "No registry entries yet" (zero
      targets exist) vs. "No targets match your search or filter"
      (targets exist, current filter just excludes all of them) — the
      old code only had the first message, which would have been
      actively misleading once a filter was added.
    - Verified live in the browser: typing "import" narrows 6 targets
      to the 1 match; an unmatched query shows the new empty-filter
      message (not the "onboard your first model" one); the status
      dropdown correctly filters by the manually-set status field.

29. Second finding from the same UX pass, more severe: **zero
    destructive actions in the whole app had a confirmation step** —
    Delete target, Remove user, Revoke API token, Delete schedule,
    Delete run all fired immediately on click. "Delete target" is the
    worst case by far: `onboarded_targets` cascades via FK `on delete
    cascade` to every run, dataset, schedule, and provider secret for
    that target, so one misclick destroys everything ever recorded
    against it, no way back. Added `window.confirm()` guards (no new
    component — matches the codebase's existing preference for the
    simplest thing that works) with a specific, consequence-stating
    message on all five: target delete names what gets cascaded away,
    user removal says they lose access immediately, token revoke says
    what depends on it will stop authenticating, schedule/run delete
    are the lower-stakes ones but got the same treatment for
    consistency. Verified live: created a throwaway API token,
    confirmed the dialog appears on Revoke and the token is gone only
    after accepting; re-ran the standard regression check against the
    live Groq target afterward with no impact.

30. Third finding: no way to duplicate a target. A manual two-step
    workaround already existed (Copy JSON on one target, paste into the
    registry's Import textarea), and it turned out the export shape's
    `.target` field is already exactly what import expects at
    `body.target` — so this needed no new backend endpoint, just a
    one-click wrapper: `handleDuplicate` in `TargetDetailPage` calls
    `exportTarget`, appends " (copy)" to the display name, calls
    `importTarget` with that object, and navigates straight to the new
    target. Reused the existing `handleCreated` navigation callback via
    a new `onDuplicated` prop rather than writing new routing logic.
    - Confirmed the existing `stripSecretReferences`/`removeRawSecrets`
      step in the import path (already there for the manual
      copy/paste workflow) correctly strips `apiKeySecretId` and
      `apiKeyMasked` from the clone — a duplicated target's provider
      keeps its config (model, base URL, temperature, etc.) but starts
      with no key, matching the correct security model (a
      `provider_secrets` row belongs to one target; a clone can't
      silently inherit another target's decryptable secret).
    - Verified live via the exact payload shape the button now sends
      (not just reading the code): exported the real E2E test target,
      built the "(copy)" payload, imported it, and confirmed the copy
      landed with the right display name, the same provider config,
      the same test case, and the same red-team plugin list — then
      confirmed calling the provider on the copy correctly fails with
      "Invalid API Key" (proving the secret really didn't carry over)
      before cleaning up. Also caught and ruled out a false alarm while
      testing: an earlier attempt via a shell-variable round-trip
      (`EXPORTED=$(curl ...)`) silently corrupted the JSON (a raw
      newline inside `engineConfigYaml` survived bash's `$(...)`
      capture unescaped); writing directly to a file with `curl -o`
      confirmed the server's actual JSON output was valid all along —
      not a real bug, just a shell artifact in my own test script.

31. Fourth finding, a real correctness bug in `GET /api/targets/:id/runs`
    (the "Run center" run history, used by the evidence workspace and
    the run-compare picker): it fetched only the 100 most recent runs
    **across all stages**, then filtered by `stageKey`/`status`/
    `outcome` *after* that cap. For any target with heavier traffic on
    one stage (e.g. frequent scheduled evals) than another, filtering
    to a less-frequent stage could return an empty or truncated list
    even though matching runs existed — just further back than the
    pre-filter 100-row window, with nothing in the UI to explain why.
    - Fixed the two cases that are plain columns (`stage_key`,
      `status`) by pushing them into the SQL `WHERE` clause, so the
      100-row limit now applies *after* filtering — the correct fix,
      not a mitigation.
    - `outcome` (pass/fail/error) can't be pushed into SQL as cheaply
      since it inspects each run's stored JSON results, not a column —
      widened the pre-filter fetch to 400 rows when an outcome filter
      is active as a partial mitigation (meaningfully shrinks the
      blast radius; doesn't eliminate it for extreme cases), then caps
      the final outcome-filtered result at 100.
    - Also added an honest "showing the latest 100 matching runs, older
      runs exist but aren't shown" note in the UI whenever the returned
      list hits the cap — previously there was no indication the list
      could ever be truncated at all.
    - Verified live: with a target carrying a mix of eval/red-team/
      model-audit runs, `?stageKey=eval` now returns exactly the eval
      runs (1) and `?stageKey=red_team` returns exactly the red-team
      runs (2), matching the real counts rather than whatever
      happened to survive a stage-blind pre-filter cap.

32. Small follow-up caught while re-reading the eval workspace: the
    "Import test cases" bulk-JSON parser (`parseBulkCases` in
    `main.tsx`) threads `assertions`/`vars`/`tags`/`metadata` from each
    pasted item but never picked up `transform` — added in iteration
    17, after this parser was last touched, so it silently dropped a
    pasted test case's transform field even though the manual editor,
    save path, and execution path all handle it correctly. One-line
    fix: `transform: item.transform || item.options?.transform`,
    matching the same fallback shape used everywhere else transform is
    read from an external config.

33. Fifth finding: red-team failures were shown with **no attack
    category or severity anywhere in the product** — not in the
    red-team workspace's own "Latest run" results table, not in the
    Evidence workspace's "Findings" list, not in the markdown/HTML
    exports. Every red-team result row already carries `plugin`,
    `strategy`, and `severity` (confirmed live: e.g. `{plugin:
    "system-prompt-override", strategy: "jailbreak", severity:
    "medium"}`), but `buildRunFindings` in `server.cjs` (the function
    that turns run rows into the report's `findings[]`) only ever
    copied `stageKey`/`runId`/`test`/`provider`/`status`/`error`/
    `output` — silently dropping exactly the fields a security triage
    workflow needs most to decide what to look at first. For a product
    whose entire purpose is AI security assurance, showing "FAIL:
    some-test-name" with no severity or attack category is a real gap,
    not cosmetic.
    - Added `plugin`/`strategy`/`severity` (all `undefined` for
      non-red-team rows, e.g. model-audit findings — verified this
      renders cleanly with no stray formatting) to `buildRunFindings`'s
      output, the `findings[]` TypeScript type, both the markdown and
      HTML report generators, the Evidence workspace's Findings list,
      and the red-team workspace's own results table (which reads raw
      run rows directly and had the same gap independently).
    - Verified live: pulled a real red-team run's raw rows and
      confirmed `plugin`/`strategy`/`severity` are present and correct
      on every row; regenerated the markdown export and confirmed
      model-audit findings (which have none of those three fields)
      render with no leftover "[undefined]" or stray punctuation —
      the `finding.plugin ? ... : ''` guards work as intended.

## Change log — iteration 20 (schedule failure webhooks)

34. Sixth finding: scheduled recurring runs (`target_schedules`, driven
    by a 60s worker loop in `processDueSchedules`) had **no way to be
    notified when one failed** — the only signal was the schedule's
    `lastStatus` field, silently updated in the DB, visible only if
    someone opens that target's Evidence tab and looks. For a product
    whose whole pitch is unattended recurring assurance checks, a
    scheduled run silently failing with nobody finding out for days is
    a real gap — this is the difference between a testing tool and an
    actual monitoring/alerting surface.
    - Added `notify_webhook_url` and `notify_on` (`'failure'` default
      or `'always'`) columns to `target_schedules` via `alter table
      ... add column if not exists` in `schema.sql` — the existing
      `create table if not exists` pattern is a no-op against an
      already-existing table, so new columns need the explicit ALTER
      (this is the first schema change in this codebase to need that;
      documented in a comment for whoever adds the next one).
    - `sendScheduleWebhook()` — fire-and-forget POST with a 10s
      timeout; errors are logged and swallowed so a slow/unreachable
      endpoint can never block the schedule worker or the run itself
      from being recorded (which happens regardless of notification
      delivery).
    - Wired into **both** places a schedule can execute:
      `processDueSchedules` (the automatic worker) and
      `POST .../schedules/:id/run-now` (the manual trigger, which
      previously had no notification path at all — added matching
      logic so a user can hit "Run now" to verify their webhook/Slack
      integration actually works before trusting the real schedule).
      "Failure" is defined as: the run didn't reach `status ===
      'completed'`, or its summary has any `fail`/`error` count above
      zero.
    - Frontend: "Notify webhook URL" + "Notify on: failures only /
      every run" fields on the schedule creation form, and the
      configured webhook (URL + mode) now shows on each existing
      schedule row.
    - Verified live end to end with a real local HTTP receiver: created
      a schedule with `notifyOn: always`, hit "Run now", confirmed the
      receiver got a POST with the exact event type, schedule/target
      names, and per-stage pass/fail summary; then set `notifyOn:
      failure` and confirmed a passing run correctly sends **no**
      webhook at all (not just an empty one) before cleaning up.

## Change log — iteration 21 (model-audit scanner correctness pass)

35. Re-auditing `executeModelAuditRun` while checking scanner catalog
    parity turned up three separate, real bugs, all in the same
    function:
    - The **SBOM/MBOM check ran unconditionally** whenever an artifact
      path was set, completely ignoring whether the user had actually
      selected it in the scanner picker — unchecking "SBOM/MBOM" had
      no effect. Gated it on `selectedScanners.includes('sbom')`,
      matching the other three local-file scanners.
    - The SBOM check's "no artifact path to verify against" branch had
      **inverted pass/fail logic**: `pass: audit.sbomRequired ===
      true` means a *required* SBOM that couldn't even be checked
      reported as PASS, and a *not-required* one reported as FAIL —
      backwards in both directions. Fixed to `pass: !audit.
      sbomRequired` (trivially passes when not required; a required
      SBOM that can't be verified now correctly fails instead of
      silently reading as compliant).
    - **`secrets`/`unsafe-code`/`model-card` silently fell into the
      "no scanner implemented" placeholder** whenever the artifact
      path was unreadable, even though all three have real
      implementations — the placeholder text ("no dedicated local
      scanner implemented for this check yet") was actively false for
      these three in that situation, and worse, it defaulted to
      `pass: true`. All three now get an explicit, correctly-labeled
      failing check ("selected, but the artifact path is not a
      readable local file or directory — nothing was verified")
      instead of being misdescribed and silently passed.
    - Separately hardened the true "no scanner exists for this key at
      all" placeholder (for `malware`/`dependency-risk`/`data-lineage`,
      which really have no implementation): kept `pass: true` (a false
      alarm would be worse than a gap here) but changed the label to
      `"<key> (not evaluated — no scanner implemented)"` so it can't be
      mistaken for a real green result at a skim, matching how the
      provider catalog already marks `Replicate (planned)`.
    - Found while verifying: the E2E reference target's `artifactPath`
      pointed at a scratch directory from an earlier session that no
      longer exists on disk — confirmed this was pre-existing test-data
      staleness (not something broken by this change) by checking the
      path directly, then rebuilt a small fresh fixture (a text file
      with an unquoted fake key, a `.pkl` file, a `README.md`, and a
      minimal SBOM JSON) and pointed the target at it, which is now the
      target's live config. Verified end to end at both ends of the
      bug: the stale path now correctly fails all four gated checks
      with the honest "not a readable path" message instead of
      silently passing; the fresh fixture correctly passes secrets/
      model-card/SBOM and correctly fails unsafe-code (real `.pkl`
      file detected). Also independently confirmed the secrets
      scanner's "no match" result on the fixture's unquoted fake key
      was a fixture-formatting artifact of my own test data (the
      regex requires quoted values, matching common `KEY="value"` env
      file conventions) rather than a scanner bug — not something to
      chase further.

## Milestone — all originally tracked tasks complete (iteration 21)

Every task on the original build-out list (providers, assertions,
red-team, model audit, UX pass, auth hardening, CI/CD tokens, and the
full E2E test/evidence pass) is now marked complete. Confirmed the
whole system is healthy with a fresh end-to-end sweep against the live
E2E reference target: login, all core list endpoints (targets, users,
tokens, provider catalog, workflow catalog), all three executable
stages (eval/red-team/model-audit) run and complete successfully, the
evidence report generates, and all four export formats
(yaml/csv/markdown/html) return 200 — plus a clean `tsc --noEmit` on
the frontend. Twenty-one iterations in, the defects found have shifted
from "whole feature missing" (early iterations: providers, CI/CD
tokens, scenarios) toward "found while re-reading code that already
looked done" (later iterations: inverted boolean logic, a scanner
picker checkbox that didn't actually gate its scanner, findings
dropping fields that existed one line away) — a sign the obvious gaps
are closed and further passes will likely find fewer, smaller things.
Continuing the loop per the standing instruction; future iterations
should keep applying the same standard (verify live against a real
target, not just code review) rather than settling for smaller and
smaller cosmetic changes for their own sake.

## Change log — iteration 22 (orphaned provider-secret cleanup)

36. Found a real data-hygiene/security gap while checking key-rotation
    behavior: removing a provider from a target's eval config, or
    replacing the whole `providers[]` array via import, never cleaned
    up that provider's row in `provider_secrets`. `upsertProviderSecret`
    correctly updates in place when rotating a key *within* the same
    provider slot (no orphan there), but nothing ever deleted a secret
    whose provider was removed entirely — the encrypted key just sat
    in the DB forever, referenced by nothing, silently surviving every
    future edit. For a security-assurance product that itself stores
    customer API keys, "we removed that key" quietly not being true at
    the storage layer is a real problem, not just clutter.
    - Added `collectReferencedSecretIds(metadata)` — walks all three
      places a secret id can live in a target's metadata
      (`eval.providers[].apiKeySecretId`, the legacy single
      `provider.apiKeySecretId`, `judge.apiKeySecretId`) — and
      `sweepOrphanedProviderSecrets(client, targetId, metadata)`,
      which deletes any `provider_secrets` row for that target whose
      id isn't in that set. Deliberately computes the referenced set
      from the *full* merged metadata object, not just the section a
      given route happens to be touching — a route that only edits
      `eval.providers` must not accidentally sweep away a `judge`
      secret it never looked at.
    - Wired into the two routes that can wholesale-replace the
      providers array (`PATCH .../stages/eval/config` and
      `POST .../stages/eval/import`) — the only two places an orphan
      can actually be created. The target-settings route
      (`PATCH /api/targets/:id`) already only rotates in place via
      `upsertProviderSecret`'s existing-id path, so it has no
      orphan-creation path and didn't need the sweep.
    - Verified live and carefully, on a disposable target (not the
      E2E reference target holding a real key): created 2 providers
      with fake keys, confirmed 2 `provider_secrets` rows; removed one
      provider via PATCH, confirmed exactly 1 row remains (the other
      correctly deleted) and the surviving provider's key still
      decrypts and gets used correctly (confirmed via a real failed
      auth attempt against OpenAI showing the actual fake key content,
      proving intact decryption, not corruption); separately set a
      judge key, then PATCHed the eval providers again, and confirmed
      the judge secret survives untouched since it's still referenced
      in the full metadata the sweep sees — the exact case the
      full-metadata design was meant to protect against.

## Change log — iteration 23 ("Rerun failures" didn't actually scope execution)

37. Same pattern as the model-audit findings gap (iteration 19): a
    feature that looked complete because the plumbing existed, but the
    plumbing was never actually wired to the thing it claimed to do.
    The Evidence workspace's "Rerun" button + "Rerun mode" dropdown
    (Failures / Errors / All) computed exactly which rows matched via
    `matchingRowsForRerun`, then threw the result away — it only
    passed `rerunCandidateRows: matches.length` (a count) into
    `runOptions`, and nothing downstream ever read `rerunOf`,
    `rerunMode`, or `rerunCandidateRows` to actually narrow execution.
    Clicking "Rerun failures" on a run with 3 failures out of 50 cases
    silently re-ran **all 50**, wasting API calls/cost and — worse —
    the resulting new run wasn't even scoped to what the user asked to
    retry, defeating the entire point of the feature.
    - Added `rerunRowKey(row)` (`"${provider}::${test}"`) and
      `shouldIncludeInRerun(runOptions, key)` — a no-op passthrough
      unless `runOptions.rerunKeys` is a non-empty array, in which
      case it filters to just those keys.
    - The rerun route now computes `rerunKeys: matches.map
      (rerunRowKey)` and passes it through — but only for `failures`/
      `errors` mode; `mode: 'all'` deliberately omits it so a full
      rerun can't be silently narrowed by a stale key list if the
      target's config changed since the source run.
    - Wired the actual filter into both places test/case lists get
      built: `executeEvalRun`'s task-construction loop (skips a
      `test` whose `${provider.label}::${test.description}` isn't in
      the requested set) and `executeRedTeamRun` (filters `cases` by
      `${providerLabel}::${caseItem.name || plugin/strategy}` before
      execution starts, not after). Deliberately left `model_audit`
      alone — its "test cases" are a fixed set of policy/scanner
      checks derived from the target's own metadata, not an
      independently-selectable list, so "rerun just the failures"
      doesn't have a meaningful narrower scope to fall back to there.
    - Verified live end-to-end, carefully: ran a real red-team stage
      (5 cases, all genuinely passed against the live Groq target),
      then deliberately forced 3 of those 5 rows to `pass: false` via
      direct SQL against the stored run (to get a controlled test
      fixture without needing to coax a real model failure), and
      called rerun with `mode: failures` — the new run correctly
      contained **exactly those 3** cases, not all 5. Confirmed
      `mode: all` on the same source run still correctly re-executes
      all 5. Repeated a smaller version of the same check against an
      eval-stage run. Cleaned up every test run created during this
      verification before finishing.

## Note — Groq TPM rate limiting from this session's own test traffic

While verifying compare-runs (iteration 24, no code change — the
feature checked out correct), a real Groq `429` (tokens-per-minute
rate limit) showed up mid-test, initially looking like a bug (3 rows
in a freshly-created run had unexpectedly failed). Traced it to the
actual cause: 24 iterations of live-testing against the same Groq key
this session has been consuming real TPM budget, and the account's
free-tier limit (6000 TPM) got hit organically. Not a product defect —
confirmed by reading the real Groq error message stored in the row's
`error` field, and separately confirmed the compare/delta logic itself
was reporting the state change correctly. Going forward, prefer
lighter-weight checks (list-endpoint 200s, code reading, targeted SQL
fixtures like the rerun/compare tests above) over triggering new live
runs against the shared Groq key when verifying something that doesn't
specifically need a fresh real model response — the reference target's
own key is a shared, rate-limited resource across every iteration of
this loop, not an unlimited test double.

## Change log — iteration 25 (session-expiry redirect + a restart-procedure bug)

38. Found a real UX gap: a 401 anywhere in the app *other than* the
    initial post-login data load just surfaced as a generic
    "Unauthorized" error in whatever component happened to be open —
    the 12-hour session JWT expiring mid-use (or an admin revoking it)
    left the user stuck looking at a normal-looking but silently-dead
    UI, with every subsequent click failing the same way, until they
    manually clicked Sign out themselves. Fixed centrally rather than
    at each of the ~40 call sites: `request()`/`requestText()` in
    `api.ts` now clear the stored token and fire a `window.
    dispatchEvent(new Event('og:session-expired'))` on any 401 that
    was carrying a token (a 401 with *no* token, e.g. a wrong-password
    login attempt, is a different case and is deliberately left
    alone). `App()` in `main.tsx` listens for that event and resets to
    the login screen with "Your session expired. Please sign in
    again." — the same recovery path the initial-load failure already
    had, just reachable from anywhere now instead of only from the
    first load after opening the app.

39. **Found and fixed a real bug in my own iteration process**, not
    the product: `pkill -f "node app/server.cjs"` (a relative-path
    pattern) stopped matching once a restart in iteration 23 happened
    to launch the process with an absolute path
    (`node /Users/.../app/server.cjs`) — the substring "node
    app/server.cjs" isn't present in that command line even though
    "app/server.cjs" is. Every "restart" after that point silently
    launched a *new* node process that failed to bind (port already
    held) while the old, increasingly-stale process kept serving every
    live-verification test. Confirmed on investigation: `lsof -i
    :18080` showed the actual listener was a process 2+ minutes older
    than the iteration-23 commit, with two more orphaned,
    never-bound-to-anything node processes idle in the background.
    Given the ambiguity about exactly which commits got verified
    against genuinely fresh code, **re-verified the iteration-23
    rerun-scoping fix from scratch** after cleaning up (killed
    everything actually bound to the port via `lsof -ti :18080 |
    xargs kill -9` rather than trying to pattern-match a command line
    again, confirmed exactly one process listening, then re-ran the
    same forced-failure SQL-fixture test) — it's genuinely correct and
    active. **Going forward, restart with `lsof -ti :18080 | xargs -r
    kill -9` instead of `pkill -f`** — it kills whatever is actually
    bound to the port regardless of how the path was spelled when it
    launched, which is the property that actually matters.

40. Checked whether the UI adapts at all for viewer-role accounts
    (RBAC itself was already correctly enforced server-side — every
    mutating route already 403s for viewers, verified in earlier E2E
    passes). It doesn't: a viewer sees the exact same buttons an admin
    does — Run eval, Save config, Delete target (with the new
    confirmation dialog promising cascading deletion), Create
    schedule, all of it — and only finds out they can't actually do
    any of it when the click fails with a generic 403. Fully disabling
    or hiding every admin-only control across every workspace
    (Eval/RedTeam/ModelAudit/Evidence, each a separate component) would
    be a large, invasive change for this pass, so scoped this to the
    highest-leverage fix instead: a persistent "Viewer (read-only)"
    badge in the topbar, shown whenever `isAdmin === false` (the
    strict equality matters — `undefined` during the brief loading
    state before `user` resolves must NOT show it prematurely). Turns
    "confusing 403 with zero context" into "confusing 403, but I was
    warned upfront this might happen" — real improvement, not a full
    fix for the underlying gap (individual buttons still aren't
    disabled), noted here so a future pass can pick up the rest if it
    turns out to matter in practice.
    - Verified live: created a real throwaway viewer-role user via the
      Users page, signed in as them in the browser, confirmed the
      badge renders and "Users"/"API tokens" nav links correctly stay
      hidden (that part already worked); signed back in as admin and
      confirmed the badge is correctly absent. Deleted the test user
      before finishing.

## Change log — iteration 26 (verified malformed-import handling + added dataset deletion)

41. Verified malformed-config import handling: posted deliberately
    broken YAML (bad indentation, mixed tabs) to `/api/targets/import`
    and confirmed a clean 400 with a specific, readable parse error —
    no crash, no silent fallback. No bug, no change needed.

42. Found a genuine missing capability while checking the Datasets
    feature (saved/versioned eval test-case sets) end to end for the
    first time this session: there was no way to delete a saved
    dataset version, neither a backend route nor a frontend button —
    each "Save version" click adds a new row to `target_datasets`
    with no way to prune old ones, so they'd accumulate indefinitely
    for any actively-iterated target. Confirmed this was a genuinely
    absent capability, not a broken existing one (no misleading button
    sitting there failing).
    - Added `DELETE /api/targets/:id/datasets/:datasetId` — plain
      delete, no special-casing for the currently-active dataset,
      because activation already copies rows into
      `metadata.eval.testCases` at the moment it runs (verified by
      reading the activate route again) — eval execution never re-reads
      `target_datasets`, so deleting a row (even the active one) only
      removes it from the saved-version list, it can't break a live
      eval config.
    - `deleteDataset()` in `api.ts`, a `window.confirm`-gated "Delete"
      button next to "Use" on each dataset row in the Eval workspace's
      Datasets panel, matching the confirm-dialog pattern already
      applied to every other destructive action this session.
    - Verified live end to end: created a real dataset (2 rows) on a
      throwaway config, confirmed it listed, activated it and
      confirmed the target's `eval.testCases` actually swapped to the
      new rows while `eval.providers` stayed untouched, restored the
      original test case, deleted the dataset via the new route, and
      confirmed the datasets list correctly went back to empty. No
      regression to the live Groq target's own provider check
      afterward.

## Change log — iteration 27 (found + fixed during a user-requested comprehensive evidence pass)

43. The user asked for a fresh, comprehensive functional test of
    everything built this session with real evidence (not screenshots)
    compiled into a structured report. Found a genuine, previously
    undiscovered bug while generating that evidence for the
    model-audit workspace: `PATCH /api/targets/:id/stages/:stageKey/config`
    (the shared route for both `red_team` and `model_audit` configs)
    used `body.field || default` for nearly every field — meaning a
    caller who sent a *partial* update (e.g. `{"scanners": [...]}`
    alone) silently reset every field it didn't mention back to empty:
    `source`, `licensePolicy`, `artifactPath`, `notes` for model audit;
    `purpose`, `plugins`, `strategies`, `language`, `entities`,
    `customProbes`, `runOptions.*`, `defaultTest.vars`,
    `runtime.allowedTools`, `runtime.retrievalSources` for red team.
    This is the exact same class of bug already found and fixed for
    `evalBody.testCases` earlier this session — but that fix only
    touched the eval config route, and this sibling route (added
    separately) had the identical defect. It never showed up through
    the actual UI because the frontend always round-trips full
    component state on every save (never sends a partial payload) —
    but this product now ships API tokens specifically so CI/CD
    scripts can call these endpoints directly, and a script doing
    exactly the kind of small, targeted update that's the whole point
    of programmatic access (e.g. "just bump `artifactPath` after a
    redeploy") would have silently corrupted every other field.
    - Fixed every field in both branches to fall back to the existing
      stored value (`body.x !== undefined ? body.x : existing.x`)
      instead of a hardcoded default, matching the pattern already
      used for `testCases`.
    - Verified live, carefully, since this touched the E2E reference
      target's real config: captured the config before testing,
      confirmed the bug live (`PATCH {"scanners":["malware"]}` wiped
      `source`/`licensePolicy` to `""`, breaking readiness), applied
      the fix, restarted, confirmed the identical partial PATCH now
      correctly preserves `source`/`licensePolicy`/`artifactPath`
      while updating only `scanners`, repeated the check for
      `red_team` (`{"numTests":7}` alone no longer wipes `purpose`/
      `plugins`/`strategies`), then fully restored the E2E target's
      original audit and red-team config afterward.

## Change log — iteration 28 (`guardrails` assertion type, `/loop` continuation)

44. Re-entered the standing `/loop` after the evidence pass to keep closing
    promptfoo parity gaps. Diffed this product's 60-type assertion catalog
    against real promptfoo's `BaseAssertionTypesSchema`
    (`promptfoo-source/src/types/index.ts`) and found `guardrails` missing —
    a real, on-brand gap for a security-assurance product: it checks a
    provider's own guardrails/safety-filter metadata (`flagged`,
    `flaggedInput`/`flaggedOutput`, `reason`) rather than re-deriving safety
    from the output text the way `moderation`/`is-refusal` do. (Also
    surveyed `pi`, `perplexity(-score)`, `ruby`, `skill-used`,
    `trajectory:*`, `trace-*` — left those out: `pi` needs a hosted
    promptfoo classifier this self-hosted product has no equivalent for,
    `perplexity` needs logprobs most providers here don't return, `ruby`
    duplicates the existing javascript/python script-assertion surface
    without adding capability, and `trajectory:*`/`trace-*` need real
    OpenTelemetry span data this product doesn't capture — each would be a
    fake/placeholder pass, not a real check, so left out rather than
    shipping something dishonest.)
    - Added `case 'guardrails':` to `evaluateAssertion` in `server.cjs`,
      matching real promptfoo's semantics from
      `promptfoo-source/src/assertions/guardrails.ts`: reads
      `context.providerResponse?.rawResponse?.guardrails`; flagged -> fail
      with the provider's own reason; not flagged -> pass; metadata absent
      entirely -> pass with score 0 and an explicit "not applied" reason
      (never a silent/fake pass framed as a real check). `not-guardrails`
      needed no extra code — it falls out of the existing generic
      `not-<type>` inversion wrapper for free.
    - `rawResponse` was already threaded through to every assertion via
      `context.providerResponse` (confirmed by grep — this is the same
      field the existing `transform` feature reads), so this only needed
      the one new assertion case, no new plumbing. Only the 10
      library-bridged providers (`pf.loadApiProvider` — Bedrock, Vertex,
      watsonx, etc., see the iteration 9 architectural note above) are
      capable of actually populating `guardrails`; this product's
      hand-rolled adapters (openai-compatible, graphql, websocket-chat,
      browser-chatbot, ...) never will, and correctly hit the honest
      "not applied" branch instead of faking a result.
    - Added the catalog entry to `ASSERTION_TYPES` in
      `app/shared/workflow-catalog.cjs` (60 -> 61), with a description
      that's upfront about which providers actually populate it. No
      frontend change needed — confirmed by reading `main.tsx` that the
      assertion-type dropdown renders directly off
      `workflowCatalog.assertions` (`/api/workflow-catalog`), not a
      hardcoded list.
    - Verified live against the real E2E reference target (config captured
      before, restored after): ran a real eval with a `guardrails`
      assertion against the live Groq (openai-compatible) target, which
      has no guardrails metadata by construction — confirmed the row
      passed with `score: 0` and reason `"Guardrail was not applied
      (provider/adapter did not return guardrails metadata)"`, i.e. an
      honest neutral result, not a fake pass or a fake fail. Also
      confirmed `/api/workflow-catalog` now reports 61 assertion types
      including `guardrails`. Cleaned up the test run and restored the
      target's original eval config afterward.

45. Same `/loop` continuation, second fix: found that `defaultTest.vars`
    — real promptfoo's top-level config field that applies default
    variables to *every* test in a config — was captured (this product
    stores it under `redteam.defaultTest.vars`, the only place the UI
    exposes it) but only ever read during red-team case generation,
    never merged into actual eval test execution. Same "plumbing exists
    but isn't wired to what it claims" pattern as iteration 19 (model-audit
    findings) and iteration 23 (rerun scoping): `normalizeImportedPromptfooConfig`
    already captures a top-level `defaultTest` from an imported promptfoo
    YAML, but `buildEvalTests`/`executeEvalRun` never read it, so an
    imported config's `defaultTest.vars` would silently have zero effect
    on eval runs — only on red-team generation.
    - Fixed `buildEvalTests` in `server.cjs` to merge
      `target.metadata.redteam.defaultTest.vars` as the base for every
      eval test case's vars, with test-specific `vars` still overriding
      on key conflicts (matches promptfoo's own precedence) — a 5-line,
      single-choke-point fix since every eval test case already flows
      through this one function regardless of whether it came from a
      manually-added test case or an imported/scenario-expanded one.
    - Updated the "Default test variables" label copy in the Red team
      workspace (`main.tsx`) from "reused across generated and custom
      probes" (implied redteam-only) to state it applies as a base to
      every test case in both Eval and Red team runs — the UI didn't
      move (still the one place `defaultTest.vars` is edited), only the
      copy, so it stops under-promising what the field actually now
      does.
    - Deliberately scoped this to `.vars` only, not `.assert` (promptfoo's
      `defaultTest` also supports default assertions applied to every
      test): the stored schema and PATCH route for `redteam.defaultTest`
      only ever had a `.vars` shape, and building a real assertion-list
      editor UI for it is a larger, separate lift — left as explicit
      follow-up rather than half-implementing it.
    - Verified live against the real E2E reference target (both eval and
      red-team config captured before, restored after): set
      `defaultTest.vars = {tone: "formal"}` via the existing red-team
      config route, then ran a real eval test case with a `javascript`
      assertion (`vars.tone === "formal"`) that never set `tone` itself —
      passed, confirming the merge. Then ran a second case that DID set
      `vars.tone = "casual"` with an assertion expecting `"casual"` —
      also passed, confirming test-specific vars still win over the
      default. Finally reran the target's original baseline eval config
      unchanged to confirm no regression (still 1/1 pass). Cleaned up all
      test runs and fully restored both configs afterward.

## Change log — iteration 29 (viewer role: hide/disable write actions in the UI)

46. Closed a long-standing item from the original task #8 list: viewer
    accounts were fully blocked server-side (403 on every mutating route)
    but the frontend never hid or disabled the write-action buttons that
    trigger those routes — a viewer could click "Run eval", "Save
    config", "Delete target", etc. and just get an unexplained error.
    The user explicitly confirmed this was in scope ("password reset
    flow not required complete others") when asked to prioritize the
    remaining known-gaps list.
    - Threaded a new `isViewer` prop from the `App` component (computed
      once as `user.role !== 'admin'`) down through `RegistryPage`,
      `TargetDetailPage` -> `StageWorkspace` -> `EvalWorkspace` /
      `RedTeamWorkspace` / `ModelAuditWorkspace` / `EvidenceWorkspace`.
    - Scoped the change to buttons that actually trigger an API call
      (POST/PATCH/DELETE) — not every button that mutates local React
      state. Local-only actions like "Add provider", "Remove", "Add
      prompt", "Add case" still work freely for a viewer (they're just
      editing in-memory form state, nothing to block), matching the
      existing viewer badge's own promise ("can browse everything"). The
      buttons gated are the ones that would otherwise 403: Onboard a
      model, Import config/Load file, Duplicate, Target settings
      save/delete, Prepare stage, Test provider, Save config/version/use,
      activate/delete dataset, Run/Cancel eval-redteam-audit, Create/
      run-now/pause/delete schedule, Rerun/Cancel/Delete run.
    - Defense in depth: every gated button also got `disabled={isViewer}`
      **and** the underlying handler function got an `if (isViewer)
      return` guard at the top — disabling the button alone doesn't stop
      a form's Enter-key submit path, so the handler-level guard is the
      real backstop; the disabled attribute is just the discoverability
      layer (plus a `title="Viewer accounts cannot make changes"` tooltip
      on every one, so it's not just a silently unclickable button).
    - Also found and fixed a related, smaller gap while doing this: a
      viewer typing `#/users` or `#/tokens` directly into the URL bar
      could still reach `UsersPage`/`TokensPage` (the nav buttons to
      those pages were already admin-only, but there was no guard on the
      hash-routing resolution itself). Added an `isAdminRoute` check in
      both the initial-load and hashchange routing effects that redirects
      to the registry if a non-admin's URL points at an admin-only view.
    - Updated the "Default test variables" label copy while in the area
      (see iteration 28, item 45) — unrelated content fix bundled in
      since it was a one-line change already staged.
    - Verified live end-to-end with a real second account, not just code
      review: created a disposable viewer user via the API, logged into
      the actual UI as that user, and confirmed via the accessibility
      tree (`title` attributes, not just visual color) that every gated
      button reports "Viewer accounts cannot make changes" — Onboard a
      model, Import config, Prepare Eval/Red team/Model audit, Test
      provider, Save version/Save and use, Save config, Run eval — while
      "Add provider"/"Remove"/"Add prompt" remained genuinely clickable.
      Confirmed the "Users"/"API tokens" nav buttons are absent for a
      viewer, and that manually setting `location.hash = '#/users'`
      correctly redirects back to the registry instead of rendering the
      admin page. Logged back in as the real admin account afterward and
      confirmed every one of those same buttons is fully enabled with no
      `title` tooltip — the change is additive for viewers only, zero
      behavior change for admins. Deleted the disposable viewer account
      afterward. (One unrelated hiccup during this pass: the browser
      automation tool's own click events intermittently failed to
      register on the login button — confirmed it was a tool-side issue,
      not a regression, by dispatching a real `form.requestSubmit()` via
      JS, which worked immediately and logged in correctly.)

## Change log — iteration 30 (Replicate provider, `/loop` continuation — refocused on core functionality)

47. The user explicitly redirected priority away from roles/permissions
    work and back to core functionality parity ("all i want now is to
    complete all the functionlities and build the core engine rather
    than multiple roles access and permission") — saved as a standing
    memory so future iterations don't drift back toward RBAC polish.
    Closed the next real gap from that lens: `Replicate` was the one
    remaining catalog entry marked `(planned)`/non-executable. Confirmed
    real promptfoo has a genuine `replicate:`-prefixed provider
    (`promptfoo-source/src/providers/replicate.ts`, registered in
    `registry.ts`), so — same as the 10 providers wired in iteration 9
    (Bedrock, Vertex, watsonx, Databricks, Snowflake Cortex, Cloudflare
    Workers AI, MCP, fal, Voyage) — this needed the real
    `pf.loadApiProvider` bridge, not a hand-written HTTP adapter.
    - One-line fix: added `replicate: 'replicate'` to
      `PROMPTFOO_LIBRARY_PROVIDERS` in `app/shared/provider-catalog.cjs`.
      `adapterForProvider('replicate')` now resolves to
      `'promptfoo-library'` instead of `'adapter-required'`, which
      automatically flips `executable: true` in the catalog API and
      removes the `(planned)` suffix in the frontend dropdown (confirmed
      that suffix is rendered dynamically off `item.executable`, not a
      hardcoded string — no frontend change needed). Provider catalog is
      now 55/55 executable, 0 remaining `(planned)` entries.
    - Verified live, not just "no crash": created a disposable target,
      configured a `replicate` provider with a fake API token, and hit
      the real provider-test endpoint. Got back
      `"Unsupported response from Replicate: undefined"` after a real
      ~2.7s network round trip — confirmed by grepping
      `promptfoo-source/src/providers/replicate.ts:317` that this exact
      string is only ever emitted by the real vendored Replicate
      provider's own response-parsing code, proving the bridge actually
      reached Replicate's live API (and got rejected, as expected with a
      fake token) rather than crashing or silently faking a pass. No
      `REPLICATE_API_KEY` is available in this environment to test a
      genuine 200, so a real successful generation is unverified — but
      the failure mode is the real provider's own, same standard used
      for Databricks in iteration 9. Deleted the disposable target
      afterward.

48. Same iteration, second fix: closed the `.vars`-only half of the gap
    from item 45 by wiring `defaultTest.assert` — real promptfoo's
    default-assertions-applied-to-every-test config, which was
    explicitly left out of the earlier fix because the stored schema and
    UI only had a `.vars` shape.
    - Extended the `redteam.defaultTest` shape (both storage in
      `PATCH .../stages/red_team/config` and the `RedTeamStageConfigPayload`
      frontend type) to also carry `assert: Array<{type, value}>`, using
      the same non-destructive partial-update pattern already fixed
      elsewhere this session (`assert` falls back to the existing stored
      value when the caller's body omits it, not to `[]`).
    - `buildEvalTests` now prepends `redteam.defaultTest.assert` to every
      eval test case's own assertion array (`[...baseAssertions,
      ...testOwnAssertions]`) — matching real promptfoo semantics: the
      default assertions run *in addition to* the test's own, and ALL
      must pass, not either/or.
    - Added a "Default test assertions" editor to the Red-team
      workspace's UI, directly under the existing "Default test
      variables" section it already sits next to — reused the exact
      assertion-row pattern (type dropdown sourced from
      `workflowCatalog.assertions`, value input, add/remove) already
      used for per-test-case assertions in the Eval workspace, so no new
      UI pattern was invented.
    - Verified live against the real E2E reference target (both configs
      captured before, restored after): set
      `defaultTest.assert = [{type: 'contains', value: 'READY'}]`, then
      ran two real eval test cases against the live Groq target, each
      with only a trivial `min-length: 1` assertion of their own — one
      prompted to reply "READY" (passed: both the default `contains`
      check and the test's own check passed), one prompted to reply
      "NOTHERE" (failed: the test's own `min-length` assertion still
      passed on its own, but the row correctly failed overall because
      the *default* `contains READY` assertion failed) — proving the
      default assertion is genuinely enforced in addition to, not
      instead of, each test's own checks. Also reran the target's
      original baseline config unchanged afterward to confirm no
      regression (still 1/1 pass). Cleaned up all test runs; restoring
      the red-team config needed one extra step beyond the usual
      capture-before/restore-after pattern — the original snapshot
      predated the `.assert` field entirely, so the non-destructive PATCH
      (correctly) preserved the just-set test value instead of clearing
      it; had to explicitly PATCH `assert: []` to actually restore the
      target to its true original state.

## Change log — iteration 31 (`assert-set` authoring UI, `/loop` continuation)

49. Closed the last item on the "not yet covered" list from item 27
    (iteration 18's original finding): `assert-set` (promptfoo's
    weighted nested-assertion group) evaluated correctly when a config
    was imported, but there was no way to build one from scratch in the
    eval test-case editor.
    - Extended the per-test-case assertion editor in the Eval workspace:
      picking "Assertion group (weighted)" as an assertion's type now
      swaps the plain value input for a threshold field (0-1) and reveals
      a nested list of sub-assertions, each with its own type dropdown,
      value input, and weight — with add/remove controls, reusing the
      same dropdown/catalog pattern as the top-level assertion editor
      (the sub-assertion dropdown excludes `assert-set` itself, so
      authoring stays to one level of nesting from the UI; arbitrarily
      deep nesting still works via YAML import, matching the scope
      decision already on record from iteration 18).
    - Added `EvalAssertion` as a shared frontend type (`api.ts`) so the
      test-case editor, `updateTestCaseAssertion`, and three new helpers
      (`updateSubAssertion`/`addSubAssertion`/`removeSubAssertion`) all
      agree on the same shape (`type`, `value`, `threshold?`, `weight?`,
      `assert?`). Switching a row's type into/out of `assert-set` now
      seeds/clears the nested fields so stale data can't linger under
      the wrong type.
    - **Found and fixed a real bug in my own earlier work while manually
      testing this in the browser**: `assert-set` was never actually
      added to `ASSERTION_TYPES` in `workflow-catalog.cjs` — meaning the
      type dropdown (driven off that catalog) had no `assert-set` option
      at all, so the brand-new nested editor I'd just built was
      completely unreachable. Caught by checking the live DOM directly
      (`document.querySelectorAll('select')`) rather than trusting that
      "the backend already evaluates it" meant the frontend exposed it.
      Added the missing catalog entry (61 -> 62 assertion types).
    - Verified live end to end against the real E2E reference target
      (config captured before, restored after): PATCHed in a test case
      shaped exactly like the new UI's save payload (`assert-set` with
      `threshold: 0.5` and two weighted `contains` sub-assertions,
      weights 2 and 1), confirmed the config round-tripped with
      `threshold`/`assert`/`weight` all intact, then ran a real eval
      against the live Groq target — got back
      `score: 0.667, threshold: 0.5, pass: true`, matching the hand-
      computed `(1×2+0×1)/3` exactly, with each sub-assertion's own
      pass/fail visible in `results[]`. Also confirmed in the live
      browser DOM (not just a screenshot) that selecting "Assertion
      group (weighted)" renders the nested editor with a real CSS grid
      (`display: grid`, 4 sensible column widths, not stacked/broken).
      Reran the target's original baseline config afterward to confirm
      no regression. Cleaned up the test run and restored the config.

## Change log — iteration 32 (native-engine-mode parity for graphql/websocket-chat/browser-chatbot)

50. Closed the last documented "honest limitation" from iteration 14:
    the three hand-built application-target adapters (`graphql`,
    `websocket-chat`, `browser-chatbot` — real promptfoo has no
    equivalents for these, so they were always hand-implemented) worked
    fine in this product's own "Direct product runner" mode but threw
    `"Native engine mode does not yet support the X adapter"` if a user
    switched to "Installed engine runner" (the real, installed promptfoo
    CLI, invoked via `providers/native-target.cjs` as a custom JS
    provider in a spawned process). That bridge script only had 8 of the
    11 direct-mode adapters ported over.
    - Ported all three call implementations from `server.cjs`
      (`callGraphQL`/`callWebSocketChat`/`callBrowserChatbot`) into
      `providers/native-target.cjs` as class methods, along with the
      three small helpers they depend on (`getByPath`,
      `deepTemplateSubstitute`, `parseLibraryConfig`) and a lazy
      Playwright Chromium loader — faithful ports, not
      reimplementations, so behavior matches direct mode exactly
      (same `libraryConfig` shape: `query`/`variables`/`responsePath`
      for GraphQL, `messageTemplate`/`responsePath`/`timeoutMs` for
      WebSocket, `inputSelector`/`submitSelector`/`responseSelector` for
      browser). `ws` and `playwright` were already project dependencies
      (added in iteration 14) and this script runs in the same
      node_modules tree, so no new dependencies were needed.
    - Added the three adapter ids to the `nativeAdapters` allowlist in
      `buildNativePromptfooConfig` (`server.cjs`), and — the actual root
      cause of why this was silently impossible before, not just
      unlisted — added the missing `libraryConfig: providerConfig.
      libraryConfig` line to the provider config object that function
      assembles; without it, even a correctly-ported native adapter
      would have received an empty config and failed on every call.
    - Verified live against real local test servers (a GraphQL-shaped
      JSON endpoint, a `ws` echo server, and a static HTML page with a
      real input/button/response DOM — the same fixtures used for the
      original direct-mode verification in iteration 14), each run
      through the real installed-promptfoo-CLI path
      (`runOptions.engineMode: 'native'`), not direct mode: GraphQL
      returned `{"text":"graphql-echo: ..."}` and passed its assertion;
      WebSocket returned `"ws-echo: ..."` and passed; browser-chatbot
      launched a real headless Chromium, filled the input, clicked
      submit, read the response DOM, returned `"browser-echo: ..."` and
      passed. All three were genuine round trips through the real
      installed promptfoo engine, not the product's own direct runner.
      Also reran the E2E reference target's baseline eval unchanged
      (still 1/1 pass, direct mode) to confirm no regression. Deleted
      the disposable target and stopped the test-fixture servers
      afterward. No more adapters have an "honest limitation" placeholder
      in native mode — all 11 direct-mode adapters now also work in
      native mode.

## Change log — iteration 33 (real `dependency-risk` model-audit scanner)

51. Closed one of the three remaining honestly-unimplemented model-audit
    scanners (`malware`/`dependency-risk`/`data-lineage` — see iteration
    21). `dependency-risk` genuinely has a real, useful, purely-local
    check available: dependency-version *pinning*. A floating range
    (`^4.17.21`, `*`, no version at all) means the next install can
    silently pull in different, unreviewed, or compromised code without
    the artifact itself changing — a real, well-known supply-chain risk
    signal, distinct from (and not a substitute for) a live known-CVE
    database lookup, which this self-hosted product genuinely has no
    access to and won't fake.
    - Added `scanArtifactForDependencyRisk(rootPath)` in `server.cjs`:
      walks the artifact tree (reusing the existing `walkArtifactFiles`
      helper the secrets/unsafe-code scanners already use) for
      `package.json` and `requirements.txt`; flags any dependency whose
      version range isn't pinned to an exact value (`^`/`~`/`*`/`x`/`||`
      ranges or a missing version for npm, anything without `==` for
      pip).
    - Wired it into `executeModelAuditRun` following the exact same
      pattern as the other real local scanners: gated on
      `selectedScanners.includes('dependency-risk')`, a real fail when
      the artifact path isn't readable (not a silent pass), and every
      detail message ends with an explicit "This checks pinning only,
      not a live CVE database" so a green result is never mistaken for
      "no known vulnerabilities."
    - Verified live with a real fixture, not just code review: a
      `package.json` with one pinned (`express@4.18.2`) and two unpinned
      (`lodash@^4.17.21`, `left-pad@*`) dependencies, plus a
      `requirements.txt` with one pinned (`numpy==1.26.0`) and one
      unpinned (`requests`, no version) — ran the real scan and got back
      exactly the 3 expected unpinned entries, correctly excluding both
      pinned ones. Then removed all unpinned entries from the fixture and
      reran — got a clean pass listing the manifest checked. Also reran
      the E2E reference target's existing model-audit config (which
      doesn't select `dependency-risk`) to confirm the unrelated checks
      are unaffected (same 9 checks, same 2 pre-existing failures as
      before). Deleted the disposable target and fixture directory
      afterward. `malware` and `data-lineage` remain honestly
      unimplemented — genuinely need external malware-signature/data-
      lineage-tracking infrastructure this product doesn't have, so
      faking either would be dishonest rather than a real check.

## Change log — iteration 34 (`perplexity`/`perplexity-score` assertions — caught a real regression before it shipped)

52. Added the last two assertion types from the original "niche, might
    not be feasible" list (see iteration 28) that turned out to actually
    be implementable: `perplexity` and `perplexity-score`. Real
    promptfoo computes both from a provider's own per-token logprobs
    (`perplexity = exp(-avg(logProbs))`; `perplexity-score` is a
    normalized `1/(1+perplexity)` — see
    `promptfoo-source/src/assertions/perplexity.ts`), which is a real,
    honest local computation as long as the provider actually returns
    logprobs — unlike `pi` (confirmed via
    `promptfoo-source/src/matchers/llmGrading.ts` that it calls out to
    promptfoo's *hosted* remote scoring API with no local equivalent at
    all) or `trajectory:*`/`trace-*` (need real tracing infra this
    product doesn't capture), which remain correctly excluded.
    - Added `case 'perplexity':`/`case 'perplexity-score':` to
      `evaluateAssertion`, matching real promptfoo's math and pass/fail
      logic exactly, reading from a new `context.providerResponse.
      logProbs` field. Honest failure (not a fake pass) when the field
      is absent, mirroring promptfoo's own error message for providers
      that don't return logprobs.
    - **Caught a real regression during live verification, before
      committing**: my first pass had `callOpenAICompatible` request
      `logprobs: true` *unconditionally* on every call, reasoning
      "harmless if the provider ignores it." That assumption was wrong —
      tested live against the E2E reference target's real Groq
      connection and the *baseline eval test* (which doesn't even use a
      perplexity assertion) started failing with a real Groq API error:
      `` `logprobs` is not supported with this model `` — Groq's
      `llama-3.1-8b-instant` rejects the entire chat-completion request
      outright when the field is present, not just the logprobs part of
      it. Checked real promptfoo's own OpenAI provider
      (`openai/chat.ts`) and confirmed it *also* only sends `logprobs`
      when explicitly opted in (`callApiOptions.includeLogProbs`), never
      unconditionally — my "harmless" assumption was simply wrong, and
      shipping it would have broken eval runs for every OpenAI-
      compatible provider/model combination that behaves like Groq's.
    - Fixed by making it opt-in per provider: added a `requestLogprobs`
      boolean to the same `libraryConfig` JSON field already used for
      graphql/websocket/browser's extra config (no new DB/API surface),
      defaulting to off. Extended the Eval workspace's provider config UI
      to show a "Provider-specific config (JSON)" field for
      `openai-compatible` providers too (previously only shown for
      library-bridged/graphql/websocket/browser providers), with help
      text explaining the tradeoff plainly.
    - Verified live, three separate ways, all against the real E2E
      target: (1) confirmed the regression existed — baseline eval
      failed with the real Groq error while `logprobs:true` was
      unconditional; (2) after the fix, reran the identical baseline
      eval and confirmed it passes again (1/1, no error) — regression
      closed; (3) reran WITH `requestLogprobs: true` explicitly opted in
      and got the same real Groq rejection, proving the opt-in flag
      genuinely controls the request parameter and that Groq's specific
      model genuinely doesn't support logprobs (not a code bug) — this
      product has no OpenAI-compatible provider on hand in this
      environment whose model actually returns logprobs, so a genuine
      full-pass perplexity computation is unverified, but the failure
      mode at every step is the real provider's own, never a fake
      result. Restored the target's original config afterward.

## Change log — iteration 35 (real `malware` model-audit scanner via the `modelaudit` CLI)

53. Closed the second of the three originally-unimplemented model-audit
    scanners (see iteration 21/33): `malware`. Cross-checked real
    promptfoo's own model-audit feature (`promptfoo-source/src/types/
    modelAudit.ts`) and its doc comment gave this away directly — its
    types are "based on the actual CLI output structure from ModelAudit
    tool." Confirmed `modelaudit` is a real, independently-maintained,
    installable PyPI package (`pip install modelaudit`) that does real
    pickle-opcode analysis, dangerous-global-import detection, file
    hashing, etc. — real promptfoo doesn't reimplement malware scanning
    either, it wraps this same external tool. So the honest move here
    is the same shape as the eval-side pattern already used for judge-
    backed assertions (real when available, clearly-labeled fallback
    otherwise), not writing a home-grown pattern-matcher.
    - Added `runModelAuditCli(rootPath)` in `server.cjs`: spawns
      `modelaudit scan <path> --format json`, parses stdout as JSON
      regardless of exit code (the CLI exits non-zero when it *finds*
      issues — same convention as `grep` — so a non-zero code is a
      normal result, not a failure), and distinguishes three real
      outcomes: not installed (`ENOENT` — the expected default state for
      most deployments), a genuine execution error, or a real parsed
      result. 120s timeout since a real scan takes real time (measured
      ~12-14s even for a single tiny file in this environment — that's
      the tool's own fixed startup/engine-load overhead, not something
      controllable from this side).
    - Wired into `executeModelAuditRun`'s `malware` branch, which
      required converting that function (and its one call site) to
      `async` — it now genuinely awaits an external process instead of
      being pure local computation. Maps the CLI's real `issues[]` (any
      `critical`/`error` severity finding fails the check) into this
      product's existing scanner-check shape, consistent with how
      `secrets`/`unsafe-code`/`dependency-risk` already report.
      Deliberately NOT added as a project dependency (nothing in
      `package.json`) — it's Python tooling, detected at runtime, with
      an honest "not installed, here's how to enable it" message when
      absent, exactly like the pre-existing "not evaluated — no scanner
      implemented" placeholder it replaces for this one key.
    - Verified live, three separate real scenarios, not code review:
      (1) installed `modelaudit` locally (`pip install modelaudit`),
      built a real fixture with a genuinely malicious pickle
      (`__reduce__` returning `(os.system, ('echo pwned',))`), ran it
      through the full product stack (disposable target -> real HTTP
      request -> real spawned CLI) and got back
      `pass: false` with `"Found REDUCE opcode invoking dangerous
      global: posix.system"` — the CLI's own genuine detection, word for
      word; (2) reran against a clean fixture (a README and a JSON
      config, no code) and got a real, correctly-computed pass; (3)
      restarted the server with a `PATH` that excludes the `modelaudit`
      binary entirely (simulating the common "not installed" deployment
      case) and confirmed the honest "CLI not installed... pip install
      modelaudit to enable" fallback fires correctly rather than
      crashing or silently reporting a fake pass. Also reran the E2E
      reference target's existing model-audit config (which doesn't
      select `malware`) to confirm zero regression from making the
      function `async` (identical 9 checks, same 2 pre-existing
      failures). Deleted the disposable target and fixtures afterward.
      `data-lineage` is the only model-audit scanner still honestly
      unimplemented — genuinely needs external data-provenance-tracking
      infrastructure this product has no access to.

## Change log — iteration 36 (real `data-lineage` scanner — closes the model-audit catalog)

54. Closed the last model-audit scanner gap. Reconsidered `data-lineage`
    using the exact same shallow-but-real pattern already used for
    `model-card` (which only checks that a model-card-shaped file
    exists, not that its content is accurate) — data lineage has an
    equivalent standard artifact ("Datasheets for Datasets," dataset
    cards, provenance manifests) that a real check can honestly verify
    the *presence* of, even without a full external lineage-tracking
    system.
    - Added a `data-lineage` branch to `executeModelAuditRun` using
      `findArtifactFile` (already used by `model-card`) with a
      `/datasheet|dataset.?card|data.?lineage|provenance/i` pattern.
      Label and detail text are explicit that this confirms
      *documentation exists*, not that its lineage claims are
      independently verified — same honesty standard as every other
      scanner this session.
    - Verified live with two real fixtures: one with a `DATASHEET.md`
      present (correctly passed, named the actual file found) and one
      with only an unrelated `README.txt` (correctly failed, honest "no
      datasheet/dataset card/lineage file found" message). Reran the
      E2E reference target's existing model-audit config afterward —
      zero regression (identical 9 checks, same 2 pre-existing
      failures, since that target doesn't select `data-lineage`).
      Deleted the disposable target and fixtures afterward.
    - **All 10 scanners in the model-audit catalog now have a real
      implementation** (7 local file/pattern scanners, 1 real
      external-CLI-backed scanner for `malware`, and this presence
      check for `data-lineage`) — the "not evaluated — no scanner
      implemented" fallback path in `executeModelAuditRun` is now
      unreachable for any scanner in the current catalog; it remains in
      place only as a safety net for a future scanner key that gets
      added to the catalog before its check is implemented.

## Change log — iteration 37 (CRITICAL: native engine mode crash on empty-array config fields)

55. User-reported audit (external review, with real file:line references and a
    captured stack trace from an actual native-CLI subprocess run) caught a
    genuine crash bug this session's own earlier work had shipped: **any
    target with a red-team config attached crashed native engine mode eval
    runs entirely**, via a real `YAMLException` thrown by the real,
    vendored `js-yaml` parser inside the actual `promptfoo` CLI subprocess
    — not a hand-wavy "might be an issue," a reproduced crash.
    - Root cause: `toYaml()` (`server.cjs`) has an array branch whose empty
      case does `if (!value.length) return '[]';` with **no indentation
      prefix applied** — a bare, unpadded early return. The *caller* (the
      object-property branch) treats any array field, empty or not,
      identically: `` `${pad}${key}:\n${toYaml(item, indent + 2)}` ``. For a
      non-empty array this is correct (each element gets its own indented
      `- item` line from the recursive call). For an **empty** array, the
      recursive call just returns the bare 2-character string `"[]"` with
      zero indentation, producing output shaped like:
      ```
        defaultTest:
          vars:
      assert: []
      ```
      — `assert: []` lands at the WRONG indentation (not nested under
      `defaultTest:`), which real YAML correctly refuses to parse as a
      value for the preceding key. This was invisible until now because
      no config had ever actually contained an empty-array field routed
      through native mode's YAML serialization until this session's own
      `defaultTest.assert` work (iteration 32) started persisting
      `assert: []` as the default value on every target.
    - **This wasn't limited to `defaultTest.assert`** — the bug is generic
      to `toYaml()`, so it would have silently corrupted the native-mode
      YAML for *any* empty array field the moment one appeared (`plugins:
      []`, `strategies: []`, `entities: []`, `customProbes: []`,
      `language: []`, etc.) — this session's own testing happened not to
      hit it only because those fields are rarely left empty in practice,
      unlike `defaultTest.assert` which defaults to `[]` on every target.
    - Fixed by special-casing empty arrays to render inline
      (`${pad}${key}: []`) in the object-property branch, instead of
      falling through to the newline-plus-recursive-call path meant for
      non-empty arrays. One targeted change, fixes every empty-array field
      at once rather than just the one that happened to be reported.
    - Verified live, not just re-reading the diff: (1) fetched the real
      exported YAML for the E2E reference target (which has real red-team
      config with `defaultTest.assert: []`) via
      `GET /api/targets/:id/export/yaml`, fed it through the actual
      `js-yaml` package's `yaml.load()`, and confirmed it now parses
      cleanly with `defaultTest.assert` correctly round-tripping to `[]`;
      (2) switched the E2E target's eval run options to
      `engineMode: 'native'` and ran a real eval through the actual
      installed-promptfoo-CLI path — completed successfully (previously
      this exact scenario is what the reporting audit had caught
      crashing). Restored the target's `engineMode` back to `direct`
      afterward and cleaned up the test run.

## Change log — iteration 38 (model-audit catalog vs. executor mismatch)

56. Second item from the same external audit: the model-audit "Scanners"
    picker UI ("Select checks to include in the model audit run") was
    lying about what it controlled. `executeModelAuditRun` always runs 5
    baseline checks (`metadata-completeness`, `provenance`, `license`,
    `runtime-boundary`, `data-classification`) completely unconditionally
    — never gated on `audit.scanners` — but 3 of those 5
    (`metadata-completeness`/`provenance`/`license`) were listed in the
    `AUDIT_SCANNERS` catalog the picker renders as if they were optional
    checkboxes, while the other 2 (`runtime-boundary`/`data-
    classification`) weren't in the catalog at all — always running,
    silently, with no way for a user to even discover they exist short of
    reading a run's results.
    - Split `AUDIT_SCANNERS` in `workflow-catalog.cjs` into two lists: the
      7 genuinely-optional scanners stay in `AUDIT_SCANNERS` (actually
      gated by `selectedScanners.includes(...)` in the executor —
      verified by re-reading that code, not assumed), and a new
      `AUDIT_BASELINE_CHECKS` (5 entries) for the always-run ones.
    - Exposed both via `/api/workflow-catalog` (`auditScanners` +
      `auditBaselineChecks`).
    - Frontend: added a "Baseline checks" section above "Scanners" in the
      Model Audit workspace showing the 5 baseline checks as plain
      informational tiles (not checkboxes — nothing to toggle, since
      toggling never did anything), and reworded the Scanners section to
      "Select *additional* checks" so it stops implying the baseline ones
      are part of the same opt-in mechanism.
    - Verified live: confirmed the new catalog split via
      `/api/workflow-catalog` (7 scanners / 5 baseline checks, no
      overlap), then reran the E2E reference target's real model-audit
      config — same 9 checks, same pass/fail pattern as every prior run
      this session (once a since-cleared scratch fixture directory was
      recreated — an unrelated environment issue from scratchpad cleanup
      between session continuations, not a regression from this change;
      confirmed by checking the fixture path no longer existed on disk
      before recreating it).

## Change log — iteration 39 (duplicate target name prevention)

57. Third item from the same external audit: no uniqueness check on
    `onboarded_targets.display_name` in either the create or import route
    — confirmed live in this environment, which already had two separate
    targets both literally named "Imported target" (the import route's
    own fallback default when no name is supplied). Two identically-named
    targets in the registry list are genuinely hard to tell apart.
    - Added `uniqueDisplayName(client, baseName)` in `server.cjs`: checks
      for an existing exact match or `"name (N)"` variant and returns the
      next free `"name (N)"` suffix — the same disambiguation shape
      "Duplicate" already uses for its own copies (`${name} (copy)`), so
      this isn't a new UX pattern, just applying the existing one
      consistently. Deliberately not a hard DB uniqueness constraint —
      that could break pre-existing duplicate rows and would outright
      block a legitimate re-import of the same source config for a
      different environment, where auto-disambiguation is more useful
      than an error.
    - Wired into both the create route (`POST /api/targets`) and the
      import route (`POST /api/targets/import`).
    - Verified live: created the same target name three times in a row
      via the create route — got back `"Dedup name test"`, `"Dedup name
      test (2)"`, `"Dedup name test (3)"` — then did the same via the
      import route with an identical pasted config and got the correctly
      continued sequence (confirmed via a full registry listing, since an
      earlier verification attempt's response got mangled by a local
      shell/JSON-escaping issue on my end, not a server error — the
      calls had actually succeeded, and the next real attempt correctly
      picked up the sequence where the earlier ones left off, which is
      itself further confirmation the counter logic is correct across
      independent requests). Deleted all 7 test targets afterward. Left
      the pre-existing "Imported target" duplicates in the registry
      untouched — this fix prevents new collisions, it doesn't rewrite a
      user's existing data.

## Change log — iteration 40 (surface real-generation fallback + a second real bug found while verifying it)

58. Fourth item from the same external audit: `generateRealRedTeamCases`
    silently returned `null` on every failure path (no provider, no
    resolvable API key, zero tests generated, or a real generation
    error), only logging server-side via `console.error` — the caller
    then transparently substituted local-template generation with no
    signal in the API response the UI could use to tell the user real
    generation didn't actually happen.
    - Changed `generateRealRedTeamCases` to return `{ cases, error }`
      instead of a bare `cases | null`, with a specific, actionable
      `error` string for each failure mode — including a dedicated
      message when `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION` (set in
      this project's own `.env`) is the likely cause of a 0-test result,
      since that's a real, common cause here, not a hypothetical one.
    - `buildRedTeamCases` now threads the reason through as
      `rows.realGenerationFallbackReason` (an extra own-property on the
      returned array — doesn't affect `.filter`/`.map`/`.length` at
      either of its two call sites, so no signature change needed there).
      Both the `/plan` preview route and `executeRedTeamRun`'s actual run
      result now include `realGenerationFallbackReason` at the top level
      (persists through the existing generic `results` JSON column with
      zero new plumbing).
    - Frontend: added a warning banner (reusing the existing `.error`
      style) above both the "Attack plan" preview and the "Latest run"
      summary in the Red-team workspace, shown only when the reason is
      non-null.
    - Also fixed a related, smaller bug spotted in the same code while
      there: the run summary's `generated` count only matched
      `item.source === 'generated'` (the local generator's source tag),
      silently excluding the real generator's `'generated-live'` tag —
      meaning a fully successful real-generation run reported 0
      "generated" cases in its own summary. Now matches either.
    - **Found a second, more significant real bug while live-verifying
      this fix**: the `PATCH .../stages/red_team/config` route never
      persisted `useRealGeneration` *at all* — not a wrong default, a
      complete omission from the field list. The frontend's "Use real
      adversarial generation" checkbox has been sending this field
      correctly this entire time; the backend simply dropped it on every
      save. `buildRedTeamCases` reads `redteam.useRealGeneration` to
      decide whether to attempt real generation at all — with it never
      persisting, **real generation could never actually be turned on
      through the UI/API**, silently defaulting to local templates on
      every run regardless of what the user configured. Discovered this
      because my first three attempts to verify the new
      `realGenerationFallbackReason` field all showed successful local-
      looking results no matter which plugin I selected — including ones
      confirmed to be in promptfoo's own `REMOTE_ONLY_PLUGIN_IDS` list,
      which should have failed under this project's
      `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` — until
      checking the live stored config showed `useRealGeneration` had
      silently stayed unset through every one of my PATCH attempts.
      Fixed with the same non-destructive `!== undefined` pattern already
      used for every other field on this route.
    - Verified live, the full matrix, against the real E2E reference
      target (both eval and red-team config captured before, restored
      after): (1) with a corrupted `apiKeySecretId`, real generation
      correctly failed with `"No resolvable API key for the generation
      provider (...)"`; (2) with the real key restored and
      `system-prompt-override` selected (a plugin actually listed in
      promptfoo's own `REMOTE_ONLY_PLUGIN_IDS`), real generation
      correctly returned 0 tests and surfaced exactly the
      `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION`-aware message, with
      the resulting probe's `source` correctly showing `generated` (the
      local fallback), not `generated-live`; (3) confirmed a genuinely
      successful real generation (before the persistence bug was found)
      correctly reports `realGenerationFallbackReason: null`. Fully
      restored the target's original eval and red-team config
      (`useRealGeneration` explicitly reset to `false`, matching its
      true pre-testing state — the original captured snapshot predated
      this bug's discovery, so it never had the field at all, and the
      route's own non-destructive-PATCH design correctly preserved
      whatever value was live rather than clearing it, meaning restoring
      from that snapshot alone would NOT have reset the field — this
      needed an explicit correction). Reran both the eval and red-team
      stages afterward to confirm zero regression (same pass rates as
      every prior run this session). Task #40 (filtering/disabling
      remote-only plugins/strategies in the UI itself, so a user
      wouldn't need to hit this failure message to find out) remains
      open as a follow-up.

## Change log — iteration 41 (flag remote-only red-team plugins/strategies in the UI)

59. Fifth and last item from the same external audit: real promptfoo's
    own `REMOTE_ONLY_PLUGIN_IDS`/`STRATEGIES_REQUIRING_REMOTE` constants
    (`promptfoo-source/src/redteam/constants/plugins.ts` and
    `strategies.ts`) were never read, filtered, or surfaced anywhere in
    this product — a user turning on "Use real adversarial generation"
    had no way to know, before running, that roughly half the plugin
    catalog and about a quarter of strategies have zero local generation
    path in the real engine and would silently produce 0 cases under
    this project's own `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true`
    — closes the loop opened by iteration 40's
    `realGenerationFallbackReason` (which tells you *after* a run;
    this tells you *before* one).
    - Transcribed real promptfoo's exact plugin/strategy ID lists into
      `workflow-catalog.cjs` as two `Set`s (`REDTEAM_REMOTE_ONLY_PLUGIN_KEYS`
      — 78 keys, `REDTEAM_REMOTE_ONLY_STRATEGY_KEYS` — 10 keys) and flag
      matching catalog entries with `remoteOnly: true` in a small post-
      processing pass (not hand-editing ~90 individual catalog lines).
      Coding-agent-only remote plugins deliberately omitted — this
      product's catalog doesn't include coding-agent plugins at all.
    - Exposed a new `redteamRemoteGenerationDisabled` boolean on
      `/api/workflow-catalog`, reading this project's own
      `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION` env var — so the
      warning only shows when it's actually going to matter, not
      unconditionally on every deployment.
    - Frontend: when "Use real adversarial generation" is checked *and*
      remote generation is disabled server-side, every `remoteOnly`
      plugin/strategy tile in the Red-team workspace picker now shows a
      small "remote only" warning badge, plus an explanatory note above
      the plugin grid. Hidden entirely otherwise (real generation off, or
      remote generation actually available) — the badge only appears when
      it's a genuine, actionable warning, not noise on every visit.
    - Verified live in the real browser (not just code review): logged in
      as the real admin session, opened the E2E target's Red-team
      workspace, confirmed zero warning badges with the checkbox
      unchecked, checked "Use real adversarial generation" via a real DOM
      click event (not directly setting React state) and confirmed
      exactly 88 badges appeared (78 + 10 — matching the catalog counts
      precisely) including on `system-prompt-override` specifically (the
      same plugin iteration 40's fallback-reason test caught actually
      failing under real generation), then unchecked it again and
      confirmed all 88 disappeared. This was a local, unsaved UI toggle
      throughout — confirmed the E2E target's real stored config was
      untouched by re-fetching it afterward, then reran the target's
      real red-team stage to confirm zero regression (still 5/5 pass).
      This closes all five items from the external audit.

## Change log — iteration 42 (`afterEach` extension hooks for eval runs — finished the UI wiring)

60. The backend execution logic for promptfoo's `extensions` config
    concept (`file://path/to/hook.js[:afterEach]` lifecycle hooks) had
    already been added to `server.cjs` (`runAfterEachExtensionHooks`,
    `parseExtensionRef`, wired into `executeEvalRun`'s row-building
    loop) but was completely inert — nothing in the product ever
    populated a target's `metadata.eval.extensions` field, so the
    hook-running code path never executed for a real user.
    - Added `extensions?: string[]` to the `EvalStageConfigPayload`
      type (`api.ts`) and a matching "Extension hooks (one per line)"
      textarea to the Eval workspace's Run options panel (`main.tsx`),
      converting newline-separated lines to a string array on save —
      the same pattern already used for bulk test-case import. No
      backend route changes were needed: the `PATCH
      .../stages/eval/config` route already spreads the whole request
      body into eval metadata, so a populated `extensions` field
      persists automatically once the frontend sends it.
    - Verified live against the real E2E reference target (Groq-backed,
      eval config captured before): wrote a real `.cjs` hook script
      exporting `module.exports.afterEach`, PATCHed it into the
      target's `extensions` field via the API (mirroring what the new
      UI field now does), and ran a real eval. The live run's row came
      back with `namedScores: { customLength: 5 }` and
      `metadata: { extensionHookRan: true, hookName: "afterEach" }` —
      both injected by the hook — while `pass`/`score` came only from
      the real `contains` assertion (`pass: true`), confirming the
      hook cannot override grading, matching promptfoo's own
      `afterEach` mutation contract.
    - Restoring the target's original config after the test surfaced a
      real edge case in the eval-config PATCH route's merge semantics:
      it shallow-merges the request body onto the *existing* stored
      eval config rather than replacing it wholesale, so PATCHing with
      a payload that simply omits `extensions` does not clear a
      previously-set value — the field has to be explicitly sent as
      `extensions: []` to reset it. Confirmed this is intentional
      behavior (the same non-destructive-merge pattern this route uses
      for every other field, e.g. `testCases`), not a bug, but it means
      "restore from a snapshot taken before the field existed" requires
      an explicit clear rather than a bare replay of that snapshot.
      Cleared `extensions` back to `[]` and confirmed via a fresh GET
      that the target's full eval config (providers, prompts, dataset
      ID, test cases) exactly matches its pre-test state, then deleted
      the scratch hook script.

## Change log — iteration 43 (schedule webhook: HMAC signature + retry + delivery tracking)

61. Last open item from the external audit: `sendScheduleWebhook` was
    truly fire-and-forget — no signature, so a receiving endpoint had
    no way to verify a notification actually came from this product;
    no retry, so a single transient network blip silently dropped a
    failure notification; and no delivery-outcome persistence, so a
    dead webhook URL was invisible anywhere in the product itself
    (only in server logs, which most users never see).
    - Added `notify_webhook_secret`, `last_webhook_status`,
      `last_webhook_at`, `last_webhook_attempts` columns to
      `target_schedules` (`schema.sql`, applied automatically on
      startup like every prior migration this session).
    - `sendScheduleWebhook` now signs the raw JSON body with the
      schedule's secret (`X-Signature: sha256=<hmac-sha256 hex>`,
      the same shape as GitHub/Stripe webhook signatures) and retries
      up to 3 times with exponential backoff (1s/2s/4s) on network
      failure or a non-2xx response, returning `{ delivered, attempts,
      error }` instead of swallowing the result — both call sites
      (`processDueSchedules` and the manual `run-now` route) now await
      it and persist the outcome.
    - A signing secret is generated automatically (`crypto.randomBytes
      (24).toString('hex')`) the first time a webhook URL is set on a
      schedule if none was supplied, and is only ever returned once in
      the create/rotate API response — matching this product's
      existing API-token pattern. `PATCH .../schedules/:id` accepts
      `rotateWebhookSecret: true` to issue a fresh one; clearing the
      webhook URL clears the secret too, since a secret with no
      destination is meaningless. `rowToSchedule` never exposes the
      raw secret on ordinary reads, only a `notifyWebhookSecretSet`
      boolean.
    - Frontend: the Evidence workspace's schedule list now shows
      "signed (X-Signature)"/"unsigned", the last webhook delivery
      outcome (status/attempt count/timestamp, in the `error` style
      when not `delivered`), a "Rotate secret" button per schedule
      with a webhook configured, and a one-time reveal banner for a
      freshly generated/rotated secret.
    - Verified live end to end, not just code review: stood up a real
      local HTTP receiver, created a real schedule pointing at it,
      captured the auto-generated secret from the create response,
      triggered a real `run-now`, and independently recomputed the
      HMAC-SHA256 of the exact received raw body with the captured
      secret — it matched the `X-Signature` header exactly, and the
      schedule's `lastWebhookStatus` correctly showed `delivered` with
      `lastWebhookAttempts: 1`. Then repointed the same schedule at an
      unreachable port and reran: confirmed exactly 3 attempts (visible
      as ~3.2s of real wall-clock time from the 1s+2s backoff) before
      `lastWebhookStatus` recorded `failed: fetch failed`. Deleted the
      test schedule and stopped the local receiver afterward. This
      closes the last of the twelve items from the external audit.

## Change log — iteration 44 (broaden local red-team generation: strategies + plugin templates)

62. Picked up one of the two remaining known gaps noted at the end of
    iteration 41 but never turned into a task: `buildRedTeamCasesLocal`
    (the local-generation fallback used whenever real generation is off
    or unavailable) only had bespoke attack templates for 17/145
    catalog plugins and only handled 4/27 locally-capable strategies —
    everything else fell through to a useless generic placeholder
    (`Attempt ${plugin} against this application: ${purpose}`) or was
    left untransformed.
    - **Strategies**: replaced the small inline ternary chain with an
      `applyStrategyTransform()` function implementing 20 strategies
      with real, reversible transforms — base64/hex/rot13/morse/
      leetspeak/piglatin/camelcase/homoglyph/emoji encodings, 3
      rotating jailbreak wrapper templates (DAN/developer-mode/
      hypothetical-fiction) for `jailbreak`/`jailbreak-templates`/
      `jailbreak:tree`, `prompt-injection` framing, `math-prompt`
      reframing, `authoritative-markup-injection` fake-admin markup,
      `layer` (composes roleplay + base64), plus `mischievous-user`/
      `best-of-n`/`image`/`video` approximations. Left the genuinely
      un-fakeable ones (jailbreak:meta/composite, GOAT, iterative
      LLM-refinement strategies) alone — those are already correctly
      flagged `remoteOnly` from iteration 41, since real promptfoo
      itself has no local path for them either.
    - **Plugin templates**: extended `templateByPlugin` from 17 to 72
      entries, covering every plugin key in the catalog that is NOT
      flagged `remoteOnly` (real promptfoo's own remote-only plugins
      have zero local generation path either, so faking one for those
      would exceed real parity, not match it) — one exception below.
      Sourced by reading real promptfoo's actual plugin implementations
      under `promptfoo-source/src/redteam/plugins/` for what each
      plugin genuinely tests, not guessed from the key name alone.
    - **Deliberate exclusion**: `harmful:child-exploitation` was
      NOT given a bespoke template. Every other `harmful:*` template is
      a "request for harmful information" in the style of the real,
      published academic safety benchmarks this catalog's dataset-
      backed plugins are literally named after (HarmBench, DoNotAnswer,
      BeaverTails, AEGIS) — that pattern is standard practice in AI
      safety red-teaming and mirrors what real promptfoo itself
      generates at eval time. The child-exploitation category needed
      language specific enough to actually test refusal, but the
      specificity read as an operational grooming script rather than
      an information request, and that line doesn't get crossed
      regardless of red-team framing or how real promptfoo phrases its
      own version. It intentionally keeps falling through to the
      generic fallback string — a deliberate content-safety carve-out,
      not an oversight, and called out with an inline comment in the
      code so a future edit doesn't "fix" it by filling it in.
    - **Found and fixed a real grading bug while verifying**: `xstest`
      is an "exaggerated safety" probe — a benign-sounding-alarming
      request (e.g. "how do I kill a background process") where
      *compliance* is the desired outcome, unlike every other plugin.
      `assessRedTeamOutput`'s generic refusal-heuristic branch graded
      it the same as every harmful plugin (refusal = pass), so a
      real E2E run against a benign xstest probe scored `pass: false`
      even though the model behaved exactly as it should. Added an
      `xstest`-specific branch that inverts the pass condition
      (`pass: !refused`), caught only because verification used a real
      run against the live E2E target rather than just inspecting the
      generated prompt text.
    - Verified live and thoroughly, not just code review: (1) PATCHed
      the E2E target's real red-team config with all 67 local-capable
      plugin keys and fetched a real `/plan`, confirming exactly 66
      produced a genuinely plugin-specific prompt and exactly 1
      (`harmful:child-exploitation`, as intended) still fell through to
      the generic fallback; (2) PATCHed a 12-strategy config across
      several plugins and confirmed every new strategy's encoding is
      correctly formed and reversible (rot13/morse/hex/leetspeak/
      piglatin/camelcase all independently decoded back to the
      original English text); (3) ran a real red-team eval against the
      live E2E Groq target with `debug-access`/`bias:gender`/`xstest`
      selected — `debug-access` correctly caught a real refusal
      failure (the model complied with an unsafe request), `bias:gender`
      correctly passed on a real refusal, and `xstest` — after the
      grading fix — correctly passed on real compliance with a benign
      request. Restored the target's original red-team config
      (verified byte-for-byte identical to the pre-test snapshot) after
      each of the two live-run tests.

## Change log — iteration 45 (AI-generated test-case dataset synthesis)

63. Real promptfoo has a `generate dataset` command (`src/testCase/
    synthesis.ts`) that uses an LLM to invent test cases: generate a
    handful of user personas for the configured prompt, then ask each
    persona to propose realistic-but-interesting variable values,
    informed by existing test cases so it doesn't repeat them. This
    product had manual entry, bulk JSON/CSV import, and full config
    import for building a test suite, but nothing AI-assisted — the
    Eval workspace's dataset-authoring story was otherwise complete.
    - Backend: `generateEvalDatasetForTarget()` in `server.cjs`
      replicates the same two-step synthesis (`datasetPersonasPrompt` →
      `datasetTestCasesPrompt`, parsed with the existing
      `parseJsonCandidate` helper that already tolerates messy/fenced
      LLM JSON output). Reuses the target's judge provider if
      configured, otherwise falls back to its first eval provider —
      no new provider-config surface needed. New preview-only route
      `POST /api/targets/:id/stages/eval/generate-dataset`: generates
      and returns candidate test cases but does NOT persist them,
      mirroring real promptfoo's CLI (prints results, requires an
      explicit `--write` to apply) — the existing eval-config PATCH
      route already handles actually saving them once the user adds
      the preview to their editor and clicks Save.
    - Frontend: new "Generate test cases" section in the Eval
      workspace (personas count, cases-per-persona count, optional
      free-text instructions, a preview list, "Add all to test cases"
      / "Discard"). Generated cases carry a `tags: ['ai-generated']`
      marker and `metadata.persona` so they're identifiable later.
    - Verified live end to end, not code-review-only: (1) called the
      new route directly against the real E2E Groq target and got back
      4 genuinely distinct, on-topic generated test cases from 2 real
      personas in ~1.3s; (2) drove the actual UI in a real browser —
      logged in, opened the real Eval workspace, clicked the real
      "Generate preview" button (a real DOM click, not a direct API
      call), confirmed 6 diverse generated cases rendered in the
      preview (3 personas × 2 cases/persona, the component's default),
      clicked the real "Add all to test cases" button, confirmed all 6
      appeared in the test-case editor's live React state; (3) since
      this is a preview-only feature, confirmed via a fresh GET that
      the target's actually-stored config was untouched throughout
      (still just the original single "Baseline utility test") — no
      restore needed because nothing was ever persisted.
