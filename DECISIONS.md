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

**Resolved:** see D-27 — the Oct 6 security review implemented this.

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

## D-13 (local) — Edit-issue scope: no status, no labels

**Decision:** `PATCH /api/v1/issues/:issueId` (ISS-04) only ever touches
`title`, `description`, and `assigneeId`. It's deliberately *not* a
general-purpose "patch anything" endpoint — `status` is not accepted
here even though it's a column on the same row.

**Why:** status transitions (close/reopen) are their own scheduled unit
of work with their own semantics to get right (e.g. does reopening reset
anything, does the transition need its own audit trail later) — folding
them into a generic field-patch would either under-specify that work or
force it to happen accidentally, today, as a side effect of building
something else. Labels aren't excluded by choice so much as by
existence — the `Label` model doesn't land until Phase 3, so there's
nothing to attach here yet.

**Convention:** extends the same "undefined leaves a field alone"
pattern already established by `updateProjectSchema`/`updateProject`
(PRJ-05) to a nullable field: for `assigneeId`, `undefined` leaves the current
assignee alone, an explicit `null` unassigns, and a string reassigns
(re-validated against project membership, same ASN-02 rule as at
creation). `description` keeps the existing convention exactly —
`undefined` leaves it alone, explicit `""` clears it.

---

## D-14 (local) — Close/reopen model: DONE is "closed," no separate flag

**Decision:** "Closed" is not a separate boolean or timestamp column.
Closing an issue sets `status = DONE`; reopening sets `status =
BACKLOG` (always BACKLOG, not whatever status the issue held before
closing). Both are dedicated actions — `POST /:issueId/close` and
`POST /:issueId/reopen` — not a value accepted by the generic
`PATCH /:issueId` (D-13). Both are idempotent: closing an
already-closed issue or reopening an already-open one is a 200 no-op.

**Why:** the domain model already has a single 4-value `status` column
doing double duty as both "which board column" and "is this done" —
introducing a second, independent closed/open flag would let the two
disagree (an issue marked closed but sitting in the `IN_PROGRESS`
column) with nothing in the schema to keep them in sync. Treating
`DONE` as the one and only closed state avoids that split-brain outright.
Reopening always to `BACKLOG` rather than "whatever it was before" is
the honest choice given there's no history table recording prior
status — inventing a fake memory of the last status would be more
surprising than resetting to "needs triage," which is what reopened
work actually needs. Dedicated actions instead of a generic status
field keep this the *only* way to change status until board move
(Phase 4, Day 39-ish) arrives with its own — different — semantics
(status changes as a side effect of a drag, bundled with a rank change
in one transaction, not a freestanding edit).

**Rejected:** a separate `closedAt: DateTime?` column, modeled after
GitHub's actual open/closed state (independent of which column a card
sits in). More correct to the real spec inspiration, but the current
Kanban design (Phase 4) treats the board columns *as* the status
machine — there's no design for a card that's simultaneously "in the
Done column" and "still open," or vice versa. Worth revisiting if a
future phase needs that distinction; not invented pre-emptively here.

---

## D-15 (local) — Markdown rendering + sanitization: `marked` + `sanitize-html`

**Decision:** a comment's `bodyMarkdown` (exactly what the author
submitted) is rendered to HTML with `marked`, then passed through
`sanitize-html` with an explicit tag/attribute/URL-scheme allowlist,
and the sanitized result is stored as `bodyHtml` — once, at write time,
not recomputed on every read. The API returns both fields.

