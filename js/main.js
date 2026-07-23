/* =======================================================================
   FROST MILANO :: main.js
   Snow, the video vault, a visitor counter, a working guestbook, and the
   ice-list form. All client-side. No servers were harmed. ❄
   ======================================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------------------------------------------- *
   * Current year in the footer
   * ----------------------------------------------------------------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ----------------------------------------------------------------- *
   * Falling snow ❄  (skipped if the visitor prefers reduced motion)
   * ----------------------------------------------------------------- */
  (function snow() {
    if (reduceMotion) return;
    var layer = document.getElementById("snow");
    if (!layer) return;
    var GLYPHS = ["❄", "❅", "❆", "✦", "•"];
    var MAX = 40;
    /* Seconds for the band of sunlight to cross the screen. Every flake
       shares this one period — vary it per flake and the phases drift apart,
       which turns the sweep back into unrelated twinkling. */
    var SWEEP = 7;
    /* Nudge each flake off the sweep line so the light reads as a soft shaft
       rather than a ruler edge. Small next to the lit window (24% of SWEEP),
       so the band still holds together. */
    var JITTER = 0.08;

    function spawn() {
      if (layer.childElementCount >= MAX) return;
      var f = document.createElement("span");
      f.className = "flake";
      f.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      var size = 8 + Math.random() * 18;
      var dur = 6 + Math.random() * 8;
      /* Phase the glint by how far right the flake sits: a flake at the left
         edge is a full sweep "ahead" of one at the right edge, so the lit
         window walks left → right and wraps. The delay is negative because
         the flake has to enter the sweep already in progress — it can't wait
         for the light to start over. */
      var x = Math.random() * 100;
      var phase = -(1 - x / 100) * SWEEP + (Math.random() - 0.5) * JITTER * SWEEP;
      f.style.left = x + "vw";
      f.style.fontSize = size + "px";
      f.style.opacity = 0.4 + Math.random() * 0.6;
      f.style.animationDuration = dur + "s, " + SWEEP + "s";
      f.style.animationDelay = "0s, " + phase + "s";
      /* The star flare is drawn by .flake::after, which inline style cannot
         reach. Custom properties inherit into the pseudo-element, so the
         flare picks up the same clock and phase as the glyph's glint. */
      f.style.setProperty("--sweep", SWEEP + "s");
      f.style.setProperty("--glint-delay", phase + "s");
      layer.appendChild(f);
      setTimeout(function () {
        if (f.parentNode) f.parentNode.removeChild(f);
      }, dur * 1000 + 500);
    }
    setInterval(spawn, 320);
  })();

  /* ----------------------------------------------------------------- *
   * The Video Vault 📼
   * Each TV plays muted+looping while it's on screen and pauses when it
   * scrolls away, so three clips never fight for bandwidth at once.
   * A TV with no file behind it stays on the "NO SIGNAL" static screen.
   * ----------------------------------------------------------------- */
  (function vault() {
    var tvs = [].slice.call(document.querySelectorAll(".tv"));
    if (!tvs.length) return;

    /* Pause off-screen TVs so three clips never fight for bandwidth.
       Null when the browser is too old or the visitor wants less motion —
       every use below is guarded. */
    var io = (!reduceMotion && "IntersectionObserver" in window)
      ? new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            var video = entry.target;
            if (entry.isIntersecting) {
              /* Autoplay can still be refused (data saver, low power mode) —
                 swallow it; the visitor keeps the static screen instead. */
              video.play().catch(function () {});
            } else {
              video.pause();
            }
          });
        }, { threshold: 0.45 })
      : null;

    tvs.forEach(function (tv) {
      var video = tv.querySelector(".tv__video");
      var source = tv.querySelector("source");
      var soundBtn = tv.querySelector(".tv__sound");
      var link = tv.querySelector(".tv__ig");
      if (!video) return;

      /* Sync the plate title + the Instagram link from the markup, so
         editing one data- attribute is enough to relabel a channel. */
      var title = video.getAttribute("data-title");
      var titleEl = tv.querySelector(".tv__title");
      if (title && titleEl) titleEl.textContent = title;

      var ig = tv.getAttribute("data-ig");
      if (link && ig && ig !== "#REPLACE") link.href = ig;

      /* A missing file fires "error" on the <source>, not the <video>. */
      if (source) {
        source.addEventListener("error", function () {
          tv.classList.remove("tv--live");
        });
      }

      /* Reveal the screen once a real frame is behind the static. iOS Safari
         won't decode one from preload alone — only once playback starts — so
         we also listen for "playing", not just "loadeddata". Without it an
         iPhone never fires either event on its own and the TV stays stuck on
         NO SIGNAL even though the clip is there. */
      function goLive() {
        tv.classList.add("tv--live");
        if (reduceMotion) video.controls = true;
      }
      video.addEventListener("loadeddata", goLive);
      video.addEventListener("playing", goLive);

      /* Start playback when the TV scrolls into view. Observe every TV up
         front — NOT inside the load handler — because on iOS that first
         muted, inline play() is itself what forces the frame to decode and
         fire the events above, so gating it behind them would deadlock.
         With reduced motion we don't autoplay; reveal it with controls so
         it can still be played. */
      if (io) io.observe(video);
      else goLive();

      if (soundBtn) {
        soundBtn.addEventListener("click", function () {
          var turningOn = video.muted;
          /* Only one TV gets audio at a time — this is a wall, not a riot. */
          if (turningOn) {
            tvs.forEach(function (other) {
              var v = other.querySelector(".tv__video");
              var b = other.querySelector(".tv__sound");
              if (v && v !== video) {
                v.muted = true;
                if (b) {
                  b.setAttribute("aria-pressed", "false");
                  b.textContent = "🔇 TAP FOR SOUND";
                }
              }
            });
          }
          video.muted = !turningOn;
          soundBtn.setAttribute("aria-pressed", String(turningOn));
          soundBtn.textContent = turningOn ? "🔊 SOUND ON" : "🔇 TAP FOR SOUND";
          if (turningOn && video.paused) video.play().catch(function () {});
        });
      }
    });

  })();

  /* ----------------------------------------------------------------- *
   * Visitor counter — a real shared tally via /api/visits, counted once
   * per session. Falls back to a private localStorage count when the API
   * isn't there (opened as a file, or before KV is bound), so the counter
   * never sits blank.
   * ----------------------------------------------------------------- */
  (function counter() {
    var el = document.getElementById("counter");
    if (!el) return;
    var BASE = 1337; // starting hype number
    function show(n) { el.textContent = String(n).padStart(6, "0"); }

    function localCount() {
      var n = BASE;
      try {
        var stored = parseInt(localStorage.getItem("frost_visits"), 10);
        n = (isNaN(stored) ? BASE : stored) + 1;
        localStorage.setItem("frost_visits", String(n));
      } catch (e) { /* private mode — just show the base */ }
      return n;
    }

    var counted = false;
    try { counted = sessionStorage.getItem("frost_counted") === "1"; } catch (e) {}
    /* POST bumps the tally; GET only reads. Count the first hit of a session,
       then read on later page loads so a refresh doesn't inflate it. */
    fetch("/api/visits", { method: counted ? "GET" : "POST" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        if (typeof d.count !== "number") throw 0;
        try { sessionStorage.setItem("frost_counted", "1"); } catch (e) {}
        show(d.count);
      })
      .catch(function () { show(localCount()); });
  })();

  /* ----------------------------------------------------------------- *
   * Ice-list signup — POSTs the email to /api/subscribe, which stores it
   * in KV. If the API isn't reachable (opened as a file, or before KV is
   * bound) it still shows the friendly confirmation, so the form never
   * looks broken.
   * ----------------------------------------------------------------- */
  (function signup() {
    var form = document.getElementById("signup-form");
    if (!form) return;
    var msg = document.getElementById("signup-msg");
    var hp = form.querySelector('input[name="website"]');
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = document.getElementById("signup-email").value.trim();
      var who = (email.split("@")[0] || "friend").toUpperCase();
      function welcome() {
        msg.textContent = "❄ YOU'RE ON THE ICE LIST, " + who + "! STAY FROSTY. ❄";
        form.reset();
      }
      msg.textContent = "❄ adding you to the ice list… ❄";
      fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email, website: hp ? hp.value : "" })
      })
        .then(function (r) {
          if (r.ok) { welcome(); return; }
          return r.json().then(function (d) {
            msg.textContent = "❄ " + ((d && d.error) || "try that again").toUpperCase() + " ❄";
          });
        })
        .catch(function () { welcome(); });   /* offline/static — keep the old behaviour */
    });
  })();

  /* ----------------------------------------------------------------- *
   * Guestbook — a real shared book via /api/guestbook when it's reachable,
   * otherwise the visitor's own localStorage copy (opened as a file, or
   * before KV is bound). Text is always escaped on render, so a message
   * can't inject markup no matter where it came from.
   * ----------------------------------------------------------------- */
  (function guestbook() {
    var form = document.getElementById("guestbook-form");
    var list = document.getElementById("guestbook");
    if (!form || !list) return;
    var hp = form.querySelector('input[name="website"]');

    /* _v2 retires anyone's locally-saved copy of the old fabricated seed
       entries. Bump again if the seed ever needs to be force-refreshed. */
    var KEY = "frost_guestbook_v2";
    /* One entry, so the guestbook isn't empty on first load.
       No invented fans and no invented song titles — the old seed had
       strangers raving about a track called "SUBZERO" that doesn't exist.
       The webmaster signs as the stock Frost guest (empty look = defaults). */
    var seed = [
      { name: "webmaster", msg: "site's up. sign below. ❄", ts: "1999-08-14", look: {} }
    ];
    var apiOK = false;   /* flips true once the shared book answers */

    /* The guest the visitor built in the lounge, saved there under this key. It
       travels with their signature so the book shows their own character. */
    function loadMyLook() {
      try {
        var v = JSON.parse(localStorage.getItem("frost_guest_v2"));
        if (v && typeof v === "object") return v;
      } catch (e) {}
      return null;
    }
    function localLoad() {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return seed.slice();
    }
    function localSave(entries) {
      try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) {}
    }
    function esc(s) {
      var d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    }
    /* A small canvas of the signer's guest via the shared wardrobe engine.
       Entries without a look (legacy, or a signer who never visited the lounge)
       get the stock guest at half strength. Returns null if the engine is
       absent, so the book still works without avatars. */
    function avatar(look, cls) {
      if (!window.GuestSprite) return null;
      var c = GuestSprite.renderLook(look || {}, { scale: 2 });
      c.className = cls;
      c.setAttribute("aria-hidden", "true");
      return c;
    }
    function render(entries) {
      list.innerHTML = "";
      entries.forEach(function (e) {
        var row = document.createElement("div");
        row.className = "gb-entry";
        var av = avatar(e.look, "gb-entry__avatar" + (e.look ? "" : " gb-entry__avatar--anon"));
        if (av) row.appendChild(av);
        var body = document.createElement("div");
        body.className = "gb-entry__body";
        body.innerHTML =
          '<span class="gb-entry__date">' + esc(e.ts) + "</span>" +
          '<div class="gb-entry__head">' + esc(e.name) + " wrote:</div>" +
          '<p class="gb-entry__msg">' + esc(e.msg) + "</p>";
        row.appendChild(body);
        list.appendChild(row);
      });
    }

    /* "This is you" preview above the form: shows the guest that will sign, and
       points first-timers to the lounge to build one. */
    var youWrap = document.createElement("div");
    youWrap.className = "gb-you";
    form.parentNode.insertBefore(youWrap, form);
    function renderYou() {
      var look = loadMyLook();
      youWrap.innerHTML = "";
      var av = avatar(look, "gb-you__av");
      if (av) youWrap.appendChild(av);
      var txt = document.createElement("div");
      txt.className = "gb-you__txt";
      txt.innerHTML = look
        ? "this is <b>your guest</b> — they sign with you.<br>" +
          '<a href="lounge.html">re-dress them in the lounge →</a>'
        : "sign with your own guest — " +
          '<a href="lounge.html">make one in the lounge →</a>';
      youWrap.appendChild(txt);
    }
    renderYou();

    var entries = localLoad();
    render(entries);

    /* Prefer the shared book. If it answers, it becomes the source of truth. */
    fetch("/api/guestbook")
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        if (!d || !Array.isArray(d.entries)) throw 0;
        apiOK = true;
        entries = d.entries.length ? d.entries : seed.slice();
        render(entries);
      })
      .catch(function () { /* API absent — the local copy already shows */ });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("gb-name").value.trim();
      var text = document.getElementById("gb-msg").value.trim();
      if (!name || !text) return;
      var myLook = loadMyLook();
      var entry = { name: name, msg: text, ts: new Date().toISOString().slice(0, 10) };
      if (myLook) entry.look = myLook;

      function localAppend() {
        entries.unshift(entry);
        localSave(entries);
        render(entries);
        form.reset();
      }

      if (!apiOK) { localAppend(); return; }
      fetch("/api/guestbook", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name, msg: text, look: myLook || undefined,
                               website: hp ? hp.value : "" })
      })
        .then(function (r) { if (!r.ok) throw 0; return r.json(); })
        .then(function (d) {
          if (!d || !Array.isArray(d.entries)) throw 0;
          entries = d.entries;
          render(entries);
          form.reset();
        })
        .catch(function () { localAppend(); });   /* rate-limited or offline — keep it local */
    });
  })();

})();
