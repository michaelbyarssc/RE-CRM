// T99. Runs last, so it sees every response of the suite. No response body,
// Location header or Set-Cookie header may contain a dummy secret (every one
// carries the ZZSECRET marker), the run's encryption key, the stored form of
// an encrypted value, or a stack trace. T14 has the same stack check,
// but it runs before the secret tests.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MARKER, testKey } from "./helpers/secrets.mjs";

function responses() {
  return readFileSync(process.env.TEST_RESPONSE_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Body, Location and Set-Cookie of one logged response, as one text. */
function everything(r) {
  assert.ok("location" in r && Array.isArray(r.setCookies), "the response log records headers");
  return [r.body, r.location || "", ...r.setCookies].join("\n");
}

test("T99 no response body or header in the whole suite contains a dummy secret, the key or a stored encrypted value", () => {
  const all = responses();
  assert.ok(all.length > 100, `only ${all.length} responses were logged`);
  assert.ok(all.some((r) => r.location), "redirects were logged with their Location");
  assert.ok(all.some((r) => r.setCookies.length), "Set-Cookie headers were logged");
  const key = testKey();
  const offenders = all
    .filter((r) => {
      const text = everything(r);
      return text.includes(MARKER) || text.includes(key) || /enc:v\d+:/.test(text);
    })
    .map((r) => `${r.method} ${r.path.split("?")[0]} ${r.status}`);
  assert.deepEqual(offenders, []);
});

test("T99 no response in the whole suite contains a stack trace", () => {
  const offenders = responses()
    .filter((r) => /"stack"\s*:/.test(r.body) || /\n\s+at .+\(.+:\d+:\d+\)/.test(r.body))
    .map((r) => `${r.method} ${r.path.split("?")[0]} ${r.status}`);
  assert.deepEqual(offenders, []);
});
