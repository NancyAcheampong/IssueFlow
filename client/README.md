# IssueFlow client

React + TypeScript + Vite frontend for the IssueFlow API (see
`../server/README.md`). Built starting Phase 4 (Sep 17-19 on the build
schedule) once the board's backend (get board, move card) existed to
build against.

## Stack, and why

- **React + Vite + TypeScript** - matches the backend's language
  (TypeScript end to end), and Vite's dev server + build are fast with
  minimal config. No meta-framework (Next.js, Remix, etc.) - this is a
  single authenticated app behind a REST API, not a site that needs
  SSR/SEO.
- **react-router-dom** - client-side routing for /login, /signup,
  /projects, /projects/:id/board.
- **@dnd-kit/core + @dnd-kit/sortable** - drag-and-drop for the board.
  Chosen over react-beautiful-dnd (unmaintained) and native HTML5 DnD
  (poor touch/mobile support, poor accessibility story) - dnd-kit has
  first-class keyboard sensor support out of the box, which matters
  directly for DECISIONS.md D-22.
- **oxlint** - the Vite scaffold's default linter (Rust-based ESLint
  alternative, fast, zero config). Kept rather than migrating to the
  server's ESLint setup - no reason to fight the scaffold's sensible
  default.
- **Vitest + @testing-library/react** - same test runner as the
  server, for consistency. `vitest.config.ts` is deliberately separate
  from `vite.config.ts` - see the comment in that file for why
  (a real type-duplication issue between `vite` and `vitest/config`'s
  bundled `vite`, not a stylistic choice).

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Point at a running API (defaults to http://localhost:4000/api/v1
#    if this is skipped - see src/lib/api.ts)
cp .env.example .env

# 3. Run the dev server
npm run dev
```

Requires the server to actually be running (`cd ../server && npm run
dev`) and its `ALLOWED_ORIGIN` to include this app's origin
(`http://localhost:5173` by default - already the server's own
`.env.example` default).

## Architecture

- `src/lib/api.ts` - a thin `fetch` wrapper matching the server's one
  documented error envelope (`{ error: { code, message, fields? } }`);
  every call site gets a typed `ApiError`, never a raw parsed body.
- `src/lib/endpoints.ts` - one function per API call the frontend
  actually makes - the only place that knows the server's URL shapes.
- `src/lib/AuthContext.tsx` - the stateless-bearer-token session model
  (matches the server's D-02: no refresh token, no server-side
  logout). A stored token is re-verified against `GET /me` on load,
  not trusted blindly.
- `src/lib/boardLogic.ts` - **pure** board-manipulation functions
  (`computeMove`, `resolveDropTarget`, `replaceIssueInBoard`) with no
  React or @dnd-kit dependency, so the core "what does a move actually
  do to the board" logic is unit-testable without rendering anything
  or simulating pointer/keyboard events. See
  `src/lib/boardLogic.test.ts`.
- `src/lib/useBoard.ts` - fetches the board and exposes one `moveCard`
  function; both drag-and-drop and the keyboard-accessible "Move to"
  control funnel through it. Optimistic update + rollback-on-failure
  (D-23) lives here, tested directly (mocked API, not mocked logic) in
  `src/lib/useBoard.test.ts`. Also owns the realtime connection (Phase
  5) - see below.
- `src/lib/realtime.ts` - the one function that knows how to open a
  Socket.IO connection to the server (D-24), mirroring `endpoints.ts`
  being the one place that knows the REST URL shapes.
- `src/components/Column.tsx` / `Card.tsx` - the board UI. Each card is
  both draggable (pointer or keyboard, via @dnd-kit) and carries an
  explicit "Move to" `<select>` - two ways to trigger the exact same
  move (D-22).

## Responsive (Sep 21)

