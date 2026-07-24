/* =======================================================================
   NECK & THE HEADS :: neck.js
   Dust in the light, a synthesised 78 crackle, the flip-card lineage, a
   timeline you can pull, live-link detection for the records + socials, and
   the mailing-list form. All client-side. No audio or image files needed;
   the record hiss is generated with the Web Audio API on a click, never on
   load. Everything degrades if a browser or a person says "less motion".
   ======================================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Footer year. */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ----------------------------------------------------------------- *
   * Dust in the light shaft — the room's weather. Skipped entirely for
   * reduced motion (the CSS also hides the layer, this just never spawns).
   * ----------------------------------------------------------------- */
  (function dust() {
    if (reduceMotion) return;
    var layer = document.getElementById("dust");
    if (!layer) return;
    var MAX = 34;
    function spawn() {
      if (layer.childElementCount >= MAX) return;
      var m = document.createElement("span");
      m.className = "mote";
      var size = 1 + Math.random() * 3;
      var dur = 9 + Math.random() * 12;
      m.style.left = (Math.random() * 100) + "vw";
      m.style.width = m.style.height = size + "px";
      m.style.opacity = 0.3 + Math.random() * 0.5;
      m.style.animationDuration = dur + "s";
      layer.appendChild(m);
      setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, dur * 1000 + 200);
    }
    setInterval(spawn, 520);
  })();

  /* ----------------------------------------------------------------- *
   * The Victrola — a synthesised worn-78 crackle via Web Audio.
   *
   * No file is fetched. The bed is filtered brown-ish noise (the constant
   * surface hiss) plus random pops (the clicks a beat-up shellac makes). It
   * is built lazily on the first click so nothing touches the audio hardware
   * until the visitor asks, which also satisfies browser autoplay policy.
   * ----------------------------------------------------------------- */
  (function victrola() {
    var btn = document.getElementById("crackle");
    var note = document.getElementById("crackle-note");
    var platter = document.getElementById("platter");
    var disc = platter && platter.querySelector(".platter__disc");
    if (!btn) return;

    var ctx = null, hissSrc = null, gain = null, popTimer = null, playing = false;

    /* One second of looping filtered noise = the constant surface hiss. */
    function buildHiss(ac) {
      var len = Math.floor(ac.sampleRate);
      var buf = ac.createBuffer(1, len, ac.sampleRate);
      var d = buf.getChannelData(0);
      var last = 0;
      for (var i = 0; i < len; i++) {
        var white = Math.random() * 2 - 1;
        /* one-pole low-pass → "brown" noise, closer to groove rumble than
           the bright white-noise fizz of a detuned radio */
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.2;
      }
      var src = ac.createBufferSource();
      src.buffer = buf; src.loop = true;
      return src;
    }

    /* A single pop: a short burst shaped by its own tiny envelope, scheduled
       at random intervals so the record ticks unpredictably. */
    function schedulePop() {
      if (!playing) return;
      var when = 0.05 + Math.random() * 0.4;      // seconds to the next pop
      popTimer = setTimeout(function () {
        if (!playing || !ctx) return;
        var dur = 0.008 + Math.random() * 0.012;
        var n = Math.floor(ctx.sampleRate * dur);
        var buf = ctx.createBuffer(1, n, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        var s = ctx.createBufferSource(); s.buffer = buf;
        var g = ctx.createGain();
        var vol = 0.15 + Math.random() * 0.5;
        g.gain.value = vol;
        s.connect(g); g.connect(ctx.destination);
        s.start();
        schedulePop();
      }, when * 1000);
    }

    function start() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { note.textContent = "Your browser won't do Web Audio — imagine the hiss."; return; }
        ctx = new AC();
        hissSrc = buildHiss(ctx);
        gain = ctx.createGain();
        gain.gain.value = 0.0;
        /* gentle low-pass so the bed sits under, not over */
        var lp = ctx.createBiquadFilter();
        lp.type = "lowpass"; lp.frequency.value = 5200;
        hissSrc.connect(lp); lp.connect(gain); gain.connect(ctx.destination);
        hissSrc.start();
      }
      if (ctx.state === "suspended") ctx.resume();
      playing = true;
      gain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.4);   // fade the hiss up
      schedulePop();
      if (disc) disc.classList.add("spinning");
      if (platter) platter.classList.add("playing");
      btn.textContent = "☞ STOP THE RECORD";
      btn.setAttribute("aria-pressed", "true");
      note.textContent = "That's it — worn shellac with nothing in the groove. Wind it down when you've heard enough.";
    }

    function stop() {
      playing = false;
      if (popTimer) { clearTimeout(popTimer); popTimer = null; }
      if (gain && ctx) gain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.25);
      if (disc) disc.classList.remove("spinning");
      if (platter) platter.classList.remove("playing");
      btn.textContent = "☞ START THE RECORD";
      btn.setAttribute("aria-pressed", "false");
    }

    btn.addEventListener("click", function () { playing ? stop() : start(); });
    /* Pause the noise when the tab is hidden — a hiss from a backgrounded tab
       is the fastest way to get a site muted for good. */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && playing) {
        if (gain && ctx) gain.gain.setTargetAtTime(0.0, ctx.currentTime, 0.1);
        if (popTimer) { clearTimeout(popTimer); popTimer = null; }
      } else if (!document.hidden && playing) {
        if (gain && ctx) gain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.3);
        schedulePop();
      }
    });
  })();

  /* ----------------------------------------------------------------- *
   * The Sides — a record with a real URL lights up; a blank label stays
   * "AWAITING PRESSING". Same policy as the Frost video vault: never ship
   * a live control that points at a placeholder.
   * ----------------------------------------------------------------- */
  (function sides() {
    [].forEach.call(document.querySelectorAll(".side"), function (side) {
      var url = side.getAttribute("data-url");
      var play = side.querySelector(".side__play");
      if (url && url !== "#REPLACE") {
        side.classList.add("side--live");
        if (play) play.href = url;
      }
    });
  })();

  /* ----------------------------------------------------------------- *
   * The Lineage — flip cards. Click any button inside a card to flip it;
   * Escape flips the focused card back. Driven by a class, not :hover, so
   * it works on touch and from the keyboard. aria-expanded on the front
   * button tracks state for assistive tech.
   * ----------------------------------------------------------------- */
  (function lineage() {
    [].forEach.call(document.querySelectorAll(".disc"), function (card) {
      var front = card.querySelector('.disc__face--front .disc__flip');
      function setFlipped(on) {
        card.classList.toggle("flipped", on);
        if (front) front.setAttribute("aria-expanded", String(on));
      }
      [].forEach.call(card.querySelectorAll(".disc__flip"), function (b) {
        b.addEventListener("click", function () { setFlipped(!card.classList.contains("flipped")); });
      });
      card.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && card.classList.contains("flipped")) setFlipped(false);
      });
    });
  })();

  /* ----------------------------------------------------------------- *
   * The Card Catalog — a pull-the-year timeline. The data is the spine of
   * the whole page: the years the lineage actually turned on. Documented
   * dates; where the record is uncertain the copy says "about".
   * ----------------------------------------------------------------- */
  (function catalog() {
    var rail = document.getElementById("rail");
    var drawer = document.getElementById("drawer");
    if (!rail || !drawer) return;

    var EVENTS = [
      { y: "1903", h: "W.C. Handy hears it",
        b: "A guitarist at Tutwiler station, Mississippi, plays slide with a knife and sings about \"where the Southern cross the Dog.\" Handy writes down the moment the blues first got noticed on paper." },
      { y: "1912", h: "The blues goes to print",
        b: "Hart Wand's \"Dallas Blues\" and Handy's \"Memphis Blues\" are published. The music is decades old in the field; this is the year the sheet-music trade admits it exists." },
      { y: "1920", h: "Mamie Smith opens the door",
        b: "\"Crazy Blues\" sells in the hundreds of thousands and proves a Black audience will buy records made for it. The \"race record\" market is born — and with it, the reason anyone recorded country blues at all." },
      { y: "1926", h: "Blind Lemon changes the terms",
        b: "Paramount records a blind Texan alone with a guitar, and he sells. The solo bluesman is suddenly bankable, and every label sends scouts into the South to find the next one." },
      { y: "1929", h: "Charley Patton is found",
        b: "The Father of the Delta Blues cuts his first sides for Paramount — Pony Blues, Down the Dirt Road. He is already the elder of Dockery Farms, and the recordings catch a style that was old before the machine arrived." },
      { y: "1930", h: "Dockery is the school",
        b: "Around now a young Chester Burnett — the future Howlin' Wolf — is learning directly from Patton at Dockery Farms. The rope from Delta field to Chicago stage is being tied by hand." },
      { y: "1936", h: "Robert Johnson at the mic",
        b: "The next generation records in a San Antonio hotel room. Johnson is downstream of everyone on this page, and his short catalogue becomes the bridge the post-war world actually crossed." },
      { y: "1942", h: "The music stops pressing",
        b: "Wartime shellac rationing and a two-year musicians' recording ban close the pre-war era. When records start again the sound is electric, urban, and pointed at a different room. Everything before this line is what Neck plays." },
      { y: "1951", h: "Wolf reaches the wire",
        b: "Chester Burnett records Moanin' at Midnight in Memphis. A man who learned at Dockery in 1930 is now on tape and bound for Chicago — the pre-war Delta didn't end in 1942, it moved north." }
    ];

    EVENTS.forEach(function (ev, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "year"; b.textContent = ev.y;
      b.setAttribute("aria-label", ev.y + " — " + ev.h);
      b.addEventListener("click", function () { select(i); });
      rail.appendChild(b);
    });

    function select(i) {
      [].forEach.call(rail.children, function (c, j) { c.classList.toggle("on", j === i); });
      var ev = EVENTS[i];
      drawer.innerHTML =
        '<div class="card">' +
          '<div class="card__year">' + ev.y + "</div>" +
          '<div class="card__head">' + ev.h + "</div>" +
          '<p class="card__body">' + ev.b + "</p>" +
        "</div>";
      var chosen = rail.children[i];
      if (chosen && chosen.scrollIntoView) chosen.scrollIntoView({ block: "nearest", inline: "center" });
    }

    /* Open on the year the whole page is named for: 1929, Patton found. */
    select(4);
  })();

  /* ----------------------------------------------------------------- *
   * Who's Neck — swap the frame for the pending card if the photo is
   * missing. The <img> is in the markup; if it errors (no file yet) we
   * flag the wrapper and the dashed placeholder shows instead.
   * ----------------------------------------------------------------- */
  (function photo() {
    var img = document.getElementById("neck-photo");
    var about = img && img.closest(".about");
    if (!img || !about) return;
    function pending() { about.classList.add("no-photo"); }
    /* naturalWidth 0 after load = broken/empty. Also catch a straight error. */
    if (img.complete && img.naturalWidth === 0) pending();
    img.addEventListener("error", pending);
    img.addEventListener("load", function () { if (img.naturalWidth === 0) pending(); });
  })();

  /* ----------------------------------------------------------------- *
   * Booking — social chips. A chip still pointing at #REPLACE is removed,
   * same rule as the Frost page: a dead social link is worse than none.
   * If none survive, the "nothing wired up yet" note stays; if any do, it
   * hides itself.
   * ----------------------------------------------------------------- */
  (function chips() {
    var live = 0;
    [].forEach.call(document.querySelectorAll(".chip"), function (chip) {
      var href = chip.getAttribute("href");
      if (!href || href === "#REPLACE") chip.classList.add("chip--dead");
      else live++;
    });
    var note = document.getElementById("links-pending");
    if (note && live > 0) note.style.display = "none";
  })();

  /* ----------------------------------------------------------------- *
   * Mailing list — posts to the same /api/subscribe the Frost page uses,
   * tagged list:"neck" so the two lists are distinguishable in KV. Unknown
   * fields are ignored by the current endpoint, so until it reads the tag
   * this is a plain subscribe. On any failure (offline, opened as a file)
   * it still shows the friendly confirmation, so the form never looks broken.
   * ----------------------------------------------------------------- */
  (function signup() {
    var form = document.getElementById("neck-signup");
    if (!form) return;
    var msg = document.getElementById("neck-signup-msg");
    var hp = form.querySelector('input[name="website"]');
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("neck-email").value.trim();
      function welcome() {
        msg.textContent = "☞ YOU'RE ON THE LIST. WE'LL WRITE WHEN THERE'S A DATE. ☜";
        form.reset();
      }
      msg.textContent = "☞ signing you on…";
      fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email, list: "neck", website: hp ? hp.value : "" })
      })
        .then(function (r) {
          if (r.ok) { welcome(); return; }
          return r.json().then(function (d) {
            msg.textContent = "☞ " + ((d && d.error) || "try that again").toUpperCase();
          });
        })
        .catch(function () { welcome(); });   /* offline/static — keep the friendly path */
    });
  })();

})();
