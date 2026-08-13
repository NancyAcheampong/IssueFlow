# IssueFlow API

Node.js + Express + TypeScript REST API and WebSocket gateway for IssueFlow,
backed by PostgreSQL. Phase 0 talks to Postgres directly through `pg`;
Prisma takes over as the query layer once real tables exist, starting
Phase 1 (see "Database migrations" below).

## Architecture at a glance

```
src/
  config/     Environment loading & validation (fails fast on bad config)
  lib/        Shared singletons: Postgres pool (pg), logger, AppError
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

## Troubleshooting

A few real gotchas hit during development, worth knowing before you hit them too:

- **`Invalid environment configuration` on startup.** `.env` is
  `.gitignore`d on purpose (it holds secrets) — a fresh clone, or a
  `git reset --hard`, never brings it back. Redo step 3 above
  (`cp .env.example .env`, then set a real `JWT_SECRET`).
- **Editor shows a TypeScript error that the terminal doesn't.** VS
  Code's TS server caches diagnostics and doesn't always notice
  `npm install` finishing or files changing on disk. Try
  `Cmd/Ctrl+Shift+P` → "Developer: Reload Window" first. If errors
  about a *specific package* ("Cannot find module 'x'") persist after
  that, confirm dependencies are actually installed — see the next point.
- **`npx tsc` offers to install a package called `tsc@x.x.x`.** That's
  not the real TypeScript compiler — it means npm can't find
  `typescript` installed locally, almost always because `npm install`
  was run from the repo root instead of from inside `server/`. Cancel
  it, `cd server`, confirm `node_modules/` actually exists here
  (`ls`), and re-run `npm install` if it doesn't.
- **A dependency install command run from the wrong folder.** Always
  run `npm install`/`npm install <pkg>` from *inside* `server/`, never
  from the repo root — there's no Node project at the root, and
  running it there creates a stray, unwanted `package.json` there
  instead.

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

Current coverage:
- `tests/health.test.ts` — liveness endpoint, and the 404 error envelope
- `tests/errorHandler.test.ts` — unit tests for `errorHandler`/`notFoundHandler`
  directly (AppError formatting, ZodError formatting, the generic 500
  fallback), since nothing in Phase 0 throws these through a real route yet

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
