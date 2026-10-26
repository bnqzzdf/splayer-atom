# SPlayer Atom User Guide

> Last updated: 2026-10-26
>
> Applies to version `1.1.3` (documentation baseline `5693b3fc`)
>
> Audience: end users controlling SPlayer Atom from a browser

## 1. What this is

SPlayer Atom consists of two parts:

- **Core**: a background service on a Linux music host that owns the library, queue, playback, cache, downloads, plugins, and all accounts;
- **Web Control**: the control interface in a browser. Computers, tablets, and phones can open the same address.

Closing the page, refreshing, or switching devices does not interrupt music playing in the Core. Multiple browsers see the same queue, position, output device, and login state.

## 2. First use

### 2.1 Open the interface

In a browser, visit:

```text
http://<Core host IP>:14558
```

For example, if the Core host is `192.168.1.20`, open `http://192.168.1.20:14558`.

If it does not open:

- confirm the Core service is running;
- confirm the phone/computer is on the same LAN as Core;
- confirm the firewall allows 14558;
- if using a domain, the administrator must add it to `ATOM_ALLOWED_HOSTS`.

### 2.2 Onboarding

You can open:

```text
http://<Core host IP>:14558/#/onboarding
```

The onboarding flow has four steps: welcome, language/theme, library directory, and streaming notes. The current version does not force a redirect on first visit; completion is stored in the current browser.

### 2.3 Choose an audio output

An output device must be selected before the first playback. Without one, Core returns `OUTPUT_DEVICE_REQUIRED` and the interface opens the output selector.

Outputs are grouped into three types:

| Type | Description | Suitable for |
| --- | --- | --- |
| ALSA | Core host sound card / USB DAC | Hosts directly connected to a DAC |
| Diretta | Diretta Target | Strict HiFi chains |
| UPnP | LAN Renderer | Network players, another music host |

Core remembers the preference. When switching during playback, Core reloads the current track and restores position and playback intent.

### 2.4 Add a library

1. Open **Settings → Local Library**.
2. Click add directory.
3. The directory picker operates on the **Core host**, not the browser device.
4. Select the music directory and save.
5. Run an incremental or full scan.

Scan progress shows the current file. Only one scan runs at a time; it can be cancelled.

### 2.5 Start playing

Open **Songs**, **Albums**, **Artists**, or **Folders** and press play. The player bar appears at the bottom.

## 3. Interface tour

### 3.1 Sidebar

Common entries:

- Home
- Online Platforms (shown after at least one provider login)
- Songs
- Liked Music
- Play History
- Downloads (shown when enabled)
- Daily Recommendations (after NetEase login)
- Favorites (after NetEase login)
- Cloud Drive (after NetEase login)
- Local Artists / Local Albums
- Folders
- Streaming
- Stats
- Search
- Settings

The sidebar supports grouping, hiding, sorting, and collapsing under **Settings → Appearance → Sidebar**.

### 3.2 Player bar

The player bar contains:

- cover, title, artist;
- previous / play-pause / next;
- progress bar and time;
- repeat mode and shuffle;
- volume;
- output device;
- queue;
- EQ, speed/pitch, A/B loop, sleep timer, Personal FM;
- full-screen player entry.

On phones the player bar is fixed to the bottom and respects safe areas.

### 3.3 Full-screen player

Click the cover or player bar to enter the full-screen player. It includes:

- cover and lyrics columns;
- word-by-word/line lyrics, translation, romanization;
- backgrounds: blur, solid, fluid animation;
- queue panel;
- like, comments, add to playlist, download, open containing folder;
- lyric offset adjustment;
- full-screen browser mode.

On phones the cover is shown first; tap it to switch to lyrics.

### 3.4 Settings

The settings dialog has categories on the left and content on the right. The search box searches declared settings; full-page custom categories are not included.

Typical categories:

- Appearance
- Playback
- Lyrics
- Local Library
- Network & Services
- Media Sources
- Downloads
- Local & Cache
- Plugins
- Other
- About

## 4. Local library

### 4.1 Songs

The Songs page supports:

- search by title, artist, album, path;
- sort by title, artist, album, path, duration, size, modified time, created time, track number;
- multi-select;
- play all;
- batch add to queue, download, add to playlist, remove;
- edit tags;
- open containing folder (local files).

### 4.2 Albums and artists