Below 640px wide there isn't room for multiple ~16rem columns plus a
peek of the next one, so the board switches to "one column (mostly) at
a time, swipe sideways between columns" - the same pattern Trello's
own mobile web uses - rather than shrinking columns until their
contents stop being legible. `scroll-snap-type`/`scroll-snap-align`
make that swipe land on a column boundary. Interactive elements get a
larger minimum touch target (`@media (pointer: coarse)`, not a width
breakpoint - a mouse doesn't need it, a finger does, independent of
viewport size). Verified live with a throwaway Playwright script
(same "not committed, not otherwise part of this toolchain" reasoning
as the Sep 17-19 verification above) at 375px, 768px, and 1280px.

## Accessibility (Oct 8 — D-29)

`src/lib/usePageTitle.ts` sets `document.title` on every page
(`LoginPage`, `SignupPage`, `ProjectsPage`, `BoardPage`) - React Router
doesn't do this on its own, and a screen reader announces the document
title after navigating, so every page past the first was previously
silently announced as just "IssueFlow." `BoardPage` gained the `<h1>`
it never had. `SignupPage`'s field errors use explicit
`<label htmlFor>`/`<input id>` pairs with the error as a sibling
`<span>`, associated only via `aria-describedby`/`aria-invalid` - not
nested inside the `<label>`, which would make the error text part of
the input's accessible *name* rather than its description (a real bug
caught live - see D-29 for what that actually looked like, and
`src/pages/SignupPage.test.tsx` for the regression test that locks the
fix in). The same live-verification pass also caught a responsive
regression: `.filters-search`'s `flex: 1 1 14rem` sized the search
box's *height* instead of its width once the mobile breakpoint
switched `.filters` to a column layout - fixed in the same media
query.

## Realtime (Phase 5, Sep 23-29)

`useBoard` opens a Socket.IO connection (`src/lib/realtime.ts`) on
mount, authenticated with the same JWT as every REST call, and joins
the current project's room. The channel is deliberately "dumb" (D-25,
see `server/README.md`): every event is just "something changed, go
refetch," handled by calling the exact same `reload()` function the
"Add issue" button already uses - there's no second code path that
also has to know how to merge a partial update into local state.
Socket.IO's own `connect` event (fired on the initial connection *and*
every automatic reconnect) re-joins the room and reloads, which is
also what satisfies "handle reconnects, re-fetch state" - a reconnect
is just another reason this same code runs, not a separate feature.

Verified live with a two-separate-browser-context Playwright session
(same one-off, not-committed reasoning as the other live verifications
in this file): one logged-in account created an issue and a
*different* logged-in account, watching the same board in its own
browser context, saw the new card appear with zero `page.reload()`
calls anywhere in the script - see DECISIONS.md D-24.

## Search & filters (Phase 6, Sep 30-Oct 3)

`BoardPage` owns the filter state (search text, selected statuses,
assignees, labels) and passes it to `useBoard`, which keys its fetch
effect off a *stringified* version of that state rather than the
object reference - a fresh `{}` every render (which filter state
inevitably is) would otherwise refetch on every render regardless of
whether anything actually changed. The search box is debounced 300ms
(`BoardPage.tsx`) so a fast typist doesn't fire a request per
keystroke, almost all of which would be thrown away before they even
resolved - verified live by counting actual network requests during
simulated fast typing (0 fired mid-burst, exactly 1 once typing
settles). Status/assignee/label filters are plain checkbox groups, not
a custom multi-select widget - native controls are keyboard- and
screen-reader-operable with zero extra work, which matters directly
for the Oct 8 accessibility pass.

`src/lib/endpoints.ts`'s `listLabels`/`listMembers` populate the
assignee/label checkboxes (the latter needed a new server endpoint,
`GET /projects/:id/members` - see server/README.md PRJ-02b).

## Tests

```bash
npm test          # run once
npm run test:watch
```

