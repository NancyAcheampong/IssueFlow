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

Currently in **Phase 0 — Foundation**. See `server/README.md` for how to run
the API locally.
