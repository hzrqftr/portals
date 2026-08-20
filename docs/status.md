# Status

Where the project actually is, and what to pick up next. `fleet-portal-spec.md`
says what to build; this file says how much of it exists.

**Last updated:** 2026-08-20

---

## Live system

| | |
|---|---|
| Repo | `hzrqftr/odometry`, private, branch `main` |
| App | https://fleet-portal.hazriq-fitri95.workers.dev |
| Worker | `fleet-portal` |
| Database | D1 `fleet` (`e4bdd9c3-e885-42de-a709-4daf8f4a6edb`) |
| Access team | `effortless-hf95.cloudflareaccess.com` |
| Access app | "fleet-portal - Cloudflare Workers", policy `fleet-portal-allowlist` |
| Identity provider | Google (not Google Workspace) |

Deployed and working end to end. Migrations are applied locally and remotely:
14 tables, 4 views, 19 seeded part types, foreign keys enforced.

Data currently in production: one user, one garage, two vehicles (Waja, City),
**no odometer readings and no service history**. Every maintenance row is
therefore `unknown`, which is correct rather than broken — see the "no
baseline" trap in CLAUDE.md.

---

## What works

Verified against the deployed app, not just the test suite.

- Cloudflare Access sign-in via Google, restricted to an email allowlist
- First-login bootstrap: user, garage, owner membership, default settings
- Dashboard: attention list, vehicle cards, stale-odometer warnings
- Add a vehicle, with intervals seeded from part-type defaults filtered by fuel
- Quick odometer update from the dashboard (§8.5)
- Vehicle detail: nickname, odometer, maintenance list (a "Phase 1 slice")
- Every Phase 1 API endpoint
- 40 tests: tenant isolation, derived logic, and the Access JWT fallback

---

## What is not built

The API is complete for Phase 1. All of the following are **client gaps** —
the endpoints exist and are covered by the isolation suite.

| Gap | Spec | Why it matters |
|---|---|---|
| Service records and line items | §8.4 | Without it no maintenance can be recorded at all, so every clock stays `unknown` forever |
| Renewals | §4.6, §6.3 | Road tax and insurance are half the reason the app exists |
| Vehicle edit and delete | §10 | A typo in a plate is currently permanent |
| Interval inline editing | §8.2 | Cannot override a manufacturer default |
| Add-vehicle baseline prompt | §8.3 | Spec says prompt for baselines after saving; it currently saves and dismisses, which is how both vehicles ended up with no odometer |
| Vehicle detail overview | §8.2 | Missing specs, inline odometer edit, and usage rate with confidence indicator |
| Settings | §8.7 | Not in the Phase 1 list; `GET /api/me` and `PATCH /api/me/settings` exist |

Deferred by design: Budgets (§8.6) is Phase 2, multi-user is Phase 3, backups
and reminders are Phase 4.

---

## Next: service records (§8.4)

The highest-value remaining work, and the most intricate thing in Phase 1.
Worth building on its own rather than bundling with renewals.

The spec calls this "the highest-friction flow, needing the most care" and asks
for behaviour that does not fall out of a plain form:

1. Vehicle → date (default today) → odometer (prefilled, validated ≥ current)
   → workshop → line items.
2. **The part picker pins the vehicle's overdue and due-soon items to the top.**
   This is the feature that makes the flow fast; without it the user hunts
   through 19 part types while standing in a workshop.
3. Brand and spec autocomplete from the garage's own history —
   `GET /api/part-types/:id/brands` already returns this.
4. Total cost is entered **separately** from item costs. Labour and sundries
   are real costs but not line items, so the total may legitimately exceed the
   sum of the parts. Do not compute one from the other.
5. On save, confirm which clocks were reset.

Endpoints, all built: `POST /api/vehicles/:id/services`,
`GET /api/vehicles/:id/services`, `PATCH /api/services/:id`,
`DELETE /api/services/:id`, `GET /api/part-types`,
`GET /api/part-types/:id/brands`.

Invariant to keep in view while building it: **a `service_item` resets the
maintenance clock, not the `service_record`.** A visit saved with no line items
resets nothing, and that is deliberate. `tests/derived.test.ts` already asserts
both halves of this.

Money is `INTEGER` sen throughout. Convert at the UI boundary only.

**Then renewals**, which is comparatively simple and mirrors what already
exists — with the caveat that renewing **inserts a new row** and never updates
`expires_on` in place.

---

## Picking this up on another machine

```bash
git clone https://github.com/hzrqftr/odometry.git
cd odometry
npm install
npx wrangler login        # needs a real terminal; opens a browser
npm run db:apply:local    # local D1, safe to re-run
npm run dev               # http://localhost:5173
npm test
```

`wrangler dev` supplies a simulated Access identity through the `access.dev`
block in `wrangler.jsonc`, so local development needs no Cloudflare Access and
no login. The local database starts empty and is separate from production.

Deploying:

```bash
npm run deploy
```

### Things that will confuse you otherwise

- **`github.com` is blocked on the home ISP.** `git push` hangs for ~21
  seconds and fails, while `gh` commands succeed, because those hit
  `api.github.com`. It is not a git or credential problem. Tether to a phone
  hotspot and retry. Unknown whether this affects other networks.
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
