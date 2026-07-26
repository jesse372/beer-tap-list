/**
 * ontap-publish — lets the tap-list editor save without holding a GitHub token.
 *
 * Why this exists: the token used to live in the browser's local storage, so
 * clearing browsing history wiped it and publishing broke. Now the token is a
 * server-side secret here, and the only thing the browser holds is a password
 * he can simply retype.
 *
 * Routes (all POST, JSON):
 *   /check    { password }                    -> { ok }
 *   /publish  { password, message, files[] }  -> { ok }   files: [{ path, content }]
 *
 * Everything else — the board, taps.json, GitHub Pages, the Fire TV app — is
 * untouched. This only replaces the editor's save path.
 */

const JSON_HEADERS = { "Content-Type": "application/json" };

function corsHeaders(env, request) {
  const allowed = env.ALLOWED_ORIGIN || "*";
  const origin = request.headers.get("Origin") || "";
  return {
    // Echo the origin only when it matches, so this can't be driven from elsewhere.
    "Access-Control-Allow-Origin": origin === allowed ? origin : allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...JSON_HEADERS, ...(extra || {}) },
  });
}

/** Length-independent comparison, so timing can't leak the password. */
function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a || ""));
  const y = new TextEncoder().encode(String(b || ""));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gh(env, path, init) {
  const res = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.GH_TOKEN,
      Accept: "application/vnd.github+json",
      "User-Agent": "ontap-publish",
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {}),
    },
  });
  return res;
}

/** Write one file, looking up its sha first (GitHub needs it to replace). */
async function putFile(env, path, content, message) {
  const base =
    "/repos/" + env.GH_OWNER + "/" + env.GH_REPO + "/contents/" + path;

  const head = await gh(env, base + "?ref=" + encodeURIComponent(env.GH_BRANCH), {
    method: "GET",
  });
  if (head.status !== 200 && head.status !== 404) {
    return { ok: false, status: head.status, error: "Could not read " + path };
  }
  let sha = null;
  if (head.status === 200) {
    const j = await head.json();
    sha = j && j.sha;
  }

  // Base64 of UTF-8, chunked so large backgrounds don't blow the call stack.
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }

  const body = {
    message: message || "Update tap list",
    content: btoa(bin),
    branch: env.GH_BRANCH,
  };
  if (sha) body.sha = sha;

  const put = await gh(env, base, { method: "PUT", body: JSON.stringify(body) });
  if (put.status === 200 || put.status === 201) return { ok: true };

  let msg = "GitHub said " + put.status;
  try {
    const j = await put.json();
    if (j && j.message) msg += ": " + j.message;
  } catch (e) {}
  return { ok: false, status: put.status, error: msg };
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env, request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "POST only" }, 405, cors);
    }

    const url = new URL(request.url);
    const route = url.pathname.replace(/\/+$/, "");

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "Bad JSON" }, 400, cors);
    }

    // A password is optional. Leave the APP_PASSWORD secret unset and the editor
    // needs no sign-in at all; set it later and the editor adapts on its own.
    if (env.APP_PASSWORD) {
      if (!safeEqual(body.password, env.APP_PASSWORD)) {
        await sleep(1000); // blunt the value of guessing
        return json({ ok: false, error: "Wrong password" }, 401, cors);
      }
    }

    if (route === "/check") return json({ ok: true }, 200, cors);

    if (route === "/publish") {
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) return json({ ok: false, error: "Nothing to publish" }, 400, cors);

      for (const f of files) {
        if (!f || typeof f.path !== "string" || typeof f.content !== "string") {
          return json({ ok: false, error: "Bad file entry" }, 400, cors);
        }
        // Only ever touch the tap list's own files.
        if (!/^(taps\.json|bgphoto\.json)$/.test(f.path)) {
          return json({ ok: false, error: "Not allowed: " + f.path }, 400, cors);
        }
        if (f.content.length > 3_000_000) {
          return json({ ok: false, error: "Too big: " + f.path }, 413, cors);
        }
      }

      for (const f of files) {
        const r = await putFile(env, f.path, f.content, body.message);
        if (!r.ok) return json({ ok: false, error: r.error }, 502, cors);
      }
      return json({ ok: true }, 200, cors);
    }

    return json({ ok: false, error: "Unknown route" }, 404, cors);
  },
};
