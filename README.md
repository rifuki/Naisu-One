# Naisu

**AI-Powered DeFi Ecosystem**

Naisu is a comprehensive platform that combines artificial intelligence with decentralized finance, enabling users to interact with DeFi protocols through intelligent AI agents. The platform provides a complete infrastructure for building, deploying, and managing AI agents capable of executing complex DeFi operations across multiple blockchain networks.

## 🌟 Overview

Naisu bridges the gap between AI and DeFi by providing:

- **Intelligent AI Agents** – Deploy custom AI agents that understand natural language and execute DeFi strategies
- **Multi-Chain Support** – Seamlessly interact with EVM chains (Base, Ethereum) and Solana
- **Advanced Memory Systems** – Agents with long-term semantic memory and session persistence
- **DeFi Integration** – Direct integration with Uniswap V4 for swaps, liquidity provision, and pool management
- **Knowledge Base** – RAG-powered document ingestion for context-aware agent responses
- **Secure Architecture** – Tool policy guardrails, audit logging, and OAuth authentication

## 🏗️ Architecture

```
naisu-one/
├── agent-hub/              # AI Agent Management Dashboard
│   ├── Agent creation & management UI
│   ├── Real-time monitoring dashboard
│   ├── Knowledge base management
│   ├── API key administration
│   └── Chat interface for agent interaction
├── agent-infra-langchain-ts/  # Core AI Agent Infrastructure
│   ├── Multi-provider LLM support (OpenAI, Kimi, Heurist)
│   ├── Persistent memory (local, Redis, Letta)
│   ├── RAG pipeline with LlamaIndex
│   ├── Tool policy enforcement
│   └── OAuth authentication
├── naisu-backend/          # DeFi Backend API
│   ├── Uniswap V4 integration
│   ├── Pool state & price queries
│   ├── Swap quoting & transaction building
│   ├── Position management
│   └── EVM chain interactions
├── naisu1-fe/              # DeFi Frontend Application
│   └── React + Vite + Wagmi interface
└── naisu1-program/         # Solana Smart Contracts
    └── Anchor-based on-chain programs
```

## ✨ Key Features

### AI Agent Infrastructure
- **Long-term Memory** – Persistent semantic memory per user with configurable backends
- **Fast Memory Cache** – In-memory caching for recent memory items
- **Session Management** – Persistent conversation history across interactions
- **Multi-Provider LLM** – Support for OpenAI, Kimi (Moonshot AI), and Heurist
- **RAG System** – Document ingestion, chunking, and semantic search
- **Tool Ecosystem** – Extensible tool system with policy enforcement and audit logging

### DeFi Capabilities
- **Uniswap V4 Integration** – Direct access to pool states, swaps, and liquidity operations
- **Transaction Building** – Unsigned transaction generation for secure user signing
- **Multi-Chain Support** – Base Sepolia, Base Mainnet, and Ethereum compatibility
- **Real-time Price Data** – Live pool pricing and liquidity information
- **Position Tracking** – Monitor and manage liquidity positions

### Management Dashboard
- **Agent Hub** – Create, configure, and monitor AI agents from a unified interface
- **Analytics** – Track API usage, token consumption, and agent performance
- **Knowledge Base** – Upload and manage documents for RAG-powered responses
- **API Keys** – Secure key management with rate limiting
- **Chat Interface** – Natural language interaction with deployed agents

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh) >= 1.0.0 (for backend)
- [Node.js](https://nodejs.org) >= 18 (for frontend)

### 1. Start the AI Infrastructure

```bash
cd agent-infra-langchain-ts
cp .env.example .env
# Configure your LLM provider and other settings
npm install
npm run dev
```

### 2. Start the DeFi Backend

```bash
cd naisu-backend
cp .env.example .env
# Configure RPC URLs and contract addresses
bun install
bun run dev
```

### 3. Start the Agent Hub Dashboard

```bash
cd agent-hub
cp .env.example .env
npm install
npm run dev
```

### 4. Access the Platform

- **Agent Hub**: http://localhost:5173
- **AI Infrastructure API**: http://localhost:8787
- **DeFi Backend API**: http://localhost:3000

## 🔌 API Endpoints

### AI Infrastructure

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat` | Send messages to AI agents |
| `POST /v1/rag/ingest` | Ingest documents for RAG |
| `GET /v1/rag/search` | Search knowledge base |
| `GET /health` | Service health check |

### DeFi Backend

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/uniswap-v4/pool/price` | Get pool price |
| `GET /api/v1/uniswap-v4/swap/quote` | Quote swap amounts |
| `POST /api/v1/uniswap-v4/swap/build` | Build swap transactions |
| `POST /api/v1/uniswap-v4/pools/batch` | Batch pool queries |

## 🔧 Configuration

### LLM Provider Selection

**OpenAI (Default)**
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
MODEL=gpt-4.1-mini
```

**Kimi (Moonshot AI)**
```bash
LLM_PROVIDER=kimi
KIMI_API_KEY=your_kimi_key
MODEL=kimi-k2-turbo-preview
```

**Heurist LLM Gateway**
```bash
LLM_PROVIDER=heurist
HEURIST_API_KEY=your_user_id#your_api_key
MODEL=hermes-3-llama3.1-8b
```

### Memory Backends

```bash
# Local JSON (default)
MEMORY_BACKEND=local

# Redis
MEMORY_BACKEND=redis
REDIS_URL=redis://localhost:6379

# Letta
MEMORY_BACKEND=letta
```

## 🛡️ Security Features

- **Tool Policy Enforcement** – `safe_only` mode restricts agents to vetted tools only
- **Audit Logging** – All tool calls logged for observability
- **OAuth Authentication** – Secure user authentication with Kimi Code integration
- **Rate Limiting** – Configurable API rate limits per key
- **Unsigned Transactions** – DeFi operations return unsigned transactions for user signing

## 📊 Tech Stack

| Component | Technology |
|-----------|------------|
| AI Runtime | LangChain, OpenAI SDK |
| Backend | Hono, Fastify, Viem |
| Frontend | React, TypeScript, Tailwind CSS, Radix UI |
| Blockchain | Uniswap V4, Anchor (Solana) |
| Memory | Redis, Letta (optional) |
| Database | PostgreSQL with Drizzle ORM |
| Runtime | Bun, Node.js |

## 🧪 Use Cases

1. **DeFi Assistant** – AI agent that helps users swap tokens, provide liquidity, and track positions
2. **Trading Bot** – Automated agent executing strategies based on market conditions
3. **Customer Support** – AI agent handling DeFi protocol inquiries with knowledge base access
4. **Portfolio Manager** – Intelligent agent monitoring and rebalancing user portfolios
5. **Research Assistant** – RAG-powered agent analyzing DeFi protocols and market data

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

MIT

---

*Built with ❤️ for the future of AI-powered DeFi*
