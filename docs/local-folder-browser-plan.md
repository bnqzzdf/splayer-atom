# Local Folder Browser Plan

## 1. Purpose

SPlayer Atom's Folder view exists only for **audio browsing and playback**. It is not a general
file manager and will not grow file-management operations such as rename, move, copy, arbitrary
directory deletion, or unrestricted host-filesystem browsing.

The current Folder view is a Web-side projection of the scanned library:

```text
all library Tracks
  -> buildFolderTree()
  -> FolderNode tree
  -> every node retains all descendant Tracks
  -> STree flattening/rendering
```

That model has three concrete problems:

1. A newly configured music directory does not become useful in Folder view until the library scan
   completes, even though the files already exist on the Core host.
2. The fixed tree column gives long directory names too little space.
3. Large libraries pay the cost of building and maintaining a complete tree even though the user
   only interacts with one directory at a time.

The replacement is a **Core-owned local folder browser**. The filesystem determines what can be
browsed immediately; the library database enriches those entries with canonical metadata as it
becomes available.

This is one complete replacement, not a staged product mode. Implementation may use multiple
atomic commits for review and rollback, but the old tree model is removed when this work lands.

## 2. Product boundary

### In scope

- Browse configured local-library roots and their descendants.
- Navigate one directory level at a time with breadcrumb, browser back/forward, refresh, and stable
  route state.
- Pin frequently used folders to the Folder home without changing their filesystem location.
- Search configured Folder roots by physical directory/file name independently from metadata search.
- Filter the **current directory only** without recursively searching descendants.
- Display supported audio files immediately, including files that have not been scanned yet.
- Use canonical scanned metadata when it exists and refresh the current view as scanning enriches
  the library.
- Scan or force-rescan the current folder recursively when the user explicitly wants its content
  indexed and metadata-enriched without scanning every configured root.
- Play one file, one CUE/SACD virtual track, one container, or a directory recursively.
- Offer explicit current-folder-only playback/queue actions alongside the default recursive folder
  actions.
- Add files, containers, or directories to the queue / play next.
- Create a local playlist from files, containers, or directories.
- Open the containing Folder Browser location for a local Track and focus the exact ordinary,
  CUE, or SACD entry.
- Expand CUE and SACD containers on demand before a full-library scan has indexed them.
- Show read-only supplementary album materials that live beside the music, including artwork,
  booklets, rip logs, release notes, and similar supported text documents.
- Handle multiple roots, temporarily unavailable roots, symlinks, long names, very large
  directories, and deterministic recursive ordering.
- Offer both list and cover/grid presentation for the same route-driven Folder model without
  reintroducing a tree hierarchy.

### Permanently out of scope for Folder view

- Renaming, moving, copying, or arbitrary deletion of files or directories.
- Creating directories.
- Editing, renaming, moving, copying, or deleting supplementary materials.
- Browsing arbitrary Core-host paths that are not reachable through a configured library root.
- Becoming a Linux file explorer.

Existing music-domain operations elsewhere in Atom, such as tag editing or deleting an individual
library track, are not broadened by this work.

## 3. Ownership model

Core owns:

- configured library roots and path authorization;
- filesystem enumeration;
- supported-media classification;
- association between physical files and canonical library Tracks;
- CUE/SACD resolution;
- supplementary-material classification, authorization, thumbnail/content serving, and text
  decoding;
- recursive folder ordering;
- pinned-folder persistence and validation;
- Folder hierarchy search;
- queue construction and playback commands;
- canonicalization required by durable playlist operations;
- scoped scan validation and execution;
- local-Track-to-Folder-location resolution;
- library-content revision events.

Web owns only presentation and navigation state. It requests one directory at a time and sends
high-level actions such as “play this directory” or “add this container to the queue”. Web does not
walk directories, parse CUE/SACD, construct recursive queues, or rebuild a global folder tree.
Per-client transient presentation state such as scroll position and an open booklet's page/zoom
remains Web-owned. Current-directory filter text and list/grid presentation choice are also
Web-owned presentation state; they never become Core music-domain state.

## 4. Browse semantics

The Folder page starts with the configured `library.scanDirs`. Each root is identified by its
canonical configured path and displayed using its basename plus the full path when disambiguation is
needed.

Opening a root or directory returns only its direct children:

```text
Folder
  breadcrumb
  direct child directories
  direct playable media / media containers
  direct supplementary materials
```

No full-tree projection is created. A normal browse operation must not recursively walk the root.

The route stores the current folder path so browser back/forward and page refresh return to the same
location. The server validates the path on every request; route state is never authorization.

### Folder home and pinned folders

Folder home shows configured library roots plus an optional **Pinned folders** section. Pinning is a
navigation shortcut only: it does not copy/move media, create another scan root, or change library
ownership.

- Any reachable directory under a configured library root can be pinned/unpinned.
- Pin records are persisted by Core because Atom has one Core state shared by multiple Web Controls.
- Core stores canonical root-relative identity/path information and revalidates it when read; a
  missing/offline target remains a visible unavailable pin rather than being silently discarded.
