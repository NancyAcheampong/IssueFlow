import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

// Mirrors the server's requireAuth middleware at the routing layer:
// an anonymous visitor gets bounced to /login rather than seeing a
// broken authenticated page. "loading" (token being verified against
// GET /me) renders nothing yet rather than flashing the login page
// and immediately redirecting away from it.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === "loading") {
    return null;
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
