# Langfuse fork provenance

Forked from the upstream Langfuse monorepo, following the same vendoring
discipline as `promptfoo-source/` — this is code this product owns and can
modify, not a runtime dependency on a company's hosted service.

- Source repo: https://github.com/langfuse/langfuse
- Source commit: `9ea1d895a71ac6954caf496235cefe4dfe23b39e` (main, 2026-08-04)
- Fetched: 2026-08-04, via `git clone --depth 1` at the commit above — a
  one-time developer-side vendoring action, not a runtime dependency.
- License: **dual-licensed**, preserved exactly as upstream structures it —
  see `LICENSE` at this directory's root. Everything **outside**
  `ee/`, `web/src/ee/`, `worker/src/ee/`, and `packages/shared/src/server/ee/`
  is **MIT**. Those four `ee/` directories are licensed under
  `ee/LICENSE` (Langfuse's separate Enterprise License), not MIT.

## Why `ee/` is present at all (open-core, not walled off)

The first vendoring pass tried excluding `ee/` entirely on the assumption
that only MIT-licensed code should ship. That broke the build: dozens of
core (non-`ee/`) files — `getPlan.ts`, `AuthenticatedLayout.tsx`,
`organizationRouter.ts`, `membersRouter.ts`, admin API routes, and more —
statically `import` from `ee/` modules. Langfuse is architected as
**open-core**: the full source tree (including `ee/`) is required to
compile, and Enterprise features are gated at **runtime** by checking
`LANGFUSE_EE_LICENSE_KEY`, not by the source being physically absent. This
is exactly how Langfuse's own official self-hosting guide works — the OSS
self-hosted deployment builds from this same full source tree and simply
never sets a license key.

This deployment follows the identical posture:
- `ee/`, `web/src/ee/`, `worker/src/ee/`, `packages/shared/src/server/ee/`
  are vendored **verbatim, unmodified** (their separate license terms
  apply to that code, same as upstream) purely so the TypeScript build
  resolves — not because this product has purchased or intends to use any
  Enterprise feature.
- `LANGFUSE_EE_LICENSE_KEY` is **never set** anywhere in this product's
  deployment config. Verified in code
  (`web/src/features/entitlements/server/getPlan.ts`,
  `getSelfHostedInstancePlanServerSide()`): an unset key resolves the plan
  to `"oss"` via a pure local string-prefix check — no network call to any
  license server exists in the non-`ee/` code path at all.
- Every Enterprise-gated feature (SSO beyond the OSS default, custom RBAC
  roles, billing/Stripe, audit logs, data retention policies, etc.) stays
  inert. This product does not use, expose, or route to any of it.

## Zero external hosted-service calls — verified, not assumed

- **Telemetry**: `TELEMETRY_ENABLED=false` is a first-class, already-shipped
  upstream env var (`web/src/features/telemetry/index.ts`,
  `web/src/features/posthog-analytics/ServerPosthog.ts`) that fully
  short-circuits the periodic PostHog telemetry cron job. Set unconditionally
  in this product's deployment config (see `docker-compose.langfuse.yml`).
- **License server**: none exists in the non-`ee/` path (see above) —
  nothing to disable because there was nothing phoning home to begin with.
- **Sentry error reporting**: opt-in via `NEXT_PUBLIC_SENTRY_DSN`
  (`web/instrumentation-client.ts`) — an unset DSN makes the Sentry SDK a
  documented no-op (initializes with no transport, sends nothing). This
  deployment never sets that env var.
- **Content-Security-Policy** (`web/next.config.mjs`): **patched** at fork
  time. Upstream's CSP allowlisted `*.langfuse.com`, `*.langfuse.dev`,
  `*.posthog.com`, `*.sentry.io`, `*.stripe.com`, Cloudflare, and
  Microsoft-login hosts — all Langfuse-cloud/SaaS-vendor surfaces (cloud
  auth, cloud billing, cloud telemetry, cloud support chat) this self-hosted
  fork never uses. Stripped to `'self'` plus only the locally-configured
  self-hosted media-upload endpoint, so even direct access to this
  internal-only service (which this product's UI never links to — see the
  integration doc) cannot reach an external host from the browser.
- **Turborepo build-time telemetry**: `NEXT_TELEMETRY_DISABLED=1` was already present in both
  Dockerfiles upstream (Next.js's own build telemetry). Found and **patched** at fork time:
  Turborepo itself (the monorepo build orchestrator, Vercel-owned, separate from both Next.js
  and Langfuse) has its own anonymous build-time telemetry ping, not gated by any existing env
  var. Added `TURBO_TELEMETRY_DISABLED=1` to `web/Dockerfile` and `worker/Dockerfile`. This is
  build-time-only — it never runs in the deployed container, so it never affects a running
  self-hosted instance — but disabled anyway for the same posture the rest of this document
  holds to.
- **Stripe/billing, Plain support chat, Microsoft SSO**: all gated behind
  `ee/` and/or unset env vars (`NEXT_PUBLIC_LANGFUSE_CLOUD_REGION`,
  Stripe keys, Plain chat keys) that this deployment never sets. Inert by
  absence of configuration, same convention as telemetry/Sentry above.

## Bug found and fixed while first booting this deployment

The Windows git checkout that vendored this source converted every `*.sh`
file's line endings to CRLF (a well-known Windows-git default-config
behavior). That silently broke `web/entrypoint.sh` and
`worker/entrypoint.sh` inside the built Docker images — the shebang line
became `#!/bin/sh\r`, which the kernel can't resolve, so both containers
crash-looped with `./web/entrypoint.sh: No such file or directory` on
every start. Fixed at the source: stripped CRLF from all 19 `.sh` files
in this vendored tree, and added `.gitattributes` (`*.sh text eol=lf`)
so a future re-checkout on Windows can't reintroduce it. Root-caused and
fixed before moving on, not worked around with a one-off `sed` in the
Dockerfile.

Second bug, found the same way (live ingestion smoke test after both
containers finally came up healthy): this Langfuse version (4.3.1)
defaults `LANGFUSE_MIGRATION_V4_WRITE_MODE=events_only`, under which the
batch ingestion endpoint rejects `trace-create`/`span-create`/
`generation-create`/etc. outright (`"Event type not accepted... this
endpoint only accepts score and log events"`) — v4's target state routes
those event types through the OTel endpoint instead. Since this is a
self-hosted deployment this product fully owns, not upstream's hosted
service, `docker-compose.langfuse.yml` sets
`LANGFUSE_MIGRATION_V4_WRITE_MODE=legacy` (a real, still-supported,
still-validated enum value — not a hack) so every event type
`app/shared/lineage.cjs` emits is accepted, and paired it with the
required `LANGFUSE_MIGRATION_V4_NATIVE_OTEL_BEHAVIOUR=dual_write` (worker
startup hard-errors on `legacy` + the default `direct` OTel behavior,
since `direct` targets a ClickHouse table `legacy` mode doesn't read).

## What this integration actually uses

Only Langfuse's **core tracing/observability data model and ingestion +
query API** — traces, observations, generations, scores, prompt versions,
and datasets — used purely as a **self-hosted lineage backing store** for
`open-governance3`'s own lineage feature. Langfuse's own web UI (`web/`) is
built and run only because it's architecturally inseparable from the
ingestion/query API in this Langfuse version (same Next.js app serves both
the UI pages and the `/api/public/*` REST API); this product's own UI never
links to it. See `../HANDOVER.md` and `../EVIDENCE.md` for exactly which
Langfuse surfaces are wired in and which are deliberately not (Langfuse's
evaluation harness, prompt-authoring UI, and dashboards — this product has
its own).