**Why:** Markdown intentionally permits raw HTML pass-through — `marked`
alone will turn `<script>alert(1)</script>` embedded in a comment into
exactly that, verbatim. Rendering without sanitizing is not a partial
mitigation, it's no mitigation. `sanitize-html`'s allowlist model (name
every tag/attribute/scheme that's allowed, discard everything else) is
the safer default than a denylist, which only ever blocks the specific
attacks someone thought to list. Computing `bodyHtml` once at creation
(rather than on every GET, or leaving rendering to the client) keeps
the sanitization logic in exactly one place server-side and makes the
stored value directly testable — see the dedicated XSS regression
tests in `tests/comments.test.ts`. Comments aren't editable yet (no
scheduled day for it through Phase 3's exit gate), so a stored
rendering can't go stale; if edit-comment ever lands, `bodyHtml` needs
recomputing on update too, not before.

**Rejected:** `DOMPurify` + `jsdom` — the more common sanitizer pairing
in the Node ecosystem, but it requires a full DOM shim (`jsdom`) just
to run server-side, meaningfully heavier than `sanitize-html`'s
zero-DOM string-based approach for a need this contained. Rejected:
`markdown-it` in place of `marked` — an equally reasonable choice, not
picked for any strong reason beyond `marked` being the more widely
used default; nothing here depends on markdown-it-specific plugins.

## D-16 (local) — Comment threading: flat storage, self-relation `parentId`

**Decision:** `Comment.parentId` is a nullable self-relation, one
column, no separate depth/thread-id bookkeeping. A reply's parent must
be a comment on the *same issue* (enforced in the service layer — a
foreign key alone can't express "and also matches this other row's
issueId"). The list endpoint returns a flat, `createdAt`-ordered array;
building a nested tree from `parentId` is left to the client.

**Why:** arbitrary-depth threading (a reply to a reply to a reply) is
what GitHub-style discussion actually looks like, and a self-relation
supports that for free without a schema change if the product ever
wants deeper threads than expected. Keeping the API response flat
mirrors D-12's reasoning on `BoardPlacement.rank`: tree-building is
presentation logic, not something worth pre-deciding server-side before
there's a real frontend consuming it. Deleting a parent comment
cascades to its replies (`ON DELETE CASCADE` on `parentId`) — an
orphaned reply with no parent to thread under isn't a state worth
keeping, same reasoning as `ProjectMembership`'s cascade.

## D-17 (local) — @mention resolution: email local-part, project-scoped only

**Decision:** `@mention` tokens in a comment body are matched against
the *local part* of a current project member's email address (the
part before `@`), case-insensitively — `@jane.doe` resolves against
`jane.doe@example.com`. Resolution only ever considers members of the
comment's own project. An unmatched token is silently dropped, not an
error. Matches are stored as real rows in `CommentMention`
(`commentId`, `userId`), not just returned transiently — future
notification work (not yet scheduled) has something durable to query.

**Why:** there's no username/handle field anywhere in this schema
(`User` has `email` and `displayName` only) — email local-part is the
closest existing thing to a stable, typically-unique, mention-friendly
handle without inventing and migrating a new column for it. Restricting
resolution to current project members is the same D-06 privacy boundary
applied to a new surface: without it, a comment could be used to probe
whether an arbitrary email belongs to a real account, or to notify
someone with no access to the project at all. Silently dropping
unmatched tokens (rather than 400ing) treats `@whoever` as ordinary text
if it doesn't resolve to anyone real — a typo in a mention shouldn't
block posting the comment.

**Rejected:** adding a dedicated `username` column now, purely to make
mentions nicer. Real scope creep for a Phase 3 day that was never about
redesigning identity — worth reconsidering only if email-local-part
mentions prove genuinely confusing in practice (e.g. two members
sharing a local part across different domains, which the current
per-project matching does *not* de-duplicate or disambiguate).

## D-18 (local) — Labels: member-level, project-scoped uniqueness, 400 on cross-project attach

**Decision:** `Label` is scoped to a project (`@@unique([projectId, name])`
— "bug" in one project is unrelated to "bug" in another). Creating,
listing, and deleting labels is member-level, same as issue creation —
no `requireOwnerRole` gate. Attaching a label to an issue rejects a
`labelId` belonging to a *different* project with a 400 (the same
treatment as an invalid `assigneeId` or a cross-issue `parentId` —
D-13/D-16), not a 404: the label id came from the caller's own request
body, so a mismatch is a bad request about their input, not a question
of whether some resource exists.

**Why:** labels are collaborative classification metadata — exactly
the same category of thing as creating an issue itself, which is
already member-level — not a project-settings change like renaming the
project or adding/removing members (both of which stay owner-only).
Project-scoping the uniqueness constraint (rather than global) matches
how every other project-scoped resource in this schema behaves
(`Issue.number` is unique per project, not globally — D-12) and how
real teams actually use labels — "bug" means something specific to
each team, not one shared taxonomy across every project in the system.

---

## D-19 (local) — Board ranking: fractional/lexicographic keys via `fractional-indexing`

**Decision:** D-03 (deferred since D-12) is resolved: `BoardPlacement.rank`
uses fractional/lexicographic indexing, generated by the
`fractional-indexing` package (the same approach popularized by Figma;
this project uses the well-tested library rather than a hand-rolled
implementation). A new card ranks after the current last card in its
own `(project, status)` column, not after "whatever was created most
recently in the project" — columns rank independently of each other.
The board endpoint (`GET /:projectId/board`) groups issues by status
and sorts each group by comparing `rank` strings directly (`<`/`>`),
never `.localeCompare()` and never a SQL `ORDER BY` — see the code
comment in `board.service.ts` for why a locale-aware or DB-collation
comparison is the wrong tool here.

**Why:** fractional indexing is exactly what `BoardPlacement.rank`'s
`String` type (D-12) was left open for — inserting a card between two
existing ones (Phase 4's actual reordering feature, arriving with move
card next) means generating one new key, never rewriting every other
row's rank the way integer positions would require. Comparing app-side
with plain string comparison, not the database's own collation,
decouples correctness from which Postgres this ever runs against.

**Verified, not assumed:** fractional-indexing's correctness depends on
every comparison being strict code-point/byte order. This project's
Postgres (`postgres:16-alpine`, via `docker-compose.yml`) happens to
default to `C.UTF-8` collation — confirmed live via `psql`, not
guessed — which is byte-order and would make even a SQL `ORDER BY` on
this column safe too. Doing the comparison in JS instead of relying on
that (see above) means this doesn't quietly break if the database ever
changes.

---

## D-20 (local) — Move card: neighbor-relative positioning, one transaction, optimistic concurrency

**Decision:** `PATCH /api/v1/issues/:issueId/move` takes `{ status?,
prevIssueId?, nextIssueId?, version }`. Position is expressed
relative to neighboring cards ("this card now sits between
`prevIssueId` and `nextIssueId`"), not as a raw rank string the client
would have to know how to generate itself. `status` and the
`BoardPlacement` update (new `rank`, `version` incremented) happen
inside one Prisma interactive transaction. `version` is required and
checked with a conditional `updateMany` (`where: { issueId, version }`)
— a zero-row result means the placement moved since the client last
saw it, and the whole transaction (status change included) rolls back
with a 409, never a partial write.

**Why:** neighbor-relative positioning matches exactly what a
drag-and-drop UI already knows at the moment of a drop ("dropped
between card X and card Y") — asking the client to compute a
fractional-indexing key itself would leak an implementation detail
across the API boundary for no benefit. Bundling status + rank in one
transaction is literally the day's stated scope ("status + rank, one
transaction") and matters concretely: without it, a request that both
changes status and loses the concurrency race could leave an issue
showing a new status while still occupying its old board position (or
vice versa) — a card that's lying about which column it's actually in.
Optimistic concurrency (rather than locking) fits a UI-driven action
like dragging a card: conflicts are rare (two people moving the exact
same card at the exact same moment), so paying for a lock on every move
isn't worth it — better to detect the rare conflict after the fact and
let the client (Phase 4's frontend days, Sep 17-19) re-fetch and retry.

**Rejected:** array-index positioning (`position: 3`) instead of
neighbor ids. Simpler on paper, but it re-introduces exactly the
"reindex every row on insert" problem fractional indexing (D-19) was
adopted to avoid, and it's a worse fit for a concurrent multi-user
board where "index 3" can mean a different card by the time the
request arrives.

---

## D-21 (local) — Frontend stack: React + Vite + TypeScript, no meta-framework

**Decision:** `client/` is React 19 + Vite + TypeScript, scaffolded via
Vite's own `react-ts` template, with `react-router-dom` for routing,
`@dnd-kit/core`/`@dnd-kit/sortable` for drag-and-drop, and Vitest +
`@testing-library/react` for tests (same test runner as the server, a
separate `vite.config.ts`/`vitest.config.ts` split to dodge a real
`vite`-vs-`vitest/config` type-duplication issue - see the comment in
`vitest.config.ts`).

**Why:** this is a single authenticated app behind a REST API, not a
site needing SSR/SEO - a meta-framework (Next.js, Remix) would add
routing/data-fetching conventions this project doesn't need and a
deployment model more complex than "static files + an API." TypeScript
matches the backend, keeping one language across the stack. `@dnd-kit`
over `react-beautiful-dnd` (unmaintained) or native HTML5 drag-and-drop
(weak touch support, no real accessibility story) - dnd-kit ships a
keyboard sensor as a first-class citizen, which D-22 depends on
directly.

**Rejected:** picking this by committee/survey. The user explicitly
deferred the choice ("you choose, go build it") rather than being
asked to weigh in on framework minutiae - the stack is still recorded
here, with reasoning, exactly as any other architectural decision in
this document would be, so it's inspectable and revisitable even
though no back-and-forth happened before it was made.

## D-22 (local) — Board move: two independent trigger paths, one shared operation

**Decision:** a card can be moved two ways - dragging it (pointer, via
`@dnd-kit`'s `PointerSensor`) or an explicit "Move to" `<select>` on
every card (a plain native form control). Both call the exact same
`moveCard` function (`useBoard.ts`), which itself calls the exact same
`computeMove`/`resolveDropTarget` pure logic (`boardLogic.ts`) and the
exact same `PATCH .../move` endpoint (D-20). `@dnd-kit`'s own
`KeyboardSensor` is also wired up (arrow-key reordering within a
column), but the `<select>` is the primary accessible path for moving
*between* columns - dnd-kit's keyboard sensor across multiple
containers is a meaningfully harder gesture to discover and operate
than choosing an option from a dropdown.

**Why:** ISS-19/Sep 19's "keyboard-accessible move action" needed to be
a *real*, independently-operable path - not a hope that dnd-kit's
keyboard sensor alone would be sufficient for cross-column moves, which
it technically supports but isn't a comparably easy gesture to a mouse
drag. A plain `<select>` is unambiguous: any screen reader, any input
device, zero gesture choreography. Routing both paths through the one
`moveCard` function (rather than two separate move implementations)
means there's exactly one place optimistic update + rollback (D-23,
directly below) and version/concurrency handling
live - no risk of the two paths drifting apart in behavior.

**Verified live**, not just via the committed unit tests: a full
browser session (Playwright, one-off, not committed - see
`client/README.md`) drove signup through project/issue creation, a
real pointer drag moving a card between columns, the `<select>`
moving a different card, and confirmed both moves survived a full
page reload (proving they round-tripped through the real API, not
just local state).

## D-23 (local) — Optimistic move with snapshot-based rollback

**Decision:** `useBoard`'s `moveCard` applies a move to local state
immediately (optimistic), then calls the API. On success, the
server's authoritative response (crucially, its new
`BoardPlacement.version`) replaces the optimistic guess. On failure
(network error, or the 409 from D-20's optimistic-concurrency check),
the board is restored to the *exact snapshot taken before the move
started* - not a piecemeal attempt to undo just the one field that
changed.

**Why:** optimistic UI is what makes drag-and-drop feel instant rather
than laggy, but it's a lie until the server confirms it - the
rollback path is what keeps that lie honest. Reverting to a full
snapshot (not trying to compute "what would undo this specific change")
is deliberately the dumb, obviously-correct option: by the time a move
fails, the optimistic state might already be wrong in ways beyond just
the one card that moved (another concurrent move could have landed in
between), and a snapshot taken immediately before touching anything is
the one state this code can actually vouch for being accurate.

**Verified** both at the unit level (`useBoard.test.ts`: a mocked
rejected move rolls back to the pre-move board exactly, sends the
correct pre-move `version`) and live (the Playwright session above
forced a real 409 via request interception and confirmed the UI
reverted *and* surfaced an error banner, not just one or the other).

---

## D-24 (local) — Realtime transport: Socket.IO, attached to the same HTTP server

**Decision:** the real-time layer is Socket.IO (`socket.io` server,
`socket.io-client` on the frontend), attached to the exact same
`http.Server` Express already listens on (`attachRealtime(server)` in
`src/index.ts`) - one process, one port, not a second server to deploy
and monitor separately. Auth happens at the handshake, via
`socket.handshake.auth.token` verified the same way `requireAuth`
verifies a REST bearer token (`verifyAccessToken`, same JWT, same
secret) - a socket that doesn't present a valid token never finishes
connecting at all, the same "authenticate before anything else
happens" posture as the REST middleware.

**Why:** Socket.IO over raw `ws` or Server-Sent Events - reconnection
(with backoff), rooms, and an auth-at-handshake hook all come built
in, instead of being hand-rolled. This project has consistently chosen
the boring, well-trodden library over a custom implementation at every
prior turn (bcrypt over a hand-rolled hash, jsonwebtoken over a hand-
rolled signer, zod over hand-written validation, fractional-indexing
over a hand-rolled rank algorithm) - this is the same call applied to
WebSockets. SSE was also considered and rejected: it's one-directional
(server to client only), and this project needs the client to tell the
server which project's room to join.

**Verified live**, not just via the committed suite: a two-separate-
browser-context Playwright session (one-off, not committed, same
reasoning as every other live verification in this document) had one
account create an issue and confirmed a *different* account, logged in
separately, watching the same board, saw the new card appear with zero
`page.reload()` calls anywhere in the script - the literal wording of
the Phase 5 exit gate ("two open browser sessions see each other's
changes without a manual refresh").

## D-25 (local) — Broadcast-then-refetch, not broadcast-the-payload

**Decision:** every real-time event is `project:changed`, carrying
only `{ type: "issue" | "comment" | "label" }` - never the changed
record itself. The client's reaction to *any* `project:changed` event
is the same: call the exact same `reload()`/refetch function that
already exists for the "Add issue" button and every other client-
initiated change. Reconnection uses the identical path - Socket.IO's
`connect` event (fired on the initial connection *and* every automatic
reconnect) re-joins the project's room and reloads, so "handle
reconnects" (Sep 28) is not a separate code path from "see a live
update" (Sep 25/26); a reconnect is just one more reason to refetch.

**Why:** a second channel that also describes "what does an issue/
board look like" is a second place that description can drift from the
REST response shape it's supposed to match - exactly the same reasoning
D-16 already applied to comment threading (flat storage, let the client
derive structure) and D-12 applied to board ranking (don't let a
schema/transport decision pre-decide something a different layer
should own). Keeping the socket channel "dumb" (pure invalidation
signal) means the REST endpoints stay the *only* source of truth for
response shape, full stop. The cost is an extra round-trip per change
instead of the socket carrying the new data directly - a deliberate
trade given this project's board/issue payloads are small and the
simplicity/correctness win is worth more than saving one fetch.

**Rejected:** broadcasting the actual changed record (the created
issue, the new comment) and having the client merge it into local
state directly. Faster (no extra round-trip), but doubles the number of
places that need to agree on "what does an Issue look like in JSON" -
the REST response shape and the socket payload shape - and reopens
every authorization question REST already answers (can this socket
even see this particular record's full detail?) a second time, in a
different code path, for every event type.

---

## D-26 (local) — Search & filters: one endpoint, query params, AND-across/OR-within

**Decision:** keyword search and all three filters (status, assignee,
label) live on the existing `GET /projects/:projectId/issues` endpoint
as query params - `?search=`, `?status=`, `?assigneeId=`, `?labelId=` -
not separate endpoints, and compose freely with pagination (ISS-07) in
the same request. `status`/`assigneeId`/`labelId` each accept a
comma-separated list of values: an issue matches a given param if it
matches *any* value in that param's list (OR within), and the
different params are ANDed together (`status=TODO&assigneeId=X` means
status matches AND assignee matches). `search` does a case-insensitive
substring match against title OR description (itself an OR, but one
clause within the overall AND).

**Why:** this is exactly what the route's own comment already said it
would become ("Search/list" in the spec's reference table, written back
in Phase 2) - a plain GET with query params is the natural shape for
"list, optionally narrowed," and keeping it one endpoint means
pagination, search, and filters all just work together without a
combinatorial explosion of endpoint variants. AND-across/OR-within is
the specific semantics SRC-03 names, and it's also the one almost every
real issue tracker uses (GitHub's own issue search works the same way:
`label:bug label:p1` narrows further, while the UI's own multi-select
widens).

**Implementation note:** `buildIssueWhere` (issues.service.ts) is the
one place a parsed query becomes a Prisma `where` - every filter key
sits at the top level of that object alongside `projectId`, which
Prisma implicitly ANDs; the search clause is its own `OR: [...]` block,
itself just one of those top-level ANDed keys. `projectId` is never
caller-supplied, so no combination of search/filter params can ever
cross a project boundary - proven directly in `tests/issues-search.test.ts`
with a second project holding a deliberately identically-titled issue.

---

## D-27 (local) — Security review (Oct 6): route/socket audit + rate limiting

**Decision:** every one of the 27 route definitions across the API was
read and confirmed to carry both `requireAuth` and the correct
authorization check for its scope (`getProjectMembership` for
project-scoped routes, `getIssueById` for issue-scoped ones, which
itself checks membership) - no gap found. The one concrete gap this
review *did* find: signup and login had no rate limiting at all,
despite D-10 explicitly flagging that as deferred-not-forgotten back
in Phase 1. Fixed with `express-rate-limit` (20 requests / 15 minutes
per IP on `/auth/signup` and `/auth/login`), disabled in the test
environment (`skip: () => env.NODE_ENV === "test"`) since this suite's
own rapid signup/login traffic would otherwise trip it and produce
flakiness unrelated to the code under test - `createAuthRateLimit`
exists specifically so `tests/authRateLimit.test.ts` can mount a real
copy with that skip forced off and prove the threshold is actually
enforced (not just configured and never exercised).

**Also checked and confirmed already correct** (not new work, just
verified rather than assumed): CORS is locked to `allowedOrigins`, not
a wildcard, on both the REST API and the Socket.IO handshake; no raw
SQL/`eval`/`exec` anywhere in the codebase; `errorHandler` never leaks
a stack trace or internal error message to the client in production
(`NODE_ENV === "production"` gates that, verified by reading the code,
not just trusting the comment above it); `express.json()`'s default
100kb body-size cap is in effect (never overridden to something
unbounded); request logging (`pino-http`, `errorHandler`'s own log
call) never includes the request body, so a logged request never
contains a plaintext password; issue/project/comment/label ids are all
`cuid()` - high-entropy, non-sequential, not practically guessable -
so there's no ID-enumeration surface distinct from the authorization
checks already in place.

---

## D-28 (local) — Fixed a real gap: removing a member now unassigns their issues

**Decision:** `removeMember` (PRJ-04) now clears `assigneeId` on every
issue in the project currently assigned to the person being removed,
in the same transaction as the membership deletion - `authorId` is
left untouched.

**Why this was a bug, not a style choice:** back in Phase 2, before
`Issue`/`assigneeId` existed, `removeMember`'s own comment explicitly
said this needed to happen "once Issue lands" - and then nobody came
back to actually do it once Issue did land (Phase 2, later that same
week) or once assignment did (ASN-02, also Phase 2). The result: a
removed member could stay the live assignee of issues in a project
they could no longer even see, which is ASN-02 ("assignee must be a
current project member") silently failing to hold as an *ongoing*
invariant - it was only ever checked at the moment an assignment was
made, never re-verified when membership later changed. Found during
the Oct 7 "fill in missing tests" pass by noticing the original
comment was still sitting there, years (in spec-time) after the
condition it was waiting for had already arrived.

**Why one transaction:** without it, there's a window (however brief)
where the membership row is gone but the issue still shows the removed
person as assignee - exactly the kind of half-applied state D-20
already established this codebase doesn't accept for board moves.

---

## D-29 (local) — Accessibility pass (Oct 8): a real live-caught bug, not just a checklist

**Decision:** every page now sets `document.title` on mount
(`usePageTitle`, Oct 8) - React Router doesn't do this itself, and a
screen reader announces the document title after a route change, so
every page past the first was previously silently announced as just
"IssueFlow" forever. `BoardPage` gained the `<h1>` it never had (every
page needs exactly one). `SignupPage`'s field-level errors were
restructured from implicit `<label>Text<input/><span/></label>`
wrapping to explicit `<label htmlFor>`/`<input id>` pairs with the
error `<span>` as a sibling, associated only via `aria-describedby`.

**Why the restructure specifically:** nesting the error `<span>`
*inside* the `<label>` made its text part of the input's accessible
**name** (everything inside a label-wrapped input's label contributes
to the name), not just its description - found live, not by reasoning
about it in advance: a Playwright script written to verify the fix
couldn't resolve the password field by `getByLabel("Password")`
anymore once an error was showing, because the field's real accessible
name had become "Password Password must be at least 8 characters."
That's not just a test-tooling inconvenience - a screen reader user
would hear the *exact same thing*, every time the field is focused,
for as long as the error is showing. `aria-describedby` is the correct
mechanism for "here's more context about this field," read on demand,
not baked permanently into the name.

**Also found live, same pass:** `.filters-search`'s `flex: 1 1 14rem`
sizes along whichever axis is "main" for its flex container - row
(width) at desktop widths, but once `.filters` switches to
`flex-direction: column` under the ≤640px breakpoint (D- responsive,
Sep 21), the exact same rule sized the search box's *height* to 14rem
instead, ballooning it into a nearly-empty tall box. Fixed with an
explicit override inside that same media query. Neither of these two
bugs would have been caught by only reading the code - both needed an
actual browser.

**Process note, not a product decision:** while verifying the
`SignupPage` fix, discovered `vitest.config.ts`'s `globals: false`
means `@testing-library/react`'s automatic cleanup-between-tests (which
hooks into a *global* `afterEach`) never registers - every `render()`
across every test in a file was stacking into the same `jsdom`
document instead of unmounting, invisible until a test actually
queried via `screen` (hook-level tests using `renderHook` never
surfaced it, since they read their own returned `result.current`
rather than querying the shared document). Fixed once, centrally, in
`setupTests.ts` - every future component-render test is protected,
not just the one that found it.

---

## D-30 (local) — Oct 9: a real one found in logging, migrations and CORS confirmed solid

**Decision (the actual fix):** `logger.ts` now redacts
`req.headers.authorization` and `req.headers.cookie` (pino's `redact`
option, `censor: "[REDACTED]"`) before anything reaches stdout.

**Why this was a bug, not hardening-for-hardening's-sake:** `pino-http`
(wired in `app.ts` since Phase 0) logs every request's headers via
pino's standard serializer - which includes `Authorization` verbatim,
with nothing in this codebase telling it not to. Found live (Oct 9) by
making a real authenticated request and reading the actual log output,
not by reasoning about pino-http's defaults from memory: every
authenticated request was writing the caller's live bearer JWT to
stdout in plain text. Anyone with read access to logs - a log
aggregator, a leaked log file, a misconfigured dashboard - could lift
a still-valid token straight out of them and impersonate that session
until it expires (`JWT_EXPIRES_IN`, default 1 day). `LOG_REDACT_CONFIG`
is exported separately from the `pino()` call specifically so
`tests/logger.test.ts` exercises the *real* config object directly
(building its own pino instance against it, writing to a capturable
in-memory stream) rather than a hand-copied duplicate that could
silently drift from what's actually running.

**Also checked and confirmed already correct, both by reading the code
and by exercising it live** (not new work - verification, same as
D-27's pass):

- **Migrations**: `prisma migrate status` reports zero drift between
  `schema.prisma` and the applied migration history. `prisma migrate
  deploy` (the production-safe command - `scripts/setup-local-db.sh`
  already used this, not `migrate dev`, which is correct) was run
  against a disposable, genuinely-from-zero database today and applied
  all 4 migrations cleanly, producing exactly the 9 expected
  application tables plus Prisma's own migration-tracking table.
- **CORS**: a live preflight request from the configured origin
  (`ALLOWED_ORIGIN`) gets `Access-Control-Allow-Origin` echoed back; the
  identical request from an arbitrary origin (`evil.example`) gets a
  204 with that header *absent* - which is the correct mechanism (CORS
  is enforced by the requesting browser refusing to expose the
  response to page JavaScript when the header is missing, not by the
  server 403ing the request itself). `tests/cors.test.ts` is new today
  - this had no test coverage before, despite being exactly the kind
  of thing a "CORS lockdown" day should leave behind a test for.

---

## D-31 (local) — Oct 12: pre-deploy pass found a real gap — no UI ever called the member-invite API

**Decision:** Added a members panel to `BoardPage` (client): every
member sees the roster (`GET /projects/:id/members`, PRJ-02b,
member-level); the owner additionally gets an "Invite by email" form
(PRJ-03) and a "Remove" button per *other* member (PRJ-04 - the owner
can't remove themselves, so that row never gets the button at all,
matching what the server already rejects).

**Why this was a bug, not a missing nice-to-have:** `addMember` /
`listMembers` / `removeMember` have existed on the server since Phase
2/7 (D-28), fully tested, fully authorized (D-06's 404-vs-403 split).
Nothing in `client/src/pages` or `endpoints.ts` ever called
`addMember` or `removeMember` - `ProjectsPage` and `BoardPage` simply
never grew the UI for it. The practical effect: every project could
only ever have exactly one person on it, in an app whose entire premise
is a shared board. Found during a pre-deploy pass explicitly aimed at
testing every step live rather than trusting the automated suites
alone - the suites were (and still are) green, because nothing in them
exercised the client UI's *coverage* of the server's API surface, only
each side's own correctness in isolation.

**Why `GET /projects` instead of a new `GET /projects/:id` endpoint:**
"is the signed-in user this project's owner" is needed client-side to
decide whether to render the invite form / remove buttons at all. No
single-project fetch endpoint exists yet (tracked separately in
`client/README.md` Known gaps, predating this). Re-fetching the
already-small project list and matching `ownerId` client-side avoids
adding new server surface for what's otherwise a one-field lookup -
revisit if/when a real single-project page (e.g. a non-generic board
`<h1>`) makes that endpoint worth adding for its own sake.

**Verification:** live two-browser-context Playwright run (owner
invites a second real account by email; that account reaches the
board with no manual refresh; a duplicate invite and an invite to an
unknown email both surface the server's actual error text; owner
removes the member; the removed account is denied on its next
request) - 19/19 checks passed, alongside a clean run of the full
automated suite (185 server + 29 client tests, both builds, both
lints). Not committed as a test file, same reasoning as the other
one-off Playwright verifications in this file.

---

_Last updated: Oct 12 (pre-deploy live-testing pass — see git log)._
