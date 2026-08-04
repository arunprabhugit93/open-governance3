// Lineage capability — additive HTTP client for the forked, self-hosted Langfuse deployment
// (see langfuse-source/PROVENANCE.md and docker-compose.langfuse.yml). This module never
// replaces or blocks any existing handler: every emit function is fire-and-forget from the
// caller's perspective (the network POST is never awaited by the operation it's instrumenting),
// and a Langfuse outage degrades to "no lineage recorded, warning logged once" — never a broken
// request. Lineage is a capability, not a hard dependency for the assurance workflow to run.
//
// Uses Langfuse's documented (if now-deprecated-in-favor-of-OTel) JSON batch ingestion endpoint
// (POST /api/public/ingestion) rather than implementing the OTLP/protobuf path — same event
// vocabulary and data model, far simpler to emit from plain Node without a new dependency. See
// langfuse-source/fern/apis/server/definition/ingestion.yml for the schema this follows.
//
// Data model mapping used throughout this product:
//   - One Langfuse trace per target lifecycle event that is NOT part of a stage run (onboarding,
//     provider-config update, dataset save/activate, prompt/template update, schedule execution,
//     evidence export) and one trace per stage run (eval/red-team/model-audit/cyberseceval).
//   - Every trace carries `sessionId: target.id` — Langfuse's native session-grouping concept,
//     used here (not invented) so "all traces with sessionId = target.id" already IS this
//     target's full lineage history, queryable via Langfuse's own sessions API.
//   - Provider calls (inference) emit as GENERATION observations on the enclosing run's trace.
//   - RAG retrieval steps emit as RETRIEVER observations; agent tool calls as TOOL observations —
//     Langfuse's own native observation subtypes, not something this product invented.

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const ENVIRONMENT = 'open-governance3';
const INGESTION_TIMEOUT_MS = 5000;

// Propagates "which trace/target is this provider call part of" through the many layers of
// async execution between a stage run's entry point and callProviderAdapter's ~15+ call sites,
// with ZERO changes needed at any of those intermediate call sites — the alternative (threading
// an explicit lineage param through every provider-call site) would touch far more code for the
// same effect. A missing context (calls made outside runWithLineageContext, or Langfuse simply
// not configured) is always handled gracefully — see callers of getLineageContext().
const lineageALS = new AsyncLocalStorage();

function runWithLineageContext(context, fn) {
  return lineageALS.run(context, fn);
}

function getLineageContext() {
  return lineageALS.getStore() || null;
}

function lineageConfig() {
  const baseUrl = process.env.LANGFUSE_BASE_URL;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!baseUrl || !publicKey || !secretKey) return null;
  return { baseUrl: String(baseUrl).replace(/\/$/, ''), publicKey, secretKey };
}

function isLineageConfigured() {
  return Boolean(lineageConfig());
}

function newId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

let warnedUnreachable = false;

