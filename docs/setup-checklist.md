# Setup checklist

Things that must happen in a browser, on your account, before this runs for
real. None of it can be scripted from here.

**This covers BOTH portals.** Odometry (the Worker `fleet-portal`) and Coinbox
(the Worker `coinbox`) share one D1 database and one identity provider, but
each is protected by **its own Access application with its own audience tag**.
Doing this for one portal and not the other leaves the second one either
publicly readable or unable to authenticate anybody.

Do them in this order. Steps 1–4 have to be done before step 5 will work at
all.

---

## 1. Create the D1 database (terminal, one command)

```bash
npx wrangler d1 create fleet
```

Log in first, in a real terminal window — `npx wrangler login` opens a browser
and needs a TTY, so it fails from any non-interactive shell:

```bash
npx wrangler login
npx wrangler whoami     # confirms account before you create anything
```

If some other wrangler command offers to *"add it on your behalf"* and asks for
a binding name, answer **no**. That wizard rewrites `wrangler.jsonc` wholesale —
reindenting the file and appending a second `d1_databases` entry beside the
existing one. The binding must be `DB`; anything else leaves `env.DB` undefined
and every repository fails at runtime with an error that points nowhere useful.

**The database is called `fleet` for historical reasons — it predates Coinbox.**
It holds both portals. Renaming a D1 database is a dashboard action with no
upside and the name is invisible to users, so this is not an oversight.

It prints a `database_id`. **It goes in three files, and all three must
match**, because both Workers and the migration runner each need to name the
same database:

| File | Why it needs it |
|---|---|
| `wrangler.jsonc` (repo root) | Declares no Worker. It exists only so `wrangler d1` commands have one unambiguous home |
| `apps/odometry/wrangler.jsonc` | The `fleet-portal` Worker |
| `apps/coinbox/wrangler.jsonc` | The `coinbox` Worker |

Then apply the migrations. There is **one** `migrations/` folder, at the repo
root, holding one linear sequence for the one shared database:

```bash
npm run db:apply:local     # local dev database
npm run db:apply:remote    # the real one
```

Verify foreign keys are actually being enforced — D1 has not always defaulted
to on, and a silent no-op here means bad references get written without
complaint:

```bash
npm run db:query:local -- --command "PRAGMA foreign_keys"
```

Use that script rather than a bare `npx wrangler d1 execute`. It carries
`--persist-to .wrangler/state` and `-c wrangler.jsonc`, and without both you
are talking to a *different*, empty local database and will not know it.

Expect `1`. If it comes back `0`, say so and the repositories can carry
explicit checks instead of relying on the database.

---

## 2. Create the two R2 buckets

Two buckets, for two unrelated jobs. Cloudflare dashboard → **R2 Object
Storage** → **Create bucket**:

| Bucket | Binding | What it holds | If it is missing |
|---|---|---|---|
| `portals-backup` | `BACKUPS` | The nightly whole-database export | The backup job logs that it skipped and does nothing. Silent |
| `portals-docs` | `DOCS` | Receipts attached to service records | **Receipt upload fails loudly.** `DOCS` is required, deliberately |

That difference is on purpose. A backup that skips a missing binding is a
no-op you can fix later; an upload that skipped one would report success for a
file it never stored.

They are kept apart because the backup pruner deletes by prefix on a schedule,
and receipts must never be one edit to that logic away from expiring.

**`portals-docs` is not backed up by anything.** Not by the nightly export, not
by D1 Time Travel. That gap is deliberate and is written up in
`docs/backups.md`; know about it before you rely on it.

---

## 3. Fix your team name first, then create the Google OAuth client

**Do the team name before anything else.** Cloudflare assigns a random one like
`nameless-dew-06ed`, and it becomes the domain your redirect URI is built from.
Rename it afterwards and you have to go back and re-edit the URI in Google.

Cloudflare dashboard → **Cloudflare One** → **Settings** → **Team name** → **Edit**.
Lowercase letters, numbers and hyphens; globally unique across all of Cloudflare.
It appears in the sign-in URL your family sees, so pick something shareable.

