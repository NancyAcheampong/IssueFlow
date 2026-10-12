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
- **react-router-dom** - client-side routing for /login, /projects,
  /projects/:id/board, /admin (admin-only, D-32).
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

`vite.config.ts` pins the dev server to port 5173 with `strictPort:
true` - without it, Vite silently moves to 5174+ if 5173's already
taken (e.g. another project's dev server left running), which then
makes every API call fail on CORS with no obvious reason why, since
the server's `ALLOWED_ORIGIN` only matches 5173. `strictPort` turns
that into an immediate, legible "port 5173 is in use" error instead -
found live when exactly this happened during manual testing.

## Architecture

- **Styling: CSS Modules, one file per component (Oct 12).** Every
  component/page owns a `Name.module.css` imported as `styles` and
  referenced as `styles.thing` - class names are scoped to that file
  automatically (Vite's built-in CSS Modules support, no extra
  config), so two components can both have a `.card` class without
  colliding. `src/index.css` is intentionally small now - only truly
  global concerns live there: design tokens (`:root` custom
  properties), element resets (`*`, `body`, `a`, `button`), and the
  `[role="alert"]`/`@media (pointer: coarse)` rules that apply
  everywhere rather than to one component. (Originally shared with
  `SignupPage` via `AuthPages.module.css` - renamed to
  `LoginPage.module.css` when `SignupPage` was removed, D-32.) This is
  the styling *foundation* for an upcoming visual redesign,
  not the redesign itself - today's migration was a faithful 1:1 port
  (verified with Playwright screenshots, pixel-identical output)
  before any new visual work lands on top of it.
- **Visual design pass (Oct 12), on top of the CSS Modules
  foundation above.** `src/index.css`'s `:root` now carries a real
  token set - color (including one accent color per board status:
  `--status-backlog`/`--status-todo`/`--status-in-progress`/
  `--status-done`), a type scale, a spacing scale, radius, and shadow
  tokens - plus global base styling for every `button`/`input`/
  `select`/`textarea` (consistent borders, focus rings, hover states).
  One convention carries most of the button styling for free: any
  `button[type="submit"]` automatically gets the filled accent
  "primary action" treatment (Log in, Create user, Create project, Add
  issue, Invite), every other button stays a plain secondary button -
  no per-button classes needed, since every button in this codebase
  already had the right `type` attribute. `Card`/`Column` read the
  issue/column's status straight off a `data-status`/
  `data-column-status` attribute to pick their accent color via a
  plain CSS attribute selector, rather than a lookup table in
  TypeScript. The members panel's letter-avatars (`BoardPage.tsx`'s
  `avatarColor`/`initial` helpers) derive a stable color per person
  from their own user id - deterministic across reloads, no avatar
  image storage needed. Verified live the same way as the CSS Modules
  migration: Playwright screenshots across desktop and mobile
  viewports, this time checking the new visuals rather than their
  absence.
- `src/components/AppHeader.tsx` (Oct 12) - the one piece of chrome
  shared by every authenticated page (brand/home link, who's signed
  in, log out, and the admin-only "Create user" link). Before this,
  `ProjectsPage` and `BoardPage` each grew their own ad hoc header and
  the app didn't read as one product past the login card. Deliberately
  thin - page-specific actions (new project, new issue, filters) stay
  on each page's own header below this one.
- `src/components/RequireAdmin.tsx` (D-32) - mirrors the server's
  `requireAdmin` middleware at the routing layer the same way
  `RequireAuth` mirrors `requireAuth`. Always nested inside
  `RequireAuth` (see `App.tsx`), so by the time it renders, `user` is
  already populated - it only adds the role check, redirecting a
  non-admin to `/projects`. The real security boundary is the server's
  403, not this redirect - hiding the nav link/route is just avoiding
  showing a control that would fail for anyone else.
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
(`LoginPage`, `ProjectsPage`, `BoardPage`, `CreateUserPage`) - React
Router doesn't do this on its own, and a screen reader announces the
document title after navigating, so every page past the first was
previously silently announced as just "IssueFlow." `BoardPage` gained
the `<h1>` it never had. The page that originally caught this
(`SignupPage`, since replaced by `CreateUserPage` under D-32) used
explicit `<label htmlFor>`/`<input id>` pairs with the error as a
sibling `<span>`, associated only via `aria-describedby`/
`aria-invalid` - not nested inside the `<label>`, which would make the
error text part of the input's accessible *name* rather than its
description (a real bug caught live - see D-29 for what that actually
looked like). `CreateUserPage` carries the same fixed pattern forward.
The same live-verification pass also caught a responsive
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

