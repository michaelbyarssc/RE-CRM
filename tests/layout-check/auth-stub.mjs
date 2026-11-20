// Local stand-in for the Supabase Auth HTTP API, so the real login page works
// without a Supabase project. It listens on 127.0.0.1 only and knows one
// made-up user, taken from the local settings file (DEMO_USER_ID,
// DEMO_USER_EMAIL, DEMO_USER_PASSWORD, AUTH_STUB_PORT).
//
// Start and stop it with serve.mjs (stub-start, stub-stop). To run it in the
// front for a look at its log: node tests/layout-check/auth-stub.mjs
//
// The test suite has its own, smaller stub (tests/helpers/auth-stub.mjs) that
// only answers GET /auth/v1/user. This one also answers the calls the login
// page makes:
//   POST /auth/v1/token?grant_type=password | refresh_token
//   GET  /auth/v1/user
//   POST /auth/v1/logout
//   GET  /layout-check/health   (so serve.mjs can tell this stub from another program on the port)
//
// It is not a security boundary: the tokens are not signed (the browser code
// only reads the expiry time out of them), so it must never listen on anything
// but 127.0.0.1 and must never stand in front of real data.

import http from "node:http";
import { needSettings, stubPort } from "./lib.mjs";

let settings;
let port;
try {
  settings = needSettings(["AUTH_STUB_PORT", "DEMO_USER_ID", "DEMO_USER_EMAIL", "DEMO_USER_PASSWORD"]);
  port = stubPort(settings);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const USER = {
  id: settings.DEMO_USER_ID,
  email: settings.DEMO_USER_EMAIL.toLowerCase(),
  password: settings.DEMO_USER_PASSWORD,
};
const REFRESH_TOKEN = "layout-check-refresh";
const WEEK = 7 * 24 * 3600;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function userJson() {
  return {
    id: USER.id,
    aud: "authenticated",
    role: "authenticated",
    email: USER.email,
    email_confirmed_at: "2026-01-01T00:00:00Z",
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

// Shaped like a JWT because supabase-js decodes the middle part to read "exp".
function makeToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: USER.id,
    email: USER.email,
    aud: "authenticated",
    role: "authenticated",
    aal: "aal1",
    iat: now,
    exp: now + WEEK,
    session_id: "layout-check-session",
  };
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.local-unsigned`;
}

function userFromToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (payload.sub === USER.id && payload.exp > Date.now() / 1000) return userJson();
  } catch {
    // not one of our tokens
  }
  return null;
}

function session() {
  return {
    access_token: makeToken(),
    token_type: "bearer",
    expires_in: WEEK,
    expires_at: Math.floor(Date.now() / 1000) + WEEK,
    refresh_token: REFRESH_TOKEN,
    user: userJson(),
  };
}

// Only pages served from this machine may call the stub from a browser.
const isLocalOrigin = (origin) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || "");

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const origin = req.headers.origin;
  const cors = isLocalOrigin(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-headers": req.headers["access-control-request-headers"] || "*",
        "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
        vary: "origin",
      }
    : {};
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(body === undefined ? "" : JSON.stringify(body));
  };
  // The log has the method and the path only, never a request body.
  console.log(new Date().toISOString(), req.method, url.pathname + url.search);
  if (req.method === "OPTIONS") return send(204);
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      // treated as an empty body
    }
    if (req.method === "GET" && url.pathname === "/layout-check/health") {
      return send(200, { stub: "layout-check", userId: USER.id });
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const ok = String(body.email || "").toLowerCase() === USER.email && body.password === USER.password;
        if (ok) return send(200, session());
        return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      }
      if (grant === "refresh_token" && body.refresh_token === REFRESH_TOKEN) return send(200, session());
      return send(400, { code: 400, error_code: "bad_request", msg: "unsupported grant" });
    }
    if (req.method === "GET" && url.pathname === "/auth/v1/user") {
      const header = req.headers.authorization || "";
      const user = userFromToken(header.startsWith("Bearer ") ? header.slice(7) : "");
      return user ? send(200, user) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (req.method === "POST" && url.pathname === "/auth/v1/logout") return send(204);
    return send(404, { code: 404, msg: "not handled by the layout check sign-in stub" });
  });
});

server.on("error", (err) => {
  console.error(`The sign-in stub could not listen on 127.0.0.1:${port}: ${err.message}`);
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.log(`Layout check sign-in stub on http://127.0.0.1:${port} for ${USER.email}`);
});
