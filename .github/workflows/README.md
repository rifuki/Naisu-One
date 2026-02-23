# CI/CD Setup (Monorepo Path-Based Deploy)

This repo uses per-folder deployment workflows triggered on push to `main`.

## Workflows

- `deploy-naisu1-fe.yml` → deploys `naisu1-fe` to Vercel when `naisu1-fe/**` changes
- `deploy-agent-hub.yml` → deploys `agent-hub` to Vercel when `agent-hub/**` changes
- `deploy-agent-infra.yml` → deploys `agent-infra-langchain-ts` to VPS when `agent-infra-langchain-ts/**` changes
- `deploy-naisu-backend.yml` → deploys `naisu-backend` to VPS when `naisu-backend/**` changes

## Required GitHub Secrets

### Shared VPS
- `VPS_HOST`
- `VPS_USER`
- `VPS_SSH_KEY` (private key)
- `VPS_PORT` (usually `22`)
- `VPS_REPO_PATH` (absolute path to repo on VPS, e.g. `/opt/Naisu-One`)

### Agent Infra VPS
- `AGENT_INFRA_SERVICE_NAME` (optional, default: `naisu-agent-infra.service`)

### Backend VPS
- `NAISU_BACKEND_SERVICE_NAME` (optional, default: `naisu-backend.service`)
- `NAISU_BACKEND_HEALTHCHECK_URL` (optional, e.g. `http://127.0.0.1:3000/health`)

### Vercel (both FE projects)
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID_NAISU_FE`
- `VERCEL_PROJECT_ID_AGENT_HUB`

## How to get Vercel IDs

Inside each frontend folder (`naisu1-fe`, `agent-hub`) after linking with `vercel` CLI:

- `.vercel/project.json` contains:
  - `orgId` → use as `VERCEL_ORG_ID`
  - `projectId` → use as corresponding `VERCEL_PROJECT_ID_*`

## Recommended branch protection

- Protect `main`
- Require PR + required checks before merge
- Disallow force push on `main`
