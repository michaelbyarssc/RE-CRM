// T23. A failed save does not write request values into the server log
// (from review finding F-LOW-ERRORS). The log keeps a safe summary only.
//
// A NUL character in a text value makes Postgres reject the statement, which
// gives a real 500. The runner writes the app's output to tests/.output/app.log
// as it arrives.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, USERS } from "./helpers/db.mjs";

const A = USERS.A;
const LOG = path.join(process.env.TEST_REPO_ROOT, "tests", ".output", "app.log");

before(reseed);
after(closeDb);

function logText() {
  return readFileSync(LOG, "utf8");
}
async function logAfter(startLength, needle) {
  for (let i = 0; i < 40; i++) {
    const text = logText().slice(startLength);
    if (text.includes(needle)) return text;
    await new Promise((r) => setTimeout(r, 100));
  }
  return logText().slice(startLength);
}

const CASES = [
  {
    label: "settings save",
    path: "/api/settings",
    marker: () => `SECRETTOKEN${randomBytes(6).toString("hex")}`,
    // Secrets are encrypted before the database sees them, so a NUL in one no
    // longer fails; the public phone number is still stored as typed.
    body: (m) => ({ twilio_phone_number: `${m}\u0000` }),
  },
  {
    label: "lead create",
    path: "/api/leads",
    marker: () => `PERSONALDATA${randomBytes(6).toString("hex")}`,
    body: (m) => ({ firstName: `${m}\u0000`, lastName: "Logcheck", propertyAddress: `${m} Road` }),
  },
];

for (const c of CASES) {
  test(`T23 a failed ${c.label} answers a generic 500 and its values never reach the log`, async () => {
    const marker = c.marker();
    const start = logText().length;
    const res = await api(c.path, { method: "POST", user: A, body: c.body(marker) });
    assert.equal(res.status, 500, res.text.slice(0, 200));
    assert.deepEqual(res.json, { error: "Internal server error" });
    assert.ok(!res.text.includes(marker));

    const logged = await logAfter(start, `POST ${c.path}`);
    assert.ok(logged.includes(`POST ${c.path}`), `safe summary with method and path is logged: ${logged.slice(0, 500)}`);
    assert.match(logged, /22021/, "the Postgres error code is logged");
    assert.ok(!logged.includes(marker), `the request value leaked into the log: ${logged.slice(0, 800)}`);
    assert.doesNotMatch(logged, /params:/i, "no query parameters in the log");
    assert.doesNotMatch(logged, /Failed query/i, "no Drizzle message in the log");
  });
}
