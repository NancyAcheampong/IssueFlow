# IssueFlow API

Node.js + Express + TypeScript REST API and WebSocket gateway for IssueFlow,
backed by PostgreSQL. Domain data (users, projects, issues, ...) goes
through Prisma; a separate lightweight `pg` pool exists only for the
liveness/readiness check (see "Database migrations" below).

## Architecture at a glance

```
src/
  config/     Environment loading & validation (fails fast on bad config)
  lib/        Shared singletons: Prisma client, Postgres pool (pg,
              readiness check only), logger, AppError
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
- **`prisma migrate dev` fails with `P3014` / "permission denied to
  create database".** The local Postgres role needs `CREATEDB` to
  create its temporary shadow database — see "Database migrations"
  below for the one-time fix.
- **`PrismaClientInitializationError: Can't reach database server at
  localhost:5432`.** Different from every error above — this one
  means the Prisma Client itself is fine, it's Postgres that isn't
  running. Start it (`docker compose -f ../docker-compose.yml up -d`,
  or `pg_lsclusters` / `sudo service postgresql start` if using a
  local install instead of Docker) and re-run.
- **`Cannot find module '.prisma/client'` / prisma-related errors
  right after cloning or pulling.** The generated Prisma Client lives
  in `node_modules`, which is gitignored — it never comes from git,
  only from running `npm install` (a `postinstall` script regenerates
  it automatically). If it's ever out of sync for some reason, force
  it manually: `npm run prisma:generate`.

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
  fallback), since nothing yet throws these through a real route
- `tests/user.test.ts` — integration test against a real database (see
  "Test database" below): creates/reads a `User` and proves the unique
  email constraint from the migration is actually enforced

## Database migrations

Schema lives in `prisma/schema.prisma`. Every change to it goes through a
migration — never edit tables by hand — so the schema is reproducible on
any machine (NFR-08).

```bash
npm run prisma:migrate   # create + apply a migration locally, from a schema change
npm run prisma:deploy    # apply existing migrations without generating a new one (used in production)
npm run prisma:studio    # browse the database with a GUI
```

`prisma:migrate` needs the local Postgres role to have `CREATEDB`
privilege (it creates a temporary "shadow" database to compute the
diff) — a one-time local setup step:

```sql
ALTER ROLE issueflow CREATEDB;
```

### Test database

Tests that touch Prisma (e.g. `tests/user.test.ts`) run against a
**separate** database, `issueflow_test`, kept isolated from your `issueflow`
dev data (`tests/setup.ts` points `DATABASE_URL` there by default). Create
it once and apply the same migrations:

```bash
psql -U issueflow -h localhost -c "CREATE DATABASE issueflow_test OWNER issueflow;"
DATABASE_URL="postgresql://issueflow:issueflow@localhost:5432/issueflow_test?schema=public" npm run prisma:deploy
```

Re-run that `prisma:deploy` line any time a new migration is added.

## Linting & formatting

```bash
npm run lint
npm run format
```
