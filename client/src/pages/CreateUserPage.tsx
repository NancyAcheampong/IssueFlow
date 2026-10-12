import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import { createUser, listUsers } from "../lib/endpoints";
import type { SafeUser } from "../lib/types";
import { AppHeader } from "../components/AppHeader";
import styles from "./CreateUserPage.module.css";

// Admin-only (gated by RequireAdmin in App.tsx) - replaces the old
// public SignupPage. The admin sets a new account's email, display
// name, and initial password directly here; there's no invite/email
// flow (ADMIN_PASSWORD-style - see server/README.md).
export function CreateUserPage() {
  usePageTitle("Create user");
  const { token } = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (!token) {
      return;
    }
    listUsers(token)
      .then(({ users: fetched }) => setUsers(fetched))
      .catch(() => setUsers([]))
      .finally(() => setLoadingUsers(false));
  }, [token]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setSuccess(null);
    try {
      const { user } = await createUser(token, email, displayName, password);
      setUsers((current) => [...current, user]);
      setSuccess(
        `Created ${user.displayName} (${user.email}). Share the email and initial password with them directly.`,
      );
      setEmail("");
      setDisplayName("");
      setPassword("");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError("Failed to create user.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className={styles.page}>
        <h1 className={styles.pageTitle}>Create user</h1>

        <div className={styles.card}>
          <form onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label htmlFor="new-user-display-name">Display name</label>
              <input
                id="new-user-display-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                aria-invalid={Boolean(fieldErrors.displayName)}
                aria-describedby={
                  fieldErrors.displayName
                    ? "new-user-display-name-error"
                    : undefined
                }
              />
              {fieldErrors.displayName && (
                <span
                  className={styles.fieldError}
                  id="new-user-display-name-error"
                  role="alert"
                >
                  {fieldErrors.displayName}
                </span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="new-user-email">Email</label>
              <input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={
                  fieldErrors.email ? "new-user-email-error" : undefined
                }
              />
              {fieldErrors.email && (
                <span
                  className={styles.fieldError}
                  id="new-user-email-error"
                  role="alert"
                >
                  {fieldErrors.email}
                </span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="new-user-password">Initial password</label>
              <input
                id="new-user-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={
                  fieldErrors.password ? "new-user-password-error" : undefined
                }
              />
              {fieldErrors.password && (
                <span
                  className={styles.fieldError}
                  id="new-user-password-error"
                  role="alert"
                >
                  {fieldErrors.password}
                </span>
              )}
            </div>

            {error && <p role="alert">{error}</p>}
            {success && <p className={styles.success}>{success}</p>}

            <button
              type="submit"
              disabled={
                submitting ||
                !email.trim() ||
                !displayName.trim() ||
                !password.trim()
              }
            >
              Create user
            </button>
          </form>
        </div>

        <h2 className={styles.rosterTitle}>Existing users</h2>
        {loadingUsers && <p>Loading…</p>}
        <ul className={styles.userList}>
          {users.map((existingUser) => (
            <li key={existingUser.id} className={styles.userRow}>
              <span className={styles.userName}>
                {existingUser.displayName}
              </span>
              {existingUser.role === "ADMIN" && (
                <span className={styles.adminBadge}>Admin</span>
              )}
              <span className={styles.userEmail}>{existingUser.email}</span>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