- Duplicate pins resolve to one entry; roots themselves may also be pinned if useful.
- Pin/unpin is available from the Folder directory action menu and the Folder header.
- The UI should name this concept “Pinned folders” / “固定的文件夹” rather than reusing music
  Favorites terminology.

Pinned folders are not a new hierarchy. Selecting one navigates to the normal route-driven Folder
view and uses the same browse, authorization, scan, playback, and material behavior.

### Folder hierarchy search

Folder Browser has its own physical-name search. It is intentionally separate from global Library
Search:

- Library Search searches canonical metadata such as title, album, and artist.
- Folder Search searches directory names and supported media/material filenames under configured
  roots.

Search is Core-owned so Web never recursively walks roots. Results contain enough path context to
disambiguate duplicate names and navigate directly to the containing Folder location. Search does
not probe media metadata and does not require the files to have been scanned into the library.

Folder Search must be bounded and cancellable. It should stream/page results or otherwise enforce a
result limit so a broad query over a very large library cannot create an unbounded response. It
follows the same unavailable-root and symlink/path authorization rules as normal Folder browsing.

### Current-directory filter

Folder Search and Folder Filter solve different user problems and must remain visibly distinct:

```text
Folder Filter
  "I am already in the correct directory; reduce what I see here."

Folder Search
  "I do not know where the folder/file is; search configured roots recursively."
```

The current-directory filter:

- matches **direct children of the current directory only**;
- never traverses a child directory;
- applies to direct child directory names, physical media/container filenames, supplementary
  material filenames, and canonical display fields already available for direct Tracks where
  practical;
- clears immediately back to the unfiltered current directory;
- does not change the Folder route or create a separate search-results page;
- is restored with the current history/session navigation state when the user enters a child and
  comes back.

The filter cannot be implemented as a Web-only filter over currently loaded rows because normal
browse is paginated. If a 12,000-item directory has a matching entry outside the current page, Web
must still return the correct result. Core therefore applies the current-directory filter before
pagination:

```text
browse(path, filter?, cursor?, limit?, focus?)
```

The filter scope is still one physical directory, so it must not inherit the recursive traversal
cost of Folder Search.

### UI layout

- Remove the fixed desktop tree column and the mobile tree drawer.
- Use the main content width for directory and media rows.
- The breadcrumb is the authoritative current-location display. Do not repeat the current folder
  name plus full physical path as a second permanent header block.
- Long current-directory names may wrap to two lines; they must not be truncated merely because of
  a narrow navigation column.
- Breadcrumb may collapse middle ancestors when space is limited, while keeping the current
  directory visible.
- Directories appear before media entries and use natural name ordering.
- The page shows useful current-directory counts rather than computing a global recursive folder
  count.
- Supplementary materials are grouped separately from playable media so documents and artwork do
  not become fake Tracks or interfere with playback ordering.
- Empty, unavailable, loading, scan-enrichment, and container-error states are explicit.
- Navigating into a child directory and then back restores the previous directory's scroll position
  instead of jumping to the top.
- Entering a normal directory shows a lightweight current-directory filter control. Folder home
  keeps the recursive Folder Search entry instead.

The primary Folder header should be intentionally small:

```text
Folder > root > ... > current

[ Play all ] [ Scan ] [...]                    [ Filter current folder... ] [ List/Grid ]
```

The full physical path remains available through breadcrumb title/tooltip or other secondary
diagnostic affordance, but is not permanently repeated under the breadcrumb.

`Scan` means recursive incremental scan of the current subtree. Force-rescan remains a lower
frequency action under the overflow menu rather than occupying another primary button.

### List and cover/grid presentation

List remains the default and most information-dense mode. It is preferred for long filenames,
classical-music structures, CUE/SACD, and directories with many direct media files.

Folder Browser also provides a cover/grid mode for album-like child directories:

- the route and Core browse semantics do not change;
- the grid primarily changes the **direct child directory** presentation;
- direct Tracks/containers may remain in the normal compact list even while child directories use
  a grid;
- child directory artwork prefers a suitable local cover/front/folder image, then a reliable
  canonical album cover association, then a normal Folder placeholder;
- supplementary materials retain their dedicated material presentation;
- switching list/grid never creates a second hierarchy or reintroduces a tree view.

The presentation choice is Web UI state. It may be remembered per Web Control, but it is not
persisted as canonical Core library state.

The mixed directory/media view should use a dedicated Folder Browser list rather than forcing
unscanned filesystem entries into the existing `SongList` contract.

Folder scroll restoration belongs to Web navigation history/session state, not Core persistence.
Likewise, an image/PDF/text viewer may remember its current image, PDF page/zoom, or text scroll
position for the current Web session. These viewer positions are convenience state only and do not
become library metadata.

## 5. Filesystem visibility and scan enrichment

Adding a library root makes it browsable immediately. A full or incremental scan is not a
prerequisite for Folder view.