- **Local Albums**: grouped by album, with a detail page; multi-disc filtering and grouping.
- **Local Artists**: grouped by artist, with a detail page.
- Album detail can "open the album folder", locating the real directory on the Core host; CUE/SACD locate the container file directory.

### 4.3 Folder browser

The Folders page browses the Core host filesystem, but only within directories already added to the library.

Supports:

- roots and pinned folders;
- breadcrumb navigation;
- list/grid views;
- sort by name, modified time, track number, ascending/descending;
- current-directory filtering;
- recursive search;
- multi-select;
- play, shuffle, play next, add to queue;
- add to playlist;
- scan the current directory;
- image/PDF/text preview;
- expand CUE/SACD containers into tracks;
- pin/unpin directories.

Folder actions **never delete files**. Batch actions affect only the queue and playlists.

### 4.4 CUE and SACD

- CUE supports single-FILE whole-image CUE only; splits appear as separate tracks.
- SACD ISO expands into stereo tracks.
- Container entries can be expanded for single-track play, play next, queueing, and adding to playlists.
- Under Direct output, CUE uses exact 75fps boundaries and supports gapless. Under UPnP, CUE/SACD generate temporary files, so the first play may be slower.

### 4.5 Tag editing

Choose "Edit Tags" from the track menu. You can change:

- title, artist, album artist, album;
- genre, year;
- track number, disc number;
- lyrics;
- cover (local file or URL).

Notes:

- only changed fields are submitted;
- empty string/0 clears a field;
- if editing the currently playing track, playback stops, tags are written, then the track reloads and position is restored;
- if cover download fails, only the cover is skipped; text is still written;
- only files known to the library can be edited.

### 4.6 Liked music

- **Local likes**: marks local tracks as liked, stored in Core.
- **NetEase likes**: requires NetEase login and reads the account's liked tracks.

The two tabs use different sources and do not sync to each other.

## 5. Playback and queue

### 5.1 Queue

The queue is managed by Core. You can:

- play all;
- play next;
- add to queue;
- drag to reorder;
- remove a track;
- clear the queue;
- locate the current track;
- view the remaining total duration.

Multiple browsers see the same queue. A change in one browser updates the others.

### 5.2 Repeat and shuffle

| Mode | Behavior |
| --- | --- |
| Repeat off | Stops after the last track |
| Repeat list | Returns to the first track after the last |
| Repeat one | Reloads the current track when it ends |
| Shuffle on | Keeps the current track first, shuffles the rest; turning it off restores the original order |

Note: **Previous** wraps to the end of the queue when on the first track, even with repeat off. This is current behavior.

### 5.3 Auto-next and failure skip

- Normal end loads the next track automatically.
- If a track fails to load, Core tries at most `min(5, queue length)` times.
- Device and unknown errors are not skipped automatically.
- When an online source URL expires, Core re-resolves the same track once.
- A one-track queue never "jumps to another song".

### 5.4 Preload and gapless

After enabling **Settings → Playback → Preload next track**, Core resolves the next track early:

- ALSA Processed: gapless for ordinary PCM when there is no CUE/SACD/DSD and speed/pitch are bypassed;
- ALSA Direct / Diretta: prepares the next track in the background; gapless when the wire format matches;
- UPnP: no gapless; each track reloads.

Diretta/ALSA Direct attempts staging even without preload enabled.

### 5.5 Sleep timer

Player bar menu → Sleep Timer:

- 1–180 minutes;
- presets 10/20/30/45/60/90/120;
- optionally "wait for current track to end";
- at the deadline it pauses playback, not the Core;
- the timer lives only for the current Core run and is lost on restart.

### 5.6 A/B loop

Open A/B loop from the full-screen player or player bar menu:

- set A and B points;
- jump back to A when B is reached;
- clear the loop.

### 5.7 Speed, pitch, EQ, loudness

These are "sample processing" and are available only on **ALSA Processed**:

- speed 0.5–2.0;
- pitch -12 to +12 semitones, with optional pitch sync;
- 10-band EQ plus preamp;
- loudness normalization, clipping protection, fade in/out.

On **ALSA Direct, Diretta, and UPnP**, these controls are locked and volume shows 1. This is an output-path constraint, not a fault.

### 5.8 Personal FM and Heart mode

- **Personal FM**: requires NetEase login. Modes include default/familiar/explore/scenario. In FM mode the "next" button becomes "dislike".
- **Heart mode**: builds a recommendation queue from the current NetEase track or a random liked track.

FM pools and Heart queues are not persisted; after a Core restart you return to the ordinary queue.

