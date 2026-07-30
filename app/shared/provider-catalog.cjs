const PROVIDER_GROUPS = [
  {
    key: 'openai_compatible',
    label: 'OpenAI-compatible APIs',
    providers: [
      ['openai', 'OpenAI', 'https://api.openai.com/v1'],
      ['azure-openai', 'Azure OpenAI', 'https://{resource}.openai.azure.com/openai/deployments/{deployment}'],
      ['groq', 'GroqCloud', 'https://api.groq.com/openai/v1'],
      ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1'],
      ['together', 'Together AI', 'https://api.together.xyz/v1'],
      ['fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1'],
      ['perplexity', 'Perplexity', 'https://api.perplexity.ai'],
      ['mistral', 'Mistral', 'https://api.mistral.ai/v1'],
      ['deepinfra', 'DeepInfra', 'https://api.deepinfra.com/v1/openai'],
      ['anyscale', 'Anyscale', 'https://api.endpoints.anyscale.com/v1'],
      ['replicate-openai', 'Replicate OpenAI-compatible', 'https://api.replicate.com/v1'],
      ['local-openai', 'Local OpenAI-compatible', 'http://localhost:8000/v1'],
    ],
  },
  {
    key: 'local_runtime',
    label: 'Local and self-hosted runtimes',
    providers: [
      ['ollama', 'Ollama', 'http://localhost:11434/v1'],
      ['lmstudio', 'LM Studio', 'http://localhost:1234/v1'],
      ['vllm', 'vLLM', 'http://localhost:8000/v1'],
      ['text-generation-webui', 'text-generation-webui', 'http://localhost:5000/v1'],
      ['llama-cpp', 'llama.cpp server', 'http://localhost:8080/v1'],
      ['sglang', 'SGLang', 'http://localhost:30000/v1'],
      ['tgi', 'Hugging Face TGI', 'http://localhost:8080/v1'],
      ['triton', 'NVIDIA Triton gateway', 'http://localhost:8000/v1'],
      ['ray-serve', 'Ray Serve gateway', 'http://localhost:8000/v1'],
      ['custom-local', 'Custom local gateway', 'http://localhost:9000/v1'],
    ],
  },
  {
    key: 'cloud_model_platforms',
    label: 'Cloud model platforms',
    providers: [
      ['anthropic', 'Anthropic', 'https://api.anthropic.com'],
      ['google-gemini', 'Google Gemini', 'https://generativelanguage.googleapis.com/v1beta'],
      ['vertex-ai', 'Google Vertex AI', 'https://{region}-aiplatform.googleapis.com'],
      ['aws-bedrock', 'AWS Bedrock', 'bedrock-runtime'],
      ['aws-sagemaker', 'AWS SageMaker endpoint', 'sagemaker-runtime'],
      ['cohere', 'Cohere', 'https://api.cohere.com/v2'],
      ['watsonx', 'IBM watsonx.ai', 'https://{region}.ml.cloud.ibm.com'],
      ['databricks', 'Databricks Model Serving', 'https://{workspace}/serving-endpoints'],
      ['snowflake-cortex', 'Snowflake Cortex', 'snowflake-cortex'],
      ['cloudflare-workers-ai', 'Cloudflare Workers AI', 'https://api.cloudflare.com/client/v4/accounts/{account}/ai'],
      ['vercel-ai-gateway', 'Vercel AI Gateway', 'https://ai-gateway.vercel.sh/v1'],
    ],
  },
  {
    key: 'application_targets',
    label: 'Application and API targets',
    providers: [
      ['http-json', 'HTTP JSON API', 'https://api.example.com/chat'],
      ['rest-chat', 'REST chat endpoint', 'https://api.example.com/v1/chat'],
      ['graphql', 'GraphQL endpoint', 'https://api.example.com/graphql'],
      ['websocket-chat', 'WebSocket chat endpoint', 'wss://api.example.com/chat'],
      ['browser-chatbot', 'Browser chatbot', 'https://app.example.com/chat'],
      ['rag-service', 'RAG service API', 'https://api.example.com/rag/query'],
      ['agent-service', 'Agent service API', 'https://api.example.com/agent/run'],
      ['multi-agent-workflow', 'Multi-agent workflow API', 'https://api.example.com/workflows/run'],
      ['mcp-server', 'MCP server target', 'mcp://server'],
      ['cli-provider', 'CLI provider', 'exec://command'],
      ['custom-script', 'Custom script provider', 'file://provider.js'],
    ],
  },
  {
    key: 'specialized',
    label: 'Specialized providers',
    providers: [
      ['huggingface-inference', 'Hugging Face Inference Providers', 'https://router.huggingface.co/v1'],
      ['replicate', 'Replicate', 'https://api.replicate.com/v1'],
      ['fal', 'fal.ai', 'https://fal.run'],
      ['voyage', 'Voyage AI', 'https://api.voyageai.com/v1'],
      ['nvidia-nim', 'NVIDIA NIM', 'https://integrate.api.nvidia.com/v1'],
      ['cerebras', 'Cerebras', 'https://api.cerebras.ai/v1'],
      ['sambanova', 'SambaNova', 'https://api.sambanova.ai/v1'],
      ['ai21', 'AI21', 'https://api.ai21.com/studio/v1'],
      ['xai', 'xAI', 'https://api.x.ai/v1'],
      ['moonshot', 'Moonshot AI', 'https://api.moonshot.ai/v1'],
      ['deepseek', 'DeepSeek', 'https://api.deepseek.com/v1'],
    ],
  },
];

