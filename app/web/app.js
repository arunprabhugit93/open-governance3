const state = {
  token: localStorage.getItem('og_token'),
  user: JSON.parse(localStorage.getItem('og_user') || 'null'),
  catalog: null,
  targets: [],
  selectedType: 'plain_llm',
  view: 'registry',
};

const app = document.getElementById('app');

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderLogin(error = '') {
  app.innerHTML = `
    <section class="login-page">
      <div class="login-card">
        <div class="brand-row">
          <div class="mark">OG</div>
          <div>
            <p class="eyebrow">AI Assurance Control Plane</p>
            <h1>Sign in</h1>
          </div>
        </div>
        <p class="muted">Access the onboarding workspace for models, prompts, RAG, agents, APIs, and chat apps.</p>
        ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
        <form class="form" id="login-form">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" value="admin@example.com" autocomplete="username" required />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" value="admin123" autocomplete="current-password" required />
          </div>
          <button class="primary-button" type="submit">Sign in</button>
        </form>
      </div>
    </section>
  `;

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      state.token = payload.token;
      state.user = payload.user;
      localStorage.setItem('og_token', payload.token);
      localStorage.setItem('og_user', JSON.stringify(payload.user));
      await loadApp();
    } catch (error) {
      renderLogin(error.message);
    }
  });
}

function renderTypeOptions() {
  return state.catalog.supportedTargetTypes
    .map(
      (type) => `
        <button class="type-option" type="button" data-type="${type.key}" aria-pressed="${state.selectedType === type.key}">
          <strong>${escapeHtml(type.label)}</strong>
          <span>${escapeHtml(type.description)}</span>
          <div class="mapping">${escapeHtml(type.promptfooEntity)}</div>
        </button>
      `,
    )
    .join('');
}

function renderTargets() {
  if (!state.targets.length) {
    return '<div class="empty">No targets onboarded yet.</div>';
  }
  return state.targets
    .map(
      (target) => `
        <article class="target-card">
          <div class="target-head">
            <div>
              <h3>${escapeHtml(target.displayName)}</h3>
              <p class="muted">${escapeHtml(target.onboardingObject)} · ${escapeHtml(target.environment)}</p>
            </div>
            <span class="badge">${escapeHtml(target.status)}</span>
          </div>
          <p class="muted">${escapeHtml(target.modelName || target.endpointUrl || 'No endpoint/model captured')}</p>
          <div class="plan">
            ${target.testPlan
              .map(
                (step) => `
                  <div class="plan-step">
                    <span class="step-num">${step.stageOrder}</span>
                    <strong>${escapeHtml(step.stageLabel)}</strong>
                    <span class="status">${escapeHtml(step.status)}</span>
                  </div>
                `,
              )
              .join('')}
          </div>
        </article>
      `,
    )
    .join('');
}

function renderRegistryRows() {
  if (!state.targets.length) {
    return '<div class="empty">No registry entries yet. Onboard a model to create the first record.</div>';
  }
  return `
    <div class="registry-list">
      ${state.targets
        .map(
          (target) => `
            <article class="registry-row">
              <div>
                <h3>${escapeHtml(target.displayName)}</h3>
                <p class="muted">${escapeHtml(target.promptfooEntity)} · ${escapeHtml(target.environment)}</p>
              </div>
              <div>
                <p class="row-label">Target</p>
                <strong>${escapeHtml(target.modelName || target.endpointUrl || 'Not captured')}</strong>
              </div>
              <div>
                <p class="row-label">Flow</p>
                <strong>${target.testPlan.length} stages</strong>
              </div>
              <span class="badge">${escapeHtml(target.status)}</span>
            </article>
          `,
        )
        .join('')}
    </div>
  `;
}

function renderShell(content) {
  app.innerHTML = `
    <section class="app-shell">
      <header class="topbar">
        <div class="topbar-left">
          <div class="mark">OG</div>
          <div>
            <p class="eyebrow">Open Governance</p>
            <p class="topbar-title">Assurance onboarding control plane</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button class="secondary-button" id="go-registry" type="button">Registry</button>
          <button class="ghost-button" id="logout" type="button">Sign out</button>
        </div>
      </header>
      <div class="content">${content}</div>
    </section>
  `;

  document.getElementById('go-registry').addEventListener('click', () => {
    state.view = 'registry';
    renderRegistry();
  });

  document.getElementById('logout').addEventListener('click', () => {
    localStorage.removeItem('og_token');
    localStorage.removeItem('og_user');
    state.token = null;
    state.user = null;
    renderLogin();
  });
}

function renderRegistry(message = '', isError = false) {
  state.view = 'registry';
  renderShell(`
    <section class="registry-page">
      <div class="page-head">
        <div>
          <p class="eyebrow">Registry</p>
          <h1>AI target registry</h1>
          <p class="muted">All models, prompts, RAG pipelines, agents, APIs, and chat apps start here before they enter eval, red-team, model-audit, and evidence flows.</p>
        </div>
        <button class="primary-button" id="onboard-model" type="button">Onboard a model</button>
      </div>
      ${message ? `<div class="${isError ? 'error' : 'success'}">${escapeHtml(message)}</div>` : ''}
      <section class="panel">
        <div class="registry-summary">
          <div>
            <p class="row-label">Total entries</p>
            <strong>${state.targets.length}</strong>
          </div>
          <div>
            <p class="row-label">Supported classes</p>
            <strong>${state.catalog.supportedTargetTypes.length}</strong>
          </div>
          <div>
            <p class="row-label">Standard flow</p>
            <strong>${state.catalog.testFlowStages.map((stage) => stage.label).join(' -> ')}</strong>
          </div>
        </div>
        ${renderRegistryRows()}
      </section>
    </section>
  `);

  document.getElementById('onboard-model').addEventListener('click', () => {
    state.selectedType = 'plain_llm';
    state.view = 'onboard';
    renderOnboarding();
  });
}

