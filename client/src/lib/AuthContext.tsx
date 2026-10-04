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
import {
  getMe,
  login as loginRequest,
  signup as signupRequest,
} from "./endpoints";
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
  signup: (
    email: string,
    displayName: string,
    password: string,
  ) => Promise<void>;
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

  const signup = useCallback(
    async (email: string, displayName: string, password: string) => {
      // AUTH-01: signup and login are deliberately separate steps on
      // the server (signup never returns a token) - the client just
      // chains them so the person doesn't have to type their password
      // twice.
      await signupRequest(email, displayName, password);
      await login(email, password);
    },
    [login],
  );

  const logout = useCallback(() => {
    setStoredToken(null);
    setState({ user: null, token: null, status: "anonymous" });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, signup, logout }),
    [state, login, signup, logout],
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