async function postIngestionBatch(events) {
  const cfg = lineageConfig();
  if (!cfg) return { sent: false, reason: 'not-configured' };
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
  try {
    const res = await fetch(`${cfg.baseUrl}/api/public/ingestion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ batch: events }),
      signal: AbortSignal.timeout(INGESTION_TIMEOUT_MS),
    });
    // Langfuse's batch endpoint returns 207 (multi-status) on partial success by design —
    // only a non-2xx/207 status or a thrown network error counts as "Langfuse unreachable".
    if (!res.ok && res.status !== 207) {
      throw new Error(`HTTP ${res.status}`);
    }
    warnedUnreachable = false;
    return { sent: true };
  } catch (error) {
    if (!warnedUnreachable) {
      console.warn(
        `[lineage] Langfuse unreachable or rejected an event — lineage emission skipped, ` +
          `the operation itself is unaffected (further warnings suppressed until it recovers): ${error.message}`,
      );
      warnedUnreachable = true;
    }
    return { sent: false, reason: error.message };
  }
}

const QUERY_TIMEOUT_MS = 10000;

async function langfuseGet(path) {
  const cfg = lineageConfig();
  if (!cfg) return { ok: false, reason: 'not-configured' };
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (res.status === 404) return { ok: true, notFound: true };
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

// Uses Langfuse's (deprecated-but-functional, same pragmatic choice as the ingestion endpoint —
// see module header) GET /sessions/{sessionId} to fetch every trace whose sessionId is this
// target's id in one call — the lineage query endpoint's entry point for "everything ever
// recorded about this target".
async function fetchSessionTraces(targetId) {
  const result = await langfuseGet(`/api/public/sessions/${encodeURIComponent(targetId)}`);
  if (!result.ok) return { ok: false, reason: result.reason, traces: [] };
  if (result.notFound) return { ok: true, traces: [] };
  return { ok: true, traces: result.data?.traces || [] };
}

// GET /traces/{traceId} — full observation + score detail for one trace (the session-traces
// call above only returns trace headers, not their nested observations).
async function fetchTraceDetail(traceId) {
  const result = await langfuseGet(`/api/public/traces/${encodeURIComponent(traceId)}`);
  if (!result.ok || result.notFound) return null;
  return result.data || null;
}

// Never awaited by instrumentation call sites — see module header. Swallows its own promise
// rejection (postIngestionBatch already never throws, this is defense in depth).
function fireAndForget(events) {
  if (!isLineageConfigured()) return;
  postIngestionBatch(events).catch(() => {});
}

function emitTrace({ id, name, sessionId, userId, input, output, metadata, tags } = {}) {
  const traceId = id || newId();
  fireAndForget([
    {
      id: newId(),
      timestamp: nowIso(),
      type: 'trace-create',
      body: {
        id: traceId,
        timestamp: nowIso(),
        name,
        sessionId,
        userId,
        input,
        output,
        metadata,
        tags,
        environment: ENVIRONMENT,
      },
    },
  ]);
  return traceId;
}

const OBSERVATION_CREATE_EVENT_TYPE = {
  SPAN: 'span-create',
  GENERATION: 'generation-create',
  RETRIEVER: 'retriever-create',
  AGENT: 'agent-create',
  TOOL: 'tool-create',
};

// Only SPAN and GENERATION have a matching "-update" event type upstream (see
// packages/shared/src/server/ingestion/types.ts's eventTypes) — RETRIEVER/AGENT/TOOL are
// create-only, which is fine here since this product only two-phases (create-at-start,
// update-at-end) long-running stage runs (always SPAN); everything else (provider calls,
// retrieval, tool calls) is emitted once, already-complete, after the real operation finishes.
const OBSERVATION_UPDATE_EVENT_TYPE = {
  SPAN: 'span-update',
  GENERATION: 'generation-update',
};

function emitObservation({
  type = 'SPAN',
  id,
  traceId,
  parentObservationId,
  name,
  startTime,
  endTime,
  input,
  output,
  metadata,
  model,
  modelParameters,
  usage,
  level,
  statusMessage,
} = {}) {
  const observationId = id || newId();
  const eventType = OBSERVATION_CREATE_EVENT_TYPE[type] || OBSERVATION_CREATE_EVENT_TYPE.SPAN;
  fireAndForget([
    {
      id: newId(),
      timestamp: nowIso(),
      type: eventType,
      body: {
        id: observationId,
        traceId,
        parentObservationId,
        name,
        startTime: startTime || nowIso(),
        endTime,
        input,
        output,
        metadata,
        model,
        modelParameters,
        usage,
        level,
        statusMessage,
        environment: ENVIRONMENT,
      },
    },
  ]);
  return observationId;
}

function updateObservation({ type = 'SPAN', id, traceId, endTime, output, metadata, usage, level, statusMessage } = {}) {
  const eventType = OBSERVATION_UPDATE_EVENT_TYPE[type];
  if (!eventType || !id) return;
  fireAndForget([
    {
      id: newId(),
      timestamp: nowIso(),
      type: eventType,
      body: {
        id,
        traceId,
        endTime: endTime || nowIso(),
        output,
        metadata,
        usage,
        level,
        statusMessage,
        environment: ENVIRONMENT,
      },
    },
  ]);
}

function emitScore({ traceId, observationId, name, value, dataType, comment, metadata } = {}) {
  if (!traceId || !name || value === undefined || value === null) return;
  fireAndForget([
    {
      id: newId(),
      timestamp: nowIso(),
      type: 'score-create',
      body: {
        id: newId(),
        traceId,
        observationId,
        name,
        value,
        dataType,
        comment,
        metadata,
        environment: ENVIRONMENT,
      },
    },
  ]);
}

// Normalizes this product's provider-adapter token-usage shape (raw OpenAI-style
// snake_case `{prompt_tokens, completion_tokens, total_tokens}`, or already-camelCase from a
// couple of adapters) into Langfuse's IngestionUsage schema. Returns undefined (not null/{}) for
// missing/empty usage so the observation body omits the field entirely rather than asserting a
// zero-token call that didn't actually report usage.
function toLangfuseUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== 'object') return undefined;
  const promptTokens = tokenUsage.promptTokens ?? tokenUsage.prompt_tokens;
  const completionTokens = tokenUsage.completionTokens ?? tokenUsage.completion_tokens;
  const totalTokens = tokenUsage.totalTokens ?? tokenUsage.total_tokens;
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return { promptTokens, completionTokens, totalTokens };
}

// TrainingProvenance facet — real, stable vendor-documentation roots only (never fabricated
// model-card content, never a claim of independently verified training data). Matches
// model-audit's "not evaluated, never faked" precedent: every entry states plainly that this
// product has not fetched or independently verified the vendor's actual training claims, only
// that it knows who the vendor is from the target's own provider selection.
const VENDOR_MODEL_CARD_ROOTS = {
  openai: 'https://platform.openai.com/docs/models',
  'azure-openai': 'https://learn.microsoft.com/azure/ai-services/openai/concepts/models',
  anthropic: 'https://docs.claude.com/en/docs/about-claude/models/overview',
  gemini: 'https://ai.google.dev/gemini-api/docs/models',
  cohere: 'https://docs.cohere.com/docs/models',
  bedrock: 'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html',
  vertex: 'https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models',
};

// Self-hosted/open-weights provider keys — TrainingProvenance here can only ever be
// operator-provided (whoever stood up this deployment vouching for what they loaded), since
// there is no vendor to attest anything; this product never claims otherwise.
const SELF_HOSTED_PROVIDER_KEYS = new Set(['ollama', 'vllm', 'lm-studio', 'huggingface', 'custom-script', 'cli-provider']);

// Builds the TrainingProvenance facet for a target at creation time. `operatorSupplied` is
// whatever the onboarding user optionally put in metadata.trainingProvenance (e.g. a real
// HuggingFace card URL or fine-tuning dataset reference for a self-hosted model) — when present,
// it wins and is recorded as attested (unattested: false). Never fetches anything over the
// network; target onboarding stays fast and works offline.
function buildTrainingProvenance(providerKey, operatorSupplied) {
  if (operatorSupplied && typeof operatorSupplied === 'object' && (operatorSupplied.cardUrl || operatorSupplied.datasetRefs)) {
    return {
      attestationSource: operatorSupplied.attestationSource || 'operator-provided',
      cardUrl: operatorSupplied.cardUrl || null,
      datasetRefs: operatorSupplied.datasetRefs || null,
      unattested: false,
      note: operatorSupplied.note || 'Provided by the operator who onboarded this target; not independently verified by this product.',
    };
  }
  const key = String(providerKey || '').toLowerCase();
  if (SELF_HOSTED_PROVIDER_KEYS.has(key)) {
    return {
      attestationSource: 'operator-provided',
      cardUrl: null,
      datasetRefs: null,
      unattested: true,
      note: 'Self-hosted/open-weights target — no HuggingFace card or fine-tuning dataset reference was supplied at onboarding. Training provenance is an honest gap, not silently omitted.',
    };
  }
  const cardRoot = VENDOR_MODEL_CARD_ROOTS[key];
  return {
    attestationSource: 'vendor-published',
    cardUrl: cardRoot || null,
    datasetRefs: null,
    unattested: true,
    note: cardRoot
      ? `Vendor identified from provider selection (${key}); this product has not fetched or parsed ${cardRoot} for this specific model version — no training-data claim is independently verified.`
      : `Provider "${providerKey || 'unknown'}" has no known published model-card root in this deployment's reference table — training provenance is an honest gap.`,
  };
}

module.exports = {
  isLineageConfigured,
  newId,
  nowIso,
  runWithLineageContext,
  getLineageContext,
  toLangfuseUsage,
  buildTrainingProvenance,
  emitTrace,
  emitObservation,
  updateObservation,
  emitScore,
  fetchSessionTraces,
  fetchTraceDetail,
};
