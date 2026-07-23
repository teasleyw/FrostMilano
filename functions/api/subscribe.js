/* =======================================================================
   /api/subscribe  —  the Ice List email signup (Cloudflare Pages Function)

   POST { email, website } -> stores the email in the KV namespace as
   its own key ("sub:<email>"), so duplicates collapse and the list is easy
   to read back later. `website` is a honeypot: a real person never sees the
   field, so anything in it means a bot — we accept-and-drop silently.

   To read the collected emails:
     wrangler kv key list --namespace-id <id> --prefix "sub:"
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
    return kv.put("sub:" + email, new Date().toISOString()).then(function () {
      return json({ ok: true });
    });
  }).catch(function () {
    return json({ error: "bad request" }, 400);
  });
}
