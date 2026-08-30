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

## D-06 — 403 vs. 404 for inaccessible project resources

**Decision:** a requester with **no membership at all** in a project
gets `404 Not Found` — identical whether the project genuinely doesn't
exist or exists but isn't theirs. A requester who **is a member** but
lacks the role for a specific action (e.g. a non-owner trying to add a
member) gets `403 Forbidden`.

**Why:** a non-member shouldn't be able to distinguish "that project ID
was never real" from "that project is real but not yours" — either
answer would leak information about which project IDs exist to someone
with zero relationship to them. Once someone *is* a legitimate member,
though, that concealment reasoning no longer applies — they already
know the project exists, so a plain "you can't do that" (403) is more
honest and more useful than pretending otherwise. First applied in
`getProjectMembership`/`requireOwnerRole` (`src/modules/projects/projects.service.ts`);
this same split is the policy for every project-scoped route going
forward, not just membership.

**Rejected:** 403 for both cases (simpler, but leaks existence to
outsiders); 404 for both cases (hides existence uniformly, but then a
legitimate member gets a confusing "not found" for an action they
should understand as "not allowed").

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

## D-11 (local) — ProjectMembership as a composite-key join table

**Decision:** `ProjectMembership` has no independent `id` column — the
primary key is `(projectId, userId)` directly (`@@id`), not a separate
id plus a unique index on the same two columns.

**Why:** it's a pure join table connecting a user to a project; the pair
*is* its identity, and nothing in the domain ever needs to reference "this
membership row" independently of "this user's membership in this
project." A composite key also makes the uniqueness guarantee stronger
than a unique index would — it's structurally impossible to have two
rows for the same pair, not just prevented by a checked constraint.
Matches the spec's own field list for this entity too (no `id` listed).

**Related, worth remembering:** `Project.ownerId` and a
`ProjectMembership` row with `role: owner` record the same fact in two
places on purpose (PRJ-01 requires the creator to become both owner
*and* first member; `ownerId` exists for fast "who owns this" lookups
without joining/filtering memberships). Nothing at the schema level
keeps these in sync — the project-creation code path is responsible for
writing both atomically. If that ever needs debugging, this is the
first thing to check.

## D-12 (local) — Issue numbering, board rank type, and assignee deletion

**Decision (numbering):** `Project.nextIssueNumber` is a per-project
counter column. `Issue.number` (unique per `projectId`, per ISS-06) gets
its value from an atomic `UPDATE ... SET next_issue_number =
next_issue_number + 1` read back in the same statement — not a global
auto-increment, and not a `SELECT MAX(number)` followed by a separate
insert (that has an obvious race: two concurrent creates can both read
the same max before either commits).

**Why:** the spec explicitly wants GitHub-style per-project numbers
(`#1`, `#2`, ...), which a single global sequence can't produce, and a
naive read-then-insert isn't safe under concurrent issue creation. The
actual increment call is Phase 2's create-issue work — today only adds
the column the counter needs to live in.

**Decision (board rank type):** `BoardPlacement.rank` is a `String`, not
an `Int`.

**Why:** D-03 (the actual ranking *algorithm* — fractional/lexicographic
vs. transactional integer reorder) is explicitly deferred to Phase 4
(Day 33). A string column works for either approach without needing a
future migration to change it; committing to `Int` now would have
quietly pre-decided D-03 by accident.

**Noted, not decided by us:** Prisma chose `ON DELETE SET NULL` for
`Issue.assigneeId` automatically (the default for an optional foreign
key) — verified in the generated migration, not something we wrote
explicitly. It's the right behavior (a deleted user's assignments clear
rather than blocking their deletion), just worth recording that it's
Prisma's default, not a deliberate choice made in the schema file.

---

_Last updated: Phase 2, Aug 28 (Issue + BoardPlacement schema)._
