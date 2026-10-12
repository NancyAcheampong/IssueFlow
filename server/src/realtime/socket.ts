import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { verifyAccessToken } from "../lib/jwt.js";
import { allowedOrigins } from "../config/env.js";
import { getProjectMembership } from "../modules/projects/projects.service.js";
import { logger } from "../lib/logger.js";

// DECISIONS.md D-24: Socket.IO over raw `ws` or SSE - reconnection,
// rooms, and an auth-at-handshake hook all come for free instead of
// being hand-rolled, and this project has already leaned "boring,
// well-trodden library over a clever custom implementation" at every
// prior turn (bcrypt, jsonwebtoken, zod, fractional-indexing...).
//
// Module-level singleton, not a class/DI'd dependency - matches how
// `prisma`/`logger` are already done elsewhere in this codebase (see
// lib/prisma.ts). `io` stays `null` until `attachRealtime` actually
// runs (production/dev via src/index.ts) - the test suite calls
// `createApp()` directly via Supertest and never starts a real HTTP
// server, so `broadcastProjectChange` has to be a safe no-op rather
// than throw when nothing has attached a socket server yet.
let io: SocketIOServer | null = null;

interface SocketData {
  userId: string;
}

// DECISIONS.md D-25: every broadcast is "something in this project
// changed, go refetch" - never the changed record's full payload.
// Keeping the real-time channel dumb (an invalidation signal) instead
// of a second copy of the REST response shape means there's exactly
// one place that can describe "what a board/issue looks like" (the
// REST endpoints themselves) instead of two that have to be kept in
// sync by hand. It also means "handle reconnects" (Sep 28) and "live
// update" (Sep 25/26) are the *same* client code path - a reconnect is
// just another reason to refetch.
export type ProjectChangeType = "issue" | "comment" | "label";

// AUTH over the socket handshake, not a message after connecting: a
// socket that never proves who it is never finishes connecting at all
// (`next(new Error(...))` rejects the handshake outright) - same
// "authenticate before anything else happens" posture as requireAuth
// on the REST side.
function authenticateSocket(socket: Socket, next: (err?: Error) => void): void {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error("Authentication required."));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    (socket.data as SocketData).userId = payload.sub;
    next();
  } catch {
    next(new Error("Invalid or expired token."));
  }
}

// Attaches Socket.IO to the same HTTP server Express is already
// listening on (one port, one process - no separate WS server to
// stand up/deploy/monitor). Called once, from src/index.ts, never from
// createApp() - see the comment on `io` above for why that split
// matters for tests.
export function attachRealtime(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const { userId } = socket.data as SocketData;

    // PRJ-xx/D-06, extended to the realtime channel: joining a
    // project's room requires the same membership check as every
    // REST route scoped to that project - a socket that merely holds
    // a valid JWT for *some* account doesn't get to listen in on an
    // arbitrary project's live updates. Errors are emitted back on a
    // dedicated event rather than thrown - throwing inside a socket
    // event handler has no connected `next()`/HTTP response to carry
    // it to, so there'd be nothing to catch it.
    socket.on("join", (projectId: unknown) => {
      if (typeof projectId !== "string" || !projectId) {
        socket.emit("join:error", { message: "A project ID is required." });
        return;
      }

      getProjectMembership(projectId, userId)
        .then(() => {
          void socket.join(projectRoom(projectId));
          socket.emit("join:ok", { projectId });
        })
        .catch(() => {
          // Same D-06 non-leakage as the REST 404: don't distinguish
          // "no such project" from "not your project" even here.
          socket.emit("join:error", { message: "Project not found." });
        });
    });

    socket.on("leave", (projectId: unknown) => {
      if (typeof projectId === "string" && projectId) {
        void socket.leave(projectRoom(projectId));
      }
    });
  });

  logger.info("Realtime (Socket.IO) layer attached");
  return io;
}

function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}

// Called from the service layer after a write actually commits (never
// speculatively, never before the transaction/await resolves) - see
// the call sites in issues.service.ts/comments.service.ts/
// labels.service.ts. A no-op when no socket server is attached (tests,
// or realtime genuinely disabled) rather than throwing - a broadcast
// failing to send is never a reason to fail the request that
// triggered it.
export function broadcastProjectChange(projectId: string, type: ProjectChangeType): void {
  io?.to(projectRoom(projectId)).emit("project:changed", { type });
}
