/* =======================================================================
   guest-sprite.js  —  the Frost Lounge guest sprite engine, as one module

   Single source of truth for how a guest is drawn. The lounge (lounge.html)
   and the homepage guestbook (js/main.js) both build guests from the SAME
   grids here, so a new wardrobe part is authored once and shows up in both
   places. Exposed as window.GuestSprite:

     makeLook(o)            -> a full, sanitised look object (fills defaults)
     makeSpriteSet(look)    -> { SE|SW|NW|NE: [frame0..4 <canvas>] }
     renderLook(look, opts) -> a fresh <canvas> of one static pose, scaled
     SPR_W, SPR_H           -> native sprite pixel dimensions

   A "look" is: hairColor, coatColor, pantsColor, skinColor, hatColor (hex);
   hat (none|beanie|cap), hair (short|long|buzz), outfit (coat|hoodie|tee),
   glasses (bool).

   This file carries its own copy of the colour helpers + the sprite-relevant
   slice of the lounge palette so it has no dependencies. The room's own HEX
   (checkerboard, bubbles, etc.) stays in lounge.html.
   ======================================================================= */
(function () {
  "use strict";

  var HEX = {
    O: "#05131f", deep2: "#0a2740", mid: "#0e4a6e", bright: "#38e6ff",
    light: "#b8ecff", f3: "#6bb8dd", f4: "#2b6f96", gold: "#ffd68a",
    skin: "#d9a06b", mouth: "#8a5a3a"
  };

  function rgb(hex) {
    return [parseInt(hex.slice(1, 3), 16),
            parseInt(hex.slice(3, 5), 16),
            parseInt(hex.slice(5, 7), 16), 255];
  }
  function shade(c, f) {
    function ch(v) {
      return f <= 1 ? Math.max(0, Math.min(255, (v * f) | 0))
                    : Math.max(0, Math.min(255, (v + (255 - v) * (f - 1)) | 0));
    }
    return [ch(c[0]), ch(c[1]), ch(c[2]), c[3]];
  }

  var CLEAR = [0, 0, 0, 0];

  /* ================= authored sprite grids =================
     Same grids as the generator: direction comes from asymmetry (hair banks
     up on the trailing side), so mirroring reads as a real turn. */
  var HEAD_F = [
    "......OOOOOOOO......",
    "....OOHHHHHHHHOO....",
    "...OHHHHHHHHHHHHO...",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHFFFFFFFFFFHO..",
    "..OHHHFFFFFFFFFFFO..",
    "..OHHFFFEEFFFFEEFO..",
    "..OHHFFFEEFFFFEEFO..",
    "..OHHFFFFFFFFFFFFO..",
    "..OHHFFFFFMMMMFFFO..",
    "..OHHFFFFFFFFFFFFO..",
    "...OHFFFFFFFFFFFO...",
    "....OOOOOOOOOOOO...."
  ];
  /* Back of the head deliberately has NO strand texture: at 20px the strands
     read as eyes and a snout, which looked like a face on the wrong side. */
  var HEAD_B = [
    "......OOOOOOOO......",
    "....OOHHHHHHHHOO....",
    "...OHGGGGGGGGGGHO...",
    "..OHHGGGGGGGGGGHHO..",
    "..OHHHGGGGGGGGHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHNNNNNNNNHHHO..",
    "..OHHNNNNNNNNNNHHO..",
    "...OHHNNNNNNNNHHO...",
    "....OOOOOOOOOOOO...."
  ];
  var TORSO_F = [
    "........OSSO........",
    "....OOOJJJJJJOOO....",
    "...OAAOJJJJJJOAAO...",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OSSSOJJJJJJOSSSO..",
    "...OOOOJJJJJJOOOO...",
    ".....OJJJJJJJJO.....",
    ".....OJJJJJJJJO.....",
    ".....OJJJJJJJJO....."
  ];
  var TORSO_B = TORSO_F.slice();
  TORSO_B[0] = "........OKKO........";   /* collar, not neck skin */

  var LEGS_STAND = [
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPOOPPPO.....",
    ".....OPPO..OPPO.....",
    ".....OPPO..OPPO.....",
    ".....OPPO..OPPO.....",
    ".....OPPO..OPPO.....",
    ".....OBBO..OBBO.....",
    ".....OBBO..OBBO.....",
    ".....OOOO..OOOO....."
  ];
  var LEGS_A = [
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPOOPPPO.....",
    "....OpppO..OPPPO....",
    "....OpppO..OPPPO....",
    "...OpppO....OPPPO...",
    "...OpppO....OPPPO...",
    "...OppO......OPPO...",
    "...ObbO......OBBO...",
    "..ObbbO......OBBBO..",
    "..OOOOO......OOOOO.."
  ];
  var LEGS_B = [
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPOOPPPO.....",
    "....OPPPO..OpppO....",
    "....OPPPO..OpppO....",
    "...OPPPO....OpppO...",
    "...OPPPO....OpppO...",
    "...OPPO......OppO...",
    "...OBBO......ObbO...",
    "..OBBBO......ObbbO..",
    "..OOOOO......OOOOO.."
  ];
  var LEGS_PASS_A = [
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPOOPPPO.....",
    ".....OppO..OPPO.....",
    ".....OppO..OPPO.....",
    ".....OppO..OPPO.....",
    ".....OppO..OPPO.....",
    ".....ObbO..OBBO.....",
    ".....ObbO..OBBO.....",
    ".....OOOO..OOOO....."
  ];
  var LEGS_PASS_B = [
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPPPPPPO.....",
    ".....OPPPOOPPPO.....",
    ".....OPPO..OppO.....",
    ".....OPPO..OppO.....",
    ".....OPPO..OppO.....",
    ".....OPPO..OppO.....",
    ".....OBBO..ObbO.....",
    ".....OBBO..ObbO.....",
    ".....OOOO..OOOO....."
  ];

  /* ================= wardrobe part overlays & variants =================
     Real customisation composes layers over the base figure instead of only
     recolouring it. A hat or glasses is a grid the same shape as the head; a
     "." means "leave the pixel underneath alone", so an overlay only paints
     where the part actually is, and is drawn OVER the head after it is laid
     down. Hair and outfit instead swap the base head/torso grid outright.
     Direction still comes from asymmetry + mirroring, so a cap's bill points
     the way the guest faces. New letters: T/t hat + fold, u brim, L/l glasses
     frame + lens. */

  /* --- hats: sit on the crown, front & back differ only in the bill --- */
  var BEANIE_F = [
    "....................",
    "......TTTTTTTT......",
    "....TTTTTTTTTTTT....",
    "...TTTTTTTTTTTTTT...",
    "...tttttttttttttt...",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "...................."
  ];
  var BEANIE_B = BEANIE_F;                 /* knit cap reads the same from behind */
  /* The cap's peak juts a pixel past the silhouette on the front sprite and is
     absent on the back - mirroring then points it SE vs SW. */
  var CAP_F = [
    "....................",
    "......TTTTTTTT......",
    "....TTTTTTTTTTTT....",
    "...TTTTTTTTTTTTTT...",
    "...uuuuuuuuuuuuuuuu.",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "...................."
  ];
  var CAP_B = [
    "....................",
    "......TTTTTTTT......",
    "....TTTTTTTTTTTT....",
    "...TTTTTTTTTTTTTT...",
    "...tttttttttttttt...",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "...................."
  ];
  var HATS = {
    none:   null,
    beanie: { f: BEANIE_F, b: BEANIE_B },
    cap:    { f: CAP_F,    b: CAP_B }
  };

  /* --- glasses: front only; on the back sprites the face isn't drawn at all.
     Two dark lenses over the eye rows (7-8) with a bridge between them. --- */
  var GLASSES_F = [
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    "....................",
    ".......LLLLLLLLLL...",
    ".......LllLLLLllL...",
    ".......LllLLLLllL...",
    "....................",
    "....................",
    "....................",
    "....................",
    "...................."
  ];

  /* --- hair variants: the base head IS the hair, so a style swaps the whole
     grid. "short" is the authored default; "long" drops the sidebangs a row
     lower; "buzz" trims them to a thin cap so more face shows. --- */
  var HEAD_F_LONG = [
    "......OOOOOOOO......",
    "....OOHHHHHHHHOO....",
    "...OHHHHHHHHHHHHO...",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHFFFFFFFFFFHO..",
    "..OHHHFFFFFFFFFFFO..",
    "..OHHFFFEEFFFFEEFO..",
    "..OHHFFFEEFFFFEEFO..",
    "..OHHFFFFFFFFFFFFO..",
    "..OHHFFFFFMMMMFFHO..",
    "..OHHFFFFFFFFFFHHO..",
    "..OHHFFFFFFFFFFHO...",
    "...OHOOOOOOOOOHO...."
  ];
  var HEAD_B_LONG = [
    "......OOOOOOOO......",
    "....OOHHHHHHHHOO....",
    "...OHGGGGGGGGGGHO...",
    "..OHHGGGGGGGGGGHHO..",
    "..OHHHGGGGGGGGHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHNNNNNNNNHHHO..",
    "..OHHNNNNNNNNNNHHO..",
    "..OHHNNNNNNNNNNHHO..",
    "..OHHNNNNNNNNNNHHO..",
    "..OHHNNNNNNNNNNHHO..",
    "...OHOOOOOOOOOHO...."
  ];
  var HEAD_F_BUZZ = [
    "......OOOOOOOO......",
    "....OOHHHHHHHHOO....",
    "...OHHHHHHHHHHHHO...",
    "..OHHFFFFFFFFFFHHO..",
    "..OHFFFFFFFFFFFFHO..",
    "..OHFFFFFFFFFFFFFO..",
    "..OHFFFFFFFFFFFFFO..",
    "..OFFFFEEFFFFEEFFO..",
    "..OFFFFEEFFFFEEFFO..",
    "..OFFFFFFFFFFFFFFO..",
    "..OFFFFFFMMMMFFFFO..",
    "..OFFFFFFFFFFFFFFO..",
    "...OFFFFFFFFFFFO...",
    "....OOOOOOOOOOOO...."
  ];
  var HEAD_B_BUZZ = [
    "......OOOOOOOO......",
    "....OOHHHHHHHHOO....",
    "...OHHHHHHHHHHHHO...",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "..OHHHHHHHHHHHHHHO..",
    "...OHHHHHHHHHHHO...",
    "....OOOOOOOOOOOO...."
  ];
  var HEADS = {
    short: { f: HEAD_F,      b: HEAD_B },
    long:  { f: HEAD_F_LONG, b: HEAD_B_LONG },
    buzz:  { f: HEAD_F_BUZZ, b: HEAD_B_BUZZ }
  };

  /* --- outfit variants: swap the torso. "coat" is the authored default (open
     jacket, J body, A arms). "tee" bares the forearms to skin (lowercase a is
     the skin-shaded sleeve edge). "hoodie" pulls a hood up behind the neck. --- */
  var TORSO_F_TEE = [
    "........OSSO........",
    "....OOOJJJJJJOOO....",
    "...OAAOJJJJJJOAAO...",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OaaaOJJJJJJOaaaO..",
    "..OaaaOJJJJJJOaaaO..",
    "..OaaaOJJJJJJOaaaO..",
    "..OSSSOJJJJJJOSSSO..",
    "...OOOOJJJJJJOOOO...",
    ".....OJJJJJJJJO.....",
    ".....OJJJJJJJJO.....",
    ".....OJJJJJJJJO....."
  ];
  var TORSO_B_TEE = TORSO_F_TEE.slice();
  TORSO_B_TEE[0] = "........OKKO........";
  var TORSO_F_HOODIE = [
    ".......OKKKKO.......",
    "....OOKKKKKKKKOO....",
    "...OAAKJJJJJJKAAO...",
    "..OAAAKJJJJJJKAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OAAAOJJJJJJOAAAO..",
    "..OKKKOJJJJJJOKKKO..",
    "...OOOOJKKKKJOOOO...",
    ".....OJKKKKKKJO.....",
    ".....OJJJJJJJJO.....",
    ".....OJJJJJJJJO....."
  ];
  var TORSO_B_HOODIE = TORSO_F_HOODIE.slice();
  TORSO_B_HOODIE[0] = ".......OKKKKO.......";
  var TORSOS = {
    coat:   { f: TORSO_F,        b: TORSO_B },
    tee:    { f: TORSO_F_TEE,    b: TORSO_B_TEE },
    hoodie: { f: TORSO_F_HOODIE, b: TORSO_B_HOODIE }
  };

  var LEG_SEQ = [LEGS_STAND, LEGS_A, LEGS_PASS_A, LEGS_B, LEGS_PASS_B];
  var BOB_SEQ = [0, 1, 0, 1, 0];
  var ARM_SEQ = [0, 1, 0, -1, 0];

  var SPR_W = 20;
  var HEAD_H = HEAD_F.length, TORSO_H = TORSO_F.length;
  var SPR_H = HEAD_H + TORSO_H + LEGS_STAND.length + 1;

  /* The default guest look; every field a wardrobe slot can override. Kept as
     one object so a saved guest round-trips through localStorage in one blob
     and NPCs are dressed with the same call the player uses. */
  var HATS_DEFAULT = "none", HAIR_DEFAULT = "short", OUTFIT_DEFAULT = "coat";
  function makeLook(o) {
    o = o || {};
    return {
      hairColor:  o.hairColor  || HEX.f3,
      coatColor:  o.coatColor  || HEX.bright,
      pantsColor: o.pantsColor || HEX.f4,
      skinColor:  o.skinColor  || HEX.skin,
      hatColor:   o.hatColor   || HEX.light,
      hat:    HATS[o.hat]      ? o.hat    : HATS_DEFAULT,
      hair:   HEADS[o.hair]    ? o.hair   : HAIR_DEFAULT,
      outfit: TORSOS[o.outfit] ? o.outfit : OUTFIT_DEFAULT,
      glasses: !!o.glasses
    };
  }

  function palette(look) {
    var H = rgb(look.hairColor), J = rgb(look.coatColor),
        P = rgb(look.pantsColor), S = rgb(look.skinColor),
        T = rgb(look.hatColor);
    return {
      O: rgb(HEX.O), H: H, G: shade(H, 1.3), N: shade(H, 0.7),
      F: S, S: shade(S, 0.82), a: shade(S, 0.9), E: rgb(HEX.O), M: rgb(HEX.mouth),
      J: J, K: shade(J, 0.62), A: shade(J, 0.74),
      P: P, p: shade(P, 0.68),
      B: rgb(HEX.light), b: shade(rgb(HEX.light), 0.66),
      T: T, t: shade(T, 0.78), u: shade(T, 0.55),
      L: rgb(HEX.O), l: rgb(HEX.deep2),
      ".": CLEAR
    };
  }

  /* Rasterise one sprite into its own canvas, once, then reuse it. The figure
     is drawn back-to-front in layers: base head, then any hat and glasses over
     it, then the torso and legs. Hair and outfit have already been chosen by
     swapping which head/torso grid we read. */
  function buildSprite(look, pal, back, frame, mirror) {
    var cv = document.createElement("canvas");
    cv.width = SPR_W; cv.height = SPR_H;
    var ctx = cv.getContext("2d");
    var im = ctx.createImageData(SPR_W, SPR_H);
    var head = HEADS[look.hair][back ? "b" : "f"];
    var torso = TORSOS[look.outfit][back ? "b" : "f"];
    var hat = HATS[look.hat] ? HATS[look.hat][back ? "b" : "f"] : null;
    var glasses = (look.glasses && !back) ? GLASSES_F : null;
    var legs = LEG_SEQ[frame], bob = BOB_SEQ[frame], arm = ARM_SEQ[frame];

    function put(x, y, ch) {
      if (ch === "." || x < 0 || x >= SPR_W || y < 0 || y >= SPR_H) return;
      var c = pal[ch];
      if (!c || !c[3]) return;
      var i = (y * SPR_W + (mirror ? SPR_W - 1 - x : x)) * 4;
      im.data[i] = c[0]; im.data[i + 1] = c[1];
      im.data[i + 2] = c[2]; im.data[i + 3] = c[3];
    }
    function overlay(grid) {
      grid.forEach(function (row, j) {
        for (var i = 0; i < row.length; i++) put(i, j + bob, row[i]);
      });
    }
    overlay(head);
    if (hat) overlay(hat);
    if (glasses) overlay(glasses);
    torso.forEach(function (row, j) {
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        var dy = (ch === "A" || ch === "S" || ch === "a")
          ? (i < SPR_W / 2 ? arm : -arm) : 0;
        put(i, HEAD_H + j + bob + dy, ch);
      }
    });
    legs.forEach(function (row, j) {
      for (var i = 0; i < row.length; i++) put(i, HEAD_H + TORSO_H + j, row[i]);
    });
    ctx.putImageData(im, 0, 0);
    return cv;
  }

  /* SE and SW face the camera; NW and NE face away. Each pair is one grid
     plus its reflection - 4 directions from 2 authored sprites. */
  var DIRS = { SE: [false, false], SW: [false, true],
               NW: [true, false],  NE: [true, true] };

  function makeSpriteSet(look) {
    var pal = palette(look), set = {};
    Object.keys(DIRS).forEach(function (d) {
      set[d] = LEG_SEQ.map(function (_, f) {
        return buildSprite(look, pal, DIRS[d][0], f, DIRS[d][1]);
      });
    });
    return set;
  }

  /* Draw one static pose to a fresh, upscaled canvas - the form the guestbook
     and any off-room caller wants (no animation loop, no room). Builds only the
     single sprite it needs, not the whole 4-direction walking set, so a book of
     hundreds of avatars stays cheap. */
  function renderLook(look, opts) {
    opts = opts || {};
    var scale = opts.scale || 1, dir = opts.dir || "SE", frame = opts.frame || 0;
    var L = makeLook(look), pal = palette(L);
    var d = DIRS[dir] || DIRS.SE;
    var spr = buildSprite(L, pal, d[0], frame, d[1]);
    var cv = document.createElement("canvas");
    cv.width = SPR_W * scale; cv.height = SPR_H * scale;
    var ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, 0, 0, SPR_W, SPR_H, 0, 0, cv.width, cv.height);
    return cv;
  }

  window.GuestSprite = {
    makeLook: makeLook,
    makeSpriteSet: makeSpriteSet,
    renderLook: renderLook,
    SPR_W: SPR_W, SPR_H: SPR_H, HEAD_H: HEAD_H, TORSO_H: TORSO_H
  };
})();