Note the resulting **team domain**: `<team-name>.cloudflareaccess.com`. It goes
into `vars.ACCESS_TEAM_DOMAIN` in **both** apps' `wrangler.jsonc`.

Now: Google Cloud Console → **APIs & Services** → **Credentials** →
**Create credentials** → **OAuth client ID** → application type **Web application**.

Authorised redirect URI — the **full path matters**, not just the domain. Google
requires an exact string match, and registering the bare domain gives you
`Error 400: redirect_uri_mismatch` with no hint as to which part is wrong:

```
https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback
```

**One OAuth client covers both portals.** The redirect URI belongs to the team
domain, not to an application, so there is nothing per-portal here. The
per-portal part is step 6.

Leave **Authorised JavaScript origins** empty — this is a server-side flow.

Keep the **Client ID** and **Client secret** on screen for the next step.

---

## 4. Add Google as the identity provider

Cloudflare renamed Zero Trust to **Cloudflare One**. Clicking "Zero Trust"
lands you there; it is the same product.

Cloudflare One → **Integrations** → **Identity providers** →
**Add new identity provider**.

Choose **Google**. **Not Google Workspace.**

This matters more than it looks. The Workspace integration is scoped to a domain
you control, so anyone on a personal `@gmail.com` address — which is most family
members — cannot authenticate against it at all. Picking the wrong one here fails
much later, at the point where you invite someone, and the fix is to delete the
IdP and redo it.

Paste in the Client ID and secret from step 3, then **Test** the connection.

One IdP serves both portals.

---

## 5. Deploy both Workers once, so they exist

Access attaches to a Worker, so the Worker has to be there first.

**There is no `npm run deploy` at the repo root.** Deploying is per portal, and
the `-w` flag picks which:

```bash
npm run deploy -w odometry
npm run deploy -w coinbox
```

Each of those runs the whole workspace's tests, then builds, then applies
migrations to the remote database, then deploys — **in that order, on
purpose.** CLAUDE.md explains why under *Commands*; the short version is that
the migration must land before the code that reads it, and after the code is
known to compile and pass.

---

## 6. Protect BOTH Workers with Access

Do this twice. Once for `fleet-portal`, once for `coinbox`.

Cloudflare dashboard → **Workers & Pages** → *the Worker* → **Domains** tab →
on the Production row, **Enable Access**.

Do not mistake the blue toggle on the right for Access — that only controls
whether the `workers.dev` URL is served at all. The row tells you the real
state: while it reads *"Anyone with this URL can visit"*, you are unprotected.

In the **Manage Worker access** dialog:

- **Scope** → **All traffic**. "Previews only" leaves the real app public.
- **Authentication policy** → the allowlist policy from step 7. Neither
  pre-configured option works here: *Cloudflare account* admits only members of
  your Cloudflare account, so family members can never sign in, and *Email
  domain* admits every verified address on your domain — which, on a personal
  `@gmail.com`, is the entire internet.

Since August 2026 the policy attaches to the Worker itself, so the `workers.dev`
URL, every preview URL, and any custom domain you add later are all covered at
once. There is nothing to redo if you buy a domain in six months.

### Then copy each application's audience tag into its own config

This is the step that is easy to do for one portal and forget for the other.

Cloudflare One → **Access controls** → **Applications** → *the application* →
**Overview** → **Application Audience (AUD) Tag**.

| Application | Goes into |
|---|---|
| `fleet-portal` | `vars.ACCESS_AUD` in `apps/odometry/wrangler.jsonc` |
| `coinbox` | `vars.ACCESS_AUD` in `apps/coinbox/wrangler.jsonc` |

**The two tags must be different, and each portal must only accept its own.**
A token minted for the fleet portal would otherwise open the ledger — which is
the exact leak the whole two-portal design exists to prevent. Sharing a garage
so someone can see service schedules must never expose your ledger.