## 6. Audio output

### 6.1 ALSA

ALSA devices come from real hardware endpoints on the Core host:

- IDs look like `alsa:hw:CARD=xxx,DEV=0`;
- no `default`/`plughw`/`softvol`;
- HDMI/DisplayPort endpoints are hidden unless currently selected.

ALSA has two modes:

| Mode | Characteristics | Available processing |
| --- | --- | --- |
| Processed | Everyday use; mono/stereo only; no ALSA resampling | EQ, loudness, speed, pitch, fade |
| Direct | Preserves valid bits; integers never become float; native DSD | No sample processing |

Switching modes reloads the current track; a failure may stop playback and require pressing play again.

### 6.2 Diretta

Diretta is strict Source Direct:

- Core must run as root;
- the build must include the Diretta SDK;
- only lossless integer PCM or native DSD is accepted;
- the next track must keep the same wire format within one connection;
- no resampling, volume, EQ, speed, pitch, DoP, or DSD-to-PCM;
- unsupported formats fail explicitly; there is no fallback.

If Diretta has no sound:

1. Confirm the selected output is the Diretta Target.
2. Confirm Core runs as root.
3. Confirm the track is lossless integer PCM or DSD.
4. Confirm the Target is not held by another Host.
5. Check Core logs for `OUTPUT_FORMAT_UNSUPPORTED` or other errors.

### 6.3 UPnP

UPnP sends to a LAN Renderer:

- only one Renderer at a time;
- common PCM/DSD formats, but multichannel is rejected;
- no gapless;
- CUE/SACD generate temporary files;
- the Renderer must be able to reach Core's temporary media port.

If the device list is empty, check that Core and the Renderer are on the same network and that SSDP multicast is not blocked.

## 7. Online music

### 7.1 Supported providers

- NetEase Cloud Music
- QQ Music
- Kugou Music
- Qobuz
- TIDAL

### 7.2 Login methods

| Provider | Method |
| --- | --- |
| NetEase | QR code; or paste a Cookie |
| QQ Music | QQ QR / WeChat QR; or paste a Cookie |
| Kugou | QR code; or paste a Cookie |
| Qobuz | Browser OAuth; or paste a token |
| TIDAL | Official PKCE callback; or device code; or token |

Notes:

- Core stores login information; Web only sees logged-in/out and the account name, not the Cookie/token.
- During manual login, the Cookie/token passes through the browser form and is then sent to Core.
- TIDAL device code is usually AAC-only; use official PKCE for lossless.
- Qobuz accounts without a subscription may only return trial segments.

### 7.3 Provider home

After login, "Online Platforms" appears in the sidebar. The provider home includes:

- Qobuz/TIDAL sections and genres;
- NetEase/QQ/Kugou charts, new songs, new albums, popular artists, recommended playlists;
- click-through to album/playlist/chart/artist detail;
- "View all" opens the provider section page.

### 7.4 Daily recommendations, favorites, cloud drive

- **Daily recommendations**: NetEase, archived for 14 days by a 6:00 logical day.
- **Favorites**: NetEase playlists/albums/artists.
- **Cloud drive**: NetEase cloud tracks, capacity, and track deletion.

All require NetEase login.

### 7.5 Trial and entitlement

Online tracks may hit:

- membership required (VIP);
- digital single/album purchase required;
- trial segment only;
- unavailable in this region/account;
- login required again.

Web shows the corresponding error. When "Allow trial playback" is enabled, tracks with only a trial source play a segment; trial sources are not cached.

## 8. Self-hosted media servers

Supported types:

- Subsonic
- Navidrome
- OpenSubsonic
- Airsonic
- Gonic
- LMS
- Jellyfin
- Emby

Add a server:

1. Settings → Media Sources → Streaming Servers.
2. Add a server: name, type, URL, username, password.
3. Test the connection.
4. Save and set active.
5. Core pulls a library snapshot automatically; manual sync is also available.

Browsing:

- the Streaming page has Songs/Albums/Artists/Playlists;
- search and play-all are supported;
- album/playlist/artist detail reuses the collection/artist pages;
- lyrics come from the server.

Notes:

- sync is single-flight per server; the first sync may be slow;
- a failed sync keeps the previous snapshot;
- deleting a server deletes Core's snapshot for it, not the server itself.

## 9. Search

Search has three sources:

1. **Local**: songs, albums, artists;
2. **Streaming**: the active media server;
3. **Online providers**: logged-in providers supported by Core.

