var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var JSON_HEADERS = { "Content-Type": "application/json" };
var SESSION_DAYS = 30;
var SERVER_ITERATIONS = 5e4;
var MAX_BOARD_BYTES = 3e6;
var LOCKOUT_FAILS = 8;
var LOCKOUT_MS = 15 * 60 * 1e3;
var INVITE_DAYS = 14;
var RESET_MINUTES = 45;
var PLANS = {
  free: { locations: 1, staff: 0 },
  trial: { locations: 1, staff: 2 },
  pro: { locations: 5, staff: 10 }
};
function limits(plan) {
  return PLANS[plan] || PLANS.free;
}
__name(limits, "limits");
function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...JSON_HEADERS, ...extra || {} }
  });
}
__name(json, "json");
function cors(env, request) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = request.headers.get("Origin") || "";
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const ok = local ? origin : allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "";
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(cors, "cors");
var enc = new TextEncoder();
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hex, "hex");
function randomHex(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}
__name(randomHex, "randomHex");
function safeEqual(a, b) {
  const x = enc.encode(String(a || "")), y = enc.encode(String(b || ""));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
__name(safeEqual, "safeEqual");
async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));
}
__name(sha256Hex, "sha256Hex");
async function derive(authKey, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(authKey)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(String(salt)), iterations: SERVER_ITERATIONS },
    key,
    256
  );
  return hex(bits);
}
__name(derive, "derive");
var now = /* @__PURE__ */ __name(() => Date.now(), "now");
var id = /* @__PURE__ */ __name(() => randomHex(12), "id");
var newSlug = /* @__PURE__ */ __name(() => randomHex(9), "newSlug");
function validEmail(e) {
  return typeof e === "string" && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e.trim()) && e.length <= 200;
}
__name(validEmail, "validEmail");
async function sendEmail(env, to, subject, text) {
  if (env.RESEND_KEY) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.MAIL_FROM || "On Tap <noreply@example.com>",
        to: [to],
        subject,
        text
      })
    });
    return r.ok;
  }
  console.log("[email not sent \u2014 no provider configured]", { to, subject, text });
  return false;
}
__name(sendEmail, "sendEmail");
async function stripeSigned(env, rawBody, header) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return false;
  const parts = {};
  String(header).split(",").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  if (!parts.t || !parts.v1) return false;
  if (Math.abs(Date.now() / 1e3 - Number(parts.t)) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(parts.t + "." + rawBody));
  return safeEqual(hex(mac), parts.v1);
}
__name(stripeSigned, "stripeSigned");
async function sessionUser(env, request) {
  const auth = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(\S+)$/i.exec(auth);
  if (!m) return null;
  const th = await sha256Hex(m[1]);
  const row = await env.DB.prepare(
    `SELECT s.user_id, s.expires, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`
  ).bind(th).first();
  if (!row) return null;
  if (Number(row.expires) < now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(th).run();
    return null;
  }
  return { id: row.user_id, email: row.email, tokenHash: th };
}
__name(sessionUser, "sessionUser");
async function breweriesFor(env, userId) {
  const r = await env.DB.prepare(
    `SELECT b.id, b.slug, b.name, b.plan, m.role
       FROM members m JOIN breweries b ON b.id = m.brewery_id
      WHERE m.user_id = ? ORDER BY m.created`
  ).bind(userId).all();
  return r && r.results || [];
}
__name(breweriesFor, "breweriesFor");
async function pickBrewery(env, userId, want) {
  const list = await breweriesFor(env, userId);
  if (!list.length) return null;
  if (!want) return list[0];
  return list.find((b) => b.id === want || b.slug === want) || null;
}
__name(pickBrewery, "pickBrewery");
function isOwner(b) {
  return b && b.role === "owner";
}
__name(isOwner, "isOwner");
var src_default = {
  async fetch(request, env) {
    const co = cors(env, request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: co });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/health") return json({ ok: true }, 200, co);
    const board = /^\/b\/([A-Za-z0-9_-]{6,64})\.json$/.exec(path);
    if (board && request.method === "GET") {
      const row = await env.DB.prepare(
        `SELECT bo.data, bo.updated FROM boards bo
           JOIN breweries br ON br.id = bo.brewery_id
          WHERE br.slug = ?`
      ).bind(board[1]).first();
      if (!row) return json({ error: "No such board" }, 404, co);
      return new Response(row.data, {
        headers: {
          ...JSON_HEADERS,
          ...co,
          // Short cache: the board polls every 60s, so a minute of staleness is
          // invisible, and it keeps D1 reads down as screens multiply.
          "Cache-Control": "public, max-age=30",
          "Last-Modified": new Date(row.updated).toUTCString()
        }
      });
    }
    if (path === "/v1/stripe/webhook" && request.method === "POST") {
      const raw = await request.text();
      if (!await stripeSigned(env, raw, request.headers.get("Stripe-Signature"))) {
        return json({ error: "Bad signature" }, 400, co);
      }
      let ev = {};
      try {
        ev = JSON.parse(raw);
      } catch (e) {
        return json({ error: "Bad JSON" }, 400, co);
      }
      const o = ev.data && ev.data.object || {};
      const bid = o.metadata && o.metadata.brewery_id || null;
      const status = o.status || null;
      const until = o.current_period_end ? Number(o.current_period_end) * 1e3 : null;
      if (ev.type === "checkout.session.completed" && bid) {
        await env.DB.prepare(
          `UPDATE breweries SET plan='pro', sub_status='active',
                  stripe_customer=?, stripe_subscription=? WHERE id=?`
        ).bind(o.customer || null, o.subscription || null, bid).run();
      } else if (/^customer\.subscription\./.test(ev.type || "")) {
        const where = bid ? "id = ?" : "stripe_subscription = ?";
        const key = bid || o.id;
        const lapsed = ev.type === "customer.subscription.deleted" || status === "canceled" || status === "unpaid";
        await env.DB.prepare(
          `UPDATE breweries SET plan = ?, sub_status = ?, sub_until = ? WHERE ` + where
        ).bind(lapsed ? "free" : "pro", lapsed ? "canceled" : status || "active", until, key).run();
      }
      return json({ ok: true, handled: ev.type || null }, 200, co);
    }
    let body = {};
    if (request.method === "POST" || request.method === "PUT") {
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "Bad JSON" }, 400, co);
      }
    }
    if (path === "/v1/signup" && request.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const authKey = String(body.authKey || "");
      const name = String(body.brewery || "").trim();
      if (!validEmail(email)) return json({ error: "That email doesn't look right" }, 400, co);
      if (!/^[0-9a-f]{64}$/.test(authKey)) return json({ error: "Bad authKey" }, 400, co);
      if (!name || name.length > 120) return json({ error: "Name your brewery" }, 400, co);
      const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
      if (existing) return json({ error: "There's already an account for that email" }, 409, co);
      const salt = randomHex(16);
      const hash = await derive(authKey, salt);
      const uid = id(), bid = id(), slug = newSlug(), t = now();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO users (id,email,pw_salt,pw_hash,created) VALUES (?,?,?,?,?)`).bind(uid, email, salt, hash, t),
        env.DB.prepare(`INSERT INTO breweries (id,slug,name,plan,created) VALUES (?,?,?,?,?)`).bind(bid, slug, name, "trial", t),
        env.DB.prepare(`INSERT INTO members (user_id,brewery_id,role,created) VALUES (?,?,?,?)`).bind(uid, bid, "owner", t),
        env.DB.prepare(`INSERT INTO boards (brewery_id,data,updated,rev) VALUES (?,?,?,1)`).bind(bid, JSON.stringify(starterBoard(name)), new Date(t).toISOString())
      ]);
      const { token, expires } = await startSession(env, uid);
      return json({ ok: true, token, expires, brewery: { slug, name, plan: "trial" } }, 200, co);
    }
    if (path === "/v1/login" && request.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const authKey = String(body.authKey || "");
      if (!email || !authKey) return json({ error: "Email and password, please" }, 400, co);
      const att = await env.DB.prepare(`SELECT fails, last FROM login_attempts WHERE key = ?`).bind(email).first();
      if (att && Number(att.fails) >= LOCKOUT_FAILS && now() - Number(att.last) < LOCKOUT_MS) {
        return json({ error: "Too many attempts \u2014 try again in a few minutes" }, 429, co);
      }
      const u = await env.DB.prepare(`SELECT id, pw_salt, pw_hash FROM users WHERE email = ?`).bind(email).first();
      const candidate = await derive(authKey, u ? u.pw_salt : "absent");
      const good = !!u && safeEqual(candidate, u.pw_hash);
      if (!good) {
        await env.DB.prepare(
          `INSERT INTO login_attempts (key,fails,last) VALUES (?,1,?)
           ON CONFLICT(key) DO UPDATE SET fails = fails + 1, last = excluded.last`
        ).bind(email, now()).run();
        return json({ error: "Wrong email or password" }, 401, co);
      }
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?`).bind(email),
        env.DB.prepare(`UPDATE users SET last_login = ? WHERE id = ?`).bind(now(), u.id)
      ]);
      const { token, expires } = await startSession(env, u.id);
      const list = await breweriesFor(env, u.id);
      return json({ ok: true, token, expires, brewery: list[0] || null, breweries: list }, 200, co);
    }
    if (path === "/v1/reset/request" && request.method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const u = validEmail(email) ? await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first() : null;
      if (u) {
        const token = randomHex(24);
        await env.DB.prepare(
          `INSERT INTO resets (token_hash,user_id,created,expires) VALUES (?,?,?,?)`
        ).bind(await sha256Hex(token), u.id, now(), now() + RESET_MINUTES * 60 * 1e3).run();
        const link = (env.SITE_BASE || "") + "/reset.html?token=" + token;
        await sendEmail(
          env,
          email,
          "Reset your On Tap password",
          "Someone asked to reset the password for this address.\n\n" + link + "\n\nThe link works once and expires in " + RESET_MINUTES + " minutes. If it wasn't you, ignore this \u2014 nothing has changed."
        );
      }
      return json({ ok: true, sent: true }, 200, co);
    }
    if (path === "/v1/reset/confirm" && request.method === "POST") {
      const token = String(body.token || "").trim();
      const authKey = String(body.authKey || "");
      if (!/^[0-9a-f]{64}$/.test(authKey)) return json({ error: "Bad authKey" }, 400, co);
      const th = await sha256Hex(token);
      const row = await env.DB.prepare(
        `SELECT user_id, expires, used FROM resets WHERE token_hash = ?`
      ).bind(th).first();
      if (!row || row.used || Number(row.expires) < now()) {
        return json({ error: "That reset link has expired or been used" }, 410, co);
      }
      const salt = randomHex(16);
      const hash = await derive(authKey, salt);
      await env.DB.batch([
        env.DB.prepare(`UPDATE users SET pw_salt = ?, pw_hash = ? WHERE id = ?`).bind(salt, hash, row.user_id),
        env.DB.prepare(`UPDATE resets SET used = ? WHERE token_hash = ?`).bind(now(), th),
        // Changing a password should end other sessions — that is usually the point.
        env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.user_id),
        env.DB.prepare(`DELETE FROM login_attempts WHERE key = (SELECT email FROM users WHERE id = ?)`).bind(row.user_id)
      ]);
      return json({ ok: true }, 200, co);
    }
    const me = await sessionUser(env, request);
    if (path === "/v1/logout" && request.method === "POST") {
      if (me) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(me.tokenHash).run();
      return json({ ok: true }, 200, co);
    }
    if (!me) return json({ error: "Not signed in" }, 401, co);
    if (path === "/v1/me" && request.method === "GET") {
      const list = await breweriesFor(env, me.id);
      return json({
        ok: true,
        email: me.email,
        brewery: list[0] || null,
        breweries: list
      }, 200, co);
    }
    if (path === "/v1/board") {
      const br = await pickBrewery(env, me.id, url.searchParams.get("b") || body.brewery);
      if (!br) return json({ error: "No such brewery on this account" }, 404, co);
      if (request.method === "GET") {
        const row = await env.DB.prepare(
          `SELECT data, updated, rev FROM boards WHERE brewery_id = ?`
        ).bind(br.id).first();
        if (!row) return json({ error: "No board" }, 404, co);
        return json({
          ok: true,
          slug: br.slug,
          rev: row.rev,
          updated: row.updated,
          data: JSON.parse(row.data)
        }, 200, co);
      }
      if (request.method === "PUT") {
        if (typeof body.data !== "object" || body.data === null) {
          return json({ error: "Nothing to save" }, 400, co);
        }
        const text = JSON.stringify(body.data);
        if (text.length > MAX_BOARD_BYTES) return json({ error: "That's too big" }, 413, co);
        const cur = await env.DB.prepare(`SELECT rev FROM boards WHERE brewery_id = ?`).bind(br.id).first();
        if (cur && Number(body.rev) !== Number(cur.rev)) {
          return json({ error: "Someone else saved first", rev: cur.rev }, 409, co);
        }
        const stamp = (/* @__PURE__ */ new Date()).toISOString();
        const rev = (cur ? Number(cur.rev) : 0) + 1;
        await env.DB.prepare(
          `INSERT INTO boards (brewery_id,data,updated,rev) VALUES (?,?,?,?)
           ON CONFLICT(brewery_id) DO UPDATE SET data=excluded.data, updated=excluded.updated, rev=excluded.rev`
        ).bind(br.id, text, stamp, rev).run();
        return json({ ok: true, rev, updated: stamp, slug: br.slug }, 200, co);
      }
    }
    if (path === "/v1/locations" && request.method === "POST") {
      const name = String(body.name || "").trim();
      if (!name || name.length > 120) return json({ error: "Name the location" }, 400, co);
      const mine = await breweriesFor(env, me.id);
      const owned = mine.filter(isOwner);
      const best = owned.reduce(
        (a, b) => limits(b.plan).locations > limits(a.plan).locations ? b : a,
        owned[0] || { plan: "free" }
      );
      const allowed = limits(best.plan).locations;
      if (owned.length >= allowed) {
        return json({
          error: `Your plan covers ${allowed} location${allowed === 1 ? "" : "s"}.`,
          code: "plan_limit",
          limit: allowed
        }, 402, co);
      }
      const bid = id(), slug = newSlug(), t = now();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO breweries (id,slug,name,plan,created) VALUES (?,?,?,?,?)`).bind(bid, slug, name, best.plan || "trial", t),
        env.DB.prepare(`INSERT INTO members (user_id,brewery_id,role,created) VALUES (?,?,?,?)`).bind(me.id, bid, "owner", t),
        env.DB.prepare(`INSERT INTO boards (brewery_id,data,updated,rev) VALUES (?,?,?,1)`).bind(bid, JSON.stringify(starterBoard(name)), new Date(t).toISOString())
      ]);
      return json({ ok: true, brewery: { id: bid, slug, name, plan: best.plan, role: "owner" } }, 200, co);
    }
    if (path === "/v1/team" && request.method === "GET") {
      const br = await pickBrewery(env, me.id, url.searchParams.get("b"));
      if (!br) return json({ error: "No such brewery" }, 404, co);
      const members = await env.DB.prepare(
        `SELECT u.id, u.email, m.role, m.created
           FROM members m JOIN users u ON u.id = m.user_id
          WHERE m.brewery_id = ? ORDER BY m.created`
      ).bind(br.id).all();
      const pending = await env.DB.prepare(
        `SELECT email, role, created, expires FROM invites
          WHERE brewery_id = ? AND accepted IS NULL AND expires > ?`
      ).bind(br.id, now()).all();
      return json({
        ok: true,
        brewery: br,
        members: members && members.results || [],
        invites: pending && pending.results || []
      }, 200, co);
    }
    if (path === "/v1/invites" && request.method === "POST") {
      const br = await pickBrewery(env, me.id, body.brewery);
      if (!br) return json({ error: "No such brewery" }, 404, co);
      if (!isOwner(br)) return json({ error: "Only an owner can invite people" }, 403, co);
      const email = String(body.email || "").trim().toLowerCase();
      if (!validEmail(email)) return json({ error: "That email doesn't look right" }, 400, co);
      const role = body.role === "owner" ? "owner" : "staff";
      const seats = limits(br.plan).staff;
      const used = await env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM members WHERE brewery_id = ?) - 1
              + (SELECT COUNT(*) FROM invites WHERE brewery_id = ? AND accepted IS NULL AND expires > ?)
           AS n`
      ).bind(br.id, br.id, now()).first();
      if (Number(used.n) >= seats) {
        return json({
          error: `Your plan covers ${seats} extra ${seats === 1 ? "person" : "people"}.`,
          code: "plan_limit",
          limit: seats
        }, 402, co);
      }
      const token = randomHex(24);
      await env.DB.prepare(
        `INSERT INTO invites (token_hash,brewery_id,email,role,invited_by,created,expires)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        await sha256Hex(token),
        br.id,
        email,
        role,
        me.id,
        now(),
        now() + INVITE_DAYS * 86400 * 1e3
      ).run();
      return json({
        ok: true,
        email,
        role,
        token,
        expiresDays: INVITE_DAYS
      }, 200, co);
    }
    if (path === "/v1/invites/accept" && request.method === "POST") {
      const token = String(body.token || "").trim();
      if (!token) return json({ error: "No invitation" }, 400, co);
      const th = await sha256Hex(token);
      const inv = await env.DB.prepare(
        `SELECT brewery_id, email, role, expires, accepted FROM invites WHERE token_hash = ?`
      ).bind(th).first();
      if (!inv) return json({ error: "That invitation isn't valid" }, 404, co);
      if (inv.accepted) return json({ error: "That invitation has already been used" }, 409, co);
      if (Number(inv.expires) < now()) return json({ error: "That invitation has expired" }, 410, co);
      if (String(inv.email) !== String(me.email).toLowerCase()) {
        return json({ error: "That invitation was sent to a different email address" }, 403, co);
      }
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO members (user_id,brewery_id,role,created) VALUES (?,?,?,?)
           ON CONFLICT(user_id,brewery_id) DO UPDATE SET role = excluded.role`
        ).bind(me.id, inv.brewery_id, inv.role, now()),
        env.DB.prepare(`UPDATE invites SET accepted = ? WHERE token_hash = ?`).bind(now(), th)
      ]);
      const br = await pickBrewery(env, me.id, inv.brewery_id);
      return json({ ok: true, brewery: br }, 200, co);
    }
    if (path === "/v1/members/remove" && request.method === "POST") {
      const br = await pickBrewery(env, me.id, body.brewery);
      if (!br) return json({ error: "No such brewery" }, 404, co);
      if (!isOwner(br)) return json({ error: "Only an owner can remove people" }, 403, co);
      const who = String(body.userId || "");
      if (who === me.id) return json({ error: "You can't remove yourself" }, 400, co);
      const owners = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM members WHERE brewery_id = ? AND role = 'owner'`
      ).bind(br.id).first();
      const target = await env.DB.prepare(
        `SELECT role FROM members WHERE brewery_id = ? AND user_id = ?`
      ).bind(br.id, who).first();
      if (!target) return json({ error: "They're not on this brewery" }, 404, co);
      if (target.role === "owner" && Number(owners.n) <= 1) {
        return json({ error: "That's the last owner \u2014 make someone else an owner first" }, 400, co);
      }
      await env.DB.prepare(`DELETE FROM members WHERE brewery_id = ? AND user_id = ?`).bind(br.id, who).run();
      return json({ ok: true }, 200, co);
    }
    return json({ error: "Unknown route" }, 404, co);
  }
};
async function startSession(env, userId) {
  const token = randomHex(32);
  const expires = now() + SESSION_DAYS * 86400 * 1e3;
  await env.DB.prepare(`INSERT INTO sessions (token_hash,user_id,created,expires) VALUES (?,?,?,?)`).bind(await sha256Hex(token), userId, now(), expires).run();
  return { token, expires };
}
__name(startSession, "startSession");
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
    updated: (/* @__PURE__ */ new Date()).toISOString(),
    taps: [
      {
        num: 1,
        name: "",
        style: "",
        abv: "",
        ibu: "",
        srm: 6,
        color: "#e0a63a",
        icon: "pint",
        level: 100,
        status: "pouring",
        notes: ""
      }
    ]
  };
}
__name(starterBoard, "starterBoard");

// ../../../../../usr/local/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../usr/local/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-ClUZtE/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../../usr/local/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-ClUZtE/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