For each direct media file Core attempts to associate the physical file with an existing canonical
Track:

- If a canonical Track exists, browse output includes that Track and Web renders its title, artist,
  album, cover, quality, duration, and existing track actions.
- If it has not been scanned, browse output contains a lightweight filesystem entry: path, filename,
  extension, size, and mtime. Browsing does **not** probe all such files just to fill metadata.

When an unscanned ordinary file is played, Core may create a transient local playback Track and let
the existing playback load/probe path enrich the active queue item. This does not create a second
library authority.

Scanner batch writes remain the canonical library-indexing path. As scan batches, tag changes, file
deletions, targeted canonicalization, and similar library mutations commit, Core publishes a small
library-content revision/change event. An open Folder page refreshes only its current directory when
that revision changes; it does not refetch and rebuild the complete local library.

### Scan this folder

Because Folder Browser can play unscanned media, it also needs an explicit way to promote the
current directory into fully indexed library content. The Folder page therefore provides:

- **Scan this folder**: recursively scan the current directory and all descendants using incremental
  rules, so unchanged indexed files are skipped.
- **Rescan this folder**: recursively force metadata re-read for the current directory and all
  descendants.

These are library-indexing actions, not prerequisites for playback. Their purpose is to populate or
refresh canonical metadata, covers, Album/Artist/Search projections, CUE virtual tracks, and SACD
virtual tracks for the selected subtree.

Scoped scanning must reuse the existing scanner authority, progress model, batch upsert path, CUE /
SACD handling, and library revision events. It must **not** introduce a second scanner or a parallel
scan scheduler. While any global or scoped scan is active, another scan request is not started; the
Folder UI shows the active scan state instead.

The scan scope is part of correctness, not just performance. Incremental records, stale-file
comparison, removal detection, CUE synchronization, and SACD synchronization must all be restricted
to the selected subtree. A scoped scan of `/music/A` must never infer that tracks under
`/music/B` were deleted merely because they were outside the traversal. The same unavailable-path
safety used by full scans applies inside the scoped subtree.

The current Folder page should show scoped progress when the active scan covers that directory. A
completed scan refreshes the current directory through the normal library revision mechanism rather
than a separate Folder-only refresh path.

## 6. Physical-source identity

Folder browsing needs one shared definition of the physical local source:

```text
ordinary local Track -> track.path
CUE virtual Track    -> track.cuePath / track.cueAudioPath as appropriate
SACD virtual Track   -> physical ISO path derived from the virtual path
```

The existing SACD virtual-path parsing is currently repeated in several Core modules. This work
must centralize the physical-source mapping in one Core helper and reuse it from scanner, folder
browsing, local-album identity, and other existing consumers that currently duplicate the rule.

The folder service should not call `getAllTracks()` and filter the complete library on every browse.
After `readdir` identifies the direct physical files, the database layer should resolve canonical
Tracks for those physical paths in bounded batches. This keeps the cost proportional to the current
directory without adding a new derived filesystem index to the database unless measurements prove
one is necessary.

## 7. Supported media and containers

Folder Browser and scanner must share one supported-media definition so a file cannot be visible to
one path but silently unsupported by the other.

### Ordinary audio

Supported ordinary audio files are immediately visible and playable before scanning. Playback uses
the existing Core local-source path and media probing.

### CUE

CUE is treated as a media container, not as a generic text file.

- If canonical CUE virtual Tracks already exist, use them.
- If they do not exist, opening or playing the CUE performs targeted Core-side CUE resolution using
  the existing parser and the referenced audio duration.
- A successfully resolved CUE hides its backing whole-file audio entry from the same folder to
  prevent duplicate playback.
- If CUE resolution fails, the backing audio must remain visible/playable; a malformed CUE must not
  make otherwise valid audio disappear.
- Container playback and recursive folder playback enqueue the virtual CUE Tracks in cue order.

### SACD ISO

SACD ISO is also a media container.

- If canonical SACD virtual Tracks already exist, use them.
- Otherwise opening or playing the ISO calls the existing Core/native SACD probe on demand.
- Successful resolution exposes virtual tracks in disc order.
- The physical ISO is not also enqueued once virtual tracks have been resolved.
- A probe failure leaves the ISO visible as an unavailable/error container and does not mutate or
  delete any existing canonical SACD Tracks.

On-demand CUE/SACD resolution for browsing/playback may remain transient. Operations that require
durable Track identity use the canonicalization rule below.

## 8. Supplementary album materials

Folder Browser should represent the physical music collection, not only playable audio. Artwork,
booklets, rip logs, checksum/release notes, and similar files often contain important information
for classical releases, box sets, SACD rips, and carefully archived CD rips.

These files are exposed as **read-only supplementary materials**. Supporting them does not widen the
Folder feature into file management.

### Supported material classes

The complete contract recognizes a deliberately small, explicit allowlist:

```text
image
  jpg / jpeg / png / webp / gif

document
  pdf

text
  txt / log / nfo / md
```