function renderOnboarding(message = '', isError = false) {
  const selected = state.catalog.supportedTargetTypes.find((type) => type.key === state.selectedType);
  state.view = 'onboard';
  renderShell(`
        <button class="ghost-button back-button" id="back-to-registry" type="button">Back to registry</button>
        <div class="layout">
          <section class="panel">
            <p class="eyebrow">Onboard</p>
            <h2>Classify and onboard a target</h2>
            <p class="muted">Every onboarded target gets the same lifecycle: intake, eval, red team, model audit, and evidence pack.</p>
            ${message ? `<div class="${isError ? 'error' : 'success'}">${escapeHtml(message)}</div>` : ''}
            <div class="type-grid">${renderTypeOptions()}</div>
            <form class="form" id="target-form">
              <div class="form-grid">
                <div class="field">
                  <label for="displayName">Display name</label>
                  <input id="displayName" name="displayName" placeholder="e.g. Citizen services chatbot" required />
                </div>
                <div class="field">
                  <label for="ownerName">Owner</label>
                  <input id="ownerName" name="ownerName" placeholder="e.g. AI Platform Team" />
                </div>
                <div class="field">
                  <label for="environment">Environment</label>
                  <select id="environment" name="environment">
                    <option value="development">Development</option>
                    <option value="staging">Staging</option>
                    <option value="production">Production</option>
                    <option value="sovereign-airgap">Sovereign air-gap</option>
                  </select>
                </div>
                <div class="field">
                  <label for="modelName">Model name</label>
                  <input id="modelName" name="modelName" placeholder="e.g. llama-3.1-8b-instant" />
                </div>
                <div class="field span-2">
                  <label for="endpointUrl">Endpoint URL</label>
                  <input id="endpointUrl" name="endpointUrl" placeholder="https://api.example.gov/v1/chat/completions" />
                </div>
                <div class="field">
                  <label for="authStrategy">Auth strategy</label>
                  <select id="authStrategy" name="authStrategy">
                    <option value="none">None</option>
                    <option value="api-key">API key</option>
                    <option value="bearer-token">Bearer token</option>
                    <option value="mtls">mTLS</option>
                    <option value="private-network">Private network</option>
                  </select>
                </div>
                <div class="field">
                  <label for="riskTier">Initial risk tier</label>
                  <select id="riskTier" name="riskTier">
                    <option value="basic">Basic</option>
                    <option value="enhanced">Enhanced</option>
                    <option value="mission-critical">Mission-Critical</option>
                  </select>
                </div>
                <div class="field span-2">
                  <label for="systemPrompt">System prompt / operating instruction</label>
                  <textarea id="systemPrompt" name="systemPrompt" placeholder="Paste the core system prompt, policy instruction, or app behavior summary."></textarea>
                </div>
              </div>
              <input type="hidden" id="targetType" name="targetType" value="${escapeHtml(state.selectedType)}" />
              <p class="muted">Selected mapping: ${escapeHtml(selected.label)} becomes ${escapeHtml(selected.promptfooEntity)} in the assurance flow.</p>
              <button class="primary-button" type="submit">Create onboarding record</button>
            </form>
          </section>

          <aside class="panel">
            <p class="eyebrow">Next flow</p>
            <h2>What happens after onboarding</h2>
            <p class="muted">This record enters the standard assurance sequence.</p>
            <div class="target-list">${renderTargets()}</div>
          </aside>
        </div>
  `);

  document.getElementById('back-to-registry').addEventListener('click', () => {
    state.view = 'registry';
    renderRegistry();
  });

  document.querySelectorAll('.type-option').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedType = button.dataset.type;
      renderOnboarding();
    });
  });

  document.getElementById('target-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      displayName: form.get('displayName'),
      targetType: state.selectedType,
      ownerName: form.get('ownerName'),
      environment: form.get('environment'),
      endpointUrl: form.get('endpointUrl'),
      modelName: form.get('modelName'),
      authStrategy: form.get('authStrategy'),
      systemPrompt: form.get('systemPrompt'),
      metadata: {
        riskTier: form.get('riskTier'),
      },
    };
    try {
      await api('/api/targets', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadApp('Onboarding record created.');
    } catch (error) {
      renderOnboarding(error.message, true);
    }
  });
}

async function loadApp(message = '') {
  try {
    const [catalog, targets] = await Promise.all([api('/api/catalog'), api('/api/targets')]);
    state.catalog = catalog;
    state.targets = targets.targets;
    renderRegistry(message);
  } catch (error) {
    localStorage.removeItem('og_token');
    localStorage.removeItem('og_user');
    state.token = null;
    renderLogin(error.message);
  }
}

if (state.token) {
  loadApp();
} else {
  renderLogin();
}
