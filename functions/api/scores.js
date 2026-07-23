/* =======================================================================
   /api/scores  —  the arcade high-score boards (Cloudflare Pages Function)

   The lounge's two cabinets - Brick Smash and Snake - share this endpoint,
   one KV key per game ("scores:bricksmash", "scores:snake").

   GET  /api/scores?game=<id>  -> { scores: [ { i, s }, ... ] }, high first.
   POST { game, initials, score, website } -> ranks it, returns the board.

   Each board is a JSON array capped at MAX_SCORES; `i` is up to three initials,
   `s` the points. Scores are trivially forgeable from a browser console - this
   is a nostalgic arcade board, not a system of record - so the guards here just
   keep it from being trashed: a per-game ceiling on believable scores, a
   honeypot field, and a per-IP cooldown. Initials are stored raw and escaped
   when rendered (lounge.html esc()), so markup can never execute.

   Bind the namespace in Pages settings as the variable name FrostMilanoKV
   (a FROST_KV binding also works, as a fallback).
   ======================================================================= */

var MAX_SCORES = 8;
var MAX_INITIALS = 3;
/* Cloudflare KV's minimum expirationTtl is 60s, so that's the floor for a
   TTL-key cooldown. A minute between submissions is plenty for a high-score
   board - a qualifying run takes longer than that to play out anyway. */
var COOLDOWN_SECONDS = 60;

/* One entry per game: the factory board shown before anyone has played (it
   mirrors the client SEED so the cabinet looks the same before and after the
   live board loads) and a ceiling that rejects impossible scores. */
var GAMES = {
  bricksmash: {
    seed: [
      { i: "FRO", s: 2500 }, { i: "ICE", s: 1800 }, { i: "MIL", s: 1200 },
      { i: "SNO", s: 800 }, { i: "AAA", s: 400 }
    ],
    max: 500000
  },
  snake: {
    seed: [
      { i: "FRO", s: 300 }, { i: "ICE", s: 220 }, { i: "MIL", s: 160 },
      { i: "SNO", s: 100 }, { i: "AAA", s: 50 }
    ],
    max: 100000
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/* Coerce whatever is in KV (or a client payload) into a clean, sorted, capped
   board: valid rows only, initials clipped, scores floored to whole points. */
function clean(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(function (e) { return e && typeof e.s === "number" && isFinite(e.s); })
    .map(function (e) {
      return { i: String(e.i || "???").slice(0, MAX_INITIALS), s: Math.floor(e.s) };
    })
    .sort(function (a, b) { return b.s - a.s; })
    .slice(0, MAX_SCORES);
}

function loadBoard(kv, game) {
  return kv.get("scores:" + game).then(function (raw) {
    if (!raw) return clean(GAMES[game].seed.slice());
    try {
      var v = JSON.parse(raw);
      return clean(v);
    } catch (e) {
      return clean(GAMES[game].seed.slice());
    }
  });
}

export function onRequestGet(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  var game = new URL(context.request.url).searchParams.get("game");
  if (!GAMES[game]) return json({ error: "unknown game" }, 400);
  /* Before KV is bound the board still answers with the factory seed, so the
     cabinet is never blank. */
  if (!kv) return json({ scores: clean(GAMES[game].seed.slice()) });
  return loadBoard(kv, game).then(function (scores) { return json({ scores: scores }); });
}

export function onRequestPost(context) {
  var kv = context.env.FrostMilanoKV || context.env.FROST_KV;
  if (!kv) return json({ error: "storage unavailable" }, 503);

  return context.request.json().then(function (body) {
    body = body || {};
    if (body.website) return json({ ok: true });   /* honeypot */

    var game = String(body.game || "");
    var cfg = GAMES[game];
    if (!cfg) return json({ error: "unknown game" }, 400);

    var initials = String(body.initials || "")
      .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, MAX_INITIALS) || "???";
    var score = Math.floor(Number(body.score));
    if (!isFinite(score) || score <= 0 || score > cfg.max) {
      return json({ error: "that score doesn't look right" }, 400);
    }

    /* one submit per IP per cooldown window, so a stuck finger (or a script)
       can't machine-gun the board */
    var ip = context.request.headers.get("cf-connecting-ip") || "anon";
    var rlKey = "rl:sc:" + game + ":" + ip;
    return kv.get(rlKey).then(function (recent) {
      if (recent) return json({ error: "easy - one score every " + COOLDOWN_SECONDS + "s" }, 429);

      return loadBoard(kv, game).then(function (scores) {
        scores.push({ i: initials, s: score });
        scores = clean(scores);
        return Promise.all([
          kv.put("scores:" + game, JSON.stringify(scores)),
          kv.put(rlKey, "1", { expirationTtl: COOLDOWN_SECONDS })
        ]).then(function () { return json({ ok: true, scores: scores }); });
      });
    });
  }).catch(function () {
    return json({ error: "bad request" }, 400);
  });
}
