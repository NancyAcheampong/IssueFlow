import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { getStoredToken, setStoredToken } from "./api";
import { getMe, login as loginRequest } from "./endpoints";
import type { SafeUser } from "./types";

// AUTH-02/AUTH-04: a stateless bearer token, same model as the server
// (no refresh token, no server-side logout - see DECISIONS.md D-02).
// On load, a stored token is verified against GET /me rather than
// trusted blindly - a token for a deleted account, or one that's
// simply expired, should drop the user back to the login screen, not
// silently render a broken "logged in" state.
interface AuthState {
  user: SafeUser | null;
  token: string | null;
  status: "loading" | "authenticated" | "anonymous";
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    status: "loading",
  });

  useEffect(() => {
    const storedToken = getStoredToken();
    if (!storedToken) {
      setState({ user: null, token: null, status: "anonymous" });
      return;
    }

    getMe(storedToken)
      .then(({ user }) =>
        setState({ user, token: storedToken, status: "authenticated" }),
      )
      .catch(() => {
        setStoredToken(null);
        setState({ user: null, token: null, status: "anonymous" });
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user, token } = await loginRequest(email, password);
    setStoredToken(token);
    setState({ user, token, status: "authenticated" });
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setState({ user: null, token: null, status: "anonymous" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }
  return context;
}
