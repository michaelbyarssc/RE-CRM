# Deal Desk Pro (RE CRM)

A CRM for real estate wholesalers: leads, buyers, notes, calls, sequences and a calendar that can sync with Google Calendar. Built with Next.js 16, Supabase (sign-in only) and Postgres through Drizzle.

## Environment variables

Names only. Copy `.env.example` to `.env.local` and fill in the values. Never commit real values.

| Name | What it is for |
| --- | --- |
| `DATABASE_URL` | Postgres connection string the app and the database scripts use. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL, used for sign-in. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public (anon) key, used for sign-in. |
| `NEXT_PUBLIC_APP_URL` | The site's own address, for example `https://dealdeskpro.com`. Used for the Google redirect. |
| `GOOGLE_CLIENT_ID` | Google OAuth client id for Calendar sync. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. Also signs the OAuth `state`, so no extra secret is needed. |
| `SETTINGS_ENCRYPTION_KEY` | Required to save third-party keys and to use Google Calendar. 32 random bytes in base64 that encrypt saved keys and Google tokens. See "Saved keys and tokens" below. Keep a safe copy: losing it makes every saved key unreadable. |
| `CRON_SECRET` | Optional. At least 16 characters. Lets a trusted caller run every user's due sequence steps with `POST /api/sequences/process` and `Authorization: Bearer <CRON_SECRET>`. Without it, that path is off. Nothing calls it on a schedule today. |

## Run the app

```bash
npm ci
npm run dev
```

## Database commands

Both scripts read `DATABASE_URL` and print the host and database before they change anything. Use Node's `--env-file` to load it:

```bash
# Create or update the schema, then apply the lockdown file (safe to run again)
node --env-file=.env.local scripts/db-migrate.mjs

# Optional: give rows that have no owner to one existing user
node --env-file=.env.local scripts/db-migrate.mjs --assign-unowned-to owner@example.com

# Make an existing user an admin (the user must have signed in once)
node --env-file=.env.local scripts/db-make-admin.mjs owner@example.com
```

If `DATABASE_URL` is already set in the shell, `npm run db:migrate` and `npm run db:make-admin -- <email>` do the same.

## Saved keys and tokens

Third-party keys saved on the settings page (Twilio, skip tracing) and the Google Calendar access and refresh tokens are encrypted in the database with AES-256-GCM. Each saved value is tied to its user and its field, so a value copied to another user or field cannot be read. The app never sends a saved key back to the browser: the settings page only learns whether a key is set and, for keys of 12 characters or more, its last 4 characters. Only `twilio_phone_number` is shown in full. Every other setting, including any added later, is treated as a secret, except names that start with `_`: those are reserved for the server (for example the Google connect marker), are never sent to the browser, and cannot be saved or cleared from it.

The encryption key:

- Create it once with `openssl rand -base64 32` and set it as `SETTINGS_ENCRYPTION_KEY`.
- Keep a copy in a password manager. If the key is lost, nobody can read the saved keys or tokens again: every user would have to re-enter their keys and reconnect Google Calendar.
- Every environment that uses the same database (for example Production and Preview in Vercel) needs the same key.
- Without the key the app fails closed: saving a key answers with a clear error and saves nothing, and Google Calendar cannot be connected or used. Nothing is ever stored in plain text instead.
- The admin-only answer of `GET /api/calendar/google?action=debug` shows the key's fingerprint (8 characters, safe to share), so you can check which key a server uses.

To rotate the key: create a new one and add it as `SETTINGS_ENCRYPTION_KEY_V2` (then `_V3` and so on next time), keeping the old variable. New values use the newest key, and every key that is present can still read. Then run the one-off script below with `--apply` (and the fingerprint of the new key, from the debug answer of a server that has it) to re-encrypt everything with the new key. After that the old variable can be removed. Keep the name `SETTINGS_ENCRYPTION_KEY_V2` exactly as it is from then on: the version number is stored with every saved value, so the app and the script look for version 2 under that name. Never rename it back to `SETTINGS_ENCRYPTION_KEY`; a renamed key looks like a missing one and nothing can be read. Spell the names exactly: any other non-empty variable whose name starts with `SETTINGS_ENCRYPTION_KEY` (for example `SETTINGS_ENCRYPTION_KEY_v2` or `SETTINGS_ENCRYPTION_KEY_OLD`) is treated as a configuration error, and the debug answer names it.

### Encrypting the keys that were saved before this change (one-off)