`cue` is never treated as text material; it remains a music container. Audio/SACD files likewise
remain media entries. Executables, archives, Office documents, arbitrary binary files, SVG, HTML,
and scripts are not exposed by Folder Browser.

The allowlist is a product/security boundary rather than a generic MIME browser. Adding another
material type requires an explicit safe viewing use case.

### Directory scope and grouping

Materials are discovered from the **current directory only**. Normal navigation does not recurse
through descendants to collect artwork or documents. This keeps the meaning local to the album or
disc being viewed and prevents a box-set root from loading hundreds of child-directory scans.

The UI groups materials separately from directories and playable media:

```text
Folder actions

Subfolders
  ...

Tracks / containers
  ...

Supplementary materials
  Cover.jpg
  Back.jpg
  Booklet.pdf
  EAC.log
  Release Notes.txt
```

Image materials may use a thumbnail grid/strip; PDF and text materials use compact document rows.
The exact responsive presentation can vary, but material rows never participate in Track sorting,
queue construction, playlist creation, or recursive playback.

### Images

- Folder listing returns only material metadata and a bounded thumbnail URL/reference.
- Thumbnails use an appropriately sized cached/derived image; the Folder page must not eagerly load
  original multi-megapixel scans.
- Opening an image loads the original only on demand in a read-only viewer.
- The viewer may move between the supported images in the current directory without rescanning or
  recursively collecting images from child directories.
- Animated GIF may be displayed by the browser, but Folder Browser does not add editing,
  transformation, or animation controls.

### PDF

- PDF is exposed as a read-only booklet/document.
- Content delivery supports byte ranges/streaming so opening a large scanned booklet does not read
  the whole file into Core memory or require one giant Web response.
- Prefer the browser's safe PDF rendering capability or an equivalently isolated read-only viewer;
  Atom does not parse PDF content into library metadata.

### Text materials

`txt`, `log`, `nfo`, and `md` are displayed as **plain text** in a read-only monospace viewer. `md`
is not rendered as trusted HTML and text content never executes markup or scripts.

Core performs bounded best-effort decoding rather than blindly calling UTF-8 on every file:

1. honor an explicit UTF BOM when present;
2. accept valid UTF-8;
3. use a small, deterministic legacy-text fallback suitable for common rip logs / release notes;
4. if decoding remains unreliable, report an unsupported/undecodable-text state rather than
   returning corrupt or executable content.

The concrete decoder can reuse existing project dependencies or a small dedicated decoder, but the
policy remains Core-owned and deterministic.

Text viewing must have an explicit size limit for eager reads. Oversized text/log files still appear
as materials with their size, but are opened through bounded/ranged reads (or an explicit
too-large-to-preview state) rather than loading an unbounded file into Core/Web memory.

### Authorization and content serving

Folder materials must not reuse or introduce an unrestricted endpoint such as
`/filesystem/file?path=/anything`.

For every thumbnail or material-content request Core revalidates that:

- the logical path belongs to a configured library root;
- symlink resolution follows the same allowed-root policy as Folder navigation;
- the requested file still exists and is a regular supported material;
- the material class/extension and served content type match the allowlist;
- range and size limits are enforced.

Material URLs/references are therefore Folder-domain capabilities, not general host-file access.
Deleting or editing a material from the viewer is permanently out of scope.

Materials do not need library scanning or database indexing to appear. They are live filesystem
content and become visible after a normal Folder refresh. Existing scanner cover discovery may still
use image files as it does today, but Folder material browsing must not create a second material
index in the library database.

## 9. Playback and queue operations

### Unified action terminology

Track, Folder, Album, Playlist, Queue, and other multi-Track surfaces should use one consistent
language:

```text
Play
  replace the active queue and start playback

Play next / 下一首播放
  DO NOT use this wording in product UI

Play next group / 接下来播放
  insert one Track or an ordered group immediately after the current playback position

Add to queue
  append one Track or an ordered group to the end of the current queue

Add to playlist...
  add durable Tracks to an existing local playlist, with "create playlist" available inside that
  chooser rather than replacing the add-to-existing action
```

Chinese product copy should use **播放 / 接下来播放 / 添加到队列 / 添加到歌单…**. “下一首播放” is
too narrow for Folder/Album/Playlist operations because the inserted object may contain many
Tracks. Internal route/function names such as `play-next` may remain implementation details; the
user-facing action is “接下来播放”.

Queue and Playlist are separate concepts: queue actions alter the transient playback sequence;
playlist actions alter durable playlist membership. Folder UI must not use “新建歌单” as a substitute
for “添加到歌单…”.

Folder-level actions are Core commands. Web never expands a directory into a Track array itself.

Required actions:

- Play now / replace queue from a file, container, or directory; directory actions are recursive by
  default.
- Play next group / **接下来播放** from a file, container, or directory; directory actions are
  recursive by default.
- Add to queue from a file, container, or directory; directory actions are recursive by default.
- Shuffle-play a directory using the existing player shuffle semantics rather than a second Folder
  shuffle state.
