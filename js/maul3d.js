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

    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error("maul3d link: " + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

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
      ghost:  hexToRGB("#38e6ff"), sel: hexToRGB("#eafcff")
    };
    var towerCol = {};
    function towerColour(hex) {
      return towerCol[hex] || (towerCol[hex] = hexToRGB(hex));
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

      /* Creeps. Small cubes that bob: the walk cycle costs one sine and is
         what stops a wave looking like it is sliding along a rail. */
      var creeps = world.getCreeps();
      for (i = 0; i < creeps.length; i++) {
        var cr = creeps[i];
        if (cr.gone) continue;
        var p = world.creepPos(cr);
        var size = cr.boss ? 0.52 : 0.34;
        var hop = Math.abs(Math.sin(t * 7 + (cr.seed || 0))) * (cr.boss ? 0.10 : 0.16);
        var cc = cr.sent ? COL.sent
               : cr.boss ? COL.boss
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

      /* One upload, one draw call - the whole board. */
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
      gl.uniform3f(U.fog, 0.03, 0.13, 0.20);
      gl.uniform1f(U.fogNear, 20);
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, cube.count, nInst);
    }

    return {
      gl: gl,
      camera: camera,
      draw: draw,
      pick: pick,
      instanceCount: function () { return nInst; },
      /* Context loss is a real mobile behaviour, not a hypothetical: the
         system reclaims GL contexts on backgrounding. The caller watches for
         this and falls back to the 2D cabinet rather than showing a dead
         canvas. */
      lost: function () { return gl.isContextLost(); }
    };
  }

  global.MaulGL = { create: create };
})(window);
