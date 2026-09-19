# History

The dated record of how this repo got to where it is: what was built, what was
found, what was decided and why. **It is a log, not a description of the
present.** Entries were accurate when written and are not revised afterwards,
so a figure or "not yet" in here may since have changed.

- **What is true now** -- what exists, what is next, what was decided against,
  live traps -- is `docs/status.md`. Read that first.
- **The design** is the two specs, `docs/fleet-portal-spec.md` and
  `docs/coinbox-spec.md`.
- **This file** is where to look for the *why* behind something: search it
  for a migration number, a file name or a feature before changing that thing.

Everything below was moved here verbatim from `docs/status.md` on 2026-09-19,
when that file was cut back to the current state. Newer entries sit at the top,
roughly; the "Snapshot" sections are the old current-state sections, kept so
their reasoning survives.

## Contents

- Docs split into status and history; loose ends tied — 2026-09-19
- File viewer: zoom out, and a modal instead of full screen — 2026-09-19, DEPLOYED
- In-app file viewer — 2026-09-19, DEPLOYED
- Cost per km removed; fuel consumption is the card — 2026-09-19, DEPLOYED
- Renewals, renewal documents and the grant — 2026-09-19, DEPLOYED
- Deployed — 2026-09-19, twice
- Housekeeping pass — 2026-09-19
- The workspace split is merged
- Coinbox is live on the real ledger — 2026-08-28
- Odometry's breadcrumb moved below the bar — 2026-09-08, DEPLOYED
- The fuel drill-down — 2026-09-08, DEPLOYED
- Both portals deployed — 2026-09-05
- A service can be corrected — 2026-09-05
- The two portals link to each other — 2026-09-05
- Snapshot: "What is deliberately NOT built", as it stood on 2026-09-19
- Snapshot: "Blocked on the owner", as it stood on 2026-09-19
- Snapshot: "Traps in the current state", as it stood on 2026-09-19
- Snapshot: "Live system" notes, as they stood on 2026-09-19
- Snapshot: "What works" -- feature notes with their reasoning, up to 2026-09-11
- Snapshot: "What is not built" gap tables, as they stood on 2026-09-19
- Recurring is live, and the first posts land 31 August
- The Home dashboard is built and live — 2026-08-31
- Snapshot: the old "Start here" section, as it stood on 2026-09-19
- Snapshot: the old "Next" and "Picking this up on another machine" sections, as they stood on 2026-09-19

---

## Docs split into status and history; loose ends tied — 2026-09-19

`docs/status.md` had grown to 1,620 lines of current state interleaved with a
dated diary, with "Next" at line 1,526. It is now ~230 lines of present tense
only: the deployed snapshot, a capability map, the ranked next list, decisions
not to reopen, and live traps. Everything else moved here, verbatim, and all 49
of its original headings are present below. The root `CLAUDE.md` gained a doc
map and a fifth definition-of-done step: update status, add an entry here.

Loose ends tied in the same pass:

- The root `CLAUDE.md` said `portals-docs` held service receipts only; it
  holds renewal certificates and grants too (0018).
- The Coinbox spec's §10.2 table still listed "What moved vs normal", removed
  on 2026-09-07.
- The fleet spec still said Coinbox computes cost per km; that card went on
  2026-09-19. §6.5's run rate is marked deprioritised, with a note that any
  future version must measure distance from `v_odometer_clean`.
- Four unused imports removed (one from the attachments refactor, three older
  ones in Coinbox), found by compiling with `--noUnusedLocals`. No behaviour
  change; not redeployed.

---

## File viewer: zoom out, and a modal instead of full screen — 2026-09-19, DEPLOYED

Owner feedback after using it: the browser's own PDF viewer can zoom OUT past
fit, and full screen was too much. So:

- Zoom now runs **50%, 75%, fit, 125%, 150%, 200%, 300%** -- below fit a whole
  page (or photo) sits centred with room around it. Keyboard `-` / `+` / `0`
  as well as the buttons; Ctrl-combinations are left to the browser.
- On a desktop the viewer is a **centred modal** (max ~900 px wide, 85% of the
  window high) over a dimmed page, and clicking the dimmed area closes it. On
  a phone it stays full screen, where a modal's margins would only cost room.
- **Seen in a browser, locally,** with the owner's own City grant PDF as the
  sample: 896x774 modal on a 1920 px window, 50% shows the whole page centred,
  a click inside stays open, a click outside closes and unlocks the page, 375
  px is full screen with no sideways scroll.
- **Deployed** as `29fabd9`, `fleet-portal` version
  `7d7dba37-e81c-4556-8480-f12a545640a4`. Checked live, read-only: the Waja
  grant opens in an 896x774 modal and zooms out to 50%, whole page visible.

---

## In-app file viewer — 2026-09-19, DEPLOYED

Every attached file -- service receipts, renewal documents, the grant, and
files still pending in the log-service form -- now opens in a full-screen
viewer instead of a new tab. Images fit to the screen with zoom and panning;
PDFs are drawn by PDF.js with every page, identically on desktop, Android and
iPhone. Previous/next moves across the files of that record, and there is a
download button and an "open in a new tab" fallback for anything that cannot
be previewed (HEIC outside Safari).

- One uploader component (`Attachments.tsx`), so one wiring point covers all
  of them. Rows moved to `AttachmentRows.tsx`; the viewer is in
  `components/viewer/`. No server change, no migration.
- PDF.js is its own chunk (~150 KB gzipped) plus a worker asset, loaded only
  when a PDF is opened. The main bundle grew ~9 KB.
- **Seen in a browser, locally:** a PNG and a 2-page PDF uploaded to a service
  record, zoomed, paged, moved between; a pending photo previewed from inside
  the log-service form, where clicks and Escape closed only the viewer and the
  typed workshop name survived; at 375px no sideways scroll. The test found and
  fixed two bugs -- pages at zero width, and a page lock the viewer could leave
  behind. Test files deleted afterwards. See `apps/odometry/CLAUDE.md`.
- **Deployed** as `ddb4bb8`, `fleet-portal` version
  `ad6a6d85-9225-429b-a07d-62f5a748edde`. Checked live, read-only: the Waja
  grant (a 4.9 MB, one-page PDF) opened in the viewer and rendered, with no
  console errors, and the page did not navigate away.

---

## Cost per km removed; fuel consumption is the card — 2026-09-19, DEPLOYED

**Owner decision:** cost per km is not a figure that gets read; fuel
consumption is the only analytics that is. So the Coinbox Home card now lists
each vehicle's average **L/100km and km/L**, full tank to full tank, and its
row opens the fuel sheet trimmed to consumption, price per litre, the trend
chart and the fill table.

This also closes the former "Next" item about `vehicleCosts` dividing by RAW
odometer readings: the figure that had that flaw is gone, and consumption never
had it -- it is measured between full-tank fills via the shared
`fuelSegmentSql`, not from the odometer range.

- **The card lists every vehicle the caller can reach in a garage that has a
  fill**, not vehicles with ledger spend. It carries no money, so a garage
  co-member sees a shared car's consumption -- the same litres Odometry already
  shows them -- and still no price. `tests/isolation.test.ts` asserts both, and
  removing the `garage_members` join from the card's query fails it (checked).
- **The payload key changed** from `vehicles` to `consumption`, and the fuel
  route no longer takes a "today" -- nothing on it has a date window now.
- **Seen in a browser, locally:** City at 7.9 L/100km over 4 tanks, 2,092 km;
  the sheet opens with no cost tiles, no spend panel and no km line.
- **No migration.**
- **Deployed 2026-09-19** as `ba5bb30`, `coinbox` version
  `12267973-a130-4457-a810-7294d4fdad3b`. Checked live, signed in, read-only:
  RS150R at 2.9 L/100km (35.0 km/L) over 10 tanks and 1,044 km; Waja listed
  with one fill as "needs a second full tank"; the sheet opens with 11 fills
  and no cost figures.

---

## Renewals, renewal documents and the grant — 2026-09-19, DEPLOYED

The top of "Next" since the API was written, now with a screen. Three things
shipped together because they share one piece of machinery:

