export type TargetTypeKey =
  | 'plain_llm'
  | 'prompt_application'
  | 'rag_application'
  | 'ai_agent'
  | 'multi_agent_system'
  | 'api_endpoint'
  | 'chatbot';

export interface SupportedTargetType {
  key: TargetTypeKey;
  label: string;
  promptfooEntity: string;
  onboardingObject: string;
  description: string;
  requiredFields: string[];
}

export interface TestFlowStage {
  key: string;
  label: string;
  description: string;
}

export interface TargetTestPlanStep {
  id: string;
  stageOrder: number;
  stageKey: string;
  stageLabel: string;
  status: string;
  config: Record<string, unknown>;
}

export interface OnboardedTarget {
  id: string;
  displayName: string;
  targetType: TargetTypeKey;
  promptfooEntity: string;
  onboardingObject: string;
  ownerName: string | null;
  environment: string;
  endpointUrl: string | null;
  modelName: string | null;
  authStrategy: string;
  systemPrompt: string | null;
  metadata: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  testPlan: TargetTestPlanStep[];
}

export interface StageReadiness {
  ready: boolean;
  missing: string[];
}

export interface TargetDetailResponse {
  target: OnboardedTarget;
  readiness: {
    eval: StageReadiness;
    red_team: StageReadiness;
    model_audit: StageReadiness;
  };
  promptfooConfig: Record<string, unknown>;
  promptfooConfigYaml: string;
}

export interface ProviderCatalogItem {
  key: string;
  label: string;
  defaultBaseUrl: string;
  adapter: string;
  executable: boolean;
}

export interface ProviderCatalogGroup {
  key: string;
  label: string;
  providers: ProviderCatalogItem[];
}

export interface WorkflowCatalogItem {
  key: string;
  label: string;
  description?: string;
  category?: string;
  // Plugins/strategies only: true when real promptfoo has no local generation path for this
  // one at all (mirrors its own REMOTE_ONLY_PLUGIN_IDS/STRATEGIES_REQUIRING_REMOTE) - real
  // generation silently produces zero cases for it whenever remote generation is unavailable.
  remoteOnly?: boolean;
}

export interface WorkflowCatalogResponse {
  assertions: WorkflowCatalogItem[];
  redteamPlugins: WorkflowCatalogItem[];
  redteamStrategies: WorkflowCatalogItem[];
  auditScanners: WorkflowCatalogItem[];
  auditBaselineChecks: WorkflowCatalogItem[];
  redteamRemoteGenerationDisabled: boolean;
}

export interface EvalRun {
  id: string;
  targetId: string;
  stageKey: string;
  status: string;
  runOptions: Record<string, unknown>;
  configSnapshot: Record<string, unknown>;
  results: {
    // Red-team runs only: set when "Use real adversarial generation" was on but real
    // generation actually fell back to local templates, and why (no eval provider/API key,
    // real generation returned zero cases, or a real generation error) - so the UI can tell
    // the user real generation didn't happen instead of silently substituting local probes.
    realGenerationFallbackReason?: string | null;
    summary?: {
      providers: number;
      prompts: number;
      tests: number;
      total: number;
      pass: number;
      fail: number;
      error: number;
      passRate: number;
      namedScores?: Record<string, number>;
      derivedMetrics?: Record<string, number | null>;
    };
    rows?: Array<{
      provider: string;
      test: string;
      prompt: string;
      output: string;
      pass: boolean;
      error?: string;
      latencyMs?: number;
      repeatIndex?: number;
      assertions?: Array<Record<string, unknown>>;
      tokenUsage?: Record<string, unknown> | null;
      namedScores?: Record<string, number>;
      finishReason?: string | null;
      rawResponse?: unknown;
      vars?: Record<string, unknown>;
      cacheHit?: boolean;
    }>;
  };
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StageRun = EvalRun;

export interface TargetDataset {
  id: string;
  targetId: string;
  name: string;
  version: number;
  rows: Array<{
    name: string;
    input: string;
    assertion: string;
    expected: string;
    assertions?: Array<{
      type: string;
      value: string;
    }>;
    vars?: Record<string, string>;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }>;
  source: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TargetSchedule {
  id: string;
  targetId: string;
  name: string;
  stageKeys: Array<'eval' | 'red_team' | 'model_audit'>;
  intervalMinutes: number;
  enabled: boolean;
  runOptions: Record<string, unknown>;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  notifyWebhookUrl: string;
  notifyOn: 'failure' | 'always';
  notifyWebhookSecretSet: boolean;
  lastWebhookStatus: string | null;
  lastWebhookAt: string | null;
  lastWebhookAttempts: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderTestResult {
  ok: boolean;
  provider: string;
  adapter: string;
  latencyMs: number;
  output?: string;
  tokenUsage?: Record<string, unknown> | null;
  error?: string;
}

export interface RedTeamPlan {
  target: OnboardedTarget;
  readiness: StageReadiness;
  generatedAt: string;
  realGenerationFallbackReason?: string | null;
  summary: {
    total: number;
    generated: number;
    custom: number;
    plugins: number;
    strategies: number;
    critical: number;
    high: number;
  };
  probes: Array<{
    id: string;
    name: string;
    plugin: string;
    strategy: string;
    severity: string;
    source: string;
    prompt: string;
    expectedRefusalMarkers: string[];
  }>;
}

export interface RunTraceRow {
  index: number;
  stageKey: string;
  provider: string;
  test: string;
  prompt: string;
  output: string;
  pass: boolean;
  error: string | null;
  latencyMs: number | null;
  tokenUsage: Record<string, unknown> | null;
  assertions: Array<Record<string, unknown>>;
  finishReason: string | null;
  rawResponse: unknown;
  vars: Record<string, unknown>;
  cacheHit: boolean;
}

export interface TargetReport {
  target: OnboardedTarget;
  readiness: TargetDetailResponse['readiness'];
  generatedAt: string;
  scorecard: {
    score: number;
    status: string;
    totals: {
      total: number;
      pass: number;
      fail: number;
      error: number;
      passRate: number;
    };
    stages: Record<string, {
      total: number;
      pass: number;
      fail: number;
      error: number;
      passRate: number;
    }>;
  };
  latestRuns: Record<string, StageRun>;
  runHistory?: StageRun[];
  findings: Array<{
    stageKey: string;
    runId: string;
    test: string;
    provider: string;
    status: string;
    error: string | null;
    output: string;
    plugin?: string;
    strategy?: string;
    severity?: string;
  }>;
  engineConfigYaml: string;
}

export interface RunComparison {
  left: StageRun;
  right: StageRun;
  delta: {
    total: number;
    pass: number;
    fail: number;
    error: number;
    passRate: number;
    namedScores?: Record<string, { left: number | null; right: number | null; delta: number | null }>;
    derivedMetrics?: Record<string, { left: number | null; right: number | null; delta: number | null }>;
  };
  changed: Array<{
    test: string;
    provider: string;
    from: string;
    to: string;
  }>;
}

export interface TargetExportPayload {
  target: OnboardedTarget;
  readiness: TargetDetailResponse['readiness'];
  engineConfig: Record<string, unknown>;
  engineConfigYaml: string;
  datasets: TargetDataset[];
  schedules: TargetSchedule[];
  runs: StageRun[];
  exportedAt: string;
}

export interface CatalogResponse {
  supportedTargetTypes: SupportedTargetType[];
  testFlowStages: TestFlowStage[];
}

export interface User {
  id?: string;
  email: string;
  role: string;
}
