import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";

// Mirrors the server's requireAdmin middleware at the routing layer,
// same relationship RequireAuth has to requireAuth. Always used nested
// inside RequireAuth (see App.tsx), so by the time this renders,
// `status` is already "authenticated" and `user` is populated - this
// only needs to additionally check the role.
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (user?.role !== "ADMIN") {
    return <Navigate to="/projects" replace />;
  }
  return <>{children}</>;
}
