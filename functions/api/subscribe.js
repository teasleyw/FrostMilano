/* =======================================================================
   /api/subscribe  —  the mailing-list signup (Cloudflare Pages Function)

   POST { email, website, list? } -> stores the email in the KV namespace as
   its own key, so duplicates collapse and the list is easy to read back
   later. `website` is a honeypot: a real person never sees the field, so
   anything in it means a bot — we accept-and-drop silently.

   ONE ENDPOINT, MANY ROOMS. Each artist region on the site shares this
   function but keeps its own list, chosen by the optional `list` field:
     - no list (the Frost ice list) -> key "sub:<email>"
     - list:"neck"                  -> key "sub:neck:<email>"
   A missing/blank list is exactly the original behaviour, so the Frost
   page is untouched. `list` is slugged hard (a-z0-9- only) so it can never
   be anything but a key prefix.

   To read a collected list:
     wrangler kv key list --namespace-id <id> --prefix "sub:"        # ice list + all
     wrangler kv key list --namespace-id <id> --prefix "sub:neck:"   # just Neck's
   or open the namespace in the Cloudflare dashboard (KV → your namespace).

   Bind the namespace in Pages settings as the variable name FrostMilanoKV.
   ======================================================================= */

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/* Deliberately loose: one @, a dot in the domain, no spaces. Real address
   validation is delivery, not regex — this just rejects obvious junk. */
var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* A list name becomes part of a KV key, so let nothing through but a short
   lowercase slug. Anything else (or nothing) means the default ice list. */
function listPrefix(raw) {
  var slug = String(raw || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  return slug ? slug + ":" : "";
}

export function onRequestPost(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  if (!kv) return json({ error: "storage unavailable" }, 503);

  return context.request.json().then(function (body) {
    body = body || {};
    if (body.website) return json({ ok: true });   /* honeypot: silently drop bots */

    var email = String(body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 200) {
      return json({ error: "that email doesn't look right" }, 400);
    }
    var key = "sub:" + listPrefix(body.list) + email;
    return kv.put(key, new Date().toISOString()).then(function () {
      return json({ ok: true });
    });
  }).catch(function () {
    return json({ error: "bad request" }, 400);
  });
}