const ADAPTER_BY_PROVIDER = {
  anthropic: 'anthropic',
  cohere: 'cohere',
  'azure-openai': 'azure-openai',
  'google-gemini': 'gemini',
  'http-json': 'http-json',
  'rest-chat': 'http-json',
  'rag-service': 'http-json',
  'agent-service': 'http-json',
  'multi-agent-workflow': 'http-json',
  'cli-provider': 'cli-provider',
  'custom-script': 'custom-script',
};

// Providers executed by delegating to the real, vendored `promptfoo` npm package
// (promptfoo.loadApiProvider) instead of a hand-written HTTP adapter — these are
// providers whose real auth/request shape (AWS SigV4, GCP service-account OAuth, IBM
// IAM, etc.) is genuinely complex, so reimplementing them by hand would be slower and
// more bug-prone than reusing promptfoo's own, already-correct provider code.
// Value = the provider-path prefix promptfoo's provider registry matches on.
const PROMPTFOO_LIBRARY_PROVIDERS = {
  'vertex-ai': 'vertex',
  'aws-bedrock': 'bedrock',
  'aws-sagemaker': 'sagemaker',
  watsonx: 'watsonx',
  databricks: 'databricks',
  'snowflake-cortex': 'snowflake',
  'cloudflare-workers-ai': 'cloudflare-ai',
  'mcp-server': 'mcp',
  fal: 'fal',
  voyage: 'voyage',
};
for (const key of Object.keys(PROMPTFOO_LIBRARY_PROVIDERS)) {
  ADAPTER_BY_PROVIDER[key] = 'promptfoo-library';
}

const OPENAI_COMPATIBLE_KEYS = new Set([
  'openai',
  'groq',
  'openrouter',
  'together',
  'fireworks',
  'perplexity',
  'mistral',
  'deepinfra',
  'anyscale',
  'replicate-openai',
  'local-openai',
  'ollama',
  'lmstudio',
  'vllm',
  'text-generation-webui',
  'llama-cpp',
  'sglang',
  'tgi',
  'triton',
  'ray-serve',
  'custom-local',
  'vercel-ai-gateway',
  'nvidia-nim',
  'cerebras',
  'sambanova',
  'xai',
  'moonshot',
  'deepseek',
  'huggingface-inference',
  'ai21',
]);

function adapterForProvider(key) {
  if (ADAPTER_BY_PROVIDER[key]) return ADAPTER_BY_PROVIDER[key];
  if (OPENAI_COMPATIBLE_KEYS.has(key)) return 'openai-compatible';
  return 'adapter-required';
}

function providerObjects() {
  return PROVIDER_GROUPS.map((group) => ({
    ...group,
    providers: group.providers.map(([key, label, defaultBaseUrl]) => ({
      key,
      label,
      defaultBaseUrl,
      adapter: adapterForProvider(key),
      executable: adapterForProvider(key) !== 'adapter-required',
    })),
  }));
}

module.exports = {
  PROVIDER_GROUPS: providerObjects(),
  adapterForProvider,
  PROMPTFOO_LIBRARY_PROVIDERS,
};