- Secondary directory actions provide **current folder only** variants for Play / Play Next / Add
  to Queue / Playlist creation. These use the same Core implementation with `recursive: false`
  rather than a second playback path.

Recursive remains the primary/default behavior because common music layouts place playable content
under child directories such as `CD1` / `CD2`. The current-folder-only variants are explicit
secondary actions, not a hidden global preference.

The Folder overflow menu should expose the common recursive actions directly and move the
less-common non-recursive variants under one submenu:

```text
Shuffle
Play next / 接下来播放
Add to queue
Add to playlist...
----------------
Current folder only >
  Play
  Play next / 接下来播放
  Add to queue
  Add to playlist...
----------------
Rescan
Pin to Folder home / Unpin
```

`Play all` and incremental `Scan` already exist as primary buttons and should not be redundantly
repeated in the same overflow menu.

Directory actions recursively enumerate supported media only when the user requests the action.
They must:

- follow the same path-authorization and symlink rules as browsing;
- resolve CUE/SACD containers without adding their backing physical files twice;
- reuse canonical Tracks when available;
- create transient local playback Tracks for unscanned ordinary files;
- skip unsupported non-audio files;
- surface real access/parse failures without silently treating an unreadable root as an empty one.

### Deterministic recursive order

Recursive folder playback has one deterministic order:

1. directories use natural name ordering;
2. traversal is depth-first in that directory order;
3. within a directory, canonical tracks prefer disc / track / CUE position metadata;
4. entries without canonical ordering metadata fall back to natural filename order;
5. virtual CUE/SACD tracks retain their container track order.

The same ordering helper is used by Play, Play next group, Add to Queue, and Add to Playlist so the
same folder never produces different sequences depending on the action.

With `recursive: false`, the same ordering rules apply to playable entries directly in the selected
directory, while child directories are not traversed.

## 10. Durable playlist operations

A local playlist requires durable canonical Track identity. Therefore “create playlist from
folder/container/files” performs targeted canonicalization for entries that are not yet indexed:

```text
already canonical
  -> reuse Track

unscanned ordinary audio
  -> probe metadata
  -> upsert canonical Track

unscanned CUE / SACD
  -> resolve virtual tracks
  -> upsert canonical Tracks

then
  -> write playlist membership
```

This avoids inventing a second playlist representation containing raw filesystem paths. Targeted
canonicalization also emits the normal library-content revision so Album/Artist/Folder projections
can refresh consistently.

The normal Folder Track/container/folder action is **Add to playlist...**, not “Create playlist”.
The chooser lists existing local playlists and offers “Create playlist” as an option inside that
flow. Creating a playlist remains available, but it is not the only durable-playlist action.

## 11. Open containing folder

“Open containing folder” is a general local-Track action, not a playlist-only feature. It should be
available through one shared local Track action model whenever Core can resolve the Track to a
configured Folder Browser root.

Web must not derive CUE/SACD filesystem identity itself. Core resolves a local Track to a Folder
navigation target containing the information needed to restore context:

```text
ordinary Track
  -> containing directory
  -> focus the file/Track row

CUE virtual Track
  -> directory containing the CUE
  -> open/focus the CUE container
  -> focus the exact virtual Track

SACD virtual Track
  -> directory containing the ISO
  -> open/focus the SACD container
  -> focus the exact virtual Track
```

Navigation should scroll the resolved entry into view and apply a brief focus highlight; merely
opening a directory with no indication of the originating Track is insufficient for large folders.
Container and focus state are represented in the Folder route so browser refresh/back/forward keep
the useful context where practical.

If the configured NAS/USB root is currently unavailable, the action still navigates to its Folder
location and shows the normal unavailable-root state. It must not silently fall back to an
unrestricted filesystem browser.

### Track-action surface coverage

The action must not depend on which page happens to implement its own menu. At minimum, resolvable
local Tracks expose “Open containing folder” from:

- the bottom PlayerBar current-track menu;
- Full Player current-track actions;
- QueuePopover rows;
- Full Player QueuePanel rows;
- local Playlist SongList rows;
- local Album SongList rows;
- Artist local-Track rows;
- local favorites/collections;
- History rows for local Tracks.

Queue/Playlist-specific operations such as “Remove from queue” or “Remove from playlist” are
contextual additions to the shared Track action model, not reasons to maintain a second independent
common-action menu.

The user-facing invariant is:

```text
see a resolvable local Track
  -> open its Track menu
  -> "Open containing folder" is available
```

Folder itself may omit this action for the row already being displayed in its own containing
location.

## 12. Multiple roots, offline storage, and symlinks

Each configured scan directory is an independent browse root. Roots with the same basename remain
distinct by full path.

A configured root that is temporarily unavailable remains visible as **unavailable**. Browsing or a
folder action must not interpret temporary I/O failure as an empty library and must never delete
canonical Tracks. This follows the scanner's existing `unavailableDirs` safety rule.

Folder Browser must align with scanner's current follow-links behavior:

- navigation begins only from a configured root;
- requested logical paths are normalized and must remain lexically under that configured root;
- `..` or direct requests for unrelated host paths are rejected;
- a symlink reachable through the configured root may be followed, matching scanner traversal;
- navigation keeps the root-relative logical path rather than exposing the symlink target as a new
  unrestricted browse root;
- symlink cycles are detected/limited during recursive actions.

## 13. Core contracts

Exact route names may follow existing Control conventions, but the domain contract should provide
the equivalent of:

```text
GET  /library/folders/roots
GET  /library/folders/browse?path=...&filter=...&cursor=...&limit=...
GET  /library/folders/container?path=...
GET  /library/folders/material?path=...
GET  /library/folders/search?q=...&cursor=...&limit=...
GET  /library/folders/pins

POST /library/folders/scan
POST /library/folders/location
POST /library/folders/play
POST /library/folders/play-next
POST /library/folders/queue
POST /library/folders/playlist
POST /library/folders/pins
DELETE /library/folders/pins
```

`scan` represents both incremental scoped scan and explicit scoped rescan through an explicit mode;
it uses the single existing scanner state machine. `location` represents a Core-resolved Folder
navigation target for a local Track and must hide CUE/SACD physical-path parsing from Web.
`material` represents a validated Folder-domain read of one supported supplementary material; the
implementation may use a separate thumbnail/content route or reference form where that fits the
existing asset-serving architecture better.

`browse` is paginated/cursor-based from the start. Its optional `filter` is applied to the current
directory's direct children **before** pagination and never descends into child directories. A
directory containing thousands of direct entries must not require one giant JSON response even
though Web also virtualizes rendering. The cursor belongs to the current directory snapshot/order
and responses include enough information for Web to know whether more entries are available.
Directory/media/material grouping and deterministic ordering must remain stable across pages.

`search` performs bounded physical directory/file-name search across configured roots without
turning the database library search into a filesystem search. `pins` stores only validated Folder
navigation shortcuts.

Shared protocol types belong under `shared/types/`. A browse result should distinguish at least:

```ts
type FolderBrowseEntry =
  | { kind: "directory"; name: string; path: string }
  | { kind: "track"; path: string; track: Track }
  | { kind: "file"; name: string; path: string; size: number; mtime: number }
  | { kind: "cue"; name: string; path: string; trackCount?: number }
  | { kind: "sacd"; name: string; path: string; trackCount?: number }
  | {
      kind: "material";
      materialType: "image" | "pdf" | "text";
      name: string;
      path: string;
      size: number;
      mtime: number;
    };
```

The real type can carry the additional presentation/status fields required by the implementation,
but it must not expose a recursively materialized tree.

## 14. Web implementation

`Folders.vue` becomes a route-driven current-directory view.

It should:

- load roots or one current directory through the Folder Browser client;
- keep path/container state in the route;
- show Core-persisted pinned folders on Folder home and support pin/unpin actions;
- provide recursive Folder name/path search on Folder home / its dedicated entry;
- provide an independent current-directory filter that does not recurse and is applied before
  pagination;
- render direct directories and mixed media entries;
- support list/grid presentation of the same current-directory data without changing Core
  hierarchy semantics;
- render current-directory supplementary materials in a separate read-only section and open them in
  bounded image/PDF/text viewers;
- refresh the current view on the Core library-content revision event;
- expose recursive incremental scan and force-rescan for the current directory without creating a
  second scan state;
- consume Core-resolved “open containing folder” targets and restore container/focus state;
- load additional browse/search pages on demand while preserving stable ordering;
- restore per-history-entry Folder scroll position when navigating back/forward;
- retain image/PDF/text viewer position (including PDF page/zoom) for the current Web session where
  practical;
- delegate all recursive/media-resolution actions to Core;
- preserve existing player/queue feedback patterns.

The shared local Track menu should expose the unified common actions:

```text
Play
Play next / 接下来播放
Add to queue
Add to playlist...
Open containing folder     (resolvable local Track only)
```

SongList, PlayerBar, Full Player, QueuePopover, QueuePanel, local playlists/albums/artists,
collections, and History should consume this shared Track action model instead of independently
reimplementing the common subset. Non-local Tracks do not show “Open containing folder”.

The following current tree projection is removed once the replacement is complete:

- `src/utils/folderTree.ts`;
- `src/types/folder.ts`;
- `libraryStore.folderTree`;
- `libraryStore.folderCount`;
- Folder-page `expanded`, recursive `findFolder`, and `STree` usage.

If `STree.vue` has no other real consumer after this work, remove it as dead code rather than
keeping an unused compatibility component.

## 15. Failure behavior

The implementation must distinguish:

