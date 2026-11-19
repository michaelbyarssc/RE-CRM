// T1. Signed-out sweep: every API route and method answers 401 with a JSON
// error, with no body and with an empty JSON body. Routes are discovered from
// the file system, so a new route is covered automatically.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { discoverRoutes } from "./helpers/routes.mjs";
import { reseed, closeDb } from "./helpers/db.mjs";

before(reseed);
after(closeDb);

const routes = discoverRoutes();

test("T1 found the API routes", () => {
  assert.ok(routes.length >= 20, `found ${routes.length} route files`);
});

for (const route of routes) {
  for (const method of route.methods) {
    test(`T1 signed out: ${method} ${route.template} returns 401 JSON`, async () => {
      const variants = method === "GET" || method === "HEAD" ? [undefined] : [undefined, {}];
      for (const body of variants) {
        const res = await api(route.path, { method, body });
        const label = `${method} ${route.path} body=${body === undefined ? "none" : "{}"}`;
        assert.equal(res.status, 401, `${label}: got ${res.status} ${res.text.slice(0, 200)}`);
        if (method !== "HEAD") {
          assert.ok(res.json && typeof res.json.error === "string", `${label}: JSON error field`);
        }
      }
    });
  }
}

test("T1 signed out: the sequence processor needs a secret", async () => {
  const res = await api("/api/sequences/process", { method: "POST" });
  assert.equal(res.status, 401, `POST: ${res.status}`);
  // No GET handler (no schedule, addendum 1): GET is refused, never a 2xx.
  const get = await api("/api/sequences/process");
  assert.equal(get.status, 405, `GET: ${get.status}`);
});

test("T1 signed out: the Google callback answers 401, even with a code", async () => {
  const res = await api("/api/calendar/google/callback?code=abc&state=xyz");
  assert.equal(res.status, 401);
  assert.equal(res.json?.error, "Unauthorized");
});
