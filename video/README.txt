=======================================================================
 FROST MILANO :: THE VIDEO VAULT — how to add your Instagram clips
=======================================================================

WHAT GOES IN HERE
-----------------
Drop your .mp4 files in this folder. The site is already wired to look
for these three filenames:

    video/clip-01.mp4
    video/clip-02.mp4
    video/clip-03.mp4

Until a file exists, that TV shows a "NO SIGNAL" static screen — so the
page never looks broken while you're still filling it in.


HOW TO GET AN MP4 OUT OF INSTAGRAM
----------------------------------
Your own posts, easiest first:

 1. INSTAGRAM'S OWN DOWNLOAD (cleanest, no watermark)
    Instagram app -> Settings and privacy -> Accounts Center ->
    Your information and permissions -> Download your information.
    Request just "Posts", format HTML/JSON, and you'll get a zip with
    the original video files inside.

 2. SAVED TO CAMERA ROLL
    If you still have the original clip on your phone (Reels drafts, or
    the source video you uploaded), use that — it's higher quality than
    anything re-downloaded from Instagram.

 3. Avoid random "IG downloader" websites. They re-encode, add
    watermarks, and are a malware buffet.


MAKING THEM WEB-FRIENDLY
------------------------
Phone videos are big. A 60-second reel can be 80 MB, which is a slow
page. If you have ffmpeg installed, this shrinks it hard with almost no
visible quality loss:

    ffmpeg -i input.mp4 -vf "scale=-2:960" -c:v libx264 -crf 26 ^
           -preset slow -c:a aac -b:a 96k -movflags +faststart clip-01.mp4

  -crf 26        quality knob. Lower = better + bigger. 23-28 is sane.
  scale=-2:960   caps height at 960px. Plenty for a web player.
  +faststart     lets the video start playing before it fully loads.
                 (Don't skip this one.)

Target: under ~8 MB per clip. Aim for 15-30 second cuts, not full songs.

No ffmpeg? HandBrake (free, handbrake.fr) with the "Fast 1080p30"
preset does the same job with buttons.


POSTER IMAGES (optional but recommended)
----------------------------------------
The still frame shown before a video plays. Without one the TV is black
until it loads. Grab frame one:

    ffmpeg -i clip-01.mp4 -vframes 1 -q:v 3 ../images/clip-01-poster.jpg

Then in index.html, add poster="images/clip-01-poster.jpg" to that
<video> tag.


EDITING THE VAULT
-----------------
All in index.html — search for "VIDEO VAULT". Per TV you can change:

  <source src="...">   which file plays
  data-title           the label on the plate under the screen
  data-ig              the Instagram post URL the "VIEW POST" link opens
                       (leave as #REPLACE and the link hides itself)

Adding a 4th TV: copy a whole <article class="tv"> block and bump the
channel number. Removing one: delete the block. The grid re-flows.

Horizontal video instead of vertical? Add a modifier class to the
article: class="tv tv--wide" for 16:9, or "tv tv--square" for 1:1.

Stay frosty. ❄
