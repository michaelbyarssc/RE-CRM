// Preloaded into the app under test (NODE_OPTIONS=--require ...).
// Blocks every outbound fetch to a host that is not local, and writes the
// attempted URL to TEST_NETWORK_LOG so tests can check whether the app tried
// to call Google or the geocoder. Nothing ever leaves this machine.
//
// Each log line also carries hashes, never raw values: authHash is the
// SHA-256 of the Authorization header, bodyHashes maps each top-level string
// value of a JSON body to its SHA-256. Tests compare them with the hash of
// the value they expect.
//
// Opt-in stand-in for Google's token endpoint only
// (POST https://oauth2.googleapis.com/token): when the file named by
// TEST_GOOGLE_STUB_FILE exists, its JSON maps a grant_type to the JSON answer,
// for example {"refresh_token": {"access_token": "...", "expires_in": 3600}}.
// A grant_type with no answer gets 400 invalid_grant. With no file (the
// default) the call is blocked like every other one.
"use strict";

// getBuiltinModule instead of require, so the lint rule for require() stays on.
const fs = process.getBuiltinModule("node:fs");
const crypto = process.getBuiltinModule("node:crypto");

const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const logFile = process.env.TEST_NETWORK_LOG;
const stubFile = process.env.TEST_GOOGLE_STUB_FILE;
const realFetch = globalThis.fetch;

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function authorizationOf(input, init) {
  try {
    const headers = new Headers((init && init.headers) || (input && typeof input === "object" && input.headers) || {});
    return headers.get("authorization");
  } catch {
    return null;
  }
}

function jsonBodyOf(init) {
  const body = init && init.body;
  if (typeof body !== "string") return null;
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stubAnswers() {
  if (!stubFile) return null;
  try {
    return JSON.parse(fs.readFileSync(stubFile, "utf8"));
  } catch {
    return null;
  }
}

if (typeof realFetch === "function") {
  globalThis.fetch = async function guardedFetch(input, init) {
    let href;
    try {
      href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    } catch {
      href = String(input);
    }
    let host = "";
    try {
      host = new URL(href).hostname;
    } catch {
      // Relative URLs are local.
    }
    if (host && !LOCAL.has(host)) {
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      const auth = authorizationOf(input, init);
      const body = jsonBodyOf(init);
      const bodyHashes = {};
      if (body) {
        for (const [k, v] of Object.entries(body)) if (typeof v === "string") bodyHashes[k] = sha256(v);
      }
      let target = href;
      try {
        const u = new URL(href);
        target = u.origin + u.pathname;
      } catch {
        // keep href
      }
      const answers = method === "POST" && target === TOKEN_ENDPOINT ? stubAnswers() : null;
      const entry = { at: Date.now(), method, url: href, authHash: auth ? sha256(auth) : null, bodyHashes };
      if (answers) entry.stubbed = true;
      if (logFile) fs.appendFileSync(logFile, JSON.stringify(entry) + "\n");
      if (answers) {
        const grant = body && typeof body.grant_type === "string" ? body.grant_type : "";
        const answer = Object.prototype.hasOwnProperty.call(answers, grant) ? answers[grant] : null;
        return new Response(JSON.stringify(answer || { error: "invalid_grant" }), {
          status: answer ? 200 : 400,
          headers: { "content-type": "application/json" },
        });
      }
      throw new TypeError(`Outbound network disabled in tests: ${method} ${host}`);
    }
    return realFetch.call(this, input, init);
  };
}
