// A tiny stand-in for the Supabase Auth HTTP API.
//
// The app only calls GET /auth/v1/user with "Authorization: Bearer <token>"
// (through supabase.auth.getUser()). Test tokens are "test-token." followed by
// base64url JSON {id, email}; anything else gets a 401 like the real service.

import http from "node:http";

export const TOKEN_PREFIX = "test-token.";

export function tokenFor(user) {
  return TOKEN_PREFIX + Buffer.from(JSON.stringify({ id: user.id, email: user.email })).toString("base64url");
}

function userFromToken(token) {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token.slice(TOKEN_PREFIX.length), "base64url").toString("utf8"));
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function startAuthStub(port) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    calls.push({ method: req.method, path: url.pathname });
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const user = userFromToken(token);
      if (!user) {
        return send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      }
      return send(200, {
        id: user.id,
        aud: "authenticated",
        role: "authenticated",
        email: user.email ?? null,
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    send(404, { code: 404, msg: "not handled by the test stub" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, calls }));
  });
}
