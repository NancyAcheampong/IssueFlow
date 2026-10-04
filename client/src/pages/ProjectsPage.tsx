import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/AuthContext";
import { createProject, listProjects } from "../lib/endpoints";
import type { Project } from "../lib/types";

export function ProjectsPage() {
  const { token, user, logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }
    listProjects(token)
      .then(({ projects: fetched }) => setProjects(fetched))
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load projects.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !newName.trim()) {
      return;
    }
    try {
      const { project } = await createProject(token, newName.trim());
      setProjects((current) => [project, ...current]);
      setNewName("");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create project.",
      );
    }
  }

  return (
    <main className="projects-page">
      <header>
        <h1>Projects</h1>
        <p>
          Signed in as {user?.displayName}.{" "}
          <button type="button" onClick={logout}>
            Log out
          </button>
        </p>
      </header>

      <form onSubmit={handleCreate} className="new-project-form">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New project name"
          aria-label="New project name"
        />
        <button type="submit" disabled={!newName.trim()}>
          Create project
        </button>
      </form>

      {error && <p role="alert">{error}</p>}
      {loading && <p>Loading…</p>}

      <ul className="project-list">
        {projects.map((project) => (
          <li key={project.id}>
            <Link to={`/projects/${project.id}/board`}>{project.name}</Link>
          </li>
        ))}
      </ul>
      {!loading && projects.length === 0 && (
        <p>No projects yet - create one above.</p>
      )}
    </main>
  );
}
