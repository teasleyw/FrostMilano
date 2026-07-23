=======================================================================
 FROST MILANO :: THE LOUNGE JUKEBOX — how to add / change tracks
=======================================================================

WHAT GOES IN HERE
-----------------
The lounge boombox is a jukebox: it steps through a list of tracks and
wraps back to the top. The list lives in lounge.html (search TRACKS) and
points at these files:

    audio/lately.mp3     LATELY    (also a release card + Record Room sleeve)
    audio/mmp.mp3        MMP
    audio/monster.mp3    MONSTER   (also a release card + Record Room sleeve)
    audio/rockstar.mp3   ROCKSTAR  (unreleased — Record Room preview only)

Drop an .mp3 in with the matching name and it plays. MP3 alone plays
everywhere that matters (Chrome, Safari, Firefox, Edge, iOS, Android).

If a track's file is missing the box just skips past it; if the whole
list is missing the boombox reports "NO TAPE" instead of failing
silently — same idea as the "NO SIGNAL" TVs on the main site, so the
room never looks broken while you're still filling it in.


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

Click once to play; the current track's name shows in a chip over the
cabinet. When it ends the next one rolls in automatically and the list
wraps. Click again to stop.


ROCKSTAR / UPCOMING TRACKS
--------------------------
ROCKSTAR is unreleased, so it has no Spotify link. Its sleeve on the
Record Room wall carries a "SOON" sticker, and clicking it cues the
local rockstar.mp3 straight on the jukebox instead of opening a dead
release page. To add another upcoming track: add it to TRACKS, then add
a RECORDS entry with `upcoming: true` and `cue: "<its TRACKS title>"`
(no url). Released singles keep their Spotify url and open that instead.


ADDING OR REORDERING TRACKS
---------------------------
Everything is driven by the TRACKS array in lounge.html:

    var TRACKS = [
      { title: "LATELY",   src: "audio/lately.mp3" },
      ...
    ];

Add, remove, or reorder entries there. `title` is what shows in the
readout chip; `src` is the file. The Record Room matches an upcoming
sleeve to a track by `title`, so keep those spellings in sync.


MAKING IT WEB-FRIENDLY
----------------------
A full-quality WAV is a big download for a page someone might bounce off
in ten seconds. Convert with ffmpeg:

    ffmpeg -i input.wav -c:a libmp3lame -b:a 128k audio/monster.mp3

  -b:a 128k     plenty for a background loop. 160k if you're fussy.
                Don't go above 192k for this — it's playing under a
                canvas game, not being auditioned.

A 3-minute track at 128k lands around 3 MB. With several tracks the
files add up, but preload="none" means none are fetched until the box is
first clicked, so an unvisited page still costs nothing.

To trim to a section first:

    ffmpeg -i input.wav -ss 00:00:12 -t 00:01:30 -c:a libmp3lame ^
           -b:a 128k audio/monster.mp3

  -ss   where to start   -t   how long to keep

No ffmpeg? Audacity (free, audacityteam.org) — File -> Export -> MP3.


VOLUME
------
The jukebox sets playback to 65% on its own, so you don't need to master
the files quietly. Normal levels are fine.

To change it, search lounge.html for `audioEl.volume`.


Stay frosty. ❄
