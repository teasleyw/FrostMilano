# ❄ FROST MILANO — Official Site

A self-contained static website. No build step, no dependencies to install.
Icy Y2K / late-90s GeoCities aesthetic, but responsive and readable.

```
Website/
├─ index.html      ← all the page content
├─ css/style.css   ← all the styling (colors, layout, effects)
├─ js/main.js      ← snow, video vault, visitor counter, guestbook, signup form
├─ video/          ← drop your Instagram clips here (see video/README.txt)
├─ _headers        ← browser caching rules for Cloudflare Pages
└─ README.md       ← you are here
```

## ▶ How to view it

Just double-click `index.html` — it opens in your browser. That's it.

(Or, to run it like a real server: `python -m http.server` from this folder,
then visit `http://localhost:8000`.)

## ✅ Already wired up (pulled from your Spotify)

- **Live Spotify player** in the Music section, featuring your latest EP **Lately**.
- **Release cards**: Lately, Monster, 42 Weeks, MyFurCoat — each links to the real album.
- **"Full discography" button** → your Spotify artist page.
- **Socials**: Instagram (@frost_milano) + Spotify. Only real accounts are
  listed — TikTok currently mirrors Instagram and there's no YouTube worth
  linking yet, so neither is on the site. A dead link reads worse than a
  missing one; add a badge back when there's something behind it.
- **Booking email**: frostmilano42@gmail.com.
- **Tour**: Jul 30 — Valhalla, Austin TX, w/ **Dirty Whiskey** (the "INFO" button links to your Instagram).
- **The live act**: Dirty Whiskey, blues + classic rock. Introduced in its own
  callout above the tour table, and named in the bio, marquee, and Music section
  so nobody mistakes the recorded hip-hop for the live set.
- **About photo**: pulled from your Instagram → `images/frost-milano.jpg`.

Your Spotify IDs (for future edits):
- Artist: `0SKY221pDeeTJUgkqmYWiM`

**Track** IDs — the site links songs, not releases, on purpose:

| Track | Track ID |
|---|---|
| Lately | `6mukDcsHBhetIhoVBlOLMi` |
| Monster | `5V717i6TcXnAAMFzJzrXnk` |
| Demon | `7Dv865zUTFgDOKMgYo78iH` |
| MyFurCoat | `16bEq8UIqQZfgOBSWpNrma` |

Other tracks on the *Lately* EP, if you ever want to feature one:
MMP `2sVXc9HVwc9WD5S2PfCFOB` · Aint that life `6TFSEMl3ulR9PvbFKtvdUW` ·
Beshiono `1uhGZ5CIrhyBajRVjAF75F` · Suede `430aqna8MbB7V74TVT9BSL`

Release (album) IDs, kept only for reference: Lately EP
`0p7ccxrvwKAXG1b87CLXlG` · Monster `5qdNeLApuvRMmsv8lkjMsP` ·
MyFurCoat `6kSDr8PKWdu8udaE1cb7L3`

To feature a different song, swap the ID in the `embed/track/...` iframe src.

## ✎ What's still a placeholder

Open `index.html` in any text editor and search for these:

| Search for | What it is |
|---|---|
| `data-ig="#REPLACE"` | On each Video Vault TV. Set one to a real Instagram post URL and that TV's "POST" badge un-hides itself. |
| The `TOUR` table rows | Add more shows as you book them (one real date is in now: Jul 30, Austin) |
| The `VIDEO VAULT` TVs | Drop `clip-01.mp4`…`clip-03.mp4` into `video/`. Full how-to in `video/README.txt` |
| The `ABOUT` bio paragraphs | Now written around the MC/blues-guitarist duality and Detroit blues lineage — personalize the details when you're ready |
| `Frost Milano` | Your stage name (only if you ever rebrand) |

