// Made-up, ordinary looking data for the layout screenshots.
//
//   node tests/layout-check/seed.mjs          the ordinary data
//   node tests/layout-check/seed.mjs --long   the ordinary data, then long names on top
//
// It EMPTIES every app table in the layout check database, then inserts the
// same rows every time (fixed dates, nothing random), so two runs of the
// capture measure the same screens.
//
// --long is off by default. It inserts the same rows, then gives 14 leads on
// the first page of the leads list a name of 30 to 40 characters (see
// LONG_NAMES) and gives 5 more leads a third tag (see LONG_TAGS), so 8 leads
// have three tags. Every other value stays the same: dates, statuses,
// addresses, phones and notes. Only the table of tag links gets more rows. The
// names the capture waits for ("Marcus Whitfield", "Christopher & Angela
// Martinez") and the card with the one tag "Tired Landlord" stay as they are.
// The counts in the README are for the ordinary data, so seed again without
// --long before you compare with them. Any other argument stops the script
// before it changes anything.
//
// Safety: the database comes from the local settings file only (never from
// DATABASE_URL in the environment). The script refuses a database that is not
// local or whose name does not start with recrm_layout, and it asks the
// connected server for its name and address before it changes anything.
//
// Nothing here is real. The people and the companies are invented. The phone
// numbers cannot be dialled (area code 555, and an exchange that starts with
// 0). The email addresses are on example.com, example.net and example.org.
// The street names are invented too, with ordinary lengths. Only the town
// names and the zip codes are real places, in upstate South Carolina. No row
// describes a real house, a real owner or a real deal.

import postgres from "postgres";
import { assertConnectedToLayoutDatabase, assertLayoutDatabase, needSettings, parseArgs } from "./lib.mjs";

const USAGE = "Usage: node tests/layout-check/seed.mjs [--long]";
let LONG = false;
try {
  const { options, rest } = parseArgs(process.argv.slice(2), { flags: ["long"] });
  if (rest.length) throw new Error(`Unknown argument: ${rest.join(" ")}`);
  LONG = !!options.long;
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(1);
}

