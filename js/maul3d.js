/* =======================================================================
   MAUL3D :: a WebGL renderer for the Winter Maul board
   =======================================================================
   The isometric renderer in lounge.html draws the board as fixed 2D shapes.
   That works beautifully at 17x17 and it cannot do two things the Warcraft III
   maul maps do: turn the camera to an arbitrary angle, and hold a map several
   times larger without the draw-call count following it up.

   Both fall out of the same decision here. Every solid on the board - floor
   tile, rock block, tower plinth, tower body, creep - is the SAME unit cube,
   drawn once with per-instance offset, scale and colour. A full 17x17 maze is
   one draw call. So is a 40x40 one. The cost of a bigger map is a longer
   instance buffer, which is memory bandwidth rather than driver overhead, and
   that is the whole reason a large maul wants a GPU renderer at all.

   No dependency and no build step, matching the rest of the site: the maths is
   ~80 lines of mat4, the lighting is a lambert term, and picking is analytic
   because a grid is a grid - there is no scene graph here to raycast against.

   The game is not in this file. lounge.html owns the simulation and hands over
   accessors; this draws whatever they currently return, and answers "which
   tile is under this pixel". Nothing here mutates game state.
   ======================================================================= */
(function (global) {
  "use strict";

  var TAU = Math.PI * 2;

  /* ---------------- mat4 ----------------
     Column-major, the order WebGL wants, so these go straight into
     uniformMatrix4fv with no transpose. */
  function m4identity(o) {
    o[0]=1;o[1]=0;o[2]=0;o[3]=0; o[4]=0;o[5]=1;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=1;o[11]=0; o[12]=0;o[13]=0;o[14]=0;o[15]=1;
    return o;
  }
  function m4mul(o, a, b) {
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                       a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  function m4perspective(o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0]=f/aspect;o[1]=0;o[2]=0;o[3]=0;
    o[4]=0;o[5]=f;o[6]=0;o[7]=0;
    o[8]=0;o[9]=0;o[10]=(far+near)*nf;o[11]=-1;
    o[12]=0;o[13]=0;o[14]=2*far*near*nf;o[15]=0;
    return o;
  }
  function m4lookAt(o, eye, at, up) {
    var zx=eye[0]-at[0], zy=eye[1]-at[1], zz=eye[2]-at[2];
    var zl=Math.hypot(zx,zy,zz) || 1; zx/=zl; zy/=zl; zz/=zl;
    var xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    var xl=Math.hypot(xx,xy,xz) || 1; xx/=xl; xy/=xl; xz/=xl;
    var yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    o[0]=xx;o[1]=yx;o[2]=zx;o[3]=0;
    o[4]=xy;o[5]=yy;o[6]=zy;o[7]=0;
    o[8]=xz;o[9]=yz;o[10]=zz;o[11]=0;
    o[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    o[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    o[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    o[15]=1;
    return o;
  }

  /* ---------------- shaders ----------------
     Flat-shaded axis-aligned boxes. An axis-aligned box under axis-aligned
     scaling keeps its face normals pointing along the axes, so the unit cube's
     normals pass through untouched - no normal matrix, no inverse-transpose.

     The light is fixed in world space and deliberately hard: one direction,
     a strong ambient floor, and an extra lift on upward faces. That is the
     same convention the 2D renderer used (left face dark, right mid, lid
     bright) and it is why a maze of a hundred walls reads as one lit mass
     rather than a field of loose cubes - only now it stays correct when the
     camera turns, which is the entire point of this file. */
  var VERT = [
    "attribute vec3 aPos;",
    "attribute vec3 aNormal;",
    "attribute vec3 iOffset;",
    "attribute vec3 iScale;",
    "attribute vec3 iColor;",
    "attribute float iGlow;",
    "uniform mat4 uViewProj;",
    "varying vec3 vNormal;",
    "varying vec3 vColor;",
    "varying float vGlow;",
    "void main() {",
    "  vec3 world = iOffset + aPos * iScale;",
    "  vNormal = aNormal;",
    "  vColor = iColor;",
    "  vGlow = iGlow;",
    "  gl_Position = uViewProj * vec4(world, 1.0);",
    "}"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "varying vec3 vNormal;",
    "varying vec3 vColor;",
    "varying float vGlow;",
    "uniform vec3 uLight;",
    "void main() {",
    "  vec3 n = normalize(vNormal);",
    "  float d = max(dot(n, uLight), 0.0);",
    /* Ambient is high and directional is gentle: this is a readability
       problem, not a realism one. A wall whose dark side goes black is a wall
       whose silhouette you lose the moment the camera swings behind it - and
       with a free camera every wall is eventually backlit. */
    "  float lam = 0.62 + 0.38 * d;",
    "  lam += 0.20 * max(n.y, 0.0);",
    "  vec3 c = vColor * lam;",
    /* Glow opts a surface out of the lighting. The lit road from gate to drain
       is the one thing a maul player reads constantly, and a road that dims
       when the camera swings behind it is a road you have to re-find every
       time you turn. So it is emissive, not lit. */
    "  c = mix(c, vColor * 1.18, vGlow);",
    "  gl_FragColor = vec4(c, 1.0);",
    "}"
  ].join("\n");

  /* ---------------- the effects shader ----------------
     Shots, hits and snow are light rather than matter. They have to glow
     through the maze instead of hiding behind it, stack where they overlap,
     and be gone a fifth of a second later - none of which the opaque cube
     above does, and all of which it would be wrong to teach it.

     So: a second primitive, and only one. A camera-facing quad stretched
     between two world points. Hand it two different points and it is a beam;
     hand it the same point twice and it collapses to a round sprite, because
     the shader gives a zero-length segment a length of one sprite-height
     along the camera's own up axis. A bolt, its muzzle flash, an ember off a
     kill, a segment of a shockwave and a snowflake are then the same instance
     with different endpoints - which is the cube trick again, and it means the
     entire effects layer is one more draw call on top of the board's one. */
  var FX_VERT = [
    "attribute vec2 aQuad;",             /* x: -0.5..0.5 across, y: 0..1 along */
    "attribute vec3 iA;",
    "attribute vec3 iB;",
    "attribute vec3 iColor;",
    "attribute float iSize;",
    "attribute float iAlpha;",
    "uniform mat4 uViewProj;",
    "uniform vec3 uEye;",
    "uniform vec3 uCamUp;",
    "uniform vec3 uCamRight;",
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "varying vec2 vQuad;",
    "varying float vPoint;",
    "void main() {",
    "  vec3 seg = iB - iA;",
    "  float isPt = step(length(seg), 1e-4);",
    "  vec3 a = mix(iA, iA - uCamUp * iSize * 0.5, isPt);",
    "  vec3 b = mix(iB, iA + uCamUp * iSize * 0.5, isPt);",
    "  vec3 axis = normalize(mix(seg, uCamUp, isPt));",
    "  vec3 side = cross(axis, uEye - mix(a, b, 0.5));",
    "  float sl = length(side);",
    /* A bolt fired straight down the camera's own axis has no well-defined
       sideways. Any perpendicular will do - on screen it is a dot either way. */
    "  side = sl > 1e-4 ? side / sl : uCamRight;",
    "  vColor = iColor; vAlpha = iAlpha; vQuad = aQuad; vPoint = isPt;",
    "  vec3 world = mix(a, b, aQuad.y) + side * (aQuad.x * iSize);",
    "  gl_Position = uViewProj * vec4(world, 1.0);",
    "}"
  ].join("\n");

  var FX_FRAG = [
    "precision mediump float;",
    "varying vec3 vColor;",
    "varying float vAlpha;",
    "varying vec2 vQuad;",
    "varying float vPoint;",
    "void main() {",
    "  float u = vQuad.x * 2.0;",
    "  float v = vQuad.y * 2.0 - 1.0;",
    /* A beam falls off across its width and holds along its length; a sprite
       falls off in every direction. Same quad, one mix. Squaring the falloff
       is what stops a quad looking like a quad - a linear edge reads as the
       polygon it is, a squared one reads as glare. */
    "  float f = 1.0 - mix(abs(u), min(1.0, length(vec2(u, v))), vPoint);",
    "  f *= f;",
    /* Straight additive, intensity carried in the colour: overlapping effects
       pile up into something brighter rather than the last one drawn winning,
       which is how a cluster of kills should read. */
    "  gl_FragColor = vec4(vColor * (f * vAlpha), 1.0);",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error("maul3d shader: " + gl.getShaderInfoLog(s));
    }
    return s;
  }

  /* A unit cube centred on X and Z and sitting ON the ground in Y, so an
     instance's offset is its tile centre and its Y scale is its height - which
     is how the board thinks about towers already. */
  function cubeGeometry() {
    var p = [], n = [];
    function face(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz) {
      p.push(ax,ay,az, bx,by,bz, cx,cy,cz, ax,ay,az, cx,cy,cz, dx,dy,dz);
      for (var i = 0; i < 6; i++) n.push(nx, ny, nz);
    }
    var h = 0.5;
    face(-h,1,-h,  h,1,-h,  h,1, h, -h,1, h,  0, 1, 0);   /* top   */
    face(-h,0, h,  h,0, h,  h,0,-h, -h,0,-h,  0,-1, 0);   /* bottom*/
    face(-h,0, h, -h,1, h,  h,1, h,  h,0, h,  0, 0, 1);   /* +z    */
    face( h,0,-h,  h,1,-h, -h,1,-h, -h,0,-h,  0, 0,-1);   /* -z    */
    face( h,0, h,  h,1, h,  h,1,-h,  h,0,-h,  1, 0, 0);   /* +x    */
    face(-h,0,-h, -h,1,-h, -h,1, h, -h,0, h, -1, 0, 0);   /* -x    */
    return { pos: new Float32Array(p), norm: new Float32Array(n), count: p.length / 3 };
  }

  /* Two triangles in the parameter space the effects shader expects: across
     the ribbon in x, along it in y. It never becomes a world-space quad here -
     the vertex shader builds that per instance from the camera. */
  function quadGeometry() {
    return new Float32Array([
      -0.5, 0,  0.5, 0,  0.5, 1,
      -0.5, 0,  0.5, 1, -0.5, 1
    ]);
  }

  function hexToRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16) / 255,
            parseInt(hex.slice(3, 5), 16) / 255,
            parseInt(hex.slice(5, 7), 16) / 255];
  }

  /* =====================================================================
     create(canvas, world) -> renderer
     `world` is the accessor bundle lounge.html passes in. Everything read
     through it is read fresh every frame; this renderer caches no game state.
     ===================================================================== */
  function create(canvas, world) {
    var gl = canvas.getContext("webgl", {
      antialias: true, alpha: false, depth: true, powerPreference: "high-performance"
    }) || canvas.getContext("experimental-webgl");
    if (!gl) return null;

    var ext = gl.getExtension("ANGLE_instanced_arrays");
    if (!ext) return null;          /* caller falls back to the 2D cabinet */

    var COLS = world.cols, ROWS = world.rows;
    /* A static hint, read once: how far the rival's board is planted from the
       origin, in tiles. The camera uses it to widen its pan clamp and its
       zoom-out so the second board is reachable; the per-frame contents come
       through world.getRival(). Absent in any embedding without a rival, which
       leaves every camera bound exactly where it was. */
    var RIV = world.rivalOffset || null;
    var RVX = RIV ? RIV[0] : 0, RVZ = RIV ? RIV[1] : 0;

    function link(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error("maul3d link: " + gl.getProgramInfoLog(p));
      }
      return p;
    }

    var prog = link(VERT, FRAG);
    var A = {
      pos: gl.getAttribLocation(prog, "aPos"),
      norm: gl.getAttribLocation(prog, "aNormal"),
      off: gl.getAttribLocation(prog, "iOffset"),
      scale: gl.getAttribLocation(prog, "iScale"),
      color: gl.getAttribLocation(prog, "iColor"),
      glow: gl.getAttribLocation(prog, "iGlow")
    };
    var U = {
      viewProj: gl.getUniformLocation(prog, "uViewProj"),
      light: gl.getUniformLocation(prog, "uLight")
    };

    var fxProg = link(FX_VERT, FX_FRAG);
    var FA = {
      quad: gl.getAttribLocation(fxProg, "aQuad"),
      a: gl.getAttribLocation(fxProg, "iA"),
      b: gl.getAttribLocation(fxProg, "iB"),
      color: gl.getAttribLocation(fxProg, "iColor"),
      size: gl.getAttribLocation(fxProg, "iSize"),
      alpha: gl.getAttribLocation(fxProg, "iAlpha")
    };
    var FU = {
      viewProj: gl.getUniformLocation(fxProg, "uViewProj"),
      eye: gl.getUniformLocation(fxProg, "uEye"),
      camUp: gl.getUniformLocation(fxProg, "uCamUp"),
      camRight: gl.getUniformLocation(fxProg, "uCamRight")
    };

    /* Attribute enable state is global in WebGL 1 - there are no vertex array
       objects here - and it outlives the program that set it. With two passes
       the second can inherit an array the first left enabled at an index it
       reads for something else, which on a strict driver is a dropped draw
       rather than a visual glitch. So each pass names its whole set and the
       rest are turned off. */
    var ATTRIBS = [];
    [A, FA].forEach(function (set) {
      Object.keys(set).forEach(function (k) {
        if (set[k] >= 0 && ATTRIBS.indexOf(set[k]) < 0) ATTRIBS.push(set[k]);
      });
    });
    function onlyAttribs(active) {
      for (var i = 0; i < ATTRIBS.length; i++) {
        if (active.indexOf(ATTRIBS[i]) < 0) gl.disableVertexAttribArray(ATTRIBS[i]);
      }
    }

    var cube = cubeGeometry();
    var bufPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
    gl.bufferData(gl.ARRAY_BUFFER, cube.pos, gl.STATIC_DRAW);
    var bufNorm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufNorm);
    gl.bufferData(gl.ARRAY_BUFFER, cube.norm, gl.STATIC_DRAW);

    /* One growable instance buffer, refilled each frame. Reallocating only
       when the board outgrows it keeps a steady-state frame free of GC. */
    var STRIDE = 10;                 /* off3 + scale3 + colour3 + glow1 */
    var cap = 4096;
    var inst = new Float32Array(cap * STRIDE);
    var bufInst = gl.createBuffer();
    var nInst = 0;

    function reserve(n) {
      if (n <= cap) return;
      while (cap < n) cap *= 2;
      inst = new Float32Array(cap * STRIDE);
    }
    function push(x, y, z, sx, sy, sz, c, glow) {
      var i = nInst * STRIDE;
      inst[i]=x; inst[i+1]=y; inst[i+2]=z;
      inst[i+3]=sx; inst[i+4]=sy; inst[i+5]=sz;
      inst[i+6]=c[0]; inst[i+7]=c[1]; inst[i+8]=c[2];
      inst[i+9]=glow || 0;
      nInst++;
    }

    /* The effects buffer, same growable arrangement. It is refilled from
       scratch every frame like the board's, and for the same reason: the
       simulation already holds the live shots and hits, so the renderer
       keeping its own copy could only ever be a way to disagree with it. */
    var quad = quadGeometry();
    var bufQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    var FX_STRIDE = 11;              /* a3 + b3 + colour3 + size1 + alpha1 */
    var fxCap = 2048;
    var fxInst = new Float32Array(fxCap * FX_STRIDE);
    var bufFx = gl.createBuffer();
    var nFx = 0;

    function fxSeg(ax, ay, az, bx, by, bz, size, c, alpha) {
      if (alpha <= 0.002 || size <= 0) return;
      if (nFx >= fxCap) {
        /* A long boss wave can put a lot of embers in the air at once. Grow
           rather than drop: a burst that thins out under load looks like a
           bug in the game, not a budget in the renderer. */
        fxCap *= 2;
        var bigger = new Float32Array(fxCap * FX_STRIDE);
        bigger.set(fxInst);
        fxInst = bigger;
      }
      var i = nFx * FX_STRIDE;
      fxInst[i]=ax; fxInst[i+1]=ay; fxInst[i+2]=az;
      fxInst[i+3]=bx; fxInst[i+4]=by; fxInst[i+5]=bz;
      fxInst[i+6]=c[0]; fxInst[i+7]=c[1]; fxInst[i+8]=c[2];
      fxInst[i+9]=size; fxInst[i+10]=alpha;
      nFx++;
    }
    /* A sprite is a segment that goes nowhere. */
    function fxPoint(x, y, z, size, c, alpha) {
      fxSeg(x, y, z, x, y, z, size, c, alpha);
    }
    /* A ring lying flat on the board, drawn as tangent dashes rather than a
       closed band: the gaps keep it reading as a ring from a low camera, where
       a solid one foreshortens into a smear, and they cost less. */
    var RING_SEGS = 24;
    function fxRing(cx, cz, y, r, size, c, alpha) {
      var step = TAU / RING_SEGS;
      for (var s = 0; s < RING_SEGS; s++) {
        var a0 = s * step, a1 = a0 + step * 0.6;
        fxSeg(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r,
              cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r,
              size, c, alpha);
      }
    }

    /* ---------------- camera ----------------
       A target that sits on the ground plane, viewed from one fixed heading and
       pitch (YAW0/PITCH0 below): the board is panned and zoomed, never turned -
       the Warcraft camera, where you slide over the map instead of orbiting it.
       The pitch clamp and MIN/MAX below still bound anything that could move the
       angle, but with the lock on nothing does; they are the guard rails for the
       day the lock comes back off. */
    /* Framing is derived from the board rather than hardcoded, so a larger map
       opens correctly framed instead of needing the constants retuned. At this
       field of view a board of N tiles subtends the view at about 1.15N. */
    var FIT = Math.max(COLS, ROWS) * 1.15;
    /* The heading the board is played from, and the one RESET VIEW returns to.
       90 degrees: the camera sits past the drain looking straight up the lane,
       so the gate is at the back of the shot and the creeps march head-on down
       the screen - toward the drain and the player - instead of crossing it.
       (180, which this used to be, sat the run side-on, walking left to right;
       the quarter-turn is what makes them come at you, and it drops the drain -
       the tile you defend - to the near edge under the deck.) PITCH0 is held
       with it. LOCKED freezes both - orbit, snap and the rotation half of a
       pinch all become no-ops - so the only camera verbs left are pan
       (edge-scroll or drag) and zoom. */
    var YAW0 = Math.PI / 2, PITCH0 = 0.95, LOCKED = true;
    var cam = {
      tx: (COLS - 1) / 2, tz: (ROWS - 1) / 2,
      yaw: YAW0, pitch: PITCH0, dist: FIT
    };
    var MIN_PITCH = 0.30, MAX_PITCH = 1.45;
    /* The zoom-out clamp is deliberately far: a phone held portrait has to pull
       the camera back to nearly four times FIT to hold the whole board, and
       fitDist() below reaches for exactly that. */
    /* The far clamp gets the rival's reach added on top of the single-board
       pull-back, so you can zoom out far enough to hold both mazes in frame at
       once - without it the second board would sit forever just past the edge. */
    var MIN_DIST = Math.max(4, FIT * 0.22),
        MAX_DIST = FIT * 4 + Math.max(Math.abs(RVX), Math.abs(RVZ)) * 2;
    function clampDist(d) { return Math.max(MIN_DIST, Math.min(MAX_DIST, d)); }

    /* The distance that frames the whole board in a viewport of this aspect,
       set by two aspects that answer two separate questions.

       FIT was tuned on a landscape phone, where the board's height fills the
       view and its width has room to spare. Turn the phone portrait and the
       width becomes the binding edge - the board's diagonal runs off both sides.

       FIT_KNEE is where that turnover happens: at or above it - every desktop,
       the cabinet, any landscape phone - the board frames at exactly FIT and
       nothing that already framed well moves. Below it the camera pulls back by
       FIT_PORTRAIT/aspect. The 1/aspect holds the board the same size however
       narrow the phone gets; FIT_PORTRAIT sitting a little above the knee is
       what buys the margin - it leaves the board at about 0.8 of the width with
       real space down the sides rather than jammed against the edges. The two
       being different puts a small step between the branches, but it lands at
       an aspect (~1.55) no device is actually held at, so it is only ever
       crossed mid-drag on a desktop, where a few percent of zoom is invisible. */
    var FIT_KNEE = 1.55, FIT_PORTRAIT = 1.70, lastAspect = FIT_KNEE;
    function fitDist(aspect) {
      if (!(aspect > 0)) aspect = lastAspect;
      return aspect >= FIT_KNEE ? FIT : FIT * (FIT_PORTRAIT / aspect);
    }

    var view = new Float32Array(16), proj = new Float32Array(16),
        viewProj = new Float32Array(16);
    var eye = [0, 0, 0], target = [0, 0, 0], UP = [0, 1, 0];

    function eyePos() {
      var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      return [cam.tx + Math.cos(cam.yaw) * cp * cam.dist,
              sp * cam.dist,
              cam.tz + Math.sin(cam.yaw) * cp * cam.dist];
    }
    function updateCamera(w, h) {
      /* Both sides clamped, not just the height. A zero width divides into the
         projection's first term and hands back Infinity, which multiplies out to
         a NaN matrix - and a NaN matrix does not draw a wrong picture, it draws
         nothing at all, so the board comes up black and stays black. The canvas
         really can measure zero here: it is read while the cabinet is
         mid-transition into fullscreen, before the new layout has landed. */
      lastAspect = Math.max(1, w) / Math.max(1, h);
      var e = eyePos();
      eye[0]=e[0]; eye[1]=e[1]; eye[2]=e[2];
      target[0]=cam.tx; target[1]=0; target[2]=cam.tz;
      m4perspective(proj, 0.85, lastAspect, 0.5, 400);
      m4lookAt(view, eye, target, UP);
      m4mul(viewProj, proj, view);
    }

    /* Pan is applied along the camera's own ground axes, so dragging right
       moves the board right whatever direction you happen to be facing. */
    function pan(dx, dz) {
      var c = Math.cos(cam.yaw), s = Math.sin(cam.yaw);
      cam.tx += dx * s - dz * c;
      cam.tz += -dx * c - dz * s;
      clampTarget();
    }
    /* The pan box spans from the origin board out to the rival board, so a
       drag can carry the target across to the AI's maze and back. With no
       rival (RVX = RVZ = 0) it is exactly the old single-board box. */
    function clampTarget() {
      var m = 6;
      var minX = Math.min(0, RVX), maxX = Math.max(0, RVX) + COLS - 1;
      var minZ = Math.min(0, RVZ), maxZ = Math.max(0, RVZ) + ROWS - 1;
      cam.tx = Math.max(minX - m, Math.min(maxX + m, cam.tx));
      cam.tz = Math.max(minZ - m, Math.min(maxZ + m, cam.tz));
    }
    var camera = {
      get yaw() { return cam.yaw; },
      orbit: function (dy, dp) {
        if (LOCKED) return;              /* the view no longer turns - see YAW0 */
        cam.yaw += dy;
        cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cam.pitch + dp));
      },
      zoom: function (f) {
        cam.dist = clampDist(cam.dist * f);
      },
      /* Absolute, for gestures. A pinch has to work from the pose the fingers
         landed on rather than accumulating deltas, or the drift between what
         the fingers say and where the camera is compounds over a long
         two-finger drag. */
      set: function (yaw, pitch, dist) {
        /* A pinch still zooms; with the lock on it just can't turn or tilt while
           it does, so the two-finger yaw/pitch it hands in are dropped. */
        if (!LOCKED) {
          cam.yaw = yaw;
          cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
        }
        cam.dist = clampDist(dist);
      },
      pan: pan,
      /* The same move in world axes. Grab-and-drag already has its answer in
         world units - routing it through pan() would only rotate it into the
         camera's axes and straight back out again. */
      panWorld: function (dx, dz) {
        cam.tx += dx;
        cam.tz += dz;
        clampTarget();
      },
      /* Re-fit the framing to the current viewport without touching the angle
         the player is looking from - so rotating a phone between portrait and
         landscape reframes the board while an orbit is left standing. Re-centres
         the target too, which is a no-op until a pan has moved it. The caller
         decides when this is wanted (it holds the "has the player taken the
         camera" flag); here it just does the fit. */
      frame: function (w, h) {
        lastAspect = Math.max(1, w) / Math.max(1, h);   /* see updateCamera */
        cam.tx = (COLS - 1) / 2; cam.tz = (ROWS - 1) / 2;
        cam.dist = clampDist(fitDist(lastAspect));
      },
      /* Snap to the nearest quarter turn, for a button or a key: a maul is
         built on a square grid and the four corner views are the ones a player
         actually wants to flick between. */
      snap: function (dir) {
        if (LOCKED) return;              /* nothing to snap between - see YAW0 */
        var q = Math.PI / 2;
        cam.yaw = (Math.round(cam.yaw / q) + dir) * q;
      },
      reset: function () {
        cam.tx = (COLS - 1) / 2; cam.tz = (ROWS - 1) / 2;
        cam.yaw = YAW0; cam.pitch = PITCH0;
        cam.dist = clampDist(fitDist(lastAspect));
      },
      state: function () {
        return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
                 tx: cam.tx, tz: cam.tz };
      }
    };

    /* ---------------- picking ----------------
       No raycaster: unproject the pixel to a ray, then walk the grid. The
       ground plane gives the floor answer in closed form, and towers are found
       by marching the ray cell by cell (a DDA) and testing each column's box -
       which reproduces the 2D renderer's rule that you click the tower you can
       SEE, not the tile it happens to lean over. */
    var invVP = new Float32Array(16);
    function m4invert(o, m) {
      var a00=m[0],a01=m[1],a02=m[2],a03=m[3], a10=m[4],a11=m[5],a12=m[6],a13=m[7],
          a20=m[8],a21=m[9],a22=m[10],a23=m[11], a30=m[12],a31=m[13],a32=m[14],a33=m[15];
      var b00=a00*a11-a01*a10, b01=a00*a12-a02*a10, b02=a00*a13-a03*a10,
          b03=a01*a12-a02*a11, b04=a01*a13-a03*a11, b05=a02*a13-a03*a12,
          b06=a20*a31-a21*a30, b07=a20*a32-a22*a30, b08=a20*a33-a23*a30,
          b09=a21*a32-a22*a31, b10=a21*a33-a23*a31, b11=a22*a33-a23*a32;
      var det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
      if (!det) return null;
      det = 1 / det;
      o[0]=(a11*b11-a12*b10+a13*b09)*det;  o[1]=(a02*b10-a01*b11-a03*b09)*det;
      o[2]=(a31*b05-a32*b04+a33*b03)*det;  o[3]=(a22*b04-a21*b05-a23*b03)*det;
      o[4]=(a12*b08-a10*b11-a13*b07)*det;  o[5]=(a00*b11-a02*b08+a03*b07)*det;
      o[6]=(a32*b02-a30*b05-a33*b01)*det;  o[7]=(a20*b05-a22*b02+a23*b01)*det;
      o[8]=(a10*b10-a11*b08+a13*b06)*det;  o[9]=(a01*b08-a00*b10-a03*b06)*det;
      o[10]=(a30*b04-a31*b02+a33*b00)*det; o[11]=(a21*b02-a20*b04-a23*b00)*det;
      o[12]=(a11*b07-a10*b09-a12*b06)*det; o[13]=(a00*b09-a01*b07+a02*b06)*det;
      o[14]=(a31*b01-a30*b03-a32*b00)*det; o[15]=(a20*b03-a21*b01+a22*b00)*det;
      return o;
    }
    function unproject(nx, ny) {
      if (!m4invert(invVP, viewProj)) return null;
      function at(z) {
        var x = invVP[0]*nx + invVP[4]*ny + invVP[8]*z + invVP[12];
        var y = invVP[1]*nx + invVP[5]*ny + invVP[9]*z + invVP[13];
        var w = invVP[3]*nx + invVP[7]*ny + invVP[11]*z + invVP[15];
        var zz = invVP[2]*nx + invVP[6]*ny + invVP[10]*z + invVP[14];
        return w ? [x/w, y/w, zz/w] : null;
      }
      var a = at(-1), b = at(1);
      if (!a || !b) return null;
      var dx=b[0]-a[0], dy=b[1]-a[1], dz=b[2]-a[2];
      var l = Math.hypot(dx,dy,dz) || 1;
      return { o: a, d: [dx/l, dy/l, dz/l] };
    }

    /* Where a pixel's ray meets the ground plane, in world units. This is the
       anchor drag-panning holds on to, so it re-derives the camera rather than
       reading the matrices the last frame left behind: a drag fires several
       moves between frames, and a move that answers for where the camera was
       two moves ago pans by its own correction all over again.
       Null above the horizon - at a low pitch the top of the view is sky, and
       sky has no point under the finger to hold. */
    function groundAt(px, py) {
      var w = canvas.width, h = canvas.height;
      updateCamera(w, h);
      var r = unproject((px / w) * 2 - 1, 1 - (py / h) * 2);
      if (!r || Math.abs(r.d[1]) < 1e-6) return null;
      var t = -r.o[1] / r.d[1];
      return t > 0 ? { x: r.o[0] + r.d[0] * t, z: r.o[2] + r.d[2] * t } : null;
    }

    /* Height of the solid standing on a cell, in world units, or 0 for open
       floor. Kept in step with the heights draw() uses below. */
    function columnHeight(x, y) {
      if (world.isRock(x, y)) return 1.15;
      var t = world.towerAt(x, y);
      if (!t) return 0;
      return towerHeight(t);
    }
    /* Where a creep's middle is, and so where a shot should land and a kill
       should burst. Creeps stand on 0.10 and are a third of a tile through. */
    var CREEP_Y = 0.28;
    function towerHeight(t) {
      /* The 2D renderer's `h` is in screen pixels; here a tile is 1 unit, so
         the same silhouettes are expressed as a fraction of a tile. */
      return 0.28 + (t.def.h / 24) * (0.55 + (t.lvl - 1) * 0.16);
    }

    function pick(px, py) {
      var w = canvas.width, h = canvas.height;
      var nx = (px / w) * 2 - 1, ny = 1 - (py / h) * 2;
      var r = unproject(nx, ny);
      if (!r) return -1;
      var ox=r.o[0], oy=r.o[1], oz=r.o[2], dx=r.d[0], dy=r.d[1], dz=r.d[2];

      /* Tower pass: march the ray across the grid and take the first column
         whose box it enters. Stepping in fixed increments is plenty at this
         scale and is far less code than a true DDA - the ray is short, the
         cells are unit-sized, and a quarter-cell step cannot skip one. */
      var tGround = Math.abs(dy) > 1e-6 ? -oy / dy : -1;
      var far = tGround > 0 ? tGround + 4 : 120;
      for (var t = 0; t < far; t += 0.25) {
        var wx = ox + dx * t, wy = oy + dy * t, wz = oz + dz * t;
        if (wy < -0.5) break;
        var gx = Math.round(wx), gy = Math.round(wz);
        if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) continue;
        var ch = columnHeight(gx, gy);
        if (ch <= 0) continue;
        if (wy <= ch && Math.abs(wx - gx) <= 0.5 && Math.abs(wz - gy) <= 0.5) {
          return gy * COLS + gx;
        }
      }
      /* Floor pass: closed-form intersection with y = 0. */
      if (tGround <= 0) return -1;
      var fx = Math.round(ox + dx * tGround), fy = Math.round(oz + dz * tGround);
      if (fx < 0 || fy < 0 || fx >= COLS || fy >= ROWS) return -1;
      return fy * COLS + fx;
    }

    /* ---------------- palette ----------------
       Lifted from the 2D cabinet so the two renderers are recognisably the
       same room, and cached as float triples because the shader wants those
       and hex parsing per instance per frame would be absurd. */
    /* Brighter across the board than the 2D palette it descends from, and
       deliberately so. The flat renderer could sit the floor almost black
       because nothing was lit and the road was the only bright thing on
       screen; here everything carries a lambert term that only ever darkens
       it, and a floor that starts dark ends up unreadable on the faces
       turned away from the light. */
    var COL = {
      floorA: hexToRGB("#15384c"), floorB: hexToRGB("#1a4258"),
      rock:   hexToRGB("#356f8e"),
      road:   hexToRGB("#2f9dc4"), roadHot: hexToRGB("#c4f6ff"),
      plinth: hexToRGB("#1d4a63"),
      creep:  hexToRGB("#eafcff"), creepSlow: hexToRGB("#8ad9ff"),
      boss:   hexToRGB("#ffd68a"), sent: hexToRGB("#ff7b9c"),
      /* The penguin's own four, and the first two colours on the board that
         aren't cold. Its back is dark on purpose: creeps only ever walk the
         road, which is the brightest surface the renderer draws, so a dark
         body separates from it far better than another pale cube did. */
      penBack:  hexToRGB("#22323f"), penBelly: hexToRGB("#eafcff"),
      penWarm:  hexToRGB("#ff9f42"), penEye:   hexToRGB("#0b1720"),
      /* The boss is carved ice with something burning in it. The body is cold
         and only the core keeps the warm boss colour, so "that one is the
         boss" is a shape and a light rather than a tint - which matters
         because the tint is what stopped working the moment bodies went dark. */
      golem:    hexToRGB("#6d93aa"), golemDark: hexToRGB("#425e70"),
      /* The rival's hound keeps the sends' pink. That colour is the only thing
         telling you a creep came off the other board, so the model darkens it
         for the back and keeps it bright underneath rather than replacing it. */
      wolfDark: hexToRGB("#c9506d"),
      ghost:  hexToRGB("#38e6ff"), sel: hexToRGB("#eafcff"),
      hot:    hexToRGB("#eafcff"), frost: hexToRGB("#b8ecff")
    };
    var towerCol = {};
    function towerColour(hex) {
      return towerCol[hex] || (towerCol[hex] = hexToRGB(hex));
    }

    /* ---------------- snow ----------------
       The site's one recurring motif, and here it earns its keep twice: the
       flat board's flakes are screen-space because a 2D camera has no depth to
       give them, and these are world-space because a 3D one does. Falling
       through the board rather than over it is the cheapest parallax cue the
       renderer has, and parallax is the thing that tells you the camera moved.

       The column follows the camera target and is sized off the view distance,
       so panning to a corner or zooming out never leaves you looking at bare
       sky. Positions are unit fractions, scaled at draw time. */
    var FLAKES = [];
    (function () {
      for (var i = 0; i < 110; i++) {
        FLAKES.push({ x: Math.random(), z: Math.random(), y: Math.random(),
                      r: 0.55 + Math.random() * 0.85,
                      v: 0.30 + Math.random() * 0.55,
                      drift: Math.random() * TAU });
      }
    })();

    /* ---------------- creep models ----------------
       The renderer has one primitive, an axis-aligned box, and no per-instance
       rotation. That reads as a limit on what a creep can be and is really a
       decision about where the detail goes: a creep is thirty-odd pixels on a
       phone, so silhouette and stance are the entire vocabulary and a rotation
       matrix would buy nothing you could see at that size.

       What the grid does buy is exact facing for free. Creeps step cell to
       cell in cardinal directions only, so "turn to face the way you are
       walking" is a swap of the x and z extents rather than a matrix - and a
       body whose feet stride the direction it is actually travelling reads as
       a creature far more strongly than any amount of modelled detail.

       So a model is authored once, walking forward along +f, and these four
       tables map that onto whichever heading the creep took. */
    var FWD_X = [1, 0, -1, 0], FWD_Z = [0, 1, 0, -1];
    var RGT_X = [0, -1, 0, 1], RGT_Z = [1, 0, -1, 0];

    /* Last known heading per creep. The simulation gives a creep the same cell
       for `cell` and `next` at spawn and again at the instant it arrives, and
       a body that snapped to due-east on those frames would twitch its way
       across the board - so a heading is remembered rather than recomputed
       from nothing. Kept out here in a WeakMap because this file does not
       write to game objects, and entries die with the creeps they key. */
    var faceMem = new WeakMap();
    function creepFacing(cr) {
      var a = cr.cell, b = cr.next;
      if (a === b) return faceMem.get(cr) || 1;
      var f = (b % COLS) > (a % COLS) ? 0
            : (b % COLS) < (a % COLS) ? 2
            : b > a ? 1 : 3;
      faceMem.set(cr, f);
      return f;
    }

    /* One box of a model. (f, u, s) is its base corner in the creep's own
       space - f forward along the walk, u up from the creep's feet, s to the
       side - and (lf, lu, ls) its extents on those same axes. The facing swap
       is the whole trick: forward is world x on two headings and world z on
       the other two, so both the offset and the extents follow the same table
       and a model never has to know which way it is pointing. */
    function modelPart(cx, cy, cz, face, f, u, s, lf, lu, ls, col, glow) {
      var fx = FWD_X[face], rx = RGT_X[face];
      push(cx + f * fx + s * rx, cy + u, cz + f * FWD_Z[face] + s * RGT_Z[face],
           fx ? lf : ls, lu, fx ? ls : lf, col, glow);
    }

    function mixCol(a, b, k) {
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k,
              a[2] + (b[2] - a[2]) * k];
    }
    /* Push a colour toward white by f. A muzzle flash whitens the firing part
       of a tower the same way it whitens a creep - it is mixCol against a
       hardcoded white, and it leaves the colour untouched when nothing fired. */
    function whiten(c, f) {
      return f > 0 ? [c[0] + (1 - c[0]) * f, c[1] + (1 - c[1]) * f,
                      c[2] + (1 - c[2]) * f] : c;
    }

    /* ---- the penguin: waves 1-3, and the board's trash tier ----
       A waddle is a weight shift, and a weight shift happens to be exactly
       what a renderer without rotation can express: the body slides out over
       the planted foot while the other one lifts clear. A real penguin also
       rolls about its long axis, which is a rotation and so is not available -
       but at this size the lateral shift alone carries it, and the alternating
       feet sell the rest. */
    function drawPenguin(cr, px, pz, t, base) {
      var face = creepFacing(cr);
      var slowed = cr.slowMul < 1;
      /* Slow is a frost tower's whole job, so it has to be legible at a
         glance. On the pale creeps that was a blue tint; on a body that is
         already dark a tint does nothing, so here it is rime on the shoulders
         and a waddle that drops to a third - which is the better signal
         anyway, and the one the rest of the roster will inherit. */
      var wad = Math.sin(t * 6.5 + (cr.seed || 0)) * (slowed ? 0.3 : 1);
      var lean = wad * 0.035, rise = Math.abs(wad) * 0.018;

      var back = slowed ? mixCol(COL.penBack, COL.frost, 0.28) : COL.penBack;
      var belly = slowed ? mixCol(COL.penBelly, COL.frost, 0.5) : COL.penBelly;

      function part(f, u, s, lf, lu, ls, col, glow) {
        modelPart(px, base, pz, face, f, u + rise, s + lean, lf, lu, ls, col, glow);
      }

      /* Feet stay on the floor - they are the one part the lean and rise must
         not carry, or the whole bird skates. */
      for (var i = -1; i <= 1; i += 2) {
        var lift = Math.max(0, -i * wad) * 0.03;
        modelPart(px, base, pz, face, 0.05, lift, i * 0.055,
                  0.12, 0.03, 0.07, COL.penWarm);
      }

      part(-0.11, 0.03, 0, 0.10, 0.05, 0.11, back);          /* tail   */
      part(0, 0.03, 0, 0.21, 0.21, 0.25, back);              /* body   */
      part(0, 0.24, 0, 0.19, 0.10, 0.22, back);              /* chest  */
      part(0.075, 0.05, 0, 0.06, 0.20, 0.15, belly);         /* belly  */
      part(0.012, 0.34, 0, 0.17, 0.14, 0.18, back);          /* head   */
      part(0.078, 0.35, 0, 0.035, 0.08, 0.11, belly);        /* face   */
      part(0.115, 0.375, 0, 0.075, 0.04, 0.055, COL.penWarm); /* beak  */
      part(0.075, 0.425, -0.048, 0.03, 0.028, 0.028, COL.penEye);
      part(0.075, 0.425, 0.048, 0.03, 0.028, 0.028, COL.penEye);

      /* Flippers swing against the lean, which is the only counter-motion in
         the model and does most of the work of making it look alive. A badly
         hurt penguin is down to one: cheap, and it means a creep's health is
         readable from its shape as well as from the bar above it. */
      var hurt = cr.hp / cr.max < 0.33;
      for (i = -1; i <= 1; i += 2) {
        if (hurt && i < 0) continue;
        part(-0.005, 0.10 + Math.max(0, i * wad) * 0.02, i * 0.128,
             0.10, 0.17, 0.035, back);
      }

      /* On the crown and the shoulders, not through them: the head runs
         0.34-0.48, so a plate at mid-height cuts a band across the face. */
      if (slowed) {
        part(0, 0.47, 0, 0.13, 0.035, 0.15, COL.frost, 0.4);
        part(-0.02, 0.32, 0, 0.16, 0.03, 0.20, COL.frost, 0.4);
      }
    }

    /* ---- the ice wolf: what the rival sends back ----
       Deliberately the opposite shape to the penguin rather than a better one.
       The penguin is tall and occupies a quarter of its tile; this is low and
       runs the whole length of one. At the size these are actually seen, long
       versus short is a read that survives when a beak and a pair of eyes do
       not - and telling a sent creep from a wave creep is the read that
       decides whether you understand why you are losing lives.

       It keeps the sends' pink, only darker on the back and full strength
       underneath. Colour is still doing the work here; the silhouette is
       insurance for when the board is busy or the player is colourblind. */
    function drawWolf(cr, px, pz, t, base) {
      var face = creepFacing(cr);
      var slowed = cr.slowMul < 1;
      var seed = cr.seed || 0;
      /* A trot, so the legs go in diagonal pairs. One sine and a phase flip
         per leg is the whole gait, and it is the difference between a body
         moving and a body being dragged. */
      var sp = slowed ? 0.35 : 1;
      var tr = t * 9 * sp + seed;
      var bob = Math.abs(Math.sin(tr)) * 0.012 * sp;

      /* The bright pink goes on the MASS, not on trim. Carrying it as accents
         over a dark coat looked like a brown animal from three tiles away -
         the lighting floor is 0.62, so a mid tone lands darker than it reads
         in a swatch, and the one thing this model must never lose is that it
         came off the rival's board. The dark tone is demoted to legs, ears and
         tail, where it separates the limbs from the body instead. */
      var coat = slowed ? mixCol(COL.sent, COL.frost, 0.45) : COL.sent;
      var dark = slowed ? mixCol(COL.wolfDark, COL.frost, 0.3) : COL.wolfDark;

      /* Creeps carry a little emissive, and it is not decoration - the cube
         these replaced was drawn at glow 0.45 and that is why it looked pink.
         The shader's ambient floor is 0.62, so a fully lit side face turns
         #ff7b9c into roughly [0.62, 0.30, 0.38]: dusty maroon, which is what
         this model was until the glow came back. Bodies on a dark board need
         the lift to hold a hue at all; the value below is under the cube's so
         the form still shades instead of going flat. */
      function part(f, u, s, lf, lu, ls, col, glow) {
        modelPart(px, base, pz, face, f, u + bob, s, lf, lu, ls, col,
                  glow === undefined ? 0.4 : glow);
      }

      var legs = [[0.16, -0.085, 0], [0.16, 0.085, Math.PI],
                  [-0.14, -0.085, Math.PI], [-0.14, 0.085, 0]];
      for (var i = 0; i < 4; i++) {
        var ph = tr + legs[i][2];
        var lift = Math.max(0, Math.sin(ph)) * 0.05 * sp;
        var swing = Math.cos(ph) * 0.035 * sp;
        modelPart(px, base, pz, face, legs[i][0] + swing, lift, legs[i][1],
                  0.08, 0.15, 0.075, dark, 0.22);
      }

      part(0, 0.14, 0, 0.40, 0.15, 0.19, coat);            /* barrel    */
      part(0.14, 0.15, 0, 0.17, 0.17, 0.22, coat);         /* chest     */
      part(-0.16, 0.13, 0, 0.16, 0.19, 0.22, coat);        /* haunch    */
      part(0, 0.145, 0, 0.34, 0.05, 0.14, dark);           /* underside */
      part(0.25, 0.21, 0, 0.13, 0.11, 0.14, coat);         /* neck      */
      part(0.34, 0.19, 0, 0.18, 0.13, 0.16, coat);         /* head      */
      part(0.45, 0.195, 0, 0.11, 0.075, 0.10, dark);       /* snout     */
      part(0.30, 0.31, -0.052, 0.05, 0.08, 0.04, dark);
      part(0.30, 0.31, 0.052, 0.05, 0.08, 0.04, dark);
      part(0.41, 0.255, -0.058, 0.03, 0.03, 0.028, COL.hot, 0.9);
      part(0.41, 0.255, 0.058, 0.03, 0.03, 0.028, COL.hot, 0.9);

      /* The tail goes first when it is nearly dead - the one part whose loss
         changes the outline without changing how the thing moves. */
      if (cr.hp / cr.max >= 0.33) {
        part(-0.28, 0.22, 0, 0.16, 0.055, 0.055, dark);
      }
      if (slowed) {
        part(-0.02, 0.28, 0, 0.30, 0.035, 0.21, COL.frost, 0.4);
      }
    }

    /* ---- the rime golem: the boss, every fifth wave ----
       Built to be read as mass before it is read as a creature: no neck, a
       head far too small for the shoulders, and arms hung past the hips. The
       shoulders are the widest thing on the board, which is the whole trick -
       at a glance you are told "this is the wave you are about to lose to"
       without having to find the health bar.

       The core is the only lit part, and it carries the warm boss colour the
       old cube used. That is on purpose: the boss tint had to survive being
       moved onto a cold body, so it moved onto a light instead of a surface. */
    function drawGolem(cr, px, pz, t, base) {
      var face = creepFacing(cr);
      var slowed = cr.slowMul < 1;
      var sp = slowed ? 0.4 : 1;
      var st = t * 3 * sp + (cr.seed || 0);
      var rise = Math.abs(Math.sin(st)) * 0.025 * sp;

      var body = slowed ? mixCol(COL.golem, COL.frost, 0.35) : COL.golem;
      var dark = slowed ? mixCol(COL.golemDark, COL.frost, 0.3) : COL.golemDark;

      function part(f, u, s, lf, lu, ls, col, glow) {
        modelPart(px, base, pz, face, f, u + rise, s, lf, lu, ls, col, glow);
      }

      /* Legs stay on the floor like the penguin's, and for the same reason. */
      for (var i = -1; i <= 1; i += 2) {
        var lift = Math.max(0, Math.sin(st + (i < 0 ? 0 : Math.PI))) * 0.05 * sp;
        modelPart(px, base, pz, face, 0, lift, i * 0.13, 0.17, 0.22, 0.17, dark);
      }

      part(0, 0.20, 0, 0.26, 0.13, 0.36, dark);            /* hips      */
      part(0, 0.31, 0, 0.28, 0.26, 0.42, body);            /* torso     */
      part(0, 0.55, 0, 0.30, 0.15, 0.56, body);            /* shoulders */
      part(0.02, 0.70, 0, 0.17, 0.16, 0.19, body);         /* head      */
      part(0.10, 0.76, -0.052, 0.03, 0.035, 0.03, COL.boss, 1);
      part(0.10, 0.76, 0.052, 0.03, 0.035, 0.03, COL.boss, 1);

      /* The core sits proud of the chest so it still shows when the camera is
         behind the shoulders, and pulses on the step rather than on a clock of
         its own - a boss that breathes in time with its own walk. */
      part(0.135, 0.38, 0, 0.09, 0.15, 0.17, COL.boss, 1);

      /* Arms swing against the legs. A golem down to one is the clearest
         damage read on the board, and it costs two boxes to say it. */
      var hurt = cr.hp / cr.max < 0.33;
      for (i = -1; i <= 1; i += 2) {
        if (hurt && i < 0) continue;
        var sw = -Math.cos(st + (i < 0 ? 0 : Math.PI)) * 0.045 * sp;
        part(sw, 0.26, i * 0.31, 0.17, 0.32, 0.17, dark);
        part(sw, 0.16, i * 0.31, 0.21, 0.13, 0.21, body);
      }

      /* Rime forms as a pad on each shoulder rather than one slab across them.
         A slab spanning the full width sits exactly where the head starts and
         reads as a tray being carried, which is a good way to lose the one
         proportion - tiny head, huge shoulders - the whole model is built on. */
      if (slowed) {
        part(0, 0.67, -0.20, 0.24, 0.05, 0.17, COL.frost, 0.4);
        part(0, 0.67, 0.20, 0.24, 0.05, 0.17, COL.frost, 0.4);
        part(-0.03, 0.53, 0, 0.24, 0.04, 0.40, COL.frost, 0.4);
      }
    }

    /* ---------------- tower models ----------------
       The other half of the "cubes into things" work the creeps started. A
       tower never moves and never faces, so unlike a creep there is no facing
       to solve - every box goes straight to world space with the tile centre
       as its origin. What is left is pure silhouette, and the flat cabinet
       already fixed each tower's: RIME a low broad wall you own by the dozen,
       SHARD a narrow spire tipped with a crystal, BLIZZARD a squat drum under a
       turning ring, NOVA an orb riding a pedestal. Level shows in the shape - a
       taller crystal, more rime, a bigger orb - and a shot whitens the firing
       part rather than the whole block, the same rule the creeps' rime follows.

       There is no per-instance rotation here either, which the BLIZZARD needs
       and cannot have: a box cannot spin. So its ring is READ as turning from
       shard boxes orbiting the drum on a circle - positions are free, only the
       box's own orientation is not - which at phone size is the same picture. */
    var TBASE = 0.16;                 /* top of the plinth: where a body starts */
    function tbox(px, pz, dx, y, dz, wx, hy, wz, col, glow) {
      push(px + dx, y, pz + dz, wx, hy, wz, col, glow || 0);
    }

    /* RIME - the wall. It has to stay quiet, because you own eighty of them and
       the guns have to read over the top: a broad block with two rough ice caps
       whose heights the seed splits left and right, so a run of them reads as a
       craggy rampart instead of a row of identical cubes. Upgrades pile ice
       crust on the lid, the same tell the flat board uses. */
    function drawRime(tw, px, pz, s, body, f) {
      var cap = whiten(mixCol(body, COL.frost, 0.18), f * 0.6);
      tbox(px, pz, 0, TBASE, 0, s * 0.86, 0.26, s * 0.86, body);
      var lean = Math.sin(tw.seed), y = TBASE + 0.26;
      tbox(px, pz, -s * 0.22, y, 0, s * 0.40, 0.12 + Math.max(0, lean) * 0.06, s * 0.80, cap);
      tbox(px, pz,  s * 0.22, y, 0, s * 0.40, 0.12 + Math.max(0, -lean) * 0.06, s * 0.80, cap);
      if (tw.lvl > 1) {
        var crust = whiten(COL.frost, f * 0.5);
        tbox(px, pz, -s * 0.12, y + 0.12, s * 0.10, 0.18, 0.06 + (tw.lvl - 2) * 0.05, 0.16, crust, 0.35);
        if (tw.lvl > 2) tbox(px, pz, s * 0.16, y + 0.14, -s * 0.12, 0.14, 0.10, 0.13, crust, 0.35);
      }
    }

    /* SHARD - a narrow spire that steps inward and is tipped by a crystal. The
       crystal IS the tower and it grows taller each upgrade, exactly as the
       crystal point does on the flat board; it carries the only emissive on the
       piece, so a "shard" reads as lit ice rather than painted ice. */
    function drawShard(tw, px, pz, s, body, f) {
      var shaft = mixCol(body, COL.plinth, 0.25), y = TBASE;
      tbox(px, pz, 0, y, 0, s * 0.68, 0.30, s * 0.68, shaft); y += 0.30;
      tbox(px, pz, 0, y, 0, s * 0.48, 0.18, s * 0.48, shaft); y += 0.18;
      var grow = 0.14 + (tw.lvl - 1) * 0.10;
      var cc = whiten(mixCol(body, COL.hot, 0.3), f * 0.8), cg = 0.45 + f * 0.5;
      tbox(px, pz, 0, y, 0, s * 0.42, 0.08, s * 0.42, cc, cg * 0.7); y += 0.08;
      tbox(px, pz, 0, y, 0, s * 0.26, grow, s * 0.26, cc, cg);      y += grow;
      tbox(px, pz, 0, y, 0, s * 0.11, 0.09, s * 0.11, cc, cg);
    }

    /* BLIZZARD - a squat drum with a ring of ice shards turning around it. The
       turning is the signature and is faked from orbiting boxes (see above). A
       core pulses on a slow clock; a shot brightens the ring and the core. The
       ring gains a shard per level, which reads as the tower spinning up. */
    function drawBlizzard(tw, px, pz, s, body, f, t) {
      var drum = mixCol(body, COL.plinth, 0.2);
      var rim = whiten(mixCol(body, COL.frost, 0.3), f * 0.5);
      tbox(px, pz, 0, TBASE, 0, s * 0.86, 0.22, s * 0.86, drum);
      tbox(px, pz, 0, TBASE + 0.22, 0, s * 0.70, 0.14, s * 0.70, rim);
      var pulse = 0.5 + 0.3 * Math.sin(t * 3 + tw.seed);
      tbox(px, pz, 0, TBASE + 0.36, 0, s * 0.24, 0.10, s * 0.24,
           whiten(COL.frost, f), Math.min(1, pulse + f));
      var n = 4 + (tw.lvl - 1), r = s * 0.52, a = t * 1.5 + tw.seed, ry = TBASE + 0.20;
      var shard = whiten(mixCol(body, COL.frost, 0.45), f * 0.7);
      for (var k = 0; k < n; k++) {
        var ang = a + k * (TAU / n);
        tbox(px, pz, Math.cos(ang) * r, ry, Math.sin(ang) * r,
             0.12, 0.16, 0.12, shard, 0.3 + f * 0.4);
      }
    }

    /* NOVA - the premium tower, and it should look it: a tapering pedestal that
       flares into a cup, and an orb riding in the air above it with a real gap.
       The gap is the whole silhouette, the same "orb above the tower" the flat
       board draws. The orb is the brightest solid on the board, bobs on its own
       clock, grows and brightens with level, and flares white on a shot; gold
       pips ring the cup as it levels, the money-spent language the HUD uses. */
    function drawNova(tw, px, pz, s, body, f, t) {
      var stone = mixCol(body, COL.plinth, 0.35), y = TBASE;
      tbox(px, pz, 0, y, 0, s * 0.80, 0.20, s * 0.80, stone); y += 0.20;
      tbox(px, pz, 0, y, 0, s * 0.42, 0.22, s * 0.42, stone); y += 0.22;
      tbox(px, pz, 0, y, 0, s * 0.66, 0.12, s * 0.66, stone); y += 0.12;
      if (tw.lvl > 1) {
        for (var p = 0; p < tw.lvl - 1; p++) {
          tbox(px, pz, (p - (tw.lvl - 2) / 2) * 0.14, y - 0.02, s * 0.30,
               0.05, 0.06, 0.05, COL.boss, 0.8);
        }
      }
      var orbR = 0.11 + (tw.lvl - 1) * 0.02;
      var oy = y + 0.10 + orbR + Math.sin(t * 2 + tw.seed) * 0.03;   /* clear gap */
      var oc = whiten(body, f * 0.85), og = Math.min(1, 0.8 + f * 0.2);
      tbox(px, pz, 0, oy - orbR, 0, orbR * 2, orbR * 2, orbR * 2, oc, og);
      tbox(px, pz, 0, oy - orbR * 0.6, 0, orbR * 2.5, orbR * 1.2, orbR * 2.5, oc, og);
    }

    /* The plinth is common to all four - the grounding block both renderers use
       so a tall spire never looks balanced on a point - then the body dispatches
       on kind. `t` drives the two animated towers; the other two ignore it. */
    function drawTower(tw, ox, oz, t) {
      var px = tw.x + ox, pz = tw.y + oz, s = tw.def.s;
      var f = tw.flash > 0 ? Math.min(1, tw.flash / 0.14) : 0;
      var body = towerColour(tw.def.c);
      push(px, 0, pz, s * 0.98, 0.16, s * 0.98, COL.plinth);
      switch (tw.def.k) {
        case "shard":    drawShard(tw, px, pz, s, body, f); break;
        case "blizzard": drawBlizzard(tw, px, pz, s, body, f, t); break;
        case "nova":     drawNova(tw, px, pz, s, body, f, t); break;
        default:         drawRime(tw, px, pz, s, body, f); break;
      }
    }

    /* =================================================================
       emitSolids / emitFx : one board's worth of instances into the shared
       buffers, shifted by (ox, oz) tiles in the world. The primary board is
       emitted at the origin; a rival board, if the game hands one over, is
       emitted again offset to the side. Everything a board owns - its floor,
       maze, creeps and effects - flows through these, so a second board costs
       a second call rather than a second renderer. `primary` gates the things
       only the player's board has: the build ghost, the selection collar and
       the range preview all belong to the hand holding the mouse, not to the
       AI's board across the field.
       ================================================================= */
    function emitSolids(W, ox, oz, primary, t) {
      var route = W.getRoute() || [];
      var onRoute = {};
      var i;
      for (i = 0; i < route.length; i++) onRoute[route[i]] = i;
      var head = route.length ? (t * 9) % (route.length + 22) : -1;

      var x, y, c;
      for (y = 0; y < ROWS; y++) {
        for (x = 0; x < COLS; x++) {
          c = y * COLS + x;
          if (W.isRock(x, y)) {
            var rh = 1.0 + ((x * 7 + y * 13) % 5) * 0.06;
            push(x + ox, 0, y + oz, 0.98, rh, 0.98, COL.rock);
            continue;
          }
          var ri = onRoute[c];
          if (ri === undefined) {
            push(x + ox, 0, y + oz, 0.96, 0.06, 0.96, ((x + y) & 1) ? COL.floorA : COL.floorB, 0);
          } else {
            var d = head - ri, glow = (d >= 0 && d < 9) ? (1 - d / 9) : 0;
            var col = [
              COL.road[0] + (COL.roadHot[0] - COL.road[0]) * glow,
              COL.road[1] + (COL.roadHot[1] - COL.road[1]) * glow,
              COL.road[2] + (COL.roadHot[2] - COL.road[2]) * glow
            ];
            push(x + ox, 0, y + oz, 0.96, 0.085 + glow * 0.05, 0.96, col, 0.7 + glow * 0.3);
          }
        }
      }

      var built = W.getBuilt();
      for (i = 0; i < built.length; i++) {
        if (built[i]) drawTower(built[i], ox, oz, t);
      }

      var creeps = W.getCreeps();
      for (i = 0; i < creeps.length; i++) {
        var cr = creeps[i];
        if (cr.gone) continue;
        var p = W.creepPos(cr);
        if (cr.boss) drawGolem(cr, p.x + ox, p.y + oz, t, 0.10);
        else if (cr.sent) drawWolf(cr, p.x + ox, p.y + oz, t, 0.10);
        else drawPenguin(cr, p.x + ox, p.y + oz, t, 0.10);
      }

      if (!primary) return;
      var st = W.getUI();
      if (st.ghost >= 0) {
        var gx = st.ghost % COLS, gy = (st.ghost / COLS) | 0;
        push(gx + ox, 0.06, gy + oz, 0.9, 0.5, 0.9, COL.ghost, 0.65);
      }
      if (st.sel) {
        push(st.sel.x + ox, 0, st.sel.y + oz, 1.06, 0.05, 1.06, COL.sel, 0.9);
      }
    }

    function emitFx(W, ox, oz, primary, t) {
      var i;
      var beams = W.getBeams();
      for (i = 0; i < beams.length; i++) {
        var b = beams[i];
        var ba = Math.max(0, Math.min(1, b.t / 0.14));
        var mt = W.towerAt(b.x1, b.y1);
        var my = mt ? 0.16 + towerHeight(mt) : 0.55;
        var beamCol = towerColour(b.c);
        var bw = b.w * 0.055;
        fxSeg(b.x1 + ox, my, b.y1 + oz, b.x2 + ox, CREEP_Y, b.y2 + oz, bw * 3.4, beamCol, ba * 0.45);
        fxSeg(b.x1 + ox, my, b.y1 + oz, b.x2 + ox, CREEP_Y, b.y2 + oz, bw, COL.hot, ba * 0.95);
        fxPoint(b.x1 + ox, my, b.y1 + oz, 0.30 + bw * 2.5, beamCol, ba * 0.85);
        fxPoint(b.x2 + ox, CREEP_Y, b.y2 + oz, 0.26, COL.hot, ba * 0.7);
      }

      var puffs = W.getPuffs();
      for (i = 0; i < puffs.length; i++) {
        var pf = puffs[i];
        if (pf.splash) {
          var sa = Math.max(0, pf.t / 0.3);
          fxRing(pf.x + ox, pf.y + oz, 0.14, pf.splash * (1.35 - sa * 0.55), 0.075, COL.frost, sa * 0.85);
          fxPoint(pf.x + ox, 0.22, pf.y + oz, 0.9 * sa, COL.frost, sa * sa * 0.5);
        } else {
          var ka = Math.max(0, pf.t / 0.35), age = 1 - ka;
          var boss = !!pf.boss;
          var kc = boss ? COL.boss : COL.hot;
          var seed = (Math.sin(pf.x * 12.9898 + pf.y * 78.233) * 43758.5453) % 1;
          var n = boss ? 9 : 6;
          for (var k = 0; k < n; k++) {
            var ang = seed * TAU + k * (TAU / n);
            var reach = boss ? 1.05 : 0.65;
            var d0 = age * reach, d1 = d0 + 0.22;
            var arc = Math.sin(Math.min(1, age) * Math.PI) *
                      (0.30 + (k % 3) * 0.14) * (boss ? 1.5 : 1);
            fxSeg(pf.x + ox + Math.cos(ang) * d0, CREEP_Y + arc, pf.y + oz + Math.sin(ang) * d0,
                  pf.x + ox + Math.cos(ang) * d1, CREEP_Y + arc * 1.1, pf.y + oz + Math.sin(ang) * d1,
                  boss ? 0.075 : 0.05, kc, ka * 0.95);
          }
          fxPoint(pf.x + ox, CREEP_Y, pf.y + oz, (boss ? 1.3 : 0.8) * ka, kc, ka * ka);
        }
      }

      if (primary) {
        var st = W.getUI();
        if (st.range) {
          fxRing(st.range.x + ox, st.range.y + oz, 0.11, st.range.r,
                 0.055, towerColour(st.range.c), 0.6);
        }
      }

      var gate = W.gate, drain = W.drain;
      if (gate) {
        fxRing(gate.x + ox, gate.y + oz, 0.10, 0.60 + Math.sin(t * 2.2) * 0.07,
               0.065, COL.sent, 0.55);
      }
      if (drain) {
        fxRing(drain.x + ox, drain.y + oz, 0.10, 0.60 - Math.sin(t * 2.2) * 0.07,
               0.075, COL.boss, 0.7);
      }
    }

    function draw(t) {
      var w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.008, 0.047, 0.078, 1);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      updateCamera(w, h);
      nInst = 0;

      /* The rival's board, if a game is running: the same accessor bundle as
         `world`, to be drawn offset to the side. Null between games and in any
         embedding that never sets getRival, which collapses everything below
         back to a single board at the origin - the original behaviour, byte
         for byte. */
      var rival = world.getRival ? world.getRival() : null;

      /* Room for both boards and their creeps' boxes, with headroom. reserve()
         only ever grows, and only here before the first push of the frame, so
         a steady-state frame allocates nothing. */
      reserve(COLS * ROWS * (rival ? 2 : 1) + 8192);

      emitSolids(world, 0, 0, true, t);
      if (rival) emitSolids(rival, rival.offset[0], rival.offset[1], false, t);

      /* ---- effects ----
         Emitted here, drawn in the second pass below. Everything is read from
         the same beam and puff lists the boards paint, so a shot that happened
         is a shot the view shows - on whichever board fired it. */
      nFx = 0;
      emitFx(world, 0, 0, true, t);
      if (rival) emitFx(rival, rival.offset[0], rival.offset[1], false, t);

      /* Snow. Last only for reading order - an additive pass that does not
         write depth has no painter's order to get wrong, which is most of why
         effects are worth separating from the board in the first place. It
         follows the camera, not a board, so it is emitted once for the whole
         scene however many boards are in it. */
      var span = Math.max(9, cam.dist * 0.95), ceil = span * 0.6;
      /* Sized off the view distance so a flake holds its size on screen rather
         than dissolving as you pull back. */
      var flakeS = cam.dist * 0.0032;
      for (var i = 0; i < FLAKES.length; i++) {
        var f = FLAKES[i];
        /* Driven by the clock rather than by dt, so a paused cabinet holds its
           snow still and a resumed one does not teleport it. */
        var fy = ceil - ((f.y * ceil + t * f.v * 2.4) % ceil);
        fxPoint(cam.tx + (f.x - 0.5) * span + Math.sin(t * 0.5 + f.drift) * 0.4,
                fy,
                cam.tz + (f.z - 0.5) * span,
                f.r * flakeS, COL.hot, 0.10 + f.r * 0.10);
      }

      /* One upload, one draw call - the whole board. */
      gl.useProgram(prog);
      onlyAttribs([A.pos, A.norm, A.off, A.scale, A.color, A.glow]);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufInst);
      gl.bufferData(gl.ARRAY_BUFFER, inst.subarray(0, nInst * STRIDE), gl.DYNAMIC_DRAW);
      var S = 4 * STRIDE;
      gl.enableVertexAttribArray(A.off);
      gl.vertexAttribPointer(A.off, 3, gl.FLOAT, false, S, 0);
      ext.vertexAttribDivisorANGLE(A.off, 1);
      gl.enableVertexAttribArray(A.scale);
      gl.vertexAttribPointer(A.scale, 3, gl.FLOAT, false, S, 12);
      ext.vertexAttribDivisorANGLE(A.scale, 1);
      gl.enableVertexAttribArray(A.color);
      gl.vertexAttribPointer(A.color, 3, gl.FLOAT, false, S, 24);
      ext.vertexAttribDivisorANGLE(A.color, 1);
      gl.enableVertexAttribArray(A.glow);
      gl.vertexAttribPointer(A.glow, 1, gl.FLOAT, false, S, 36);
      ext.vertexAttribDivisorANGLE(A.glow, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, bufPos);
      gl.enableVertexAttribArray(A.pos);
      gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
      ext.vertexAttribDivisorANGLE(A.pos, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufNorm);
      gl.enableVertexAttribArray(A.norm);
      gl.vertexAttribPointer(A.norm, 3, gl.FLOAT, false, 0, 0);
      ext.vertexAttribDivisorANGLE(A.norm, 0);

      gl.uniformMatrix4fv(U.viewProj, false, viewProj);
      gl.uniform3f(U.light, 0.48, 0.78, 0.40);
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, cube.count, nInst);

      /* ---- the effects pass ----
         Additive and depth-read-only. Reading depth is what keeps a bolt fired
         on the far side of the maze behind the maze; not WRITING it is what
         lets the flash, the bolt and the embers of the same shot all show
         instead of the nearest one blanking the rest. Culling is off because a
         camera-facing quad flips its winding as the camera swings past it. */
      if (nFx) {
        gl.useProgram(fxProg);
        onlyAttribs([FA.quad, FA.a, FA.b, FA.color, FA.size, FA.alpha]);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        gl.bindBuffer(gl.ARRAY_BUFFER, bufFx);
        gl.bufferData(gl.ARRAY_BUFFER, fxInst.subarray(0, nFx * FX_STRIDE), gl.DYNAMIC_DRAW);
        var FS = 4 * FX_STRIDE;
        gl.enableVertexAttribArray(FA.a);
        gl.vertexAttribPointer(FA.a, 3, gl.FLOAT, false, FS, 0);
        ext.vertexAttribDivisorANGLE(FA.a, 1);
        gl.enableVertexAttribArray(FA.b);
        gl.vertexAttribPointer(FA.b, 3, gl.FLOAT, false, FS, 12);
        ext.vertexAttribDivisorANGLE(FA.b, 1);
        gl.enableVertexAttribArray(FA.color);
        gl.vertexAttribPointer(FA.color, 3, gl.FLOAT, false, FS, 24);
        ext.vertexAttribDivisorANGLE(FA.color, 1);
        gl.enableVertexAttribArray(FA.size);
        gl.vertexAttribPointer(FA.size, 1, gl.FLOAT, false, FS, 36);
        ext.vertexAttribDivisorANGLE(FA.size, 1);
        gl.enableVertexAttribArray(FA.alpha);
        gl.vertexAttribPointer(FA.alpha, 1, gl.FLOAT, false, FS, 40);
        ext.vertexAttribDivisorANGLE(FA.alpha, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, bufQuad);
        gl.enableVertexAttribArray(FA.quad);
        gl.vertexAttribPointer(FA.quad, 2, gl.FLOAT, false, 0, 0);
        ext.vertexAttribDivisorANGLE(FA.quad, 0);

        gl.uniformMatrix4fv(FU.viewProj, false, viewProj);
        gl.uniform3f(FU.eye, eye[0], eye[1], eye[2]);
        /* The camera's own axes, read straight out of the view matrix's
           rotation rows - the shader needs them to face a sprite at the
           viewer and to break the tie on a beam pointing down the eye ray. */
        gl.uniform3f(FU.camRight, view[0], view[4], view[8]);
        gl.uniform3f(FU.camUp, view[1], view[5], view[9]);
        ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, nFx);

        gl.disable(gl.BLEND);
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
      }
    }

    return {
      gl: gl,
      camera: camera,
      draw: draw,
      pick: pick,
      groundAt: groundAt,
      instanceCount: function () { return nInst; },
      effectCount: function () { return nFx; },
      /* Context loss is a real mobile behaviour, not a hypothetical: the
         system reclaims GL contexts on backgrounding. The caller watches for
         this and falls back to the 2D cabinet rather than showing a dead
         canvas. */
      lost: function () { return gl.isContextLost(); }
    };
  }

  global.MaulGL = { create: create };
})(window);
