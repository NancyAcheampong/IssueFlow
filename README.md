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
client/   React + Vite + TypeScript frontend (D-21)
```

## Status

**Phase 4 (Kanban board) complete, backend and frontend.** The whole
pipeline works end to end: sign up, log in, create a project, create
issues, see them on a real Kanban board, and move them between columns
either by dragging a card or via an explicit keyboard-accessible "Move
to" control (D-22) — both paths share one move operation with
optimistic updates and rollback on failure (D-23), backed by the
server's fractional-indexed ranking and atomic status+position moves
(D-19/D-20). Verified by 139 backend tests, 14 frontend tests, and a
full live browser session (signup through drag-and-drop, the keyboard
control, and a forced-failure rollback) against a running server.

Phase 5 (real-time layer) is next, per the original roadmap.

See `server/README.md` and `client/README.md` for how to run each
piece locally, and [`DECISIONS.md`](./DECISIONS.md) for the technical
decisions made so far and why.