Behavior:

- four tabs: songs/albums/artists/playlists;
- 50 results per page, infinite scroll;
- changing keyword/provider/server discards old requests;
- auth failures show a login entry;
- the header search dialog supports history, hot searches, suggestions, and NetEase link parsing.

## 10. Lyrics

### 10.1 Formats

LRC, QRC, YRC, KRC, TTML, LyS, SRT, ASS. Word-by-word, translation, romanization, and bilingual display are supported.

### 10.2 Sources

- embedded lyrics in local files;
- sidecar lyric files;
- online provider lyrics;
- plugin lyrics;
- AMLL TTML (online or local library).

Source and format priority can be adjusted under **Settings → Lyrics → Source order / Format order**.

### 10.3 Lyric offset

The full-screen lyric toolbar can:

- advance/delay by 500ms;
- enter an offset directly;
- reset.

Offsets are stored per "track + lyric source", range ±60 seconds. A positive value advances lyrics.

### 10.4 Local TTML lyric library

Settings → Lyrics → Local TTML:

- choose a directory on the Core host;
- Core recursively scans `.ttml` files;
- matching uses AMLL metadata (NetEase/QQ IDs, title, artist).

Note: the index only checks the root directory mtime; adding/removing files in subdirectories may not trigger a rebuild. Change the directory or restart Core to force it.

### 10.5 Lyric display

Adjustable:

- engine: physics / AMLL;
- size, weight, font;
- translation, romanization;
- word highlight, float, emphasis, blur;
- hide passed lines;
- spring parameters, alignment, fade width, inactive alpha;
- background lyric detection;
- exclusion keywords/regexes.

AMLL and fluid backgrounds are resource-intensive; low-power devices should use physics + blurred background.

## 11. Playlists

### 11.1 Local playlists

- create, rename, describe, delete;
- add/remove tracks;
- clear;
- the cover is taken from the first added track when the playlist has no cover.

Local playlists are stored in Core, not in browser-local data.

### 11.2 NetEase playlists

Requires NetEase login:

- create (privacy optional);
- rename/describe;
- delete;
- add/remove tracks;
- favorite/unfavorite.

Subject to account entitlement and provider limits.

### 11.3 Sidebar playlists

The sidebar "My Playlists" can switch between local/online sources and supports covers, grouping, hiding, and sorting.

## 12. Downloads

### 12.1 Enable

Settings → Downloads → enable "Downloads". When off, all download entries are hidden.

### 12.2 Settings

| Setting | Description |
| --- | --- |
| Download directory | Directory on the Core host; default `~/Music/SPlayer Atom Core` |
| Quality | hi-res / lossless / hq / sq / lq; default lossless |
| Use playback API for download | NetEase option; fallback path when the download API fails |
| Filename template | `{title}` / `{artist} - {title}` / `{title} - {artist}` |
| Folder scheme | none / by album / by album+disc |
| Duplicate policy | rename / overwrite / skip |
| Lyric format | LRC / enhanced LRC |
| Embed cover/metadata/lyrics | optional |
| Extra LRC/TTML | optional |

### 12.3 Tasks

The Downloads page has three tabs:

- In progress
- Failed
- Completed

Notes:

- downloads are serial, one at a time;
- same track + same quality is deduplicated;
- no resume;
- temp files live in the cache directory and are cleaned at startup;
- cancelling/deleting a task does not delete completed music files;
- completed tasks can play the local file directly.

## 13. Cache

Two kinds:

| Type | Contents | Location |
| --- | --- | --- |
| File cache | covers, artist images, backgrounds, song cache | Core cache directory |
| Database cache | lyrics, TTML, lyric matching | `library.db` |

Settings → Local & Cache:

- view usage per category;
- clear by category;
- switch cache directory (target must be empty);
- restore the default cache directory;
- clear all.

Notes:

- song cache is off by default; when enabled, set a limit (default 10 GB);
- image cache has no automatic limit; clean it periodically;
- switching the cache directory clears old file caches; it does not migrate them;
- database caches are unaffected by directory switching.

## 14. Plugins

### 14.1 Install

Settings → Plugins → Install from URL. Only:

- HTTPS;
- or `http://localhost` / `http://127.0.0.1`.

The installed item is a plugin script (`.js`), not an archive.

### 14.2 Types and permissions

| Type | Purpose | Default permissions |
| --- | --- | --- |
| Source plugin | Provides playback URLs, lyrics, covers | Automatically `network` |
| Control plugin | Controls the player, settings, track menus | Must declare `network` / `control` / `ui` |

