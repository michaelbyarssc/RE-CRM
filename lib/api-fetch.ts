// Shared helpers for screens that change data (create, edit, delete).
// Safe to use in client components: no server-only code and no Node imports.

/**
 * fetch() that never throws. A request that cannot reach the server comes back
 * as a failed answer with status 0, so callers only need to test `res.ok`.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    // No connection, or the request was blocked before it reached the server.
    return Response.error();
  }
}

// Server texts that do not help the user, compared without case.
const GENERIC_TEXTS = new Set([
  "invalid request",
  "internal server error",
  "unauthorized",
  "forbidden",
  "not found",
  "bad request",
  "invalid id",
  "invalid action",
  "malformed json body",
  "expected a json object",
  "request body too large",
  "already exists",
]);

/** Reads the `error` text from the answer. Returns null when it does not help. Never throws. */
async function helpfulServerText(res: Response): Promise<string | null> {
  let text: unknown;
  try {
    const body: unknown = await res.json();
    text = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  } catch {
    // No body, a body that is not JSON, or a body that was already read.
    return null;
  }
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 200) return null;
  if (GENERIC_TEXTS.has(trimmed.toLowerCase())) return null;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/**
 * One or two short sentences for a toast after a refused write.
 * what:  what did not happen, no full stop. Example: "Could not save the event"
 * check: what the user should check when the server refused the values. Example: "Check the title, date and times."
 */
export async function apiErrorMessage(res: Response, what: string, check?: string): Promise<string> {
  // No connection and signed out: the server text (if any) would not help.
  if (res.status === 0) return `${what}. Check your internet connection and try again.`;
  // Signing in on this tab would throw away what the user typed, so point to a new tab.
  if (res.status === 401) return `${what}. You are signed out. Sign in again in a new tab, then try again here.`;

  // For every other answer, a clear text from the server wins.
  const text = await helpfulServerText(res);
  if (res.status === 404) {
    return `${what}. ${text ?? "It was not found."} It may have been deleted. Refresh the page.`;
  }
  if (text) return `${what}. ${text}`;

  switch (res.status) {
    case 403:
      return `${what}. Your account is not allowed to do this.`;
    case 409:
      return `${what}. It already exists.`;
    case 413:
      return `${what}. It is too large.`;
    case 400:
    case 422:
      return `${what}. ${check ?? "Check what you entered and try again."}`;
    default:
      return `${what}. Something went wrong on our side. Try again in a minute.`;
  }
}
