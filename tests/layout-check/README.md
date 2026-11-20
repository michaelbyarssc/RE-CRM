# Layout check

This tool takes pictures of every main screen of the app at nine screen widths and measures the layout. It can compare two versions of the app, so you can see what a layout change fixed and what it broke.

It is not a test. It is not part of `npm test`, and nothing in it runs by itself. You run it by hand when you change how a screen looks.

- `capture.mjs` signs in to a local copy of the app, opens every main screen, takes pictures, and counts the problems it can measure: text that is cut, boxes that scroll sideways, things that spill out of their box, and lone last words. It also measures a list of named spots, such as the leads table, the side menu email and the calendar month.
- `compare.mjs` puts two runs side by side. It lists what is new, what is gone, and which checks give another answer.

One design rule goes with this tool: text is never made smaller than 16 px to make something fit. Fix the layout (let the text wrap, give it room, change the shape). The tool does not check text sizes, so this rule is yours to keep.

## Safety rules

Everything here is local. Keep it that way.

1. Never point any part of this tool at the live site, the live database, Supabase or Vercel.
2. The tool takes its settings from one local file, `tests/layout-check/out/settings.env`. It does not read `DATABASE_URL` or any other app setting from your shell.
3. The seed empties every app table before it inserts its rows. It refuses a database that is not local (127.0.0.1 or localhost) or whose name does not start with `recrm_layout`. It also asks the connected server for its name and address before it changes anything. `serve.mjs` refuses the same databases.
4. The capture only accepts an app address on 127.0.0.1 or localhost. Its browser blocks every request to any other host. It also blocks every call to the app that is not a GET (the `/api/` routes and server actions), so a run cannot change saved data.
5. `serve.mjs` starts the app with an environment that it makes itself: the local database, the local sign-in stub, and nothing from your shell except `PATH` and `HOME`. It refuses a checkout that holds a `.env` file, because Next.js would load it. The server also runs with the network guard of the test suite (`tests/helpers/no-network.cjs`), so the app itself cannot call a host that is not local.
6. Never run `npm test` against the layout check database, and never put the test database (`recrm_test`) in the settings file. The tests delete and rebuild the tables of their database.
7. Never commit anything from `tests/layout-check/out/`. The `.gitignore` in this folder keeps it out of git. The settings file holds a database password and a sign-in password. `setup.sh` makes them up on your machine.
8. Never add the privacy page or the terms page to the capture. They print a real contact email, and it must not end up in a picture.
9. All the data is made up (see the top of `seed.mjs`): people, companies, street names, phone numbers and emails. Only the town names and zip codes are real places. Keep it that way when you add rows: no real person, street address, phone number, email or deal. This repository is public.

## What it needs

- Node, and the app's packages (`npm ci`).
- A local Postgres 16 that is installed the Debian way (`pg_lsclusters`, `pg_ctlcluster`), as in Claude cloud sessions. It is the same server that `npm run test:db-setup` uses. The layout check gets its own database on it.
- Playwright with Chromium, available to Node. Playwright is not a dependency of this app on purpose. Do not add it to `package.json`. In Claude cloud sessions it is installed for the whole machine and Node finds it through `NODE_PATH`. To check, run `node -e "require('playwright')"`: it must print nothing. The tool has only been run in Claude cloud sessions. On another machine, install Playwright outside the app and make it visible to Node through `NODE_PATH`; that way was not tried.
- Free ports: one for each copy of the app that you serve (the examples use 3110 and 3111), and 54400 for the sign-in stub. Do not use 3100, 3101 or 3102: `npm test` uses them unless `TEST_APP_PORT` is set.

## One-time set-up

Run every command in this file from the top folder of the checkout.

```bash
npm ci
bash tests/layout-check/setup.sh
node tests/layout-check/seed.mjs
```

`setup.sh` does four things. It starts the local Postgres server when it is down. It writes the settings file `tests/layout-check/out/settings.env` with passwords that it makes up. It makes the database `recrm_layout_check` and a login role with the same name. It creates the app's tables in that database. You can run it again: it keeps the settings file and repairs the rest.

`seed.mjs` empties the app tables of that database and inserts the made-up data: 60 leads, 7 tags, 31 notes, 8 buyers, 16 calendar events in November and December 2026, and 3 sequences. The rows are the same every time. Run it again before a comparison when something changed the data.

Options for `setup.sh` (environment variables, only used when it writes a new settings file):

| Variable | Default | What it is |
| --- | --- | --- |
| `LAYOUT_CHECK_DB` | `recrm_layout_check` | Name of the database and its role. It must start with `recrm_layout`. |
| `LAYOUT_CHECK_STUB_PORT` | `54400` | Port of the sign-in stub. |
| `LAYOUT_CHECK_EMAIL` | `owner.demo@example.com` | The made-up sign-in user. It shows in the side menu. |

