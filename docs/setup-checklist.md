# Setup checklist

Things that must happen in a browser, on your account, before this runs for real.
None of it can be scripted from here.

Do them in this order. Steps 1–3 have to be done before step 4 will work at all.

---

## 1. Create the D1 database (terminal, one command)

```bash
npx wrangler d1 create fleet
```

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

## 2. Create the Google OAuth client

Google Cloud Console → **APIs & Services** → **Credentials** →
**Create credentials** → **OAuth client ID** → application type **Web application**.

Authorised redirect URI — replace `<team-name>` with your Zero Trust team name
(step 3 shows it to you; if you have not set one yet, do step 3 first and come back):

```
https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback
```

Keep the **Client ID** and **Client secret** on screen for the next step.

---

## 3. Add Google as the identity provider

Cloudflare dashboard → **Zero Trust** → **Settings** → **Authentication** →
**Login methods** → **Add new**.

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
**Access** tab → **Protect this Worker behind Access**.

Doing it at the Worker level rather than per-hostname covers the `workers.dev`
URL, every preview URL, and any custom domain you add later, all at once. There
is nothing to redo if you buy a domain in six months.

---

## 5. Set the email allowlist

Zero Trust → **Access** → **Applications** → the application created in step 4 →
**Policies** → the policy → **Include** → selector **Emails** → add addresses.

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