let settings;
let target;
try {
  settings = needSettings(["DATABASE_URL", "DEMO_USER_ID", "DEMO_USER_EMAIL"]);
  target = assertLayoutDatabase(settings.DATABASE_URL);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const USER_ID = settings.DEMO_USER_ID;
const EMAIL = settings.DEMO_USER_EMAIL;
const sql = postgres(settings.DATABASE_URL, { max: 1, onnotice: () => {}, connect_timeout: 5 });

// Fixed "now" so every run gives the same dates.
const NOW = Date.parse("2026-11-19T20:00:00Z");
const daysAgo = (d, h = 0) => new Date(NOW - d * 86400000 - h * 3600000).toISOString();

const TAGS = [
  ["Tired Landlord", "#F59E0B"],
  ["Absentee", "#3B82F6"],
  ["Vacant", "#EF4444"],
  ["Probate", "#8B5CF6"],
  ["High Equity", "#10B981"],
  ["Inherited", "#EC4899"],
  ["Pre-Foreclosure", "#F97316"],
];

// [first, last, address, city, zip, status, tags[], note|null]
// The first four rows get the newest dates, so they lead the default sort
// (created_at DESC): Under Contract + 3 tags, only "Tired Landlord",
// Under Contract + no tag, 29 character name.
const L = [
  ["Marcus", "Whitfield", "208 Marlowick Rd", "Spartanburg", "29301", "under_contract", ["Absentee", "High Equity", "Vacant"], "Signed at 142k, closing set with title company."],
  ["Dana", "Okafor", "1417 Brackwyn Tessmoor Rd", "Spartanburg", "29307", "new", ["Tired Landlord"], "Owns three rentals, wants out of the last one."],
  ["Gloria", "Haynes", "56 Quillhaven Dr", "Boiling Springs", "29316", "under_contract", [], null],
  ["Christopher & Angela", "Martinez", "3390 Old Kessard Rd", "Boiling Springs", "29316", "in_process", ["Inherited", "Probate"], "Siblings agree to sell, waiting on probate paperwork."],
  ["Terrence", "Bell", "742 Wrenhaven Hwy", "Inman", "29349", "contacted", ["Absentee"], null],
  ["Linda", "Pruitt", "19 Brindel Farms Rd", "Woodruff", "29388", "offer_sent", ["Vacant", "High Equity"], "Sent written offer by email, follow up Friday."],
  ["Roy", "Castillo", "885 Abel T Marsh Sr Blvd", "Spartanburg", "29306", "new", [], null],
  ["Patricia", "Nguyen", "61 Osric Springs Rd", "Pauline", "29374", "hot", [], null],
  ["Benjamin & Sarah", "Thompson", "1200 Quillmere Rd", "Roebuck", "29376", "under_contract", ["Pre-Foreclosure"], "Lender approved short payoff, need repair bid."],
  ["Kevin", "Draper", "47 Dorne Springs Rd", "Spartanburg", "29302", "dead", [], null],
  ["Alicia", "Fontaine", "3011 Hallowmere Rd", "Spartanburg", "29303", "new", ["Tired Landlord", "Absentee"], "Tenant moving out at the end of January."],
  ["William", "Grady", "115 Brenlow St Ext", "Spartanburg", "29301", "contacted", [], null],
  ["Nathaniel & Grace", "Abernathy", "502 Tavorin Heights Ave", "Spartanburg", "29302", "in_process", ["Probate"], null],
  ["Sheila", "Monroe", "88 Lake Tessa Dam Rd", "Inman", "29349", "closed", ["High Equity"], "Assigned to cash buyer, fee paid."],
  ["Derrick", "Lowe", "1610 Arlow Street", "Spartanburg", "29302", "new", ["Vacant"], null],
  ["Monica", "Reyes", "240 Avondry Hwy", "Spartanburg", "29303", "offer_sent", [], "Wants 10k more than our offer."],
  ["Harold", "Kincaid", "33 Mirelow Creek Rd", "Chesnee", "29323", "under_contract", ["Inherited", "Vacant"], null],
  ["Tamara", "Jeffries", "711 Oryn Street Ext", "Spartanburg", "29302", "new", [], null],
  ["Jonathan & Rebecca", "Holloway", "2905 Highway 9", "Boiling Springs", "29316", "contacted", ["Absentee", "Tired Landlord"], "Left voicemail, try again after six."],
  ["Earl", "Sutton", "14 Kessa Street Ext", "Cowpens", "29330", "dead", ["Pre-Foreclosure"], null],
  ["Vanessa", "Coleman", "456 Winterholt Rd", "Spartanburg", "29301", "new", ["High Equity"], null],
  ["Raymond", "Ellison", "1302 Brackwyn Dr", "Spartanburg", "29307", "in_process", [], "Needs roof, asked for a repair estimate."],
  ["Diane", "Porter", "90 Fenn Street Ext", "Landrum", "29356", "new", [], null],
  ["Gregory", "Stanton", "675 Brask Blvd", "Spartanburg", "29301", "hot", ["Vacant", "Absentee", "Probate"], "Executor ready to sign this month."],
  ["Michelle", "Barrow", "23 Marlen Park Dr", "Duncan", "29334", "contacted", [], null],
  ["Anthony & Lisa", "Cavanaugh", "1888 Zellow Bridge Rd", "Boiling Springs", "29316", "under_contract", ["High Equity", "Tired Landlord"], null],
  ["Francis", "Weller", "312 Bexworth Rd", "Campobello", "29322", "new", [], "Called in from the yellow letter mailer."],
  ["Brenda", "Hollis", "48 Harlowe Campground Rd", "Spartanburg", "29307", "closed", [], null],
  ["Samuel", "Prater", "1021 Marlowick Rd", "Spartanburg", "29301", "new", ["Absentee"], null],
  ["Joyce", "McAllister", "77 Bellowyn Ave", "Wellford", "29385", "offer_sent", ["Inherited"], "Daughter handles the sale, call her cell."],
  ["Curtis", "Langley", "254 N Dain Street", "Inman", "29349", "new", [], null],
  ["Rachel", "Donovan", "3150 Marlowick Rd", "Moore", "29369", "in_process", ["Vacant"], null],
  ["Victor", "Alvarez", "65 Pellow Circle", "Spartanburg", "29303", "contacted", [], "Not ready yet, check back in spring."],
  ["Stephanie & Paul", "Underwood", "410 Corranlea Cir", "Duncan", "29334", "new", ["Pre-Foreclosure", "High Equity"], null],
  ["Douglas", "Fenwick", "1735 Wrenhaven Hwy", "Spartanburg", "29303", "dead", [], null],
  ["Carla", "Benton", "29 Hesko Street Ext", "Spartanburg", "29302", "new", [], "Motivated, relocating for work."],
  ["Wayne", "Hutchins", "604 S Varen Street", "Spartanburg", "29301", "under_contract", [], null],
  ["Lorraine", "Gaither", "1120 Avren Road", "Lyman", "29365", "contacted", ["Tired Landlord"], null],
  ["Frederick", "Osborne", "37 Ravenby Ave", "Clifton", "29324", "new", ["Absentee"], "House sits empty, owner lives in Ohio."],
  ["Heather", "Lindqvist", "819 Larks Chapel Rd", "Duncan", "29334", "hot", [], null],
  ["Timothy & Karen", "Sandoval", "2201 Old Brenlowe Mill Rd", "Moore", "29369", "in_process", ["Probate", "Inherited"], null],
  ["Arthur", "Beasley", "52 Aldermoy St", "Spartanburg", "29301", "new", [], null],
  ["Yolanda", "Pickens", "1544 Quillmere Rd", "Spartanburg", "29306", "offer_sent", ["High Equity"], "Counter came in at 118k, close to our number."],
  ["Glenn", "Whitmore", "301 Zeph Ridge Dr", "Inman", "29349", "closed", ["Vacant"], null],
  ["Erica", "Townsend", "15 Pinny Lane Ext", "Woodruff", "29388", "new", [], "Wants a quick close before the holidays."],
  ["Philip", "Rourke", "983 Sorrelby Rd", "Boiling Springs", "29316", "contacted", [], null],
  ["Janet", "Calloway", "460 Marsk Road", "Spartanburg", "29307", "new", ["Tired Landlord"], null],
  ["Lawrence", "Merritt", "71 Wessel Hill Rd", "Chesnee", "29323", "dead", [], "Sold to another investor before we called."],
  ["Nicole", "Ashby", "1209 N Varen Street", "Spartanburg", "29301", "in_process", ["Absentee"], null],
  ["Russell", "Tidwell", "38 Jessan Grove Rd", "Pauline", "29374", "new", [], null],
  ["Bernard & Louise", "Fairchild", "2640 Brackwyn Tessmoor Rd", "Spartanburg", "29307", "hot", ["High Equity", "Inherited", "Vacant"], "Ready to list if we cannot close fast."],
  ["Kendra", "Wilkins", "176 Elm Vossy Rd", "Spartanburg", "29301", "new", [], null],
  ["Howard", "Rutledge", "5 Stonewyn View Ave", "Landrum", "29356", "contacted", ["Pre-Foreclosure"], null],
  ["Sandra", "Vickery", "1350 Tolm Reve Rd", "Wellford", "29385", "offer_sent", [], "Asked for proof of funds before signing."],
  ["Clifford", "Hames", "92 Marle Hill Rd", "Inman", "29349", "new", ["Absentee"], null],
  ["Irene", "Beckett", "714 Dunmor Road", "Spartanburg", "29303", "closed", [], null],
  ["Dennis", "Kowalski", "2408 Highway 101", "Woodruff", "29388", "new", [], "Inherited from uncle, never lived there."],
  ["Paula", "Stroud", "63 Tarnwick Dr", "Boiling Springs", "29316", "in_process", ["Vacant"], null],
  ["Ronald & Cheryl", "Mabry", "1915 Old Wrenborough Hwy", "Lyman", "29365", "contacted", [], null],
  ["Theresa", "Gantt", "40 Tolby Road Ext", "Campobello", "29322", "new", ["Tired Landlord"], null],
];

// Statuses the app defines (lib/constants.ts): new, contacted, in_process,
// offer_sent, under_contract, closed, dead. The pipeline and the seed use
// those; "hot" above is not one of them, so map it to in_process.
for (const row of L) if (row[5] === "hot") row[5] = "in_process";
for (const [f, l, a, , , , tags, note] of L) {
  const n = `${f} ${l}`;
  if (n.length < 8 || n.length > 29) throw new Error(`name length ${n.length}: ${n}`);
  if (a.length < 14 || a.length > 28) throw new Error(`address length ${a.length}: ${a}`);
  if (tags.length > 3) throw new Error(`too many tags: ${n}`);
  if (note && (note.length < 30 || note.length > 80)) throw new Error(`note length ${note.length}: ${note}`);
}
if (L.length < 55) throw new Error(`only ${L.length} leads`);

// The long data set (--long only). [row of L, first name, last name]. Row 0 is
// the newest lead, so rows 1 and 2 are in the first screenful on a phone. The
// names are invented: two "two owners" names, one long hyphenated surname
// (row 2), one name that is a single word of 35 letters with no first name
// (row 4), one that ends in a short last word (row 6). Rows 0 and 3 keep their
// names because the capture looks for them. Every row is under 50, so all of
// them are on page 1 of the leads list.
const LONG_NAMES = [
  [1, "Evangeline & Montgomery", "Ashcroft"],
  [2, "Gwendolyn", "Thistlewaite-Vanderbrook"],
  [4, null, "Brackenridgewolstenholmefairweather"],
  [6, "Cornelius Augustine", "Hollingsworth Jr"],
  [8, "Anastasia Wilhelmina", "Castellanos"],
  [10, "Thaddeus Bartholomew", "Winterbourne"],
  [13, "Maximilian & Josephine", "Wetherington"],
  [17, "Prudence Evangelista", "Blackwood"],
  [21, "Florentina Margarethe", "Castellvalderrama"],
  [23, "Leopoldine Fitzgerald", "Montgomerie"],
  [27, "Seraphina Rosalinde", "Quartermaineworth"],
  [33, "Augustin Lorenzo", "Wellingborough"],
  [40, "Cordelia Henrietta", "Ravenscroftwellington"],
  [46, "Ignatius Leopold", "Throckmortonby"],
];
// Extra tags for --long, so these leads have three tags each. [row of L, tags to add]
const LONG_TAGS = [
  [4, ["Vacant", "Probate"]],
  [8, ["Inherited", "Absentee"]],
  [10, ["High Equity"]],
  [13, ["Absentee", "Probate"]],
  [33, ["Vacant"]],
];
for (const [i, first, last] of LONG_NAMES) {
  const n = [first, last].filter(Boolean).join(" ");
  if (n.length < 30 || n.length > 40) throw new Error(`long name length ${n.length}: ${n}`);
  if (i >= 50 || i === 0 || i === 3) throw new Error(`long name on row ${i}: ${n}`);
}
for (const [i, add] of LONG_TAGS) {
  const all = new Set([...L[i][6], ...add]);
  if (all.size !== 3 || add.some((t) => L[i][6].includes(t))) throw new Error(`row ${i} must end with three tags`);
}

const BUYERS = [
  ["Upstate Cash Homes", "Upstate Cash Homes LLC", "(555) 010-0201", "deals@example.com", "Spartanburg, Boiling Springs", "80k-160k", "Buys 3 to 4 a month, closes in 10 days.", true],
  ["Carl Benning", "Benning Rentals", "(555) 010-0202", "carl@example.com", "Inman, 29349", "60k-120k", "Wants rentals only.", true],
  ["Rita Okonkwo", null, "(555) 010-0203", "rita@example.com", "Duncan, Lyman", "100k-200k", null, true],
  ["Blue Ridge Flips", "Blue Ridge Flips Inc", "(555) 010-0204", "team@example.net", "Landrum", "90k-180k", "Full rehabs, likes brick ranches.", true],
  ["Greg Salters", null, "(555) 010-0205", null, "Woodruff, Moore", "50k-110k", null, false],
  ["Piedmont Holdings", "Piedmont Holdings LLC", "(555) 010-0206", "acq@example.org", "29301, 29302, 29303", "70k-150k", "Pays assignment fees fast.", true],
  ["Tanya Ruiz", null, "(555) 010-0207", "tanya@example.com", "Chesnee", "40k-90k", null, false],
  ["Hub City Investors", "Hub City Investors", "(555) 010-0208", "info@example.com", "Spartanburg County", "75k-175k", "Buys land and houses.", true],
];

const AREA_COORDS = {
  Spartanburg: [34.9496, -81.932], "Boiling Springs": [35.0465, -81.9818], Inman: [35.0468, -82.0901],
  "29349": [35.05, -82.08], Duncan: [34.9379, -82.1451], Lyman: [34.948, -82.127], Landrum: [35.175, -82.189],
  "29301": [34.94, -81.98], "29302": [34.92, -81.89], "29303": [34.99, -81.92], "Spartanburg County": [34.93, -81.99],
};

// Calendar: local time strings, as the app stores them.
const EVENTS = [
  ["Walkthrough: 208 Marlowick Rd", "appointment", "2026-11-03T09:00:00", "2026-11-03T10:00:00", 1],
  ["Call back Dana Whitfield", "callback", "2026-11-03T12:00:00", "2026-11-03T12:30:00", null],
  ["Closing: 1888 Zellow Bridge Rd", "closing", "2026-11-06T14:00:00", "2026-11-06T15:00:00", 26],
  ["Follow up with Linda Pruitt", "follow_up", "2026-11-10T09:00:00", "2026-11-10T09:30:00", 6],
  ["Walkthrough: 56 Quillhaven Dr", "appointment", "2026-11-10T12:00:00", "2026-11-10T13:00:00", 3],
  ["Call back Monica Reyes", "callback", "2026-11-10T16:30:00", "2026-11-10T17:00:00", 16],
  ["Title review with attorney", "custom", "2026-11-13T10:00:00", "2026-11-13T11:00:00", null],
  ["Walkthrough: 742 Wrenhaven Hwy", "appointment", "2026-11-18T09:00:00", "2026-11-18T10:00:00", 5],
  ["Call back Alicia Fontaine", "callback", "2026-11-18T12:00:00", "2026-11-18T12:30:00", 11],
  ["Closing: 33 Mirelow Creek Rd", "closing", "2026-11-24T11:00:00", "2026-11-24T12:00:00", 17],
  ["Follow up with Joyce McAllister", "follow_up", "2026-11-24T15:00:00", "2026-11-24T15:30:00", 30],
  ["Buyer tour with Carl Benning", "appointment", "2026-12-02T09:00:00", "2026-12-02T10:30:00", null],
  ["Call back Yolanda Pickens", "callback", "2026-12-02T12:00:00", "2026-12-02T12:30:00", 43],
  ["Closing: 604 Varen St", "closing", "2026-12-09T13:00:00", "2026-12-09T14:00:00", 37],
  // A fourth event on Nov 10 (so the month view shows "+1 more") and one all-day
  // event, stored the way the app's event form stores all-day events.
  ["Call back Roy Castillo", "callback", "2026-11-10T14:00:00", "2026-11-10T14:30:00", 7],
  ["Probate court day", "custom", "2026-12-04T00:00:00", "2026-12-04T23:59:00", null, 1],
];

const SEQUENCES = [
  ["New Lead Follow-up", "Five touches over two weeks for new leads.", [[0, "sms", "Hi {firstName}, this is about your property on {address}."], [2, "call", "Intro call"], [5, "email", "Quick follow-up on your property"], [9, "sms", "Still open to an offer?"], [14, "call", "Last check-in call"]]],
  ["Offer Sent Nudge", "Reminders after a written offer goes out.", [[1, "call", "Confirm they got the offer"], [3, "sms", "Any questions on our offer?"], [7, "email", "Offer still stands"]]],
  ["Tired Landlord Drip", "Monthly touches for landlords who are not ready.", [[0, "email", "Thinking about selling your rental?"], [30, "sms", "Checking in about {address}."], [60, "call", "Quarterly call"]]],
];

async function main() {
  // Ask the server itself, before anything is changed.
  const { database } = await assertConnectedToLayoutDatabase(sql);
  console.log(
    `Seeding the local database ${database} on ${target.host}:${target.port} (every app table is emptied first)` +
      (LONG ? ", with the long names" : "")
  );
  await sql.begin(async (tx) => {
    await tx`TRUNCATE lead_sequences, sequence_steps, sequences, lead_tags, tags, notes, call_log,
      skip_trace_results, documents, calendar_events, buyers, csv_imports, settings,
      google_calendar_tokens, leads, user_profiles RESTART IDENTITY CASCADE`;
    await tx`INSERT INTO user_profiles (id, email, full_name, role, created_at, updated_at)
      VALUES (${USER_ID}, ${EMAIL}, null, 'user', ${daysAgo(200)}, ${daysAgo(200)})`;

    const tagIds = {};
    for (const [name, color] of TAGS) {
      const [r] = await tx`INSERT INTO tags (user_id, name, color) VALUES (${USER_ID}, ${name}, ${color}) RETURNING id`;
      tagIds[name] = r.id;
    }

    // Dates: row 0 newest. Spread over about 175 days (six months).
    const leadIds = [];
    for (let i = 0; i < L.length; i++) {
      const [first, last, addr, city, zip, status, tags, note] = L[i];
      const created = daysAgo(i * 2.95, i % 5);
      const phone = i % 7 === 6 ? null : `(555) 010-${String(100 + i).padStart(4, "0")}`;
      const lat = 34.95 + ((i * 37) % 21 - 10) * 0.006;
      const lng = -81.93 + ((i * 53) % 25 - 12) * 0.008;
      const [r] = await tx`INSERT INTO leads (user_id, first_name, last_name, property_address, property_city,
          property_state, property_zip, phone, email, status, latitude, longitude, source, created_at, updated_at)
        VALUES (${USER_ID}, ${first}, ${last}, ${addr}, ${city}, 'SC', ${zip}, ${phone}, null, ${status},
          ${lat}, ${lng}, 'Seed', ${created}, ${created}) RETURNING id`;
      leadIds.push(r.id);
      for (const t of tags) await tx`INSERT INTO lead_tags (lead_id, tag_id) VALUES (${r.id}, ${tagIds[t]})`;
      const extra = ["Left a voicemail, will try again next week.", "Mailed a second letter to the owner.", "Owner asked us to call after 5 PM.", "Drove by, yard is overgrown and windows boarded."];
      const noteText = note || (i % 4 === 1 && i > 3 ? extra[(i >> 2) % extra.length] : null);
      if (noteText) await tx`INSERT INTO notes (lead_id, content, created_at) VALUES (${r.id}, ${noteText}, ${daysAgo(Math.max(0, i * 2.95 - 0.5))})`;
    }

    const buyerIds = [];
    for (let i = 0; i < BUYERS.length; i++) {
      const [name, company, phone, email, areas, priceRange, notes, onMap] = BUYERS[i];
      const crit = { areas, priceRange };
      if (onMap) {
        crit.geocodedAreas = areas.split(",").map((a) => a.trim()).filter((a) => AREA_COORDS[a]).map((a) => ({
          name: a, lat: AREA_COORDS[a][0], lng: AREA_COORDS[a][1],
          type: /^\d{5}$/.test(a) ? "zip" : /county$/i.test(a) ? "county" : "city",
        }));
      }
      const [r] = await tx`INSERT INTO buyers (user_id, name, company, phone, email, buy_criteria, notes, created_at)
        VALUES (${USER_ID}, ${name}, ${company}, ${phone}, ${email}, ${JSON.stringify(crit)}, ${notes}, ${daysAgo(60 - i * 5)}) RETURNING id`;
      buyerIds.push(r.id);
    }

    for (const [title, type, start, end, leadNo, allDay = 0] of EVENTS) {
      const leadId = leadNo ? leadIds[leadNo - 1] : null;
      const buyerId = title.includes("Carl Benning") ? buyerIds[1] : null;
      await tx`INSERT INTO calendar_events (user_id, title, event_type, start_at, end_at, all_day, status, lead_id, buyer_id, created_at, updated_at)
        VALUES (${USER_ID}, ${title}, ${type}, ${start}, ${end}, ${allDay}, 'scheduled', ${leadId}, ${buyerId}, ${daysAgo(20)}, ${daysAgo(20)})`;
    }

    for (let s = 0; s < SEQUENCES.length; s++) {
      const [name, desc, steps] = SEQUENCES[s];
      const [r] = await tx`INSERT INTO sequences (user_id, name, description, is_active, created_at)
        VALUES (${USER_ID}, ${name}, ${desc}, 1, ${daysAgo(90 - s * 10)}) RETURNING id`;
      for (let k = 0; k < steps.length; k++) {
        const [delay, action, template] = steps[k];
        await tx`INSERT INTO sequence_steps (sequence_id, step_order, delay_days, action_type, template)
          VALUES (${r.id}, ${k + 1}, ${delay}, ${action}, ${template})`;
      }
      // Enroll a few leads; next action far in the future so nothing is "due".
      for (let j = 0; j < 4; j++) {
        const leadId = leadIds[(s * 7 + j * 3 + 4) % leadIds.length];
        await tx`INSERT INTO lead_sequences (lead_id, sequence_id, current_step, status, enrolled_at, next_action_at)
          VALUES (${leadId}, ${r.id}, 1, 'active', ${daysAgo(10)}, '2027-06-01T09:00:00.000Z')`;
      }
    }

    // The long data set goes on top of the rows above, so everything else stays the same.
    if (LONG) {
      for (const [i, first, last] of LONG_NAMES)
        await tx`UPDATE leads SET first_name = ${first}, last_name = ${last} WHERE id = ${leadIds[i]}`;
      for (const [i, add] of LONG_TAGS)
        for (const t of add) await tx`INSERT INTO lead_tags (lead_id, tag_id) VALUES (${leadIds[i]}, ${tagIds[t]})`;
    }
  });
  const [counts] = await sql`select (select count(*)::int from leads) leads, (select count(*)::int from lead_tags) lead_tags,
    (select count(*)::int from notes) notes, (select count(*)::int from buyers) buyers,
    (select count(*)::int from calendar_events) events, (select count(*)::int from sequences) sequences,
    (select count(*)::int from sequence_steps) steps`;
  console.log(
    `Inserted: ${counts.leads} leads, ${counts.lead_tags} lead tags, ${counts.notes} notes, ${counts.buyers} buyers, ` +
      `${counts.events} calendar events, ${counts.sequences} sequences with ${counts.steps} steps`
  );
  const byStatus = await sql`select status, count(*)::int n from leads group by status order by status`;
  console.log(`Leads by status: ${byStatus.map((r) => `${r.status}=${r.n}`).join(" ")}`);
  if (LONG) {
    console.log(`Data set: long (${LONG_NAMES.length} long names, ${LONG_TAGS.length} more leads with three tags).`);
    console.log("Run the seed again without --long before you compare with the counts in the README.");
  } else {
    console.log("Data set: ordinary.");
  }
}

main().then(
  () => sql.end({ timeout: 5 }),
  async (err) => {
    console.error(`The seed failed: ${err.message}`);
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
);
