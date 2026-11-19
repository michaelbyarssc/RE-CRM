// T16. The privacy and terms pages can be read signed in and signed out.
// Only the login page sends a signed-in user on to the dashboard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { USERS } from "./helpers/db.mjs";

for (const path of ["/privacy", "/terms"]) {
  test(`T16 ${path} answers 200 signed out and signed in`, async () => {
    const out = await api(path);
    assert.equal(out.status, 200, `signed out: ${out.status} ${out.location ?? ""}`);
    const signedIn = await api(path, { user: USERS.A });
    assert.equal(signedIn.status, 200, `signed in: ${signedIn.status} ${signedIn.location ?? ""}`);
  });
}

test("T16 a signed-in user who opens /login is sent to the dashboard", async () => {
  const res = await api("/login", { user: USERS.A });
  assert.ok(res.status >= 300 && res.status < 400, `${res.status}`);
  assert.equal(new URL(res.location, "http://x").pathname, "/");
});