### 14.3 Manage

- enable/disable;
- view status (loading/ready/error/disabled);
- configure plugin settings;
- check for updates, one-click update;
- uninstall (removes script and plugin data).

### 14.4 Safety

- plugins are third-party code and can access the network;
- install only trusted sources;
- plugins run in an isolated Core child process, but it is not a hard security sandbox;
- one long-blocking plugin stalls the others;
- the host restarts after a crash; after repeated failures the plugin becomes error.

## 15. Stats and history

### 15.1 Stats

The Stats page uses Core data:

- library overview: tracks/albums/artists/total duration/total size;
- 90-day heatmap;
- hourly distribution;
- quality composition;
- most-played tracks/albums/artists.

Top lists exclude `streaming` sources; summary/daily/hourly include all sources.

### 15.2 Play history

"Play History" is a **browser-local** record:

- up to 500 entries;
- deduplicated, newest first;
- deletable/clearable;
- not synced across devices.

It is separate from Core stats.

## 16. ListenBrainz

Settings → Network & Services → ListenBrainz:

1. Enable the master switch.
2. Paste a ListenBrainz token.
3. Link the account.
4. Optionally send Now Playing.

Notes:

- when disabled, no background submission occurs;
- submission runs in a separate child process and does not block playback;
- threshold is about half the track duration, capped at 240 seconds;
- the panel shows pending/dead and can clear the outbox.

## 17. Multiple devices

- Multiple browsers can connect to the same Core.
- Queue, current track, repeat/shuffle, output device, and login state are shared by Core.
- Browser-local settings (theme, layout, fonts, lyric display, UI zoom) are not shared.
- Play history is not shared.
- Closing the browser does not stop playback; reopening restores the current state from Core.

If two devices edit the queue simultaneously, Core applies commands in arrival order; later edits overwrite earlier ones.

## 18. Settings quick reference

### 18.1 Playback

| Setting | Default | Description |
| --- | --- | --- |
| Autoplay after load | Off | Play automatically after loading |
| Remember last playback | On | Restore the queue on restart |
| Fade in/out | On | 200ms |
| Loudness normalization | Off | Processed only |
| Clipping protection | On | Processed only |
| Online quality | HQ | lq/sq/hq/lossless/hi-res |
| Allow trial playback | Off | Play a segment when only a trial source exists |
| Preload next track | Off | Resolve/prepare the next track early |
| Pause before device switch | Off | Output switching behavior |
| Skip DJ/car/hot tracks | Off | Fuck DJ Mode |
| ALSA mode | Direct | direct/processed |
| EQ | Off | 10-band + preamp |

### 18.2 Lyrics

| Setting | Default | Description |
| --- | --- | --- |
| Online lyric source | Auto | Auto/NetEase/QQ/Kugou/local |
| Smart prefer online | Off | |
| Prefer plugin lyrics | Off | |
| Source order | NCM/QM/KG | Draggable |
| Format order | TTML/LyS/QRC/KRC/YRC/LRC/ASS/SRT | Draggable |
| Background lyric detection | On | |
| Adaptive font size | On | |
| Font size | 48 | 30–64 |
| Translation | On | |
| Romanization | On | |
| Word highlight | On | physics |
| Hide passed lines | Off | |
| Engine | physics | physics/AMLL |
| Lyric exclusion | On | keywords/regex |

### 18.3 Downloads

| Setting | Default |
| --- | --- |
| Enable downloads | Off |
| Quality | lossless |
| Filename template | `{title}` |
| Folder scheme | By album |
| Duplicate policy | Rename |
| Lyric format | Enhanced LRC |
| Embed cover/metadata/lyrics | On/On/On |
| Extra LRC | Off |
| Save TTML | Off |

### 18.4 Cache

| Setting | Default |
| --- | --- |
| Song cache | Off |
| Cache streaming songs | Off |
| Cache limit | 10 GB (0 = unlimited) |

### 18.5 Other

| Setting | Default |
| --- | --- |
| Theme | Follow system |
| Theme color source | Default |
| Language | Simplified Chinese |
| UI zoom | 100% |
| NetEase domestic IP | Off |
| Network proxy | Off (127.0.0.1:7890) |
| NetEase scrobble | Off |
| ListenBrainz | Off |

## 19. FAQ

### 19.1 No sound