- empty directory;
- unavailable directory/root;
- unauthorized/out-of-root path;
- file disappeared between browse and play;
- unsupported media;
- malformed CUE;
- SACD probe failure;
- scoped scan rejected because another scan is already active;
- local Track no longer resolves under a configured Folder root;
- pinned folder target no longer exists or its root is unavailable;
- Folder search is cancelled, times out, or encounters an unavailable root;
- current-directory filter returns no direct matches;
- browse/search cursor becomes stale after filesystem mutation;
- material disappeared after listing;
- material type/content no longer matches the supported allowlist;
- text material cannot be decoded safely;
- material preview exceeds its configured eager-read limit;
- canonicalization/database failure.

Failures from one entry must not corrupt the library or cause unrelated entries to disappear.
Recursive queue/playlist actions report skipped/failed entries explicitly when partial progress is
allowed; operations that must be atomic, such as durable playlist membership commit, must not leave
an internally inconsistent playlist.

## 16. Performance requirements

Normal browsing cost is proportional to the **current directory**, not the complete library.

Specifically:

- no `buildFolderTree(allTracks)` equivalent;
- no global recursive directory walk on page load or normal navigation;
- direct-directory browse responses are paginated/cursor-based; virtualization is not treated as a
  substitute for transport pagination;
- current-directory filter is applied Core-side before pagination and remains proportional to the
  current directory rather than recursively traversing descendants;
- Folder Search is bounded/cancellable and never materializes the complete hierarchy in Web;
- no eager metadata probe of every unscanned file in the current directory;
- no eager original-image/PDF/text-content load during directory listing;
- material discovery is current-directory-only and does not recursively collect descendant
  materials;
- image list rendering uses bounded thumbnails; original images, PDF pages, and text content load
  only when opened;
- large PDF/text content uses range/bounded reads rather than unbounded Core memory buffers;
- no descendant Track arrays stored on every ancestor folder;
- direct-directory lists remain virtualized for unusually large single directories;
- recursive filesystem traversal occurs only for explicit recursive user actions or the scanner;
- database association uses bounded queries/batches against the direct physical entries.

The implementation should be validated with both the current ~20k-track scale and synthetic
large-directory cases so performance claims are measured rather than inferred from DOM
virtualization alone.

## 17. Acceptance criteria

The replacement is complete only when all of the following pass:

1. Adding a valid library root makes it visible and navigable immediately without waiting for a
   scan.
2. Unscanned ordinary audio can be played, inserted as “接下来播放”, and queued.
3. “Scan this folder” incrementally scans only the current subtree, recursively, and enriches the
   open Folder view without scanning unrelated configured roots.
4. “Rescan this folder” forces metadata refresh only for the current subtree.
5. Scoped scan deletion/removal detection cannot delete or invalidate Tracks outside its subtree,
   and scoped/global scans continue to share one scanner state machine.
6. Scan progress enriches an open folder view without waiting for the complete scan and without
   rebuilding the entire local library in Web.
7. Scanned and unscanned entries do not duplicate the same physical audio.
8. CUE can be opened and played before a full scan; valid CUE hides the backing whole-file duplicate,
   while malformed CUE does not hide otherwise playable audio.
9. SACD ISO can be opened and played before a full scan and uses the same virtual-track semantics as
   the canonical scanner result.
10. Recursive Play / 接下来播放 / Queue / Playlist produce the same deterministic ordering and do
    not duplicate CUE/SACD backing files.
11. Creating a playlist from unscanned content canonicalizes the required Tracks and persists valid
    playlist membership.
12. “Open containing folder” is available as a shared action for resolvable local Tracks rather than
    only inside playlists.
13. Opening the containing folder focuses the exact ordinary Track; CUE/SACD virtual Tracks navigate
    through their physical container and focus the exact virtual Track without Web parsing virtual
    paths.
14. Browser refresh/back/forward preserves useful folder/container/focus context after an
    “Open containing folder” navigation.
15. Multiple configured roots with duplicate basenames remain distinguishable.
16. Temporarily unavailable NAS/USB roots show an unavailable state and never cause library
    deletion.
17. “Open containing folder” for a Track on an unavailable configured root reaches that unavailable
    Folder location instead of exposing an unrestricted host path.
18. Symlink navigation matches scanner reachability, rejects path escape, and recursive actions
    cannot loop indefinitely.
19. Browser back/forward and page refresh preserve the current directory/container location.
20. Frequently used directories can be pinned/unpinned, appear on Folder home across Web Controls,
    and still navigate through the normal authorized Folder route; unavailable pins remain visible
    as unavailable rather than being silently deleted.
21. Folder Search finds matching physical directory/supported filenames without requiring library
    indexing, disambiguates duplicate names by path, and does not become a metadata-search alias.
22. Recursive Folder Play / 接下来播放 / Queue / Playlist remain the primary actions, while explicit
    current-folder-only variants use the same Core action path with child traversal disabled.
23. Returning from a child folder restores the previous directory scroll position; current-session
    image/PDF/text viewer state can restore useful position such as PDF page/zoom without becoming
    Core library metadata.
24. A single directory with thousands of direct entries is transported in bounded browse pages and
    remains usable with Web virtualization; Folder Search results are likewise bounded/pageable.
