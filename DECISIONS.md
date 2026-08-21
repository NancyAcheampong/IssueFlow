# IssueFlow — Technical Decision Record

Tracks real decisions made during the build, why, and what alternative
was rejected. Updated at the end of each phase. IDs match the "Decisions
to record before implementation" table in the product spec (§16.1) where
applicable; a few extra decisions not in that table are numbered locally.

## D-01 — Database engine and query layer

**Decision:** PostgreSQL, via Prisma as the query/migration layer for
domain data. A separate, lightweight `pg` connection pool exists only
for the liveness/readiness health check (`src/lib/db.ts`) — deliberately
not routed through Prisma, since a trivial `SELECT 1` doesn't need the
heavier client.

**Why:** the spec's own reasoning (§5.3) applies directly — project
membership, issue assignment, labels, comments, and board placement are
strongly relational, and Postgres's constraints/transactions do real work
enforcing that (see D-05 below for a concrete example). Prisma over raw
SQL/Knex: strong TypeScript types generated from the schema, migrations
built in, and the schema file itself is a readable source of truth for
the data model — worth the added abstraction layer for a learning
project where understanding the model matters as much as querying it.

**Rejected:** MongoDB (spec allows it, but the relational integrity work
it would require reinventing isn't worth it for this domain); raw `pg`
everywhere (more transparent, but significantly more boilerplate and
manual type-safety work for no real benefit once the schema stabilized).

## D-02 (partial) — JWT delivery, storage, and session/logout model

**Decision:** Access token only, no refresh token. Delivered as `token`
in the login response body, not a cookie. Client is expected to store it
and send it back as `Authorization: Bearer <token>`. **Logout has no
server-side endpoint or state** — the API is stateless with respect to
sessions, so "logging out" is entirely a client-side action (discard the
stored token). AUTH-06 ("logout removes the client session") is
satisfied by the client, not the server, once a frontend exists.

**Why:** the spec's guiding principle is keeping the API usable by a
future mobile client, not just a browser. A bearer token in a header
works identically for both; a cookie carries browser-specific baggage
(SameSite, CSRF considerations) that a mobile client doesn't need and
would have to route around. No refresh token yet because nothing in
Phase 1 needs a session longer than `JWT_EXPIRES_IN` (default `1d`) —
adding refresh-token rotation before there's a real need for it would be
solving a problem that doesn't exist yet.

**Rejected:** httpOnly cookie session (simpler CSRF story for a
browser-only app, but fights a future mobile client); refresh tokens now
(more resilient long-lived sessions, but real added complexity —
rotation, revocation, storage — deferred until Phase 1's simpler model
actually proves insufficient).

**Still open:** D-06 (403 vs. 404 for inaccessible project resources) —
not yet relevant, no project-scoped routes exist until Phase 2.

## D-08 (local) — bcrypt cost factor

**Decision:** Cost factor 12 (`src/modules/auth/auth.service.ts`).

**Why:** bcrypt's own historical default is 10; 12 is a stronger, still
fast-enough-per-request modern baseline — slower to brute-force offline,
negligible added latency for one real signup/login request.

## D-09 (local) — duplicate-email detection strategy

**Decision:** Attempt the insert and translate Postgres's own unique
constraint violation (Prisma error code `P2002`) into the API's error
shape, rather than checking "does this email exist?" first and then
inserting.

**Why:** a check-then-insert has a race condition — two signups for the
same email can both pass the check before either one inserts. Letting
the database's own constraint be the actual source of truth for
uniqueness closes that gap entirely, for free.

## D-10 (local) — AUTH-07 scope this phase

**Decision:** The "generic error message" half of AUTH-07 is implemented
(wrong password and unknown email are byte-for-byte identical
responses, and tested directly to confirm they are). The rate-limiting
half is explicitly **deferred to Phase 7 hardening**, not silently
dropped — AUTH-07 is P1 ("should"), and rate limiting is an
infrastructure/hardening concern better done alongside the rest of
Phase 7's security pass than bolted onto Phase 1 in isolation.

---

_Last updated: end of Phase 1 (Aug 21, 2026)._