**Deploy each portal a second time after enabling Access**, then check both
apps load.

If an app returns `{"error":"unauthorized","message":"Worker is not protected
by Access"}` while the browser clearly made you sign in, the runtime is not
populating `ctx.access` even though Access is enabled and forwarding a valid
assertion. That happened on 2026-08-20 with a correctly configured
Worker-attached application, so it is not hypothetical.

`packages/core/src/worker/auth.ts` handles it — one file, both portals: it
verifies the `Cf-Access-Jwt-Assertion` header itself using `ACCESS_TEAM_DOMAIN`
and `ACCESS_AUD`. Both must match your account. Update them if you ever rename
the team or recreate an Access application, or every request will 401.

One visible symptom of running on that fallback: the assertion carries no
display name, so `users.display_name` is null where `ctx.access` would have
filled it in.

---

## 7. Set the email allowlist

Step 6 will not let you finish without a policy, so build this one first and
come back to it — or create it when the dialog blocks you.

Cloudflare One → **Access controls** → **Policies** → **Add policy**.

- **Selector** → **Emails**, **Value** → your address. One address per include
  rule; **+ Add include (OR)** adds the next person.
- **Policy Name** → something recognisable, e.g. `portals-allowlist`.
- **Action** → **Allow**.
- **Policy session duration** → blank inherits the global default, typically 24
  hours, which means signing in daily. A week or a month is friendlier for an
  app you check occasionally.
- Leave MFA, purpose justification and temporary authentication **off**. They
  are aimed at corporate deployments and only add friction here.

Do not use the **Emails ending in** selector. The only thing you could put there
is `@gmail.com`.

**One policy can serve both applications**, and that is usually what you want —
but it is a decision, not a default. Attaching the same policy to both means
anyone who can see the fleet can also open the ledger. If you ever add a family
member who should see vehicles but not money, they need a **second policy** on
`fleet-portal` only. The database already enforces the separation; the policy
is what decides who gets through the front door of each portal.

This is the entire user management system. Access is an allowlist: there is no
signup, and every person who will ever log in gets typed in here by you.

---

## 8. Confirm it works end to end

Visit **both** `workers.dev` URLs in a private window. Each should give you a
Google sign-in, then the app — Odometry empty with an invitation to add a
vehicle, Coinbox with its dashboard.

If either gives you the app **without** signing in, stop: Access is not attached
to that Worker, and it is publicly readable. Re-check step 6 for that portal
specifically. Getting it right for one says nothing about the other.

---

## Ongoing

- **Adding or removing a user:** step 7, add or delete the email. Takes effect
  immediately; no deploy needed. Remember it may be attached to both portals.
- **The 50-user ceiling:** the free Zero Trust plan stops admitting new users at
  50, and seats are held until you remove someone. Not a concern at family scale,
  but it is a wall rather than a bill.
- **Watching CPU:** Error 1102 means something started computing in JavaScript
  that belongs in SQL. `npx wrangler tail -c apps/odometry/wrangler.jsonc` shows
  live logs — **but it prints nothing from a non-interactive shell, even for
  live traffic.** `observability.enabled` is switched on in both apps'
  configs for exactly that reason; the dashboard's **Logs** tab keeps them
  after the fact, which is when you usually need them.
- **Backups:** running since 2026-08-28. Nightly to R2, 90-day retention, both
  portals in one file because there is one database. `docs/backups.md` is the
  operating manual, and it is also published as a private page (linked from
  CLAUDE.md) so it is reachable when the machine holding this repo is not.

## Deliberately not set up

- **Alerting on a failed backup.** The logs are kept, but nothing notifies you.
  Real alerting needs an email provider that is not configured. Checking after
  any week that matters is the honest answer for now.
- **Off-Cloudflare copies.** Every backup sits in the same account as the
  database it protects. Downloading one file a month to your own machine closes
  the largest remaining gap and takes a minute.
- **Receipt file backups.** See step 2 — `portals-docs` is outside both nets.
