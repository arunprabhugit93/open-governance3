import type {
  CatalogResponse,
  EvalRun,
  OnboardedTarget,
  ProviderTestResult,
  ProviderCatalogGroup,
  RedTeamPlan,
  RunComparison,
  RunTraceRow,
  TargetExportPayload,
  TargetDataset,
  TargetReport,
  TargetSchedule,
  WorkflowCatalogResponse,
  TargetDetailResponse,
  User,
} from './types';

export class ApiError extends Error {}

export interface Session {
  token: string;
  user: User;
}

// `assert-set` is promptfoo's weighted nested-assertion group: `assert` holds the flat
// sub-assertions (each with an optional `weight`), `threshold` is the minimum weighted
// average score to pass. Only one level of nesting is supported in this editor — a
// sub-assertion can't itself be another assert-set from the UI (importing YAML still
// supports arbitrary nesting; this covers the overwhelmingly common single-level case).
export interface EvalAssertion {
  type: string;
  value: string;
  threshold?: number;
  weight?: number;
  assert?: Array<{ type: string; value: string; weight?: number }>;
}

export interface TargetPayload {
  displayName: string;
  targetType: string;
  ownerName: string;
  environment: string;
  endpointUrl: string;
  modelName: string;
  authStrategy: string;
  systemPrompt: string;
  metadata: {
    riskTier: string;
    provider: {
      kind: string;
      baseUrl: string;
      apiKey?: string;
      apiKeySecretId?: string;
      apiKeyMasked?: string;
      temperature: number;
      maxTokens: number;
    };
    judge?: {
      enabled?: boolean;
      providerKey?: string;
      adapter?: string;
      baseUrl?: string;
      model?: string;
      embeddingModel?: string;
      apiKey?: string;
      apiKeySecretId?: string;
      apiKeyMasked?: string;
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
    };
    eval: {
      promptTemplate: string;
      injectVar: string;
      testCases: Array<{
        name: string;
        input: string;
        assertion: string;
        expected: string;
      }>;
    };
    redteam: {
      purpose: string;
      plugins: string[];
      strategies: string[];
      numTests: number;
      entities: string[];
    };
    audit: {
      artifactPath: string;
      source: string;
      licensePolicy: string;
      sbomRequired: boolean;
      scanners: string[];
    };
    runtime: {
      tenant: string;
      dataClassification: string;
      allowedTools: string[];
      retrievalSources: string[];
    };
  };
}

export type TargetUpdatePayload = Partial<Omit<TargetPayload, 'metadata'>> & {
  status?: string;
  metadata?: {
    riskTier?: string;
    provider?: Partial<TargetPayload['metadata']['provider']>;
    judge?: Partial<NonNullable<TargetPayload['metadata']['judge']>>;
    eval?: Partial<TargetPayload['metadata']['eval']>;
    redteam?: Partial<TargetPayload['metadata']['redteam']>;
    audit?: Partial<TargetPayload['metadata']['audit']>;
    runtime?: Partial<TargetPayload['metadata']['runtime']>;
  };
};

export interface EvalStageConfigPayload {
  providers: Array<{
    providerKey: string;
    label: string;
    engine: string;
    baseUrl: string;
    model: string;
    apiKey?: string;
    apiKeyEnv?: string;
    apiKeySecretId?: string;
    apiKeyMasked?: string;
    apiVersion?: string;
    libraryConfig?: string;
    temperature: number;
    maxTokens: number;
  }>;
  prompts: Array<{
    name: string;
    content: string;
  }>;
  testCases: Array<{
    name: string;
    input: string;
    assertion: string;
    expected: string;
    assertions?: Array<EvalAssertion>;
    vars?: Record<string, string>;
    varsJson?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    transform?: string;
  }>;
  promptTemplate: string;
  injectVar: string;
  runOptions: {
    engineMode?: 'direct' | 'native';
    maxConcurrency: number;
    repeat: number;
    delayMs: number;
    cache: boolean;
    timeoutMs: number;
  };
  // promptfoo `afterEach` lifecycle hooks: `file:///path/to/hook.js[:afterEach]`, called after
  // each row's assertions are graded. Can add namedScores/metadata to the row; cannot override
  // pass/score (matches real promptfoo's own afterEach mutation contract).
  extensions?: string[];
  // promptfoo top-level `derivedMetrics`: named mathjs expressions evaluated against the run's
  // aggregate namedScores (e.g. { name: 'f1', value: '(2*precision*recall)/(precision+recall)' }).
  derivedMetrics?: Array<{ name: string; value: string }>;
}

