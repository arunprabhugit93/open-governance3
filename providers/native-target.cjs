require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function textFromContent(content) {
  if (Array.isArray(content)) {
    return content.map((item) => item.text || '').join('');
  }
  return typeof content === 'string' ? content : '';
}

function normalizeProviderResult(result) {
  if (typeof result === 'string') {
    return { output: result };
  }
  const body = result && typeof result === 'object' ? result : { output: String(result ?? '') };
  if (body.error) {
    return { error: typeof body.error === 'string' ? body.error : JSON.stringify(body.error) };
  }
  const output =
    body.output ??
    body.response ??
    body.answer ??
    body.text ??
    body.message?.content ??
    body.choices?.[0]?.message?.content ??
    body.raw ??
    '';
  return {
    output: typeof output === 'string' ? output : JSON.stringify(output),
    tokenUsage: body.tokenUsage || body.usage || body.usageMetadata,
    finishReason: body.finishReason || body.finish_reason || body.choices?.[0]?.finish_reason,
    cost: body.cost ?? 0,
  };
}

module.exports = class NativeTargetProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'native-target';
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    const adapter = this.config.adapter || 'openai-compatible';
    try {
      switch (adapter) {
        case 'openai-compatible':
          return await this.callOpenAICompatible(prompt);
        case 'azure-openai':
          return await this.callAzureOpenAI(prompt);
        case 'anthropic':
          return await this.callAnthropic(prompt);
        case 'cohere':
          return await this.callCohere(prompt);
        case 'gemini':
          return await this.callGemini(prompt);
        case 'http-json':
          return await this.callHttpJson(prompt);
        case 'cli-provider':
          return await this.callCliProvider(prompt);
        case 'custom-script':
          return await this.callCustomScriptProvider(prompt);
        default:
          return { error: `Native provider adapter "${adapter}" is not implemented` };
      }
    } catch (error) {
      return { error: error.message };
    }
  }

  baseUrl() {
    return String(this.config.baseUrl || process.env.TARGET_BASE_URL || '').replace(/\/$/, '');
  }

  model() {
    return this.config.model || process.env.TARGET_MODEL || '';
  }

  apiKey() {
    return this.config.apiKey || process.env.TARGET_API_KEY || '';
  }

  apiVersion() {
    return this.config.apiVersion || '2024-06-01';
  }

  systemPrompt() {
    return this.config.systemPrompt || process.env.TARGET_SYSTEM_PROMPT || '';
  }

  messages(prompt) {
    return [
      ...(this.systemPrompt() ? [{ role: 'system', content: this.systemPrompt() }] : []),
      { role: 'user', content: prompt },
    ];
  }

  context(prompt) {
    return {
      prompt,
      input: prompt,
      model: this.model(),
      systemPrompt: this.systemPrompt(),
      apiKey: this.apiKey(),
      temperature: this.config.temperature ?? 0,
      maxTokens: this.config.maxTokens ?? 512,
      baseUrl: this.config.baseUrl || '',
      messages: this.messages(prompt),
    };
  }

  templateCommand(command, context) {
    let text = String(command || '');
    const replacements = {
      prompt: context.prompt,
      input: context.prompt,
      model: context.model,
      systemPrompt: context.systemPrompt,
      temperature: context.temperature,
      maxTokens: context.maxTokens,
    };
    for (const [key, value] of Object.entries(replacements)) {
      text = text.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), String(value ?? ''));
    }
    return text;
  }

  async callCliProvider(prompt) {
    const context = this.context(prompt);
    const command = this.templateCommand(String(this.config.baseUrl || this.config.model || '').replace(/^exec:\/\//, '').trim(), context);
    if (!command) return { error: 'CLI provider command is required in Base URL or Model' };
    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          OG_PROMPT: context.prompt || '',
          OG_INPUT: context.prompt || '',
          OG_MODEL: context.model || '',
          OG_SYSTEM_PROMPT: context.systemPrompt || '',
          OG_API_KEY: context.apiKey || '',
          OG_TEMPERATURE: String(context.temperature ?? ''),
          OG_MAX_TOKENS: String(context.maxTokens ?? ''),
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ error: 'CLI provider timed out' });
      }, Number(this.config.timeoutMs || 30000));
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        resolve({ error: error.message });
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        const text = stdout.trim();
        if (code !== 0) {
          resolve({ error: stderr.trim() || text || `CLI provider exited with code ${code}` });
          return;
        }
        try {
          resolve(normalizeProviderResult(JSON.parse(text)));
        } catch {
          resolve(normalizeProviderResult(text));
        }
      });
      child.stdin.end(`${JSON.stringify(context)}\n`);
    });
  }

  scriptPath() {
    const raw = String(this.config.baseUrl || this.config.model || '').trim().replace(/^file:\/\//, '');
    if (!raw) throw new Error('Custom script provider path is required in Base URL');
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }

  async loadProviderScript(scriptPath) {
    if (!fs.existsSync(scriptPath)) throw new Error(`Custom script provider not found: ${scriptPath}`);
    if (scriptPath.endsWith('.mjs')) {
      const imported = await import(`${pathToFileURL(scriptPath).href}?t=${Date.now()}`);
      return imported.default || imported;
    }
    delete require.cache[require.resolve(scriptPath)];
    const loaded = require(scriptPath);
    return loaded.default || loaded;
  }

  async callCustomScriptProvider(prompt) {
    const scriptPath = this.scriptPath();
    const loaded = await this.loadProviderScript(scriptPath);
    const context = this.context(prompt);
    let result;
    if (typeof loaded === 'function' && loaded.prototype?.callApi) {
      result = await new loaded({ id: 'custom-script', config: this.config }).callApi(prompt, context);
    } else if (typeof loaded === 'function') {
      result = await loaded(context);
    } else if (loaded && typeof loaded.callApi === 'function') {
      result = await loaded.callApi(prompt, context);
    } else if (loaded && typeof loaded.handler === 'function') {
      result = await loaded.handler(context);
    } else {
      return { error: 'Custom script must export a function, handler, callApi object, or provider class' };
    }
    return normalizeProviderResult(result);
  }

  async callOpenAICompatible(prompt) {
    const baseUrl = this.baseUrl();
    const model = this.model();
    if (!baseUrl) return { error: 'Provider base URL is required' };
    if (!model) return { error: 'Model name is required' };
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey() || 'local'}`,
      },
      body: JSON.stringify({
        model,
        messages: this.messages(prompt),
        temperature: this.config.temperature ?? 0,
        max_tokens: this.config.maxTokens ?? 512,
      }),
    });
    const bodyText = await response.text();
    const body = parseBody(bodyText);
    if (!response.ok) return { error: body.error?.message || bodyText || `HTTP ${response.status}` };
    return {
      output: body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? body.output ?? '',
      tokenUsage: body.usage,
    };
  }

  async callAzureOpenAI(prompt) {
    const baseUrl = this.baseUrl();
    const deployment = this.model();
    if (!baseUrl) return { error: 'Azure OpenAI resource base URL is required' };
    if (!deployment) return { error: 'Azure OpenAI deployment name is required (use the Model field)' };
    const root = baseUrl.replace(/\/openai\/deployments\/.*$/i, '');
    const url = `${root}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion())}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.apiKey() || '',
      },
      body: JSON.stringify({
        messages: this.messages(prompt),
        temperature: this.config.temperature ?? 0,
        max_tokens: this.config.maxTokens ?? 512,
      }),
    });
    const bodyText = await response.text();
    const body = parseBody(bodyText);
    if (!response.ok) return { error: body.error?.message || bodyText || `HTTP ${response.status}` };
    return {
      output: body.choices?.[0]?.message?.content ?? body.choices?.[0]?.text ?? body.output ?? '',
      tokenUsage: body.usage,
    };
  }

  async callAnthropic(prompt) {
    const baseUrl = this.baseUrl();
    const model = this.model();
    if (!baseUrl) return { error: 'Anthropic base URL is required' };
    if (!model) return { error: 'Anthropic model is required' };
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: this.config.maxTokens ?? 512,
        temperature: this.config.temperature ?? 0,
        ...(this.systemPrompt() ? { system: this.systemPrompt() } : {}),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const bodyText = await response.text();
    const body = parseBody(bodyText);
    if (!response.ok) return { error: body.error?.message || bodyText || `HTTP ${response.status}` };
    return {
      output: textFromContent(body.content) || body.completion || body.output || '',
      tokenUsage: body.usage,
    };
  }

  async callCohere(prompt) {
    const baseUrl = this.baseUrl();
    const model = this.model();
    if (!baseUrl) return { error: 'Cohere base URL is required' };
    if (!model) return { error: 'Cohere model is required' };
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify({
        model,
        temperature: this.config.temperature ?? 0,
        max_tokens: this.config.maxTokens ?? 512,
        messages: this.messages(prompt),
      }),
    });
    const bodyText = await response.text();
    const body = parseBody(bodyText);
    if (!response.ok) return { error: body.message || body.error?.message || bodyText || `HTTP ${response.status}` };
    return {
      output: textFromContent(body.message?.content) || body.text || body.response || '',
      tokenUsage: body.usage || body.meta?.tokens,
    };
  }

  async callGemini(prompt) {
    const baseUrl = this.baseUrl();
    const model = this.model();
    if (!baseUrl) return { error: 'Gemini base URL is required' };
    if (!model) return { error: 'Gemini model is required' };
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent${this.apiKey() ? `?key=${encodeURIComponent(this.apiKey())}` : ''}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(this.systemPrompt() ? { systemInstruction: { parts: [{ text: this.systemPrompt() }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: this.config.temperature ?? 0,
          maxOutputTokens: this.config.maxTokens ?? 512,
        },
      }),
    });
    const bodyText = await response.text();
    const body = parseBody(bodyText);
    if (!response.ok) return { error: body.error?.message || bodyText || `HTTP ${response.status}` };
    return {
      output: body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || body.text || '',
      tokenUsage: body.usageMetadata,
    };
  }

  async callHttpJson(prompt) {
    const baseUrl = this.baseUrl();
    if (!baseUrl) return { error: 'HTTP JSON endpoint URL is required' };
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey() ? { Authorization: `Bearer ${this.apiKey()}` } : {}),
      },
      body: JSON.stringify({
        prompt,
        input: prompt,
        model: this.model(),
        systemPrompt: this.systemPrompt(),
        temperature: this.config.temperature ?? 0,
        maxTokens: this.config.maxTokens ?? 512,
        messages: this.messages(prompt),
      }),
    });
    const bodyText = await response.text();
    const body = parseBody(bodyText);
    if (!response.ok) return { error: body.error?.message || body.message || bodyText || `HTTP ${response.status}` };
    const output =
      body.output ||
      body.response ||
      body.answer ||
      body.text ||
      body.message?.content ||
      body.choices?.[0]?.message?.content ||
      body.raw ||
      '';
    return {
      output: typeof output === 'string' ? output : JSON.stringify(output),
      tokenUsage: body.usage,
    };
  }
};
