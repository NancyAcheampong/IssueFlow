import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import type { SafeUser } from "./types";

// Oct 7 ("fill in missing tests"): this is the one piece of client
// session logic with zero coverage until now - how a stored token is
// (or isn't) trusted on load, what login/logout actually do to both
// state and localStorage. Mocks the module boundaries (./api's token
// storage, ./endpoints' HTTP calls), same approach as useBoard.test.ts
// - nothing *inside* AuthContext itself is faked.
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    getStoredToken: vi.fn(),
    setStoredToken: vi.fn(),
  };
});
vi.mock("./endpoints", () => ({
  getMe: vi.fn(),
  login: vi.fn(),
}));

import { getStoredToken, setStoredToken } from "./api";
import { getMe, login as loginRequest } from "./endpoints";

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

const USER: SafeUser = {
  id: "u1",
  email: "person@example.com",
  displayName: "Person",
  role: "MEMBER",
  createdAt: "",
};

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("goes straight to anonymous when there's no stored token", async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
  });

  it("trusts a stored token only after GET /me confirms it, not blindly", async () => {
    vi.mocked(getStoredToken).mockReturnValue("stored-token");
    vi.mocked(getMe).mockResolvedValue({ user: USER });

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.user).toEqual(USER);
    expect(result.current.token).toBe("stored-token");
    expect(getMe).toHaveBeenCalledWith("stored-token");
  });

  it("discards a stored token that GET /me rejects (expired/invalid/deleted account)", async () => {
    vi.mocked(getStoredToken).mockReturnValue("stale-token");
    vi.mocked(getMe).mockRejectedValue(new Error("unauthorized"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("anonymous"));
    expect(result.current.user).toBeNull();
    // The bad token is actively cleared, not just ignored - otherwise
    // the next load would try (and fail) the exact same dead token.
    expect(setStoredToken).toHaveBeenCalledWith(null);
  });

  it("login() stores the token and becomes authenticated", async () => {
    vi.mocked(getStoredToken).mockReturnValue(null);
    vi.mocked(loginRequest).mockResolvedValue({
      user: USER,
      token: "fresh-token",
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("anonymous"));

    await act(async () => {
      await result.current.login("person@example.com", "hunter2");
    });

    expect(loginRequest).toHaveBeenCalledWith("person@example.com", "hunter2");
    expect(setStoredToken).toHaveBeenCalledWith("fresh-token");
    expect(result.current.status).toBe("authenticated");
    expect(result.current.user).toEqual(USER);
  });

  it("logout() clears both the stored token and in-memory state", async () => {
    vi.mocked(getStoredToken).mockReturnValue("stored-token");
    vi.mocked(getMe).mockResolvedValue({ user: USER });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authenticated"));

    act(() => {
      result.current.logout();
    });

    expect(setStoredToken).toHaveBeenCalledWith(null);
    expect(result.current.status).toBe("anonymous");
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("throws when used outside an AuthProvider", () => {
    // Suppress the expected console.error React logs for this one
    // deliberately-uncaught-render-error test.
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider.",
    );
    consoleSpy.mockRestore();
  });
});
