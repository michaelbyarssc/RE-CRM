// T20. One settings request cannot store an unlimited number of keys
// (review finding F-DOS-SETTINGS): at most 50 keys, and strict names.

import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";
import { reseed, closeDb, db, USERS } from "./helpers/db.mjs";

const A = USERS.A;
beforeEach(reseed);
after(closeDb);

async function settingRows() {
  const [{ n }] = await db()`SELECT count(*)::int AS n FROM settings WHERE user_id = ${A.id}`;
  return n;
}
function keys(n, prefix = "k") {
  return Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, "v"]));
}

test("T20 51 keys in one request get 400 and nothing is stored", async () => {
  const before = await settingRows();
  const res = await api("/api/settings", { method: "POST", user: A, body: keys(51) });
  assert.equal(res.status, 400, res.text.slice(0, 200));
  assert.equal(await settingRows(), before);
});

test("T20 20,000 keys get 400 quickly and nothing is stored", async () => {
  const before = await settingRows();
  const res = await api("/api/settings", { method: "POST", user: A, body: keys(20000), timeoutMs: 20_000 });
  assert.equal(res.status, 400, res.text.slice(0, 200));
  assert.ok(res.ms < 5000, `took ${res.ms} ms`);
  assert.equal(await settingRows(), before);
});

test("T20 exactly 50 keys still work", async () => {
  const before = await settingRows();
  const res = await api("/api/settings", { method: "POST", user: A, body: keys(50) });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.equal(await settingRows(), before + 50);
});

test("T20 setting names must be letters, digits, _ . - and 1 to 100 characters, not starting with _", async () => {
  for (const name of ["has space", "a/b", "semi;colon", "x".repeat(101), "_reserved", "naïve", "tab\tname", "quote'"]) {
    const res = await api("/api/settings", { method: "POST", user: A, body: { [name]: "v" } });
    assert.equal(res.status, 400, `${JSON.stringify(name)}: ${res.status}`);
  }
  const ok = await api("/api/settings", {
    method: "POST",
    user: A,
    body: { "a.b-c_d9": "v", ["x".repeat(100)]: "v", Z: "v" },
  });
  assert.equal(ok.status, 200, ok.text.slice(0, 200));
});

test("T20 the keys the settings page sends still save and read back", async () => {
  const skip = { reiskip_api_key: "r1", batchskiptracing_api_key: "b1", skipengine_api_key: "s1" };
  const twilio = { twilio_account_sid: "AC1", twilio_auth_token: "t1", twilio_phone_number: "+15550100" };
  for (const body of [skip, twilio]) {
    const res = await api("/api/settings", { method: "POST", user: A, body });
    assert.equal(res.status, 200, res.text.slice(0, 200));
  }
  // Saving again with empty values (what the page sends for a blank field) still works.
  assert.equal((await api("/api/settings", { method: "POST", user: A, body: { ...skip, skipengine_api_key: "" } })).status, 200);
  const got = await api("/api/settings", { user: A });
  assert.equal(got.status, 200);
  // Changed in the secrets work: GET never returns a saved key, only whether
  // it is set and its last 4 characters (null here: the test values are short),
  // and an empty value now means "keep what is saved", so skipengine_api_key
  // is still set. Only the phone number is shown in full.
  const saved = { set: true, last4: null };
  assert.deepEqual(got.json, {
    values: { twilio_phone_number: twilio.twilio_phone_number },
    secrets: {
      reiskip_api_key: saved,
      batchskiptracing_api_key: saved,
      skipengine_api_key: saved,
      twilio_account_sid: saved,
      twilio_auth_token: saved,
    },
  });
});
