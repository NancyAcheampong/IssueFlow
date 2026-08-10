# IssueFlow API

Node.js + Express + TypeScript REST API and WebSocket gateway for IssueFlow,
backed by PostgreSQL via Prisma.

## Architecture at a glance

```
src/
  config/     Environment loading & validation (fails fast on bad config)
  lib/        Shared singletons: Prisma client, logger, AppError
  middleware/ Cross-cutting Express middleware (error handling, later: auth)
  modules/    One folder per feature area (health, and later: auth, projects,
              issues, comments, labels, board, search), each owning its own
              routes/controller/service files as we build them
  app.ts      Express app assembly (middleware stack + route mounting) —
              exported as a factory so tests can build a fresh app per test
  index.ts    Process entry point: starts the HTTP server, handles graceful
              shutdown
```

Error responses always use one envelope shape (spec API-03):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "email": "..." } } }
```

## Local setup

Requires Node.js 20+ and Docker (for local Postgres).

```bash
# 1. Start a local Postgres instance
docker compose -f ../docker-compose.yml up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# edit .env if you changed any defaults

# 4. Run the dev server (auto-restarts on change)
npm run dev
```

Verify it's working:

```bash
curl http://localhost:4000/health          # liveness — process is up
curl http://localhost:4000/api/v1/status   # readiness — process AND database are up
```

## Environment variables

See `.env.example` for the full list with comments. Summary:

| Variable | Purpose |
|---|---|
| `PORT` | Port the HTTP server listens on |
| `DATABASE_URL` | Postgres connection string (Prisma format) |
| `JWT_SECRET` | Signing secret for auth tokens (Phase 1) |
| `JWT_EXPIRES_IN` | Access token lifetime |
| `ALLOWED_ORIGIN` | Comma-separated list of frontend origins allowed by CORS |
| `LOG_LEVEL` | pino log level |

## Tests

```bash
npm test          # run once
npm run test:watch
```

## Database migrations

`prisma/schema.prisma` currently has no models — Phase 0 only proves the
server can reach Postgres (see `/api/v1/status` above), using `pg` directly.
Once real models exist starting Phase 1:

```bash
npm run prisma:migrate   # create + apply a migration locally
npm run prisma:deploy    # apply existing migrations (used in production)
npm run prisma:studio    # browse the database with a GUI
```

## Linting & formatting

```bash
npm run lint
npm run format
```