25. Supported image, PDF, and text materials in the current directory appear without a library
    scan and remain separate from playable Track/container ordering.
26. Image lists use thumbnails and load full-resolution scans only on demand.
27. PDF viewing supports bounded/range delivery and does not require loading the entire PDF into
    Core memory before viewing.
28. `txt` / `log` / `nfo` / `md` materials are shown as non-executable plain text with deterministic
    best-effort decoding; oversized text cannot create an unbounded read.
29. Unsupported/binary files remain hidden from Folder Browser, and material endpoints cannot read
    a file outside configured library roots.
30. Recursive Play / Queue / Playlist ignore supplementary materials completely.
31. Long directory names are readable without the old fixed-width tree limitation.
32. A large library no longer constructs or stores a complete Web-side folder tree.
33. Existing local playback, queue authority, scanner deletion safety, CUE playback boundaries,
    SACD playback, Albums/Artists, and playlist persistence continue to pass their relevant tests.
34. The old Folder tree projection and any now-unused tree-only code are removed rather than kept as
    a fallback implementation.
35. Product UI consistently uses 播放 / 接下来播放 / 添加到队列 / 添加到歌单… for Track and
    multi-Track operations; “下一首播放” is not used for group insertion.
36. Folder Track rows offer “添加到歌单…” for existing playlists, with playlist creation available
    inside that flow rather than as the only playlist action; raw translation keys such as
    `common.play` never appear in the rendered menu.
37. The normal Folder header does not repeat the current folder name/full path beneath the
    breadcrumb; its primary actions remain limited to Play all, incremental Scan, overflow, current
    filter, and presentation switch.
38. The Folder overflow menu exposes common recursive actions directly and groups all
    non-recursive variants under one “Current folder only” submenu instead of repeating four long
    top-level labels.
39. Current-directory Filter matches only direct children, never descends into subdirectories, and
    returns correct results even when matching entries fall outside the currently loaded browse
    page.
40. Folder Filter and recursive Folder Search remain separate interactions: filtering does not
    replace the route with a search-results view, while search may return descendants across
    configured roots.
41. Returning from a child folder restores the parent folder's filter and useful scroll position.
42. Folder supports both list and cover/grid presentation without reintroducing a tree; switching
    presentation does not alter route, ordering, queue semantics, or canonical library state.
43. “Open containing folder” is available from the shared local Track action model in PlayerBar,
    Full Player, QueuePopover, QueuePanel, local SongList/Playlist/Album/Artist, collections, and
    History where the Track is resolvable.
44. Context-specific Track actions such as queue/playlist removal are additions to the shared
    common Track actions, not independent replacements that hide “Open containing folder”.

## 18. Verification

At minimum, implementation should add proportional automated coverage for:

- root/path authorization and symlink handling;
- current-directory enumeration and canonical Track association;
- ordinary unscanned playback resolution;
- CUE/SACD on-demand resolution and duplicate suppression;
- scoped incremental scan / force-rescan boundaries and deletion safety;
- deterministic recursive ordering;
- unavailable-root behavior;
- targeted canonicalization and playlist persistence;
- local Track containing-folder resolution, including CUE/SACD focus targets;
- pinned-folder persistence, unavailable-target behavior, and cross-Web-Control visibility;
- bounded Folder hierarchy search and duplicate-name path disambiguation;
- Core-side current-directory filtering before pagination, including matches beyond the first page;
- proof that Folder Filter never descends into child directories and remains separate from
  recursive Folder Search;
- recursive versus current-folder-only actions using one Core action implementation;
- paginated/cursor browse stability across large direct directories;
- Folder scroll restoration and session-only material-viewer position restoration;
- current-directory filter restoration when navigating into a child folder and back;
- list/grid presentation equivalence for navigation and actions;
- shared Track-action coverage across PlayerBar, Full Player, QueuePopover, QueuePanel, SongList,
  local Playlist/Album/Artist, collections, and History;
- unified “接下来播放” queue insertion semantics for one-Track and multi-Track objects;
- add-to-existing-playlist flow from Folder Track/container/folder actions;
- supplementary-material allowlist and root authorization;
- image thumbnail/original lazy loading;
- PDF range/bounded serving;
- text decoding, escaping/plain-text rendering, and oversized-log handling;
- proof that materials never enter queue/playlist recursive ordering;
- library revision refresh behavior;
- route navigation state;
- removal of the old full-tree projection.

Real-library acceptance should include a large mixed-format hierarchy with PCM, Native DSD, CUE,
SACD ISO, cover/back/scan images, PDF booklets, UTF-8 and legacy-encoded rip logs/release notes,
multiple roots, one temporarily unavailable root, long folder names, one oversized text/PDF
material, and a large single-directory case.

Real UX acceptance should additionally include the existing PhilipsDUO-style case with hundreds of
direct child folders: filter the current 200+ item list without descending, switch list/grid,
enter one result and return with filter/scroll preserved, then compare that flow against recursive
Folder Search to verify the two interactions remain clearly distinct.
