// A tiny stand-in for the Supabase Auth HTTP API.
//
// The app server calls GET /auth/v1/user with "Authorization: Bearer <token>"
// (through supabase.auth.getUser()). Test tokens are "test-token." followed by
// base64url JSON {id, email}; anything else gets a 401 like the real service.
//
// A browser (the browser checks in t33) also calls this origin directly, so
// the stub answers CORS, including the OPTIONS preflight, and handles the
// three calls the login form and the sidebar make through supabase-js:
// - POST /auth/v1/token?grant_type=password, only for the test users in
//   helpers/db.mjs with BROWSER_PASSWORD;
// - POST /auth/v1/token?grant_type=refresh_token, only for refresh tokens
//   this stub handed out;
// - POST /auth/v1/logout, only with a valid token.
// Everything else is refused as before.

import http from "node:http";
import { USERS } from "./db.mjs";

export const TOKEN_PREFIX = "test-token.";
const REFRESH_PREFIX = "test-refresh.";

/** The password of every test user for the browser sign-in. It carries the
 * leak marker, so the leak scan fails if it ever reaches an answer or a log. */
export const BROWSER_PASSWORD = "browser-pass-ZZSECRET-1";

export function tokenFor(user) {
  return TOKEN_PREFIX + Buffer.from(JSON.stringify({ id: user.id, email: user.email })).toString("base64url");
}

function refreshTokenFor(user) {
  return REFRESH_PREFIX + Buffer.from(JSON.stringify({ id: user.id, email: user.email })).toString("base64url");
}

function decode(token, prefix) {
  if (!token || !token.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token.slice(prefix.length), "base64url").toString("utf8"));
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function userFromToken(token) {
  return decode(token, TOKEN_PREFIX);
}

function knownUser(found) {
  return Object.values(USERS).find((u) => found && u.id === found.id && u.email === found.email) || null;
}

function userBody(user) {
  return {
    id: user.id,
    aud: "authenticated",
    role: "authenticated",
    email: user.email ?? null,
    app_metadata: { provider: "email" },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
}

function sessionFor(user) {
  return {
    access_token: tokenFor(user),
    token_type: "bearer",
    expires_in: 3600 * 24 * 365,
    expires_at: 4102444800, // 2100-01-01, so the browser never refreshes
    refresh_token: refreshTokenFor(user),
    user: userBody(user),
  };
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (d) => {
      raw += d;
      if (raw.length > 65536) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

export function startAuthStub(port) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    calls.push({ method: req.method, path: url.pathname });
    // The browser calls this origin from the app's origin (cross-origin).
    const cors = {
      "access-control-allow-origin": req.headers.origin || "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": req.headers["access-control-request-headers"] || "authorization, apikey, content-type",
      "access-control-max-age": "600",
      vary: "Origin",
    };
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    };
    const bearerUser = () => {
      const header = req.headers.authorization || "";
      return userFromToken(header.startsWith("Bearer ") ? header.slice(7) : "");
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      return res.end();
    }
    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      const user = bearerUser();
      if (!user) {
        return send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      }
      return send(200, userBody(user));
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/token") {
      const body = await readJson(req);
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const user = Object.values(USERS).find((u) => u.email === body.email);
        if (user && body.password === BROWSER_PASSWORD) return send(200, sessionFor(user));
        return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      if (grant === "refresh_token") {
        const user = knownUser(decode(body.refresh_token, REFRESH_PREFIX));
        if (user) return send(200, sessionFor(user));
        return send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      }
      return send(400, { code: 400, error_code: "unsupported_grant_type", msg: "unsupported grant_type" });
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/logout") {
      if (!bearerUser()) return send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      res.writeHead(204, cors);
      return res.end();
    }
    send(404, { code: 404, msg: "not handled by the test stub" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, calls }));
  });
}