Every script also reads these two:

| Variable | Default | What it is |
| --- | --- | --- |
| `LAYOUT_CHECK_OUT` | `tests/layout-check/out` | The output folder: pictures, reports, logs and the settings file. |
| `LAYOUT_CHECK_SETTINGS` | `<output folder>/settings.env` | The settings file. |

`settings.example.env` shows what the settings file looks like. You do not need to copy it.

## Check one checkout

```bash
node tests/layout-check/serve.mjs start --port 3111
node tests/layout-check/capture.mjs http://127.0.0.1:3111 after
```

`serve.mjs start` builds the checkout (`next build`) and serves the build on 127.0.0.1 (`next start`). It starts the sign-in stub when it is not running. The build takes up to a minute. The capture takes about three minutes and prints the counts for each width when it ends.

Then read `tests/layout-check/out/reports/detector-after.md` and look at the pictures in `tests/layout-check/out/shots/after/`.

## Take a "before" and an "after", and compare them

"After" is the checkout you work in. "Before" is a second checkout of the commit you compare with, most often `main`. Both run at the same time on two ports. They share the database and the sign-in stub. The "before" checkout does not need to contain this tool.

```bash
# 1. A second checkout for "before" (one time; run "git fetch origin" first when your copy of main is old)
git worktree add --detach ../re-crm-before origin/main
(cd ../re-crm-before && npm ci)

# 2. Build and serve both
node tests/layout-check/serve.mjs start --port 3110 --dir ../re-crm-before
node tests/layout-check/serve.mjs start --port 3111

# 3. Put the data back to its start, then capture each one
node tests/layout-check/seed.mjs
node tests/layout-check/capture.mjs http://127.0.0.1:3110 before
node tests/layout-check/capture.mjs http://127.0.0.1:3111 after

# 4. Compare
node tests/layout-check/compare.mjs before after

# 5. Stop everything
node tests/layout-check/serve.mjs stop --port 3110
node tests/layout-check/serve.mjs stop --port 3111
node tests/layout-check/serve.mjs stub-stop
```

After you change the code of the "after" checkout: stop its server, start it again (this builds again), capture again, compare again.

Good to know:

- `node tests/layout-check/serve.mjs status` shows what is running.
- Never build a checkout while a server serves from it: the server would serve a build that is half replaced. `serve.mjs` refuses to do that. `npm run build` and `npm test` in that checkout do the same harm, so stop the layout server of that checkout first.
- `--no-build` serves the last build again without a new build.
- The address of the sign-in stub and the address of the app are built into the app. After you change `AUTH_STUB_PORT` in the settings file, build again.
- `setup.sh` creates the tables of the checkout you run it from. If "before" and "after" need different tables, the comparison needs care.
- To look at a served copy yourself, open its address in a browser on the same machine and sign in with `DEMO_USER_EMAIL` and `DEMO_USER_PASSWORD` from the settings file.

Where the files go (inside the output folder):

| What | Where |
| --- | --- |
| Whole screens and close-ups | `shots/<label>/` |
| Everything that was measured | `reports/detector-<label>.json` and `.md` |
| The comparison | `reports/compare-<before>-vs-<after>.md` |
| Build logs, server logs, what the app server tried to call | `logs/` |
| The settings | `settings.env` |

To remove everything: stop the servers and the stub, run `bash tests/layout-check/setup.sh drop` (it drops the database, its role and the settings file), and delete `tests/layout-check/out/`. Remove the second checkout with `git worktree remove ../re-crm-before`.

## How to read the comparison

`compare.mjs` prints a short result and writes the full report. The report has these parts:

- **Result.** One line when the two runs are the same. Otherwise four numbers.
- **1. Counts per width.** Each cell is before / after, for clipped text, sideways scroll, spills and lone last words. Lower is better. The extra widths only run some views, so compare their counts only with each other.
- **2. New in after.** Problems that are in "after" and not in "before". This is the list that matters most. It must be empty, or you must be able to explain each line.
- **3. Gone in after.** What the change fixed.
- **4. In both.** Old findings. Some are meant (a board that scrolls sideways). Each line is `width: view | kind | start of the text`.
- **5. Checks that give another answer.** The named spots that changed. A word in capitals (CUT, OUTSIDE, YES, HIDDEN, SPILLS) marks something wrong.
- **6. Checks that give the same answer.**
- **7. Run notes.** Blocked calls and warnings. A run with warnings did not measure everything: fix the cause and run again.

"n/a" means that the check did not run at that width in that run. For example, the leads table check is "n/a" at 768, because the leads are cards there.

Always look at the pictures too. The numbers do not see everything (see below).

To check the tool itself, capture the same build twice and compare the two runs. They must be the same:

