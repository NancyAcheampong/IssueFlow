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
              readiness check only), logger, AppError, asyncHandler, jwt
  middleware/ Cross-cutting Express middleware: error handling,
              requireAuth (protects a route with a Bearer JWT)
  modules/    One folder per feature area (health, auth, users, and
              later: projects, issues, comments, labels, board, search),
              each owning its own routes/service/schema files
  types/      Ambient TypeScript declarations (Express Request
              augmentation for req.userId)
  app.ts      Express app assembly (middleware stack + route mounting) —
              exported as a factory so tests can build a fresh app per test
  index.ts    Process entry point: starts the HTTP server, handles graceful
              shutdown
```

Error responses always use one envelope shape (spec API-03):

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "email": "..." } } }
```

## API routes implemented so far

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/health` | Public | Liveness only, no dependencies checked |
| GET | `/api/v1/status` | Public | Readiness — also checks the database |
| POST | `/api/v1/auth/signup` | Public | AUTH-01. Does **not** issue a JWT — signup and login are deliberately separate steps; call login next. |
| POST | `/api/v1/auth/login` | Public | AUTH-02. Verifies credentials, returns `{ user, token }`. Wrong password and unknown email return the identical error (AUTH-07 — no account enumeration). |
| GET | `/api/v1/me` | **Authenticated** | AUTH-04. First protected route — requires `Authorization: Bearer <token>`, via `requireAuth` middleware. |
| POST | `/api/v1/projects` | **Authenticated** | PRJ-01. Creator becomes owner + first member (two rows written atomically — see DECISIONS.md D-11). |
| GET | `/api/v1/projects` | **Authenticated** | PRJ-02. Only projects the requester belongs to. |
| POST | `/api/v1/projects/:projectId/members` | **Owner only** | PRJ-03. Non-member → 404; member-but-not-owner → 403 (see DECISIONS.md D-06). |
| DELETE | `/api/v1/projects/:projectId/members/:userId` | **Owner only** | PRJ-04. Owner can't remove themselves (400); removing a non-member is 404. |
| PATCH | `/api/v1/projects/:projectId` | **Owner only** | PRJ-05. Partial update of name/description; empty string clears description; empty patch is rejected. |
| POST | `/api/v1/projects/:projectId/issues` | **Member** | ISS-01. Any project member (not owner-only). Creates the `Issue` + its `BoardPlacement` together; assignee must be a current project member (ASN-02). |

Full reference contract lives in the product spec, §8.

## Local setup

Requires Node.js 20+ and Docker (for local Postgres).

```bash
# 1. Start a local Postgres instance
docker compose -f ../docker-compose.yml up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# edit .env if you changed any defaults, and set a real JWT_SECRET

# 4. Set up both local databases (dev + test), safe to re-run any time
npm run setup:db

# 5. Run the dev server (auto-restarts on change)
npm run dev
```

`setup:db` runs `scripts/setup-local-db.sh` — creates the `issueflow` and
`issueflow_test` databases if they don't exist, fixes schema permissions
(a real Postgres 15+ gotcha - see Troubleshooting), applies migrations to
both, and fails fast with a clear message on the exact step that broke,
instead of a confusing error three commands later. Idempotent: run it
again any time something seems off with your local database and it'll
just confirm what's already correct.

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
- **A database that worked a minute ago now says "does not exist,"
  or a permission error you already fixed comes back.** If you have
  more than one thing capable of running Postgres (Homebrew's
  `postgresql` service, Postgres.app, Docker/`docker-compose.yml` all
  bind the same default port), whichever one happens to be running
  "wins" the connection at `localhost:5432` — silently, with no
  indication anything switched. Two databases with the same name on
  two different servers is a real trap. `npm run setup:db` recovers
  from this by re-checking/re-creating everything idempotently, but
  if it keeps recurring, figure out which single Postgres you actually
  want and stop the others.

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
- `tests/auth.test.ts` — full signup and login flow through the real HTTP
  app: password is actually bcrypt-hashed (and verifies against the
  original), never returned in any response, email gets normalized,
  duplicate signups are rejected with 409, a real JWT comes back on login
  and decodes to the right user, and wrong-password vs. unknown-email
  produce the exact same error (no account enumeration)
- `tests/requireAuth.test.ts` — unit tests for the auth middleware
  directly: no header, wrong scheme, garbage token, expired token, and a
  token signed with the wrong secret are all rejected; a valid token
  attaches `req.userId` and lets the request through
- `tests/me.test.ts` — `GET /api/v1/me` through the real HTTP app with a
  genuine signup+login token: returns the right user with no
  `passwordHash`, rejects a missing token and an invalid one
- `tests/project.test.ts` — Prisma-level: creates a project + owner
  membership together, proves the composite key rejects a duplicate
  membership, proves deleting a project cascades to its memberships
- `tests/issue.test.ts` — Prisma-level: creates an issue + board
  placement together via the same atomic counter increment the real
  create-issue endpoint will use, proves the project+number unique
  constraint rejects a duplicate, and proves both cascades (issue →
  its placement, project → its issues)
- `tests/issues.test.ts` — `POST /api/v1/projects/:projectId/issues`
  through the real HTTP app: any member (not just the owner) can create
  one; per-project numbers actually increment sequentially (1, 2, ...);
  an explicit status and a valid assignee are both accepted; an
  assignee who isn't a current project member is rejected (ASN-02); a
  missing title fails validation; and the same D-06 split as every
  other project-scoped route (no membership at all → 404)
- `tests/projects.test.ts` — the whole projects surface through the real
  HTTP app, with genuinely separate user accounts throughout: create
  confirms a real `ProjectMembership` row (not just the response shape);
  list proves one user's projects never include another's (PRJ-02); add
  member proves the full authorization matrix live - owner succeeds,
  the same pair twice is a 409, an unknown email is a 404, an outsider
  with zero membership gets 404, and a real member who isn't the owner
  gets 403 (D-06's two-way split, each branch actually exercised);
  remove member covers self-removal being blocked, the same D-06 split,
  a successful removal actually confirmed gone from the database, and
  removing an already-former member being a 404 not a silent success;
  update project covers a partial patch leaving the untouched field
  alone, an empty string genuinely clearing the description, an
  entirely empty patch being rejected, and the same owner-only check

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
dev data (`tests/setup.ts` points `DATABASE_URL` there by default).

`npm run setup:db` (see "Local setup" above) creates and migrates this
alongside the dev database in one step — that's the normal path. Re-run
it any time a new migration is added, or any time something about your
local database setup seems off; it's idempotent and will just confirm
whatever's already correct.

**Using a hosted database instead (e.g. Neon)** — if you'd rather not deal
with local Postgres at all (multiple Postgres installs fighting over port
5432 is a real, common failure mode - see Troubleshooting), copy
`.env.test.example` to `.env.test` and set `DATABASE_URL` there to a
*separate* database/branch on your hosted provider. `tests/setup.ts`
loads it automatically if present, and falls back to the local default
above if not — nothing else changes. Two things specific to Neon:
connection strings need `?sslmode=require`, and migrations
(`prisma:deploy`/`prisma:migrate`) should run against Neon's **direct**
(non-pooled) connection string, not the pooled one — Prisma's migration
engine doesn't work reliably through a connection pooler.

## Linting & formatting

```bash
npm run lint
npm run format
```