Keys saved before this change are still stored as plain text. The app can still read them, and it encrypts each one the next time someone saves it. The one-off script encrypts all of them at once. It only changes something when you add `--apply`. Run it only after the new version of the app is live with its `SETTINGS_ENCRYPTION_KEY`.

**1. Prepare the file `.env.local`** in the project folder on your computer. It needs two lines:

```bash
DATABASE_URL=<the live database connection string>
SETTINGS_ENCRYPTION_KEY=<the same key the live app uses>
```

- `DATABASE_URL`: copy it from the place where the live app's own `DATABASE_URL` is kept (the app's environment variables in Vercel).
- `SETTINGS_ENCRYPTION_KEY`: copy it from the password manager where you saved the key. It must be exactly the key the live app uses.
- Never commit this file. It holds the keys to the live database. Delete it when you are done. (The tests refuse to run while it exists.)

**2. Get the fingerprint of the app's key.** Sign in to the live site as an admin. In the same browser, open `/api/calendar/google?action=debug` on the live site (for example `https://dealdeskpro.com/api/calendar/google?action=debug`). Find the word `fingerprint` and note the 8 characters after it. The script never prints a fingerprint, so this page is the only place to get it.

**3. Run the steps in this order:**

```bash
# a. Dry run: shows the database, the key version and the counts. Changes nothing.
node --env-file=.env.local scripts/encrypt-existing-secrets.mjs

# b. Read the counts. "to encrypt (plain text)" is what step d will encrypt.

# c. Optional: check the fingerprint with another dry run. Changes nothing.
node --env-file=.env.local scripts/encrypt-existing-secrets.mjs --expect-fingerprint=<the 8 characters>

# d. Encrypt. Everything happens in one step: it all works, or nothing changes.
node --env-file=.env.local scripts/encrypt-existing-secrets.mjs --apply --expect-fingerprint=<the 8 characters>

# e. Last dry run. It must say "Nothing to do".
node --env-file=.env.local scripts/encrypt-existing-secrets.mjs
```

The script prints counts and row numbers only, never a key. Server-only settings (names starting with `_`, such as the Google connect marker) are never encrypted and have their own count line, which shows the names of the rows it skips; a name the app does not write itself gets a note, because such a row may hold a key that is still plain text. It is safe to run the script again.

**4. What the result means (the exit code):**

- 0: done. Nothing else to do.
- 1: the command or the setup is wrong (for example `--apply` without `--expect-fingerprint`, a fingerprint that is not 8 characters, or a missing `DATABASE_URL` or key). Nothing was changed. Read the message, fix it and run again.
- 2: the key is wrong. Either the fingerprint does not match the key in `.env.local`, or some saved keys were encrypted with a key or key version that is not in `.env.local`. Nothing was changed. Copy the key again from the password manager. If the message names a missing variable such as `SETTINGS_ENCRYPTION_KEY_V2`, add that variable with its key. The fingerprint check works on the first run too, while every saved key is still plain text.
- 3: some plain-text keys could not be encrypted because their row has no owner. The app never reads those rows. Delete them, or give them an owner with `npm run db:migrate -- --assign-unowned-to <email>`, then run the script again. That command also brings the database schema up to date and applies the lockdown file on that database, so on the live database it is a change that needs the owner's go-ahead first. Until then every run ends with 3.

With the two variables already set in the shell instead of `.env.local`, `npm run db:encrypt-secrets` is the dry run, and `npm run db:encrypt-secrets -- --apply --expect-fingerprint=<the 8 characters>` encrypts.

## Tests

The tests build the real app and call it over HTTP. They only run against a local Postgres database whose name ends in `_test`, never read `.env` files, and block every outbound network call from the app.

```bash
npm run test:db-setup   # once per machine start: starts local Postgres 16, creates the test role, database and Supabase-style roles
npm test                # build, start the app, run every test, tear down
```

Each run makes a new random `SETTINGS_ENCRYPTION_KEY`, starts one extra app server without it (to check that saving keys fails closed), and fails if any server log contains `ZZSECRET`, the marker every dummy secret in the tests carries.

Options: `TEST_DATABASE_URL`, `TEST_APP_PORT`, `TEST_AUTH_PORT`, `TEST_SKIP_BUILD=1` (reuse the last build), `TEST_FILES="tests/t05-leads.test.mjs"`.

## Screens and refused changes (2026-11-20)

