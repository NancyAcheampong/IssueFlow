# IssueFlow

Issue discussion & task-assignment platform — a self-contained team workspace
that joins GitHub-Issues-style discussion with a Kanban board, built end to
end (database, API, real-time layer, frontend) as a learning project.

Full requirements live in the product specification (kanban board, real-time
collaboration, auth, search/filters, etc.) — this repo implements it phase by
phase, per the roadmap in that spec.

## Layout

```
server/   Node.js + Express + TypeScript REST API and WebSocket gateway, PostgreSQL via Prisma
client/   React + Vite frontend (added starting Phase 2)
```

## Status

**Phase 1 (Auth & Users) complete** — signup, login, JWT middleware, and a
protected `GET /api/v1/me` all work end to end, verified live and by
automated test. Next: Phase 2 (Projects & Issues).

See `server/README.md` for how to run the API locally, and
[`DECISIONS.md`](./DECISIONS.md) for the technical decisions made so far
and why.
