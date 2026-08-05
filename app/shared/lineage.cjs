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
  // Only the comments API requires projectId as an explicit input field (everything else
  // resolves the project from the API key pair itself) — matches
  // docker-compose.langfuse.yml's LANGFUSE_INIT_PROJECT_ID, the fixed project this deployment's
  // API key pair was auto-provisioned into.
  const projectId = process.env.LANGFUSE_PROJECT_ID || 'og3-lineage';
  return { baseUrl: String(baseUrl).replace(/\/$/, ''), publicKey, secretKey, projectId };
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

async function langfuseRequest(method, path, body) {
  const cfg = lineageConfig();
  if (!cfg) return { ok: false, reason: 'not-configured' };
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString('base64');
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

// Real governance rubrics — human-reviewable, auditable structured scoring, distinct from the
// automated pass/fail/error counts every stage run already threads through AssuranceEvidence.
// These are Langfuse "score configs" (reusable rubric definitions), created once and reused —
// see ensureGovernanceScoreConfigs() below, called lazily so a fresh Langfuse project doesn't
// need a separate seed step.
const GOVERNANCE_SCORE_CONFIGS = [
  {
    name: 'compliance-review',
    dataType: 'CATEGORICAL',
    categories: [
      { label: 'Approved', value: 1 },
      { label: 'Rejected', value: 0 },
      { label: 'Needs More Review', value: 2 },
    ],
    description: 'Human governance reviewer sign-off on this finding/run — distinct from automated pass/fail.',
  },
  {
    name: 'risk-rating',
    dataType: 'CATEGORICAL',
    categories: [
      { label: 'Low', value: 0 },
      { label: 'Medium', value: 1 },
      { label: 'High', value: 2 },
    ],
    description: 'Human-assessed risk rating for this finding/run.',
  },
];

let scoreConfigCache = null;

// Idempotent: fetches existing score configs and only creates the ones missing by name, so this
// is safe to call on every request that needs the config list (cached in-process afterward).
async function ensureGovernanceScoreConfigs() {
  if (scoreConfigCache) return scoreConfigCache;
  const existing = await langfuseRequest('GET', '/api/public/score-configs?limit=100');
  if (!existing.ok) return null;
  const byName = new Map((existing.data?.data || []).filter((c) => !c.isArchived).map((c) => [c.name, c]));
  for (const wanted of GOVERNANCE_SCORE_CONFIGS) {
    if (byName.has(wanted.name)) continue;
    const created = await langfuseRequest('POST', '/api/public/score-configs', wanted);
    if (created.ok) byName.set(wanted.name, created.data);
  }
  scoreConfigCache = Array.from(byName.values()).filter((c) => GOVERNANCE_SCORE_CONFIGS.some((w) => w.name === c.name));
  return scoreConfigCache;
}

// Submits a human governance score against a real score config (categorical value resolved from
// the config's own categories, so an invalid label is rejected before it ever reaches Langfuse).
async function emitGovernanceScore({ traceId, observationId, configName, label, comment, authorUserId }) {
  const configs = await ensureGovernanceScoreConfigs();
  if (!configs) return { ok: false, reason: 'score configs unavailable' };
  const config = configs.find((c) => c.name === configName);
  if (!config) return { ok: false, reason: `unknown score config "${configName}"` };
  const category = (config.categories || []).find((c) => c.label === label);
  if (!category) return { ok: false, reason: `unknown category "${label}" for "${configName}"` };
  // The public /scores create endpoint doesn't accept authorUserId as an input field (that's
  // only settable via annotation-queue-created scores tied to a real logged-in Langfuse user,
  // which doesn't apply here — this deployment authenticates via API key). Folded into the
  // comment instead so the reviewer's identity is still genuinely recorded, not silently lost.
  const attributedComment = authorUserId ? `[reviewer: ${authorUserId}]${comment ? ` ${comment}` : ''}` : comment;
  // CreateScoreValue: categorical/text scores take the string label, not the config's numeric
  // value — numeric-only for BOOLEAN/NUMERIC dataTypes (see commons.yml's CreateScoreValue docs
  // and the ScoreBody examples, which pass value: "partially correct" for a CATEGORICAL score).
  const result = await langfuseRequest('POST', '/api/public/scores', {
    traceId,
    observationId,
    name: configName,
    value: category.label,
    dataType: 'CATEGORICAL',
    configId: config.id,
    comment: attributedComment,
    environment: ENVIRONMENT,
  });
  if (!result.ok) return result;
  return { ok: true, score: result.data };
}

const REVIEW_QUEUE_NAME = 'governance-review';

let reviewQueueCache = null;

// Idempotent create-or-get for the single shared "governance-review" annotation queue, linked to
// the same real score configs emitGovernanceScore uses — so a human reviewer working this queue
// (in Langfuse's own UI, if they ever go look, though this product's own Lineage tab is the
// intended surface) sees the same rubrics this product's scoring form offers.
async function ensureReviewQueue() {
  if (reviewQueueCache) return reviewQueueCache;
  const configs = await ensureGovernanceScoreConfigs();
  const existing = await langfuseRequest('GET', '/api/public/annotation-queues?limit=100');
  if (!existing.ok) return null;
  const found = (existing.data?.data || []).find((q) => q.name === REVIEW_QUEUE_NAME);
  if (found) {
    reviewQueueCache = found;
    return found;
  }
  const created = await langfuseRequest('POST', '/api/public/annotation-queues', {
    name: REVIEW_QUEUE_NAME,
    description: 'Findings/runs flagged for human governance review — sign off with a real compliance-review/risk-rating score.',
    scoreConfigIds: (configs || []).map((c) => c.id),
  });
  if (!created.ok) return null;
  reviewQueueCache = created.data;
  return created.data;
}

// Flags a trace for human review — adds it to the shared queue as a PENDING item. Idempotent in
// spirit (Langfuse doesn't reject a duplicate objectId, but the list endpoint below dedupes by
// objectId so flagging the same trace twice doesn't show as two rows).
async function addToReviewQueue(traceId) {
  const queue = await ensureReviewQueue();
  if (!queue) return { ok: false, reason: 'review queue unavailable' };
  const result = await langfuseRequest('POST', `/api/public/annotation-queues/${encodeURIComponent(queue.id)}/items`, {
    objectId: traceId,
    objectType: 'TRACE',
  });
  if (!result.ok) return result;
  return { ok: true, item: result.data };
}

// Lists every review-queue item, most-recent first — callers filter to the trace ids relevant to
// their target (this queue is shared across the whole project, matching Langfuse's own project-
// scoped queue model, same as sessions/traces already are).
async function listReviewQueueItems() {
  const queue = await ensureReviewQueue();
  if (!queue) return { ok: false, reason: 'review queue unavailable', items: [] };
  const result = await langfuseRequest('GET', `/api/public/annotation-queues/${encodeURIComponent(queue.id)}/items?limit=100`);
  if (!result.ok) return { ok: false, reason: result.reason, items: [] };
  return { ok: true, queueId: queue.id, items: result.data?.data || [] };
}

async function markReviewQueueItemComplete(itemId) {
  const queue = await ensureReviewQueue();
  if (!queue) return { ok: false, reason: 'review queue unavailable' };
  const result = await langfuseRequest('PATCH', `/api/public/annotation-queues/${encodeURIComponent(queue.id)}/items/${encodeURIComponent(itemId)}`, {
    status: 'COMPLETED',
  });
  if (!result.ok) return result;
  return { ok: true, item: result.data };
}

// Audit-trail comments — unlike scores (fixed rubric, single value) these are free-text
// collaboration notes attached to a trace, e.g. "escalated to legal, see ticket #4521" or
// "confirmed with the model vendor this is expected behavior". authorUserId IS a real settable
// input field on this endpoint (unlike /scores), so the reviewer's identity is genuinely
// recorded, not folded into the text.
async function addComment({ objectId, objectType = 'TRACE', content, authorUserId }) {
  const cfg = lineageConfig();
  if (!cfg) return { ok: false, reason: 'not-configured' };
  if (!content || !content.trim()) return { ok: false, reason: 'comment content is required' };
  const result = await langfuseRequest('POST', '/api/public/comments', {
    projectId: cfg.projectId,
    objectType,
    objectId,
    content: content.slice(0, 5000),
    authorUserId,
  });
  if (!result.ok) return result;
  return { ok: true, comment: result.data };
}

// Lists comments for a specific object (trace or observation) — Langfuse requires objectType
// whenever objectId is provided, so this always sends both.
async function listComments({ objectId, objectType = 'TRACE' }) {
  const result = await langfuseRequest(
    'GET',
    `/api/public/comments?objectType=${encodeURIComponent(objectType)}&objectId=${encodeURIComponent(objectId)}&limit=100`,
  );
  if (!result.ok) return { ok: false, reason: result.reason, comments: [] };
  return { ok: true, comments: result.data?.data || [] };
}

// Real Langfuse Prompt objects as the backing store for prompt-version lineage — per this
// capability's original scope ("use Langfuse's prompt versioning as backing storage... do not
// surface Langfuse's authoring UI"). Each target gets one stably-named text prompt
// (`og3-target-<id>`); POSTing to the same name creates a new version automatically (Langfuse's
// own versioning, not this product inventing one) rather than the metadata-on-a-trace
// approximation this facet started with — kept as an addition, not a replacement, so existing
// recorded history stays intact.
function targetPromptName(targetId) {
  return `og3-target-${targetId}`;
}

async function upsertPromptVersion(targetId, promptText, commitMessage) {
  const result = await langfuseRequest('POST', '/api/public/v2/prompts', {
    name: targetPromptName(targetId),
    prompt: promptText,
    type: 'text',
    labels: ['production'],
    commitMessage: commitMessage || undefined,
  });
  if (!result.ok) return result;
  return { ok: true, prompt: result.data };
}

// Lists real version metadata (version numbers, labels, tags, last-updated) for this target's
// prompt — the list endpoint doesn't return each version's full text (that needs one GET per
// version), so this is the version *history*, not a diff view; still real Langfuse-native
// version numbers, not a synthetic count.
async function listPromptVersionHistory(targetId) {
  const result = await langfuseRequest('GET', `/api/public/v2/prompts?name=${encodeURIComponent(targetPromptName(targetId))}&limit=50`);
  if (!result.ok) return { ok: false, reason: result.reason, versions: [] };
  const entries = result.data?.data || [];
  const meta = entries[0];
  if (!meta) return { ok: true, versions: [] };
  return { ok: true, name: meta.name, versions: meta.versions || [], labels: meta.labels || [], lastUpdatedAt: meta.lastUpdatedAt };
}

// Closes an honest gap surfaced by the cost/usage facet: a self-hosted model (Ollama, vLLM, ...)
// has no vendor-published $ price, so aggregated cost reads `null` — correct, not a bug, but not
// actionable for real budget governance either. This lets an operator register their OWN cost
// estimate (e.g. amortized compute/hosting cost per token) via Langfuse's real Models API
// (matchPattern regex against generation.model, real pricing-tier mechanism — this product
// invents no pricing engine of its own). Always labeled operator-estimated, never presented as
// vendor-verified pricing — same attestation discipline as TrainingProvenance.
async function registerModelCostEstimate({ modelName, inputPricePerToken, outputPricePerToken }) {
  if (!modelName) return { ok: false, reason: 'modelName is required' };
  const hasInput = Number.isFinite(inputPricePerToken);
  const hasOutput = Number.isFinite(outputPricePerToken);
  if (!hasInput && !hasOutput) return { ok: false, reason: 'at least one of inputPricePerToken/outputPricePerToken is required' };
  // Exact-match regex (not a loose substring) so this never accidentally re-prices an unrelated
  // model whose name happens to contain this one as a substring.
  const matchPattern = `(?i)^${modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
  const result = await langfuseRequest('POST', '/api/public/models', {
    modelName,
    matchPattern,
    unit: 'TOKENS',
    ...(hasInput ? { inputPrice: inputPricePerToken } : {}),
    ...(hasOutput ? { outputPrice: outputPricePerToken } : {}),
  });
  if (!result.ok) return result;
  modelCostCache = null;
  return { ok: true, model: result.data };
}

let modelCostCache = null;

// Langfuse's built-in vendor model catalog is large (175+ entries as of this writing) and the
// list endpoint caps `limit` at 100 (verified live — `limit=1000` is rejected with a 400), so a
// single page silently missed any custom entry sorted past page 1. Paginates through every page
// (capped at 20 as a sanity bound, not because 20 is expected) and caches for the process
// lifetime — invalidated by registerModelCostEstimate() below so a newly-set price is visible
// immediately, not just after a restart.
async function listModelCostEstimates() {
  if (modelCostCache) return modelCostCache;
  const models = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await langfuseRequest('GET', `/api/public/models?limit=100&page=${page}`);
    if (!result.ok) return { ok: false, reason: result.reason, models: [] };
    const data = result.data?.data || [];
    models.push(...data);
    if (page >= (result.data?.meta?.totalPages || 1)) break;
  }
  modelCostCache = { ok: true, models };
  return modelCostCache;
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
  GOVERNANCE_SCORE_CONFIGS,
  ensureGovernanceScoreConfigs,
  emitGovernanceScore,
  ensureReviewQueue,
  addToReviewQueue,
  listReviewQueueItems,
  markReviewQueueItemComplete,
  addComment,
  listComments,
  targetPromptName,
  upsertPromptVersion,
  listPromptVersionHistory,
  registerModelCostEstimate,
  listModelCostEstimates,
};
