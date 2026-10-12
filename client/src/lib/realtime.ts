import { io, type Socket } from "socket.io-client";

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/api/v1";

// Socket.IO connects at the server's origin, not under the REST API's
// path prefix - VITE_API_URL includes "/api/v1" (see api.ts), but the
// Socket.IO handshake lives at the root of the same host/port
// (src/realtime/socket.ts attaches it to the same http.Server Express
// listens on - D-24). Deriving the socket URL from VITE_API_URL rather
// than introducing a second env var keeps "where's the API" one
// source of truth instead of two that could drift apart.
const SOCKET_URL = new URL(API_BASE_URL).origin;

// Phase 5/D-24: one function, one place that knows how to open the
// realtime connection - mirrors endpoints.ts being the only place that
// knows the server's REST URL shapes. Socket.IO's own reconnection
// (exponential backoff, automatic) is left at its defaults; nothing
// here needs to hand-roll that.
export function connectRealtimeSocket(token: string): Socket {
  return io(SOCKET_URL, { auth: { token } });
}
