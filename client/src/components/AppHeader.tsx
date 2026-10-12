import { Link } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import styles from "./AppHeader.module.css";

// The one piece of chrome shared by every authenticated page - without
// it, Projects and Board each grew their own ad hoc header and the app
// didn't read as one product once you were past the login card (which
// already had its own "IssueFlow" brand mark). Kept deliberately thin:
// just identity (brand, link home), the one admin-only nav item, and
// session (who's signed in, log out) - page-specific actions (new
// project, new issue, filters) stay on each page's own header below
// this one.
export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className={styles.header}>
      <Link to="/projects" className={styles.brand}>
        <span className={styles.mark} aria-hidden="true" />
        IssueFlow
      </Link>
      {user && (
        <p className={styles.userInfo}>
          {user.role === "ADMIN" && <Link to="/admin">Create user</Link>}
          <span>Signed in as {user.displayName}</span>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </p>
      )}
    </header>
  );
}
