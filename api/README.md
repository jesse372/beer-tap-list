# ontap-api — accounts and per-brewery boards

A **second** Worker, separate from the one that publishes the original board. That one
writes a single tap list to a GitHub repo and has been running in a shed for days; it
must keep working, for free, whatever happens here. Nothing in this directory touches it.

## Why it looks like this

**Boards are public URLs.** A brewery's tap list is served from `/b/<slug>.json` with no
sign-in. The slug is long and random rather than secret. That keeps a board a cacheable
static read: free to serve, works when the venue's wifi drops, and a Fire Stick can never
be logged out of it.

**The browser does the password work.** Workers' free plan allows 10ms of CPU per request,
and a password hash worth having costs far more. So the browser derives an `authKey` from
the password with 250,000 PBKDF2 iterations salted with the email address, and only that
key is sent. The server applies a cheap second pass with a random per-user salt before
storing. The plaintext never leaves the device, and a stolen database still cannot be
cracked without redoing 250,000 iterations per guess — all without a paid plan.

**Conflict detection lives on the server.** Every save carries the `rev` it was based on
and is refused with 409 if the board has moved on. Two people with the editor open cannot
silently overwrite each other, which is exactly what kept happening on the single-file
version.

## Running it locally

No Cloudflare account needed:

```bash
cd api
npx wrangler d1 execute ontap --local --file=schema.sql
npx wrangler dev --local --port 8787
```

## Deploying (when you're ready)

```bash
npx wrangler d1 create ontap          # put the printed id into wrangler.toml
npx wrangler d1 execute ontap --remote --file=schema.sql
npx wrangler deploy
```

Free tier covers D1 (5GB, 5M reads/day) and Workers (100k requests/day) — no fixed cost
until there are real customers.

## Routes

| | |
|---|---|
| `GET /b/:slug.json` | the tap list — public, cached 30s |
| `POST /v1/signup` | `{ email, authKey, brewery }` |
| `POST /v1/login` | `{ email, authKey }` → `{ token, expires }` |
| `POST /v1/logout` | |
| `GET /v1/me` | |
| `GET /v1/board` | → `{ data, rev, updated }` |
| `PUT /v1/board` | `{ data, rev }` — 409 if `rev` is stale |

## Still to do

- Password reset (needs an email service; a free tier covers a long way)
- Stripe subscriptions, and a plan gate on signup
- Staff invitations — the `members` table already allows them, no migration needed
- A sign-in page and pointing the editor at this instead of GitHub
