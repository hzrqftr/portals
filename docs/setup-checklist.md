# Setup checklist

Things that must happen in a browser, on your account, before this runs for real.
None of it can be scripted from here.

Do them in this order. Steps 1–3 have to be done before step 4 will work at all.

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

It prints a `database_id`. Paste it into `wrangler.jsonc`, replacing
`PLACEHOLDER_REPLACE_WITH_REAL_ID`. Then:

```bash
npm run db:apply:local     # local dev database
npm run db:apply:remote    # the real one
```

Verify foreign keys are actually being enforced — D1 has not always defaulted to
on, and a silent no-op here means bad references get written without complaint:

```bash
npx wrangler d1 execute fleet --local --command "PRAGMA foreign_keys"
```

Expect `1`. If it comes back `0`, tell me and I will add explicit checks in the
repositories instead of relying on the database.

---

## 2. Fix your team name first, then create the Google OAuth client

**Do the team name before anything else.** Cloudflare assigns a random one like
`nameless-dew-06ed`, and it becomes the domain your redirect URI is built from.
Rename it afterwards and you have to go back and re-edit the URI in Google.

Cloudflare dashboard → **Cloudflare One** → **Settings** → **Team name** → **Edit**.
Lowercase letters, numbers and hyphens; globally unique across all of Cloudflare.
It appears in the sign-in URL your family sees, so pick something shareable.

Note the resulting **team domain**: `<team-name>.cloudflareaccess.com`.

Now: Google Cloud Console → **APIs & Services** → **Credentials** →
**Create credentials** → **OAuth client ID** → application type **Web application**.

Authorised redirect URI — the **full path matters**, not just the domain. Google
requires an exact string match, and registering the bare domain gives you
`Error 400: redirect_uri_mismatch` with no hint as to which part is wrong:

```
https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback
```

Leave **Authorised JavaScript origins** empty — this is a server-side flow.

Keep the **Client ID** and **Client secret** on screen for the next step.

---

## 3. Add Google as the identity provider

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

Paste in the Client ID and secret from step 2, then **Test** the connection.

---

## 4. Protect the Worker with Access

Deploy once first, so the Worker exists:

```bash
npm run deploy
```

Then: Cloudflare dashboard → **Workers & Pages** → **fleet-portal** →
**Domains** tab → on the Production row, **Enable Access**.

Do not mistake the blue toggle on the right for Access — that only controls
whether the `workers.dev` URL is served at all. The row tells you the real
state: while it reads *"Anyone with this URL can visit"*, you are unprotected.

In the **Manage Worker access** dialog:

- **Scope** → **All traffic**. "Previews only" leaves the real app public.
- **Authentication policy** → the allowlist policy from step 5. Neither
  pre-configured option works here: *Cloudflare account* admits only members of
  your Cloudflare account, so family members can never sign in, and *Email
  domain* admits every verified address on your domain — which, on a personal
  `@gmail.com`, is the entire internet.

Since August 2026 the policy attaches to the Worker itself, so the `workers.dev`
URL, every preview URL, and any custom domain you add later are all covered at
once. There is nothing to redo if you buy a domain in six months.

**Deploy a second time after enabling Access**, then check the app loads.

If the app returns `{"error":"unauthorized","message":"Worker is not protected
by Access"}` while the browser clearly made you sign in, the runtime is not
populating `ctx.access` even though Access is enabled and forwarding a valid
assertion. That happened on 2026-08-20 with a correctly configured
Worker-attached application, so it is not hypothetical.

`auth.ts` handles it: it verifies the `Cf-Access-Jwt-Assertion` header itself
using `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`. Both must match
your account — the audience tag is on the application's **Overview** tab as
*Application Audience (AUD) Tag*. Update them if you ever rename the team or
recreate the Access application, or every request will 401.

One visible symptom of running on that fallback: the assertion carries no
display name, so `users.display_name` is null where `ctx.access` would have
filled it in.

---

## 5. Set the email allowlist

Step 4 will not let you finish without a policy, so build this one first and
come back to it — or create it when the dialog blocks you.

Cloudflare One → **Access controls** → **Policies** → **Add policy**.

- **Selector** → **Emails**, **Value** → your address. One address per include
  rule; **+ Add include (OR)** adds the next person.
- **Policy Name** → something recognisable, e.g. `fleet-portal-allowlist`.
- **Action** → **Allow**.
- **Policy session duration** → blank inherits the global default, typically 24
  hours, which means signing in daily. A week or a month is friendlier for an
  app you check occasionally.
- Leave MFA, purpose justification and temporary authentication **off**. They
  are aimed at corporate deployments and only add friction here.

Do not use the **Emails ending in** selector. The only thing you could put there
is `@gmail.com`.

This is the entire user management system. Access is an allowlist: there is no
signup, and every person who will ever log in gets typed in here by you. Adding
your own address is what makes step 6 work.

---

## 6. Confirm it works end to end

Visit the `workers.dev` URL in a private window. You should get a Google sign-in,
then the dashboard — empty, with an invitation to add a vehicle.

If you get the dashboard **without** signing in, stop: Access is not attached,
and the app is publicly readable. Re-check step 4.

---

## Ongoing

- **Adding or removing a user:** step 5, add or delete the email. Takes effect
  immediately; no deploy needed.
- **The 50-user ceiling:** the free Zero Trust plan stops admitting new users at
  50, and seats are held until you remove someone. Not a concern at family scale,
  but it is a wall rather than a bill.
- **Watching CPU:** `npx wrangler tail` shows live logs including CPU warnings.
  Error 1102 means something started computing in JavaScript that belongs in SQL.

## Not yet done

Backups. D1 has point-in-time recovery, but this database will eventually hold
years of maintenance history that exists nowhere else, and free-tier retention
should be checked rather than assumed. Spec §11.6 puts a weekly export to R2 in
Phase 4 — worth pulling forward if you bulk-enter historical records, because
that is exactly when the data becomes expensive to recreate.
