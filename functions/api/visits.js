/* =======================================================================
   /api/visits  —  the shared visitor counter (Cloudflare Pages Function)

   POST increments the count and returns it; GET just reads it. The client
   (js/main.js) POSTs once per session, then GETs, so a refresh doesn't
   inflate the tally. Backed by a KV namespace bound in the Pages project
   settings (Settings → Functions → KV namespace bindings) as the variable
   name FrostMilanoKV (a FROST_KV binding also works, as a fallback).

   KV is eventually consistent, so two visits landing in the exact same
   instant can lose one increment. For a nostalgic hit counter on a small
   site that is entirely fine; if it ever needs to be exact, a Durable
   Object is the atomic upgrade.
   ======================================================================= */

var BASE = 1337;   /* matches the client's starting hype number */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function read(kv) {
  return kv.get("visits").then(function (raw) {
    var n = parseInt(raw, 10);
    return isNaN(n) ? BASE : n;
  });
}

export function onRequestGet(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  if (!kv) return json({ error: "storage unavailable" }, 503);
  return read(kv).then(function (n) { return json({ count: n }); });
}

export function onRequestPost(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  if (!kv) return json({ error: "storage unavailable" }, 503);
  return read(kv).then(function (n) {
    var next = n + 1;
    return kv.put("visits", String(next)).then(function () {
      return json({ count: next });
    });
  });
}
