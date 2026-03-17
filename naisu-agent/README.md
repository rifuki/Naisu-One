# Agent Infra (LangChain + TypeScript)

Reusable AI Agent infrastructure for multi-project use.

## Features
- **Long-term memory** (persistent semantic memory per user)
- **Fast memory** (in-memory cache of latest memory items)
- **Session per user** (persistent session history)
- **Context management** (recent context window)
- **Pluggable memory backend** (`local` / `letta` / `redis`)
- **Pluggable LLM provider** (`openai` / `kimi` / `heurist`)
- **OAuth authentication** (Kimi Code integration)
- **RAG ingestion pipeline** (documents -> chunks -> query)
- **Pluggable RAG backend** (`none` / `llamaindex`)
- **Structured tools + tool-calling**
- **Tool policy guardrail** (`safe_only` / `allow_all`)
- **Tool audit log** for observability
- **Session persona loading** via `SOUL.md`, `CHARACTER.md`, `SKILL.md`
- **Clean architecture** (DRY, KISS, composable)

## Stack
- Fastify API
- LangChain (`@langchain/openai`, `@langchain/core`)
- Zod validation
- JSON-backed persistence (simple infra-first default)

## Quickstart
```bash
cp .env.example .env
npm install
npm run dev
```

## Configuration

### LLM Provider Selection

#### OpenAI (Default)
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
MODEL=gpt-4.1-mini
```

#### Kimi (Moonshot AI)
```bash
LLM_PROVIDER=kimi
KIMI_API_KEY=your_kimi_key
MODEL=kimi-k2-turbo-preview
```

Kimi API is fully OpenAI-compatible. Get your API key from [Moonshot AI Platform](https://platform.moonshot.cn).

#### Heurist LLM Gateway
```bash
LLM_PROVIDER=heurist
HEURIST_API_KEY=your_user_id#your_api_key
MODEL=hermes-3-llama3.1-8b
```

Heurist provides decentralized open-source LLMs at low cost. Features:
- OpenAI-compatible API
- Support for multiple open-source models (Llama, Mistral, Hermes)
- Tool calling support
- Embeddings support

Get your API key from [Heurist](https://heurist.xyz). API key format: `your_user_id#your_api_key`.

**Available Models:**
- `hermes-3-llama3.1-8b` - Good for tool calling
- `mistralai/mixtral-8x7b-instruct` - Mixture of Experts model
- `meta-llama/llama-3-70b-instruct` - Large Llama 3 model
- `meta-llama/llama-3-8b-instruct` - Efficient Llama 3 model

### OAuth Authentication (Optional)

Enable OAuth for user authentication (supports Kimi Code integration):

```bash
OAUTH_ENABLED=true
OAUTH_PROVIDER=kimi
OAUTH_CLIENT_ID=your_client_id
OAUTH_CLIENT_SECRET=your_client_secret
OAUTH_REDIRECT_URI=http://localhost:8787/v1/oauth/callback
```

## API

### Health Check
```bash
GET /health
```

### Chat
### `POST /v1/chat`
```json
{
  "userId": "jar",
  "sessionId": "optional",
  "message": "remember i prefer low risk"
}
```

Response:
```json
{
  "ok": true,
  "sessionId": "...",
  "message": "..."
}
```

### OAuth Authentication

#### Get Login URL
```bash
GET /v1/oauth/login?redirectUrl=/dashboard
```

Response:
```json
{
  "ok": true,
  "url": "https://kimi.com/oauth/authorize?...",
  "state": "..."
}
```

#### OAuth Callback
```bash
GET /v1/oauth/callback?code=xxx&state=yyy
```

#### Get Current Session
```bash
GET /v1/oauth/session
```

#### Logout
```bash
POST /v1/oauth/logout
```

### RAG (Retrieval-Augmented Generation)

### `POST /v1/rag/ingest`
```json
{
  "tenantId": "naisu1",
  "source": "docs/whitepaper.md",
  "content": "...large text...",
  "metadata": {"kind": "whitepaper"}
}
```

### `GET /v1/rag/jobs/:jobId`
Check ingestion job status.

### `GET /v1/rag/search?tenantId=naisu1&query=intents&limit=5`
Keyword chunk search (baseline retrieval path).

## Built-in Tools
- `memory_save` → persist long-term memory
- `memory_search` → semantic recall
- `context_get` → read recent session context
- `time_now` → UTC timestamp

## Project Structure
```txt
src/
  agent/
    runtime.ts           # Core agent runtime
    retriever-*.ts       # RAG retriever providers
  api/
    schemas.ts           # Zod validation schemas
  config/
    env.ts               # Environment configuration
    persona.ts           # Persona loading
  llm/
    factory.ts           # LLM provider factory (OpenAI/Kimi/Heurist)
  memory/
    provider.ts          # Memory provider interface
    factory.ts           # Memory backend factory
    *-provider.ts        # Memory implementations
  oauth/
    service.ts           # OAuth service
    store.ts             # OAuth state/session storage
    types.ts             # OAuth type definitions
  session/
    provider.ts          # Session provider interface
    factory.ts           # Session backend factory
  tools/
    toolkit.ts           # Built-in tools
    policy.ts            # Tool policy enforcement
    audit.ts             # Tool audit logging
  server.ts              # Fastify server
```

## Backend Switches

### LLM Provider
- `LLM_PROVIDER=openai|kimi|heurist`
- `OPENAI_API_KEY=` - OpenAI API key
- `KIMI_API_KEY=` - Kimi API key
- `KIMI_BASE_URL=https://api.moonshot.cn/v1`
- `HEURIST_API_KEY=` - Heurist API key (format: `user_id#api_key`)
- `HEURIST_BASE_URL=https://llm-gateway.heurist.xyz`

### Memory Backend
- `MEMORY_BACKEND=local|letta|redis`
- `SESSION_BACKEND=local|redis`
- `RAG_BACKEND=none|llamaindex`
- `REDIS_URL=redis://localhost:6379`
- `REDIS_PREFIX=agentinfra`

### OAuth Configuration
- `OAUTH_ENABLED=true|false`
- `OAUTH_PROVIDER=kimi|custom`
- `OAUTH_CLIENT_ID=` - OAuth client ID
- `OAUTH_CLIENT_SECRET=` - OAuth client secret
- `OAUTH_REDIRECT_URI=` - Callback URL
- `OAUTH_AUTH_URL=` - Authorization endpoint (custom provider)
- `OAUTH_TOKEN_URL=` - Token endpoint (custom provider)
- `OAUTH_USERINFO_URL=` - User info endpoint (custom provider)

`letta` adapter expects:
- `POST /v1/memory/upsert`
- `POST /v1/memory/search`
- `GET /health`

`llamaindex` adapter expects:
- `POST /v1/retrieve`

If endpoint/API contracts differ in your deployment, edit adapter files only (core runtime unchanged).

## Policy & Audit
- `TOOL_POLICY_MODE=safe_only` allows only vetted tools.
- `TOOL_POLICY_MODE=allow_all` allows all registered tools.
- Tool calls are logged to `src/data/tool-audit.json`.

## CI / Security Workflows
- `.github/workflows/ci.yml` → install, typecheck, build on push/PR
- `.github/workflows/codeql.yml` → static security analysis (weekly + push/PR)

## Production Upgrade Path
- Replace JSON store with Postgres/Redis
- Add auth + tenant isolation
- Add rate limiting + observability
- Expand tool policy to role/tenant-based permissions
- Add eval/test suite for tool-calling reliability
