const SUPPORTED_TARGET_TYPES = [
  {
    key: 'plain_llm',
    label: 'Plain LLM',
    promptfooEntity: 'Model',
    onboardingObject: 'Model + prompt',
    description: 'A raw chat/completion model exposed by a provider or local runtime.',
    requiredFields: ['displayName', 'modelName'],
  },
  {
    key: 'prompt_application',
    label: 'Prompt application',
    promptfooEntity: 'Prompt',
    onboardingObject: 'Prompt',
    description: 'A prompt template or instruction set wrapped around one or more models.',
    requiredFields: ['displayName', 'modelName', 'systemPrompt'],
  },
  {
    key: 'rag_application',
    label: 'RAG application',
    promptfooEntity: 'RAG pipeline',
    onboardingObject: 'RAG pipeline',
    description: 'A retrieval pipeline including embeddings, vector index, retriever, and generator.',
    requiredFields: ['displayName', 'endpointUrl'],
  },
  {
    key: 'ai_agent',
    label: 'AI Agent',
    promptfooEntity: 'Agent',
    onboardingObject: 'Agent',
    description: 'A tool-using or memory-bearing agent evaluated as a complete loop.',
    requiredFields: ['displayName', 'endpointUrl'],
  },
  {
    key: 'multi_agent_system',
    label: 'Multi-agent system',
    promptfooEntity: 'Agent workflow',
    onboardingObject: 'Agent workflow',
    description: 'A coordinated multi-agent workflow with handoffs, tools, and shared state.',
    requiredFields: ['displayName', 'endpointUrl'],
  },
  {
    key: 'api_endpoint',
    label: 'API exposing an LLM',
    promptfooEntity: 'API endpoint',
    onboardingObject: 'API endpoint',
    description: 'An HTTP API that wraps model, prompt, RAG, or agent behavior.',
    requiredFields: ['displayName', 'endpointUrl'],
  },
  {
    key: 'chatbot',
    label: 'Chatbot',
    promptfooEntity: 'Chat application',
    onboardingObject: 'Chat application',
    description: 'A user-facing chat experience backed by a model, prompt app, RAG, or agent.',
    requiredFields: ['displayName', 'endpointUrl'],
  },
];

const TEST_FLOW_STAGES = [
  {
    key: 'intake',
    label: 'Intake & classification',
    description: 'Capture target type, owner, environment, endpoint/model metadata, and risk context.',
  },
  {
    key: 'eval',
    label: 'Eval',
    description: 'Run deterministic evals for correctness, utility, and baseline safety.',
  },
  {
    key: 'red_team',
    label: 'Red team',
    description: 'Run prompt injection, jailbreak, extraction, tool-abuse, and adversarial probes.',
  },
  {
    key: 'model_audit',
    label: 'Model audit',
    description: 'Collect lineage, configuration, provider, dependency, and governance evidence.',
  },
  {
    key: 'evidence',
    label: 'Evidence pack',
    description: 'Prepare scorecards, findings, remediation status, and approval artifacts.',
  },
];

function getTargetType(key) {
  return SUPPORTED_TARGET_TYPES.find((type) => type.key === key);
}

module.exports = {
  SUPPORTED_TARGET_TYPES,
  TEST_FLOW_STAGES,
  getTargetType,
};
