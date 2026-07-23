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

## 📬 The forms + counter (real, via Cloudflare KV)

The **Ice List signup**, the **guestbook**, and the **visitor counter** are
backed by three Cloudflare Pages Functions in `functions/api/` that read and
write a Cloudflare KV namespace. If the API isn't reachable — you opened the
page as a local file, or the KV binding isn't set up yet — every one of them
quietly falls back to the old browser-only behaviour, so the site never looks
broken.

| Endpoint | What it does |
|---|---|
| `functions/api/visits.js` | Shared hit counter. POST bumps it, GET reads it; the page counts once per session. |
| `functions/api/subscribe.js` | Stores each Ice List email in KV as `sub:<email>` (duplicates collapse). |
| `functions/api/guestbook.js` | The shared guestbook: GET lists it, POST adds to it (length caps, a bot honeypot, and a 30s-per-IP cooldown). |

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
