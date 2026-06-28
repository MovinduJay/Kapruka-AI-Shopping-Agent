# Deployment

This project is a Next.js server app with Prisma/Postgres, so deploy it to a Node-compatible Next.js host. The included GitHub Actions setup is Vercel-ready.

## GitHub Actions

Two workflows are included:

- `.github/workflows/ci.yml`
  Runs on pull requests and pushes to `main` or `master`.
  It installs dependencies, generates Prisma Client, lints, type-checks, and builds.
whats the commit
- `.github/workflows/deploy-vercel.yml`
  Runs after CI succeeds on `main` or `master`, and can also be triggered manually.
  It applies Prisma migrations when `DATABASE_URL` is present, builds with Vercel, and deploys the prebuilt production artifact.

## Required GitHub Secrets

Add these in GitHub under `Settings -> Secrets and variables -> Actions`:

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
DATABASE_URL
```

`DATABASE_URL` is used by `prisma migrate deploy`. It should point to the production Postgres database.

## Required Vercel Environment Variables

Set these in the Vercel project for Production, Preview, and Development as needed:

```text
DATABASE_URL
GROQ_API_KEY
GROQ_MODEL
GROQ_CHAT_MODEL
GOOGLE_GENERATIVE_AI_API_KEY
GEMINI_MODEL
KAPRUKA_MCP_URL
LLM_PROVIDER
```

Use `.env.example` as the source of truth for names and defaults.

## Local Release Checks

Run these before merging deployment changes:

```bash
npm ci
npm run prisma:generate
npm run lint
npm run typecheck
npm run build
```

On Windows, `prisma generate` can fail if a running dev server or editor extension is locking `node_modules/.prisma/client/query_engine-windows.dll.node`. Stop running Node processes and retry.

## Database Migrations

For production, migrations should be applied with:

```bash
npm run prisma:deploy
```

The deploy workflow runs this automatically when the `DATABASE_URL` secret exists.
