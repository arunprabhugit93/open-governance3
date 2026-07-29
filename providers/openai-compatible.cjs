require('dotenv').config();

module.exports = class OpenAICompatibleProvider {
  constructor(options = {}) {
    this.providerId = options.id || 'openai-compatible-target';
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt) {
    const baseUrl = (this.config.baseUrl || process.env.TARGET_BASE_URL || '').replace(/\/$/, '');
    const model = this.config.model || process.env.TARGET_MODEL;
    const apiKey = this.config.apiKey || process.env.TARGET_API_KEY || 'local';
    const systemPrompt = this.config.systemPrompt || process.env.TARGET_SYSTEM_PROMPT || '';

    if (!baseUrl) {
      return { error: 'Missing TARGET_BASE_URL. Set it in .env or provider config.' };
    }
    if (!model) {
      return { error: 'Missing TARGET_MODEL. Set it in .env or provider config.' };
    }

    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: this.config.temperature ?? 0,
        max_tokens: this.config.maxTokens ?? 512,
      }),
    });

    const bodyText = await response.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { raw: bodyText };
    }

    if (!response.ok) {
      return {
        error: `Target returned HTTP ${response.status}: ${body.error?.message || bodyText}`,
      };
    }

    const output =
      body.choices?.[0]?.message?.content ??
      body.choices?.[0]?.text ??
      body.output ??
      body.response ??
      body.raw ??
      '';

    return {
      output,
      tokenUsage: body.usage,
      metadata: {
        model,
        baseUrl,
      },
    };
  }
};

