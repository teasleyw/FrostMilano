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
- **Socials**: real Instagram (@frost_milano) + Spotify links.
- **Booking email**: frostmilano42@gmail.com.
- **Tour**: Jul 30 — Valhalla, Austin TX (the "INFO" button links to your Instagram).
- **About photo**: pulled from your Instagram → `images/frost-milano.jpg`.

Your Spotify IDs (for future edits):
- Artist: `0SKY221pDeeTJUgkqmYWiM`
- Lately (EP): `0p7ccxrvwKAXG1b87CLXlG` · Monster: `5qdNeLApuvRMmsv8lkjMsP`
- 42 Weeks: `7631QbIOpt4ZkJjOigzkze` · MyFurCoat: `6kSDr8PKWdu8udaE1cb7L3`

## ✎ What's still a placeholder

Open `index.html` in any text editor and search for these:

| Search for | What it is |
|---|---|
| `href="#REPLACE"` | Remaining placeholder links — TikTok/YouTube socials. Swap in real URLs or delete. |
| The `TOUR` table rows | Add more shows as you book them (one real date is in now: Jul 30, Austin) |
| The `VIDEO VAULT` TVs | Drop `clip-01.mp4`…`clip-03.mp4` into `video/`. Full how-to in `video/README.txt` |
| The `ABOUT` bio paragraphs | Swap the sample bio for your real story |
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

## 📬 Making the forms actually send
Right now the **Ice List signup** just shows a friendly message, and the
**guestbook** saves entries only in that visitor's own browser (localStorage).
To collect real emails/messages, point the forms at a free service like
[Formspree](https://formspree.io) or [Buttondown](https://buttondown.email) —
set the form's `action` to their endpoint.

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
