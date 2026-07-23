/* =======================================================================
   /api/guestbook  —  the shared guestbook (Cloudflare Pages Function)

   GET  -> { entries: [ { name, msg, ts }, ... ] }, newest first.
   POST { name, msg, website } -> validates, prepends, returns the list.

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
var COOLDOWN_SECONDS = 30;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
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

    /* one post per IP per cooldown window */
    var ip = context.request.headers.get("cf-connecting-ip") || "anon";
    var rlKey = "rl:gb:" + ip;
    return kv.get(rlKey).then(function (recent) {
      if (recent) return json({ error: "easy — one message every " + COOLDOWN_SECONDS + "s" }, 429);

      return loadBook(kv).then(function (entries) {
        entries.unshift({ name: name, msg: msg, ts: new Date().toISOString().slice(0, 10) });
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
