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

      /* Only a frame that actually decoded proves the file is really there. */
      video.addEventListener("loadeddata", function () {
        tv.classList.add("tv--live");
        if (reduceMotion) video.controls = true;
        if (io) io.observe(video);
      });

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
   * Visitor counter (persisted in localStorage — it's the 90s, baby)
   * ----------------------------------------------------------------- */
  (function counter() {
    var el = document.getElementById("counter");
    if (!el) return;
    var BASE = 1337; // starting hype number
    var n = BASE;
    try {
      var stored = parseInt(localStorage.getItem("frost_visits"), 10);
      n = (isNaN(stored) ? BASE : stored) + 1;
      localStorage.setItem("frost_visits", String(n));
    } catch (e) { /* private mode — just show the base */ }
    el.textContent = String(n).padStart(6, "0");
  })();

  /* ----------------------------------------------------------------- *
   * Ice-list signup (front-end only — wire up to a real service later)
   * ----------------------------------------------------------------- */
  (function signup() {
    var form = document.getElementById("signup-form");
    if (!form) return;
    var msg = document.getElementById("signup-msg");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var input = document.getElementById("signup-email");
      msg.textContent = "❄ YOU'RE ON THE ICE LIST, " +
        input.value.split("@")[0].toUpperCase() + "! STAY FROSTY. ❄";
      form.reset();
    });
  })();

  /* ----------------------------------------------------------------- *
   * Guestbook (persisted in localStorage; text is escaped on render)
   * ----------------------------------------------------------------- */
  (function guestbook() {
    var form = document.getElementById("guestbook-form");
    var list = document.getElementById("guestbook");
    if (!form || !list) return;

    /* _v2 retires anyone's locally-saved copy of the old fabricated seed
       entries. Bump again if the seed ever needs to be force-refreshed. */
    var KEY = "frost_guestbook_v2";
    /* One entry, so the guestbook isn't empty on first load.
       No invented fans and no invented song titles — the old seed had
       strangers raving about a track called "SUBZERO" that doesn't exist. */
    var seed = [
      { name: "webmaster", msg: "site's up. sign below. ❄", ts: "1999-08-14" }
    ];

    function load() {
      try {
        var raw = localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return seed.slice();
    }
    function save(entries) {
      try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch (e) {}
    }
    function esc(s) {
      var d = document.createElement("div");
      d.textContent = s;
      return d.innerHTML;
    }
    function render(entries) {
      list.innerHTML = entries.map(function (e) {
        return '<div class="gb-entry">' +
          '<span class="gb-entry__date">' + esc(e.ts) + "</span>" +
          '<div class="gb-entry__head">' + esc(e.name) + " wrote:</div>" +
          '<p class="gb-entry__msg">' + esc(e.msg) + "</p>" +
          "</div>";
      }).join("");
    }

    var entries = load();
    render(entries);

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("gb-name").value.trim();
      var text = document.getElementById("gb-msg").value.trim();
      if (!name || !text) return;
      entries.unshift({
        name: name,
        msg: text,
        ts: new Date().toISOString().slice(0, 10)
      });
      save(entries);
      render(entries);
      form.reset();
    });
  })();

})();
