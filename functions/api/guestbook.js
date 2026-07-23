/* =======================================================================
   /api/guestbook  —  the shared guestbook (Cloudflare Pages Function)

   GET  -> { entries: [ { name, msg, ts, look? }, ... ] }, newest first.
   POST { name, msg, website, look? } -> validates, prepends, returns the list.

   look (optional) is the guest the signer built in the lounge wardrobe, so the
   book can draw each signer's own character. It is sanitised hard on the way in
   (cleanLook) and only used as canvas fill on render, never as markup.

   The whole book lives under one KV key ("guestbook") as a JSON array,
   capped at MAX_ENTRIES so it can't grow without bound. Abuse guards:
     - length caps on name + message,
     - a honeypot field ("website") that only bots fill,
     - a per-IP cooldown so one visitor can't flood it.

   Entries are stored raw and escaped when rendered (js/main.js esc()), so
   markup in a message can never execute. Bind the namespace in Pages
   settings as the variable name FrostMilanoKV.
   ======================================================================= */

var MAX_ENTRIES = 200;
var MAX_NAME = 24;
var MAX_MSG = 140;
/* Cloudflare KV rejects an expirationTtl below 60s, and the cooldown is a
   TTL key, so 60 is the floor - anything less makes the rate-limit put fail
   (and, since it shares a Promise.all with the entry write, 400s the post). */
var COOLDOWN_SECONDS = 60;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/* The guest a signer built in the lounge wardrobe travels with their entry so
   the book can draw it. Sanitise hard: only known fields, hex colours, and
   whitelisted style names survive - never trust the shape the client sent.
   Colours are only ever used as canvas fill on render (never innerHTML), and
   the client's makeLook() fills any gaps, so a partial look is fine. */
var HAT_STYLES = { none: 1, beanie: 1, cap: 1 };
var HAIR_STYLES = { short: 1, long: 1, buzz: 1 };
var OUTFIT_STYLES = { coat: 1, hoodie: 1, tee: 1 };
function isHex(s) { return typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s); }
function cleanLook(o) {
  if (!o || typeof o !== "object") return undefined;
  var out = {};
  ["hairColor", "coatColor", "pantsColor", "skinColor", "hatColor"].forEach(function (k) {
    if (isHex(o[k])) out[k] = o[k].toLowerCase();
  });
  if (HAT_STYLES[o.hat]) out.hat = o.hat;
  if (HAIR_STYLES[o.hair]) out.hair = o.hair;
  if (OUTFIT_STYLES[o.outfit]) out.outfit = o.outfit;
  if (typeof o.glasses === "boolean") out.glasses = o.glasses;
  return Object.keys(out).length ? out : undefined;
}

function loadBook(kv) {
  return kv.get("guestbook").then(function (raw) {
    if (!raw) return [];
    try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  });
}

export function onRequestGet(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  if (!kv) return json({ entries: [] });
  return loadBook(kv).then(function (entries) { return json({ entries: entries }); });
}

export function onRequestPost(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  if (!kv) return json({ error: "storage unavailable" }, 503);

  return context.request.json().then(function (body) {
    body = body || {};
    if (body.website) return json({ ok: true });   /* honeypot */

    var name = String(body.name || "").trim().slice(0, MAX_NAME);
    var msg = String(body.msg || "").trim().slice(0, MAX_MSG);
    if (!name || !msg) return json({ error: "name and message are both required" }, 400);
    var look = cleanLook(body.look);

    /* one post per IP per cooldown window */
    var ip = context.request.headers.get("cf-connecting-ip") || "anon";
    var rlKey = "rl:gb:" + ip;
    return kv.get(rlKey).then(function (recent) {
      if (recent) return json({ error: "easy — one message every " + COOLDOWN_SECONDS + "s" }, 429);

      return loadBook(kv).then(function (entries) {
        var entry = { name: name, msg: msg, ts: new Date().toISOString().slice(0, 10) };
        if (look) entry.look = look;
        entries.unshift(entry);
        if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
        return Promise.all([
          kv.put("guestbook", JSON.stringify(entries)),
          kv.put(rlKey, "1", { expirationTtl: COOLDOWN_SECONDS })
        ]).then(function () { return json({ ok: true, entries: entries }); });
      });
    });
  }).catch(function () {
    return json({ error: "bad request" }, 400);
  });
}