### The About photo
A photo from your Instagram is already installed at `images/frost-milano.jpg`
(the smiling/bandana shot). A runner-up is saved as `images/frost-milano-alt.jpg`
(the retro '70s dance shot). To switch, either rename the alt over the main file,
or change the `src` on the `<img class="about__frame" …>` in `index.html`.
To use your own instead, just drop a new file in `images/` and point `src` at it.
The frame crops square and centers on the face via `object-position` in
`css/style.css` (`.about__frame`) — tweak those percentages if a new photo sits differently.

### 📼 The Video Vault (your Instagram clips)
The Video section is a wall of CRT televisions. Each one plays a self-hosted
`.mp4` — muted and looping, starting when it scrolls into view and pausing when
it leaves, so three clips never fight for bandwidth. Tap a screen's sound button
for audio; only one TV can be unmuted at a time.

Self-hosted (rather than Instagram embeds) means no white Instagram cards
clashing with the ice theme, no third-party tracking, and no API keys — the
tradeoff is that you export a file yourself for each clip you want up.

**`video/README.txt` has the whole workflow**: how to get the original files out
of Instagram without a watermark, the exact `ffmpeg` command to shrink them for
the web, and how to add/remove/relabel TVs. A TV with no file behind it shows a
"NO SIGNAL" static screen, so the section never looks broken while you fill it in.

### Add a real music player
To embed a real Spotify player, replace a track's links with an embed, e.g.:
```html
<iframe style="border-radius:12px" width="100%" height="152" frameborder="0"
  src="https://open.spotify.com/embed/track/YOUR_TRACK_ID"></iframe>
```
(Get the code from Spotify → track → Share → Embed.)

## 🎨 Changing colors
All colors live at the top of `css/style.css` under `:root` (the `--ice-*`
variables). Change those and the whole site updates.

## 🕹 The arcade (Brick Smash)

The lounge's cabinet lives in `lounge.html`. **Every level is two waves:** smash
the wall, then the paddle becomes a ship and a squadron flies in — Breakout and
Galaga back to back, sharing one score, one life count and one set of capsules.
Clearing the wall calls the squadron in; clearing *both* moves the level counter.

Everything worth tuning is in the `---- tuning ----`, `---- power-ups ----` and
`---- the squadron half ----` blocks at the top of its script — no other file is
involved.

| Knob | Now | What it does |
|---|---|---|
| `BASE_SPEED` | `300` | Ball speed on level 1, px/sec. The single dial for "too slow / too fast". |
| `LEVEL_MULT` | `1.11` | Speed multiplier per level cleared. |
| `MAX_SPEED` | `620` | Ceiling on the ramp, hit around level 8. Remove the `Math.min` in `nextLevel` to let it climb forever. |
| `PADDLE_KEYS` | `640` | Arrow-key paddle speed. Keep it above the ball or keyboard play gets unfair. |
| `DROP_CHANCE` | `0.16` | Odds a smashed brick drops a capsule. |
| `PU` | 7 entries | The capsule table: `w` is its drop weight, `t` its duration in seconds. |
| `EN_COLS` | `7` | Squadron width. Rows go 3 → 4 from level 3 (`buildWave`). |
| `DIVE_TIME` | `2.4` | Seconds a dive run takes. Dive frequency tightens with the level in `triggerDives`. |
| `FIRE_GAP` | `0.18` | Seconds between shots. Hold the button/SPACE to auto-fire. |
| `SHIP_RATIO` | `0.45` | Ship width as a fraction of the paddle — which is why WIDE is a trade in the squadron half. |

Smash a brick or shoot an enemy and it may drop a capsule; catch it on the
paddle to fire it.

| | Capsule | In the wall | In the squadron |
|---|---|---|---|
| **W** | wide | paddle 62 → 92px, 14s | a second cannon (and a fatter target) |
| **M** | multiball | balls split in three, up to 8 | — doesn't drop |
| **S** | slow | ball ×0.7, 10s | the swarm and its bombs ×0.7 |
| **C** | catch | ball sticks to the paddle; press to serve | — doesn't drop |
| **+** | extra ball | one more life | one more life |
| **N** | narrow | paddle 62 → 40px, 10s — hazard | a smaller ship — hazard |
| **F** | speed up | ball ×1.3, 8s — hazard | the swarm ×1.3 — hazard |

Roughly three quarters of what drops helps you. Opposites cancel (catching WIDE
clears NARROW), timed effects stack seconds rather than strength, and losing a
ball, a ship, or clearing a level wipes every active effect. Effect clocks
*do* carry across the wall → squadron switch, so a WIDE earned on the last brick
arrives as a second cannon.

Scoring: bricks 10–50 by row, enemies 40–120 by rank (**doubled** while diving —
the shot that's actually hard), plus `250 + 100 × level` for clearing a squadron.

## ❄ Winter Maul (the third cabinet)

A maze tower defence in the vein of the Warcraft III "maul" maps, on the wall
between the decks and Brick Smash. Its whole script is one block in
`lounge.html`; it's drawn in the room's own isometric projection at half tile
size, so the board looks like it belongs to the lounge.

**The one rule that makes it a maul:** your towers *are* the walls. Creeps take
the shortest open route from the gate to the drain, so every tower you drop is
both a gun and a detour — and a placement that would seal the route completely
is refused (`THAT WOULD SEAL THE MAZE`). A bare board routes in 17 steps; a
tight switchback pushes the same run past 110. The lit channel on the floor is
that route, and the shimmer running down it is how long a creep now has to walk.

**The "wars" half** is the rival: a second maze you never see, racing the same
wave clock. A **send** costs gold and buys two things at once — pressure that
makes the rival leak, and income that pays you on every wave from then on. Both
sides start on 20 lives and the run ends the moment one of them empties, so
"build more maze or buy more economy" is a real question every wave. The rival
also sends creeps back; they arrive in your maze wearing a hot rim.

Everything worth tuning is in the `---- towers ----`, `---- sends ----` and
`---- tuning ----` blocks at the top of its script.

| Knob | Now | What it does |
|---|---|---|
| `START_GOLD` / `START_LIVES` | `90` / `20` | The opening hand. Lives are also the loss condition. |
| `WAVE_EVERY` | `24` | Seconds between waves. The clock does **not** wait for a wave to die, which is what caps a run at 6–8 minutes. |
| `FIRST_WAVE` | `22` | The opening build phase, before wave 1. |
| `WAVE_GOLD` | `20` | Base payout per wave, before income. |
| `CALL_BONUS` | `2` | Gold per whole second skipped by calling a wave early. |
| `waveSpec()` | `1.27^n` | Creep HP growth. The single dial for "too easy / too hard". |
| `BOSS_EVERY` | `5` | Every fifth wave is three big ones; a leaked boss costs 3 lives. |
| `resolveRival()` | `(n-6)*0.42` | How fast the rival's own maze cracks. Left alone it dies around wave 16 — tune this against how long *you* can hold. |
| `TOWERS` | 4 entries | Cost, damage, rate, range — plus `s`/`h`, the footprint and rise it's drawn at. |
| `SENDS` | 3 entries | `cost`, `inc` (income bought) and `press` (damage done to the rival). |

| Tower | Cost | Does |
|---|---|---|
| **RIME** | 5g | The maze brick. Tiny damage, but it slows — you'll own eighty. |
| **SHARD** | 24g | Straight single-target damage. |
| **BLIZZARD** | 58g | Splash, slow rate. |
| **NOVA** | 120g | Long range, heavy, slow. |

Each upgrades twice (×1.8 damage a step) and sells back at 70% of what went
into it. Scoring: `4 + wave` per kill (×6 on bosses), `40 × wave` per wave
survived, `40` per life left at the end, and `2500` for outlasting the rival.

## 📬 The forms + counter (real, via Cloudflare KV)

The **Ice List signup**, the **guestbook**, the **visitor counter**, and the
lounge's **arcade high-score boards** are backed by Cloudflare Pages Functions
in `functions/api/` that read and write a Cloudflare KV namespace. If the API
isn't reachable — you opened the page as a local file, or the KV binding isn't
set up yet — every one of them quietly falls back to the old browser-only
behaviour, so the site never looks broken.

| Endpoint | What it does |
|---|---|
| `functions/api/visits.js` | Shared hit counter. POST bumps it, GET reads it; the page counts once per session. |
| `functions/api/subscribe.js` | Stores each Ice List email in KV as `sub:<email>` (duplicates collapse). |
| `functions/api/guestbook.js` | The shared guestbook: GET lists it, POST adds to it (length caps, a bot honeypot, and a 60s-per-IP cooldown). |
| `functions/api/scores.js` | Shared high-score boards for the lounge's three arcade cabinets. `GET ?game=bricksmash\|snake\|wintermaul` reads a board, POST submits one (per-game score ceiling, honeypot, 60s-per-IP cooldown). Stored one key per game as `scores:<game>`. |

### One-time setup: bind the KV namespace
The Functions look for a binding named **`FrostMilanoKV`** (a **`FROST_KV`**
binding also works, as a fallback). In the Cloudflare dashboard: **Workers &
Pages → your Pages project → Settings → Functions → KV namespace bindings → Add
binding**, variable name `FrostMilanoKV`, and select the namespace you created
(named `FrostMilanoKV`, id `ee9fcf13dac5479787cc42f9089246e6`). Note the
**variable name** and the **namespace** happen to share the label `FrostMilanoKV`
here — that's fine. Add it to **Production** (and Preview if you want the
previews to work too), then redeploy. Until this binding exists the endpoints
return 503 and the site uses the local fallback.

> **This must be a Cloudflare _Pages_ project, not a Worker.** Pages is what
> turns the `functions/` folder into the `/api/*` endpoints; a plain Worker
> ignores that folder and every `/api/*` route 404s. If `/api/visits` returns
> **404**, it's deployed as the wrong product; **503** means Pages is running
> but the KV binding is missing.

### Reading what comes in
- **Emails:** in the dashboard open the KV namespace and filter keys by the
  `sub:` prefix, or from a terminal:
  `wrangler kv key list --namespace-id ee9fcf13dac5479787cc42f9089246e6 --prefix "sub:"`
- **Guestbook:** it renders on the site; the raw JSON is the `guestbook` key.
- **High scores:** the raw JSON lives under `scores:bricksmash`, `scores:snake`
  and `scores:wintermaul`.

### Want signups emailed to you instead?
KV storage is the no-extra-service option. To also get an email on each signup,
or to push straight into a newsletter tool, add a call in `subscribe.js` to a
sender like Resend or MailChannels (needs an API key stored as a Pages secret) —
ask and it can be wired in.

## 🌍 Putting it online (free)

Hosted on **Cloudflare Pages**, connected to `github.com/teasleyw/FrostMilano`.
Every `git push` deploys automatically. Cloudflare's free tier has unlimited
bandwidth, which matters here because video is heavy — most other free tiers
cap around 15–100 GB/month and bill hard past it.

Build settings (there is **no build step** — it's plain HTML/CSS/JS):

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | *(empty)* |
| Build output directory | `/` |

### Caching (`_headers`)
`_headers` tells browsers how long to reuse each file, so returning visitors
don't re-download the videos every visit. HTML always revalidates, CSS/JS
cache for an hour, images and video for 30 days.

⚠️ **If you replace a video or photo, change its filename** (`clip-01.mp4` →
`clip-01-v2.mp4`) and update the `src` in `index.html`. Otherwise visitors who
already have the old file may keep seeing it for up to a month. The full
explanation is in the comments at the bottom of `_headers`.

## ♿ Notes
- Fully responsive (the tour table becomes cards on phones).
- Respects "reduce motion" OS settings — snow & marquees turn off automatically.
- Fonts load from Google Fonts; everything else is self-contained.

Stay frosty. ❄