export interface RedTeamStageConfigPayload {
  purpose: string;
  plugins: string[];
  strategies: string[];
  numTests: number;
  useRealGeneration?: boolean;
  maxCharsPerMessage?: number;
  language?: string[];
  runOptions?: {
    maxConcurrency: number;
    delayMs: number;
    timeoutMs: number;
    verbose: boolean;
  };
  defaultTest?: {
    vars: Record<string, string>;
    assert?: Array<{ type: string; value: string }>;
  };
  entities: string[];
  customProbes?: Array<{
    name: string;
    plugin: string;
    strategy: string;
    severity: string;
    prompt: string;
    expectedRefusalMarkers: string[];
  }>;
  dataClassification: string;
  allowedTools: string[];
  retrievalSources: string[];
}

export interface ModelAuditStageConfigPayload {
  artifactPath: string;
  source: string;
  licensePolicy: string;
  sbomRequired: boolean;
  scanners: string[];
  notes: string;
}

// A 401 on a request that *was* carrying a token means the session expired or was revoked
// server-side mid-use (session JWTs last 12h) — not a login failure, which is a 401 with no
// token at all. Every screen in the app calls through here or requestText, so handling it once
// centrally means a stale session redirects to sign-in instead of leaving every action on
// every page failing with the same confusing generic error until the user manually signs out.
function handleExpiredSession(token: string | null) {
  if (!token) return;
  localStorage.removeItem('og_token');
  localStorage.removeItem('og_user');
  window.dispatchEvent(new Event('og:session-expired'));
}

async function request<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) handleExpiredSession(token);
    throw new ApiError(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload as T;
}

