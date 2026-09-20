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
client/   Frontend - not started yet (framework choice is a Phase 4 decision, not made yet)
```

## Status

**Backend: Phases 1-4's server-side work complete** through the Kanban
board's `move` endpoint — auth, projects, issues (create/edit/close/
reopen/paginate), comments (with threading, Markdown sanitization, and
`@mentions`), labels, and the board itself (fractional-indexed ranking,
atomic status+position moves with optimistic concurrency) all work end
to end, verified by 139 automated tests. **No frontend exists yet** —
Phase 4's remaining days (drag-and-drop wiring, optimistic-update
rollback, keyboard-accessible move) need an actual client application
first, which is a real foundational decision (framework, build tooling,
DnD library) rather than more of the same backend work. Next: pick that
stack and start `client/`.

See `server/README.md` for how to run the API locally, and
[`DECISIONS.md`](./DECISIONS.md) for the technical decisions made so far
and why.