A QA pass on 2026-11-19 found screens that said "saved" when the server had refused the change. This section says what a user sees now, and what rule new code must follow.

What a user sees now:

- Every save, change and delete checks the server's answer. When the server refuses, the screen shows one short message that says what did not happen and what to check, for example "Could not add the step. The delay must be a whole number of days from 0 to 3,650, and the instructions 5,000 characters or fewer." The dialog or form stays open with everything that was typed. No success message is shown, and the user can try again in the same place.
- A lost connection and an ended session get their own messages. The message for an ended session says to sign in again in a new tab, because signing in on the same tab would throw away what was typed.
- A list that cannot load no longer breaks the screen. The leads list, pipeline, skip trace, dialer, lead detail, buyers and map keep what they show and say that the data could not be loaded. The leads list and the dialer have a "Try again" button.
- The buyers screen says how many areas were left out when a buyer has more than 25 different areas. The map takes the first 25 areas of each buyer.
- The leads list remembers which leads are selected by lead, not by row position, so a bulk action that is tried again reaches the same leads.
- Dialogs scroll when a long text makes them taller than the screen, so the save button stays in reach.
- The React hydration error on the leads, pipeline, buyers, calendar and sequences screens is gone. A button that opens a dialog or a menu was written inside another button.
- Sign out loads the login page as a full page. Before, the browser logged three 404 answers for `/login?_rsc=...` after every sign out on a production build: the page refresh after sign out made the router fetch the sidebar links again for a user who was already signed out. A sign out that fails now says so and leaves the user signed in.
- After sign out, the Back button cannot bring a screen back. A browser can keep a page in memory and show it again without asking the server, also to the next person who signs in. A page with the sidebar that comes back from the browser's memory is now always loaded again from the server. The cost: a signed-in user who leaves the app by a full page load and comes back with the Back button gets a fresh page, not the kept one. Moves inside the app are not affected.
- A page with the sidebar that is shown without the sign-in cookie is loaded again from the server too. This check reads the Supabase sign-in cookie in the page, which works with the default cookie. If the cookie is ever made `httpOnly` or renamed, change `hasSignInCookie()` in `components/layout/sidebar.tsx` too, or every screen opened by a full page load (a typed address, a bookmark, a link from outside the app) loads twice. A refresh and moves inside the app are not affected, and it never loops.

The rules for new code:

- A screen sends a change with `apiFetch()` from `lib/api-fetch.ts`, written as `const res = await apiFetch(...)`, and tests `res.ok` before it shows success, closes a dialog or clears a form. `apiErrorMessage()` in the same file words the message from the status and from the server's own text.
- A button that opens a dialog or a menu goes into the trigger's `render` prop: `<DialogTrigger render={<Button />}>Label</DialogTrigger>`. Never write a `<Button>` inside a trigger.
- Two tests keep both rules. `tests/t27-screens-check-writes.test.mjs` reads every screen file and fails when a change is sent without checking the answer. `tests/t26-no-nested-buttons.test.mjs` fails when a page has a button inside a button.

How it was checked: every action was run in a real browser against the old code and the new code, with a refusal forced for each one, and then tried again. The browser scripts are not in the repository, because Playwright is not a dependency.

Found on the way and left for later:

- The calendar, sequences and settings screens still say nothing when their own list cannot load.
- A buyer with more than 25 areas cannot get the rest on the map: "Map Areas" always looks up the first 25.
- Deleting a buyer, a note, a sequence or a step that is already gone still answers "ok".
- Sign out does not end "view as" for an admin (that cookie lasts 4 hours and only counts for an admin).
- The lead id in the page address is used in requests without a check that it is a number.
- The event and quick note dialogs are narrower than the code asks for on wide screens (a class in the shared dialog wins).
- On the leads list and the dialer, a slow answer to an older search can replace the answer to a newer one.
- On the lead detail, a status or tag change while the edit form is open reloads the lead and throws away the typed edits.
- The "select all" box on the leads list shows a full check mark when only some rows are ticked.
- A `<Button>` sits inside a link on the dialer, lead detail and welcome screens. It causes no error today.
- Older help texts and comments still contain long dashes.

## Security (2026-11-19)

Findings from the audit of 2026-11-19 and their fixes:

- Any signed-in user could make themselves an admin through `POST /api/migrate`. The route is deleted. Migrations and "make admin" are command line scripts now.
- Signed-out requests to the API got errors or data instead of a clean refusal. Every route now signs the caller in first and answers 401 when nobody is signed in.
- Anyone could run every user's sequence steps through `/api/sequences/process`. It now needs a signed-in user (own steps only) or the `CRON_SECRET`.
- Google Calendar connect had no OAuth `state`. It now uses a signed, single-use state tied to the user, checked before anything else.
- Lead, sequence, step and event updates accepted any field, including the owner. They now accept only the fields a user may edit.
- Calendar events could point at another user's lead or buyer and show their details. Both are checked now, and the reads only join your own rows.
- Another user's tag could be linked to your lead and read back. Tags are checked now.
- A crafted note could freeze the server for about 100 seconds. The pattern is fixed and notes are capped at 10,000 characters.
- The `lib/actions` helpers were "use server" files. They are server-only modules now, and the build exposes no server actions.
- The Supabase public key could read and change every table (row level security was off). The lockdown file `supabase/migrations/20261119211831_lock_down_public_api.sql` turns row level security on and removes the public roles' access. It was applied to the live Supabase project on 2026-11-19 and is recorded there as migration `20261119211831_lock_down_public_api`. `npm run db:migrate` applies the same file to any other database.
- Tables created later by Supabase's own admin role still get the default public grants, so any new table needs row level security turned on (the Supabase security advisor flags it).
- Third-party keys in settings (Twilio, skip tracing) and Google tokens were stored in plain text, and every saved key was sent to the browser in full. They are encrypted now and never sent back (see "Saved keys and tokens"). The live database still holds the old plain-text values until the one-off script is run there with the owner's approval.
- Public sign-up is closed in the app: the login page has no "create account" option. The real switch is in the Supabase dashboard: Authentication settings, turn off "Allow new users to sign up". The owner then creates each customer's account there by hand.

Second review (round 2) and its fixes:

- Lead and buyer text on the map could run as script for whoever opened it (including an admin impersonating the user). Every popup and label is now built with an escaping template helper.
- The Google Calendar connect state was single use only if the browser dropped its cookie. The server now stores one pending marker per user and uses it up on the first callback; setting names starting with `_` are reserved for the server.
- The test database guard could be pointed at a non-test database with a query string in the URL. It now refuses query strings and fragments and asks the server which database and host it is on before changing anything.
- One settings save could store any number of keys. It now takes at most 50 keys per request with strict names (letters, digits, `_` `.` `-`, up to 100 characters).
- One buyer zones request could run for most of an hour. Areas are de-duplicated and at most 25 are geocoded per request; the answer says how many were skipped.
- One badly stored buyer row broke the buyers screen and the buyer zones list for that user. Saved buy criteria is now read in one place that never fails: a row that cannot be read counts as having no criteria, and the other buyers still show.
- A request body without a declared length was read in full before the size check. Bodies are now read as a stream and refused with 413 as soon as they pass 10 MB.
- Failed requests wrote request values (API keys, personal data) into the server log. The log now keeps a safe summary: method and path, error class, Postgres code, constraint, table and stack frames.
- `db-make-admin` could promote the wrong profile when two profiles share an email. It now changes nothing in that case, lists the ids and accepts `--id <user id>`.
- A large CSV import could stall the app for minutes. The duplicate check runs once per file, inserts go in batches of 500, and one import takes at most 25,000 rows.

Not covered yet (deliberately left for later):

- No rate limits: single requests are size limited (imports, settings, buyer zones, request bodies), but nothing limits how many requests a user sends.
- Geocoding has no per-user limit, which can break the geocoder's usage policy.
- No `Origin` check on requests that change data (sign-in cookies are SameSite=Lax).
- The old SQLite test files in `data/` and `supabase/.temp/` are still in the repository.
- No audit log of who impersonated whom.
- Supabase Auth leaked password protection is off (a dashboard setting).
- The lockdown file does not revoke EXECUTE on functions: the public roles could run any database function added later (there are none today).
- Two runs of the sequence processor at the same moment can add the same note twice.
- A NUL character in a text field gets a 500 instead of a 400.
- Calendar dates that are well formed but impossible (for example February 30) are not refused.
- No Content Security Policy.
- Lint reports `react-hooks/set-state-in-effect` as a warning, not an error, for 12 screens that load data when they open.
- An admin who is impersonating a user can still replace or clear that user's saved keys (they cannot see them).
- Saved values from before the encryption change are still read as plain text. Once the one-off script has run on the live database, a later change can remove that fallback and add a database check that tokens are always encrypted.