async function requestText(path: string, token: string): Promise<string> {
  const response = await fetch(path, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) handleExpiredSession(token);
    try {
      const payload = JSON.parse(text);
      throw new ApiError(payload.error || `Request failed with HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(text || `Request failed with HTTP ${response.status}`);
    }
  }
  return text;
}

export function login(email: string, password: string): Promise<Session> {
  return request<Session>('/api/auth/login', null, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function logout(token: string): Promise<void> {
  return request<void>('/api/auth/logout', token, { method: 'POST' });
}

export function getCatalog(token: string): Promise<CatalogResponse> {
  return request<CatalogResponse>('/api/catalog', token);
}

export function getProviderCatalog(token: string): Promise<{ groups: ProviderCatalogGroup[] }> {
  return request<{ groups: ProviderCatalogGroup[] }>('/api/provider-catalog', token);
}

export function getWorkflowCatalog(token: string): Promise<WorkflowCatalogResponse> {
  return request<WorkflowCatalogResponse>('/api/workflow-catalog', token);
}

export function getTargets(token: string): Promise<{ targets: OnboardedTarget[] }> {
  return request<{ targets: OnboardedTarget[] }>('/api/targets', token);
}

export function createTarget(token: string, payload: TargetPayload): Promise<{ target: OnboardedTarget }> {
  return request<{ target: OnboardedTarget }>('/api/targets', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTarget(token: string, id: string, payload: TargetUpdatePayload): Promise<TargetDetailResponse> {
  return request<TargetDetailResponse>(`/api/targets/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteTarget(token: string, id: string): Promise<void> {
  return request<void>(`/api/targets/${id}`, token, { method: 'DELETE' });
}

export function getTargetDetail(token: string, id: string): Promise<TargetDetailResponse> {
  return request<TargetDetailResponse>(`/api/targets/${id}`, token);
}

export function prepareStage(
  token: string,
  id: string,
  stageKey: string,
): Promise<TargetDetailResponse> {
  return request<TargetDetailResponse>(`/api/targets/${id}/stages/${stageKey}/prepare`, token, {
    method: 'POST',
  });
}

export function saveEvalStageConfig(
  token: string,
  id: string,
  payload: EvalStageConfigPayload,
): Promise<TargetDetailResponse> {
  return request<TargetDetailResponse>(`/api/targets/${id}/stages/eval/config`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function importEvalStageConfig(
  token: string,
  id: string,
  payload: {
    configText?: string;
    format?: string;
    importedFrom?: string;
    engineConfig?: Record<string, unknown>;
    promptfooConfig?: Record<string, unknown>;
  },
): Promise<TargetDetailResponse> {
  return request<TargetDetailResponse>(`/api/targets/${id}/stages/eval/import`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function generateEvalDataset(
  token: string,
  id: string,
  payload: { numPersonas?: number; numTestCasesPerPersona?: number; instructions?: string },
): Promise<{ testCases: EvalStageConfigPayload['testCases'] }> {
  return request<{ testCases: EvalStageConfigPayload['testCases'] }>(`/api/targets/${id}/stages/eval/generate-dataset`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function generateEvalAssertions(
  token: string,
  id: string,
  payload: { numAssertions?: number; type?: 'llm-rubric' | 'g-eval'; instructions?: string },
): Promise<{ assertions: Array<{ type: string; value: string; label?: string }> }> {
  return request<{ assertions: Array<{ type: string; value: string; label?: string }> }>(
    `/api/targets/${id}/stages/eval/generate-assertions`,
    token,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export interface PromptOptimizationResult {
  baseline: { content: string; passRate: number; results: Array<{ name: string; pass: boolean; error: string | null; output: string }> };
  candidates: Array<{ label: string; content: string; passRate: number; results: Array<{ name: string; pass: boolean; error: string | null; output: string }> }>;
  best: { label: string; content: string; passRate: number };
}

export function optimizeEvalPrompt(
  token: string,
  id: string,
  payload: { promptIndex?: number; providerIndex?: number; maxTestCases?: number; numCandidates?: number; instructions?: string },
): Promise<PromptOptimizationResult> {
  return request<PromptOptimizationResult>(`/api/targets/${id}/stages/eval/optimize-prompt`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function listEvalRuns(token: string, id: string): Promise<{ runs: EvalRun[] }> {
  return request<{ runs: EvalRun[] }>(`/api/targets/${id}/stages/eval/runs`, token);
}

export function startEvalRun(
  token: string,
  id: string,
  runOptions: Record<string, unknown>,
): Promise<{ run: EvalRun; detail: TargetDetailResponse }> {
  return request<{ run: EvalRun; detail: TargetDetailResponse }>(`/api/targets/${id}/stages/eval/runs`, token, {
    method: 'POST',
    body: JSON.stringify(runOptions),
  });
}

export function startEvalRunAsync(
  token: string,
  id: string,
  runOptions: Record<string, unknown>,
): Promise<{ run: EvalRun; detail: TargetDetailResponse }> {
  return request<{ run: EvalRun; detail: TargetDetailResponse }>(`/api/targets/${id}/stages/eval/runs/async`, token, {
    method: 'POST',
    body: JSON.stringify(runOptions),
  });
}

export function testTargetProvider(
  token: string,
  id: string,
  providerIndex: number,
  payload: { prompt?: string; maxTokens?: number } = {},
): Promise<ProviderTestResult> {
  return request<ProviderTestResult>(`/api/targets/${id}/providers/${providerIndex}/test`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function saveStageConfig(
  token: string,
  id: string,
  stageKey: 'red_team' | 'model_audit',
  payload: RedTeamStageConfigPayload | ModelAuditStageConfigPayload,
): Promise<TargetDetailResponse> {
  return request<TargetDetailResponse>(`/api/targets/${id}/stages/${stageKey}/config`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function listStageRuns(
  token: string,
  id: string,
  stageKey: 'red_team' | 'model_audit',
): Promise<{ runs: EvalRun[] }> {
  return request<{ runs: EvalRun[] }>(`/api/targets/${id}/stages/${stageKey}/runs`, token);
}

export function getRedTeamPlan(token: string, id: string): Promise<RedTeamPlan> {
  return request<RedTeamPlan>(`/api/targets/${id}/stages/red_team/plan`, token);
}

export function startStageRun(
  token: string,
  id: string,
  stageKey: 'red_team' | 'model_audit',
  runOptions: Record<string, unknown>,
): Promise<{ run: EvalRun; detail: TargetDetailResponse }> {
  return request<{ run: EvalRun; detail: TargetDetailResponse }>(`/api/targets/${id}/stages/${stageKey}/runs`, token, {
    method: 'POST',
    body: JSON.stringify(runOptions),
  });
}

export function startStageRunAsync(
  token: string,
  id: string,
  stageKey: 'eval' | 'red_team' | 'model_audit',
  runOptions: Record<string, unknown>,
): Promise<{ run: EvalRun; detail: TargetDetailResponse }> {
  return request<{ run: EvalRun; detail: TargetDetailResponse }>(`/api/targets/${id}/stages/${stageKey}/runs/async`, token, {
    method: 'POST',
    body: JSON.stringify(runOptions),
  });
}

export function exportTarget(token: string, id: string): Promise<TargetExportPayload> {
  return request<TargetExportPayload>(`/api/targets/${id}/export`, token);
}

export function importTarget(token: string, payload: Record<string, unknown>): Promise<{ target: OnboardedTarget; detail: TargetDetailResponse }> {
  return request<{ target: OnboardedTarget; detail: TargetDetailResponse }>('/api/targets/import', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function exportTargetArtifact(token: string, id: string, format: 'yaml' | 'csv' | 'markdown' | 'html'): Promise<string> {
  return requestText(`/api/targets/${id}/export/${format}`, token);
}

export function listTargetRuns(
  token: string,
  id: string,
  filters: { stageKey?: string; status?: string; outcome?: string } = {},
): Promise<{ runs: EvalRun[] }> {
  const params = new URLSearchParams();
  if (filters.stageKey) params.set('stageKey', filters.stageKey);
  if (filters.status) params.set('status', filters.status);
  if (filters.outcome) params.set('outcome', filters.outcome);
  const query = params.toString();
  return request<{ runs: EvalRun[] }>(`/api/targets/${id}/runs${query ? `?${query}` : ''}`, token);
}

export function getTargetReport(token: string, id: string): Promise<TargetReport> {
  return request<TargetReport>(`/api/targets/${id}/report`, token);
}

export function compareRuns(
  token: string,
  id: string,
  left: string,
  right: string,
): Promise<RunComparison> {
  return request<RunComparison>(`/api/targets/${id}/runs/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`, token);
}

export function getRunDetail(
  token: string,
  id: string,
  runId: string,
): Promise<{ run: EvalRun; trace: RunTraceRow[] }> {
  return request<{ run: EvalRun; trace: RunTraceRow[] }>(`/api/targets/${id}/runs/${runId}`, token);
}

export function rerunTargetRun(
  token: string,
  id: string,
  runId: string,
  mode: 'all' | 'failures' | 'errors',
): Promise<{ run: EvalRun; detail: TargetDetailResponse }> {
  return request<{ run: EvalRun; detail: TargetDetailResponse }>(`/api/targets/${id}/runs/${runId}/rerun`, token, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export function cancelTargetRun(token: string, id: string, runId: string): Promise<{ run: EvalRun; detail: TargetDetailResponse }> {
  return request<{ run: EvalRun; detail: TargetDetailResponse }>(`/api/targets/${id}/runs/${runId}/cancel`, token, {
    method: 'POST',
  });
}

export function deleteTargetRun(token: string, id: string, runId: string): Promise<void> {
  return request<void>(`/api/targets/${id}/runs/${runId}`, token, { method: 'DELETE' });
}

export function listDatasets(token: string, id: string): Promise<{ datasets: TargetDataset[] }> {
  return request<{ datasets: TargetDataset[] }>(`/api/targets/${id}/datasets`, token);
}

export function createDataset(
  token: string,
  id: string,
  payload: { name: string; rows: EvalStageConfigPayload['testCases']; source?: string; active?: boolean },
): Promise<{ dataset: TargetDataset; detail: TargetDetailResponse }> {
  return request<{ dataset: TargetDataset; detail: TargetDetailResponse }>(`/api/targets/${id}/datasets`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function activateDataset(
  token: string,
  id: string,
  datasetId: string,
): Promise<{ dataset: TargetDataset; detail: TargetDetailResponse }> {
  return request<{ dataset: TargetDataset; detail: TargetDetailResponse }>(
    `/api/targets/${id}/datasets/${datasetId}/activate`,
    token,
    { method: 'POST' },
  );
}

export function deleteDataset(token: string, id: string, datasetId: string): Promise<void> {
  return request<void>(`/api/targets/${id}/datasets/${datasetId}`, token, { method: 'DELETE' });
}

export interface TargetSchedulePayload {
  name: string;
  stageKeys: Array<'eval' | 'red_team' | 'model_audit'>;
  intervalMinutes: number;
  enabled: boolean;
  runOptions?: Record<string, unknown>;
  notifyWebhookUrl?: string;
  notifyOn?: 'failure' | 'always';
  // Signs each webhook delivery's raw JSON body (`X-Signature: sha256=<hmac>`). Omit to keep
  // the existing secret unchanged (or auto-generate one server-side the first time a URL is
  // set); pass `rotateWebhookSecret: true` to force a fresh one.
  notifyWebhookSecret?: string;
  rotateWebhookSecret?: boolean;
}

export function listSchedules(token: string, id: string): Promise<{ schedules: TargetSchedule[] }> {
  return request<{ schedules: TargetSchedule[] }>(`/api/targets/${id}/schedules`, token);
}

export function createSchedule(
  token: string,
  id: string,
  payload: TargetSchedulePayload,
): Promise<{ schedule: TargetSchedule; notifyWebhookSecret: string | null }> {
  return request<{ schedule: TargetSchedule; notifyWebhookSecret: string | null }>(`/api/targets/${id}/schedules`, token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSchedule(
  token: string,
  id: string,
  scheduleId: string,
  payload: Partial<TargetSchedulePayload>,
): Promise<{ schedule: TargetSchedule; notifyWebhookSecret: string | null }> {
  return request<{ schedule: TargetSchedule; notifyWebhookSecret: string | null }>(`/api/targets/${id}/schedules/${scheduleId}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteSchedule(token: string, id: string, scheduleId: string): Promise<void> {
  return request<void>(`/api/targets/${id}/schedules/${scheduleId}`, token, { method: 'DELETE' });
}

export function runScheduleNow(
  token: string,
  id: string,
  scheduleId: string,
): Promise<{ schedule: TargetSchedule; runs: EvalRun[]; detail: TargetDetailResponse }> {
  return request<{ schedule: TargetSchedule; runs: EvalRun[]; detail: TargetDetailResponse }>(
    `/api/targets/${id}/schedules/${scheduleId}/run-now`,
    token,
    { method: 'POST' },
  );
}

export interface AppUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export function listUsers(token: string): Promise<{ users: AppUser[] }> {
  return request<{ users: AppUser[] }>('/api/users', token);
}

export function createUser(
  token: string,
  payload: { email: string; password: string; role: string },
): Promise<{ user: AppUser }> {
  return request<{ user: AppUser }>('/api/users', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateUser(
  token: string,
  id: string,
  payload: { password?: string; role?: string },
): Promise<{ user: AppUser }> {
  return request<{ user: AppUser }>(`/api/users/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteUser(token: string, id: string): Promise<void> {
  return request<void>(`/api/users/${id}`, token, { method: 'DELETE' });
}

export interface ApiToken {
  id: string;
  name: string;
  token_prefix: string;
  role: string;
  created_at: string;
  last_used_at: string | null;
  created_by: string;
}

export function listApiTokens(token: string): Promise<{ tokens: ApiToken[] }> {
  return request<{ tokens: ApiToken[] }>('/api/tokens', token);
}

export function createApiToken(
  token: string,
  payload: { name: string; role: string },
): Promise<{ token: ApiToken; rawToken: string }> {
  return request<{ token: ApiToken; rawToken: string }>('/api/tokens', token, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteApiToken(token: string, id: string): Promise<void> {
  return request<void>(`/api/tokens/${id}`, token, { method: 'DELETE' });
}
