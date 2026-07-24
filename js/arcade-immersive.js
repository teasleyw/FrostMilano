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

  /* ================= zoom lock =================
     The reading pages are meant to pinch-zoom - a bio, a tour date, a set of
     liner notes all earn it - so the viewport tag site-wide leaves zoom open.
     A game is the opposite: the board is already handed the whole viewport, so
     there is nothing to zoom into, and the canvas runs touch-action:none to
     read paddles and towers raw. That combination is the trap the player hits -
     pinch in once (or arrive already zoomed from the page before), and a
     pinch-OUT over the board does nothing, leaving the game stuck magnified
     with no way back.

     Opening a cabinet snaps the page back to 1:1 and holds it there; closing
     hands zoom back. The state lives at module scope so the three cabinets
     share one lock and a stray double-enter can't strand the saved viewport. */
  var zoomLocks = 0, savedViewport = null;
  function viewportMeta() { return document.querySelector('meta[name="viewport"]'); }
  function blockGesture(e) { e.preventDefault(); }
  function lockZoom() {
    if (zoomLocks++ > 0) return;
    var vp = viewportMeta();
    if (!vp) return;
    savedViewport = vp.getAttribute("content");
    /* Dropping maximum-scale below the live zoom is what actually snaps iOS
       Safari back to 1:1; user-scalable holds it on browsers that honour the
       tag, and the gesture guard covers iOS, which ignores it and would let a
       two-finger pinch back in mid-game otherwise. */
    vp.setAttribute("content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover");
    document.addEventListener("gesturestart", blockGesture, { passive: false });
    document.addEventListener("gesturechange", blockGesture, { passive: false });
  }
  function unlockZoom() {
    if (zoomLocks === 0 || --zoomLocks > 0) return;
    document.removeEventListener("gesturestart", blockGesture);
    document.removeEventListener("gesturechange", blockGesture);
    var vp = viewportMeta();
    if (vp && savedViewport != null) vp.setAttribute("content", savedViewport);
    savedViewport = null;
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
        /* Synchronous and first, while the opening click is still the live
           gesture: rewriting the viewport tag here is what resets a carried-in
           zoom, and iOS only honours viewport changes made inside a gesture. */
        lockZoom();
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
        unlockZoom();
        setState(false);
      },
      toggle: function () { if (on) api.leave(); else api.enter(); }
    };
    return api;
  }

  global.ArcadeImmersive = { create: create };
})(window);
