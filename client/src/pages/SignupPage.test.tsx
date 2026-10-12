import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/AuthContext";
import { SignupPage } from "./SignupPage";

// Oct 8 accessibility pass: a real bug was caught live (not by this
// suite) - nesting the field-error <span> inside the implicit <label>
// made the error text part of the input's accessible NAME, not just
// its description. That broke screen readers (the full error gets
// read out every time the field is focused, forever, even after it's
// fixed) and broke Playwright's getByLabel() in the same stroke. This
// test exists specifically to keep that fix from silently regressing.
vi.mock("./../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./../lib/api")>();
  return { ...actual, getStoredToken: vi.fn(() => null), setStoredToken: vi.fn() };
});
vi.mock("../lib/endpoints", () => ({
  getMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
}));

import { signup as signupRequest } from "../lib/endpoints";

function renderSignupPage() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <SignupPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("SignupPage accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the password field's accessible name as just 'Password', never polluted by the error text", async () => {
    vi.mocked(signupRequest).mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
        password: "Password must be at least 8 characters.",
      }),
    );

    renderSignupPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Display name"), "Someone");
    await user.type(screen.getByLabelText("Email"), "someone@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    await waitFor(() =>
      expect(screen.getByText("Password must be at least 8 characters.")).toBeInTheDocument(),
    );

    // This is the actual regression check: if the error span were
    // nested back inside the <label>, this lookup would fail (no
    // element would have the accessible name "Password" alone
    // anymore) exactly the way it did live before the fix.
    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toBeInTheDocument();
  });

  it("wires aria-invalid and aria-describedby to the real error element once a field error exists", async () => {
    vi.mocked(signupRequest).mockRejectedValue(
      new ApiError(400, "VALIDATION_ERROR", "Request validation failed", {
        password: "Password must be at least 8 characters.",
      }),
    );

    renderSignupPage();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Display name"), "Someone");
    await user.type(screen.getByLabelText("Email"), "someone@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    const passwordInput = await screen.findByLabelText("Password");
    await waitFor(() => expect(passwordInput).toHaveAttribute("aria-invalid", "true"));

    const describedById = passwordInput.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    const errorElement = document.getElementById(describedById!);
    expect(errorElement).toHaveTextContent("Password must be at least 8 characters.");
  });

  it("has no aria-invalid/aria-describedby before any submission", () => {
    renderSignupPage();

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toHaveAttribute("aria-invalid", "false");
    expect(passwordInput).not.toHaveAttribute("aria-describedby");
  });
});
