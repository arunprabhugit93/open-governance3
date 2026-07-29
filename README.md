# open-governance3

Starter harness for testing an LLM for prompt injection, jailbreak resistance, system-prompt leakage, canary leakage, and unsafe tool-use claims with Promptfoo.

The GitHub repo was empty when cloned, so this project has been initialized as a self-hostable LLM security testing workspace.

## Vendored Promptfoo Source

The actual Promptfoo source code is vendored into:

```text
promptfoo-source/
```

This is regular source code inside this repository, not a submodule. You can modify the frontend/backend source and commit it to your own GitHub repo. Promptfoo is MIT licensed; keep the upstream license/copyright notices when redistributing.

## Setup

```bash
npm install
cp .env.example .env
```

Start the backend and database:

```bash
npm run db:up
npm run app:dev
```

Run the React frontend in development:

```bash
npm run frontend:dev
```

Open the React app:

```text
http://localhost:5173
```

The backend API runs at:

```text
http://localhost:18080
```

Default development login:

```text
admin@example.com / admin123
```

For production-style serving through Express:

```bash
npm run frontend:build
npm run app:dev
```

After `frontend:build`, Express serves the React build from `app/frontend/dist`.

The onboarding UI stores supported Promptfoo target classes in Postgres:

| What's built | Onboarded as |
| --- | --- |
| Plain LLM | Model |
| Prompt application | Prompt |
| RAG application | RAG pipeline |
| AI Agent | Agent |
| Multi-agent system | Agent workflow |
| API exposing an LLM | API endpoint |
| Chatbot | Chat application |

Edit `.env` and point it at any OpenAI-compatible model endpoint.

Common local targets:

```bash
# Ollama
TARGET_BASE_URL=http://localhost:11434/v1
TARGET_MODEL=llama3.1
TARGET_API_KEY=local

# vLLM
TARGET_BASE_URL=http://localhost:8000/v1
TARGET_MODEL=meta-llama/Llama-3.1-8B-Instruct
TARGET_API_KEY=local

# LM Studio
TARGET_BASE_URL=http://localhost:1234/v1
TARGET_MODEL=local-model
TARGET_API_KEY=local
```

## Run Baseline Tests

```bash
npm run eval
```

Open the UI:

```bash
npm run view
```

The UI starts on port `15500` by default.

## What This Tests

- Benign instruction following
- System/developer prompt leakage
- Protected canary leakage
- Direct instruction override attempts
- Indirect prompt injection inside quoted document content
- Fabricated tool-use claims

These are safe baseline checks. For broader generated red-team suites, use Promptfoo red-team generation after configuring an attacker model that is allowed in your environment.

## Advanced Red Teaming

Promptfoo can generate adversarial tests with:

```bash
npm run redteam:init
npm run redteam
npm run redteam:report
```

For sovereign or air-gapped use, keep:

```bash
PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true
```

and configure the red-team attacker provider to use a local model.