## Project membership (Oct 12)

`BoardPage`'s members panel is the frontend for PRJ-02b/03/04
(`server/README.md`): every member sees the roster, and the owner
additionally gets an "Invite by email" form and a "Remove" button per
other member (the owner can't remove themselves - the server rejects
it, but the client also just never renders that button on the owner's
own row). This closed a real gap found during a pre-deploy pass: the
server had fully supported adding/removing members since Phase 2, but
no UI ever called it, so in practice every project could only ever
have one person on it.

There's no `GET /projects/:id` endpoint (see Known gaps below), so
"am I the owner of this project" is derived client-side by refetching
`GET /projects` (already small - one call per board load) and
matching `ownerId` against the signed-in user's id, rather than adding
new API surface just for this. Verified live with the same
two-browser-context Playwright approach as the realtime section above:
owner invites a second account by email, that account reaches the
board immediately; duplicate invite and unknown-email invite both
surface the server's real error message; owner removes the member,
and the removed account is denied access on its next request.

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
(6 tests, added Oct 7 - this session logic had zero coverage until
then; one more, for `signup()`, was removed Oct 12 along with
`signup()` itself - D-32) proves the actual session lifecycle: no
stored token goes straight to anonymous without ever calling the API;
a stored token is only trusted *after* `GET /me` confirms it (loading
-> authenticated), never blindly; a token `GET /me` rejects is
actively cleared from storage, not just ignored (otherwise the next
load retries the same dead token forever); `login()` stores the new
token and becomes authenticated; `logout()` clears both storage and
in-memory state; `useAuth()` throws outside an `AuthProvider`.

`SignupPage.test.tsx` (3 tests, added Oct 8 as a direct regression
test for the D-29 accessible-name bug) was removed Oct 12 along with
`SignupPage` itself (D-32) - needed adding `afterEach(cleanup)` to
`setupTests.ts` to get there in the first place (`globals: false`
meant Testing Library's own automatic cleanup between tests had never
been registering, invisible until a `screen`-querying test, this was
the first one, actually needed it), which stays in place since other
tests depend on it. The accessible-name pattern itself lives on in
`CreateUserPage`, covered live rather than by a committed test (see
D-32's verification notes).

Beyond the committed suite, the Oct 3 filter UI was verified live
(same one-off Playwright reasoning as every other live verification in
this file): seeded data with a known label and a known status, search
"login" narrows the board from 3 cards to 1, the "To do" status
checkbox and the "bug" label checkbox each narrow it the same way,
"Clear filters" restores all 3 - and, specifically for the debounce,
counting actual `/board` network requests while simulating fast typing
confirmed 0 requests fired mid-keystroke-burst and exactly 1 once
typing settles.

Beyond the committed suite, the full flow (login through drag-and-drop,
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
- No formal design system / component library (no shared `Button`,
  `Input`, etc. React components) - the Oct 12 visual pass is a
  consistent token set and global base element styling (see
  Architecture above), not a reusable component library. Each
  page/component still writes its own markup against those shared
  tokens. Worth revisiting if the UI grows enough for the duplication
  across pages to become a real cost.
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
- No "change my password" or "deactivate/remove a user" feature (D-32)
  - the admin sets an account's *initial* password at creation and
    there's currently no way to change it afterward (by the admin or
    the account holder themselves), and no way to revoke an account
    once created. Real gaps for an actual rollout, not addressed here
    since they weren't part of what was asked for; worth a follow-up
    pass before this is handed to real coworkers.