```bash
node tests/layout-check/capture.mjs http://127.0.0.1:3111 first
node tests/layout-check/capture.mjs http://127.0.0.1:3111 second
node tests/layout-check/compare.mjs first second --expect-same
```

### What `main` showed on 2026-11-20

Measured on `main` at 814c83d, with the seed of that day. Use it to tell old findings from new ones.

| Width | Clipped text | Sideways scroll | Spills | Lone last words |
| --- | --- | --- | --- | --- |
| 1440 | 0 | 2 | 0 | 0 |
| 1280 | 0 | 2 | 0 | 0 |
| 768 | 2 | 3 | 0 | 0 |
| 390 | 4 | 1 | 0 | 1 |
| 1425, 1265, 1024, 375, 360 | 0 | 0 | 0 | 0 |

These 15 findings were left on purpose:

- Pipeline board, sideways scroll at 1440, 1280 and 768. A board is meant to scroll.
- Import page, the column mapping: sideways scroll at all four main widths, and the column name "Property Address" is cut at 390. The mapping row is wider than a phone.
- Skip Trace table, sideways scroll at 768.
- Dashboard at 768: the second line of each upcoming event ("Lead: ...") is cut with three dots. Two of them are in view. They are events of 24 November 2026, so the list changes after that day.
- Calendar week view at 390: three cut texts. Seven days do not fit on a phone.
- Sequences heading "Follow-up Sequences" at 390: a two-word heading on two lines.

The leads heading must say "Leads (60)", and the paging bar must show "Page 1 of 2" on one row.

## The nine widths

| Width x height | Stands for | Views |
| --- | --- | --- |
| 1440 x 900 | Desktop or large laptop | All |
| 1280 x 800 | Small laptop | All |
| 768 x 1024 | Tablet, upright | All |
| 390 x 844 | Phone | All |
| 1425 x 900 | 1440 with a visible scrollbar | Buyers, leads |
| 1265 x 800 | 1280 with a visible scrollbar | Buyers, leads |
| 1024 x 768 | Tablet on its side | Buyers, leads |
| 375 x 812 | Small phone | Login, settings, dialer, leads |
| 360 x 780 | Smaller phone | Login, settings, dialer, leads |

Why 1425 and 1265: the capture browser draws no scrollbar, so a page gets the full width of the window. On Windows, and on Linux with a mouse, the scrollbar takes 15 px from the page. A window of 1440 px then leaves 1425 px for the page. A table that just fits at 1440 is cut at 1425, or starts to scroll sideways. The leads table and the buyers table are the widest things in the app, so they also run at these two widths.

Every picture is taken at double sharpness, in the dark color scheme, in the time zone America/New_York, with the browser clock fixed at 20 November 2026, 12:00.

## What the detector counts

On every view, at every width:

- **Clipped text.** A box whose content is wider than the box, and that hides the rest or shows three dots.
- **Sideways scroll.** A box that scrolls sideways because its content is wider. A sideways scroll of the whole page has its own row.
- **Spills.** A button, a link, a select box or another part of a component whose content is wider than itself and is not hidden. The content then runs over what is next to it.
- **Lone last word.** A heading, a card title, a card description or a short paragraph (under 120 characters) on two or more lines, where the last line has one word.
- **Field hints that are cut.** The grey hint in an empty field, when it is wider than the field. They are saved for every view. The report has rows for the settings screen.
- **A button inside a button.** This is invalid, and browsers handle it badly.
- **Console errors** of the page. Blocked map tiles are not counted.

The counts only hold what is in view, which means on the first screenful of the page. Findings further down are saved in the JSON file with `inViewport: false`.

The named checks each look at one spot. They scroll to it, measure it and take a close-up. `report-rows.mjs` has the full list.

## What the detector cannot see

- Whether a screen looks good. Uneven gaps, bad alignment, a button that dropped to the next line, and two things that overlap are not counted unless a named check covers that spot.
- Text that is cut in height. Only widths are compared.
- Anything below the first screenful, for the counts.
- States it does not open: hover, most menus and dialogs (it opens Add Lead and Log Call), and error messages (`loadfail.mjs` shows two of them).
- Other browsers. It runs Chromium only. Safari and Firefox wrap text in another way.
- Real data. The seed has names of 8 to 29 characters, addresses of 14 to 28 characters and at most 3 tags for a lead. A longer name can still break a screen.
- The map itself. The map tiles are blocked, so the map is an empty background with pins.

## Known limits

