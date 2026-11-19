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

## Tests

The tests build the real app and call it over HTTP. They only run against a local Postgres database whose name ends in `_test`, never read `.env` files, and block every outbound network call from the app.

```bash
npm run test:db-setup   # once per machine start: starts local Postgres 16, creates the test role, database and Supabase-style roles
npm test                # build, start the app, run every test, tear down
```

Options: `TEST_DATABASE_URL`, `TEST_APP_PORT`, `TEST_AUTH_PORT`, `TEST_SKIP_BUILD=1` (reuse the last build), `TEST_FILES="tests/t05-leads.test.mjs"`.

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
- Public sign-up is closed in the app: the login page has no "create account" option. The real switch is in the Supabase dashboard: Authentication settings, turn off "Allow new users to sign up". The owner then creates each customer's account there by hand.

Not covered yet (deliberately left for later):

- Third-party keys in settings (Twilio, skip tracing) and Google tokens are stored in plain text and shown in full to their owner.
- No rate limits, and no size limits on bulk actions, imports or settings beyond the page size cap.
- Geocoding has no per-user limit, which can break the geocoder's usage policy.
- No `Origin` check on requests that change data (sign-in cookies are SameSite=Lax).
- The old SQLite test files in `data/` and `supabase/.temp/` are still in the repository.
- No audit log of who impersonated whom.
- Supabase Auth leaked password protection is off (a dashboard setting).
- Lint reports `react-hooks/set-state-in-effect` as a warning, not an error, for 12 screens that load data when they open.
