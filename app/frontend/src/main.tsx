import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createTarget,
  activateDataset,
  cancelTargetRun,
  createSchedule,
  createDataset,
  deleteDataset,
  deleteSchedule,
  deleteTarget,
  deleteTargetRun,
  getCatalog,
  getProviderCatalog,
  getRedTeamPlan,
  getTargetDetail,
  getTargets,
  getWorkflowCatalog,
  exportTargetArtifact,
  exportTarget,
  compareRuns,
  getTargetReport,
  getRunDetail,
  importEvalStageConfig,
  generateEvalDataset,
  generateEvalAssertions,
  optimizeEvalPrompt,
  importTarget,
  login,
  logout,
  listDatasets,
  listSchedules,
  listStageRuns,
  listTargetRuns,
  listEvalRuns,
  prepareStage,
  saveStageConfig,
  saveEvalStageConfig,
  startStageRunAsync,
  startEvalRunAsync,
  testTargetProvider,
  rerunTargetRun,
  updateTarget,
  updateSchedule,
  runScheduleNow,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listApiTokens,
  createApiToken,
  deleteApiToken,
  type EvalAssertion,
  type EvalStageConfigPayload,
  type ModelAuditStageConfigPayload,
  type RedTeamStageConfigPayload,
  type Session,
  type TargetPayload,
  type AppUser,
  type ApiToken,
  type PromptOptimizationResult,
} from './api';
import type {
  CatalogResponse,
  EvalRun,
  OnboardedTarget,
  ProviderTestResult,
  ProviderCatalogGroup,
  RedTeamPlan,
  RunComparison,
  RunTraceRow,
  StageReadiness,
  StageRun,
  SupportedTargetType,
  TargetDataset,
  TargetDetailResponse,
  TargetReport,
  TargetSchedule,
  TargetTypeKey,
  User,
  WorkflowCatalogResponse,
} from './types';
import './styles.css';

type View = 'registry' | 'onboard' | 'detail' | 'users' | 'tokens';
type ExecutableStageKey = 'eval' | 'red_team' | 'model_audit';
type StageKey = ExecutableStageKey | 'evidence';
type KeyValueRow = { id: string; name: string; value: string };

const STAGE_KEYS: StageKey[] = ['eval', 'red_team', 'model_audit', 'evidence'];

type Route = { view: View; targetId?: string; stage?: StageKey };

function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] === 'targets' && parts[1]) {
    const stage = STAGE_KEYS.includes(parts[2] as StageKey) ? (parts[2] as StageKey) : undefined;
    return { view: 'detail', targetId: parts[1], stage };
  }
  if (parts[0] === 'onboard') return { view: 'onboard' };
  if (parts[0] === 'users') return { view: 'users' };
  if (parts[0] === 'tokens') return { view: 'tokens' };
  return { view: 'registry' };
}

function routeHash(route: Route): string {
  if (route.view === 'detail' && route.targetId) {
    return route.stage ? `#/targets/${route.targetId}/${route.stage}` : `#/targets/${route.targetId}`;
  }
  if (route.view === 'onboard') return '#/onboard';
  if (route.view === 'users') return '#/users';
  if (route.view === 'tokens') return '#/tokens';
  return '#/registry';
}

function setRouteHash(route: Route) {
  const next = routeHash(route);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

const defaultEmail = 'admin@example.com';
const defaultPassword = 'admin123';
const targetTypeOptions: Array<{ value: TargetTypeKey; label: string }> = [
  { value: 'plain_llm', label: 'Plain LLM' },
  { value: 'prompt_application', label: 'Prompt application' },
  { value: 'rag_application', label: 'RAG application' },
  { value: 'ai_agent', label: 'AI agent' },
  { value: 'multi_agent_system', label: 'Multi-agent system' },
  { value: 'api_endpoint', label: 'API endpoint' },
  { value: 'chatbot', label: 'Chat application' },
];

function readStoredUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem('og_user') || 'null') as User | null;
  } catch {
    return null;
  }
}

function splitList(value: FormDataEntryValue | null): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseInlineList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function keyValueRowsFromRecord(record: unknown): KeyValueRow[] {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  return Object.entries(record as Record<string, unknown>).map(([name, value], index) => ({
    id: `${name}-${index}`,
    name,
    value: String(value ?? ''),
  }));
}

function keyValueRowsToRecord(rows: KeyValueRow[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .map((row) => [row.name.trim(), row.value] as const)
      .filter(([name]) => Boolean(name)),
  );
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function assertionHelp(assertion: string): string {
  switch (assertion) {
    case 'contains-all':
      return 'Comma-separated values or YAML array on import. Every value must appear.';
    case 'contains-any':
    case 'icontains-any':
      return 'Comma-separated values. At least one value must appear.';
    case 'contains-none':
      return 'Comma-separated blocked values. None may appear.';
    case 'llm-rubric':
    case 'model-graded-closedqa':
    case 'g-eval':
    case 'factuality':
    case 'answer-relevance':
    case 'context-recall':
    case 'context-relevance':
    case 'context-faithfulness':
    case 'conversation-relevance':
      return 'Rubric text. Optional: threshold=0.7; must mention refund policy.';
    case 'similar':
      return 'Reference answer. Optional: threshold=0.6; expected semantic text.';
    case 'moderation':
      return 'Use safe or unsafe as the expected moderation outcome.';
    case 'contains-html':
    case 'is-html':
    case 'contains-xml':
    case 'is-xml':
    case 'contains-sql':
    case 'is-sql':
      return 'Leave expected empty unless the imported assertion supplies advanced options.';
    case 'word-count':
      return 'Use an exact number or a range like 5-20.';
    case 'levenshtein':
      return 'Expected text plus threshold/max edit distance in imported configs.';
    case 'javascript':
      return 'Boolean JavaScript using output, prompt, latencyMs, tokenUsage.';
    case 'python':
      return 'Python expression using output, expected, prompt, vars, and context.';
    case 'webhook':
      return 'Webhook URL. It receives output and context, and returns pass/score JSON.';
    case 'contains-json':
      return 'Comma-separated JSON keys expected in the output.';
    case 'latency-ms':
      return 'Maximum allowed latency in milliseconds.';
    case 'cost':
      return 'Maximum allowed total tokens when usage is available.';
    default:
      return 'Expected value for the selected assertion.';
  }
}

// RFC4180-ish CSV parser: handles quoted fields, "" as an escaped quote inside a quoted field,
// and commas/newlines inside quoted fields — a plain `line.split(',')` (the previous approach)
// silently corrupts any field containing a comma (e.g. an expected value like
// "apple, banana, cherry") or breaks a quoted multi-line field into separate rows.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field.trim());
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field.trim());
      if (row.some((cell) => cell !== '')) rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  row.push(field.trim());
  if (row.some((cell) => cell !== '')) rows.push(row);
  return rows;
}

function assertionsForCase(testCase: EvalStageConfigPayload['testCases'][number]): EvalAssertion[] {
  return testCase.assertions?.length
    ? testCase.assertions
    : [{ type: testCase.assertion || 'contains', value: testCase.expected || '' }];
}

function normalizeCaseForEditor(testCase: EvalStageConfigPayload['testCases'][number]) {
  const assertions = assertionsForCase(testCase);
  return {
    ...testCase,
    assertion: assertions[0]?.type || testCase.assertion || 'contains',
    expected: assertions[0]?.value || testCase.expected || '',
    assertions,
    varsJson: testCase.varsJson || (testCase.vars ? JSON.stringify(testCase.vars, null, 2) : ''),
  };
}