Current coverage: `boardLogic.test.ts` (11 tests) proves the pure move
math - correct neighbor computation, same-column reorder without
duplicating/losing a card, out-of-range index clamping, and the
off-by-one that excluding the dragged card from index calculation
exists specifically to avoid. `useBoard.test.ts` (8 tests) proves the
hook's actual behavior against a mocked API and a mocked socket: a
successful move reconciles with the server's response (including the
new `version`, which the *next* move depends on); a rejected move
rolls back to the exact pre-move board and surfaces an error; the
correct pre-move `version` is sent for optimistic concurrency; a
`connect` event joins the project's room and reloads the board; a
`project:changed` event reloads the board regardless of its `type`
(D-25 - the hook deliberately never branches on it); the socket closes
on unmount; filters pass through to `getBoard` unchanged; a *new
object* with identical filter content does NOT trigger a refetch, but
actually different content does (the stringify-as-dependency-key
design, proven directly rather than just asserted). `AuthContext.test.tsx`
(7 tests, added Oct 7 - this session logic had zero coverage until
then) proves the actual session lifecycle: no stored token goes
straight to anonymous without ever calling the API; a stored token is
only trusted *after* `GET /me` confirms it (loading -> authenticated),
never blindly; a token `GET /me` rejects is actively cleared from
storage, not just ignored (otherwise the next load retries the same
dead token forever); `login()` stores the new token and becomes
authenticated; `signup()` genuinely chains into `login()` rather than
expecting its own token back (AUTH-01 - the server never issues one
from signup); `logout()` clears both storage and in-memory state;
`useAuth()` throws outside an `AuthProvider`.

`src/pages/SignupPage.test.tsx` (3 tests, added Oct 8 as a direct
regression test for the D-29 accessible-name bug): the password
field's accessible name stays exactly "Password" even while a field
error is showing (this is the test that would fail if the error span
were nested back inside the `<label>`); `aria-invalid`/`aria-describedby`
resolve to the actual error element's text once a field error exists;
neither attribute is present before any submission. Needed adding
`afterEach(cleanup)` to `setupTests.ts` to get here - `globals: false`
meant Testing Library's own automatic cleanup between tests had never
been registering, invisible until a `screen`-querying test (this was
the first one) actually needed it.

Beyond the committed suite, the Oct 3 filter UI was verified live
(same one-off Playwright reasoning as every other live verification in
this file): seeded data with a known label and a known status, search
"login" narrows the board from 3 cards to 1, the "To do" status
checkbox and the "bug" label checkbox each narrow it the same way,
"Clear filters" restores all 3 - and, specifically for the debounce,
counting actual `/board` network requests while simulating fast typing
confirmed 0 requests fired mid-keystroke-burst and exactly 1 once
typing settles.

Beyond the committed suite, the full flow (signup through drag-and-drop,
the keyboard move control, and rollback on a forced 409) was verified
live against a running server + browser before this landed - see the
commit this file was added in for what that covered. That one-off
script isn't committed (it needed Playwright, which isn't otherwise
part of this project's toolchain) - the committed Vitest suite above
is the durable, repeatable coverage.

## Known gaps / deliberately out of scope for now

- No live drag preview *during* a cross-column drag - `onDragEnd`
  computes the final position; dnd-kit's `onDragOver` (for a card to
  visually hop into the other column mid-drag) isn't wired up. Fully
  functional, just less polished than dnd-kit's own full demo.
- `src/lib/types.ts` duplicates the server's API shapes by hand - no
  shared/generated type package between `server/` and `client/` yet.
  A real cost (two places to update), not an oversight; setting up
  sharing is a bigger decision than this page of types justifies on
  its own.
- No design system / component library - plain CSS
  (`src/index.css`). Deliberately minimal given the scope of what's
  built so far (auth, project list, one board view).
- `BoardPage`'s `<h1>` reads the generic "Board," not the actual
  project's name - no `GET /projects/:id` (single-project fetch)
  endpoint exists yet on the server to get it from (only `GET
  /projects`, the list). Added the `<h1>` itself Oct 8 because every
  page needs one regardless; making it say the real project name is a
  real, separate, small backend-plus-frontend task, not done here to
  avoid scope-creeping an accessibility pass into new API surface.
- No `aria-live` announcement when the realtime channel (Phase 5)
  changes the board out from under a screen reader user - a card
  appearing/moving via a live update is currently silent to anyone not
  looking at the screen. Deliberately not bolted on here: over-
  announcing live updates is its own real failure mode (a noisy board
  with several people active becomes unusable), and getting this right
  is a deliberate design decision, not a quick addition.
