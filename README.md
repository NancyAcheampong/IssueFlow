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

**Phase 5 (real-time layer) complete.** Everything through Phase 4
(auth, projects, issues, comments, labels, Kanban board with drag-and-
drop and a keyboard-accessible move control) now updates live: a
Socket.IO connection (authenticated with the same JWT as the REST API)
joins each open project's room, and any write there — a new issue, a
moved card, a new comment, a label change — broadcasts a plain
invalidation signal that every other connected client reacts to by
refetching (D-24/D-25), including on reconnect. Verified by 146 backend
tests (7 of them a real two-way Socket.IO integration test, not
mocked), 17 frontend tests, and a two-separate-browser-context live
session confirming one account's change appeared on a different
account's open board with zero manual refreshes — the literal wording
of the Phase 5 exit gate.

Phase 6 (search & filters) is next, per the original roadmap.

See `server/README.md` and `client/README.md` for how to run each
piece locally, and [`DECISIONS.md`](./DECISIONS.md) for the technical
decisions made so far and why.
