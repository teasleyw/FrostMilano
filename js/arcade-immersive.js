/* =======================================================================
   ARCADE IMMERSIVE :: fullscreen for the lounge's cabinets
   =======================================================================
   The cabinet chrome - a marquee, a hint line, a 220px score aside - is the
   right frame for a machine standing in a room and the wrong one for actually
   playing, especially on a phone where it leaves the board a letterbox. This
   turns any .arcade overlay into a full-viewport game with the chrome dropped
   and the readouts floated back on top.

   Every capability here is asked for and none is assumed. iPhone Safari has no
   element fullscreen and no orientation lock, and a wake lock can be refused
   or reclaimed at any time. When they are all refused you still get the thing
   that matters most - the whole viewport handed to the board - because that
   part is a CSS class and nothing can take it away.

   Extracted from the Winter Maul cabinet so all three machines share one
   implementation, the same way js/guest-sprite.js is shared with the homepage.
   ======================================================================= */
(function (global) {
  "use strict";

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  /* opts:
       onResize  - called after the viewport changes and after enter/leave, so
                   the caller can re-measure and redraw.
       onChange  - called with (isOn) whenever immersive turns on or off,
                   including when the browser drops fullscreen by itself. */
  function create(overlay, opts) {
    opts = opts || {};
    var on = false, wake = null, bound = false;

    function requestFS() {
      var fn = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
      if (!fn) return Promise.reject();
      try { return Promise.resolve(fn.call(overlay, { navigationUI: "hide" })); }
      catch (e) { return Promise.reject(e); }
    }
    function exitFS() {
      if (!fsElement()) return;
      var fn = document.exitFullscreen || document.webkitExitFullscreen;
      if (fn) { try { fn.call(document); } catch (e) {} }
    }
    /* An arcade game has long stretches with no input at all - a wave clock
       ticking while you watch, a ball in flight - which is exactly what a
       screen blank must not interrupt. */
    function acquireWake() {
      if (!navigator.wakeLock || wake) return;
      navigator.wakeLock.request("screen").then(function (w) {
        wake = w;
        w.addEventListener("release", function () { wake = null; });
      }, function () {});
    }
    function releaseWake() {
      if (!wake) return;
      try { wake.release(); } catch (e) {}
      wake = null;
    }
    function lockLandscape() {
      var so = global.screen && global.screen.orientation;
      if (!so || !so.lock) return;
      try {
        var p = so.lock("landscape");
        if (p && p["catch"]) p["catch"](function () {});
      } catch (e) {}
    }
    function unlockOrientation() {
      var so = global.screen && global.screen.orientation;
      if (so && so.unlock) { try { so.unlock(); } catch (e) {} }
    }

    /* Letterbox a fixed-size board into the viewport.

       CSS alone can shrink a canvas to fit while keeping its shape, but it
       cannot grow one: max-width/max-height only ever clamp. object-fit would
       do both, and is the wrong tool here - it scales the bitmap INSIDE an
       element box that stays full-size, so clientWidth no longer matches what
       is on screen and every cabinet's pointer-to-canvas maths quietly goes
       wrong. Setting the element's own box keeps those equal, which is the
       property the input handlers are built on. */
    function fitCanvas() {
      var c = opts.fitCanvas;
      if (!c || !c.parentNode) return;
      if (!on) { c.style.width = ""; c.style.height = ""; return; }
      var box = c.parentNode.getBoundingClientRect();
      if (!box.width || !box.height || !c.width || !c.height) return;
      var ar = c.width / c.height, w = box.width, h = box.height;
      if (w / h > ar) w = h * ar; else h = w / ar;
      c.style.width = Math.round(w) + "px";
      c.style.height = Math.round(h) + "px";
    }

    function fire() {
      if (opts.onChange) opts.onChange(on);
      fitCanvas();
      if (opts.onResize) opts.onResize();
    }
    function setState(next) {
      if (on === next) return;
      on = next;
      overlay.classList.toggle("is-immersive", on);
      fire();
    }

    /* Leaving fullscreen by the browser's own affordance - ESC, a system back
       gesture, a swipe down - has to drop immersive with it, or the overlay is
       left claiming a viewport it no longer owns. */
    function onFsChange() {
      if (on && !fsElement()) api.leave();
      else if (opts.onResize) opts.onResize();
    }
    function onResize() {
      fitCanvas();
      if (opts.onResize) opts.onResize();
    }
    function onVisible() { if (!document.hidden && on) acquireWake(); }

    function bind() {
      if (bound) return;
      bound = true;
      document.addEventListener("fullscreenchange", onFsChange);
      document.addEventListener("webkitfullscreenchange", onFsChange);
      global.addEventListener("resize", onResize);
      global.addEventListener("orientationchange", onResize);
      /* The system drops a wake lock whenever the page is backgrounded and
         never hands it back, so returning has to ask again. */
      document.addEventListener("visibilitychange", onVisible);
    }

    var api = {
      isOn: function () { return on; },
      enter: function () {
        bind();
        setState(true);
        acquireWake();
        /* Fullscreen needs a live user gesture. Opening a cabinet is a click,
           so the usual path has one; a programmatic open (a check, a deep
           link) does not, and lands in the rejection handler with the
           class-only layout - which is the same thing iOS gets. */
        requestFS().then(function () {
          /* Only a fullscreen document may hold an orientation lock, so this
             waits for the transition rather than racing it. */
          lockLandscape();
          fitCanvas();
          if (opts.onResize) opts.onResize();
        }, function () {});
      },
      leave: function () {
        exitFS();
        unlockOrientation();
        releaseWake();
        setState(false);
      },
      toggle: function () { if (on) api.leave(); else api.enter(); }
    };
    return api;
  }

  global.ArcadeImmersive = { create: create };
})(window);
