/**
 * ontap-api — accounts and per-brewery tap lists.
 *
 * This is a SECOND Worker on purpose. The original one publishes a single board to a
 * GitHub repo and has been running in a shed for days; it must keep working, for free,
 * no matter what happens in here. Nothing in this file touches it.
 *
 * Public
 *   GET  /b/:slug.json            the board's tap list — no auth, cacheable
 *   GET  /health
 *
 * Accounts
 *   POST /v1/signup   { email, authKey, brewery }
 *   POST /v1/login    { email, authKey }         -> { token, expires }
 *   POST /v1/logout
 *   GET  /v1/me
 *
 * Board
 *   GET  /v1/board                               -> { data, updated, rev }
 *   PUT  /v1/board    { data, rev }              rev must match, or 409
 *
 * ---------------------------------------------------------------------------
 * A note on passwords, because the shape here is unusual and deliberate.
 *
 * Workers' free plan allows 10ms of CPU per request. A password hash worth having
 * (PBKDF2 at OWASP's ~600k iterations) costs far more than that, and moving to a paid
 * plan for it would put a fixed monthly cost on a product with no customers yet.
 *
 * So the expensive work happens in the browser: it derives an "authKey" from the
 * password with 250k PBKDF2 iterations, salted with the email address, and only that
 * key is ever sent. The server then applies its own cheap PBKDF2 pass with a random
 * per-user salt before storing.
 *
 * What that buys: the plaintext password never leaves the device, and a stolen
 * database still cannot be cracked without redoing the browser's 250k iterations per
 * guess. What it costs: the client must be trusted to do its part, so the authKey is
 * treated as the password would be — TLS only, never logged.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

const SESSION_DAYS = 30;
const SERVER_ITERATIONS = 50000;   // ~5ms, inside the 10ms budget with room to spare
const MAX_BOARD_BYTES = 3_000_000;
const LOCKOUT_FAILS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------------- helpers */

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...JSON_HEADERS, ...(extra || {}) },
  });
}

function cors(env, request) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin") || "";
  const ok = allowed.includes("*") ? "*" : (allowed.includes(origin) ? origin : allowed[0] || "");
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Comparison whose duration does not depend on where two values differ. */
function safeEqual(a, b) {
  const x = enc.encode(String(a || "")), y = enc.encode(String(b || ""));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
}

/** The server's cheap second pass over the browser-derived key. */
async function derive(authKey, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(authKey)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(String(salt)), iterations: SERVER_ITERATIONS },
    key, 256,
  );
  return hex(bits);
}

const now = () => Date.now();
const id = () => randomHex(12);

/** Long enough that guessing a board URL is hopeless, short enough to retype. */
const newSlug = () => randomHex(9);

function validEmail(e) {
  return typeof e === "string" && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e.trim()) && e.length <= 200;
}

/* ------------------------------------------------------------------ auth */

async function sessionUser(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return null;
  const th = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).bind(th).first();
  if (!row) return null;
  if (Number(row.expires) < now()) {
    // Tidy up as we go, so expired rows do not accumulate without a cron job.
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(th).run();
    return null;
  }
  return { id: row.user_id, email: row.email, tokenHash: th };
}

/** The brewery a user may edit. One each for now; the table already allows more. */
async function breweryFor(env, userId) {
  return env.DB.prepare(
    `SELECT b.id, b.slug, b.name, b.plan, m.role
       FROM members m JOIN breweries b ON b.id = m.brewery_id
      WHERE m.user_id = ? ORDER BY m.created LIMIT 1`).bind(userId).first();
}

/* ---------------------------------------------------------------- routes */