1. Confirm an output device is selected.
2. Confirm the output is not exclusively held by another program.
3. Diretta: confirm root, Target availability, and supported source format.
4. UPnP: confirm the Renderer can reach Core's media port.
5. ALSA: check `aplay -l` still lists the device.
6. Check Core logs for the error code.

### 19.2 "Output device required"

Open the output selector in the player bar and choose an ALSA/Diretta/UPnP device. Then play again.

### 19.3 "Current output does not support this format"

Usually Diretta or Direct ALSA:

- the source is not lossless integer PCM/DSD;
- the next track's wire format differs from the current one;
- multichannel/float source.

Change track, change output, or use Processed (which loses strictness). Diretta never downgrades automatically.

### 19.4 Browser 403

Possible causes:

- domain access without `ATOM_ALLOWED_HOSTS`;
- reverse proxy rewrote Host;
- `file://` or a sandbox iframe.

Ask the administrator to check Host/Origin configuration.

### 19.5 Lyrics missing

- check lyric source and format order;
- online lyrics may require provider login or network;
- local files may not have embedded lyrics;
- try "Match lyrics" in the track menu;
- check exclusion rules.

### 19.6 Download entry missing

Downloads are off by default. Enable "Downloads" under **Settings → Downloads**.

### 19.7 Downloads slow/failing

- downloads are serial, one at a time;
- no resume;
- providers may throttle or require entitlement;
- insufficient disk space causes failure;
- failed tasks are visible on the Downloads page.

### 19.8 Plugin shows error

- read the plugin card error;
- confirm the script declares the correct `@apiLevel` and permissions;
- disable and re-enable;
- the host restarts after a crash; after repeated failures, enable manually;
- install only trusted plugins.

### 19.9 Library is empty

- confirm the scan directory exists and is readable on the Core host;
- confirm the scan completed;
- check whether the directory was removed;
- large libraries take time on first scan;
- check `library count` and scan progress.

### 19.10 Multiple devices out of sync

- confirm all devices connect to the same Core;
- refresh and wait for WebSocket reconnect;
- check whether a device is offline;
- theme/layout/history are not synced by design.

### 19.11 Stats and play history disagree

Stats come from Core; History comes from the current browser's IndexedDB. They have different scopes and definitions.

## 20. Data and privacy

- Library, settings, playlists, stats, download tasks, and login state live on the Core host.
- Browser-local storage holds display preferences, play history, and some provider caches.
- Core has no authentication and no TLS; use it only on a trusted LAN.
- Credential files are 0600, but the encoding is not encryption; protect backups.
- Atom does not delete music files; cleanup covers cache, temp files, and incomplete downloads.
- Uninstalling/deleting `data/` loses the library index, settings, playlists, stats, and login state.

## 21. Keyboard and mobile

### 21.1 Keyboard

The current version has **no global playback shortcuts**. Available keyboard interactions are mainly:

- header search dialog: up/down to move, Enter to run;
- inputs: Enter to submit, Esc to cancel;
- checkboxes/radios: Space or Enter to toggle;
- number inputs: Enter to confirm, Esc to cancel.

### 21.2 Mobile

- phones use drawer navigation and a fixed bottom player;
- the full-screen player shows the cover first; tap to switch to lyrics;
- volume becomes a click-to-expand panel;
- settings use a full-screen two-view layout;
- safe areas and dynamic viewport height are supported;
- landscape/large screens are recommended for the full layout.

## 22. Glossary

| Term | Meaning |
| --- | --- |
| Core | The background service on the music host |
| Web Control | The browser control interface |
| Output device | ALSA sound card, Diretta Target, or UPnP Renderer |
| Processed | ALSA output that permits EQ/loudness/speed |
| Direct | Strict output that preserves valid bits |
| Source Direct | Does not alter sample values/bit depth/channels/DSD sequence |
| Gapless | Adjacent tracks join without a gap |
| CUE | Whole-image file plus a track index |
| SACD ISO | SACD image expanded into stereo tracks |
| Preload | Resolve/prepare the next track early |
| Heart mode | Recommendation queue seeded by a track |
| Personal FM | NetEase personalized radio |
| outbox | ListenBrainz pending submission queue |

## 23. Related documents

- [Project Book](./01-project.md)
- [Operations Manual](./03-operations.md)
- [API Reference](./05-api.md)
- [User Guide (existing)](../guide.md)
- [Streaming Services](../streaming.md)
- [Using Plugins](../plugins-usage.md)
