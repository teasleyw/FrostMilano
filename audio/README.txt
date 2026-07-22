=======================================================================
 FROST MILANO :: THE LOUNGE BOOMBOX — how to add your track
=======================================================================

WHAT GOES IN HERE
-----------------
Drop your track in this folder. The lounge is already wired to look for
these filenames, in this order:

    audio/lounge-track.mp3      <- this one is enough on its own
    audio/lounge-track.ogg      <- optional fallback

Until a file exists, clicking the boombox reports "NO TAPE" instead of
failing silently — same idea as the "NO SIGNAL" TVs on the main site, so
the room never looks broken while you're still filling it in.

MP3 alone plays everywhere that matters (Chrome, Safari, Firefox, Edge,
iOS, Android). The .ogg is only worth adding if you care about very old
Firefox builds.


NOTHING PLAYS UNTIL SOMEONE CLICKS
----------------------------------
The boombox is click-to-play on purpose, and there is no autoplay
attribute anywhere.

Two reasons, and the first is not optional:

 1. Every current browser BLOCKS audio that starts without a user
    gesture. An autoplaying page just gets muted, or the play() call is
    rejected outright. The click is what unlocks it.

 2. A homepage that starts playing music at a visitor is rude even when
    the browser allows it. Someone with headphones on at work should not
    get ambushed by your record.

The track loops once started, and clicking again stops it.


WHICH TRACK TO USE
------------------
Pick one, and prefer something that loops without an obvious seam — the
lounge is a place people idle in, so a hard stop-and-restart gets old
fast. An instrumental or a beat tends to sit better under a room you're
walking around than a full vocal mix.

If you'd rather not host the audio at all, the alternative is a Spotify
embed like the MUSIC section on the main page uses. Worth knowing what
that costs you though: Spotify embeds only play 30-second previews for
anyone who isn't logged in, they can't be triggered from the canvas, and
you'd be dropping an iframe into the room. Local file is the better
experience here; Spotify is the better discovery link.


MAKING IT WEB-FRIENDLY
----------------------
A full-quality track is a big download for a page someone might bounce
off in ten seconds. If you have ffmpeg:

    ffmpeg -i input.wav -c:a libmp3lame -b:a 128k lounge-track.mp3

  -b:a 128k     plenty for a background loop. 160k if you're fussy.
                Don't go above 192k for this — it's playing under a
                canvas game, not being auditioned.

Target: under ~4 MB. A 3-minute track at 128k lands around 2.9 MB.

To trim to a section first:

    ffmpeg -i input.wav -ss 00:00:12 -t 00:01:30 -c:a libmp3lame ^
           -b:a 128k lounge-track.mp3

  -ss   where to start   -t   how long to keep

No ffmpeg? Audacity (free, audacityteam.org) — File -> Export -> MP3.


VOLUME
------
The lounge sets playback to 65% on its own, so you don't need to master
the file quietly. Normal levels are fine.

To change it, search lounge.html for `audioEl.volume`.


CHANGING THE FILENAME
---------------------
Search lounge.html for "lounge-track" — it appears in the <audio> block
near the top of the file. Both <source> lines point at it.

Stay frosty. ❄
