import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { usePageTitle } from "../lib/usePageTitle";
import styles from "./AuthPages.module.css";

export function SignupPage() {
  usePageTitle("Sign up");
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      await signup(email, displayName, password);
      navigate("/projects");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError("Failed to sign up.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          required
          aria-invalid={Boolean(fieldErrors.displayName)}
          aria-describedby={
            fieldErrors.displayName ? "displayName-error" : undefined
          }
        />
        {fieldErrors.displayName && (
          <span
            className={styles.fieldError}
            id="displayName-error"
            role="alert"
          >
            {fieldErrors.displayName}
          </span>
        )}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
        />
        {fieldErrors.email && (
          <span className={styles.fieldError} id="email-error" role="alert">
            {fieldErrors.email}
          </span>
        )}

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
        />
        {fieldErrors.password && (
          <span className={styles.fieldError} id="password-error" role="alert">
            {fieldErrors.password}
          </span>
        )}

        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          Sign up
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