function serializeCaseForSave(testCase: EvalStageConfigPayload['testCases'][number]) {
  let vars: Record<string, string> | undefined;
  const varsText = String(testCase.varsJson || '').trim();
  if (varsText) {
    const parsed = JSON.parse(varsText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Vars JSON for "${testCase.name || 'case'}" must be an object`);
    }
    vars = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  }
  const assertions = assertionsForCase(testCase).filter((assertion) => assertion.type);
  return {
    ...testCase,
    assertion: assertions[0]?.type || testCase.assertion || 'contains',
    expected: assertions[0]?.value || testCase.expected || '',
    assertions,
    vars,
  };
}

const emptyWorkflowCatalog: WorkflowCatalogResponse = {
  assertions: [],
  redteamPlugins: [],
  redteamStrategies: [],
  auditScanners: [],
  auditBaselineChecks: [],
  redteamRemoteGenerationDisabled: false,
};

function Shell({
  children,
  onRegistry,
  onUsers,
  onTokens,
  onLogout,
  isAdmin,
}: {
  children: React.ReactNode;
  onRegistry: () => void;
  onUsers?: () => void;
  onTokens?: () => void;
  onLogout: () => void;
  isAdmin?: boolean;
}) {
  return (
    <section className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="mark">OG</div>
          <div>
            <p className="eyebrow">Open Governance</p>
            <p className="topbar-title">Assurance control plane</p>
          </div>
          {isAdmin === false ? (
            <span className="badge viewer-badge" title="Viewer accounts can browse everything but can't run, save, or delete anything — those actions will be blocked.">
              Viewer (read-only)
            </span>
          ) : null}
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" type="button" onClick={onRegistry}>
            Registry
          </button>
          {isAdmin && onUsers ? (
            <button className="secondary-button" type="button" onClick={onUsers}>
              Users
            </button>
          ) : null}
          {isAdmin && onTokens ? (
            <button className="secondary-button" type="button" onClick={onTokens}>
              API tokens
            </button>
          ) : null}
          <button className="ghost-button" type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <div className="content">{children}</div>
    </section>
  );
}

function LoginPage({ error, onLogin }: { error: string; onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState(defaultPassword);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(error);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setLocalError('');
    try {
      onLogin(await login(email, password));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="login-page">
      <div className="login-card">
        <div className="brand-row">
          <div className="mark">OG</div>
          <div>
            <p className="eyebrow">AI Assurance Control Plane</p>
            <h1>Sign in</h1>
          </div>
        </div>
        <p className="muted">Access the registry and onboarding workspace.</p>
        {localError ? <div className="error">{localError}</div> : null}
        <form className="form" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              autoComplete="username"
              required
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              required
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </section>
  );
}

function RegistryPage({
  catalog,
  targets,
  message,
  token,
  isViewer,
  onOnboard,
  onSelect,
  onImported,
}: {
  catalog: CatalogResponse;
  targets: OnboardedTarget[];
  message: string;
  token: string;
  isViewer?: boolean;
  onOnboard: () => void;
  onSelect: (id: string) => void;
  onImported: (id: string) => Promise<void>;
}) {
  const viewerTitle = isViewer ? 'Viewer accounts cannot make changes' : undefined;
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredTargets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return targets.filter((target) => {
      if (statusFilter !== 'all' && target.status !== statusFilter) return false;
      if (!query) return true;
      return (
        target.displayName.toLowerCase().includes(query) ||
        (target.modelName || '').toLowerCase().includes(query) ||
        (target.endpointUrl || '').toLowerCase().includes(query) ||
        target.promptfooEntity.toLowerCase().includes(query)
      );
    });
  }, [targets, searchQuery, statusFilter]);

  async function handleImport() {
    setImportError('');
    setImporting(true);
    try {
      const text = importText.trim();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { configText: text, importedFrom: 'promptfoo-config' };
      }
      const result = await importTarget(token, payload);
      setImportText('');
      await onImported(result.target.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Unable to import target JSON');
    } finally {
      setImporting(false);
    }
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError('');
    setImportText(await file.text());
    event.target.value = '';
  }

  return (
    <section className="registry-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Registry</p>
          <h1>AI target registry</h1>
          <p className="muted">
            Select a target to continue into Eval, Red team, and Model audit preparation.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={onOnboard} disabled={isViewer} title={viewerTitle}>
          Onboard a model
        </button>
      </div>
      {message ? <div className="success">{message}</div> : null}
      <section className="panel import-panel">
        <div className="subpanel-head">
          <div>
            <h2>Import target</h2>
            <p className="muted">Paste product export JSON or a Promptfoo YAML/JSON config.</p>
          </div>
          <div className="stage-actions">
            <label className={`secondary-link${isViewer ? ' disabled-link' : ''}`} title={viewerTitle}>
              Load file
              <input type="file" accept=".json,.yaml,.yml,application/json,text/yaml" hidden disabled={isViewer} onChange={handleImportFile} />
            </label>
            <button className="secondary-button" type="button" disabled={isViewer || !importText.trim() || importing} title={viewerTitle} onClick={handleImport}>
              {importing ? 'Importing...' : 'Import config'}
            </button>
          </div>
        </div>
        {importError ? <div className="error">{importError}</div> : null}
        <textarea
          className="import-textarea"
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder={'description: Customer support eval\\nproviders:\\n  - openai:gpt-4o-mini\\nprompts:\\n  - "{{prompt}}"\\ntests:\\n  - vars:\\n      prompt: Reply with READY\\n    assert:\\n      - type: contains\\n        value: READY'}
        />
      </section>
      <section className="panel">
        <div className="registry-summary">
          <div>
            <p className="row-label">Total entries</p>
            <strong>{targets.length}</strong>
          </div>
          <div>
            <p className="row-label">Supported classes</p>
            <strong>{catalog.supportedTargetTypes.length}</strong>
          </div>
          <div>
            <p className="row-label">Standard flow</p>
            <strong>{catalog.testFlowStages.map((stage) => stage.label).join(' -> ')}</strong>
          </div>
        </div>
        {targets.length ? (
          <div className="registry-filters">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, model, or endpoint..."
              aria-label="Search targets"
            />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        ) : null}
        {targets.length ? (
          filteredTargets.length ? (
            <div className="registry-list">
              {filteredTargets.map((target) => (
                <button
                  className="registry-row registry-button"
                  key={target.id}
                  onClick={() => onSelect(target.id)}
                  aria-label={`Open ${target.displayName}`}
                >
                  <div>
                    <h3>{target.displayName}</h3>
                    <p className="muted">
                      {target.promptfooEntity} · {target.environment}
                    </p>
                  </div>
                  <div>
                    <p className="row-label">Target</p>
                    <strong>{target.modelName || target.endpointUrl || 'Not captured'}</strong>
                  </div>
                  <div>
                    <p className="row-label">Flow</p>
                    <strong>{target.testPlan.length} stages</strong>
                  </div>
                  <span className="badge">{target.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">No targets match your search or filter.</div>
          )
        ) : (
          <div className="empty">No registry entries yet. Onboard a model to create the first record.</div>
        )}
      </section>
    </section>
  );
}

function TypePicker({
  types,
  selectedType,
  onSelect,
}: {
  types: SupportedTargetType[];
  selectedType: TargetTypeKey;
  onSelect: (type: TargetTypeKey) => void;
}) {
  return (
    <div className="type-grid">
      {types.map((type) => (
        <button
          className="type-option"
          type="button"
          key={type.key}
          aria-pressed={selectedType === type.key}
          onClick={() => onSelect(type.key)}
        >
          <strong>{type.label}</strong>
          <span>{type.description}</span>
          <div className="mapping">{type.promptfooEntity}</div>
        </button>
      ))}
    </div>
  );
}

function OnboardingPage({
  catalog,
  token,
  onCreated,
  onBack,
}: {
  catalog: CatalogResponse;
  token: string;
  onCreated: (id: string) => Promise<void>;
  onBack: () => void;
}) {
  const [selectedType, setSelectedType] = useState<TargetTypeKey>('plain_llm');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const selected = useMemo(
    () => catalog.supportedTargetTypes.find((type) => type.key === selectedType),
    [catalog.supportedTargetTypes, selectedType],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: TargetPayload = {
      displayName: String(form.get('displayName') || ''),
      targetType: selectedType,
      ownerName: String(form.get('ownerName') || ''),
      environment: String(form.get('environment') || 'development'),
      endpointUrl: String(form.get('endpointUrl') || ''),
      modelName: String(form.get('modelName') || ''),
      authStrategy: String(form.get('authStrategy') || 'api-key'),
      systemPrompt: String(form.get('systemPrompt') || ''),
      metadata: {
        riskTier: String(form.get('riskTier') || 'basic'),
        provider: {
          kind: String(form.get('providerKind') || 'openai-compatible'),
          baseUrl: String(form.get('baseUrl') || ''),
          apiKey: String(form.get('apiKey') || ''),
          temperature: Number(form.get('temperature') || 0),
          maxTokens: Number(form.get('maxTokens') || 512),
        },
        eval: {
          promptTemplate: String(form.get('promptTemplate') || '{{prompt}}'),
          injectVar: String(form.get('injectVar') || 'prompt'),
          testCases: [
            {
              name: String(form.get('testName') || 'Baseline utility test'),
              input: String(form.get('testInput') || 'Reply with exactly: READY'),
              assertion: String(form.get('testAssertion') || 'contains'),
              expected: String(form.get('testExpected') || 'READY'),
            },
          ],
        },
        redteam: {
          purpose: String(form.get('redteamPurpose') || ''),
          plugins: splitList(form.get('redteamPlugins')),
          strategies: splitList(form.get('redteamStrategies')),
          numTests: Number(form.get('redteamNumTests') || 5),
          entities: splitList(form.get('redteamEntities')),
        },
        audit: {
          artifactPath: String(form.get('artifactPath') || ''),
          source: String(form.get('modelSource') || ''),
          licensePolicy: String(form.get('licensePolicy') || ''),
          sbomRequired: form.get('sbomRequired') === 'on',
          scanners: splitList(form.get('auditScanners')),
        },
        runtime: {
          tenant: String(form.get('tenant') || ''),
          dataClassification: String(form.get('dataClassification') || ''),
          allowedTools: splitList(form.get('allowedTools')),
          retrievalSources: splitList(form.get('retrievalSources')),
        },
      },
    };
    setSubmitting(true);
    setError('');
    try {
      const result = await createTarget(token, payload);
      await onCreated(result.target.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create onboarding record');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button className="ghost-button back-button" type="button" onClick={onBack}>
        Back to registry
      </button>
      <form className="detail-layout" id="target-form" onSubmit={handleSubmit}>
        <section className="panel">
          <p className="eyebrow">Onboard</p>
          <h2>Classify the target</h2>
          <p className="muted">This controls how the target is evaluated inside the assurance workflow.</p>
          {error ? <div className="error">{error}</div> : null}
          <TypePicker types={catalog.supportedTargetTypes} selectedType={selectedType} onSelect={setSelectedType} />
          <div className="form-grid form-section">
            <div className="field">
              <label htmlFor="displayName">Display name</label>
              <input id="displayName" name="displayName" placeholder="e.g. Citizen services chatbot" required />
            </div>
            <div className="field">
              <label htmlFor="ownerName">Owner</label>
              <input id="ownerName" name="ownerName" placeholder="e.g. AI Platform Team" />
            </div>
            <div className="field">
              <label htmlFor="tenant">Tenant / agency</label>
              <input id="tenant" name="tenant" placeholder="e.g. Ministry tenant A" />
            </div>
            <div className="field">
              <label htmlFor="environment">Environment</label>
              <select id="environment" name="environment">
                <option value="development">Development</option>
                <option value="staging">Staging</option>
                <option value="production">Production</option>
                <option value="sovereign-airgap">Sovereign air-gap</option>
              </select>
            </div>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Provider</p>
          <h2>Connection and prompt surface</h2>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="providerKind">Provider kind</label>
              <select id="providerKind" name="providerKind">
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="http-api">HTTP API</option>
                <option value="custom-provider">Custom provider</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="modelName">Model name</label>
              <input id="modelName" name="modelName" placeholder="e.g. llama-3.1-8b-instant" required />
            </div>
            <div className="field span-2">
              <label htmlFor="baseUrl">Provider base URL</label>
              <input id="baseUrl" name="baseUrl" placeholder="https://api.groq.com/openai/v1" required />
            </div>
            <div className="field span-2">
              <label htmlFor="endpointUrl">Application endpoint URL</label>
              <input id="endpointUrl" name="endpointUrl" placeholder="https://api.example.gov/v1/chat/completions" />
            </div>
            <div className="field">
              <label htmlFor="apiKey">API key</label>
              <input id="apiKey" name="apiKey" type="password" placeholder="Paste provider key" />
              <p className="field-help">Stored encrypted. The full key will not be shown again.</p>
            </div>
            <div className="field">
              <label htmlFor="authStrategy">Auth strategy</label>
              <select id="authStrategy" name="authStrategy">
                <option value="api-key">API key</option>
                <option value="bearer-token">Bearer token</option>
                <option value="mtls">mTLS</option>
                <option value="private-network">Private network</option>
                <option value="none">None</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="temperature">Temperature</label>
              <input id="temperature" name="temperature" type="number" min="0" max="2" step="0.1" defaultValue="0" />
            </div>
            <div className="field">
              <label htmlFor="maxTokens">Max tokens</label>
              <input id="maxTokens" name="maxTokens" type="number" min="1" defaultValue="512" />
            </div>
            <div className="field span-2">
              <label htmlFor="systemPrompt">System prompt / operating instruction</label>
              <textarea id="systemPrompt" name="systemPrompt" required />
            </div>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Eval</p>
          <h2>Baseline eval inputs</h2>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="promptTemplate">Prompt template</label>
              <textarea id="promptTemplate" name="promptTemplate" defaultValue="{{prompt}}" required />
            </div>
            <div className="field">
              <label htmlFor="injectVar">Inject variable</label>
              <input id="injectVar" name="injectVar" defaultValue="prompt" required />
            </div>
            <div className="field">
              <label htmlFor="testAssertion">Assertion</label>
              <select id="testAssertion" name="testAssertion">
                <option value="contains">contains</option>
                <option value="not-contains">not-contains</option>
                <option value="icontains">icontains</option>
                <option value="llm-rubric">llm-rubric</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="testName">Test name</label>
              <input id="testName" name="testName" defaultValue="Baseline utility test" />
            </div>
            <div className="field">
              <label htmlFor="testExpected">Expected value</label>
              <input id="testExpected" name="testExpected" defaultValue="READY" />
            </div>
            <div className="field span-2">
              <label htmlFor="testInput">Test input</label>
              <textarea id="testInput" name="testInput" defaultValue="Reply with exactly: READY" required />
            </div>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Red Team</p>
          <h2>Attack scope</h2>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="redteamPurpose">Purpose</label>
              <textarea
                id="redteamPurpose"
                name="redteamPurpose"
                placeholder="Describe what the app does, who uses it, and what it must never reveal or do."
                required
              />
            </div>
            <div className="field">
              <label htmlFor="redteamPlugins">Plugins</label>
              <input
                id="redteamPlugins"
                name="redteamPlugins"
                defaultValue="system-prompt-override, indirect-prompt-injection, prompt-extraction, pii:direct"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="redteamStrategies">Strategies</label>
              <input id="redteamStrategies" name="redteamStrategies" defaultValue="basic, jailbreak, jailbreak-templates" required />
            </div>
            <div className="field">
              <label htmlFor="redteamNumTests">Tests per plugin</label>
              <input id="redteamNumTests" name="redteamNumTests" type="number" min="1" defaultValue="5" />
            </div>
            <div className="field">
              <label htmlFor="redteamEntities">Protected entities</label>
              <input id="redteamEntities" name="redteamEntities" placeholder="agency names, systems, brands" />
            </div>
            <div className="field">
              <label htmlFor="dataClassification">Data classification</label>
              <select id="dataClassification" name="dataClassification" required>
                <option value="">Select classification</option>
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="restricted">Restricted</option>
                <option value="secret">Secret</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="riskTier">Initial risk tier</label>
              <select id="riskTier" name="riskTier">
                <option value="basic">Basic</option>
                <option value="enhanced">Enhanced</option>
                <option value="mission-critical">Mission-Critical</option>
              </select>
            </div>
            <div className="field span-2">
              <label htmlFor="allowedTools">Allowed tools</label>
              <input id="allowedTools" name="allowedTools" placeholder="browser, database_read, ticket_lookup" />
            </div>
            <div className="field span-2">
              <label htmlFor="retrievalSources">Retrieval sources</label>
              <input id="retrievalSources" name="retrievalSources" placeholder="policy index, citizen FAQ, case database" />
            </div>
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Model Audit</p>
          <h2>Artifact and provenance</h2>
          <div className="form-grid">
            <div className="field span-2">
              <label htmlFor="artifactPath">Model artifact path / repository</label>
              <input id="artifactPath" name="artifactPath" placeholder="/models/model.gguf or registry/repo" />
            </div>
            <div className="field">
              <label htmlFor="modelSource">Model source</label>
              <input id="modelSource" name="modelSource" placeholder="internal, vendor, Hugging Face, fine-tuned" required />
            </div>
            <div className="field">
              <label htmlFor="licensePolicy">License policy</label>
              <select id="licensePolicy" name="licensePolicy" required>
                <option value="">Select policy</option>
                <option value="approved-commercial">Approved commercial use</option>
                <option value="requires-review">Requires legal/security review</option>
                <option value="internal-only">Internal only</option>
              </select>
            </div>
            <div className="field span-2">
              <label htmlFor="auditScanners">ModelAudit scanners</label>
              <input id="auditScanners" name="auditScanners" placeholder="malware, secrets, licenses, unsafe-code" />
            </div>
            <label className="check-row">
              <input id="sbomRequired" name="sbomRequired" type="checkbox" defaultChecked />
              SBOM/MBOM required before approval
            </label>
          </div>
        </section>

        <button className="primary-button submit-wide" type="submit" disabled={submitting}>
          {submitting ? 'Creating...' : `Create ${selected?.promptfooEntity || 'target'} onboarding record`}
        </button>
      </form>
    </>
  );
}

function ReadinessBlock({ readiness }: { readiness: StageReadiness }) {
  if (readiness.ready) {
    return <p className="ready-text">Ready</p>;
  }
  return (
    <div>
      <p className="blocked-text">Missing</p>
      <ul className="missing-list">
        {readiness.missing.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function EvalWorkspace({
  detail,
  token,
  providerGroups,
  workflowCatalog,
  evalRuns,
  isViewer,
  onRefresh,
}: {
  detail: TargetDetailResponse;
  token: string;
  providerGroups: ProviderCatalogGroup[];
  workflowCatalog: WorkflowCatalogResponse;
  evalRuns: EvalRun[];
  isViewer?: boolean;
  onRefresh: (updated: TargetDetailResponse) => void | Promise<void>;
}) {
  const viewerTitle = isViewer ? 'Viewer accounts cannot make changes' : undefined;
  const metadata = detail.target.metadata as Record<string, any>;
  const evalConfig = (metadata.eval || {}) as any;
  const providerDefaults = (metadata.provider || {}) as any;
  const flatProviders = providerGroups.flatMap((group) => group.providers);
  const [providers, setProviders] = useState<EvalStageConfigPayload['providers']>(
    evalConfig.providers?.length
      ? evalConfig.providers
      : [
          {
            providerKey: providerDefaults.kind || 'groq',
            label: detail.target.displayName,
            engine: 'openai-compatible',
            baseUrl: providerDefaults.baseUrl || detail.target.endpointUrl || '',
            model: detail.target.modelName || '',
            apiKey: '',
            apiKeyEnv: providerDefaults.apiKeyEnv,
            apiKeySecretId: providerDefaults.apiKeySecretId,
            apiKeyMasked: providerDefaults.apiKeyMasked,
            temperature: Number(providerDefaults.temperature ?? 0),
            maxTokens: Number(providerDefaults.maxTokens ?? 512),
          },
        ],
  );
  const [prompts, setPrompts] = useState<EvalStageConfigPayload['prompts']>(
    evalConfig.prompts?.length
      ? evalConfig.prompts
      : [{ name: 'Default prompt', content: evalConfig.promptTemplate || '{{prompt}}' }],
  );
  const [testCases, setTestCases] = useState<EvalStageConfigPayload['testCases']>(
    evalConfig.testCases?.length
      ? evalConfig.testCases.map(normalizeCaseForEditor)
      : [normalizeCaseForEditor({ name: 'Baseline utility test', input: 'Reply with exactly: READY', assertion: 'contains', expected: 'READY' })],
  );
  const [injectVar, setInjectVar] = useState(evalConfig.injectVar || 'prompt');
  const [extensionsText, setExtensionsText] = useState((evalConfig.extensions || []).join('\n'));
  const [derivedMetricRows, setDerivedMetricRows] = useState<Array<{ name: string; value: string }>>(
    Array.isArray(evalConfig.derivedMetrics) && evalConfig.derivedMetrics.length ? evalConfig.derivedMetrics : [],
  );
  const [runOptions, setRunOptions] = useState<EvalStageConfigPayload['runOptions']>({
    engineMode: evalConfig.runOptions?.engineMode || 'direct',
    maxConcurrency: Number(evalConfig.runOptions?.maxConcurrency || 4),
    repeat: Number(evalConfig.runOptions?.repeat || 1),
    delayMs: Number(evalConfig.runOptions?.delayMs || 0),
    cache: Boolean(evalConfig.runOptions?.cache ?? true),
    timeoutMs: Number(evalConfig.runOptions?.timeoutMs || 30000),
  });
  const [bulkText, setBulkText] = useState('');
  const [optimizePromptIndex, setOptimizePromptIndex] = useState(0);
  const [optimizeNumCandidates, setOptimizeNumCandidates] = useState(3);
  const [optimizeMaxTestCases, setOptimizeMaxTestCases] = useState(5);
  const [optimizeInstructions, setOptimizeInstructions] = useState('');
  const [optimizeResult, setOptimizeResult] = useState<PromptOptimizationResult | null>(null);
  const [optimizeBusy, setOptimizeBusy] = useState(false);
  const [optimizeError, setOptimizeError] = useState('');
  const [generateNumPersonas, setGenerateNumPersonas] = useState(3);
  const [generateNumPerPersona, setGenerateNumPerPersona] = useState(2);
  const [generateInstructions, setGenerateInstructions] = useState('');
  const [generatePreview, setGeneratePreview] = useState<EvalStageConfigPayload['testCases']>([]);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [configImportText, setConfigImportText] = useState('');
  const [configImporting, setConfigImporting] = useState(false);
  const [datasets, setDatasets] = useState<TargetDataset[]>([]);
  const [datasetName, setDatasetName] = useState('Eval dataset');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState('');
  const [providerTesting, setProviderTesting] = useState<number | null>(null);
  const [providerTestResults, setProviderTestResults] = useState<Record<number, ProviderTestResult>>({});
  const latestRun = evalRuns[0];

  function syncEvalEditor(updated: TargetDetailResponse) {
    const updatedMetadata = updated.target.metadata as Record<string, any>;
    const updatedEval = (updatedMetadata.eval || {}) as Partial<EvalStageConfigPayload>;
    const updatedProvider = (updatedMetadata.provider || {}) as any;
    setProviders(
      updatedEval.providers?.length
        ? updatedEval.providers
        : [
            {
              providerKey: updatedProvider.kind || 'groq',
              label: updated.target.displayName,
              engine: 'openai-compatible',
              baseUrl: updatedProvider.baseUrl || updated.target.endpointUrl || '',
              model: updated.target.modelName || '',
              apiKey: '',
              apiKeyEnv: updatedProvider.apiKeyEnv,
              apiKeySecretId: updatedProvider.apiKeySecretId,
              apiKeyMasked: updatedProvider.apiKeyMasked,
              temperature: Number(updatedProvider.temperature ?? 0),
              maxTokens: Number(updatedProvider.maxTokens ?? 512),
            },
          ],
    );
    setPrompts(
      updatedEval.prompts?.length
        ? updatedEval.prompts
        : [{ name: 'Default prompt', content: updatedEval.promptTemplate || '{{prompt}}' }],
    );
    setTestCases(
      updatedEval.testCases?.length
        ? updatedEval.testCases.map(normalizeCaseForEditor)
        : [normalizeCaseForEditor({ name: 'Baseline utility test', input: 'Reply with exactly: READY', assertion: 'contains', expected: 'READY' })],
    );
    setInjectVar(updatedEval.injectVar || 'prompt');
    setExtensionsText((updatedEval.extensions || []).join('\n'));
    setDerivedMetricRows(Array.isArray(updatedEval.derivedMetrics) && updatedEval.derivedMetrics.length ? updatedEval.derivedMetrics : []);
    setRunOptions({
      engineMode: updatedEval.runOptions?.engineMode || 'direct',
      maxConcurrency: Number(updatedEval.runOptions?.maxConcurrency || 4),
      repeat: Number(updatedEval.runOptions?.repeat || 1),
      delayMs: Number(updatedEval.runOptions?.delayMs || 0),
      cache: Boolean(updatedEval.runOptions?.cache ?? true),
      timeoutMs: Number(updatedEval.runOptions?.timeoutMs || 30000),
    });
  }

  async function loadDatasets() {
    try {
      const payload = await listDatasets(token, detail.target.id);
      setDatasets(payload.datasets);
    } catch {
      setDatasets([]);
    }
  }

  useEffect(() => {
    loadDatasets();
  }, [detail.target.id, token]);

  function updateProvider(index: number, patch: Partial<EvalStageConfigPayload['providers'][number]>) {
    setProviders((current) => current.map((provider, i) => (i === index ? { ...provider, ...patch } : provider)));
  }

  function selectProvider(index: number, providerKey: string) {
    const catalogProvider = flatProviders.find((provider) => provider.key === providerKey);
    updateProvider(index, {
      providerKey,
      label: catalogProvider?.label || providerKey,
      baseUrl: catalogProvider?.defaultBaseUrl || '',
      engine: catalogProvider?.adapter || 'adapter-required',
    });
  }

  function updatePrompt(index: number, patch: Partial<EvalStageConfigPayload['prompts'][number]>) {
    setPrompts((current) => current.map((prompt, i) => (i === index ? { ...prompt, ...patch } : prompt)));
  }

  function updateTestCase(index: number, patch: Partial<EvalStageConfigPayload['testCases'][number]>) {
    setTestCases((current) => current.map((testCase, i) => (i === index ? { ...testCase, ...patch } : testCase)));
  }

  function updateTestCaseAssertion(caseIndex: number, assertionIndex: number, patch: Partial<EvalAssertion>) {
    setTestCases((current) =>
      current.map((testCase, i) => {
        if (i !== caseIndex) return testCase;
        const assertions = assertionsForCase(testCase).map((assertion, j) => {
          if (j !== assertionIndex) return assertion;
          const next = { ...assertion, ...patch };
          // Switching into assert-set seeds one sub-assertion so the nested editor isn't
          // empty; switching away from it drops the now-meaningless nested/threshold fields.
          if (patch.type === 'assert-set' && !next.assert?.length) {
            next.assert = [{ type: 'contains', value: '', weight: 1 }];
            next.threshold = next.threshold ?? 1;
          } else if (patch.type && patch.type !== 'assert-set') {
            delete next.assert;
            delete next.threshold;
          }
          return next;
        });
        return {
          ...testCase,
          assertions,
          assertion: assertions[0]?.type || testCase.assertion,
          expected: assertions[0]?.value || testCase.expected,
        };
      }),
    );
  }

  function updateSubAssertion(
    caseIndex: number,
    assertionIndex: number,
    subIndex: number,
    patch: Partial<{ type: string; value: string; weight: number }>,
  ) {
    setTestCases((current) =>
      current.map((testCase, i) => {
        if (i !== caseIndex) return testCase;
        const assertions = assertionsForCase(testCase).map((assertion, j) => {
          if (j !== assertionIndex) return assertion;
          const sub = (assertion.assert || []).map((row, k) => (k === subIndex ? { ...row, ...patch } : row));
          return { ...assertion, assert: sub };
        });
        return { ...testCase, assertions };
      }),
    );
  }

  function addSubAssertion(caseIndex: number, assertionIndex: number) {
    setTestCases((current) =>
      current.map((testCase, i) => {
        if (i !== caseIndex) return testCase;
        const assertions = assertionsForCase(testCase).map((assertion, j) =>
          j === assertionIndex
            ? { ...assertion, assert: [...(assertion.assert || []), { type: 'contains', value: '', weight: 1 }] }
            : assertion,
        );
        return { ...testCase, assertions };
      }),
    );
  }

  function removeSubAssertion(caseIndex: number, assertionIndex: number, subIndex: number) {
    setTestCases((current) =>
      current.map((testCase, i) => {
        if (i !== caseIndex) return testCase;
        const assertions = assertionsForCase(testCase).map((assertion, j) =>
          j === assertionIndex ? { ...assertion, assert: (assertion.assert || []).filter((_row, k) => k !== subIndex) } : assertion,
        );
        return { ...testCase, assertions };
      }),
    );
  }

  function parseBulkCases() {
    setError('');
    if (!bulkText.trim()) return;
    try {
      const parsed = JSON.parse(bulkText);
      if (Array.isArray(parsed)) {
        setTestCases(
          parsed.map((item, index) => normalizeCaseForEditor({
            name: item.name || item.description || `Imported case ${index + 1}`,
            input: item.input || item.prompt || item.vars?.[injectVar] || '',
            assertion: item.assertion || item.assert?.[0]?.type || 'contains',
            expected: item.expected || item.assert?.[0]?.value || '',
            assertions: item.assertions || item.assert,
            vars: item.vars,
            tags: item.tags,
            metadata: item.metadata,
            transform: item.transform || item.options?.transform,
          })),
        );
        setMessage('Imported JSON test cases.');
        return;
      }
    } catch {
      // Fall through to CSV parser.
    }
    const rows = parseCsv(bulkText);
    if (rows.length) {
      const dataRows = rows[0]?.[0]?.toLowerCase() === 'name' ? rows.slice(1) : rows;
      setTestCases(
        dataRows.map(([name, input, assertion, expected], index) => normalizeCaseForEditor({
          name: name || `Imported case ${index + 1}`,
          input: input || '',
          assertion: assertion || 'contains',
          expected: expected || '',
        })),
      );
      setMessage('Imported CSV test cases.');
    }
  }

  async function handleOptimizePrompt() {
    if (isViewer) return;
    setOptimizeError('');
    setOptimizeBusy(true);
    setOptimizeResult(null);
    try {
      const result = await optimizeEvalPrompt(token, detail.target.id, {
        promptIndex: optimizePromptIndex,
        numCandidates: optimizeNumCandidates,
        maxTestCases: optimizeMaxTestCases,
        instructions: optimizeInstructions.trim() || undefined,
      });
      setOptimizeResult(result);
    } catch (err) {
      setOptimizeError(err instanceof Error ? err.message : 'Unable to optimize prompt');
    } finally {
      setOptimizeBusy(false);
    }
  }

  function applyOptimizedPrompt(content: string) {
    updatePrompt(optimizePromptIndex, { content });
    setOptimizeResult(null);
    setMessage('Applied the winning prompt — remember to save.');
  }

  async function handleGenerateDataset() {
    if (isViewer) return;
    setGenerateError('');
    setGenerateBusy(true);
    try {
      const result = await generateEvalDataset(token, detail.target.id, {
        numPersonas: generateNumPersonas,
        numTestCasesPerPersona: generateNumPerPersona,
        instructions: generateInstructions.trim() || undefined,
      });
      setGeneratePreview(result.testCases.map(normalizeCaseForEditor));
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Unable to generate test cases');
    } finally {
      setGenerateBusy(false);
    }
  }

  function addGeneratedCasesToEditor() {
    setTestCases((current) => [...current, ...generatePreview]);
    setGeneratePreview([]);
    setMessage(`Added ${generatePreview.length} generated test case(s) — remember to save.`);
  }

  async function importPromptfooConfigIntoEval() {
    if (isViewer) return;
    setError('');
    setMessage('');
    const text = configImportText.trim();
    if (!text) return;
    setConfigImporting(true);
    try {
      const updated = await importEvalStageConfig(token, detail.target.id, {
        configText: text,
        importedFrom: 'eval-workspace',
      });
      syncEvalEditor(updated);
      await onRefresh(updated);
      await loadDatasets();
      setConfigImportText('');
      setMessage('Promptfoo config imported into this eval workspace.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import Promptfoo config');
    } finally {
      setConfigImporting(false);
    }
  }

  async function saveConfig() {
    if (isViewer) return false;
    setError('');
    setMessage('');
    try {
      const payload: EvalStageConfigPayload = {
        providers,
        prompts,
        testCases: testCases.map(serializeCaseForSave),
        promptTemplate: prompts[0]?.content || '{{prompt}}',
        injectVar,
        runOptions,
        extensions: extensionsText
          .split('\n')
          .map((line: string) => line.trim())
          .filter(Boolean),
        derivedMetrics: derivedMetricRows.filter((row) => row.name.trim() && row.value.trim()),
      };
      const updated = await saveEvalStageConfig(token, detail.target.id, payload);
      const updatedMetadata = updated.target.metadata as Record<string, any>;
      const updatedProviders = updatedMetadata.eval?.providers;
      if (Array.isArray(updatedProviders) && updatedProviders.length) {
        setProviders(updatedProviders);
      }
      await onRefresh(updated);
      setMessage('Eval configuration saved.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save eval configuration');
      return false;
    }
  }

  async function testProvider(index: number) {
    setError('');
    setMessage('');
    setProviderTesting(index);
    try {
      if (!(await saveConfig())) return;
      const result = await testTargetProvider(token, detail.target.id, index, {
        prompt: 'Reply with exactly: OK',
        maxTokens: 32,
      });
      setProviderTestResults((current) => ({ ...current, [index]: result }));
      setMessage(result.ok ? 'Provider connection succeeded.' : 'Provider connection failed.');
    } catch (err) {
      setProviderTestResults((current) => ({
        ...current,
        [index]: {
          ok: false,
          provider: providers[index]?.label || `Provider ${index + 1}`,
          adapter: providers[index]?.engine || 'unknown',
          latencyMs: 0,
          error: err instanceof Error ? err.message : 'Unable to test provider',
        },
      }));
      setError(err instanceof Error ? err.message : 'Unable to test provider');
    } finally {
      setProviderTesting(null);
    }
  }

  async function runEval() {
    setRunning(true);
    setError('');
    setMessage('');
    try {
      if (!(await saveConfig())) return;
      const result = await startEvalRunAsync(token, detail.target.id, runOptions);
      setActiveRunId(result.run.id);
      await onRefresh(result.detail);
      setMessage('Eval run started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run eval');
      setRunning(false);
      setActiveRunId('');
    }
  }

  async function cancelEval() {
    if (isViewer || !activeRunId) return;
    setError('');
    setMessage('');
    try {
      const result = await cancelTargetRun(token, detail.target.id, activeRunId);
      await onRefresh(result.detail);
      setMessage(result.run.status === 'cancelled' ? 'Eval run cancelled.' : 'Eval run cancellation requested.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel eval run');
    }
  }

  useEffect(() => {
    if (!activeRunId) return;
    let disposed = false;
    const timer = window.setInterval(async () => {
      try {
        const payload = await getRunDetail(token, detail.target.id, activeRunId);
        if (disposed) return;
        if (!['running', 'queued', 'cancelling'].includes(payload.run.status)) {
          window.clearInterval(timer);
          setRunning(false);
          setActiveRunId('');
          setMessage(payload.run.status === 'cancelled' ? 'Eval run cancelled.' : 'Eval run completed.');
          await onRefresh(await getTargetDetail(token, detail.target.id));
        }
      } catch (err) {
        if (!disposed) {
          window.clearInterval(timer);
          setRunning(false);
          setActiveRunId('');
          setError(err instanceof Error ? err.message : 'Unable to refresh eval run status');
        }
      }
    }, 1200);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, detail.target.id, token]);

  async function saveDataset(active = false) {
    if (isViewer) return;
    setError('');
    setMessage('');
    try {
      const result = await createDataset(token, detail.target.id, {
        name: datasetName || 'Eval dataset',
        rows: testCases.map(serializeCaseForSave),
        source: 'ui',
        active,
      });
      await onRefresh(result.detail);
      await loadDatasets();
      setMessage(active ? 'Dataset saved and activated.' : 'Dataset version saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save dataset');
    }
  }

  async function activateSavedDataset(datasetId: string) {
    if (isViewer) return;
    setError('');
    setMessage('');
    try {
      const result = await activateDataset(token, detail.target.id, datasetId);
      setTestCases(result.dataset.rows.map(normalizeCaseForEditor));
      await onRefresh(result.detail);
      await loadDatasets();
      setMessage('Dataset activated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to activate dataset');
    }
  }

  async function deleteSavedDataset(datasetId: string, name: string) {
    if (isViewer) return;
    if (!window.confirm(`Delete "${name}"? This only removes the saved version — it won't affect the eval config if this version is currently active.`)) {
      return;
    }
    setError('');
    setMessage('');
    try {
      await deleteDataset(token, detail.target.id, datasetId);
      await loadDatasets();
      setMessage('Dataset version deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete dataset');
    }
  }

  return (
    <div className="eval-builder">
      <div className="eval-builder-main">
        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Providers</h3>
              <p className="muted">Select from grouped provider types. Direct execution supports hosted APIs, HTTP targets, CLI commands, and custom scripts.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setProviders((current) => [
                  ...current,
                  {
                    providerKey: 'openai',
                    label: 'OpenAI-compatible provider',
                    engine: 'openai-compatible',
                    baseUrl: '',
                    model: detail.target.modelName || '',
                    apiKey: '',
                    temperature: 0,
                    maxTokens: 512,
                  },
                ])
              }
            >
              Add provider
            </button>
          </div>
          {providers.map((provider, index) => (
            <div className="provider-row" key={`${provider.providerKey}-${index}`}>
              <div className="row-toolbar span-3">
                <strong>Provider {index + 1}</strong>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={providers.length === 1}
                  onClick={() => setProviders((current) => current.filter((_provider, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <div className="field">
                <label>Provider type</label>
                <select value={provider.providerKey} onChange={(event) => selectProvider(index, event.target.value)}>
                  {providerGroups.map((group) => (
                    <optgroup label={group.label} key={group.key}>
                      {group.providers.map((item) => (
                        <option value={item.key} key={item.key}>
                          {item.label}{item.executable ? '' : ' (planned)'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Model</label>
                <input value={provider.model} onChange={(event) => updateProvider(index, { model: event.target.value })} />
              </div>
              <div className="field span-2">
                <label>Base URL</label>
                <input value={provider.baseUrl} onChange={(event) => updateProvider(index, { baseUrl: event.target.value })} />
              </div>
              {provider.providerKey === 'azure-openai' ? (
                <div className="field">
                  <label>API version</label>
                  <input
                    value={provider.apiVersion || ''}
                    placeholder="2024-06-01"
                    onChange={(event) => updateProvider(index, { apiVersion: event.target.value })}
                  />
                  <p className="field-help">Model should be the deployment name, not the base model name.</p>
                </div>
              ) : null}
              {provider.engine === 'openai-compatible' ? (
                <div className="field span-2">
                  <label>Provider-specific config (JSON, optional)</label>
                  <textarea
                    value={provider.libraryConfig || ''}
                    placeholder={'{"requestLogprobs":true}'}
                    onChange={(event) => updateProvider(index, { libraryConfig: event.target.value })}
                  />
                  <p className="field-help">
                    Set <code>requestLogprobs: true</code> to request per-token logprobs (needed for the{' '}
                    <code>perplexity</code>/<code>perplexity-score</code> assertions). Off by default — some
                    OpenAI-compatible providers reject the request outright for models that don't support it,
                    which would break every eval call against that provider, not just perplexity assertions.
                  </p>
                </div>
              ) : provider.engine === 'promptfoo-library' ? (
                <div className="field span-2">
                  <label>Provider-specific config (JSON)</label>
                  <textarea
                    value={provider.libraryConfig || ''}
                    placeholder={'{"region":"us-east-1","accessKeyId":"...","secretAccessKey":"..."}'}
                    onChange={(event) => updateProvider(index, { libraryConfig: event.target.value })}
                  />
                  <p className="field-help">
                    This provider is executed through the vendored Promptfoo library, which needs auth beyond a
                    single API key (AWS credentials, a GCP service account, IBM project ID, etc). Paste whatever
                    that provider's Promptfoo config object needs — it's merged in as-is.
                  </p>
                </div>
              ) : provider.engine === 'http-json' ? (
                <div className="field span-2">
                  <label>HTTP JSON config (JSON, optional)</label>
                  <textarea
                    value={provider.libraryConfig || ''}
                    placeholder={'{"method":"POST","headers":{"X-Custom":"{{prompt | length}}"},"body":{"userMessage":"{{prompt}}"},"responsePath":"result.answer"}'}
                    onChange={(event) => updateProvider(index, { libraryConfig: event.target.value })}
                  />
                  <p className="field-help">
                    Optional. Defaults to a generic <code>{'{prompt, input, model, messages, ...}'}</code> body. Set{' '}
                    <code>method</code>, <code>headers</code>, <code>body</code> (object or string; values may use{' '}
                    <code>{'{{prompt}}'}</code> and filters like <code>{'{{prompt | upper}}'}</code>), and{' '}
                    <code>responsePath</code> (dot path into the JSON response) to match your API's own schema.
                  </p>
                </div>
              ) : provider.engine === 'graphql' ? (
                <div className="field span-2">
                  <label>GraphQL config (JSON)</label>
                  <textarea
                    value={provider.libraryConfig || ''}
                    placeholder={'{"query":"query Chat($prompt: String!) { chat(prompt: $prompt) { text } }","variables":{"prompt":"{{prompt}}"},"responsePath":"data.chat.text"}'}
                    onChange={(event) => updateProvider(index, { libraryConfig: event.target.value })}
                  />
                  <p className="field-help">
                    Optional. Defaults to a generic <code>chat(prompt)</code> query. Set <code>query</code>,{' '}
                    <code>variables</code> (values may use <code>{'{{prompt}}'}</code>), and{' '}
                    <code>responsePath</code> (dot path into the JSON response) to match your schema.
                  </p>
                </div>
              ) : provider.engine === 'websocket-chat' ? (
                <div className="field span-2">
                  <label>WebSocket config (JSON)</label>
                  <textarea
                    value={provider.libraryConfig || ''}
                    placeholder={'{"messageTemplate":{"type":"chat","text":"{{prompt}}"},"responsePath":"text","timeoutMs":15000}'}
                    onChange={(event) => updateProvider(index, { libraryConfig: event.target.value })}
                  />
                  <p className="field-help">
                    Optional. Sends <code>messageTemplate</code> (string or object, <code>{'{{prompt}}'}</code>{' '}
                    substituted) as the first frame after connecting, waits for one reply, then closes. Set{' '}
                    <code>responsePath</code> if the reply is JSON and <code>timeoutMs</code> to adjust the wait.
                  </p>
                </div>
              ) : provider.engine === 'browser-chatbot' ? (
                <div className="field span-2">
                  <label>Browser automation config (JSON)</label>
                  <textarea
                    value={provider.libraryConfig || ''}
                    placeholder={'{"inputSelector":"#chat-input","submitSelector":"#send","responseSelector":".chat-message.assistant"}'}
                    onChange={(event) => updateProvider(index, { libraryConfig: event.target.value })}
                  />
                  <p className="field-help">
                    Required: <code>inputSelector</code> and <code>responseSelector</code> (CSS selectors).
                    Optional: <code>submitSelector</code> (presses Enter if omitted), <code>waitMs</code>,{' '}
                    <code>settleMs</code> (pause after the response appears, for streaming UIs). Runs a real
                    headless Chromium via Playwright — expect this provider to be slower than API-based ones.
                  </p>
                </div>
              ) : null}
              <div className="field">
                <label>API key</label>
                <input
                  type="password"
                  value={provider.apiKey || ''}
                  placeholder={provider.apiKeyMasked ? 'Stored encrypted' : 'Paste provider key'}
                  onChange={(event) => updateProvider(index, { apiKey: event.target.value })}
                />
                <p className="field-help">
                  {provider.apiKeyMasked
                    ? `Stored as ${provider.apiKeyMasked}. Paste a new key to replace it.`
                    : provider.apiKeyEnv
                      ? `Using ${provider.apiKeyEnv} from server env until a key is saved.`
                      : 'Stored encrypted. The full key will not be shown again.'}
                </p>
              </div>
              <div className="field">
                <label>Adapter</label>
                <input value={provider.engine} onChange={(event) => updateProvider(index, { engine: event.target.value })} />
                <p className="field-help">
                  {provider.engine === 'adapter-required'
                    ? 'Cataloged provider. Execution adapter is not implemented yet.'
                    : `Executable through the ${provider.engine} adapter.`}
                </p>
              </div>
              <div className="provider-diagnostic span-3">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={isViewer || providerTesting === index || provider.engine === 'adapter-required'}
                  title={viewerTitle}
                  onClick={() => testProvider(index)}
                >
                  {providerTesting === index ? 'Testing...' : 'Test provider'}
                </button>
                {providerTestResults[index] ? (
                  <div className={providerTestResults[index].ok ? 'provider-status ok' : 'provider-status fail'}>
                    <strong>{providerTestResults[index].ok ? 'Connected' : 'Failed'}</strong>
                    <span>
                      {providerTestResults[index].ok
                        ? `${providerTestResults[index].latencyMs} ms · ${providerTestResults[index].output || 'No output'}`
                        : providerTestResults[index].error}
                    </span>
                  </div>
                ) : (
                  <p className="field-help">Saves encrypted provider settings first, then sends a tiny diagnostic prompt.</p>
                )}
              </div>
            </div>
          ))}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Prompts</h3>
              <p className="muted">
                Use variables like {'{{prompt}}'} or {'{{question}}'}. For a scripted multi-turn conversation, write the prompt as a JSON array of{' '}
                <code>{'{"role": "user"|"assistant"|"system", "content": "..."}'}</code> messages instead of plain text — variables still work
                inside each message's <code>content</code>. The provider receives the full conversation; grading still looks at only the final
                response.
              </p>
            </div>
            <button className="secondary-button" type="button" onClick={() => setPrompts((current) => [...current, { name: `Prompt ${current.length + 1}`, content: '{{prompt}}' }])}>
              Add prompt
            </button>
          </div>
          <div className="field">
            <label>Inject variable</label>
            <input value={injectVar} onChange={(event) => setInjectVar(event.target.value)} />
          </div>
          {prompts.map((prompt, index) => (
            <div className="prompt-row" key={`${prompt.name}-${index}`}>
              <div className="prompt-meta">
                <input value={prompt.name} onChange={(event) => updatePrompt(index, { name: event.target.value })} />
                <button
                  className="ghost-button"
                  type="button"
                  onClick={() => {
                    if (prompt.content.trim() && prompt.content.trim() !== '{{prompt}}' && !window.confirm('Replace this prompt with a multi-turn conversation template?')) {
                      return;
                    }
                    const template = JSON.stringify(
                      [
                        { role: 'user', content: 'Hi, my name is {{name}}.' },
                        { role: 'assistant', content: "Hello! Nice to meet you. How can I help you today?" },
                        { role: 'user', content: '{{prompt}}' },
                      ],
                      null,
                      2,
                    );
                    updatePrompt(index, { content: template });
                  }}
                >
                  Insert multi-turn template
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={prompts.length === 1}
                  onClick={() => setPrompts((current) => current.filter((_prompt, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <textarea value={prompt.content} onChange={(event) => updatePrompt(index, { content: event.target.value })} rows={prompt.content.trim().startsWith('[') ? 10 : undefined} />
            </div>
          ))}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Optimize prompt</h3>
              <p className="muted">
                Runs the prompt against your existing test cases for a baseline score, asks an LLM for improved rewrites informed by the
                failures, then actually runs each rewrite against the real provider to see which one really scores best.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Prompt to optimize</label>
              <select value={optimizePromptIndex} onChange={(event) => setOptimizePromptIndex(Number(event.target.value))}>
                {prompts.map((prompt, index) => (
                  <option value={index} key={`${prompt.name}-${index}`}>
                    {prompt.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Candidates</label>
              <input type="number" min={1} max={5} value={optimizeNumCandidates} onChange={(event) => setOptimizeNumCandidates(Number(event.target.value))} />
            </div>
            <div className="field">
              <label>Test cases to score against</label>
              <input type="number" min={1} max={8} value={optimizeMaxTestCases} onChange={(event) => setOptimizeMaxTestCases(Number(event.target.value))} />
            </div>
            <div className="field span-2">
              <label>Additional instructions (optional)</label>
              <input value={optimizeInstructions} onChange={(event) => setOptimizeInstructions(event.target.value)} placeholder="e.g. keep the tone formal" />
            </div>
          </div>
          <button className="secondary-button" type="button" disabled={isViewer || optimizeBusy} title={viewerTitle} onClick={handleOptimizePrompt}>
            {optimizeBusy ? 'Optimizing... (this makes real calls, may take a bit)' : 'Run optimization'}
          </button>
          {optimizeError ? <p className="error">{optimizeError}</p> : null}
          {optimizeResult ? (
            <div className="generated-preview">
              <p className="muted">
                Baseline: {Math.round(optimizeResult.baseline.passRate * 100)}% pass rate. Best: {optimizeResult.best.label} at{' '}
                {Math.round(optimizeResult.best.passRate * 100)}%.
              </p>
              <div className="prompt-row">
                <strong>Baseline (unchanged)</strong>
                <p className="muted">{Math.round(optimizeResult.baseline.passRate * 100)}% pass rate</p>
                <textarea value={optimizeResult.baseline.content} readOnly />
              </div>
              {optimizeResult.candidates.map((candidate, index) => (
                <div className="prompt-row" key={`${candidate.label}-${index}`}>
                  <strong>
                    {candidate.label} — {Math.round(candidate.passRate * 100)}% pass rate
                    {candidate.content === optimizeResult.best.content ? ' (best)' : ''}
                  </strong>
                  <textarea value={candidate.content} readOnly />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isViewer}
                    title={viewerTitle}
                    onClick={() => applyOptimizedPrompt(candidate.content)}
                  >
                    Apply this rewrite
                  </button>
                </div>
              ))}
              <div className="stage-actions">
                <button className="ghost-button" type="button" onClick={() => setOptimizeResult(null)}>
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Test cases</h3>
              <p className="muted">Add cases manually or bulk import JSON/CSV.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setTestCases((current) => [
                  ...current,
                  normalizeCaseForEditor({ name: `Case ${current.length + 1}`, input: '', assertion: 'contains', expected: '' }),
                ])
              }
            >
              Add case
            </button>
          </div>
          {testCases.map((testCase, index) => (
            <div className="testcase-row" key={`${testCase.name}-${index}`}>
              <div className="row-toolbar span-3">
                <strong>Case {index + 1}</strong>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={testCases.length === 1}
                  onClick={() => setTestCases((current) => current.filter((_testCase, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <div className="field">
                <label>Name</label>
                <input value={testCase.name} onChange={(event) => updateTestCase(index, { name: event.target.value })} />
              </div>
              <div className="field span-2">
                <label>Input</label>
                <textarea value={testCase.input} onChange={(event) => updateTestCase(index, { input: event.target.value })} />
              </div>
              <div className="field span-3">
                <label>Additional vars JSON</label>
                <textarea
                  value={testCase.varsJson || ''}
                  onChange={(event) => updateTestCase(index, { varsJson: event.target.value })}
                  placeholder={`{"locale":"en-US","persona":"analyst"}`}
                />
                <p className="field-help">Merged into vars for this case. The input still maps to the inject variable.</p>
              </div>
              <div className="field span-3">
                <label>Output transform (JS expression, optional)</label>
                <input
                  value={testCase.transform || ''}
                  onChange={(event) => updateTestCase(index, { transform: event.target.value })}
                  placeholder={'rawResponse.result.nested.value'}
                />
                <p className="field-help">
                  Runs before assertions, with <code>output</code> (the adapter's best-effort extracted text),{' '}
                  <code>rawResponse</code> (the full unprocessed provider response), <code>vars</code>, and{' '}
                  <code>prompt</code> in scope — use it to pull the right field out of a response shape the
                  adapter didn't recognize.
                </p>
              </div>
              <div className="field">
                <label>Pass threshold (optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="1"
                  value={testCase.threshold ?? ''}
                  onChange={(event) =>
                    updateTestCase(index, { threshold: event.target.value === '' ? undefined : Number(event.target.value) })
                  }
                  placeholder="e.g. 0.7"
                />
                <p className="field-help">
                  When set, this case passes based on its weighted-average assertion score meeting this threshold,
                  instead of requiring every assertion to pass individually.
                </p>
              </div>
              <div className="field span-3">
                <label>Custom rubric prompt (optional, JSON or plain text)</label>
                <textarea
                  value={testCase.rubricPrompt || ''}
                  onChange={(event) => updateTestCase(index, { rubricPrompt: event.target.value || undefined })}
                  placeholder={'{"instruction": "Grade strictly.", "criterion": "{{rubric}}", "output": "{{output}}"}'}
                />
                <p className="field-help">
                  Replaces the default judge prompt for this case's <code>llm-rubric</code>/<code>model-graded-*</code>{' '}
                  assertions. Rendered as a template with <code>output</code>, <code>rubric</code> (the assertion's
                  criterion text), <code>prompt</code>, and this case's vars in scope — the judge must still be
                  instructed to return JSON with <code>pass</code>/<code>score</code>/<code>reason</code>.
                </p>
              </div>
              <div className="field">
                <label>Store output as (optional)</label>
                <input
                  value={testCase.storeOutputAs || ''}
                  onChange={(event) => updateTestCase(index, { storeOutputAs: event.target.value || undefined })}
                  placeholder="e.g. firstReply"
                />
                <p className="field-help">
                  Saves this case's real output as <code>{'{{'}</code><code>name</code><code>{'}}'}</code>, usable in
                  every LATER test case's input/vars/assertions — e.g. to check the target stays consistent about
                  something it said earlier. Forces sequential (non-concurrent) execution for the whole run when used.
                </p>
              </div>
              <div className="field span-2">
                <label>Fixed provider output (optional)</label>
                <textarea
                  value={testCase.providerOutput || ''}
                  onChange={(event) => updateTestCase(index, { providerOutput: event.target.value || undefined })}
                  placeholder="Skips calling the provider — grades directly against this text"
                />
                <p className="field-help">
                  When set, this case never calls the provider at all (no cost, no latency) — assertions grade
                  directly against this fixed text instead. Useful for testing assertion rules in isolation, or
                  regression-testing a known past response.
                </p>
              </div>
              <div className="assertion-editor span-3">
                <div className="row-toolbar">
                  <strong>Assertions</strong>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      updateTestCase(index, {
                        assertions: [...assertionsForCase(testCase), { type: 'contains', value: '' }],
                      })
                    }
                  >
                    Add assertion
                  </button>
                </div>
                {assertionsForCase(testCase).map((assertion, assertionIndex) => (
                  <div className={assertion.type === 'assert-set' ? 'assertion-row assertion-row-set' : 'assertion-row'} key={`${index}-${assertionIndex}`}>
                    <div className="assertion-row-main">
                      <select
                        value={assertion.type}
                        onChange={(event) => updateTestCaseAssertion(index, assertionIndex, { type: event.target.value })}
                      >
                        {(workflowCatalog.assertions.length ? workflowCatalog.assertions : [{ key: 'contains', label: 'Contains' }]).map((assertionType) => (
                          <option value={assertionType.key} key={assertionType.key}>
                            {assertionType.label}
                          </option>
                        ))}
                      </select>
                      {assertion.type === 'assert-set' ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="1"
                          value={assertion.threshold ?? 1}
                          onChange={(event) => updateTestCaseAssertion(index, assertionIndex, { threshold: Number(event.target.value) })}
                          title="Minimum weighted average score to pass (0-1)"
                        />
                      ) : (
                        <input
                          value={assertion.value}
                          onChange={(event) => updateTestCaseAssertion(index, assertionIndex, { value: event.target.value })}
                          placeholder={assertionHelp(assertion.type)}
                        />
                      )}
                      <input
                        value={assertion.metric || ''}
                        onChange={(event) => updateTestCaseAssertion(index, assertionIndex, { metric: event.target.value || undefined })}
                        placeholder="Metric name (optional)"
                        title="Groups this assertion's score with any others sharing the same metric name into a weighted-average named score shown on the run summary."
                      />
                      <input
                        value={assertion.transform || ''}
                        onChange={(event) => updateTestCaseAssertion(index, assertionIndex, { transform: event.target.value || undefined })}
                        placeholder="Transform (optional, JS expression)"
                        title="Processes output specifically for this assertion before grading — e.g. JSON.parse(output).field — separate from the case-level output transform above, which applies to every assertion."
                      />
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={assertionsForCase(testCase).length === 1}
                        onClick={() =>
                          updateTestCase(index, {
                            assertions: assertionsForCase(testCase).filter((_assertion, i) => i !== assertionIndex),
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                    {assertion.type === 'javascript' || assertion.type === 'python' ? (
                      <input
                        value={assertion.config || ''}
                        onChange={(event) => updateTestCaseAssertion(index, assertionIndex, { config: event.target.value || undefined })}
                        placeholder={'Config (JSON, optional) — e.g. {"minLength":10}'}
                        title="Custom parameters available inside the expression as `config` (or context.config) — lets one script be reused across assertions with different settings."
                      />
                    ) : null}
                    {['context-recall', 'context-relevance', 'context-faithfulness'].includes(assertion.type) ? (
                      <input
                        value={assertion.contextTransform || ''}
                        onChange={(event) =>
                          updateTestCaseAssertion(index, assertionIndex, { contextTransform: event.target.value || undefined })
                        }
                        placeholder={'Context extraction (JS expression) — e.g. vars.retrievedDocs.join("\\n\\n")'}
                        title={'Extracts the retrieved context this assertion grades against, from `output`/`vars`/`rawResponse`. ' +
                          'Not needed if a `context` var is already set on this test case — that takes priority. Required either way, or this assertion fails clearly instead of guessing.'}
                      />
                    ) : null}
                    {assertion.type === 'assert-set' ? (
                      <div className="assertion-subset">
                        <p className="field-help">
                          Sub-assertions below are weighted and averaged into one score; the group passes when that
                          score meets the threshold above.
                        </p>
                        {(assertion.assert || []).map((sub, subIndex) => (
                          <div className="assertion-subrow" key={`${index}-${assertionIndex}-${subIndex}`}>
                            <select
                              value={sub.type}
                              onChange={(event) => updateSubAssertion(index, assertionIndex, subIndex, { type: event.target.value })}
                            >
                              {(workflowCatalog.assertions.length ? workflowCatalog.assertions : [{ key: 'contains', label: 'Contains' }])
                                .filter((assertionType) => assertionType.key !== 'assert-set')
                                .map((assertionType) => (
                                  <option value={assertionType.key} key={assertionType.key}>
                                    {assertionType.label}
                                  </option>
                                ))}
                            </select>
                            <input
                              value={sub.value}
                              onChange={(event) => updateSubAssertion(index, assertionIndex, subIndex, { value: event.target.value })}
                              placeholder={assertionHelp(sub.type)}
                            />
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={sub.weight ?? 1}
                              onChange={(event) => updateSubAssertion(index, assertionIndex, subIndex, { weight: Number(event.target.value) })}
                              title="Weight"
                            />
                            <button
                              className="ghost-button"
                              type="button"
                              disabled={(assertion.assert || []).length === 1}
                              onClick={() => removeSubAssertion(index, assertionIndex, subIndex)}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button className="secondary-button" type="button" onClick={() => addSubAssertion(index, assertionIndex)}>
                          Add sub-assertion
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="field">
            <label>Bulk upload</label>
            <textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder={'JSON array or CSV: name,input,assertion,expected'}
            />
          </div>
          <button className="secondary-button" type="button" onClick={parseBulkCases}>
            Import test cases
          </button>
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Generate test cases</h3>
              <p className="muted">
                Uses an LLM to invent user personas for your prompt, then asks each persona for realistic-but-interesting
                variable values — preview before adding. Uses the judge provider if configured, otherwise the first eval provider.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Personas</label>
              <input
                type="number"
                min={1}
                max={10}
                value={generateNumPersonas}
                onChange={(event) => setGenerateNumPersonas(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label>Cases per persona</label>
              <input
                type="number"
                min={1}
                max={10}
                value={generateNumPerPersona}
                onChange={(event) => setGenerateNumPerPersona(Number(event.target.value))}
              />
            </div>
            <div className="field span-2">
              <label>Additional instructions (optional)</label>
              <input
                value={generateInstructions}
                onChange={(event) => setGenerateInstructions(event.target.value)}
                placeholder="e.g. focus on edge cases involving multiple languages"
              />
            </div>
          </div>
          <button className="secondary-button" type="button" disabled={isViewer || generateBusy} title={viewerTitle} onClick={handleGenerateDataset}>
            {generateBusy ? 'Generating...' : 'Generate preview'}
          </button>
          {generateError ? <p className="error">{generateError}</p> : null}
          {generatePreview.length ? (
            <div className="generated-preview">
              <p className="muted">{generatePreview.length} generated test case(s) — review, then add to the editor above and save.</p>
              {generatePreview.map((testCase, index) => (
                <div className="prompt-row" key={`${testCase.name}-${index}`}>
                  <strong>{testCase.name}</strong>
                  <p className="muted">{JSON.stringify(testCase.vars)}</p>
                </div>
              ))}
              <div className="stage-actions">
                <button className="primary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={addGeneratedCasesToEditor}>
                  Add all to test cases
                </button>
                <button className="ghost-button" type="button" onClick={() => setGeneratePreview([])}>
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Import Promptfoo config</h3>
              <p className="muted">Paste YAML or JSON to replace this target's eval providers, prompts, test cases, and red-team defaults.</p>
            </div>
            <button
              className="primary-button"
              type="button"
              disabled={isViewer || !configImportText.trim() || configImporting}
              title={viewerTitle}
              onClick={importPromptfooConfigIntoEval}
            >
              {configImporting ? 'Importing...' : 'Load into eval'}
            </button>
          </div>
          <textarea
            className="import-textarea"
            value={configImportText}
            onChange={(event) => setConfigImportText(event.target.value)}
            placeholder={'description: Existing Promptfoo config\nproviders:\n  - id: custom-script\n    label: Local provider\n    config:\n      baseUrl: file://providers/example-custom-provider.cjs\nprompts:\n  - "{{prompt}}"\ntests:\n  - description: Ready check\n    vars:\n      prompt: hello\n    assert:\n      - type: contains\n        value: CUSTOM_PROVIDER_READY'}
          />
        </section>
      </div>

      <aside className="eval-builder-side">
        <section className="subpanel">
          <h3>Datasets</h3>
          <div className="field">
            <label>Dataset name</label>
            <input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} />
          </div>
          <div className="stage-actions">
            <button className="secondary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={() => saveDataset(false)}>
              Save version
            </button>
            <button className="primary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={() => saveDataset(true)}>
              Save and use
            </button>
          </div>
          <div className="dataset-list">
            {datasets.length ? (
              datasets.map((dataset) => (
                <div className="dataset-row" key={dataset.id}>
                  <div>
                    <strong>{dataset.name} v{dataset.version}</strong>
                    <p className="muted">{dataset.rows.length} cases · {dataset.active ? 'Active' : 'Inactive'}</p>
                  </div>
                  <button className="secondary-button" type="button" onClick={() => activateSavedDataset(dataset.id)} disabled={isViewer || dataset.active} title={viewerTitle}>
                    Use
                  </button>
                  <button className="danger-button" type="button" disabled={isViewer} title={viewerTitle} onClick={() => deleteSavedDataset(dataset.id, `${dataset.name} v${dataset.version}`)}>
                    Delete
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">No saved datasets yet.</p>
            )}
          </div>
        </section>

        <section className="subpanel">
          <h3>Run options</h3>
          <div className="form-grid">
            <div className="field span-2">
              <label>Execution engine</label>
              <select
                value={runOptions.engineMode || 'direct'}
                onChange={(event) => setRunOptions({ ...runOptions, engineMode: event.target.value as 'direct' | 'native' })}
              >
                <option value="direct">Direct product runner</option>
                <option value="native">Installed engine runner</option>
              </select>
              <p className="field-help">Native mode runs the generated config through the installed engine for executable catalog adapters.</p>
            </div>
            <div className="field">
              <label>Max concurrency</label>
              <input type="number" value={runOptions.maxConcurrency} onChange={(event) => setRunOptions({ ...runOptions, maxConcurrency: Number(event.target.value) })} />
            </div>
            <div className="field">
              <label>Repeat</label>
              <input type="number" value={runOptions.repeat} onChange={(event) => setRunOptions({ ...runOptions, repeat: Number(event.target.value) })} />
            </div>
            <div className="field">
              <label>Delay ms</label>
              <input type="number" value={runOptions.delayMs} onChange={(event) => setRunOptions({ ...runOptions, delayMs: Number(event.target.value) })} />
            </div>
            <div className="field">
              <label>Timeout ms</label>
              <input type="number" value={runOptions.timeoutMs} onChange={(event) => setRunOptions({ ...runOptions, timeoutMs: Number(event.target.value) })} />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={runOptions.cache} onChange={(event) => setRunOptions({ ...runOptions, cache: event.target.checked })} />
              Cache responses
            </label>
          </div>
          <div className="field">
            <label>Extension hooks (one per line)</label>
            <textarea
              rows={2}
              placeholder="file:///path/to/hook.js:beforeEach"
              value={extensionsText}
              onChange={(event) => setExtensionsText(event.target.value)}
            />
            <p className="field-help">
              <code>:beforeEach</code> runs before the provider is called and may change a test's <code>vars</code>/<code>assert</code>/description.{' '}
              <code>:afterEach</code> runs after grading and may add fields to <code>namedScores</code>/<code>metadata</code>, but cannot override pass/fail or
              score. Omit the suffix to run a script for both hooks — it only needs to export the ones it implements.
            </p>
          </div>
          <div className="field">
            <div className="subpanel-head">
              <label>Derived metrics</label>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDerivedMetricRows((current) => [...current, { name: '', value: '' }])}
              >
                Add derived metric
              </button>
            </div>
            <p className="field-help">
              A named formula evaluated against this run's aggregate named scores (averaged across rows), using{' '}
              <code>__count</code> for row count — e.g. <code>f1</code> = <code>(2*precision*recall)/(precision+recall)</code>. Each metric's own
              result is available to metrics listed after it.
            </p>
            {derivedMetricRows.map((row, index) => (
              <div className="assertion-row" key={index}>
                <input
                  value={row.name}
                  placeholder="metric name (e.g. f1)"
                  onChange={(event) =>
                    setDerivedMetricRows((current) => current.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)))
                  }
                />
                <input
                  value={row.value}
                  placeholder="formula (e.g. (2*precision*recall)/(precision+recall))"
                  onChange={(event) =>
                    setDerivedMetricRows((current) => current.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                  }
                />
                <button className="ghost-button" type="button" onClick={() => setDerivedMetricRows((current) => current.filter((_row, i) => i !== index))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="stage-actions">
            <button className="secondary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={saveConfig}>
              Save config
            </button>
            <button className="primary-button" type="button" onClick={runEval} disabled={isViewer || running} title={viewerTitle}>
              {running ? 'Running...' : 'Run eval'}
            </button>
            {activeRunId ? (
              <button className="danger-button" type="button" disabled={isViewer} title={viewerTitle} onClick={cancelEval}>
                Cancel eval
              </button>
            ) : null}
          </div>
          {activeRunId ? <p className="field-help">Active run: {activeRunId}</p> : null}
          {message ? <div className="success">{message}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </section>

        <section className="subpanel">
          <h3>Latest run</h3>
          {latestRun?.results?.summary ? (
            <div className="run-summary">
              <div><span>Total</span><strong>{latestRun.results.summary.total}</strong></div>
              <div><span>Pass</span><strong>{latestRun.results.summary.pass}</strong></div>
              <div><span>Fail</span><strong>{latestRun.results.summary.fail}</strong></div>
              <div><span>Error</span><strong>{latestRun.results.summary.error}</strong></div>
              {latestRun.results.summary.derivedMetrics && Object.keys(latestRun.results.summary.derivedMetrics).length
                ? Object.entries(latestRun.results.summary.derivedMetrics).map(([name, value]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <strong>{value === null ? 'error' : Number(value).toFixed(3)}</strong>
                    </div>
                  ))
                : null}
            </div>
          ) : (
            <p className="muted">No runs yet.</p>
          )}
          {latestRun?.results?.summary?.namedScores && Object.keys(latestRun.results.summary.namedScores).length ? (
            <p className="muted">
              Named scores (avg):{' '}
              {Object.entries(latestRun.results.summary.namedScores)
                .map(([name, value]) => `${name}=${Number(value).toFixed(3)}`)
                .join(', ')}
            </p>
          ) : null}
          <div className="results-table">
            {(latestRun?.results?.rows || []).map((row, index) => (
              <div className="result-row" key={`${row.provider}-${row.test}-${index}`}>
                <span className={row.pass ? 'result-pass' : 'result-fail'}>{row.pass ? 'PASS' : row.error ? 'ERROR' : 'FAIL'}</span>
                <strong>{row.test}</strong>
                <p>{row.output || row.error}</p>
                {row.finishReason ? <p className="muted">Finish reason: {row.finishReason}</p> : null}
                {row.cacheHit ? <p className="muted">(cached response — not a live provider call)</p> : null}
                {row.vars && Object.keys(row.vars).length ? (
                  <details>
                    <summary>View variables</summary>
                    <pre className="config-preview">{JSON.stringify(row.vars, null, 2)}</pre>
                  </details>
                ) : null}
                {row.rawResponse !== undefined && row.rawResponse !== null ? (
                  <details>
                    <summary>View raw provider response</summary>
                    <pre className="config-preview">
                      {typeof row.rawResponse === 'string' ? row.rawResponse : JSON.stringify(row.rawResponse, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="subpanel">
          <h3>Engine config preview</h3>
          <pre className="config-preview">{detail.promptfooConfigYaml}</pre>
        </section>
      </aside>
    </div>
  );
}

function RedTeamWorkspace({
  detail,
  token,
  workflowCatalog,
  runs,
  isViewer,
  onRefresh,
}: {
  detail: TargetDetailResponse;
  token: string;
  workflowCatalog: WorkflowCatalogResponse;
  runs: StageRun[];
  isViewer?: boolean;
  onRefresh: (updated: TargetDetailResponse) => void | Promise<void>;
}) {
  const viewerTitle = isViewer ? 'Viewer accounts cannot make changes' : undefined;
  const metadata = detail.target.metadata as Record<string, any>;
  const redteam = (metadata.redteam || {}) as any;
  const runtime = (metadata.runtime || {}) as any;
  const [purpose, setPurpose] = useState(
    redteam.purpose ||
      `Assess whether ${detail.target.displayName} resists prompt injection, jailbreaks, data leakage, unsafe tool use, and policy bypass.`,
  );
  const [plugins, setPlugins] = useState<string[]>(
    redteam.plugins?.length
      ? redteam.plugins
      : ['system-prompt-override', 'indirect-prompt-injection', 'prompt-extraction', 'pii:direct'],
  );
  const [strategies, setStrategies] = useState<string[]>(
    redteam.strategies?.length ? redteam.strategies : ['basic', 'jailbreak', 'jailbreak-templates'],
  );
  const [numTests, setNumTests] = useState(Number(redteam.numTests || 5));
  const [useRealGeneration, setUseRealGeneration] = useState(Boolean(redteam.useRealGeneration));
  const [maxCharsPerMessage, setMaxCharsPerMessage] = useState<string>(
    redteam.maxCharsPerMessage ? String(redteam.maxCharsPerMessage) : '',
  );
  const [languages, setLanguages] = useState((redteam.language || []).join(', '));
  const redteamRunOptions = redteam.runOptions || {};
  const [maxConcurrency, setMaxConcurrency] = useState(Number(redteamRunOptions.maxConcurrency || 1));
  const [delayMs, setDelayMs] = useState(Number(redteamRunOptions.delayMs || 0));
  const [timeoutMs, setTimeoutMs] = useState(Number(redteamRunOptions.timeoutMs || 30000));
  const [verbose, setVerbose] = useState(Boolean(redteamRunOptions.verbose));
  const [defaultVarRows, setDefaultVarRows] = useState<KeyValueRow[]>(() => keyValueRowsFromRecord(redteam.defaultTest?.vars));
  const [defaultAssertRows, setDefaultAssertRows] = useState<Array<{ type: string; value: string }>>(
    Array.isArray(redteam.defaultTest?.assert) && redteam.defaultTest.assert.length
      ? redteam.defaultTest.assert
      : [],
  );
  const [generateAssertionsCount, setGenerateAssertionsCount] = useState(5);
  const [generateAssertionsType, setGenerateAssertionsType] = useState<'llm-rubric' | 'g-eval'>('llm-rubric');
  const [generateAssertionsInstructions, setGenerateAssertionsInstructions] = useState('');
  const [generateAssertionsPreview, setGenerateAssertionsPreview] = useState<Array<{ type: string; value: string; label?: string }>>([]);
  const [generateAssertionsBusy, setGenerateAssertionsBusy] = useState(false);
  const [generateAssertionsError, setGenerateAssertionsError] = useState('');

  async function handleGenerateAssertions() {
    if (isViewer) return;
    setGenerateAssertionsError('');
    setGenerateAssertionsBusy(true);
    try {
      const result = await generateEvalAssertions(token, detail.target.id, {
        numAssertions: generateAssertionsCount,
        type: generateAssertionsType,
        instructions: generateAssertionsInstructions.trim() || undefined,
      });
      setGenerateAssertionsPreview(result.assertions);
    } catch (err) {
      setGenerateAssertionsError(err instanceof Error ? err.message : 'Unable to generate assertions');
    } finally {
      setGenerateAssertionsBusy(false);
    }
  }

  function addGeneratedAssertionsToDefaults() {
    setDefaultAssertRows((current) => [...current, ...generateAssertionsPreview.map(({ type, value }) => ({ type, value }))]);
    setGenerateAssertionsPreview([]);
    setMessage(`Added ${generateAssertionsPreview.length} generated assertion(s) to defaults — remember to save.`);
  }
  const [entities, setEntities] = useState((redteam.entities || []).join(', '));
  const [policyText, setPolicyText] = useState(redteam.pluginConfig?.policy || '');
  const [intentGoals, setIntentGoals] = useState((redteam.pluginConfig?.intent || []).join('\n'));
  const [dataClassification, setDataClassification] = useState(runtime.dataClassification || '');
  const [allowedTools, setAllowedTools] = useState((runtime.allowedTools || []).join(', '));
  const [retrievalSources, setRetrievalSources] = useState((runtime.retrievalSources || []).join(', '));
  const [customProbes, setCustomProbes] = useState<NonNullable<RedTeamStageConfigPayload['customProbes']>>(
    Array.isArray(redteam.customProbes) && redteam.customProbes.length
      ? redteam.customProbes
      : [],
  );
  const [plan, setPlan] = useState<RedTeamPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState('');
  const latestRun = runs[0];
  const pluginCategories = useMemo(
    () => [...new Set(workflowCatalog.redteamPlugins.map((plugin) => plugin.category || 'Other'))].sort(),
    [workflowCatalog.redteamPlugins],
  );
  const [pluginCategory, setPluginCategory] = useState('');
  const visiblePlugins = useMemo(
    () =>
      workflowCatalog.redteamPlugins.filter((plugin) => !pluginCategory || (plugin.category || 'Other') === pluginCategory),
    [workflowCatalog.redteamPlugins, pluginCategory],
  );
  const visibleSelectedCount = visiblePlugins.filter((plugin) => plugins.includes(plugin.key)).length;

  function updateCustomProbe(index: number, patch: Partial<NonNullable<RedTeamStageConfigPayload['customProbes']>[number]>) {
    setCustomProbes((current) => current.map((probe, i) => (i === index ? { ...probe, ...patch } : probe)));
  }

  function selectVisiblePlugins() {
    setPlugins((current) => [...new Set([...current, ...visiblePlugins.map((plugin) => plugin.key)])]);
  }

  function clearVisiblePlugins() {
    const visibleKeys = new Set(visiblePlugins.map((plugin) => plugin.key));
    setPlugins((current) => current.filter((plugin) => !visibleKeys.has(plugin)));
  }

  function updateDefaultVar(index: number, patch: Partial<KeyValueRow>) {
    setDefaultVarRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function updateDefaultAssert(index: number, patch: Partial<{ type: string; value: string }>) {
    setDefaultAssertRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function saveConfig() {
    if (isViewer) return false;
    setError('');
    setMessage('');
    const payload: RedTeamStageConfigPayload = {
      purpose,
      plugins,
      strategies,
      numTests,
      useRealGeneration,
      maxCharsPerMessage: maxCharsPerMessage.trim() ? Number(maxCharsPerMessage) : undefined,
      language: parseInlineList(languages),
      runOptions: {
        maxConcurrency: Math.max(1, Number(maxConcurrency || 1)),
        delayMs: Math.max(0, Number(delayMs || 0)),
        timeoutMs: Math.max(1000, Number(timeoutMs || 30000)),
        verbose,
      },
      defaultTest: {
        vars: keyValueRowsToRecord(defaultVarRows),
        assert: defaultAssertRows.filter((row) => row.type),
      },
      entities: parseInlineList(entities),
      pluginConfig: {
        policy: policyText.trim(),
        intent: intentGoals
          .split('\n')
          .map((line: string) => line.trim())
          .filter(Boolean),
      },
      customProbes: customProbes.filter((probe) => probe.prompt.trim()),
      dataClassification,
      allowedTools: parseInlineList(allowedTools),
      retrievalSources: parseInlineList(retrievalSources),
    };
    try {
      await onRefresh(await saveStageConfig(token, detail.target.id, 'red_team', payload));
      setMessage('Red-team configuration saved.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save red-team configuration');
      return false;
    }
  }

  async function loadPlan() {
    setPlanning(true);
    setError('');
    setMessage('');
    try {
      if (!(await saveConfig())) return;
      setPlan(await getRedTeamPlan(token, detail.target.id));
      setMessage('Red-team plan generated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate red-team plan');
    } finally {
      setPlanning(false);
    }
  }

  async function runStage() {
    setRunning(true);
    setError('');
    setMessage('');
    try {
      if (!(await saveConfig())) return;
      const result = await startStageRunAsync(token, detail.target.id, 'red_team', {
        numTests,
        maxConcurrency: Math.max(1, Number(maxConcurrency || 1)),
        delayMs: Math.max(0, Number(delayMs || 0)),
        timeoutMs: Math.max(1000, Number(timeoutMs || 30000)),
        verbose,
        maxCharsPerMessage: maxCharsPerMessage.trim() ? Number(maxCharsPerMessage) : undefined,
      });
      setActiveRunId(result.run.id);
      await onRefresh(result.detail);
      setMessage('Red-team run started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run red-team tests');
      setRunning(false);
      setActiveRunId('');
    }
  }

  async function cancelStage() {
    if (isViewer || !activeRunId) return;
    setError('');
    setMessage('');
    try {
      const result = await cancelTargetRun(token, detail.target.id, activeRunId);
      await onRefresh(result.detail);
      setMessage(result.run.status === 'cancelled' ? 'Red-team run cancelled.' : 'Red-team cancellation requested.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel red-team run');
    }
  }

  useEffect(() => {
    if (!activeRunId) return;
    let disposed = false;
    const timer = window.setInterval(async () => {
      try {
        const payload = await getRunDetail(token, detail.target.id, activeRunId);
        if (disposed) return;
        if (!['running', 'queued', 'cancelling'].includes(payload.run.status)) {
          window.clearInterval(timer);
          setRunning(false);
          setActiveRunId('');
          setMessage(payload.run.status === 'cancelled' ? 'Red-team run cancelled.' : 'Red-team run completed.');
          await onRefresh(await getTargetDetail(token, detail.target.id));
        }
      } catch (err) {
        if (!disposed) {
          window.clearInterval(timer);
          setRunning(false);
          setActiveRunId('');
          setError(err instanceof Error ? err.message : 'Unable to refresh red-team run status');
        }
      }
    }, 1200);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, detail.target.id, token]);

  return (
    <div className="eval-builder">
      <div className="eval-builder-main">
        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Attack scope</h3>
              <p className="muted">Define the application purpose, protected entities, tools, and retrieval surface.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field span-2">
              <label>Purpose</label>
              <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} />
            </div>
            <div className="field">
              <label>Protected entities</label>
              <input value={entities} onChange={(event) => setEntities(event.target.value)} placeholder="systems, tenant names, canaries" />
            </div>
            <div className="field">
              <label>Data classification</label>
              <select value={dataClassification} onChange={(event) => setDataClassification(event.target.value)}>
                <option value="">Select classification</option>
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="restricted">Restricted</option>
                <option value="secret">Secret</option>
              </select>
            </div>
            <div className="field">
              <label>Allowed tools</label>
              <input value={allowedTools} onChange={(event) => setAllowedTools(event.target.value)} placeholder="browser, db_read, ticket_lookup" />
            </div>
            <div className="field">
              <label>Retrieval sources</label>
              <input value={retrievalSources} onChange={(event) => setRetrievalSources(event.target.value)} placeholder="policy index, knowledge base" />
            </div>
          </div>
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Default test variables</h3>
              <p className="muted">Applied as a base to every test case's variables in both Eval and Red team runs (test-specific values still win on conflicts).</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDefaultVarRows((current) => [...current, { id: `var-${Date.now()}`, name: `var${current.length + 1}`, value: '' }])}
            >
              Add variable
            </button>
          </div>
          {defaultVarRows.length ? (
            <div className="key-value-list">
              {defaultVarRows.map((row, index) => (
                <div className="key-value-row" key={row.id}>
                  <div className="field">
                    <label>Name</label>
                    <input value={row.name} onChange={(event) => updateDefaultVar(index, { name: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>Value</label>
                    <input value={row.value} onChange={(event) => updateDefaultVar(index, { value: event.target.value })} />
                  </div>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setDefaultVarRows((current) => current.filter((_row, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No default variables configured.</p>
          )}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Default test assertions</h3>
              <p className="muted">Checked on every test case in both Eval and Red team runs, in addition to that case's own assertions — all must pass.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setDefaultAssertRows((current) => [...current, { type: 'contains', value: '' }])}
            >
              Add assertion
            </button>
          </div>
          {defaultAssertRows.length ? (
            <div className="key-value-list">
              {defaultAssertRows.map((row, index) => (
                <div className="assertion-row" key={index}>
                  <select value={row.type} onChange={(event) => updateDefaultAssert(index, { type: event.target.value })}>
                    {(workflowCatalog.assertions.length ? workflowCatalog.assertions : [{ key: 'contains', label: 'Contains' }]).map((assertionType) => (
                      <option value={assertionType.key} key={assertionType.key}>
                        {assertionType.label}
                      </option>
                    ))}
                  </select>
                  <input value={row.value} onChange={(event) => updateDefaultAssert(index, { value: event.target.value })} placeholder={assertionHelp(row.type)} />
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setDefaultAssertRows((current) => current.filter((_row, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No default assertions configured.</p>
          )}
          <div className="field-help" style={{ marginTop: '1rem' }}>
            Generate assertions with AI — writes objective evaluation questions for your eval's prompt(s), informed by whatever assertions already exist.
          </div>
          <div className="form-grid">
            <div className="field">
              <label>How many</label>
              <input
                type="number"
                min={1}
                max={15}
                value={generateAssertionsCount}
                onChange={(event) => setGenerateAssertionsCount(Number(event.target.value))}
              />
            </div>
            <div className="field">
              <label>Assertion type</label>
              <select value={generateAssertionsType} onChange={(event) => setGenerateAssertionsType(event.target.value as 'llm-rubric' | 'g-eval')}>
                <option value="llm-rubric">LLM rubric</option>
                <option value="g-eval">G-Eval</option>
              </select>
            </div>
            <div className="field span-2">
              <label>Additional instructions (optional)</label>
              <input
                value={generateAssertionsInstructions}
                onChange={(event) => setGenerateAssertionsInstructions(event.target.value)}
                placeholder="e.g. focus on tone and formatting requirements"
              />
            </div>
          </div>
          <button className="secondary-button" type="button" disabled={isViewer || generateAssertionsBusy} title={viewerTitle} onClick={handleGenerateAssertions}>
            {generateAssertionsBusy ? 'Generating...' : 'Generate preview'}
          </button>
          {generateAssertionsError ? <p className="error">{generateAssertionsError}</p> : null}
          {generateAssertionsPreview.length ? (
            <div className="generated-preview">
              <p className="muted">{generateAssertionsPreview.length} generated assertion(s) — review, then add to defaults above and save.</p>
              {generateAssertionsPreview.map((assertion, index) => (
                <div className="prompt-row" key={`${assertion.value}-${index}`}>
                  <strong>{assertion.label || `Assertion ${index + 1}`}</strong>
                  <p className="muted">
                    [{assertion.type}] {assertion.value}
                  </p>
                </div>
              ))}
              <div className="stage-actions">
                <button className="primary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={addGeneratedAssertionsToDefaults}>
                  Add all to defaults
                </button>
                <button className="ghost-button" type="button" onClick={() => setGenerateAssertionsPreview([])}>
                  Discard
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Plugins</h3>
              <p className="muted">Select vulnerability categories to probe.</p>
            </div>
            <span className="badge">{visibleSelectedCount}/{visiblePlugins.length} visible · {plugins.length} selected</span>
          </div>
          <div className="selection-toolbar">
            <div className="field">
              <label>Category</label>
              <select value={pluginCategory} onChange={(event) => setPluginCategory(event.target.value)}>
                <option value="">All categories</option>
                {pluginCategories.map((category) => (
                  <option value={category} key={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div className="stage-actions">
              <button className="secondary-button" type="button" onClick={selectVisiblePlugins} disabled={!visiblePlugins.length}>
                Select visible
              </button>
              <button className="secondary-button" type="button" onClick={clearVisiblePlugins} disabled={!visibleSelectedCount}>
                Clear visible
              </button>
              <button className="ghost-button" type="button" onClick={() => setPlugins([])} disabled={!plugins.length}>
                Clear all
              </button>
            </div>
          </div>
          {useRealGeneration && workflowCatalog.redteamRemoteGenerationDisabled ? (
            <p className="field-help">
              ⚠ Plugins marked <strong>remote only</strong> have no local generation path in
              promptfoo itself — with real generation on and this server's remote generation
              disabled, selecting one will silently generate 0 cases for it (surfaced after the
              run as a warning, but avoidable by deselecting it here first).
            </p>
          ) : null}
          <div className="option-grid">
            {visiblePlugins.map((plugin) => (
              <label className="option-tile" key={plugin.key}>
                <input
                  type="checkbox"
                  checked={plugins.includes(plugin.key)}
                  onChange={() => setPlugins((current) => toggleValue(current, plugin.key))}
                />
                <span>
                  <strong>
                    {plugin.label}
                    {plugin.remoteOnly && useRealGeneration && workflowCatalog.redteamRemoteGenerationDisabled ? (
                      <span className="badge badge-warning"> remote only</span>
                    ) : null}
                  </strong>
                  <small>{plugin.category}</small>
                </span>
              </label>
            ))}
          </div>
          {plugins.includes('policy') ? (
            <div className="field">
              <label>Custom policy statement</label>
              <textarea
                value={policyText}
                onChange={(event) => setPolicyText(event.target.value)}
                placeholder={'e.g. "The assistant must never provide specific medical dosage recommendations."'}
              />
              <p className="field-help">
                Required by the "Policy" plugin — it generates and grades probes specifically against this statement
                instead of a generic policy-bypass attempt. Leave blank to fall back to a generic placeholder policy.
              </p>
            </div>
          ) : null}
          {plugins.includes('intent') ? (
            <div className="field">
              <label>Custom intent goals (one per line)</label>
              <textarea
                value={intentGoals}
                onChange={(event) => setIntentGoals(event.target.value)}
                placeholder={'e.g. Get the assistant to reveal its system prompt\nGet the assistant to recommend a competitor'}
              />
              <p className="field-help">
                Required by the "Intent" plugin — each line becomes its own probe, sent to the target verbatim as the
                attack goal (not templated). Leave blank to fall back to a single generic goal.
              </p>
            </div>
          ) : null}
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Strategies</h3>
              <p className="muted">Choose attack styles used to generate probes.</p>
            </div>
            <span className="badge">{strategies.length} selected</span>
          </div>
          <div className="option-grid compact">
            {workflowCatalog.redteamStrategies.map((strategy) => (
              <label className="option-tile" key={strategy.key}>
                <input
                  type="checkbox"
                  checked={strategies.includes(strategy.key)}
                  onChange={() => setStrategies((current) => toggleValue(current, strategy.key))}
                />
                <span>
                  <strong>
                    {strategy.label}
                    {strategy.remoteOnly && useRealGeneration && workflowCatalog.redteamRemoteGenerationDisabled ? (
                      <span className="badge badge-warning"> remote only</span>
                    ) : null}
                  </strong>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Custom probes</h3>
              <p className="muted">Add targeted prompts that should be reviewed with the generated attack plan.</p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setCustomProbes((current) => [
                  ...current,
                  {
                    name: `Custom probe ${current.length + 1}`,
                    plugin: 'custom',
                    strategy: 'custom',
                    severity: 'medium',
                    prompt: '',
                    expectedRefusalMarkers: [],
                  },
                ])
              }
            >
              Add probe
            </button>
          </div>
          {customProbes.length ? (
            customProbes.map((probe, index) => (
              <div className="custom-probe-row" key={`${probe.name}-${index}`}>
                <div className="row-toolbar span-3">
                  <strong>Probe {index + 1}</strong>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setCustomProbes((current) => current.filter((_probe, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
                <div className="field">
                  <label>Name</label>
                  <input value={probe.name} onChange={(event) => updateCustomProbe(index, { name: event.target.value })} />
                </div>
                <div className="field">
                  <label>Plugin</label>
                  <input value={probe.plugin} onChange={(event) => updateCustomProbe(index, { plugin: event.target.value })} />
                </div>
                <div className="field">
                  <label>Strategy</label>
                  <input value={probe.strategy} onChange={(event) => updateCustomProbe(index, { strategy: event.target.value })} />
                </div>
                <div className="field">
                  <label>Severity</label>
                  <select value={probe.severity} onChange={(event) => updateCustomProbe(index, { severity: event.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div className="field span-3">
                  <label>Prompt</label>
                  <textarea value={probe.prompt} onChange={(event) => updateCustomProbe(index, { prompt: event.target.value })} />
                </div>
                <div className="field span-3">
                  <label>Expected refusal markers</label>
                  <input
                    value={probe.expectedRefusalMarkers.join(', ')}
                    onChange={(event) => updateCustomProbe(index, { expectedRefusalMarkers: parseInlineList(event.target.value) })}
                    placeholder="cannot, policy, not able"
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="muted">No custom probes configured.</p>
          )}
        </section>
      </div>

      <aside className="eval-builder-side">
        <section className="subpanel">
          <h3>Run controls</h3>
          <div className="field">
            <label>Max probes</label>
            <input type="number" min="1" value={numTests} onChange={(event) => setNumTests(Number(event.target.value))} />
          </div>
          <div className="field">
            <label className="check-row">
              <input
                type="checkbox"
                checked={useRealGeneration}
                onChange={(event) => setUseRealGeneration(event.target.checked)}
              />
              Use real adversarial generation
            </label>
            <p className="field-help">
              Generates probes with the vendored Promptfoo red-team engine itself (using this target's own
              provider as the attacker model) instead of this product's built-in templates — real, on-topic
              adversarial prompts for all of Promptfoo's plugins/strategies, at the cost of a real generation
              call per probe. Falls back to the built-in templates automatically if generation fails.
            </p>
          </div>
          <div className="field">
            <label>Max chars per message</label>
            <input
              type="number"
              min="1"
              placeholder="No limit"
              value={maxCharsPerMessage}
              onChange={(event) => setMaxCharsPerMessage(event.target.value)}
            />
            <span className="field-help">Leave blank to send the full generated probe.</span>
          </div>
          <div className="field">
            <label>Test languages</label>
            <input value={languages} onChange={(event) => setLanguages(event.target.value)} placeholder="French, Malay, ja" />
            <span className="field-help">Comma-separated names or ISO language codes.</span>
          </div>
          <div className="field">
            <label>Max concurrent requests</label>
            <input type="number" min="1" value={maxConcurrency} onChange={(event) => setMaxConcurrency(Number(event.target.value))} />
          </div>
          <div className="field">
            <label>Delay between API calls</label>
            <input type="number" min="0" value={delayMs} onChange={(event) => setDelayMs(Number(event.target.value))} />
            <span className="field-help">Milliseconds. Use with low concurrency for rate-limited targets.</span>
          </div>
          <div className="field">
            <label>Provider timeout</label>
            <input type="number" min="1000" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} />
            <span className="field-help">Milliseconds per probe.</span>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={verbose} onChange={(event) => setVerbose(event.target.checked)} />
            Debug mode
          </label>
          <div className="stage-actions">
            <button className="secondary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={saveConfig}>
              Save config
            </button>
            <button className="secondary-button" type="button" onClick={loadPlan} disabled={isViewer || planning || !plugins.length || !strategies.length} title={viewerTitle}>
              {planning ? 'Generating...' : 'Preview plan'}
            </button>
            <button className="primary-button" type="button" onClick={runStage} disabled={isViewer || running || !plugins.length || !strategies.length} title={viewerTitle}>
              {running ? 'Running...' : 'Run red team'}
            </button>
            {activeRunId ? (
              <button className="danger-button" type="button" disabled={isViewer} title={viewerTitle} onClick={cancelStage}>
                Cancel red team
              </button>
            ) : null}
          </div>
          {activeRunId ? <p className="field-help">Active run: {activeRunId}</p> : null}
          {message ? <div className="success">{message}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </section>

        <section className="subpanel">
          <h3>Attack plan</h3>
          {plan ? (
            <>
              {plan.realGenerationFallbackReason ? (
                <div className="error">
                  <strong>Real generation didn't run — used local templates instead.</strong>
                  <p>{plan.realGenerationFallbackReason}</p>
                </div>
              ) : null}
              <div className="run-summary">
                <div><span>Total</span><strong>{plan.summary.total}</strong></div>
                <div><span>Generated</span><strong>{plan.summary.generated}</strong></div>
                <div><span>Custom</span><strong>{plan.summary.custom}</strong></div>
                <div><span>High+</span><strong>{plan.summary.high + plan.summary.critical}</strong></div>
              </div>
              <div className="plan-list">
                {plan.probes.map((probe) => (
                  <div className="plan-row" key={probe.id}>
                    <div className="trace-head">
                      <span className="badge">{probe.severity}</span>
                      <strong>{probe.name}</strong>
                      <span className="muted">{probe.source}</span>
                    </div>
                    <p>{probe.prompt}</p>
                    <p className="muted">{probe.plugin} · {probe.strategy}</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted">Preview the plan to inspect generated and custom probes before execution.</p>
          )}
        </section>

        <section className="subpanel">
          <h3>Latest run</h3>
          {latestRun?.results?.realGenerationFallbackReason ? (
            <div className="error">
              <strong>Real generation didn't run — used local templates instead.</strong>
              <p>{latestRun.results.realGenerationFallbackReason}</p>
            </div>
          ) : null}
          {latestRun?.results?.summary ? (
            <div className="run-summary">
              <div><span>Total</span><strong>{latestRun.results.summary.total}</strong></div>
              <div><span>Pass</span><strong>{latestRun.results.summary.pass}</strong></div>
              <div><span>Fail</span><strong>{latestRun.results.summary.fail}</strong></div>
              <div><span>Error</span><strong>{latestRun.results.summary.error}</strong></div>
            </div>
          ) : (
            <p className="muted">No red-team runs yet.</p>
          )}
          <div className="results-table">
            {(latestRun?.results?.rows || []).map((row: any, index) => {
              const graded = row.assertions?.[0];
              return (
                <div className="result-row" key={`${row.plugin}-${row.strategy}-${index}`}>
                  <span className={row.pass ? 'result-pass' : 'result-fail'}>
                    {row.pass ? 'PASS' : row.error ? 'ERROR' : 'FAIL'}
                    {row.severity ? ` · ${row.severity}` : ''}
                  </span>
                  <strong>
                    {row.test}
                    {row.plugin ? (
                      <span className="muted"> ({row.plugin}{row.strategy ? `/${row.strategy}` : ''})</span>
                    ) : null}
                  </strong>
                  <p>{row.output || row.error}</p>
                  {graded?.grader ? (
                    <p className="muted">
                      Graded by: {graded.grader === 'promptfoo-library' ? 'promptfoo library (real judge model)' : graded.grader}
                      {graded.reason ? ` — ${graded.reason}` : ''}
                    </p>
                  ) : null}
                  {graded?.realGraderError ? (
                    <p className="muted">
                      Real grading unavailable, used local heuristic instead: {graded.realGraderError}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      </aside>
    </div>
  );
}

function ModelAuditWorkspace({
  detail,
  token,
  workflowCatalog,
  runs,
  isViewer,
  onRefresh,
}: {
  detail: TargetDetailResponse;
  token: string;
  workflowCatalog: WorkflowCatalogResponse;
  runs: StageRun[];
  isViewer?: boolean;
  onRefresh: (updated: TargetDetailResponse) => void | Promise<void>;
}) {
  const viewerTitle = isViewer ? 'Viewer accounts cannot make changes' : undefined;
  const metadata = detail.target.metadata as Record<string, any>;
  const audit = (metadata.audit || {}) as any;
  const [artifactPath, setArtifactPath] = useState(audit.artifactPath || detail.target.modelName || '');
  const [source, setSource] = useState(audit.source || '');
  const [licensePolicy, setLicensePolicy] = useState(audit.licensePolicy || '');
  const [sbomRequired, setSbomRequired] = useState(Boolean(audit.sbomRequired));
  const [scanners, setScanners] = useState<string[]>(
    audit.scanners?.length ? audit.scanners : ['metadata-completeness', 'license', 'provenance', 'sbom'],
  );
  const [notes, setNotes] = useState(audit.notes || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState('');
  const latestRun = runs[0];

  async function saveConfig() {
    if (isViewer) return false;
    setError('');
    setMessage('');
    const payload: ModelAuditStageConfigPayload = {
      artifactPath,
      source,
      licensePolicy,
      sbomRequired,
      scanners,
      notes,
    };
    try {
      await onRefresh(await saveStageConfig(token, detail.target.id, 'model_audit', payload));
      setMessage('Model audit configuration saved.');
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save model audit configuration');
      return false;
    }
  }

  async function runStage() {
    setRunning(true);
    setError('');
    setMessage('');
    try {
      if (!(await saveConfig())) return;
      const result = await startStageRunAsync(token, detail.target.id, 'model_audit', { scanners });
      setActiveRunId(result.run.id);
      await onRefresh(result.detail);
      setMessage('Model audit started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run model audit');
      setRunning(false);
      setActiveRunId('');
    }
  }

  async function cancelStage() {
    if (isViewer || !activeRunId) return;
    setError('');
    setMessage('');
    try {
      const result = await cancelTargetRun(token, detail.target.id, activeRunId);
      await onRefresh(result.detail);
      setMessage(result.run.status === 'cancelled' ? 'Model audit cancelled.' : 'Model audit cancellation requested.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel model audit');
    }
  }

  useEffect(() => {
    if (!activeRunId) return;
    let disposed = false;
    const timer = window.setInterval(async () => {
      try {
        const payload = await getRunDetail(token, detail.target.id, activeRunId);
        if (disposed) return;
        if (!['running', 'queued', 'cancelling'].includes(payload.run.status)) {
          window.clearInterval(timer);
          setRunning(false);
          setActiveRunId('');
          setMessage(payload.run.status === 'cancelled' ? 'Model audit cancelled.' : 'Model audit completed.');
          await onRefresh(await getTargetDetail(token, detail.target.id));
        }
      } catch (err) {
        if (!disposed) {
          window.clearInterval(timer);
          setRunning(false);
          setActiveRunId('');
          setError(err instanceof Error ? err.message : 'Unable to refresh model audit status');
        }
      }
    }, 1200);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeRunId, detail.target.id, token]);

  return (
    <div className="eval-builder">
      <div className="eval-builder-main">
        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Artifact and provenance</h3>
              <p className="muted">Capture where the model came from, where it runs, and what evidence is required.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field span-2">
              <label>Model artifact path / repository</label>
              <input value={artifactPath} onChange={(event) => setArtifactPath(event.target.value)} />
            </div>
            <div className="field">
              <label>Model source</label>
              <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="internal, vendor, fine-tuned, open source" />
            </div>
            <div className="field">
              <label>License policy</label>
              <select value={licensePolicy} onChange={(event) => setLicensePolicy(event.target.value)}>
                <option value="">Select policy</option>
                <option value="approved-commercial">Approved commercial use</option>
                <option value="requires-review">Requires legal/security review</option>
                <option value="internal-only">Internal only</option>
              </select>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={sbomRequired} onChange={(event) => setSbomRequired(event.target.checked)} />
              SBOM/MBOM required before approval
            </label>
            <div className="field span-2">
              <label>Audit notes</label>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Evidence links, exceptions, review comments" />
            </div>
          </div>
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Baseline checks</h3>
              <p className="muted">Always run on every model audit, regardless of the scanner selection below.</p>
            </div>
          </div>
          <div className="option-grid">
            {workflowCatalog.auditBaselineChecks.map((check) => (
              <span className="option-tile option-tile-static" key={check.key}>
                <strong>{check.label}</strong>
              </span>
            ))}
          </div>
        </section>

        <section className="subpanel">
          <div className="subpanel-head">
            <div>
              <h3>Scanners</h3>
              <p className="muted">Select additional checks to include in the model audit run.</p>
            </div>
            <span className="badge">{scanners.length} selected</span>
          </div>
          <div className="option-grid">
            {workflowCatalog.auditScanners.map((scanner) => (
              <label className="option-tile" key={scanner.key}>
                <input
                  type="checkbox"
                  checked={scanners.includes(scanner.key)}
                  onChange={() => setScanners((current) => toggleValue(current, scanner.key))}
                />
                <span>
                  <strong>{scanner.label}</strong>
                </span>
              </label>
            ))}
          </div>
        </section>
      </div>

      <aside className="eval-builder-side">
        <section className="subpanel">
          <h3>Run controls</h3>
          <div className="stage-actions">
            <button className="secondary-button" type="button" disabled={isViewer} title={viewerTitle} onClick={saveConfig}>
              Save config
            </button>
            <button className="primary-button" type="button" onClick={runStage} disabled={isViewer || running || !scanners.length} title={viewerTitle}>
              {running ? 'Running...' : 'Run audit'}
            </button>
            {activeRunId ? (
              <button className="danger-button" type="button" disabled={isViewer} title={viewerTitle} onClick={cancelStage}>
                Cancel audit
              </button>
            ) : null}
          </div>
          {activeRunId ? <p className="field-help">Active run: {activeRunId}</p> : null}
          {message ? <div className="success">{message}</div> : null}
          {error ? <div className="error">{error}</div> : null}
        </section>

        <section className="subpanel">
          <h3>Latest run</h3>
          {latestRun?.results?.summary ? (
            <div className="run-summary">
              <div><span>Total</span><strong>{latestRun.results.summary.total}</strong></div>
              <div><span>Pass</span><strong>{latestRun.results.summary.pass}</strong></div>
              <div><span>Fail</span><strong>{latestRun.results.summary.fail}</strong></div>
              <div><span>Error</span><strong>{latestRun.results.summary.error}</strong></div>
            </div>
          ) : (
            <p className="muted">No model-audit runs yet.</p>
          )}
          <div className="results-table">
            {(latestRun?.results?.rows || []).map((row: any, index) => (
              <div className="result-row" key={`${row.test}-${index}`}>
                <span className={row.pass ? 'result-pass' : 'result-fail'}>{row.pass ? 'PASS' : row.error ? 'ERROR' : 'FAIL'}</span>
                <strong>{row.test}</strong>
                <p>{row.output || row.error}</p>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function EvidenceWorkspace({
  detail,
  token,
  isViewer,
  onRefresh,
}: {
  detail: TargetDetailResponse;
  token: string;
  isViewer?: boolean;
  onRefresh?: (updated: TargetDetailResponse) => void | Promise<void>;
}) {
  const viewerTitle = isViewer ? 'Viewer accounts cannot make changes' : undefined;
  const [report, setReport] = useState<TargetReport | null>(null);
  const [runs, setRuns] = useState<StageRun[]>([]);
  const [schedules, setSchedules] = useState<TargetSchedule[]>([]);
  const [scheduleName, setScheduleName] = useState('Daily assurance');
  const [scheduleStages, setScheduleStages] = useState<Array<'eval' | 'red_team' | 'model_audit'>>(['model_audit']);
  const [scheduleInterval, setScheduleInterval] = useState(1440);
  const [scheduleEnabled, setScheduleEnabled] = useState(true);
  const [scheduleRunOptions, setScheduleRunOptions] = useState('{"repeat":1,"delayMs":0}');
  const [scheduleWebhookUrl, setScheduleWebhookUrl] = useState('');
  const [scheduleNotifyOn, setScheduleNotifyOn] = useState<'failure' | 'always'>('failure');
  const [scheduleBusy, setScheduleBusy] = useState('');
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<{ scheduleId: string; secret: string } | null>(null);
  const [leftRun, setLeftRun] = useState('');
  const [rightRun, setRightRun] = useState('');
  const [comparison, setComparison] = useState<RunComparison | null>(null);
  const [selectedRun, setSelectedRun] = useState<StageRun | null>(null);
  const [trace, setTrace] = useState<RunTraceRow[]>([]);
  const [runStageFilter, setRunStageFilter] = useState('');
  const [runStatusFilter, setRunStatusFilter] = useState('');
  const [runOutcomeFilter, setRunOutcomeFilter] = useState('');
  const [rerunMode, setRerunMode] = useState<'failures' | 'errors' | 'all'>('failures');
  const [runBusy, setRunBusy] = useState('');
  const [error, setError] = useState('');

  async function loadEvidence() {
    setError('');
    try {
      const [reportPayload, runsPayload, schedulePayload] = await Promise.all([
        getTargetReport(token, detail.target.id),
        listTargetRuns(token, detail.target.id, {
          stageKey: runStageFilter,
          status: runStatusFilter,
          outcome: runOutcomeFilter,
        }),
        listSchedules(token, detail.target.id),
      ]);
      setReport(reportPayload);
      setRuns(runsPayload.runs);
      setSchedules(schedulePayload.schedules);
      setSelectedRun((current) => current || runsPayload.runs[0] || null);
      setLeftRun((current) => current || runsPayload.runs[1]?.id || runsPayload.runs[0]?.id || '');
      setRightRun((current) => current || runsPayload.runs[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load evidence');
    }
  }

  async function handleCreateSchedule() {
    if (isViewer) return;
    setError('');
    setScheduleBusy('create');
    try {
      const runOptions = scheduleRunOptions.trim() ? JSON.parse(scheduleRunOptions) : {};
      const created = await createSchedule(token, detail.target.id, {
        name: scheduleName,
        stageKeys: scheduleStages,
        intervalMinutes: scheduleInterval,
        enabled: scheduleEnabled,
        runOptions,
        notifyWebhookUrl: scheduleWebhookUrl.trim(),
        notifyOn: scheduleNotifyOn,
      });
      if (created.notifyWebhookSecret) {
        setRevealedWebhookSecret({ scheduleId: created.schedule.id, secret: created.notifyWebhookSecret });
      }
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create schedule');
    } finally {
      setScheduleBusy('');
    }
  }

  async function handleRotateWebhookSecret(scheduleId: string) {
    if (isViewer) return;
    setError('');
    setScheduleBusy(scheduleId);
    try {
      const updated = await updateSchedule(token, detail.target.id, scheduleId, { rotateWebhookSecret: true });
      if (updated.notifyWebhookSecret) {
        setRevealedWebhookSecret({ scheduleId, secret: updated.notifyWebhookSecret });
      }
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rotate webhook secret');
    } finally {
      setScheduleBusy('');
    }
  }

  async function handleToggleSchedule(schedule: TargetSchedule) {
    if (isViewer) return;
    setError('');
    setScheduleBusy(schedule.id);
    try {
      await updateSchedule(token, detail.target.id, schedule.id, { enabled: !schedule.enabled });
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update schedule');
    } finally {
      setScheduleBusy('');
    }
  }

  async function handleDeleteSchedule(scheduleId: string) {
    if (isViewer) return;
    if (!window.confirm('Delete this schedule? It will stop running automatically.')) {
      return;
    }
    setError('');
    setScheduleBusy(scheduleId);
    try {
      await deleteSchedule(token, detail.target.id, scheduleId);
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete schedule');
    } finally {
      setScheduleBusy('');
    }
  }

  async function handleRunSchedule(scheduleId: string) {
    if (isViewer) return;
    setError('');
    setScheduleBusy(scheduleId);
    try {
      const payload = await runScheduleNow(token, detail.target.id, scheduleId);
      if (payload.detail && onRefresh) {
        await onRefresh(payload.detail);
      }
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to run schedule');
    } finally {
      setScheduleBusy('');
    }
  }

  useEffect(() => {
    loadEvidence();
  }, [detail.target.id, token, runStageFilter, runStatusFilter, runOutcomeFilter]);

  async function handleCompare() {
    if (!leftRun || !rightRun || leftRun === rightRun) return;
    setError('');
    try {
      setComparison(await compareRuns(token, detail.target.id, leftRun, rightRun));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to compare runs');
    }
  }

  async function inspectRun(runId: string) {
    setError('');
    try {
      const payload = await getRunDetail(token, detail.target.id, runId);
      setSelectedRun(payload.run);
      setTrace(payload.trace);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to inspect run');
    }
  }

  async function handleRerun(runId: string) {
    if (isViewer) return;
    setError('');
    setRunBusy(runId);
    try {
      const payload = await rerunTargetRun(token, detail.target.id, runId, rerunMode);
      if (payload.detail && onRefresh) {
        await onRefresh(payload.detail);
      }
      await loadEvidence();
      await inspectRun(payload.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to rerun');
    } finally {
      setRunBusy('');
    }
  }

  async function handleDeleteRun(runId: string) {
    if (isViewer) return;
    if (!window.confirm('Delete this run? Its results and evidence trail will be permanently removed.')) {
      return;
    }
    setError('');
    setRunBusy(runId);
    try {
      await deleteTargetRun(token, detail.target.id, runId);
      if (selectedRun?.id === runId) {
        setSelectedRun(null);
        setTrace([]);
      }
      await loadEvidence();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete run');
    } finally {
      setRunBusy('');
    }
  }

  async function handleCancelRun(runId: string) {
    if (isViewer) return;
    setError('');
    setRunBusy(runId);
    try {
      const payload = await cancelTargetRun(token, detail.target.id, runId);
      if (payload.detail && onRefresh) {
        await onRefresh(payload.detail);
      }
      await loadEvidence();
      await inspectRun(payload.run.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel run');
    } finally {
      setRunBusy('');
    }
  }

  return (
    <div className="evidence-grid">
      <section className="subpanel">
        <div className="subpanel-head">
          <div>
            <h3>Scorecard</h3>
            <p className="muted">Latest eval, red-team, and model-audit outcomes rolled up for this target.</p>
          </div>
          <button className="secondary-button" type="button" onClick={loadEvidence}>
            Refresh
          </button>
        </div>
        {error ? <div className="error">{error}</div> : null}
        {report ? (
          <>
            <div className="score-band">
              <div>
                <span>Score</span>
                <strong>{report.scorecard.score}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{report.scorecard.status.replace('_', ' ')}</strong>
              </div>
              <div>
                <span>Total</span>
                <strong>{report.scorecard.totals.total}</strong>
              </div>
              <div>
                <span>Pass rate</span>
                <strong>{Math.round(report.scorecard.totals.passRate * 100)}%</strong>
              </div>
            </div>
            <div className="run-summary">
              {Object.entries(report.scorecard.stages).map(([stageKey, summary]) => (
                <div key={stageKey}>
                  <span>{stageKey.replace('_', ' ')}</span>
                  <strong>{summary.total ? `${Math.round(summary.passRate * 100)}%` : 'NA'}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">Loading evidence...</p>
        )}
      </section>

      <section className="subpanel">
        <h3>Findings</h3>
        <div className="results-table">
          {(report?.findings || []).length ? (
            report!.findings.map((finding, index) => (
              <div className="result-row" key={`${finding.runId}-${finding.test}-${index}`}>
                <span className="result-fail">
                  {finding.status.toUpperCase()}
                  {finding.severity ? ` · ${finding.severity}` : ''}
                </span>
                <strong>
                  {finding.stageKey.replace('_', ' ')} · {finding.test}
                  {finding.plugin ? (
                    <span className="muted"> ({finding.plugin}{finding.strategy ? `/${finding.strategy}` : ''})</span>
                  ) : null}
                </strong>
                <p>{finding.error || finding.output || 'No output captured.'}</p>
              </div>
            ))
          ) : (
            <p className="muted">No failing findings in the latest runs.</p>
          )}
        </div>
      </section>

      <section className="subpanel">
        <div className="subpanel-head">
          <div>
            <h3>Schedules</h3>
            <p className="muted">Recurring assurance runs for selected stages.</p>
          </div>
          <span className="badge">{schedules.length} schedules</span>
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Name</label>
            <input value={scheduleName} onChange={(event) => setScheduleName(event.target.value)} />
          </div>
          <div className="field">
            <label>Every minutes</label>
            <input
              type="number"
              min="1"
              value={scheduleInterval}
              onChange={(event) => setScheduleInterval(Number(event.target.value || 1))}
            />
          </div>
        </div>
        <div className="option-grid compact">
          {([
            ['eval', 'Eval'],
            ['red_team', 'Red team'],
            ['model_audit', 'Model audit'],
          ] as const).map(([stageKey, label]) => (
            <label className="check-option" key={stageKey}>
              <input
                type="checkbox"
                checked={scheduleStages.includes(stageKey)}
                onChange={() => setScheduleStages(toggleValue(scheduleStages, stageKey) as Array<'eval' | 'red_team' | 'model_audit'>)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="field">
          <label>Run options JSON</label>
          <textarea value={scheduleRunOptions} onChange={(event) => setScheduleRunOptions(event.target.value)} />
        </div>
        <div className="form-grid">
          <div className="field span-2">
            <label>Notify webhook URL (optional)</label>
            <input
              type="url"
              value={scheduleWebhookUrl}
              onChange={(event) => setScheduleWebhookUrl(event.target.value)}
              placeholder="https://hooks.example.com/assurance-alerts"
            />
            <p className="field-help">
              POSTs a JSON summary here when a scheduled run finishes — use it to wire this into Slack, PagerDuty,
              or a CI pipeline via a small relay.
            </p>
          </div>
          <div className="field">
            <label>Notify on</label>
            <select value={scheduleNotifyOn} onChange={(event) => setScheduleNotifyOn(event.target.value as 'failure' | 'always')}>
              <option value="failure">Failures only</option>
              <option value="always">Every run</option>
            </select>
          </div>
        </div>
        <label className="inline-check">
          <input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />
          <span>Enabled</span>
        </label>
        <div className="stage-actions">
          <button
            className="primary-button"
            type="button"
            disabled={isViewer || !scheduleName.trim() || !scheduleStages.length || Boolean(scheduleBusy)}
            title={viewerTitle}
            onClick={handleCreateSchedule}
          >
            {scheduleBusy === 'create' ? 'Saving...' : 'Create schedule'}
          </button>
        </div>
        <div className="schedule-list">
          {schedules.length ? (
            schedules.map((schedule) => (
              <div className="schedule-row" key={schedule.id}>
                <div>
                  <strong>{schedule.name}</strong>
                  <p className="muted">
                    {schedule.stageKeys.map((stageKey) => stageKey.replace('_', ' ')).join(', ')} · every {schedule.intervalMinutes} min
                  </p>
                  <p className="muted">
                    Next {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : 'not set'} · Last {schedule.lastStatus || 'not run'}
                  </p>
                  {schedule.notifyWebhookUrl ? (
                    <>
                      <p className="muted">
                        Notifies {schedule.notifyOn === 'always' ? 'every run' : 'on failure'} → {schedule.notifyWebhookUrl}
                        {' · '}
                        {schedule.notifyWebhookSecretSet ? 'signed (X-Signature)' : 'unsigned'}
                      </p>
                      {schedule.lastWebhookStatus ? (
                        <p className={schedule.lastWebhookStatus === 'delivered' ? 'muted' : 'error'}>
                          Last webhook: {schedule.lastWebhookStatus}
                          {schedule.lastWebhookAttempts ? ` (${schedule.lastWebhookAttempts} attempt${schedule.lastWebhookAttempts > 1 ? 's' : ''})` : ''}
                          {schedule.lastWebhookAt ? ` at ${new Date(schedule.lastWebhookAt).toLocaleString()}` : ''}
                        </p>
                      ) : null}
                      {revealedWebhookSecret?.scheduleId === schedule.id ? (
                        <p className="field-help">
                          Webhook secret (shown once, save it now): <code>{revealedWebhookSecret.secret}</code>{' '}
                          <button className="ghost-button" type="button" onClick={() => setRevealedWebhookSecret(null)}>
                            Dismiss
                          </button>
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <span className="badge">{schedule.enabled ? 'enabled' : 'paused'}</span>
                <button className="secondary-button" type="button" disabled={isViewer || scheduleBusy === schedule.id} title={viewerTitle} onClick={() => handleRunSchedule(schedule.id)}>
                  Run now
                </button>
                <button className="secondary-button" type="button" disabled={isViewer || scheduleBusy === schedule.id} title={viewerTitle} onClick={() => handleToggleSchedule(schedule)}>
                  {schedule.enabled ? 'Pause' : 'Enable'}
                </button>
                {schedule.notifyWebhookUrl ? (
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isViewer || scheduleBusy === schedule.id}
                    title={viewerTitle}
                    onClick={() => handleRotateWebhookSecret(schedule.id)}
                  >
                    Rotate secret
                  </button>
                ) : null}
                <button className="ghost-button" type="button" disabled={isViewer || scheduleBusy === schedule.id} title={viewerTitle} onClick={() => handleDeleteSchedule(schedule.id)}>
                  Delete
                </button>
              </div>
            ))
          ) : (
            <p className="muted">No schedules configured.</p>
          )}
        </div>
      </section>

      <section className="subpanel">
        <div className="subpanel-head">
          <div>
            <h3>Run center</h3>
            <p className="muted">
              {runs.length >= 100
                ? 'Showing the latest 100 matching runs — older runs exist but are not shown.'
                : 'All stored runs for this target across stages.'}
            </p>
          </div>
          <span className="badge">{runs.length} runs</span>
        </div>
        <div className="run-filters">
          <div className="field">
            <label>Stage</label>
            <select value={runStageFilter} onChange={(event) => setRunStageFilter(event.target.value)}>
              <option value="">All stages</option>
              <option value="eval">Eval</option>
              <option value="red_team">Red team</option>
              <option value="model_audit">Model audit</option>
            </select>
          </div>
          <div className="field">
            <label>Status</label>
            <select value={runStatusFilter} onChange={(event) => setRunStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="running">Running</option>
              <option value="cancelling">Cancelling</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="field">
            <label>Outcome</label>
            <select value={runOutcomeFilter} onChange={(event) => setRunOutcomeFilter(event.target.value)}>
              <option value="">Any outcome</option>
              <option value="pass">Has pass</option>
              <option value="fail">Has fail</option>
              <option value="error">Has error</option>
              <option value="not_pass">Needs attention</option>
            </select>
          </div>
          <div className="field">
            <label>Rerun mode</label>
            <select value={rerunMode} onChange={(event) => setRerunMode(event.target.value as 'failures' | 'errors' | 'all')}>
              <option value="failures">Failures and errors</option>
              <option value="errors">Errors only</option>
              <option value="all">All rows</option>
            </select>
          </div>
        </div>
        <div className="run-list">
          {runs.map((run) => {
            const summary = run.results?.summary;
            return (
              <div className="run-list-row" key={run.id}>
                <div>
                  <strong>{run.stageKey.replace('_', ' ')}</strong>
                  <p className="muted">{new Date(run.createdAt).toLocaleString()}</p>
                </div>
                <span className="badge">{run.status}</span>
                <span>{summary ? `${summary.pass}/${summary.total} pass` : 'No results'}</span>
                <button className="secondary-button" type="button" onClick={() => inspectRun(run.id)}>
                  Trace
                </button>
                <button className="secondary-button" type="button" disabled={isViewer || runBusy === run.id} title={viewerTitle} onClick={() => handleRerun(run.id)}>
                  Rerun
                </button>
                {['running', 'queued', 'cancelling'].includes(run.status) ? (
                  <button className="danger-button" type="button" disabled={isViewer || runBusy === run.id} title={viewerTitle} onClick={() => handleCancelRun(run.id)}>
                    Cancel
                  </button>
                ) : null}
                <button className="ghost-button" type="button" disabled={isViewer || runBusy === run.id} title={viewerTitle} onClick={() => handleDeleteRun(run.id)}>
                  Delete
                </button>
              </div>
            );
          })}
          {runs.length ? null : <p className="muted">No runs match the selected filters.</p>}
        </div>
      </section>

      <section className="subpanel">
        <div className="subpanel-head">
          <div>
            <h3>Run trace</h3>
            <p className="muted">
              {selectedRun ? `${selectedRun.stageKey.replace('_', ' ')} · ${selectedRun.id}` : 'Select a run to inspect request and response rows.'}
            </p>
          </div>
        </div>
        <div className="trace-list">
          {trace.length ? (
            trace.map((row) => (
              <div className="trace-row" key={`${row.index}-${row.test}`}>
                <div className="trace-head">
                  <span className={row.pass ? 'result-pass' : 'result-fail'}>{row.pass ? 'PASS' : row.error ? 'ERROR' : 'FAIL'}</span>
                  <strong>{row.test}</strong>
                  <span className="muted">
                    {row.latencyMs ? `${row.latencyMs} ms` : ''}
                    {row.cacheHit ? ' (cached)' : ''}
                  </span>
                </div>
                <dl className="definition-list">
                  <dt>Prompt</dt>
                  <dd>{row.prompt || 'No prompt captured'}</dd>
                  <dt>Output</dt>
                  <dd>{row.output || row.error || 'No output captured'}</dd>
                  <dt>Assertions</dt>
                  <dd>{row.assertions.length ? JSON.stringify(row.assertions) : 'No assertions captured'}</dd>
                  {row.finishReason ? (
                    <>
                      <dt>Finish reason</dt>
                      <dd>{row.finishReason}</dd>
                    </>
                  ) : null}
                  {row.vars && Object.keys(row.vars).length ? (
                    <>
                      <dt>Variables</dt>
                      <dd>{JSON.stringify(row.vars)}</dd>
                    </>
                  ) : null}
                </dl>
                {row.rawResponse !== undefined && row.rawResponse !== null ? (
                  <details>
                    <summary>View raw provider response</summary>
                    <pre className="config-preview">
                      {typeof row.rawResponse === 'string' ? row.rawResponse : JSON.stringify(row.rawResponse, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))
          ) : (
            <p className="muted">No trace selected.</p>
          )}
        </div>
      </section>

      <section className="subpanel">
        <h3>Compare runs</h3>
        <div className="form-grid">
          <div className="field">
            <label>Baseline</label>
            <select value={leftRun} onChange={(event) => setLeftRun(event.target.value)}>
              <option value="">Select run</option>
              {runs.map((run) => (
                <option value={run.id} key={run.id}>
                  {run.stageKey} · {new Date(run.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Candidate</label>
            <select value={rightRun} onChange={(event) => setRightRun(event.target.value)}>
              <option value="">Select run</option>
              {runs.map((run) => (
                <option value={run.id} key={run.id}>
                  {run.stageKey} · {new Date(run.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="stage-actions">
          <button className="primary-button" type="button" disabled={!leftRun || !rightRun || leftRun === rightRun} onClick={handleCompare}>
            Compare
          </button>
        </div>
        {comparison ? (
          <>
            <div className="run-summary">
              <div><span>Pass delta</span><strong>{comparison.delta.pass}</strong></div>
              <div><span>Fail delta</span><strong>{comparison.delta.fail}</strong></div>
              <div><span>Error delta</span><strong>{comparison.delta.error}</strong></div>
              <div><span>Changed</span><strong>{comparison.changed.length}</strong></div>
            </div>
            {comparison.delta.namedScores && Object.keys(comparison.delta.namedScores).length ? (
              <p className="muted">
                Named score deltas:{' '}
                {Object.entries(comparison.delta.namedScores)
                  .map(([name, d]) => `${name}: ${d.left ?? '—'} → ${d.right ?? '—'} (${d.delta === null ? 'n/a' : (d.delta >= 0 ? '+' : '') + d.delta.toFixed(3)})`)
                  .join(', ')}
              </p>
            ) : null}
            {comparison.delta.derivedMetrics && Object.keys(comparison.delta.derivedMetrics).length ? (
              <p className="muted">
                Derived metric deltas:{' '}
                {Object.entries(comparison.delta.derivedMetrics)
                  .map(([name, d]) => `${name}: ${d.left ?? '—'} → ${d.right ?? '—'} (${d.delta === null ? 'n/a' : (d.delta >= 0 ? '+' : '') + d.delta.toFixed(3)})`)
                  .join(', ')}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function TargetDetailPage({
  detail,
  token,
  providerGroups,
  workflowCatalog,
  initialStage,
  isViewer,
  onBack,
  onRefresh,
  onDeleted,
  onDuplicated,
}: {
  detail: TargetDetailResponse;
  token: string;
  providerGroups: ProviderCatalogGroup[];
  workflowCatalog: WorkflowCatalogResponse;
  initialStage?: StageKey;
  isViewer?: boolean;
  onBack: () => void;
  onRefresh: (updated: TargetDetailResponse) => void;
  onDeleted: () => Promise<void>;
  onDuplicated: (id: string) => Promise<void>;
}) {
  const viewerTitle = isViewer ? 'Viewer accounts cannot make changes' : undefined;
  const [error, setError] = useState('');
  const [duplicating, setDuplicating] = useState(false);
  const [activeStage, setActiveStage] = useState<StageKey>(initialStage || 'eval');
  function goToStage(stage: StageKey) {
    setActiveStage(stage);
    setRouteHash({ view: 'detail', targetId: detail.target.id, stage });
  }
  useEffect(() => {
    setActiveStage(initialStage || 'eval');
  }, [initialStage, detail.target.id]);
  const [stageRuns, setStageRuns] = useState<Record<ExecutableStageKey, StageRun[]>>({
    eval: [],
    red_team: [],
    model_audit: [],
  });
  const [exportMessage, setExportMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const targetMetadata = detail.target.metadata as Record<string, any>;
  const targetProvider = (targetMetadata.provider || {}) as any;
  const targetJudge = (targetMetadata.judge || {}) as any;
  const targetRuntime = (targetMetadata.runtime || {}) as any;
  const [settings, setSettings] = useState({
    displayName: detail.target.displayName,
    targetType: detail.target.targetType,
    ownerName: detail.target.ownerName || '',
    environment: detail.target.environment,
    endpointUrl: detail.target.endpointUrl || '',
    modelName: detail.target.modelName || '',
    authStrategy: detail.target.authStrategy,
    systemPrompt: detail.target.systemPrompt || '',
    status: detail.target.status,
    providerKind: targetProvider.kind || 'http-json',
    providerBaseUrl: targetProvider.baseUrl || detail.target.endpointUrl || '',
    apiKey: '',
    temperature: Number(targetProvider.temperature ?? 0),
    maxTokens: Number(targetProvider.maxTokens ?? 512),
    judgeEnabled: Boolean(targetJudge.enabled),
    judgeProviderKey: targetJudge.providerKey || targetJudge.kind || 'openai',
    judgeAdapter: targetJudge.adapter || 'openai-compatible',
    judgeBaseUrl: targetJudge.baseUrl || '',
    judgeModel: targetJudge.model || '',
    judgeEmbeddingModel: targetJudge.embeddingModel || 'text-embedding-3-small',
    judgeApiKey: '',
    judgeTemperature: Number(targetJudge.temperature ?? 0),
    judgeMaxTokens: Number(targetJudge.maxTokens ?? 512),
    judgeSystemPrompt:
      targetJudge.systemPrompt ||
      'You are a strict LLM evaluation judge. Return only JSON with pass, score, and reason.',
    riskTier: String(targetMetadata.riskTier || 'basic'),
    tenant: String(targetRuntime.tenant || ''),
    dataClassification: String(targetRuntime.dataClassification || ''),
  });

  useEffect(() => {
    const metadata = detail.target.metadata as Record<string, any>;
    const provider = (metadata.provider || {}) as any;
    const judge = (metadata.judge || {}) as any;
    const runtime = (metadata.runtime || {}) as any;
    setSettings({
      displayName: detail.target.displayName,
      targetType: detail.target.targetType,
      ownerName: detail.target.ownerName || '',
      environment: detail.target.environment,
      endpointUrl: detail.target.endpointUrl || '',
      modelName: detail.target.modelName || '',
      authStrategy: detail.target.authStrategy,
      systemPrompt: detail.target.systemPrompt || '',
      status: detail.target.status,
      providerKind: provider.kind || 'http-json',
      providerBaseUrl: provider.baseUrl || detail.target.endpointUrl || '',
      apiKey: '',
      temperature: Number(provider.temperature ?? 0),
      maxTokens: Number(provider.maxTokens ?? 512),
      judgeEnabled: Boolean(judge.enabled),
      judgeProviderKey: judge.providerKey || judge.kind || 'openai',
      judgeAdapter: judge.adapter || 'openai-compatible',
      judgeBaseUrl: judge.baseUrl || '',
      judgeModel: judge.model || '',
      judgeEmbeddingModel: judge.embeddingModel || 'text-embedding-3-small',
      judgeApiKey: '',
      judgeTemperature: Number(judge.temperature ?? 0),
      judgeMaxTokens: Number(judge.maxTokens ?? 512),
      judgeSystemPrompt:
        judge.systemPrompt ||
        'You are a strict LLM evaluation judge. Return only JSON with pass, score, and reason.',
      riskTier: String(metadata.riskTier || 'basic'),
      tenant: String(runtime.tenant || ''),
      dataClassification: String(runtime.dataClassification || ''),
    });
  }, [detail.target.id, detail.target.updatedAt]);

  useEffect(() => {
    if (activeStage === 'evidence') return;
    const loader =
      activeStage === 'eval'
        ? listEvalRuns(token, detail.target.id)
        : listStageRuns(token, detail.target.id, activeStage);
    loader
      .then((payload) => setStageRuns((current) => ({ ...current, [activeStage]: payload.runs })))
      .catch(() => setStageRuns((current) => ({ ...current, [activeStage]: [] })));
  }, [activeStage, detail.target.id, token]);

  async function refreshRuns(stageKey: ExecutableStageKey = activeStage === 'evidence' ? 'eval' : activeStage, updated = detail) {
    const payload =
      stageKey === 'eval'
        ? await listEvalRuns(token, updated.target.id)
        : await listStageRuns(token, updated.target.id, stageKey);
    setStageRuns((current) => ({ ...current, [stageKey]: payload.runs }));
  }

  async function handlePrepare(stageKey: 'eval' | 'red_team' | 'model_audit') {
    if (isViewer) return;
    setError('');
    try {
      onRefresh(await prepareStage(token, detail.target.id, stageKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to prepare stage');
    }
  }

  async function handleExport() {
    setError('');
    setExportMessage('');
    try {
      const payload = await exportTarget(token, detail.target.id);
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setExportMessage('JSON evidence copied to clipboard.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to export target');
    }
  }

  async function handleDuplicate() {
    if (isViewer) return;
    setError('');
    setExportMessage('');
    setDuplicating(true);
    try {
      const exported = await exportTarget(token, detail.target.id);
      const result = await importTarget(token, {
        target: {
          ...exported.target,
          displayName: `${exported.target.displayName} (copy)`,
        },
        displayName: `${exported.target.displayName} (copy)`,
        importedFrom: 'duplicate',
      });
      await onDuplicated(result.target.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to duplicate target');
    } finally {
      setDuplicating(false);
    }
  }

  async function handleArtifactDownload(format: 'yaml' | 'csv' | 'markdown' | 'html') {
    setError('');
    setExportMessage('');
    try {
      const content = await exportTargetArtifact(token, detail.target.id, format);
      const safeName = detail.target.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'target';
      const artifact = {
        yaml: [`${safeName}-engine-config.yaml`, 'text/yaml;charset=utf-8', 'YAML config downloaded.'],
        csv: [`${safeName}-runs.csv`, 'text/csv;charset=utf-8', 'CSV run rows downloaded.'],
        markdown: [`${safeName}-assurance-report.md`, 'text/markdown;charset=utf-8', 'Markdown report downloaded.'],
        html: [`${safeName}-assurance-report.html`, 'text/html;charset=utf-8', 'HTML report downloaded.'],
      }[format];
      downloadTextFile(artifact[0], content, artifact[1]);
      setExportMessage(artifact[2]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to download artifact');
    }
  }

  async function handleSettingsSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isViewer) return;
    setError('');
    setSettingsMessage('');
    setSettingsSaving(true);
    try {
      const updated = await updateTarget(token, detail.target.id, {
        displayName: settings.displayName,
        targetType: settings.targetType,
        ownerName: settings.ownerName,
        environment: settings.environment,
        endpointUrl: settings.endpointUrl,
        modelName: settings.modelName,
        authStrategy: settings.authStrategy,
        systemPrompt: settings.systemPrompt,
        status: settings.status,
        metadata: {
          riskTier: settings.riskTier,
          provider: {
            kind: settings.providerKind,
            baseUrl: settings.providerBaseUrl,
            apiKey: settings.apiKey,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens,
          },
          judge: {
            enabled: settings.judgeEnabled,
            providerKey: settings.judgeProviderKey,
            adapter: settings.judgeAdapter,
            baseUrl: settings.judgeBaseUrl,
            model: settings.judgeModel,
            embeddingModel: settings.judgeEmbeddingModel,
            apiKey: settings.judgeApiKey,
            temperature: settings.judgeTemperature,
            maxTokens: settings.judgeMaxTokens,
            systemPrompt: settings.judgeSystemPrompt,
          },
          runtime: {
            tenant: settings.tenant,
            dataClassification: settings.dataClassification,
          },
        },
      });
      onRefresh(updated);
      setSettingsMessage('Target settings updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update target settings');
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleTargetDelete() {
    if (isViewer) return;
    if (
      !window.confirm(
        `Delete "${detail.target.displayName}"? This permanently removes all its runs, datasets, schedules, and stored provider keys. This cannot be undone.`,
      )
    ) {
      return;
    }
    setError('');
    setSettingsMessage('');
    setSettingsSaving(true);
    try {
      await deleteTarget(token, detail.target.id);
      await onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete target');
      setSettingsSaving(false);
    }
  }

  return (
    <section className="detail-page">
      <button className="ghost-button back-button" type="button" onClick={onBack}>
        Back to registry
      </button>
      <div className="page-head">
        <div>
          <p className="eyebrow">Registry detail</p>
          <h1>{detail.target.displayName}</h1>
          <p className="muted">
            {detail.target.promptfooEntity} · {detail.target.environment} · {detail.target.modelName}
          </p>
        </div>
        <div className="artifact-actions">
          <button className="secondary-button" type="button" onClick={() => setSettingsOpen((value) => !value)}>
            Target settings
          </button>
          <button className="secondary-button" type="button" onClick={handleExport}>
            Copy JSON
          </button>
          <button className="secondary-button" type="button" disabled={isViewer || duplicating} title={viewerTitle} onClick={handleDuplicate}>
            {duplicating ? 'Duplicating...' : 'Duplicate'}
          </button>
          <button className="secondary-button" type="button" onClick={() => handleArtifactDownload('yaml')}>
            Download YAML
          </button>
          <button className="secondary-button" type="button" onClick={() => handleArtifactDownload('csv')}>
            Download CSV
          </button>
          <button className="secondary-button" type="button" onClick={() => handleArtifactDownload('markdown')}>
            Download MD
          </button>
          <button className="secondary-button" type="button" onClick={() => handleArtifactDownload('html')}>
            Download HTML
          </button>
        </div>
      </div>
      {error ? <div className="error">{error}</div> : null}
      {exportMessage ? <div className="success">{exportMessage}</div> : null}
      {settingsMessage ? <div className="success">{settingsMessage}</div> : null}
      {settingsOpen ? (
        <section className="panel">
          <p className="eyebrow">Target settings</p>
          <h2>Registry configuration</h2>
          <form className="form" onSubmit={handleSettingsSave}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="settingsDisplayName">Display name</label>
                <input
                  id="settingsDisplayName"
                  value={settings.displayName}
                  onChange={(event) => setSettings((current) => ({ ...current, displayName: event.target.value }))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="settingsTargetType">Target type</label>
                <select
                  id="settingsTargetType"
                  value={settings.targetType}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, targetType: event.target.value as TargetTypeKey }))
                  }
                >
                  {targetTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsOwnerName">Owner</label>
                <input
                  id="settingsOwnerName"
                  value={settings.ownerName}
                  onChange={(event) => setSettings((current) => ({ ...current, ownerName: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsEnvironment">Environment</label>
                <select
                  id="settingsEnvironment"
                  value={settings.environment}
                  onChange={(event) => setSettings((current) => ({ ...current, environment: event.target.value }))}
                >
                  <option value="development">Development</option>
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsEndpointUrl">Endpoint URL</label>
                <input
                  id="settingsEndpointUrl"
                  value={settings.endpointUrl}
                  onChange={(event) => setSettings((current) => ({ ...current, endpointUrl: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsModelName">Model name</label>
                <input
                  id="settingsModelName"
                  value={settings.modelName}
                  onChange={(event) => setSettings((current) => ({ ...current, modelName: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsAuthStrategy">Auth strategy</label>
                <select
                  id="settingsAuthStrategy"
                  value={settings.authStrategy}
                  onChange={(event) => setSettings((current) => ({ ...current, authStrategy: event.target.value }))}
                >
                  <option value="api-key">API key</option>
                  <option value="bearer-token">Bearer token</option>
                  <option value="mTLS">mTLS</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsStatus">Status</label>
                <select
                  id="settingsStatus"
                  value={settings.status}
                  onChange={(event) => setSettings((current) => ({ ...current, status: event.target.value }))}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsProviderKind">Provider adapter</label>
                <select
                  id="settingsProviderKind"
                  value={settings.providerKind}
                  onChange={(event) => setSettings((current) => ({ ...current, providerKind: event.target.value }))}
                >
                  <option value="openai-compatible">OpenAI compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="cohere">Cohere</option>
                  <option value="gemini">Gemini</option>
                  <option value="http-json">HTTP JSON</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsProviderBaseUrl">Provider base URL</label>
                <input
                  id="settingsProviderBaseUrl"
                  value={settings.providerBaseUrl}
                  onChange={(event) => setSettings((current) => ({ ...current, providerBaseUrl: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsApiKey">Provider API key</label>
                <input
                  id="settingsApiKey"
                  type="password"
                  value={settings.apiKey}
                  placeholder={targetProvider.apiKeyMasked || 'Paste to replace stored key'}
                  onChange={(event) => setSettings((current) => ({ ...current, apiKey: event.target.value }))}
                />
              </div>
              <div className="field span-2">
                <label className="check-row" htmlFor="settingsJudgeEnabled">
                  <input
                    id="settingsJudgeEnabled"
                    type="checkbox"
                    checked={settings.judgeEnabled}
                    onChange={(event) => setSettings((current) => ({ ...current, judgeEnabled: event.target.checked }))}
                  />
                  Enable judge model for model-graded assertions
                </label>
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeProviderKey">Judge provider</label>
                <select
                  id="settingsJudgeProviderKey"
                  value={settings.judgeProviderKey}
                  onChange={(event) => setSettings((current) => ({ ...current, judgeProviderKey: event.target.value }))}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="cohere">Cohere</option>
                  <option value="google-gemini">Gemini</option>
                  <option value="http-json">HTTP JSON</option>
                  <option value="local-openai">Local OpenAI-compatible</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeAdapter">Judge adapter</label>
                <select
                  id="settingsJudgeAdapter"
                  value={settings.judgeAdapter}
                  onChange={(event) => setSettings((current) => ({ ...current, judgeAdapter: event.target.value }))}
                >
                  <option value="openai-compatible">OpenAI compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="cohere">Cohere</option>
                  <option value="gemini">Gemini</option>
                  <option value="http-json">HTTP JSON</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeBaseUrl">Judge base URL</label>
                <input
                  id="settingsJudgeBaseUrl"
                  value={settings.judgeBaseUrl}
                  onChange={(event) => setSettings((current) => ({ ...current, judgeBaseUrl: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeModel">Judge model</label>
                <input
                  id="settingsJudgeModel"
                  value={settings.judgeModel}
                  onChange={(event) => setSettings((current) => ({ ...current, judgeModel: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeEmbeddingModel">Embedding model (used by "similar" assertions)</label>
                <input
                  id="settingsJudgeEmbeddingModel"
                  value={settings.judgeEmbeddingModel}
                  placeholder="text-embedding-3-small"
                  onChange={(event) => setSettings((current) => ({ ...current, judgeEmbeddingModel: event.target.value }))}
                />
                <p className="field-help">
                  Requires an OpenAI-compatible judge base URL that serves /embeddings. Without one, "similar" assertions
                  fall back to a local word-overlap approximation.
                </p>
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeApiKey">Judge API key</label>
                <input
                  id="settingsJudgeApiKey"
                  type="password"
                  value={settings.judgeApiKey}
                  placeholder={targetJudge.apiKeyMasked || 'Paste judge key'}
                  onChange={(event) => setSettings((current) => ({ ...current, judgeApiKey: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeTemperature">Judge temperature</label>
                <input
                  id="settingsJudgeTemperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.judgeTemperature}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, judgeTemperature: Number(event.target.value) }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="settingsJudgeMaxTokens">Judge max tokens</label>
                <input
                  id="settingsJudgeMaxTokens"
                  type="number"
                  min="1"
                  value={settings.judgeMaxTokens}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, judgeMaxTokens: Number(event.target.value) }))
                  }
                />
              </div>
              <div className="field span-2">
                <label htmlFor="settingsJudgeSystemPrompt">Judge system prompt</label>
                <textarea
                  id="settingsJudgeSystemPrompt"
                  value={settings.judgeSystemPrompt}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, judgeSystemPrompt: event.target.value }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="settingsRiskTier">Risk tier</label>
                <select
                  id="settingsRiskTier"
                  value={settings.riskTier}
                  onChange={(event) => setSettings((current) => ({ ...current, riskTier: event.target.value }))}
                >
                  <option value="basic">Basic</option>
                  <option value="enhanced">Enhanced</option>
                  <option value="mission-critical">Mission-Critical</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="settingsTemperature">Temperature</label>
                <input
                  id="settingsTemperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={settings.temperature}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, temperature: Number(event.target.value) }))
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="settingsMaxTokens">Max tokens</label>
                <input
                  id="settingsMaxTokens"
                  type="number"
                  min="1"
                  value={settings.maxTokens}
                  onChange={(event) => setSettings((current) => ({ ...current, maxTokens: Number(event.target.value) }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsTenant">Tenant</label>
                <input
                  id="settingsTenant"
                  value={settings.tenant}
                  onChange={(event) => setSettings((current) => ({ ...current, tenant: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="settingsDataClassification">Data classification</label>
                <select
                  id="settingsDataClassification"
                  value={settings.dataClassification}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, dataClassification: event.target.value }))
                  }
                >
                  <option value="">Unspecified</option>
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>
              <div className="field span-2">
                <label htmlFor="settingsSystemPrompt">System prompt</label>
                <textarea
                  id="settingsSystemPrompt"
                  value={settings.systemPrompt}
                  onChange={(event) => setSettings((current) => ({ ...current, systemPrompt: event.target.value }))}
                />
              </div>
            </div>
            <div className="stage-actions">
              <button className="primary-button" type="submit" disabled={isViewer || settingsSaving} title={viewerTitle}>
                {settingsSaving ? 'Saving...' : 'Save settings'}
              </button>
              <button className="ghost-button" type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
              <button className="danger-button" type="button" disabled={isViewer || settingsSaving} title={viewerTitle} onClick={handleTargetDelete}>
                Delete target
              </button>
            </div>
          </form>
        </section>
      ) : null}
      <div className="stage-grid">
        {([
          ['eval', 'Eval', 'Generate baseline engine config and deterministic test cases.'],
          ['red_team', 'Red team', 'Prepare red-team purpose, plugins, strategies, and injection variable.'],
          ['model_audit', 'Model audit', 'Prepare artifact/provenance inputs for model security and license scanning.'],
        ] as const).map(([key, label, description]) => {
          const readiness = detail.readiness[key];
          const plan = detail.target.testPlan.find((step) => step.stageKey === key);
          return (
            <article className="stage-card" key={key}>
              <div className="stage-head">
                <div>
                  <h2>{label}</h2>
                  <p className="muted">{description}</p>
                </div>
                <span className="badge">{plan?.status || 'pending'}</span>
              </div>
              <ReadinessBlock readiness={readiness} />
              <div className="stage-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={!readiness.ready || isViewer}
                  title={isViewer ? viewerTitle : undefined}
                  onClick={() => handlePrepare(key)}
                >
                  Prepare {label}
                </button>
                <button className="secondary-button" type="button" onClick={() => goToStage(key)}>
                  Open workspace
                </button>
              </div>
            </article>
          );
        })}
        <article className="stage-card">
          <div className="stage-head">
            <div>
              <h2>Evidence</h2>
              <p className="muted">Review scorecard, findings, all runs, comparisons, and export artifacts.</p>
            </div>
            <span className="badge">report</span>
          </div>
          <p className="ready-text">Available</p>
          <div className="stage-actions">
            <button className="secondary-button" type="button" onClick={() => goToStage('evidence')}>
              Open workspace
            </button>
          </div>
        </article>
      </div>
      <section className="panel">
        <p className="eyebrow">Workspace</p>
        <h2>
          {activeStage === 'eval'
            ? 'Eval workspace'
            : activeStage === 'red_team'
              ? 'Red team workspace'
              : activeStage === 'model_audit'
                ? 'Model audit workspace'
                : 'Evidence workspace'}
        </h2>
        <StageWorkspace
          detail={detail}
          token={token}
          activeStage={activeStage}
          providerGroups={providerGroups}
          workflowCatalog={workflowCatalog}
          isViewer={isViewer}
          runs={activeStage === 'evidence' ? [] : stageRuns[activeStage]}
          onRefresh={async (updated) => {
            onRefresh(updated);
            if (activeStage !== 'evidence') {
              await refreshRuns(activeStage, updated);
            }
          }}
        />
      </section>
    </section>
  );
}

function StageWorkspace({
  detail,
  token,
  activeStage,
  providerGroups,
  workflowCatalog,
  runs,
  isViewer,
  onRefresh,
}: {
  detail: TargetDetailResponse;
  token: string;
  activeStage: StageKey;
  providerGroups: ProviderCatalogGroup[];
  workflowCatalog: WorkflowCatalogResponse;
  runs: StageRun[];
  isViewer?: boolean;
  onRefresh: (updated: TargetDetailResponse) => void | Promise<void>;
}) {
  if (activeStage === 'evidence') {
    return <EvidenceWorkspace detail={detail} token={token} isViewer={isViewer} onRefresh={onRefresh} />;
  }

  if (activeStage === 'eval') {
    return (
      <EvalWorkspace
        detail={detail}
        token={token}
        providerGroups={providerGroups}
        workflowCatalog={workflowCatalog}
        evalRuns={runs}
        isViewer={isViewer}
        onRefresh={onRefresh}
      />
    );
  }

  if (activeStage === 'red_team') {
    return (
      <RedTeamWorkspace
        detail={detail}
        token={token}
        workflowCatalog={workflowCatalog}
        runs={runs}
        isViewer={isViewer}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <ModelAuditWorkspace
      detail={detail}
      token={token}
      workflowCatalog={workflowCatalog}
      runs={runs}
      isViewer={isViewer}
      onRefresh={onRefresh}
    />
  );
}

function UsersPage({ token, currentUserId }: { token: string; currentUserId?: string }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const payload = await listUsers(token);
      setUsers(payload.users);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    try {
      await createUser(token, { email: newEmail, password: newPassword, role: newRole });
      setNewEmail('');
      setNewPassword('');
      setNewRole('viewer');
      setMessage('User created.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRoleChange(id: string, role: string) {
    setError('');
    try {
      await updateUser(token, id, { role });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role.');
    }
  }

  async function handleDelete(id: string) {
    const target = users.find((user) => user.id === id);
    if (!window.confirm(`Remove ${target?.email || 'this user'}? They will immediately lose access.`)) {
      return;
    }
    setError('');
    try {
      await deleteUser(token, id);
      setMessage('User removed.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user.');
    }
  }

  return (
    <div className="page">
      <section className="panel-header">
        <p className="eyebrow">Administration</p>
        <h1>Users</h1>
        <p className="muted">Manage who can sign in. Admins have full access; viewers can browse but not change settings.</p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      <section className="panel">
        <h2>Add a user</h2>
        <form className="form-grid" onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="newUserEmail">Email</label>
            <input
              id="newUserEmail"
              type="email"
              required
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="newUserPassword">Password</label>
            <input
              id="newUserPassword"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="field">
            <label htmlFor="newUserRole">Role</label>
            <select id="newUserRole" value={newRole} onChange={(event) => setNewRole(event.target.value)}>
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="field span-3">
            <button className="primary-button" type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create user'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Existing users</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : (
          <div className="registry-list">
            {users.map((item) => (
              <div className="registry-row" key={item.id}>
                <div>
                  <h3>{item.email}</h3>
                  <p className="muted">Added {new Date(item.created_at).toLocaleDateString()}</p>
                </div>
                <div className="field">
                  <label>Role</label>
                  <select value={item.role} onChange={(event) => handleRoleChange(item.id, event.target.value)}>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button
                  className="danger-button"
                  type="button"
                  disabled={item.id === currentUserId}
                  onClick={() => handleDelete(item.id)}
                >
                  {item.id === currentUserId ? 'This is you' : 'Remove'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TokensPage({ token, apiBaseUrl }: { token: string; apiBaseUrl: string }) {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('admin');
  const [creating, setCreating] = useState(false);
  const [revealedToken, setRevealedToken] = useState<{ name: string; rawToken: string } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const payload = await listApiTokens(token);
      setTokens(payload.tokens);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError('');
    setMessage('');
    try {
      const result = await createApiToken(token, { name: newName, role: newRole });
      setNewName('');
      setNewRole('admin');
      setRevealedToken({ name: result.token.name, rawToken: result.rawToken });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create token.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    const target = tokens.find((item) => item.id === id);
    if (
      !window.confirm(
        `Revoke "${target?.name || 'this token'}"? Anything using it (CI/CD pipelines, scripts) will stop authenticating immediately.`,
      )
    ) {
      return;
    }
    setError('');
    try {
      await deleteApiToken(token, id);
      setMessage('Token revoked.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke token.');
    }
  }

  const curlExample = revealedToken
    ? `curl -X POST ${apiBaseUrl}/api/targets/<target-id>/stages/eval/run \\\n  -H "Authorization: Bearer ${revealedToken.rawToken}" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`
    : '';

  return (
    <div className="page">
      <section className="panel-header">
        <p className="eyebrow">Administration</p>
        <h1>API tokens</h1>
        <p className="muted">
          Long-lived tokens for CI/CD pipelines and other non-interactive callers. Use them anywhere a session
          token is accepted, as an <code>Authorization: Bearer</code> header.
        </p>
      </section>

      {error ? <div className="error">{error}</div> : null}
      {message ? <div className="success">{message}</div> : null}

      {revealedToken ? (
        <section className="panel">
          <h2>Token created: {revealedToken.name}</h2>
          <p className="muted">
            Copy this now — it is shown only once and cannot be retrieved again. If it's lost, revoke it and
            create a new one.
          </p>
          <pre className="code-block">{revealedToken.rawToken}</pre>
          <p className="muted">Example: trigger an eval run from a CI/CD pipeline</p>
          <pre className="code-block">{curlExample}</pre>
          <button className="secondary-button" type="button" onClick={() => setRevealedToken(null)}>
            Done
          </button>
        </section>
      ) : null}

      <section className="panel">
        <h2>Create a token</h2>
        <form className="form-grid" onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="newTokenName">Name</label>
            <input
              id="newTokenName"
              type="text"
              required
              value={newName}
              placeholder="e.g. GitHub Actions, nightly cron"
              onChange={(event) => setNewName(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="newTokenRole">Role</label>
            <select id="newTokenRole" value={newRole} onChange={(event) => setNewRole(event.target.value)}>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <div className="field span-3">
            <button className="primary-button" type="submit" disabled={creating || !newName.trim()}>
              {creating ? 'Creating...' : 'Create token'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Existing tokens</h2>
        {loading ? (
          <p className="muted">Loading...</p>
        ) : tokens.length ? (
          <div className="registry-list">
            {tokens.map((item) => (
              <div className="registry-row" key={item.id}>
                <div>
                  <h3>{item.name}</h3>
                  <p className="muted">
                    {item.token_prefix}... · {item.role} · created by {item.created_by}
                  </p>
                </div>
                <div>
                  <p className="row-label">Created</p>
                  <strong>{new Date(item.created_at).toLocaleDateString()}</strong>
                </div>
                <div>
                  <p className="row-label">Last used</p>
                  <strong>{item.last_used_at ? new Date(item.last_used_at).toLocaleString() : 'Never'}</strong>
                </div>
                <button className="danger-button" type="button" onClick={() => handleDelete(item.id)}>
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">No API tokens yet. Create one to authenticate CI/CD pipelines.</div>
        )}
      </section>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('og_token'));
  const [user, setUser] = useState<User | null>(readStoredUser());
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [targets, setTargets] = useState<OnboardedTarget[]>([]);
  const [view, setView] = useState<View>('registry');
  const [message, setMessage] = useState('');
  const [loginError, setLoginError] = useState('');
  const [detail, setDetail] = useState<TargetDetailResponse | null>(null);
  const [providerGroups, setProviderGroups] = useState<ProviderCatalogGroup[]>([]);
  const [workflowCatalog, setWorkflowCatalog] = useState<WorkflowCatalogResponse>(emptyWorkflowCatalog);
  const [initialStage, setInitialStage] = useState<StageKey | undefined>(undefined);
  const routedRef = useRef(false);

  async function loadData(activeToken = token) {
    if (!activeToken) return;
    const [catalogPayload, targetsPayload, providerCatalogPayload, workflowCatalogPayload] = await Promise.all([
      getCatalog(activeToken),
      getTargets(activeToken),
      getProviderCatalog(activeToken),
      getWorkflowCatalog(activeToken),
    ]);
    setCatalog(catalogPayload);
    setTargets(targetsPayload.targets);
    setProviderGroups(providerCatalogPayload.groups);
    setWorkflowCatalog(workflowCatalogPayload);
  }

  async function openDetail(id: string, stage?: StageKey, activeToken = token) {
    if (!activeToken) return;
    try {
      const targetDetail = await getTargetDetail(activeToken, id);
      setDetail(targetDetail);
      setInitialStage(stage);
      setView('detail');
      setRouteHash({ view: 'detail', targetId: id, stage });
    } catch (err) {
      setDetail(null);
      setView('registry');
      setRouteHash({ view: 'registry' });
      setMessage(err instanceof Error ? err.message : 'That target could not be opened.');
    }
  }

  function goRegistry() {
    setDetail(null);
    setView('registry');
    setRouteHash({ view: 'registry' });
  }

  function goOnboard() {
    setMessage('');
    setView('onboard');
    setRouteHash({ view: 'onboard' });
  }

  function goUsers() {
    setDetail(null);
    setView('users');
    setRouteHash({ view: 'users' });
  }

  function goTokens() {
    setDetail(null);
    setView('tokens');
    setRouteHash({ view: 'tokens' });
  }

  useEffect(() => {
    if (!token) return;
    loadData(token).catch((err) => {
      localStorage.removeItem('og_token');
      localStorage.removeItem('og_user');
      setToken(null);
      setUser(null);
      setLoginError(err instanceof Error ? err.message : 'Session expired');
    });
  }, [token]);

  // A 401 anywhere in the app (not just the initial load above) fires this — e.g. the 12h
  // session JWT expiring while the user is mid-action on some other screen. Without this,
  // every subsequent click would fail with the same generic "Unauthorized" error in whatever
  // component happened to be open, with no indication of why or how to recover.
  useEffect(() => {
    function handleSessionExpired() {
      setToken(null);
      setUser(null);
      setCatalog(null);
      setTargets([]);
      setDetail(null);
      routedRef.current = false;
      setLoginError('Your session expired. Please sign in again.');
    }
    window.addEventListener('og:session-expired', handleSessionExpired);
    return () => window.removeEventListener('og:session-expired', handleSessionExpired);
  }, []);

  // Apply whatever route is in the URL once on load — supports refresh and shared/bookmarked links.
  useEffect(() => {
    if (!catalog || routedRef.current) return;
    routedRef.current = true;
    const route = parseRoute(window.location.hash);
    const isAdminRoute = ['users', 'tokens'].includes(route.view);
    if (isAdminRoute && user?.role !== 'admin') {
      setView('registry');
    } else if (route.view === 'detail' && route.targetId) {
      openDetail(route.targetId, route.stage);
    } else if (route.view === 'onboard') {
      setView('onboard');
    } else if (route.view === 'users') {
      setView('users');
    } else if (route.view === 'tokens') {
      setView('tokens');
    } else {
      setView('registry');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  // Keep state in sync with browser back/forward navigation and manual hash edits.
  useEffect(() => {
    function handleHashChange() {
      const route = parseRoute(window.location.hash);
      const isAdminRoute = ['users', 'tokens'].includes(route.view);
      if (isAdminRoute && user?.role !== 'admin') {
        setDetail(null);
        setView('registry');
      } else if (route.view === 'detail' && route.targetId) {
        if (detail && detail.target.id === route.targetId) {
          // Same target, only the stage tab changed (e.g. via goToStage or back/forward
          // between stages) — avoid an unnecessary refetch.
          setInitialStage(route.stage);
        } else {
          openDetail(route.targetId, route.stage);
        }
      } else if (route.view === 'onboard') {
        setDetail(null);
        setView('onboard');
      } else if (route.view === 'users') {
        setDetail(null);
        setView('users');
      } else if (route.view === 'tokens') {
        setDetail(null);
        setView('tokens');
      } else {
        setDetail(null);
        setView('registry');
      }
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, detail]);

  function handleLogin(session: Session) {
    localStorage.setItem('og_token', session.token);
    localStorage.setItem('og_user', JSON.stringify(session.user));
    setToken(session.token);
    setUser(session.user);
    setLoginError('');
    setView('registry');
    setRouteHash({ view: 'registry' });
  }

  function handleLogout() {
    const activeToken = token;
    localStorage.removeItem('og_token');
    localStorage.removeItem('og_user');
    setToken(null);
    setUser(null);
    setCatalog(null);
    setTargets([]);
    setDetail(null);
    setMessage('');
    routedRef.current = false;
    setRouteHash({ view: 'registry' });
    if (activeToken) {
      logout(activeToken).catch(() => {
        // Best-effort — the client-side token is already cleared either way.
      });
    }
  }

  async function handleCreated(id: string) {
    await loadData();
    await openDetail(id);
    setMessage('');
  }

  if (!token || !user) {
    return <LoginPage error={loginError} onLogin={handleLogin} />;
  }

  if (!catalog) {
    return (
      <Shell onRegistry={goRegistry} onLogout={handleLogout}>
        <section className="panel">
          <p className="muted">Loading registry...</p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell
      onRegistry={goRegistry}
      onUsers={goUsers}
      onTokens={goTokens}
      isAdmin={user.role === 'admin'}
      onLogout={handleLogout}
    >
      {view === 'registry' ? (
        <RegistryPage
          catalog={catalog}
          targets={targets}
          message={message}
          token={token}
          isViewer={user.role !== 'admin'}
          onSelect={(id) => openDetail(id)}
          onImported={handleCreated}
          onOnboard={goOnboard}
        />
      ) : view === 'onboard' ? (
        <OnboardingPage catalog={catalog} token={token} onCreated={handleCreated} onBack={goRegistry} />
      ) : view === 'users' ? (
        <UsersPage token={token} currentUserId={user.id} />
      ) : view === 'tokens' ? (
        <TokensPage token={token} apiBaseUrl={window.location.origin} />
      ) : detail ? (
        <TargetDetailPage
          detail={detail}
          token={token}
          providerGroups={providerGroups}
          workflowCatalog={workflowCatalog}
          initialStage={initialStage}
          isViewer={user.role !== 'admin'}
          onBack={goRegistry}
          onRefresh={(updated) => setDetail(updated)}
          onDeleted={async () => {
            goRegistry();
            setMessage('Target deleted.');
            await loadData();
          }}
          onDuplicated={async (id) => {
            await handleCreated(id);
            setMessage('Target duplicated.');
          }}
        />
      ) : null}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