export default {
  async fetch(request, env) {
    const co = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: co });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/health") return json({ ok: true }, 200, co);

    // ---- public board read -------------------------------------------------
    // Static, cacheable, no auth. This is what keeps a board free to serve and
    // able to survive the venue's wifi dropping.
    const board = /^\/b\/([A-Za-z0-9_-]{6,64})\.json$/.exec(path);
    if (board && request.method === "GET") {
      const row = await env.DB.prepare(
        `SELECT bo.data, bo.updated FROM boards bo
           JOIN breweries br ON br.id = bo.brewery_id
          WHERE br.slug = ?`).bind(board[1]).first();
      if (!row) return json({ error: "No such board" }, 404, co);
      return new Response(row.data, {
        headers: {
          ...JSON_HEADERS, ...co,
          // Short cache: the board polls every 60s, so a minute of staleness is
          // invisible, and it keeps D1 reads down as screens multiply.
          "Cache-Control": "public, max-age=30",
          "Last-Modified": new Date(row.updated).toUTCString(),
        },
      });
    }

    let body = {};
    if (request.method === "POST" || request.method === "PUT") {
      try { body = await request.json(); }
      catch (e) { return json({ error: "Bad JSON" }, 400, co); }
    }

    // ---- signup ------------------------------------------------------------
    if (path === "/v1/signup" && request.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const authKey = String(body.authKey || "");
      const name = String(body.brewery || "").trim();

      if (!validEmail(email)) return json({ error: "That email doesn't look right" }, 400, co);
      // 64 hex chars = the 256-bit key the browser is expected to derive. Rejecting
      // anything else stops a client sending a raw password by mistake.
      if (!/^[0-9a-f]{64}$/.test(authKey)) return json({ error: "Bad authKey" }, 400, co);
      if (!name || name.length > 120) return json({ error: "Name your brewery" }, 400, co);

      const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
      if (existing) return json({ error: "There's already an account for that email" }, 409, co);

      const salt = randomHex(16);
      const hash = await derive(authKey, salt);
      const uid = id(), bid = id(), slug = newSlug(), t = now();

      // A signup that half-succeeded would be worse than one that failed, so the
      // account, the brewery, the membership and an empty board go in together.
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id,email,pw_salt,pw_hash,created) VALUES (?,?,?,?,?)`)
          .bind(uid, email, salt, hash, t),
        env.DB.prepare(`INSERT INTO breweries (id,slug,name,plan,created) VALUES (?,?,?,?,?)`)
          .bind(bid, slug, name, "trial", t),
        env.DB.prepare(`INSERT INTO members (user_id,brewery_id,role,created) VALUES (?,?,?,?)`)
          .bind(uid, bid, "owner", t),
        env.DB.prepare(`INSERT INTO boards (brewery_id,data,updated,rev) VALUES (?,?,?,1)`)
          .bind(bid, JSON.stringify(starterBoard(name)), new Date(t).toISOString()),
      ]);

      const { token, expires } = await startSession(env, uid);
      return json({ ok: true, token, expires, brewery: { slug, name, plan: "trial" } }, 200, co);
    }

    // ---- login -------------------------------------------------------------
    if (path === "/v1/login" && request.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const authKey = String(body.authKey || "");
      if (!email || !authKey) return json({ error: "Email and password, please" }, 400, co);

      const att = await env.DB.prepare(`SELECT fails, last FROM login_attempts WHERE key = ?`)
        .bind(email).first();
      if (att && Number(att.fails) >= LOCKOUT_FAILS && now() - Number(att.last) < LOCKOUT_MS) {
        return json({ error: "Too many attempts — try again in a few minutes" }, 429, co);
      }

      const u = await env.DB.prepare(`SELECT id, pw_salt, pw_hash FROM users WHERE email = ?`)
        .bind(email).first();

      // Derive either way, so a missing account and a wrong password take the same
      // time and cannot be told apart from the outside.
      const candidate = await derive(authKey, u ? u.pw_salt : "absent");
      const good = !!u && safeEqual(candidate, u.pw_hash);

      if (!good) {
        await env.DB.prepare(
          `INSERT INTO login_attempts (key,fails,last) VALUES (?,1,?)
           ON CONFLICT(key) DO UPDATE SET fails = fails + 1, last = excluded.last`)
          .bind(email, now()).run();
        return json({ error: "Wrong email or password" }, 401, co);
      }

      await env.DB.batch([
        env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(email),
        env.DB.prepare(`UPDATE users SET last_login = ? WHERE id = ?`).bind(now(), u.id),
      ]);
      const { token, expires } = await startSession(env, u.id);
      const br = await breweryFor(env, u.id);
      return json({ ok: true, token, expires, brewery: br || null }, 200, co);
    }

    // ---- everything below needs a session ----------------------------------
    const me = await sessionUser(env, request);

    if (path === "/v1/logout" && request.method === "POST") {
      if (me) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(me.tokenHash).run();
      return json({ ok: true }, 200, co);
    }

    if (!me) return json({ error: "Not signed in" }, 401, co);

    if (path === "/v1/me" && request.method === "GET") {
      const br = await breweryFor(env, me.id);
      return json({ ok: true, email: me.email, brewery: br || null }, 200, co);
    }

    if (path === "/v1/board") {
      const br = await breweryFor(env, me.id);
      if (!br) return json({ error: "No brewery on this account" }, 404, co);

      if (request.method === "GET") {
        const row = await env.DB.prepare(
          `SELECT data, updated, rev FROM boards WHERE brewery_id = ?`).bind(br.id).first();
        if (!row) return json({ error: "No board" }, 404, co);
        return json({ ok: true, slug: br.slug, rev: row.rev, updated: row.updated,
                      data: JSON.parse(row.data) }, 200, co);
      }

      if (request.method === "PUT") {
        if (typeof body.data !== "object" || body.data === null) {
          return json({ error: "Nothing to save" }, 400, co);
        }
        const text = JSON.stringify(body.data);
        if (text.length > MAX_BOARD_BYTES) return json({ error: "That's too big" }, 413, co);

        const cur = await env.DB.prepare(`SELECT rev FROM boards WHERE brewery_id = ?`)
          .bind(br.id).first();
        // Conflict detection belongs here, not only in the browser: two people with
        // the page open should not be able to silently overwrite each other, which is
        // exactly what kept happening on the single-file version.
        if (cur && Number(body.rev) !== Number(cur.rev)) {
          return json({ error: "Someone else saved first", rev: cur.rev }, 409, co);
        }

        const stamp = new Date().toISOString();
        const rev = (cur ? Number(cur.rev) : 0) + 1;
        await env.DB.prepare(
          `INSERT INTO boards (brewery_id,data,updated,rev) VALUES (?,?,?,?)
           ON CONFLICT(brewery_id) DO UPDATE SET data=excluded.data, updated=excluded.updated, rev=excluded.rev`)
          .bind(br.id, text, stamp, rev).run();
        return json({ ok: true, rev, updated: stamp, slug: br.slug }, 200, co);
      }
    }

    return json({ error: "Unknown route" }, 404, co);
  },
};

async function startSession(env, userId) {
  const token = randomHex(32);
  const expires = now() + SESSION_DAYS * 86400 * 1000;
  await env.DB.prepare(`INSERT INTO sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)`)
    .bind(await sha256Hex(token), userId, now(), expires).run();
  return { token, expires };
}

/** A new board should show something, not an empty screen. */
function starterBoard(name) {
  return {
    brewery: name,
    tagline: "",
    showClock: true,
    perPage: "auto",
    rotateSeconds: 15,
    hideKicked: false,
    dimAtNight: false,
    bg: "charcoal",
    updated: new Date().toISOString(),
    taps: [
      { num: 1, name: "", style: "", abv: "", ibu: "", srm: 6,
        color: "#e0a63a", icon: "pint", level: 100, status: "pouring", notes: "" },
    ],
  };
}