- **A Renewals tab** on each vehicle. Road tax and insurance always get a card;
  a type never entered is a setup prompt, not an alert (spec 6.3). Each card
  shows the active record, its status pill and countdown ("expires in about 2
  weeks"), provider, reference, cost and documents. **Renew** always inserts a
  new row (invariant 8); **Correct** edits only provider, reference and notes.
  Superseded rows are listed below as history.
- **Documents on a renewal** (cover note, certificate): table
  `renewal_attachments`.
- **The vehicle grant (geran)**: a card under Details with chassis no. (the
  existing `vin`), engine no., registration date and colour -- three new
  columns on `vehicles` -- and the grant file itself in `vehicle_documents`.

**Owner decision, recorded because someone will propose reversing it:** the
grant's OWNER details (name, IC number, address) are not fields. Every column
lands in the nightly backup JSON and the CSV export, and a garage can be
shared; the PDF is served only through the garage-scoped route and is not in
the backup. `tests/renewals.test.ts` fails if a column with one of those names
appears on `vehicles`.

**One deliberate exception to "renewals are immutable":** a renewal can now be
DELETED, labelled "entered by mistake". Without it a mistyped LATER expiry
stayed active forever, since active is simply the greatest `expires_on`.
Deleting a row that never happened is not re-dating one that did.
`DELETE /api/renewals/:id` clears the row's R2 objects the same way deleting a
service does.

How it was built, for whoever touches it next:

- **One attachment repository, three owners.** `AttachmentRepo` in
  `apps/odometry/src/worker/data/attachments.ts` is configured by
  `SERVICE_RECEIPTS`, `RENEWAL_DOCUMENTS` or `VEHICLE_GRANT` rather than
  copied. Service receipt routes are unchanged; the new ones are
  `/api/renewals/:id/attachments`, `/api/renewal-attachments/:id[/content]`,
  `/api/vehicles/:id/grant` and `/api/grant-documents/:id[/content]`.
- **`documentKey` was removed from `renewalPatch`.** It let a client write an
  arbitrary R2 key onto a row. Nothing called it.
- **Isolation suite extended** with every new read, upload and delete, and
  seen to fail: dropping the garage filter from the download query failed the
  receipt, renewal and grant tests together; dropping it from the renewal
  delete failed that test. Both restored.
- **Seen in a browser, 2026-09-19**, against the local database: added a road
  tax through the form, got the upload step, card showed "Due soon", the
  dashboard attention list picked it up, the download came back as
  `application/pdf` with `nosniff`. At 375px the new fourth tab pushed the page
  12px wide; the tab row now scrolls within itself. The test data was deleted
  again afterwards.

**Shipped 2026-09-19** as `2e5410c`, `fleet-portal` version
`13c64152-a70f-4a5c-b325-89b92f1bbc8d`, through `npm run deploy -w odometry`
(tests, build, `0018` remote, then the Worker). Production before and after:
3 vehicles, 0 renewals, 2 service receipts, 4,508 transactions -- identical,
`PRAGMA foreign_key_check` clean, nothing left to apply.

**Checked live, signed in, READ-ONLY.** The Renewals tab and grant card
render; every new list endpoint returns 200 for all three vehicles and the
item routes 404 an unknown id; every vehicle row carries the four grant
fields; and both existing receipts (RS150R, Waja) still download byte for
byte with `application/pdf` and `nosniff` through the refactored repository.
Creating a test renewal in production was blocked by the session's
permission guard, so the write path was proven locally and in the test suite,
not against production. The first real road tax the owner enters is its
first production write.

The recovery runbook page was republished the same day for the new files.
**Receipts, certificates and grants are all outside the backup** -- see
`docs/backups.md`.

---

## Deployed — 2026-09-19, twice

| Worker | Version | Carries |
|---|---|---|
| `fleet-portal` | `fc5a7b04-3ce3-45ca-b35c-5f58196020b1` | Drizzle 0.45, React Router 7, the ServiceSheet split |
| `coinbox` | `568535ba-bb2e-478e-b3c4-9c3fb52c287c` | Drizzle 0.45, React Router 7, the TransactionTable split |
| `fleet-portal` | `26fbef6a-3811-477b-967d-0d4bc70977f8` | the save-confirmation fix, later the same day |

**The second deploy was Odometry alone**, and that was checked rather than
assumed: `git diff --name-only <deployed tree>..HEAD -- packages/core
apps/coinbox` came back empty, so the rule that a shared-package change means
both portals did not apply. Four files, all under `apps/odometry`.

Verified live without writing anything to production: the served bundle is
`index-Dw5KA-xL.js`, matching what was uploaded, and fetching it from the
signed-in page confirms it carries all three new strings -- "no maintenance
clock changed", "Also recorded, on no schedule", and the
start-tracking hint. Both portals still 302 to Access.

Production `service_items` is now **8** rather than 7. That is the TPS split
recorded above, not a stray write.

Both portals went out because `packages/core` changed, which is the same
reason the deploy script runs the WHOLE workspace's tests rather than one
app's.

**No migration ran.** `wrangler d1 migrations list --remote` reported nothing
to apply before either deploy, so the one irreversible step in the sequence
was a no-op this time. The first attempt at that check **errored** and a plain
retry succeeded -- the same transient recorded on 2026-09-08. Retry before
believing wrangler has lost its login.

Verified after, not assumed:

- **Production row counts identical either side**: 4,506 transactions, 3
  vehicles, 7 service records, 7 service items, 19 odometer readings, 11 fuel
  fills, 65 part types, 9 recurring rules. `PRAGMA foreign_key_check` clean
  over 9,280 rows read.
- **Both crons survived**: `0 18 * * *` on fleet-portal, `0 17 * * *` on
  coinbox, printed by the deploy itself.
- **All bindings intact**: fleet-portal still has `DB`, `BACKUPS`, `DOCS` and
  `ASSETS`; coinbox has `DB` and `ASSETS`. A dropped `DOCS` would have been
  silent until the next receipt upload.
- **Access still protects both** -- `/` and `/api/*` return 302 on each. The
  redirect for fleet-portal carries audience `8589de21f29cca...`, matching its
  own `ACCESS_AUD` and not Coinbox's, which is the separation that keeps a
  token minted for one portal from opening the other.

### Verified signed-in, against production itself

The first item below was closed the same day. **Chrome already held a valid
Access session**, so production opened without a sign-in step -- which is also
the cleanest possible confirmation that the deploy did not disturb Access.
Everything here is the real database, read-only; nothing was saved.

- **Odometry dashboard** -- RS150R 92,377 km, City 112,198 km, Waja 128,073 km.
- **Service history** on the RS150R, expanded: the 2026-09-10 repair at
  RM 424.00 with three line items, each showing its own "set on this visit"
  due point, the visit note, and **its receipt `MS.pdf` (2.4 MB) listed from
  `portals-docs`** -- the R2 attachment path working in production.
- **Fuel tab**, 10 real fills: 3.0 L/100km over 9 tanks, the first fill
  correctly showing "--" for distance and consumption (invariant 10: a segment
  needs a preceding full tank), and **no money anywhere on the page**, which is
  the garage-scoping rule holding.
- **Coinbox dashboard** -- September net +RM 3,774.14, out RM 6,474.26 against
  a RM 7,242.94 three-month average, RM 4,415.02 committed across 9 rule
  postings, YTD +RM 3,189.24, and staleness reporting "Today · 78 entries in
  September".
- **The refactored ledger table**, real data through 2026-09-19, all eight
  columns, vehicle attribution populated only on Transportation rows.
- **No console errors** on a full production page load of either portal.

Cells were deliberately NOT clicked on production: `CellInput` commits on
blur, so opening an editor and clicking away is a write path, and a no-op
write is still a write worth not making by accident.

### That record was revised — 2026-09-19, on production

Done at the owner's request, through the edit UI rather than SQL so it went
through Zod, the repository and invariant 6's absolute-to-interval conversion
rather than around them.

| Line | Before | After |
|---|---|---|
| Fuel filter | RM 76.00 | RM 76.00, note **"incl. RM 28 O-ring"** |
| Rear brake pads | RM 28.00 | unchanged |
| Throttle body clean | RM 320.00 | **RM 175.00**, note "Includes the valve adjustment." |
| Throttle position sensor | — | **RM 145.00**, no schedule |
| **Total** | **RM 424.00** | **RM 424.00** |

The total was the check: 76 + 28 + 175 + 145 balances to the original
RM 424.00, and it was confirmed in the sheet's own running total **before**
saving -- which is `deriveTotals`, extracted earlier the same day, doing its
job on production.

The visit note was a to-do ("Update throttle body clean as it includes TPS
replacement and adjustment valve fix"), now discharged. It was replaced with
provenance instead, because the app now shows four lines where the PDF shows
three and that difference should not puzzle anyone later: *"The workshop
billed one RM 320 line for the throttle body; RM 145 of that was the TPS,
split onto its own line here. Receipt MS.pdf is the original three-line bill."*

Verified in the database afterwards, not just on screen:

- Amounts stored as INTEGER sen -- 17500, 14500, 7600, 2800, summing to 42400.
- **`interval_km_override` is NULL on the TPS line and no
  `maintenance_intervals` row was created for `pt_tps`.** A sensor is replaced
  when it fails, not on a schedule, and "not seeded" must not become "has an
  interval" by accident. The other three lines kept theirs (20,000 / 25,000 /
  20,000 km).
- The receipt survived the edit: `MS.pdf`, 2,523,691 bytes, still linked.
- The record's odometer reading is still linked at 91,960 km, `source =
  'service'`, so the three copies of that number stay in step.
- `PRAGMA foreign_key_check` clean.

**A wording bug the TPS exposed, since fixed.** The save confirmation listed
every part on the visit under *"Clocks now set by this visit"*, including the
Throttle position sensor -- which sets no clock at all. `SavedConfirmation`
was handed `items.map(i => i.partName)`, so "parts on the visit" and "clocks
set" were the same list. Harmless while every part type in the catalogue had
an interval; **`pt_tps` is the first with none**, so it is the first part that
can appear in that list while resetting nothing.

The fix is `partsSettingASchedule()` in `serviceTotals.ts`, and the shape of
it is the point: **it reads the output of `toItemDrafts`**, the same function
that builds the request, rather than the item list. The screen cannot claim a
clock the API was not asked to set, and a future change to what gets sent
moves both together. A test asserts the two agree by construction.

The confirmation now has THREE cases rather than two, because "no parts at
all" and "parts, none of them tracked" are different things and the old code
could only say the first:

| Visit | What it says |
|---|---|
| No line items | "No parts are listed on this visit, so it resets no maintenance clock." |
| Parts, none scheduled | "Recorded, but no maintenance clock changed -- nothing on this visit is tracked on a schedule", then the list, then how to start tracking one |
| Some scheduled | "Clocks reset:" with only those, plus "Also recorded, on no schedule: ..." naming the rest |

The last line matters: a part that simply vanished from this screen would read
as a part that failed to save.

Seen working rather than assumed -- a spark-plug-plus-TPS visit logged against
the local database rendered "Clocks reset: Spark plugs" above "Also recorded,
on no schedule: Throttle position sensor", and the test record was then
removed. The four new tests were watched failing first, by restoring the old
`items.map(...)` behaviour: three failed, the first reporting
`[ 'Engine oil', 'Throttle position sensor' ]` where `[ 'Engine oil' ]` was
expected.

### The original observation, for context

The 2026-09-10 RS150R repair carries a RM 320 line called **"Throttle body
clean"** and a VISIT-level note reading "Update throttle body clean as it
includes TPS replacement and adjustment valve fix".

That is a workaround for two things that did not exist when it was entered:
a throttle position sensor part type, and a per-LINE note. **Both shipped in
migrations 0016 and 0017 on 2026-09-11 and went to production only with
today's deploy** -- the client work had been sitting undeployed since the
11th. So the record predates the feature built for it.

It can now be corrected: split the TPS onto its own line against `pt_tps`, and
move the explanation onto that line's note where it says which part it is
about. Worth doing while the receipt is still to hand, because the parts
history is the thing that gets consulted years later, and "Throttle body
clean, RM 320" will not say a sensor was replaced.

### The other thing to check yourself

- **Tonight's 18:00 UTC backup is the first run on Drizzle 0.45.** The backup
  reader is the one unscoped query in the system and it sits outside
  `BaseScopedRepo`, so it did not benefit from the isolation suites that
  covered everything else. `apps/odometry/tests/backup.test.ts` runs the full
  restore round trip on every `npm test` and passed, so this is a low
  expectation rather than a worry -- but tomorrow morning, check
  `fleet/2026-09-19.json` exists in R2 and its log line reports a sensible row
  count. Remember the filename is the UTC date, so it reads a day behind.

### A note on part types, in case the number looks wrong

Production shows **65** part types where this file says 62. Both are right:
62 are global seed rows (`garage_id IS NULL`) and **3 are custom rows created
through the "+ Add a custom part" panel** that shipped on 2026-09-11. The
escape hatch is being used, which is worth knowing before anyone reads 65 as a
seeding bug.

---

## Housekeeping pass — 2026-09-19

A session spent on the repo itself rather than on features, before the next one
starts. Nothing here changes what any page renders.

**Dependencies.** `recharts` was declared in Odometry and imported nowhere --
Coinbox's charts are hand-rolled SVG and Odometry has none. Removing it took 35
transitive packages (the whole d3 tree, lodash, victory-vendor) and 367 lines of
lockfile. The shipped bundle is unchanged, because an unused import was already
tree-shaken; this is install surface, not payload. `hono` went 4.13.3 -> 4.13.8
inside its existing `^4.6.0` range, clearing three advisories -- the relevant
one being unbounded dot-notation nesting in `parseBody()`, now in the request
path for receipt upload.

**Both remaining advisories were then cleared in the same session, at the
owner's instruction.** `npm audit --omit=dev` reports **zero vulnerabilities**,
down from four. Neither had been reachable -- that was checked before deciding,
not assumed from the severity label -- so this was hygiene rather than a fix:

- `drizzle-orm` 0.36.4 -> **0.45.2**, rated high, SQL injection via unescaped
  identifiers. Never reachable: there is no `sql.identifier`, `sql.raw` or
  `.dynamic()` anywhere in either portal, and `backup.ts` -- the one place that
  builds SQL from table names -- does its own `quoteIdent` on names read from
  `sqlite_master`, never through Drizzle.
- `react-router-dom` 6.30.6 -> **7.18.4**, moderate, open redirect via a
  backslash in a `to=`. Never reachable: every `to=` is a literal or an
  internal path built from ids; nothing routes to a user-supplied target.

**Neither upgrade needed a single source change.** tsc is clean in all three
workspaces. The API surface both libraries are used through is small --
Drizzle gets `eq/and/or/asc/desc/like/lte/sql` and the sqlite-core builders
with no relational queries or prepared statements; React Router gets
`BrowserRouter/Routes/Route/Link/NavLink/useParams/useSearchParams/
useLocation/useNavigate` with no data routers, so v7's future-flag defaults do
not apply.

### How the Drizzle upgrade was made safe

An ORM upgrade under a tenant-scoped system is the one place where "the tests
pass" is not enough: a two-row fixture can pass while the predicate is
subtly differently composed. So, in order:

1. **`apps/odometry/tests/sqlFingerprint.test.ts` was written first, on
   0.36**, asserting the literal SQL and bind order for every read shape the
   repositories use. The one that matters most is `scope AND (a OR b)` -- had
   that ever re-associated to `(scope AND a) OR b`, every row matching b would
   escape the predicate. It passed **unchanged** on 0.45.
2. **Both isolation suites were broken on purpose ON 0.45** and watched fail.
   Odometry's garage predicate replaced with `1 = 1`: 5 failures, the first
   reporting `BOB_VEHICLE_NICKNAME` leaking from `GET /api/vehicles`.
   Coinbox's ledger predicate: 9 failures, including the garage co-member
   case. Both restored.
3. Local row counts compared either side and identical; `.wrangler/state` was
   copied aside first.

The fingerprint file is kept. Note it builds queries through `QueryBuilder`
from `drizzle-orm/sqlite-core`, not the D1 client -- **the isolation lint
rejected the first draft for importing `drizzle-orm/d1` outside
`src/worker/data/`, correctly.** Widening that allow list to make one test
easier would have left the lint permanently weaker, so the test changed
instead. `QueryBuilder` needs no driver and was verified to emit identical SQL
and binds. That makes it reads-only, which is the right half: a write with a
broken predicate fails to find its row and is visible; a read with one returns
someone else's data and is not.

### The React Router check that nearly did not happen

The workspace suites are worker-side and **do not touch the router at all**,
so passing tests proved nothing. Route shapes were rendered through
`MemoryRouter` in Node instead: `/`, `/vehicles/:id` (useParams), `/ledger`
with both query parameters (useSearchParams), `Link` href, and `NavLink`
active state. All correct on v7.

**`BackButton` reads `window.history.state?.idx`, which is a React Router
INTERNAL.** Had v7 stopped writing it, `canGoBack` would be false everywhere
and Back would silently jump to the root rather than going back -- no error,
no failing test, and nothing on screen to say so. v7's `getHistoryState` still
writes `idx: index`. `layout.tsx` now records the dependency and says to check
it by clicking, not by reading source, on the next major.

### A trap that reappeared in a new disguise

Restarting the dev servers **looked** successful. Odometry had actually died
on `EADDRINUSE 127.0.0.1:9230` -- the inspector port from the 2026-09-08 entry
below -- and port 5174 was still being served by the OLD process on the OLD
dependencies. `curl` returned 200 from exactly the port the config names.

**An HTTP 200 from your configured port is not evidence that your new build is
running.** What proved it was killing by listening port and then finding
`data-discover`, an attribute only v7 emits, in the dev bundle.

Bundles grew, which is the one measurable cost: Workers 395.8 -> 407.4 kB
(odometry) and 370.8 -> 382.4 kB (coinbox); clients 324.1 -> 340.8 kB and
328.5 -> 344.9 kB, both near 101 kB gzipped. Well inside the limits.

**Nothing was deployed and no migration was run** -- remote is untouched, and
both portals are still running the pre-upgrade code in production. The next
`npm run deploy -w <app>` ships these libraries; that deploy is worth doing
when someone can watch it rather than at the end of an unrelated change.

**The palette gained `status.info-bg/fg`.** The warranty badge in
`ServiceHistory` was the last raw Tailwind colour in either portal
(`bg-sky-950 text-sky-300`). It is now a named token set to those exact values,
so the compiled CSS is byte-identical -- verified as `rgb(8 47 73)` and
`rgb(125 211 252)`. It is deliberately NOT `status.ok`: that green already means
"maintenance is fine" on `StatusPill` and the two render near each other, so
reusing it would collapse "nothing is due" and "the part is still covered" into
one colour. The preset's rule is that a raw colour means the palette is missing
a token, not that the nearest token should absorb it.

**Two components were split, and the logic that came out of them is now
tested.** `ServiceSheet` was 335 lines of code in one component and
`TransactionTable` 407, against a guide of roughly 200. Both came apart at the
seam between arithmetic that can be silently wrong and markup that can only be
ugly:

| New file | What it owns |
|---|---|
| `odometry/.../serviceTotals.ts` | Totals, the soonest due figure, and the absolute-to-interval conversion (invariant 6) |
| `odometry/.../ServicePartsSection.tsx` | The line items and the two ways to add one |
| `odometry/.../ServiceVisitFields.tsx` | Date, odometer, type, workshop |
| `coinbox/.../transactionEdits.ts` | What a committed cell edit actually writes |
| `coinbox/.../transactionCells.tsx` | `CellInput`/`CellSelect` and the metric pairs that stop a click moving the layout |
| `coinbox/.../TransactionRow.tsx` | One row in either state |

`ServiceSheet` is now 228 lines of code, `TransactionTable` 99. `TransactionRow`
is 222 and left alone: it is seven near-identical cell blocks, and splitting it
further would fragment one readable structure into several.

31 new tests came with it, all on the extracted logic, which was previously
reachable only by rendering a sheet. Both suites were **seen to fail** first --
`toItemDrafts` was made to send the due point instead of the interval (two
failures), and `buildPatch` was made to stop clearing the vehicle on a category
move (one failure). Both restored.

One honest result from that exercise: removing the explicit blank-amount guard
in `buildPatch` failed **nothing**, because `parseSen("")` returns null and the
next line rejects it. The guard states the intent and stays, but it is
belt-and-braces rather than the thing holding that rule up.

**Repo hygiene.** Four fully merged branches deleted, local and on origin
(`fuel-consumption-capture`, `workspace-split`, `worktree-coinbox-dashboard`,
`worktree-wrap-up-docs`); only `main` remains. An empty `.claude/worktrees`
left over from the worktree episode removed. The tenant-isolation lint was
re-verified by breaking it on purpose -- `env.DB` added to a Coinbox route
handler, watched fail, restored.

**Also checked and found already correct**, so nobody needs to look again
soon: every `GET` endpoint in both portals is in its isolation suite (15
Odometry, 10 Coinbox, none missing); the published backup runbook matches
`docs/backups.md` including the receipts section; remote migrations are fully
applied; `tsconfig` and Tailwind configs are properly factored; no TODOs, no
skipped tests, no committed build output; git objects total under 1 MB.

### Two documents were out of step with the code

- **`docs/setup-checklist.md` never mentioned Coinbox.** It was written for the
  single-portal era and would have left someone rebuilding from scratch with no
  ledger, no second Access application and no R2 buckets. It also told you to
  run `npm run deploy`, **which does not exist** -- there is no root deploy
  script, only `npm run deploy -w <app>` -- and to check `PRAGMA foreign_keys`
  with a bare `wrangler d1 execute`, which without `--persist-to .wrangler/state`
  talks to a different, empty local database. Rewritten to cover both portals.
- **This file contradicted itself about backups**, listing them as deferred
  Phase 4 work five hundred lines below the entry describing them running
  nightly. Corrected, along with three stale test counts.

### SEEN IN A BROWSER -- the standing "never looked at" gap is closed

The Chrome extension connected on a later attempt in the same session, so for
the first time since 2026-09-08 this work was actually looked at rather than
reasoned about. Both portals, on the upgraded libraries, against the real local
database.

Verified by clicking:

- **Odometry dashboard** -- three vehicles, wordmark, palette, status pills.
- **`/vehicles/:id`** -- `useParams` resolves under React Router 7; the right
  vehicle loads.
- **The refactored `ServiceSheet`, in EDIT mode on a real record**, which is
  the richest test of the split. `serviceDraft` seeded every field correctly
  (2026-08-28, 91,250 km, type Other, Bengkel Motor Luth); `ServicePartsSection`
  rendered the spark-plug line with its brand, quantity, warranty and the
  **`note` field from migration 0017**; `deriveTotals` printed Parts RM 30.00 +
  Labour RM 18.00 = **Total RM 48.00, matching the stored record exactly**,
  with "Next service at 101,250 km" derived. The part catalogue included
  **Throttle position sensor** (0016) and the **"+ Add a custom part…"** escape
  hatch wired up on 2026-09-11.
- **The BackButton's `history.state.idx` dependency**, which needed a test
  that could tell the two outcomes apart -- from `/vehicles/:id` both a working
  `navigate(-1)` and the broken `navigate("/")` fallback would look the same.
  Going one level deeper (`/` -> `/vehicles/:id` -> `/settings`) separates
  them, and Back landed on **the vehicle page, not the dashboard**. v7 still
  writes `idx`.
- **The refactored `TransactionTable`** -- all eight columns, the `in` row
  green and the rest ink, the vehicle column populated only on Transportation.
  Clicking the Item cell opened exactly one inline editor with the right value;
  Escape closed it without writing, and the table came back **pixel-identical**,
  which is the whole point of CONTENT and EDITOR being metrically matched.
- **The Coinbox dashboard** -- stat tiles, staleness banner, and `YearChart`
  drawing correctly, which incidentally confirms the hand-rolled SVG really did
  not need the `recharts` that was removed.

### A browser-automation trap, for whoever drives Chrome next

**`Page.captureScreenshot` times out while the page is perfectly healthy.** It
happened repeatedly, always after a click that moves focus into a control, and
it recovers after a navigation. `read_page` and `find` kept answering instantly
and reflected every state change throughout, which is how it was clear the app
was fine and the screenshot pipeline was not.

Do not read a screenshot timeout as a hung app or an infinite render loop --
that was the first hypothesis here and it was wrong. **Check `read_page`
before believing it**, and fall back to the accessibility tree, which is
better evidence for structural checks anyway: it is what showed the totals, the
seeded fields and the single open editor above.

One tab did get wedged badly enough that a fresh tab was the fix. These portals
call `showPicker()` deliberately (`PartPicker`, `CellSelect`) so one click opens
a native list, and a native popup is the one thing that reliably stops Chrome
producing frames.

---

## The workspace split is merged

**As of 2026-08-28 the two-portal workspace is on `main`.** The
`workspace-split` branch fast-forwarded in — six commits, no divergence, no
conflicts. A fresh clone now sees both portals.

### What those six commits did

| Commit | What |
|---|---|
| `bb9c87f` | Moved Odometry to `apps/odometry`, npm workspaces, `migrations/` and `.wrangler/state` to the root |
| `d3f3668` | Extracted `packages/core` — one `getAuthenticatedUser()` across both portals, generic `BaseScopedRepo` |
| `8f19f63` | Coinbox skeleton: `ledgers` table, ledger-scoped repo, isolation suite, docs |
| `d48b38c` | Wrote this handover into `docs/status.md` |
| `93361f1` | Updated the handover for the repo rename and the push |
| `3f889e9` | Recorded the then-outstanding local folder rename |

Everything was verified, not assumed:

- Odometry is behaviourally unchanged — **73 tests before the move, 73 after**.
- Migration ledger intact: `wrangler d1 migrations apply` reported nothing to
  apply after `migrations/` was relocated (the ledger stores bare filenames).
- The isolation lint and the Coinbox isolation suite were each **made to fail
  on purpose and then restored**. A passing check proves nothing until it has
  been seen to fail.
- Clean clone → `npm ci` → `npm test` is green.

### The folder rename is done

The local folder is now `github/portals`, matching `hzrqftr/portals` on GitHub.
The `github/coinbox` signpost — one README, no code — was deleted on
2026-08-28, both of its reasons to exist having gone.

One consequence is worth remembering, because it will happen again to anyone
who moves this folder: **npm workspaces link on Windows as junctions with
absolute targets.** After the rename all three
(`node_modules/@portals/core`, `node_modules/odometry`,
`node_modules/coinbox`) still pointed into the old `github/odometry` path and
silently dangled. The isolation lint still passed, then `tsc` failed with
`Cannot find module '@portals/core'` about eighteen times. `rm -rf node_modules
&& npm ci` rebuilds them. Junctions are not in git, so a fresh clone never has
the problem — this is strictly a "moved the folder" concern.

`.wrangler/state` needed nothing: it resolves relative to the repo root, so the
local D1 and its data moved with the folder and no migration was re-applied.

## Coinbox is live on the real ledger — 2026-08-28

**The Google Form can be retired.** Coinbox holds the complete history and
every entry path the Form had, plus the four things it could not do.

| | |
|---|---|
| Transactions in production | **4,421** |
| Span | 2022-01-03 → 2026-08-28, 56 months |
| Money in / out | RM 350,805.89 / RM 350,809.67 |
| Net | −RM 3.78 |
| Categories | 20, seeded globally |
| Vehicle-attributed | 699 |

Reconciled exactly on the first production run, against figures written into
`docs/coinbox-spec.md` §6 **before** the importer existed. Foreign key check
clean. Both portals still 302 to Access.

### What the full history changed

The 2026-only sample it was all built against was wrong about three things.

1. **A zero amount is real data.** `CHECK (amount_sen > 0)` rejected eight
   RM 0.00 water bills, recorded on purpose so a monthly-average dashboard has
   a value for every month. The constraint is now `>= 0`; the guard that was
   actually wanted — blank versus typed zero — moved to the form and the table,
   where the slip happens.
2. **A default tuned on a slice lied.** Miscellaneous is 12 in / 3 out across
   2026 and 34 in / 66 out across five years. It defaulted to `in`; it now
   defaults to `out`.
3. **Four categories were missing** — Accommodation, Dividend, Fundings, Debt
   appear only before 2026.

### Import decisions, for the record

- The **"Elai's" row** (12-May-2022) was dropped: a restaurant name landed in
  the Amount column and no figure is recoverable.
- **Six duplicate pairs** were double submissions; the second of each was
  dropped, worth RM 102.83. That is the whole difference from the Sheet's
  totals, so an import matching the Sheet exactly would be wrong.
- **124 ambiguous `Car fuel` rows → the City.** An **owner decision, not
  evidence**: the file names the Waja 44 times to the City's 33 and leans Waja
  heavily in 2023. Recorded here so four years of attribution is never mistaken
  for something the Sheet said.

### Still on the Sheet, deliberately

The owner is dropping the **Form**, not the **Sheet**.

**Narrowed on 2026-08-31.** The monthly surplus/deficit table and its totals —
the main reason the Sheet was still being opened — are now the Home dashboard.
What remains on the Sheet is ad-hoc analysis: arbitrary slicing, and a copy
readable on a phone without going through Access. Coinbox is the system of
record for entries either way.

---

### Fuel capture and consumption (2026-09-03)

A Coinbox entry can now be marked a fill-up, capturing **odometer, litres and
whether the tank was filled**. The odometer lands in Odometry through the same
validated path the quick-update flow uses; the litres land in a new garage-scoped
`fuel_fills` table (migration `0013`). Odometry's vehicle page grows a **Fuel**
tab showing each fill with the consumption of the segment it closes.

Three decisions worth not re-litigating:

- **All three fields were captured together on purpose.** Odometer plus ringgit
  gives cost per km, which already existed. Litres per 100 km needs volume, and
  it needs `is_full_tank` — consumption is only computable full tank to full
  tank, and a partial fill divided by its own distance produces a number in an
  entirely plausible range that is simply wrong. Shipping the odometer first and
  the litres later would have left a permanent hole in the series, because none
  of this is backfillable.
- **`fuel_fills` carries no money column.** It is garage-scoped and a garage is
  shared, so a price there would be readable by every co-member. The ringgit
  stays on `transactions` behind the ledger predicate.
- **The trigger is a toggle, not a new category.** There is no `fuel` category
  and adding one would split five years of history — every fuel row the owner
  has is Transportation.

Not built yet: the Coinbox-side consumption analytics (month over month). It
reads only data now being captured, so it can be built whenever.

## Odometry's breadcrumb moved below the bar — 2026-09-08, DEPLOYED

| Worker | Version |
|---|---|
| `fleet-portal` | `8c7397d5-5d36-4008-a335-191a6a6eb736` |
| `coinbox` | `c48840db-098b-4eb4-8dde-b5be6b694204` |

`main` at `a257da0`. No migration; production row counts unchanged (3 vehicles,
4,458 transactions, 5 fills, 25 tables), both crons intact, both portals still
302 to Access. Coinbox shipped only because `packages/core` changed -- its
behaviour is identical -- so that production does not drift from `main`.

`crumbPlacement="inline"` put the crumb where the WORDMARK goes, so stepping
into a vehicle cost the portal its only branding and its way home at once, and
a crumb that grew a third level had nowhere to go. Odometry now passes
`below`, the mode Coinbox already used.

**The one-prop change was not one prop.** `AppHeader` carried a warning that a
`sticky top-14` strip assumes a 56px header and would slide under a taller one,
and noted that no portal using `below` did that yet. **Odometry's VehicleDetail
tabs are exactly that strip**, so the warning went live the moment this
changed: against a 98px header they would have pinned 41px too high and let the
page scroll visibly through the gap. The tabs render only after the vehicle
loads, so the crumb is always beside them and a fixed offset is safe.

The offset is now a shared constant beside the markup it measures, rather than
a second magic number in a file that cannot see the header:
`STICKY_UNDER_BAR` (`top-14`) and `STICKY_UNDER_BAR_AND_CRUMB` (`top-[97px]`).
Both sit a pixel short of the real height on purpose -- which is what `top-14`
always did -- so the strip's translucent background laps over the header's
`border-b` instead of leaving a hairline of page showing through.

`inline` remains the DEFAULT although neither portal passes it. Flipping a
default is how the other portal changes shape without anyone editing it.

**Not seen in a browser either.** The 97 is reasoned from the markup, not
measured. If the vehicle tabs show a hairline gap or a 1px overlap while
scrolling, that constant is the dial. `top-[97px]` was at least confirmed to
survive Tailwind's purge in a real production build -- arbitrary values are
easy to lose that way, and the failure is silent.

## The fuel drill-down — 2026-09-08, DEPLOYED

Each row of Coinbox's cost-per-kilometre card now opens a sheet: consumption
per tank with a trailing mean, price per litre, the 12-month spend split, the
distance behind it, and every fill in a table. **No migration** -- it reads only
data `0013` already captures.

This closes the "fuel consumption analytics" item that stood at the top of
*Next*, and reopens `docs/coinbox-spec.md` §10.3's "Consumption trend, for now"
deliberately. Both of that deferral's reasons survived and shaped the result:
the series is young, so the chart shows **all fills** rather than a 12-month
window, and month-over-month was rejected for the **per-segment series with a
trailing average** §10.3 itself guessed at.

| Piece | Where |
|---|---|
| The segment SQL, now shared | `packages/core/src/worker/fuel.ts` |
| The weighted average, isomorphic | `packages/core/src/fuel.ts` |
| The guarded read | `apps/coinbox/src/worker/data/vehicleFuel.ts` |
| `GET /api/vehicles/:id/fuel` | `apps/coinbox/src/worker/routes/index.ts` |
| The sheet and the chart | `client/components/VehicleFuelSheet.tsx`, `ConsumptionChart.tsx` |
| Arithmetic tests | `apps/coinbox/tests/vehicle-fuel.test.ts` (10) |
| Isolation | 2 new cases, plus the per-vehicle path in all four sweeps |

Five decisions worth not re-litigating:

- **`FUEL_SQL` moved to `packages/core` rather than being copied.** It cost
  almost nothing: Coinbox's `assertUsableVehicle()` already returns the garage
  id off the vehicle row, so both portals bind the same `(vehicleId, garageId)`
  pair and only the proof of entitlement differs. Two copies of segment
  arithmetic would have kept returning plausible numbers while drifting, with
  nothing on either screen able to say which was right.
- **This is the portal's SECOND cross-portal read, and the sharper one.**
  `fuel_fills` is garage-scoped, so a co-member is *entitled* to the litres --
  Odometry already shows them. What they must never get is the ringgit. So it
  is the one endpoint where the two halves of one physical event are served
  together and have to come apart along the tenant boundary. The money
  predicate lives in the JOIN's `ON` clause, not a `WHERE`: in a `WHERE` it
  becomes an inner join and hides a co-member's fills entirely rather than
  merely unpricing them.
- **The average is DISTANCE-WEIGHTED, and Odometry was corrected to match.**
  `FuelHistory.tsx` took the plain mean of the per-segment rates, which counts
  a 40 km top-up as heavily as a 600 km run. Both portals now call
  `weightedLPer100km` in `@portals/core`. On the local data the two figures
  differ by 0.006 L/100km -- which is exactly why this had to be caught by a
  test rather than by eye.
- **Two cost-per-km figures appear in the sheet on purpose.** The card's is
  12 months of fuel *and servicing*; the sheet's own is fuel only over closed
  segments, all time. Each is labelled, and the card's is **not recomputed** --
  it is passed in as the row that was clicked, so they cannot disagree even in
  principle. The spend breakdown *does* reconcile with it, by construction and
  by test.
- **Price per litre is its own plot, not a second y-axis.** Different units on
  one pair of axes can be scaled to agree or diverge at will. They share the x
  bands so points align and one hover lights both.

Verified rather than assumed:

- **All three tenant guards were broken on purpose and watched to fail**, then
  restored -- the membership check (Bob read a stranger's fills), the ledger
  predicate on the fills join (Carol saw RM 999.99), and the ledger predicate
  on the spend breakdown. Each failed exactly the test meant to catch it.
- **The weighted average was broken on purpose too**, and its test failed with
  9.0 against the expected 8.18 -- the unweighted answer, in the plausible range.
- **Run against the real local database, not just tests.** Six fills seeded on
  the City including one part fill: the part fill's 16.6 L correctly carried
  into the segment that closed at 8.17 L/100km, and the card and the sheet
  reported identical spend for all three vehicles (RM 3,024.27 / 1,667.75 /
  694.00). Odometry's Fuel tab and Coinbox now both print 7.89675 for the City.
- Odometry's 107 tests pass **with `apps/odometry/tests/fuel.test.ts`
  unedited**, which is what proves the extraction changed no behaviour.

### Deployed 2026-09-08

| Worker | Version | Notes |
|---|---|---|
| `coinbox` | `ec30c0f9-96ea-4c84-b51e-6876673b10b3` | the drill-down |
| `fleet-portal` | `96ef56e6-0f3c-4528-99a3-544531f5d827` | shared segment SQL, corrected average |

`main` fast-forwarded to `96f576a`, no merge commit. **No migration** --
`wrangler d1 migrations list --remote` reported nothing to apply both before
and during each deploy, and production row counts were identical either side:
3 vehicles, 4,458 transactions, 5 fuel fills, 9 odometer readings, 25 tables.
Both crons survived (`0 17 * * *` on coinbox, `0 18 * * *` on fleet-portal) and
both portals still 302 to Access, `/api/*` included.

**Production already holds 5 real fills**, so the drill-down has live data on
day one rather than an empty state.

Both portals were deployed because `packages/core` changed. That is exactly why
the deploy script runs the WHOLE workspace's tests rather than one app's.

**NOT SEEN IN A BROWSER WHEN THIS SHIPPED** -- the Chrome extension was not
connected in the session that built it, so the layout, the 375px behaviour and
the hover readout were reasoned about and never observed. Deployed anyway at
the owner's instruction.

**PARTLY RESOLVED 2026-09-19.** Both portals were finally opened, on local and
on production -- see the browser section in the 2026-09-19 entry above. What
that closed: the dashboard, vehicle detail, service history, the fuel tab, the
log-service sheet, the Coinbox dashboard and the ledger table all render
correctly with real data, at desktop width.

**What it did NOT close, so do not read this as finished:**

- **Narrow widths.** Nothing has been viewed at 375px, on either portal. Every
  responsive decision in this repo is still unobserved.
- **Coinbox's fuel drill-down** (`VehicleFuelSheet`, `ConsumptionChart`) was
  never opened. That is the component this 2026-09-08 entry was worried about,
  and it remains the one whose chart, y-axis labels and stacked bar have never
  been looked at.
- The Sheet heading/close-button collision noted in the gap table is likewise
  still theoretical.

So the "click a vehicle" instruction is discharged; the narrow-width and
drill-down checks are not.

One transient worth knowing: the first `wrangler d1 migrations list --remote`
failed with `7403 The given account is not valid or is not authorized`, while
`d1 list` and `deployments list` both succeeded on the same credentials. A
plain retry worked. Check twice before believing wrangler has lost its login.

### Both dev servers really can run at once now -- 2026-09-08

This file has claimed that since 2026-09-05 and it was **half true**. The HTTP
ports were pinned, but the Cloudflare vite plugin's **Node inspector port**
defaulted to 9229 in both apps, so the second to start died with
`EADDRINUSE: 127.0.0.1:9229` -- an error naming a port neither config mentioned,
while the two ports that *were* configured looked perfectly correct.
`inspectorPort` is now pinned alongside the HTTP port: **Coinbox 9229,
Odometry 9230**. Started from clean, both now come up together.

## Both portals deployed — 2026-09-05

| Worker | Version | Notes |
|---|---|---|
| `fleet-portal` | `986df042-fb5f-47f3-8695-c5492a76e0f5` | carries migration `0014` |
| `coinbox` | `0f219eef-5e03-4139-93fb-56b2c2703d1a` | header link only, no migration |

Migration `0014` applied remotely, and checked rather than assumed. Row counts
identical before and after (3 services, 1 item, 7 readings, 3 vehicles, 4,451
transactions, 25 tables); **all 3 production services linked to their reading,
none orphaned**; `PRAGMA foreign_key_check` clean. The backfill match was
previewed as a read-only SELECT first and showed exactly one candidate reading
per service — no ambiguity to resolve.

Both crons survived (`0 18 * * *` on fleet-portal, `0 17 * * *` on coinbox) and
both portals still 302 to Access, `/api/*` included.

## A service can be corrected — 2026-09-05

`PATCH /api/services/:id` existed but `servicePatch` omitted `items`,
`odometerKm` and `servicedOn`, so a visit logged with the wrong odometer could
never be fixed — only deleted and re-logged. The owner hit exactly that.

Those three were closed rather than wrong. **The service odometer lives in
three places** — `service_records.odometer_km`, the `odometer_readings` row the
visit writes, and the cached `vehicles.current_odometer_km` — and nothing
linked the service to the reading it created, so a correction could only ever
update one of the three and leave the others asserting the original figure.

Migration `0014` adds `service_records.odometer_reading_id`, shaped after
`fuel_fills.odometer_reading_id`, and backfills it by matching on what the
create path wrote. Production holds no service records, so remotely it is a
column add and nothing else.

| Piece | Where |
|---|---|
| The link | `migrations/0014_service_odometer_reading.sql` |
| Correct a reading, rebuild the cache | `packages/core/src/worker/odometer.ts` |
| Replacement semantics | `serviceUpdate` in `apps/odometry/src/shared/zod/` |
| `update()` and a fixed `remove()` | `apps/odometry/src/worker/data/services.ts` |
| Log-or-edit form | `client/components/ServiceSheet.tsx`, `serviceDraft.ts` |
| Tests | `tests/serviceEdit.test.ts` (10) |

Four decisions worth not re-litigating:

- **An edit is a REPLACEMENT, not a merge.** `items` is a set, and a partial
  merge over a set cannot express removing a line. Once items go whole,
  everything going whole is one rule rather than two. Consequence: an omitted
  optional CLEARS, and a partial body is now a 422.
- **The cached odometer is REBUILT, not nudged.** `odometerWriteStatements`
  only ever moves that figure forward in time, which is right for an append and
  wrong for a correction — 112,000 keyed for 12,000 would otherwise leave the
  dashboard on 112,000 permanently. `recacheOdometerStatement` recomputes from
  the readings. Its `COALESCE(..., 0)` is load-bearing:
  `current_odometer_km` is `NOT NULL DEFAULT 0`, and without it deleting the
  last service is a 500.
- **Removing a line item does NOT revert the vehicle's interval.** Invariant 6:
  the last service sets the schedule and nothing stores what it was before, so
  there is no previous value to restore. Pinned by a test so nobody "fixes" it
  by inventing one. The save confirmation says so on screen.
- **`remove()` had the same latent bug and is fixed too.** Deleting a service
  used to leave its reading behind, propping the vehicle's odometer up with a
  visit that no longer existed.

Verified rather than assumed:

- **The tenant guard was broken on purpose and watched to fail.** Removing the
  garage predicate from `update()`'s load alone changes nothing observable —
  the per-statement predicates catch it, and `list()` re-scopes when building
  the response. Removing **both** lets A rewrite B's service, and the isolation
  suite fails with `expected 'hijacked' to be 'BOB_WORKSHOP'`. That assertion
  is new: the 404 alone never proved the edit was refused, because the tail
  re-read would 404 even after a successful write.
- **Run against the real local database, not just tests.** The City's service
  was PATCHed with its own values and came back byte-identical, same reading
  id, still one reading. The RS150R was corrected 91,250 → 91,500: the record,
  its reading and the cache all moved, spark plugs went 101,250 → 101,500, and
  correcting it back restored every figure. Three edits, still one reading —
  never duplicated. `PRAGMA foreign_key_check` clean.

## The two portals link to each other — 2026-09-05

`AppHeader` has always accepted a `portals` prop and rendered it; nothing
passed it. Each header now does. **The bet that deferring this would cost an
array rather than a rework paid off exactly as written** — no chrome was
reworked in either app.

What was deferred was never the link but the **filtering**. Odometry admits the
household, Coinbox admits the owner alone, so a co-member following Odometry's
link reaches a Cloudflare denial page. Shown anyway, deliberately: the owner is
the only person with both, and a hypothetical co-member's dead link costs less
than no navigation for the person who actually uses both. The clean fix remains
Access groups, still blocked on a groups claim that does not reach the Worker.
**Do not substitute an email allowlist in `wrangler.jsonc`** — it duplicates the
Access policy somewhere nobody looks, and the copy that drifts is that one.

The URLs are hardcoded per app with a dev branch, which is why the dev ports are
now pinned with `strictPort` (Coinbox 5173, Odometry 5174). Both dev servers can
run at once, and a port collision now fails loudly instead of moving silently.

## Snapshot: "What is deliberately NOT built", as it stood on 2026-09-19

Everything in `docs/coinbox-spec.md` §4 IS built as of 2026-08-28 — this
section used to say the opposite and was the stale part of this file. What
remains deliberately absent:

- ~~**The reverse Odometry link.**~~ **PARTIALLY REOPENED 2026-09-03, for fuel
  only.** Service records still carry no `transaction_id`, and §7.2's reasoning
  still holds for them. What changed is that a Coinbox fill-up now WRITES into
  Odometry — an `odometer_readings` row, a `fuel_fills` row and the cached
  odometer on the vehicle, all in one atomic batch with the transaction.

  The trade was made knowingly: the alternative is keying the odometer twice, in
  two apps, and an odometer nobody keeps entering is the top-rated product risk
  in the fleet spec (§11.7). Three guards carry it, and
  `apps/coinbox/tests/fuel.test.ts` breaks each one on purpose — the garage id
  is read off the vehicle row the membership join proved, never off the scope;
  the reading cannot run backwards; and the whole write is one `batch()` so a
  rejected fill leaves no transaction, no reading and no fill.
- **`ledger_members`.** Sharing a ledger is unrepresentable on purpose. Adding
  it is a product decision, not a refactor.
- ~~**Deleting a transaction.**~~ **BUILT 2026-08-30, and this deferral was
  reopened deliberately.** Recurring entries are the reason: a rule that posts
  without confirmation will eventually post something wrong, and editing that
  entry to RM 0.00 is not an undo -- it leaves a row asserting a payment that
  never happened, still counted in `v_txn_monthly`. Auto-post without delete is
  the unsafe combination, so the two shipped together.

  Hard delete, not a `deleted_at` flag: a soft delete would need
  `WHERE deleted_at IS NULL` in `list`, `get`, `monthlySummary`, both views and
  every report written from here on, and a single omission silently returns a
  deleted row to a total. Recovery is the nightly R2 export (90 days) plus D1
  Time Travel (30) -- a file the owner already has.
- **Budgets** (§8.6, Phase 2) and **multi-user** (Phase 3).

## Snapshot: "Blocked on the owner", as it stood on 2026-09-19

**Nothing is blocking.** Every dashboard task is done: `wrangler login`, the
Coinbox Access application and its AUD tag, and the `portals-backup` R2 bucket.

One optional item remains, and it is cosmetic: a **Coinbox wordmark**.
Odometry's Bukhari Script woff2 is subset to its own eight glyphs and licensed
for personal use only, so it cannot be reused. Coinbox uses body type and looks
fine. `docs/coinbox-spec.md` §7.5 closes this — do not reopen it as a task.

### Cleared on 2026-08-28

- **`wrangler login`** — done. The CLI is authorised again; `whoami` reports
  `hazriq.fitri95@gmail.com`, account `d635376dc2be247b10234d81a23a15f5`.
- **The Coinbox Access application** — created, owner-only policy
  `coinbox-allowlist`, its AUD tag now in `apps/coinbox/wrangler.jsonc`.

## Snapshot: "Traps in the current state", as it stood on 2026-09-19

- ~~**`0012_recurring.sql` is applied LOCALLY ONLY.**~~ **RESOLVED.** All of
  `0001`-`0012` are applied both locally and remotely; checked on 2026-08-31
  with `npx wrangler d1 migrations list fleet --remote -c wrangler.jsonc`,
  which reported nothing to apply. The dashboard added no migration, so there
  is currently no gap between the two. Re-run that command before believing
  this line — it is the only cheap way to know.
- **A git worktree makes the isolation lint fail with ~100 bogus violations,**
  because `.claude/worktrees/<name>/` is a full second copy of the tree and the
  allow lists are anchored regexes. Fixed on 2026-08-31 by putting `.claude`
  in `SKIP_DIRS`. If you see it anyway, you are on a checkout from before that
  fix: run `git worktree list` before believing a single finding. See the root
  `CLAUDE.md`, "Known traps".
- **Coinbox now has a Cron Trigger**, `0 17 * * *`, and `observability` is on
  for that Worker. Two things follow. A newly registered cron takes **~15
  minutes** to start firing, so do not debug silence before checking how long
  ago it deployed. And the 17:00 UTC recurring run must stay **before**
  fleet-portal's 18:00 UTC backup, so the night's auto-posted entries are in
  that night's dump.
- **The first production recurring run will post nothing**, because forward-only
  means no rule can be due before it is created. A healthy quiet run is
  distinguishable from a broken one only by the log line, which always reports
  how many rules were *considered*, not just how many posted.
- **Both apps share `.wrangler/state` at the repo root**, because they share
  one D1 in production. If either app starts creating its own, a transaction
  will not be able to see the vehicle it references.
- ~~**Both dev servers want port 5173.**~~ **FIXED 2026-09-05.** The ports are
  pinned with `strictPort`: **Coinbox 5173, Odometry 5174**, and both can run
  at once. They had to become deterministic because the cross-portal header
  link hardcodes the sibling's dev address -- a port that drifts would make
  that link wrong rather than merely inconvenient. `strictPort` means a port
  already in use is now a loud startup failure instead of a silent move to the
  next one.
- **`npm test` at the root runs everything**; `npm test -w odometry` runs one
  app. The root `test` is what `npm run deploy -w <app>` calls, deliberately —
  both portals share a database and `packages/core`.

---

## Snapshot: "Live system" notes, as they stood on 2026-09-19

This repo is a **workspace with two portals** sharing one D1 database. See the
root `CLAUDE.md`, "One database, one repo".

| | |
|---|---|
| Repo | `hzrqftr/portals`, private, branch `main` |
| Odometry app | https://fleet-portal.hazriq-fitri95.workers.dev |
| Coinbox app | https://coinbox.hazriq-fitri95.workers.dev — LIVE with the full ledger, recurring entries and the Home dashboard, owner-only |
| Workers | `fleet-portal`, `coinbox` |
| Database | D1 `fleet` (`e4bdd9c3-e885-42de-a709-4daf8f4a6edb`) |
| Access team | `effortless-hf95.cloudflareaccess.com` |
| Access apps | fleet-portal → policy `fleet-portal-allowlist` (household); coinbox → policy `coinbox-allowlist` (owner only) |
| Identity provider | Google (not Google Workspace) |

**Both portals are deployed and Access-protected as of 2026-08-28.** Coinbox
has its own Access application and its own audience tag, with the policy
`coinbox-allowlist` admitting the owner alone — deliberately narrower than
Odometry's, which admits the household so a fleet can be co-owned.

The two AUD tags differ, and must keep differing: accepting the other portal's
audience would let a token minted for the fleet portal open the ledger.

Verified at deploy time rather than assumed: unauthenticated requests to
Coinbox return `302` to
`effortless-hf95.cloudflareaccess.com/cdn-cgi/access/login/...`, with the
redirect's `kid` matching the configured AUD; Odometry was unaffected
throughout.

**Migration `0010_ledgers.sql` is now applied remotely.** Production went from
17 tables to 18; views, users, garages and vehicles were unchanged, as expected
for a migration that only adds a table and an index. `ledgers` is empty until
someone signs in to Coinbox and the bootstrap runs.

Production schema, **re-measured 2026-09-19**: 24 tables, 6 views, **62**
seeded part types across 11 categories, foreign keys enforced. The table count
excludes SQLite's and Cloudflare's own (`sqlite_%`, `_cf_%`) but includes
`d1_migrations`; counting everything gives 26, which is where other figures in
this file differ rather than disagreeing.

The line this replaces read "15 tables, 4 views, 61 seeded part types" and was
simply old -- migrations 0010 through 0017 had landed since. Part types went to
62 with `pt_tps` in 0016. Exactly the ageing the paragraph below warns about,
found by counting rather than by reading.

Data currently in production, **measured 2026-09-05, not assumed**: one user,
one garage, three vehicles (Waja and City, both `vehicle_type = 'car'`, and an
RS150R, `'motorcycle'`), 96 maintenance intervals, **3 service records, 1
service item, 7 odometer readings** and 4,451 transactions. 25 tables.

This paragraph previously said production had no readings, no service history
and no renewals. **That was true when written on 2026-08-28 and quietly stopped
being true as the portal got used** — it was caught only because the `0014`
pre-flight counted rows rather than trusting this file. Count before believing
any figure here; it is the kind of line that ages without anyone editing it.

Note that the developer's LOCAL database is a different and much fuller thing:
`.wrangler/` is gitignored, so whatever a previous machine had — test vehicles,
service records, hand-edited intervals — does not travel with a clone. A fresh
checkout starts empty and that is correct.

---

## Snapshot: "What works" -- feature notes with their reasoning, up to 2026-09-11

Verified against the deployed app, not just the test suite.

- Cloudflare Access sign-in via Google, restricted to an email allowlist
- First-login bootstrap: user, garage, owner membership, default settings
- Dashboard: attention list, vehicle cards, stale-odometer warnings
- Add a vehicle, with intervals seeded from part-type defaults filtered by fuel
- Quick odometer update from the dashboard (§8.5)
- Vehicle detail: nickname, odometer, maintenance list, service history
- **Log a service** (§8.4): date, odometer, service type, workshop, line items,
  part picker pinning the vehicle's due parts, brand autocomplete, and a save
  confirmation naming which clocks were reset
- **Labour as its own cost** (migration 0006): entered separately from the
  parts, which covers the common case of supplying your own oil and filter and
  paying a workshop for the fitting alone. The grand total is computed as
  parts + labour on read — there is no stored `total_cost` any more, so no two
  figures can disagree
- **Motorbikes** (migration 0008): `vehicles.vehicle_type`, and a
  `part_type_defaults` table keyed by (part type, vehicle type) that decides
  both which parts a vehicle has and on what schedule — the same
  `pt_engine_oil` is 10,000 km on a car and 3,000 on a bike. 13 bike-specific
  parts; chain and CVT parts both ship un-seeded since a bike is one or the
  other and nothing in the schema says which. Car-only parts (cabin filter,
  aircon, wipers, ATF, power steering, CV boots, car suspension) no longer
  exist for a bike at all
- **Wear-and-tear parts, grouped** (migration 0007): 48 global part types,
  including suspension and steering (absorbers, mounts, stabiliser links and
  bushes, lower arm bushes, ball joints, tie rod and rack ends), drivetrain
  (CV boots, engine mounts, wheel bearings), cooling and engine servicing.
  Four new categories carry them, and the maintenance list is grouped by
  category with anything overdue or due soon pinned above the groups. Parts
  that depend on the car rather than the fuel -- clutch, differential, rear
  drums, coil springs -- ship with no default interval so they stay opt-in
- **One interval per part** (migration 0005): the interval keyed in at a
  service becomes the vehicle's interval, stored as an interval so the due
  point stays derived. Replaced the earlier per-service *override*, which gave
  one part two competing schedules and made an edited interval look like it
  had not saved
- **Per-vehicle interval editing** inline on the maintenance list, including
  switching a part off and tracking one the seeder skipped — this is how the
  Waja's timing belt and the City's timing chain are told apart
- **Settings** (§8.7): due-soon thresholds, stale-odometer threshold, assumed
  km/day fallback, timezone, currency, and the minor/major parts templates
- Part warranty in months, shown as a badge on the service history line item
- **Dark, desktop-first UI** (2026-08-21): one wide responsive layout, a shared top bar,
  and the vehicle maintenance list rebuilt as a grid of tiles with category icons and a
  All / Needs attention / Not set up filter. Twenty parts used to be ~2,000px of stacked
  cards; they now fit one screen on a laptop.
- **Part search on the maintenance tab** (2026-08-22): a search box above the
  grid filters the tracked tiles and the not-tracked list together, by part
  name. A car tracks around forty parts across eleven categories, which meant
  scrolling to find one even after the tile rebuild. It filters an array
  already in memory and does not re-sort it, so the server's
  overdue → due_soon → ok → unknown ordering and invariant 4 both stand
- **Battery folded into Electrical** (migration 0009): `battery` was a category
  with exactly one member, while spark plugs and ignition coils already sat
  under `electrical`. A plain data `UPDATE`, not a rebuild — `electrical` was
  already legal under the category `CHECK`. Eleven categories now, not twelve
- **Nightly whole-database backup to R2** (2026-08-28): a Cron Trigger on
  fleet-portal exports every table as JSON to `portals-backup`, keyed
  `fleet/YYYY-MM-DD.json`, keeping 90 days. One D1 means one backup covering
  both portals. Table discovery reads `sqlite_master` rather than a hardcoded
  list, so a table added later is included without anyone remembering.

  Retention is 90 days because **D1 Time Travel was measured at 30** — not
  assumed, which both specs had asked for. The export earns its place on what
  Time Travel cannot do: outlive 30 days, survive loss of the Cloudflare
  account, and be a file you can read and move.

  `scripts/restore.mjs` is the operator path, and the round trip runs on every
  `npm test`. It was also exercised against **production**, not just locally:
  the cron wrote `fleet/2026-08-28.json` (47 KB, 15 tables), that object was
  pulled from R2 and restored into the local database, and local came back
  holding production's 3 vehicles and 96 maintenance intervals -- 255 rows,
  foreign key check clean. That is the drill §7.6 asks for, done end to end.

  `observability.enabled` is on for this Worker so a failed nightly run leaves
  a log behind. It is the one job here with nobody watching it.
- **Receipt upload on service records** (2026-09-10, migration 0015): a service
  visit can carry up to ten scanned receipts, PDF or image, attached either in
  the log-service form or afterwards from the history row. Files go to a new R2
  bucket `portals-docs`; `service_attachments` holds the metadata and the key,
  with a real foreign key to `service_records` so the rows cascade on delete.

  Three things about it are not obvious and are load-bearing:

  - **The stored content type is sniffed from the file's leading bytes, never
    taken from the browser.** This Worker serves the SPA and the API from one
    origin, so a file uploaded as `image/png` whose bytes are markup would run
    as script on the portal's own origin when served back. The download route
    pairs that with `nosniff` and an explicit content type.
  - **R2 objects do not cascade.** The rows do; deleting a service therefore
    reads its keys before the delete and clears the bucket after. There is a
    test asserting the bucket is empty afterwards, because the database looks
    correct either way.
  - **`service_records.invoice_key` is superseded and deliberately left in
    place.** Dropping it means a table rebuild, which means dropping and
    recreating `v_maintenance_due` and `v_part_baseline` to remove one column
    that is NULL in every row. Nothing reads it.

  The bytes helpers live in `packages/core/src/worker/attachments.ts` and know
  nothing about garages, so Coinbox can reuse them — but the TABLE is
  Odometry's. Coinbox scopes on `ledger_id`, and a shared attachments table
  would need a nullable tenant column, which is the exact leak the two-axis
  design exists to prevent. Coinbox needs its own table, repo, routes and its
  first R2 binding when it wants this.

  **Receipts are outside both backup nets** — see `docs/backups.md`.
- **A line item can carry its own note, and the catalogue gained a sensor**
  (2026-09-11, migrations 0016 and 0017). Both came off one real RS150R
  receipt the portal could not fully record.

  A throttle position sensor at RM 145 had no matching part type -- nothing in
  the 61-row catalogue was a sensor -- so 41% of the bill could only go into
  the labour field, where a replaced component leaves no trace in parts
  history. `pt_tps` is seeded globally with **no interval and
  `seed_by_default` 0**: a sensor is replaced when it fails, not on a schedule,
  and the two stay distinct (invariant 6) so the part still has a figure to
  offer the day someone does start tracking it.

  Its `part_type_defaults` rows are mandatory rather than thorough:
  `PartTypeRepo.list` INNER JOINs that table, so a part type with no row for a
  vehicle type is invisible to it -- which looks exactly like the INSERT having
  silently failed.

  An O-ring at RM 28 belongs with the fuel filter it was fitted to, but folding
  it into that line's unit cost hid why the line read RM 76 instead of RM 48.
  `service_items.note` is a nullable ADD COLUMN, so `line_total_cost` (VIRTUAL,
  generated) is untouched and no view rebuild was needed.

  The same commit **wired up the custom-part escape hatch**, which had existed
  server-side and been called by nothing: `POST /api/part-types`,
  `partTypeInput` and `PartTypeRepo.create` were all written when the part-type
  repo was, and `useCreatePartType` had zero importers -- the catalogue was
  closed in practice. `PartPicker` now offers "+ Add a custom part" in an
  inline panel rather than a second Sheet over a half-filled service.

  The isolation suite seeds a marker into a line item's note. No endpoint was
  added, but `note` is new free text coming back from
  `GET /api/vehicles/:id/services`, and the broad sweep is the only thing that
  would notice it leaking.
- **The log-service date field, fixed twice on a phone** (2026-09-10). The date
  and odometer overlapped at narrow widths; stacking them fixed that but left a
  short fixed-length value in a full-bleed control, which reads as a mistake.
  The date is now capped at `13rem` below `sm` and shares a row again from `sm`
  up.

  `DATE_INPUT` also gained `block`, and that is a fix rather than tidying: an
  input is inline-block by default and `INPUT` relies on `w-full` to fill its
  line, so the moment a max-width made one narrower than its line, the label
  flowed up beside it and the date grew a side label while every other field
  kept its label on top. **Caught by looking at the render** -- the
  measurements said 208px and no overlap, and were no help at all.
- Every Phase 1 API endpoint
- 161 tests: tenant isolation, derived logic, service correction, attachments,
  the backup round trip, the Access JWT fallback, the log-service arithmetic,
  and a fingerprint of the SQL Drizzle emits

---

## Snapshot: "What is not built" gap tables, as they stood on 2026-09-19

The API is complete for Phase 1. All of the following are **client gaps** —
the endpoints exist and are covered by the isolation suite.

| Gap | Spec | Why it matters |
|---|---|---|
| ~~Renewals~~ | §4.6, §6.3 | **BUILT 2026-09-19, not yet deployed**, with renewal documents and the vehicle grant (migration `0018`). See the top of this file |
| Vehicle delete | §10 | Editing is built (Details → Edit details); deleting is not. `DELETE /api/vehicles/:id` archives and is isolation-tested, but nothing calls it |
| Add-vehicle baseline prompt | §8.3 | Spec says prompt for baselines after saving; it currently saves and dismisses, which is how all three vehicles ended up with no odometer |
| Inline odometer edit, usage rate | §8.2 | The Details panel now shows the spec, but the odometer can only be changed from the dashboard (or now by correcting the service that recorded it), and the usage rate with its confidence indicator is not surfaced anywhere |
| ~~Editing a service after saving~~ | §8.4 | **BUILT 2026-09-05**, migration `0014`. See below |
| Custom part types in the UI | — | `POST /api/part-types` exists and is isolation-tested, but nothing calls it yet. **Partly superseded on 2026-09-11**: `PartPicker` now has an inline "+ Add a custom part" panel, so the endpoint is wired up. The 62 seeded types cover the common cases |
| Per-vehicle service templates | §8.4 | `service_templates.vehicle_id` exists and is always NULL; templates are garage-wide for now, which also means one "Minor service" template is shared between a car and a bike |
| Changing a vehicle's type | — | Read-only once created, deliberately: switching it would not re-seed or un-seed anything, so a control that appeared to turn a car into a bike while leaving forty car parts behind would be lying. Delete-and-recreate for now |
| `Sheet`'s close button (both portals) | — | `packages/core/src/client/Sheet.tsx` floats its X in a zero-height row, so every caller must remember `pr-9` to stay clear of it, and must render its own `<h2>` because `title` is only an aria-label. Three of five callers remember; **`OdometerSheet` and `ServiceSheet` are correct only because their headings are short** — a longer vehicle nickname reproduces the collision Coinbox hit on 2026-08-28, and `ServiceSheet`'s heading grew by two characters on 2026-09-05 ("Edit service — " vs "Log service — "), which narrows that margin without closing it. Reviewed and deliberately deferred: the real fix is `Sheet` rendering the title itself, which touches five files and needs judgement in `ServiceSheet` (its saved-state screen) and `PartDetailSheet` (its pill header) |

Deferred by design: Budgets (§8.6) is Phase 2 and multi-user is Phase 3.
Reminders are Phase 4. **Backups were Phase 4 and are now built** -- running
nightly since 2026-08-28; see the entry above and `docs/backups.md`. What is
still outstanding from that phase is alerting when a run fails.

### Coinbox

**This table was badly out of date and was rewritten on 2026-08-30.** It still
listed the schema, the entry form and the import as unbuilt, which the sections
above it and production both contradict. If you are reading it against
something that looks wrong, trust the code.

| Gap | Spec | Why it matters |
|---|---|---|
| ~~`transactions` + `categories` schema~~ | §4.2, §4.3 | **BUILT 2026-08-28**, migration `0011`. 4,421 rows in production |
| ~~Entry form~~ | §1.1 | **BUILT 2026-08-28.** Conditional vehicle field, direction-reordered category picker, inline cell editing |
| ~~Sheet import~~ | §6 | **DONE 2026-08-28.** 4,421 rows reconciled exactly. The triage screen was not needed — the real count was 14, not ~80 |
| ~~Backup + restore~~ | §7.6 | **BUILT 2026-08-28.** Nightly whole-database export to R2, 90-day retention, restore round trip in CI |
| ~~Recurring entries~~ | §9 | **BUILT 2026-08-30**, delete wired into the page **2026-09-07**. Declared rules, nightly cron, edit, pause, delete. See below |
| ~~The Sheets mirror~~ | §7.6 | **DROPPED 2026-09-19, owner decision.** The ledger view in Coinbox is enough. Do not reopen it as a task |
| Backup failure alerting | — | A failed nightly run writes to the log and tells nobody. Needs an email provider |
| Off-Cloudflare backup copies | — | Every backup is in the account it protects. One downloaded file a month closes it |
| ~~Home dashboard~~ | §10 | **BUILT AND DEPLOYED 2026-08-31.** The surplus/deficit table as a chart, a month drill-down, and cost per km. See below |
| ~~Cross-portal navigation~~ | §7.4 | **BUILT 2026-09-05.** Each header links to the other portal. Shown unconditionally -- see below |
| ~~Fuel consumption analytics~~ | §10.5 | **BUILT AND DEPLOYED 2026-09-08**, a drill-down off what is now the fuel consumption card (cost per km removed 2026-09-19). No migration |

---

## Recurring is live, and the first posts land 31 August

**Deployed 2026-08-30.** Version `2df53a95`, cron `0 17 * * *` registered on the
coinbox Worker. The owner has entered **nine real rules** totalling
**RM 4,415.32 a month**. As of the evening of 2026-08-30, `recurring_postings`
is empty and no transaction carries `is_recurring = 1` — correct, because
forward-only means nothing can be due before its rule was created.

| Rule | Amount | Day | First post |
|---|---|---|---|
| AKPK | RM 240.00 | last day | **2026-08-31** |
| Family fund | RM 200.00 | last day | **2026-08-31** |
| ASB | RM 50.00 | 5th | 2026-09-05 |
| House loan | RM 2,910.00 | 5th | 2026-09-05 |
| Balance transfer | RM 311.32 | 9th | 2026-09-09, last 2027-06-09 |
| MARA | RM 250.00 | 15th | 2026-09-15, last 2027-05-15 |
| House insurance | RM 170.00 | 24th | 2026-09-24 |
| Etiqa | RM 230.00 | 26th | 2026-09-26 |
| Astro | RM 54.00 | 30th | 2026-09-30 |

**AKPK and Family fund post on the night of 30 → 31 August**, and that run is
the first end-to-end proof the cron works in production. Two entries totalling
RM 440 should appear dated `2026-08-31`, marked with the recurring glyph. If
they do not, check how long ago the Worker deployed before anything else — a
newly registered trigger takes ~15 minutes to start firing.

### Deleting a rule reached the page on 2026-09-07

**Deployed 2026-09-07**, Worker version `145bd442-89f3-4ef4-82fa-a348ed346de5`,
`main` fast-forwarded to `9be2459`. No migration, and
`wrangler d1 migrations list --remote` reported nothing to apply both before and
during the deploy.

The server half had been built and tested since 2026-08-30 — the endpoint, the
ledger-scoped `remove()`, the cross-tenant refusal, and the test proving posted
entries survive their rule. `useDeleteRecurring()` existed too. **Nothing
called it**, so until now the only way to remove a rule was a raw HTTP request.
This was a client-only change.

Two things the browser found that reading the code did not:

- **The trash button broke the card at 375px.** It squeezed the rule title from
  112px to 76px, cutting a long name to one word and wrapping its schedule over
  three lines. The row is `flex-wrap`, but the title carried `min-w-0`, so it
  collapsed rather than forcing the buttons onto a second line. A
  `min-w-[8rem]` floor makes it wrap; the title now gets 190px, better than
  before the change. It looked correct on desktop and broke only where entry
  actually happens.
- **Only the title opened the editor.** The amount, the next-due date, the
  posted-count line and any dead space did nothing. The card now uses the same
  stretched-overlay pattern as Odometry's vehicle tiles, with Pause and delete
  raised on `z-10` so they keep their own hit areas.

### Editing a running rule was impossible — found and fixed 2026-09-07

The owner tried to move Astro from the 30th to the 8th and got **"A recurring
entry cannot start in the past"**, an error naming a field he had not touched.

`update()` ran the forward-only check on any `startsOn` present in the patch,
and `RecurringSheet` resends the whole draft on save. A rule that has been
running has a start date in the past **by definition**, so the guard rejected
its own unchanged value. **Every rule became uneditable the day after it
started** — all nine in production. It had been that way since recurring
shipped on 2026-08-30, and nothing caught it because forward-only had no test
at all.

The guard now fires only when `startsOn` actually moves, which is the only case
that is a backdate. `tests/recurring-rules.test.ts` covers both halves —
the edit that must pass, and the backdate that must still fail — and the
regression test was seen to fail before the fix.

**The lesson worth keeping:** a validation written for *create* was reused on
*update*, where the same rule means something different. Anything that
validates "not in the past" needs to know whether it is judging a new value or
re-reading an old one.

## The Home dashboard is built and live — 2026-08-31

`/` was empty and is now the dashboard. Spec §10 has the design; the app's
`CLAUDE.md` has the four rules that will look like bugs and are not.

**Deployed to production 2026-08-31**, Worker version
`1115cd1d-176e-4d64-b29d-3d1a668f05a0`. `main` fast-forwarded to `9613e43`, no
merge commit. `wrangler d1 migrations list --remote` reported nothing to apply
both before and during the deploy — this change adds no migration, so the
production database was not touched. The nightly cron (`0 17 * * *`) and
`ENVIRONMENT=production` both survived the deploy.

**No migration.** Everything is derived from `v_txn_monthly` and existing
tables, so there is nothing to apply and nothing new to back up.

What landed:

| Piece | Where |
|---|---|
| `GET /api/dashboard[?month=]` | `worker/routes/index.ts` |
| Every query behind it | `worker/data/dashboard.ts` |
| The year chart | `client/components/YearChart.tsx` |
| The month drill-down | `client/components/MonthBreakdown.tsx` |
| Tiles, Coming up, fuel consumption | `StatTiles.tsx`, `DashboardPanels.tsx` |
| Arithmetic tests | `tests/dashboard.test.ts` (13) |
| Isolation | 3 new cases in `tests/isolation.test.ts` |

Verified rather than assumed:

- **Three tenant guards were each broken on purpose and watched to fail**, then
  restored — the `ledger_id` predicate on the monthly series, the same on the
  cost-per-km query, and the `garage_members` join on it. Each break failed
  exactly the test meant to catch it and no other, which is what makes the
  second guard non-vacuous.
- **Run against a real D1 with the owner's real monthly figures.** The running
  total came out at −RM 2,785.53, matching the Sheet's Total row exactly, and
  the August-vs-July delta at RM 1,141.85.
- 130 Coinbox tests, 85 Odometry (unchanged), isolation lint over 120 files.
  As of the fuel work (2026-09-03) that is 163 Coinbox and 93 Odometry, and as
  of service editing (2026-09-05) **163 Coinbox and 103 Odometry**.

Two decisions worth knowing before changing anything here:

- **The trailing "normal" divides by three, always**, which agrees with the
  RM 0.00 rows being load-bearing: absent months count as zero rather than
  being dropped, so the divisor never becomes "months with entries".
- **The fuel consumption card and its drill-down are Coinbox's cross-portal
  READS** (cost per km, which this line used to name, was removed 2026-09-19).
  The card has one guard, a `garage_members` join, since it carries no money;
  the drill-down has two, tested separately. `transactions.vehicle_id` has no
  foreign key by design, so a vehicle id can outlive the caller's access to it.

Still open on this page, and deliberately not built:

- **Ghost columns for Sep–Dec** showing what the rules already commit. The
  honest way to fill the empty half of the year; needs no new table.
- **Mobile.** The layout stacks and was reasoned through, but as with the rest
  of the portal nobody has opened it on a real phone.

---

## Snapshot: the old "Start here" section, as it stood on 2026-09-19

**Everything in this repo is deployed. There is no work in flight.** As of
2026-09-19 the tree, `origin/main` and both production Workers all carry the
same code, remote migrations are fully applied, and the only branch is `main`.

| | |
|---|---|
| Last commit that changed CODE | `29fabd9` (viewer zoom-out and modal) -- everything after it is documentation |
| Deployed code vs `main` | identical; a docs-only commit moves `main` and ships nothing |
| `fleet-portal` | version `7d7dba37-e81c-4556-8480-f12a545640a4` |
| `coinbox` | version `12267973-a130-4457-a810-7294d4fdad3b` |
| Remote migrations | all 18 applied; nothing pending |
| Production schema | 26 tables, 6 views, 62 seeded part types |
| `npm test` | lint over 172 files, then 193 Coinbox + 179 Odometry |

**Do not trust that table -- it is a snapshot and this file ages.** Four
commands confirm the whole of it in under a minute, and they are cheap enough
to run before touching anything:

```bash
git status && git log --oneline -1          # clean? which commit?
npx wrangler d1 migrations list fleet --remote -c wrangler.jsonc
npx wrangler deployments list -c apps/odometry/wrangler.jsonc
npm test                                    # lint + both suites
```

If the deployed version does not match what `git log` says shipped, **the
deployed code is the truth and this file is stale** -- read the git history
before believing any paragraph here.

### The fresh-clone path is verified, 2026-09-19

`git clone` -> `npm ci` -> `npm run db:apply:local` -> `npm test` was run end
to end on a clean clone that day. It produced a local database with **24
tables, 6 views, 62 part types and 17 migrations -- identical to production's
schema** -- and a green suite. Nothing gitignored is needed: there is no
`.dev.vars`, no secret, and no `process.env` read anywhere in either app's
source. `wrangler login` is needed only for `--remote` commands and deploys.

**One trap, and it is not the repo's fault.** `wrangler d1 ... --local` fails
with a bare `internal error; reference = <id>` when the checkout sits under a
very long path. It was reproduced twice from a ~200-character temp directory,
where even `SELECT 1` failed, and worked immediately from a normal
`github/portals-clonetest`. If a fresh clone cannot talk to its own local D1,
**check the path length before debugging the migrations**.

---

## Snapshot: the old "Next" and "Picking this up on another machine" sections, as they stood on 2026-09-19

**Backup alerting.** A failed nightly run writes to the log and tells nobody.
`observability` is on so the evidence persists, but real alerting needs an
email provider (fleet spec §12). The obvious weakness of what is built.

**Off-Cloudflare backup copies.** Every backup sits in R2, in the same account
as the database. That covers deletion and corruption, not account loss.
Downloading one object a month elsewhere closes it.

**The shared `Sheet` close button.** Reviewed and deferred — see the papercut
row in the Odometry gap table above.

**Mobile.** Never verified on a real device. The layout is written for it (the
table scrolls inside its own container, the entry sheet is a bottom sheet at
narrow widths) but nobody has opened it on a phone.

## Picking this up on another machine

```bash
git clone https://github.com/hzrqftr/portals.git
cd portals
npm ci                    # not `npm install` -- the lockfile is committed
npx wrangler login        # needs a real terminal; opens a browser
npm run db:apply:local    # shared local D1, safe to re-run
npm run dev -w odometry   # http://localhost:5174
npm run dev -w coinbox    # http://localhost:5173 -- both can run at once
npm test                  # lint (158 files) + 161 Odometry + 194 Coinbox
```

Those counts are a snapshot taken **2026-09-19**, not a contract. Tests only
ever get added here, so a fresh clone seeing MORE than this is normal and
means someone has been working; seeing FEWER means something is actually
wrong. The lint's file count moves the same way. Do not spend time
reconciling a higher number -- run `git log --oneline -- apps/*/tests` and
carry on.

This path is verified, not assumed: it was run end to end from a scratch clone
on 2026-08-21 (clone → `npm ci` → migrations → 73 tests → build), and again
after the workspace split on 2026-08-27.

**Both portals share `.wrangler/state` at the repo root**, because they share
one D1 in production. Do not let either app create its own — a transaction
would then be unable to see the vehicle it references.

`wrangler dev` supplies a simulated Access identity through the `access.dev`
block in `wrangler.jsonc`, so local development needs no Cloudflare Access and
no login. The local database starts empty and is separate from production.

Node 24 is what this has been developed and verified on. There is no `engines`
pin, so a very different major version is untested rather than known-bad.

Deploying:

```bash
npm run deploy -w odometry   # test -> build -> migrate remote -> deploy
```

The ordering inside that script is load-bearing in two directions and is
explained in CLAUDE.md under Commands. Do not replace it with a bare
`wrangler deploy` (that is `npm run deploy:worker`, for redeploying unchanged
code) unless you are certain there is no pending migration.

### Things that will confuse you otherwise

- **Line endings are pinned to LF by `.gitattributes`.** This is not
  cosmetic. Before it existed, `core.autocrlf=true` gave a Windows clone CRLF
  while tooling wrote LF, and `scripts/check-db-imports.mjs` — which split on
  `"
"` — was left a trailing carriage return that stopped its comment
  stripping from matching, so the tenant-isolation lint reported its own
  comments as violations and a fresh clone could not run `npm test` or
  therefore `npm run deploy`. If you ever see that lint flagging prose, suspect
  line endings first.
- **`github.com` is blocked by the office wifi policy.** `git push` hangs for
  ~21 seconds and fails, while `gh` commands succeed, because those hit
  `api.github.com`. It is not a git or credential problem. Tethering to a phone
  hotspot clears it. It is network-dependent, not permanent -- the push on
  2026-08-28 went straight through.

  **Always attempt the push before mentioning any of this.** The owner may
  already be on a hotspot, or off the office network entirely, and being told
  to switch when the push would have worked is noise. Push first; raise the
  hotspot only if it actually fails.
- **`ctx.access` is not populated in production**, despite a correctly
  configured Worker-attached Access application. `auth.ts` therefore verifies
  the `Cf-Access-Jwt-Assertion` header itself, using `ACCESS_TEAM_DOMAIN` and
  `ACCESS_AUD` from `wrangler.jsonc`. Those two vars are load-bearing: rename
  the team or recreate the Access application without updating them and every
  request 401s. `ctx.access` remains the preferred path and takes over
  automatically if Cloudflare starts supplying it.
- **The Access assertion carries no display name**, so `users.display_name` is
  null in production where `ctx.access` would have filled it in.
- **Dashboard nav has been renamed.** Zero Trust is now Cloudflare One. The
  exact click paths in `setup-checklist.md` were corrected on 2026-08-20.
