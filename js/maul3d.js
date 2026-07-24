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
       Orbit around a target that sits on the ground plane. Yaw is free - that
       is the ask - pitch is clamped away from both the horizon and straight
       down, because a maul read from ground level is unplayable and a maul
       read from directly above is just the 2D board with extra steps. */
    /* Framing is derived from the board rather than hardcoded, so a larger map
       opens correctly framed instead of needing the constants retuned. At this
       field of view a board of N tiles subtends the view at about 1.15N. */
    var FIT = Math.max(COLS, ROWS) * 1.15;
    var cam = {
      tx: (COLS - 1) / 2, tz: (ROWS - 1) / 2,
      yaw: Math.PI * 0.25, pitch: 0.95, dist: FIT
    };
    var MIN_PITCH = 0.30, MAX_PITCH = 1.45;
    var MIN_DIST = Math.max(4, FIT * 0.22), MAX_DIST = FIT * 2.6;

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
      var e = eyePos();
      eye[0]=e[0]; eye[1]=e[1]; eye[2]=e[2];
      target[0]=cam.tx; target[1]=0; target[2]=cam.tz;
      m4perspective(proj, 0.85, w / Math.max(1, h), 0.5, 400);
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
    function clampTarget() {
      var m = 6;
      cam.tx = Math.max(-m, Math.min(COLS - 1 + m, cam.tx));
      cam.tz = Math.max(-m, Math.min(ROWS - 1 + m, cam.tz));
    }
    var camera = {
      get yaw() { return cam.yaw; },
      orbit: function (dy, dp) {
        cam.yaw += dy;
        cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, cam.pitch + dp));
      },
      zoom: function (f) {
        cam.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, cam.dist * f));
      },
      /* Absolute, for gestures. A pinch has to work from the pose the fingers
         landed on rather than accumulating deltas, or the drift between what
         the fingers say and where the camera is compounds over a long
         two-finger drag. */
      set: function (yaw, pitch, dist) {
        cam.yaw = yaw;
        cam.pitch = Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
        cam.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, dist));
      },
      pan: pan,
      /* Snap to the nearest quarter turn, for a button or a key: a maul is
         built on a square grid and the four corner views are the ones a player
         actually wants to flick between. */
      snap: function (dir) {
        var q = Math.PI / 2;
        cam.yaw = (Math.round(cam.yaw / q) + dir) * q;
      },
      reset: function () {
        cam.tx = (COLS - 1) / 2; cam.tz = (ROWS - 1) / 2;
        cam.yaw = Math.PI * 0.25; cam.pitch = 0.95; cam.dist = FIT;
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

      if (slowed) {
        part(0, 0.43, 0, 0.13, 0.035, 0.15, COL.frost, 0.4);
        part(-0.02, 0.32, 0, 0.16, 0.03, 0.20, COL.frost, 0.4);
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

      var route = world.getRoute() || [];
      var onRoute = {};
      for (var i = 0; i < route.length; i++) onRoute[route[i]] = i;
      /* The shimmer that runs gate-to-drain, carried over from the 2D board:
         how long it takes to arrive is the length of your maze, which is the
         one number a maul player reads constantly. */
      var head = route.length ? (t * 9) % (route.length + 22) : -1;

      reserve(COLS * ROWS + 2048);

      var x, y, c;
      for (y = 0; y < ROWS; y++) {
        for (x = 0; x < COLS; x++) {
          c = y * COLS + x;
          if (world.isRock(x, y)) {
            /* Uneven on purpose, keyed off the tile so it never crawls - a
               ring of identical blocks reads as a spreadsheet. */
            var rh = 1.0 + ((x * 7 + y * 13) % 5) * 0.06;
            push(x, 0, y, 0.98, rh, 0.98, COL.rock);
            continue;
          }
          var ri = onRoute[c];
          if (ri === undefined) {
            push(x, 0, y, 0.96, 0.06, 0.96, ((x + y) & 1) ? COL.floorA : COL.floorB, 0);
          } else {
            var d = head - ri, glow = (d >= 0 && d < 9) ? (1 - d / 9) : 0;
            var col = [
              COL.road[0] + (COL.roadHot[0] - COL.road[0]) * glow,
              COL.road[1] + (COL.roadHot[1] - COL.road[1]) * glow,
              COL.road[2] + (COL.roadHot[2] - COL.road[2]) * glow
            ];
            /* Emissive, and more so where the shimmer is: the road has to hold
               its brightness from every camera angle. */
            push(x, 0, y, 0.96, 0.085 + glow * 0.05, 0.96, col, 0.7 + glow * 0.3);
          }
        }
      }

      /* Towers: plinth then body, the same two-piece silhouette the 2D board
         uses so a tall spire doesn't look balanced on a point. */
      var built = world.getBuilt();
      for (i = 0; i < built.length; i++) {
        var tw = built[i];
        if (!tw) continue;
        var th = towerHeight(tw), s = tw.def.s;
        push(tw.x, 0, tw.y, s * 0.98, 0.16, s * 0.98, COL.plinth);
        var bc = towerColour(tw.def.c);
        if (tw.flash > 0) {
          var f = Math.min(1, tw.flash / 0.14);
          bc = [bc[0] + (1 - bc[0]) * f, bc[1] + (1 - bc[1]) * f, bc[2] + (1 - bc[2]) * f];
        }
        push(tw.x, 0.16, tw.y, s * 0.82, th, s * 0.82, bc);
        if (tw.lvl > 1) {
          push(tw.x, 0.16 + th, tw.y, s * 0.5, 0.10 * (tw.lvl - 1), s * 0.5, COL.sel);
        }
      }

      /* Creeps. The neutral bodies are modelled; bosses and the rival's sends
         are still the bobbing cube they always were, waiting on their own
         models, and keep their colours in the meantime so the three kinds of
         creep stay told apart while the roster is half built. */
      var creeps = world.getCreeps();
      for (i = 0; i < creeps.length; i++) {
        var cr = creeps[i];
        if (cr.gone) continue;
        var p = world.creepPos(cr);
        if (!cr.boss && !cr.sent) { drawPenguin(cr, p.x, p.y, t, 0.10); continue; }
        var size = cr.boss ? 0.52 : 0.34;
        var hop = Math.abs(Math.sin(t * 7 + (cr.seed || 0))) * (cr.boss ? 0.10 : 0.16);
        var cc = cr.sent ? COL.sent
               : (cr.slowMul < 1 ? COL.creepSlow : COL.creep);
        push(p.x, 0.10 + hop, p.y, size, size, size, cc, 0.45);
      }

      /* The ghost of what you're about to build, and the selection ring. */
      var st = world.getUI();
      if (st.ghost >= 0) {
        var gx = st.ghost % COLS, gy = (st.ghost / COLS) | 0;
        push(gx, 0.06, gy, 0.9, 0.5, 0.9, COL.ghost, 0.65);
      }
      if (st.sel) {
        /* A bright collar around the base rather than a highlight on the tower
           itself: at a low camera angle the tower's own faces can be entirely
           hidden behind the wall in front of it, but the ground it stands on
           is visible from anywhere. */
        push(st.sel.x, 0, st.sel.y, 1.06, 0.05, 1.06, COL.sel, 0.9);
      }

      /* ---- effects ----
         Emitted here, drawn in the second pass below. Everything is read from
         the same beam and puff lists the flat board paints, so a shot that
         happened is a shot both views show. */
      nFx = 0;

      /* Shots. Wide and soft under narrow and white, which is the pair of
         strokes the flat board uses and for the same reason: one stroke reads
         as wire, two read as light. */
      var beams = world.getBeams();
      for (i = 0; i < beams.length; i++) {
        var b = beams[i];
        var ba = Math.max(0, Math.min(1, b.t / 0.14));
        /* The muzzle is the top of the tower that fired, looked up rather than
           carried on the beam: a tower can be sold while its last shot is
           still in the air, and the shot should still leave from where it
           stood rather than from the floor. */
        var mt = world.towerAt(b.x1, b.y1);
        var my = mt ? 0.16 + towerHeight(mt) : 0.55;
        var beamCol = towerColour(b.c);
        /* b.w is a 2D line width in pixels; here a tile is one unit. */
        var bw = b.w * 0.055;
        fxSeg(b.x1, my, b.y1, b.x2, CREEP_Y, b.y2, bw * 3.4, beamCol, ba * 0.45);
        fxSeg(b.x1, my, b.y1, b.x2, CREEP_Y, b.y2, bw, COL.hot, ba * 0.95);
        fxPoint(b.x1, my, b.y1, 0.30 + bw * 2.5, beamCol, ba * 0.85);
        fxPoint(b.x2, CREEP_Y, b.y2, 0.26, COL.hot, ba * 0.7);
      }

      /* Hits. A splash leaves a shockwave, a kill leaves embers. */
      var puffs = world.getPuffs();
      for (i = 0; i < puffs.length; i++) {
        var pf = puffs[i];
        if (pf.splash) {
          /* Opening as it fades, at the radius the splash actually reached:
             what you see is what was hit, which is the only way to learn what
             a splash tower is worth. */
          var sa = Math.max(0, pf.t / 0.3);
          fxRing(pf.x, pf.y, 0.14, pf.splash * (1.35 - sa * 0.55),
                 0.075, COL.frost, sa * 0.85);
          fxPoint(pf.x, 0.22, pf.y, 0.9 * sa, COL.frost, sa * sa * 0.5);
        } else {
          var ka = Math.max(0, pf.t / 0.35), age = 1 - ka;
          var boss = !!pf.boss;
          var kc = boss ? COL.boss : COL.hot;
          /* Directions are hashed off the position, which is fixed for the
             puff's whole life: a burst that reseeds itself every frame is a
             burst that flickers instead of flying. */
          var seed = (Math.sin(pf.x * 12.9898 + pf.y * 78.233) * 43758.5453) % 1;
          var n = boss ? 9 : 6;
          for (var k = 0; k < n; k++) {
            var ang = seed * TAU + k * (TAU / n);
            var reach = boss ? 1.05 : 0.65;
            var d0 = age * reach, d1 = d0 + 0.22;
            /* Thrown up and out, and falling back: an arc costs one sine and
               is the difference between debris and a flat expanding ring. */
            var arc = Math.sin(Math.min(1, age) * Math.PI) *
                      (0.30 + (k % 3) * 0.14) * (boss ? 1.5 : 1);
            fxSeg(pf.x + Math.cos(ang) * d0, CREEP_Y + arc, pf.y + Math.sin(ang) * d0,
                  pf.x + Math.cos(ang) * d1, CREEP_Y + arc * 1.1, pf.y + Math.sin(ang) * d1,
                  boss ? 0.075 : 0.05, kc, ka * 0.95);
          }
          fxPoint(pf.x, CREEP_Y, pf.y, (boss ? 1.3 : 0.8) * ka, kc, ka * ka);
        }
      }

      /* Range preview. The flat board draws this as an ellipse on the floor;
         with a free camera it has to be an actual circle in the world, or it
         stops meaning "this far" the moment you turn. */
      if (st.range) {
        fxRing(st.range.x, st.range.y, 0.11, st.range.r,
               0.055, towerColour(st.range.c), 0.6);
      }

      /* Both ends of the run. The flat board pools light on these so they are
         findable without a label, and a player who has just spun the camera
         needs that more, not less. Counter-phase so they read as two things. */
      var gate = world.gate, drain = world.drain;
      if (gate) {
        fxRing(gate.x, gate.y, 0.10, 0.60 + Math.sin(t * 2.2) * 0.07,
               0.065, COL.sent, 0.55);
      }
      if (drain) {
        fxRing(drain.x, drain.y, 0.10, 0.60 - Math.sin(t * 2.2) * 0.07,
               0.075, COL.boss, 0.7);
      }

      /* Snow. Last only for reading order - an additive pass that does not
         write depth has no painter's order to get wrong, which is most of why
         effects are worth separating from the board in the first place. */
      var span = Math.max(9, cam.dist * 0.95), ceil = span * 0.6;
      /* Sized off the view distance so a flake holds its size on screen rather
         than dissolving as you pull back. */
      var flakeS = cam.dist * 0.0032;
      for (i = 0; i < FLAKES.length; i++) {
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
