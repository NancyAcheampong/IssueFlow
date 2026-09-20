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

_Last updated: Phase 4 batch, Sep 15-16 (ranking decision + get-board through move-card — see git log for the day-by-day breakdown)._
