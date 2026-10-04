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
  `src/lib/useBoard.test.ts`.
- `src/components/Column.tsx` / `Card.tsx` - the board UI. Each card is
  both draggable (pointer or keyboard, via @dnd-kit) and carries an
  explicit "Move to" `<select>` - two ways to trigger the exact same
  move (D-22).

## Tests

```bash
npm test          # run once
npm run test:watch
```

Current coverage: `boardLogic.test.ts` (11 tests) proves the pure move
math - correct neighbor computation, same-column reorder without
duplicating/losing a card, out-of-range index clamping, and the
off-by-one that excluding the dragged card from index calculation
exists specifically to avoid. `useBoard.test.ts` (3 tests) proves the
hook's actual behavior against a mocked API: a successful move
reconciles with the server's response (including the new `version`,
which the *next* move depends on); a rejected move rolls back to the
exact pre-move board and surfaces an error; the correct pre-move
`version` is sent for optimistic concurrency.

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