- **The dashboard uses the server clock.** The browser clock is fixed, but the "Upcoming Events" list on the dashboard is made by the server with the real date. The seed's events end on 9 December 2026. After that day the list is empty. Before that day the list changes from day to day. A "before" and an "after" of the same day still compare well. To move the dates, change `EVENTS` in `seed.mjs`, `FIXED_TIME` in `lib.mjs` and the dates in the calendar part of `capture.mjs` together. The app server runs in the time zone UTC.
- **Map tiles are blocked.** The browser may only call the local app, so the tile servers (`tile.openstreetmap.org`) are blocked. The report lists the blocked hosts. This is expected.
- **The sign-in wait.** The script must not type into the login form before the page's code has taken over the form, or the typed values are wiped. So it waits until the form is live, types, checks that the values are still there, and then presses Sign In. It tries three times, 30 seconds each. If a run still fails at sign-in, check with `serve.mjs status` that the stub and the server are running, and run it again. The wait looks for a mark that React puts on the form (`__reactProps`). If a new React version changes that mark, the run prints "the login form never became live" and goes on after 30 seconds.
- **A failed capture writes no report.** It also deletes the old report with the same label when it starts, so an old report cannot be taken for a new one.
- **The views wait for text from the seed.** For example, the pipeline view waits for "Marcus Whitfield". When you change the seed, change `ready` in `VIEWS` (`capture.mjs`) too.
- **Two calls get a made-up answer in the browser.** The dialer's "Save Call Log" is answered with a made-up success, so that a toast shows. It never reaches the app, and the report counts it. The settings are fetched as usual and then changed in the browser to look as if keys were saved.
- **One run is about 250 pictures and 35 MB.** Delete old labels in `out/shots/` when you do not need them.
- `setup.sh` only knows the Debian way to run Postgres. On another machine you would make a local database whose name starts with `recrm_layout` by hand, write the settings file from `settings.example.env`, and create the tables with `npm run db:migrate`. That way was not tried.

## More commands

```bash
# Only some views (login is a view too)
node tests/layout-check/capture.mjs http://127.0.0.1:3111 leads-only --views login,leads

# Preview another base text weight. The app's base weight is 600, set in app/globals.css.
node tests/layout-check/capture.mjs http://127.0.0.1:3111 weight-500 --weight 500

# The "could not be loaded" messages of the leads and buyers screens, at 1440 and 390
node tests/layout-check/loadfail.mjs http://127.0.0.1:3111 after
```

`--weight` adds one style rule to every page, which acts like changing the number in `app/globals.css`. The report names the weight it saw on the page.

`loadfail.mjs` answers the list request inside the browser with an error, so the app shows its own message. It checks that the message and the "Try again" button are drawn, inside the page and not cut, and that "Try again" brings the list back. It writes `reports/loadfail-<label>.json` and pictures named `loadfail-*.png`.

## How to add a check for a new screen

1. Add the screen to `VIEWS` in `capture.mjs`, for example `{ name: "reports", path: "/reports", ready: "main >> text=Some text from the seed" }`. `ready` is something that is only on the page once its data has loaded. The screen now gets whole pictures and the counts at the four main widths. To run it at an extra width too, add its name to `only` in `EXTRA_WIDTHS`.
2. If the screen needs data, add made-up rows to `seed.mjs`. Use fixed values, nothing random and nothing real.
3. For a named spot, write a function in `detector.mjs`. It runs inside the page, it only reads the page, and it returns plain data. Call it from `viewSpots` in `capture.mjs` under a `case` for your view, and take a close-up with `crop`. The dashboard case is a short example.
4. Add a row for it to `summaryRows` in `report-rows.mjs`. Write a bad state in capitals. `compare.mjs` picks the row up by itself.
5. Capture the same build twice and run `compare.mjs first second --expect-same`. A check that gives two answers for the same build is not a check.
6. Run `npm run lint`. It checks these files too.

## The files

| File | What it is |
| --- | --- |
| `README.md` | This file. |
| `setup.sh` | One-time set-up: local database, settings file, tables. `drop` removes them. |
| `settings.example.env` | What the settings file looks like, with dummy values. |
| `seed.mjs` | The made-up data. |
| `auth-stub.mjs` | A local stand-in for Supabase sign-in, so the real login page works. One made-up user. |
| `serve.mjs` | Builds and serves a checkout on a port, stops it, and starts and stops the stub. |
| `capture.mjs` | The pictures and the measurements: views, widths and close-ups. |
| `detector.mjs` | The measuring functions that run inside the page. |
| `report-rows.mjs` | Turns the measurements into the rows of the reports. |
| `compare.mjs` | Compares two runs. |
| `loadfail.mjs` | The "could not be loaded" check. |
| `lib.mjs` | Shared parts: paths, settings, the safety checks, the locked-down browser, sign-in. |
| `.gitignore` | Keeps `out/` and any settings file out of git. |

Every script is Node. Only `setup.sh` is bash, like `tests/db-bootstrap.sh`, because it must run commands as the `postgres` system user.

Not included: the script that made side-by-side pictures of three text weights for one decision in November 2026. `capture.mjs --weight` gives the same preview, with numbers. The small one-time probe scripts of that job are not included either.
