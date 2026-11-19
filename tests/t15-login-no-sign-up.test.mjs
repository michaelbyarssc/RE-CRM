// T15. Sign-up is for paying customers only, so the login page offers no way
// to create an account. The owner creates each customer's account in the
// Supabase dashboard (see README, Security).

import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "./helpers/http.mjs";

const NOTICE = "Accounts are for Deal Desk Pro customers only.";

test("T15 the login page has no sign-up control and shows the customers-only line", async () => {
  const res = await api("/login");
  assert.equal(res.status, 200, `${res.status}`);
  const html = res.text;
  // assert.ok with a short message, so a failure does not print the whole page.
  assert.ok(/type="password"/.test(html), "it is still the sign-in form");
  assert.ok(!/sign[\s-]?up/i.test(html), "no Sign Up control");
  assert.ok(!/create (an )?account/i.test(html), "no Create Account control");
  assert.ok(html.includes(NOTICE), `shows "${NOTICE}"`);
});
