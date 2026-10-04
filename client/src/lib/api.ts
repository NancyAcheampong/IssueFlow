// A thin fetch wrapper matching the server's one documented error
// envelope (server/src/middleware/errorHandler.ts):
// { error: { code, message, fields? } }. Every call site gets a typed
// ApiError instead of having to re-parse the response shape itself.

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:4000/api/v1";

const TOKEN_STORAGE_KEY = "issueflow.token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // Private browsing / blocked storage: treat as "logged out" rather
    // than crash the app over a convenience feature.
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Same reasoning as getStoredToken - losing persistence isn't
    // worth failing the calling action over.
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // 204 No Content (e.g. DELETE) has no body to parse.
  const payload =
    response.status === 204 ? null : await response.json().catch(() => null);

  if (!response.ok) {
    const envelope = (
      payload as {
        error?: {
          code?: string;
          message?: string;
          fields?: Record<string, string>;
        };
      }
    )?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? "UNKNOWN_ERROR",
      envelope?.message ?? "Something went wrong.",
      envelope?.fields,
    );
  }

  return payload as T;
}
