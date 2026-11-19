// Preloaded into the app under test (NODE_OPTIONS=--require ...).
// Blocks every outbound fetch to a host that is not local, and writes the
// attempted URL to TEST_NETWORK_LOG so tests can check whether the app tried
// to call Google or the geocoder. Nothing ever leaves this machine.
"use strict";

// getBuiltinModule instead of require, so the lint rule for require() stays on.
const fs = process.getBuiltinModule("node:fs");

const LOCAL = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const logFile = process.env.TEST_NETWORK_LOG;
const realFetch = globalThis.fetch;

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
      const method = (init && init.method) || (input && input.method) || "GET";
      if (logFile) {
        fs.appendFileSync(logFile, JSON.stringify({ at: Date.now(), method, url: href }) + "\n");
      }
      throw new TypeError(`Outbound network disabled in tests: ${method} ${host}`);
    }
    return realFetch.call(this, input, init);
  };
}
