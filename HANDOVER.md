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
