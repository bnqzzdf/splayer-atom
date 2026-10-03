# Folder Browser Improvements

> Last updated: 2026-10-03

Date: 2026-09-28. Code verification baseline: `058c0e63`; stage 1 implementation: `b54265b6`;
stage 2 implementation: `a9e175a3`; stage 3 implementation: `188fcfbc`; acceptance-period
interaction wrap-up: `fa938d5b`, `543a5dc1`, `2b3d91de`, `3c349f0a`.

Status: this plan has been incorporated into the development plan. First-batch stage 1 (Core
contract, display sorting, physical attributes and cursor validation), stage 2 (Web controls,
preferences and navigation restore) and stage 3 (information and scope notices) are implemented; on
2026-09-28 the first-batch functionality was accepted against the current real music library and
browser. The three second-batch enhancements are implemented and await acceptance on a real music
library and browser; they do not affect the completed acceptance conclusion for the first batch.
Larger-scale directories, NAS/USB and standalone performance records continue to be held under the
Roadmap as wider-scope acceptance. Implementation and acceptance status are maintained together by
the [Roadmap](./atom-roadmap.md).
The [original Folder Browser plan](./local-folder-browser-plan.md) continues to define directory
authorization, scanning, containers, material reading and playback boundaries; this document adds
display sorting and interaction rules without redoing the already-merged basic functionality.

## 1. Purpose and references

Help users find the music inside a directory faster, recognize physical files, and clearly
understand display order and playback scope. Keep the Core-owned, level-by-level browsing model
that is usable before a scan; do not expand into a general file manager.

References:

- [Roon Folder Browser](https://blog.roonlabs.com/folder-browsing/) combines fixed directories,
  recursive playback, optional information columns, sorting and filtering, album/artist jumps and
  image/PDF reading.
- [Roon ARC Folder Browser](https://blog.roonlabs.com/arc-folder-browsing-arrives/) offers sorting
  by album, album artist, format and so on, and keeps filename information. It cannot be assumed
  from this that any physical directory corresponds to a single album or has reliable artist and
  year attributes.
- [Roon sorting notes](https://help.roonlabs.com/portal/en/kb/articles/sorting) distinguish display
  sorting from playback actions.
- The [foobar2000 official changelog](https://www.foobar2000.org/changelog-mac) provides browsing
  components such as Album List, ReFacets and Library Search; Atom can likewise rely on existing
  pages such as Albums and Artists for deeper metadata browsing.

This plan adopts three basic sort modes and a small amount of required information; it does not
copy every advanced library filter.

## 2. Current implementation and real gaps

Below, “already implemented” only means the code exists; acceptance on real devices and music
libraries still follows the Roadmap.

| Item                                                                 | Current implementation                                                                                  | Handling in this round                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Roots, breadcrumb, route location, pagination, virtual list          | Existing                                                                                                | Reuse                                       |
| Pinned folders, offline-root display                                 | Existing; pinned entries are persisted by Core                                                          | Reuse                                       |
| Physical-name search across all roots, current-directory filter      | Existing; the filter runs in Core before pagination, and the search truncation notice is displayed      | Implemented in the first batch              |
| List/cover grid and preference persistence                           | Existing; `058c0e63` already persists the Web view mode                                                 | Not reimplemented                           |
| Restore filter and position when returning to a directory            | Returning to the parent restores the filter and deterministically locates the child directory just left | Implemented and accepted in the first batch |
| Unscanned audio, CUE/SACD expansion, attachment reading              | Existing                                                                                                | Keep existing semantics                     |
| Recursive/current-folder-only playback, queue, playlist, scoped scan | Existing; Web already makes the recursive and current-folder-only scopes explicit                       | Implemented in the first batch              |
| Batch operations on audio and container tracks                       | Existing; Select all/Invert hides pagination details and covers the complete filtered result            | Implemented and accepted in the first batch |
| Multiple display sort modes                                          | Core sorting as well as the Web control, direction and default preference are implemented               | Implemented in the first batch              |
| File attributes and track information display                        | Physical filenames, the required track/file fields and modification time are displayed                  | Implemented in the first batch              |
| Search limit notice                                                  | Core `truncated` is presented separately from pagination state                                          | Implemented in the first batch              |
| Current-subtree search, folder-level library jumps, failure notices  | Implemented; awaiting acceptance on a real music library and browser                                    | Second batch                                |

Review entry points: `shared/types/folderBrowser.ts`, `core/services/folderBrowser.ts`,
`core/atom/folderRoutes.ts`, `src/core/folderBrowserClient.ts`, `src/pages/Folders.vue`,
`src/stores/settings.ts`. `compareBrowseEntries` currently owns display sorting within the fixed
groups; `compareTracks` and the directory recursion logic continue to own playback order, and the
two remain independent.

## 3. First batch: display sorting

### 3.1 Options and scope

| Display option    | Protocol value | Direction on first selection | Applicable rules                                                                                    |
| ----------------- | -------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| Filename          | `name`         | `asc`                        | Default; natural ordering of physical file/directory names, with the number 2 before 10             |
| Modification time | `mtime`        | `desc`                       | Uses the filesystem modification time of the current entry, newest first by default                 |
| Track order       | `track`        | `asc`                        | Ordinary scanned audio is ordered by disc number and track number; the remaining rules follow below |

All three modes can switch between ascending and descending order. On first entry with no
preference, the existing `name/asc` is kept.
This batch only changes the ordering of direct children of an ordinary directory; Folder home
roots, pinned folders and recursive search results gain no sort menu.

Common rules:

1. Keep the fixed “folders → audio/containers → supplementary materials” grouping; descending
   order does not reverse the groups.
2. Name comparison reuses the existing Core natural ordering; equal sort keys are then ordered by
   natural name and exact path. When names compare equal, the exact path in ascending order breaks
   the tie, without depending on the `readdir` return order.
3. Entries with the same `mtime` are ordered by name and then path in ascending order; time is in
   Unix milliseconds.
4. In `track` mode, ordinary audio with a valid track number is sorted by `disc` (default 1) and
   `track`. Audio without a valid track number and outer containers are placed together after this
   group, in ascending name order; ascending/descending order does not move unknown items to the
   front. Equal disc and track numbers are resolved by name and then path in ascending order. This
   mode does not infer album grouping, and mixed albums still follow this rule.
5. In `track` mode, subdirectories and supplementary materials are always ordered by name
   ascending; the menu states “track order applies to audio only”.
6. At the outer level a CUE/SACD participates in name/modification-time sorting as one container;
   containers are not expanded in advance for track sorting. Once expanded, virtual tracks always
   keep the existing container order and are unaffected by the outer ascending/descending order.
7. Media is not probed to fill in sort fields for unscanned audio; after a scan, sorting is
   refreshed through the normal library revision.

Modification time means the `mtime` of the directory or file itself; it does not mean the most
recent update time of descendant music. Directory size, the newest descendant time and a
directory “album year” are not computed recursively. “Recently added” is not provided for now, and
`mtime/ctime` is not used in place of the time an item entered the library.

### 3.2 UI and state

Add a “display sorting” dropdown and a direction button near the existing current-directory filter
and the list/grid switch; narrow screens may wrap, and no side tree is added. List and grid share
the same sorted result, and switching the view does not reset sorting.

- The default sort preference reuses Web settings persistence and is saved per Web Control; it is
  not added to Core library settings.
- The route/history entry stores the current `sort/order`, and refresh and back/forward restore the
  sorting of that navigation entry; the current Web preference is used when no parameter is
  present. Entering a new subdirectory inherits the current sorting, and no persistent
  per-directory settings table is created.
- Filter state is kept per directory within the Web session; returning to the parent restores that
  directory's own filter. Navigating into a subdirectory writes the return target into the parent
  history entry's `focusPath`, and returning deterministically locates the subdirectory just left.
  Per-directory pixel scroll positions are not maintained, and no extra state machine is added for
  exact-pixel restoration.
- Actively changing sorting or filtering clears pagination and the batch selection and reloads from
  the first page; responses to old requests must not be appended to the new result.
- “Open containing folder” locates the real file for ordinary audio through Core's `focusPath`; for
  CUE/SACD it locates and expands the physical `.cue/.iso` container instead of treating virtual
  tracks as the filesystem location target. An explicit target location takes precedence over the
  ordinary entry position; if the old filter excludes the target, that filter is cleared so the
  target is displayed.

### 3.3 Core contract and pagination

Add an optional `sort/order` to the existing browse contract; when omitted it is `name/asc`, and
the direction values are `asc/desc`. The enum and request types live in
`shared/types/folderBrowser.ts`, and the route validates illegal values; no second browsing API is
added.

Core processing order: current-directory enumeration → canonical association and existing-container
deduplication → current-directory filter → group sorting → focus location → pagination. Web does
not sort the loaded page itself.

- Reuse the file attributes already read during enumeration. Directories, scanned Tracks and
  CUE/SACD entries are given the current physical `mtime`; files/containers are given the current
  physical `size`. Directories do not expose a fabricated total capacity.
- Attributes live at the Folder entry layer, while the canonical Track remains the authority for
  music metadata; database Tracks are not modified for display sorting.
- The cursor is bound to the directory identity, the normalized filter, and the sorting and
  direction. A mismatch of conditions rejects the continuation page; content changes keep using
  `FOLDER_CURSOR_STALE`, and Web clears the old pages and requests again.
- Checking only the parent directory's `mtime` is not enough to tell whether a new sort has gone
  stale: editing file content can change the file time without changing the parent directory time,
  and a scan can also change track numbers. A sort-result signature is generated from the result
  enumerated for this request, covering ordered entry identities and the currently effective sort
  keys, and library revision is reused to validate metadata updates; no whole-tree watcher and no
  persistent index are added.
- For a stable directory, paging forward and backward must produce no duplicates and no omissions.
  When a directory is being changed externally, a refresh and re-fetch is allowed; no cross-request
  filesystem transaction snapshot is created, and pagination is not guaranteed by caching the
  entire directory tree.

## 4. First batch: file information and action semantics

### 4.1 Required information

- Scanned audio keeps the song title and gains the physical filename; artist/album continue to be
  displayed.
- Desktop shows disc/track number, duration and a format/quality summary compactly; when sorting by
  modification time, a readable time value is shown. Size, full path and other attributes may move
  into on-demand details, and not every column is spread across the first screen.
- Unscanned files show filename, extension and size; when metadata is unknown, an empty value or
  “not scanned” is shown instead of a fabricated 0 duration.
- Mobile prioritizes the title/filename and a short format, with extra attributes viewed on demand;
  the existing details and formatting capabilities are reused, and no general drag-and-drop column
  editor is introduced.
- A virtual track's file information points to the physical container; an ISO/CUE file size is not
  displayed as a single track's size.

### 4.2 Display, filtering and playback

“Display sorting” affects browsing only and does not change the playback queue or directory
playback policy:

- Play all, Play next, Add to queue and Playlist continue to reuse Core's deterministic resolution:
  current-directory tracks first, then subdirectories traversed depth-first by natural name;
  disc/track/CUE ordering rules are kept within the current directory.
- The directory's primary playback action is clearly labeled as including subdirectories; “Current
  folder only” remains as the existing submenu.
- The current-directory filter does not change the scope of the whole-directory action; while a
  filter is active, the user must still be able to tell that the action includes items that are not
  displayed.
- Batch actions such as “Play selected” submit the selected targets in the visible list order at
  commit time, and Core handles container expansion, deduplication and queue construction. After a
  CUE/SACD is expanded, the outer container is no longer a batch candidate, avoiding a duplicate
  selection of the container and its inner virtual tracks.
- The first batch does not add “play all filtered results in the current sort”. If this is needed
  later, Core should receive the filter/sort conditions and process the complete result; it must not
  play only the loaded page.

### 4.3 Selection and search scope

- The UI offers only “Select all / Invert”, and pagination is an internal implementation detail.
  When executed, it walks the complete pagination for the current directory, current filter and
  current sorting, then acts on every selectable audio file/container/expanded track; directories
  and materials are excluded.
- When a CUE/SACD is expanded, only the inner virtual tracks are selected, not the physical
  container as well; while collapsed, the container can still be a whole target.
- Changing sorting/filtering clears the selection, so the selection set is not silently changed.
  The first batch does not add recursive multi-directory batch selection.
- Consume `truncated` from the existing search response: show “search limit reached, narrow the
  scope”. This means the search traversal budget is exhausted, which is a different state from
  `nextCursor` indicating that another page exists; a new query clears the old state, and the
  notice is kept when truncation appears on a later page.

## 5. Second batch

The second batch keeps only three explicit enhancements and no longer expands new sort dimensions
or other Folder Browser capabilities:

| Enhancement                      | Implementation boundary                                                                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current-subtree recursive search | Reuses the existing search API and DFS; search on a root page covers all music directories, while in-directory search traverses only the current directory and its descendants; still limited and cancellable              |
| Folder-associated album/artist   | Derives only from reliable canonical Tracks already available for the current directory's direct media, without recursing into subdirectories or performing extra scans or queries; only a unique association is displayed |
| Batch failure notice             | Reuses the existing `count/failed/added` and only reports total/partial failure and the number of failed items, without showing paths, internal IDs or exception details                                                   |

The current-directory filter continues to handle only direct children and remains a separate entry
from recursive search. In-directory search only adds an optional scope to the existing
`/library/folders/search`; it does not build an index, a directory-tree cache or a watcher, and it
is not used to redo global search.

The album/artist shortcuts live in a folder-level area and do not change the stable per-track row
layout. The association computation directly reuses the canonical data for direct media that the
current browse has already obtained; no association is displayed while unscanned or stale direct
media exists. Album determination stops once a second different canonical identity appears, and
artist determination stops once a second different name appears; when both are already known to be
non-unique, the derivation can end. The number of subdirectories does not participate in the
computation, so a large directory with hundreds of subdirectories and no direct music produces no
recursion or extra database load. A CUE/SACD participates in the derivation only when fresh
canonical split tracks already exist.

The failure notice does not add a failure details page, a dialog, a retry state machine or a
structured failure protocol; the failure paths returned by Core are used only to determine the
failure count and are not shown to the user directly.

Keep the existing boundaries: do not add host media deletion, rename, move, copy or directory
creation, do not introduce batch tag rewriting, do not recursively scan in order to hide empty
directories, and do not build a second library index, scanner or playback authority. Root-directory
management on the Settings page keeps its add/remove configuration responsibility; removing a
configuration must not delete the user's music files.

## 6. Implementation order

1. **Core contract and sorting**: extend the shared types, routes and existing services, and
   complete physical attributes, comparison rules and cursor validation; keep the compatible
   default when no sort parameter is passed.
2. **Web controls and restore**: extend the client, settings, routes and the Folder page to complete
   sort switching, pagination reset, discarding stale requests, and focus and history restore;
   reuse the existing view-mode persistence.
3. **Information and scope notices**: add the filename and required fields, playback scope,
   batch-selection copy, the search truncation notice and the existing locale files.
4. **Acceptance and records**: complete the automated and manual checks below, and update the
   development status and the actual acceptance status separately in the Roadmap.

Prefer modifying existing files; extract a small helper module only when the sorting
comparison/cursor logic genuinely needs independent tests. Do not split this round into a new
Folder service, store or standalone state-management framework.

## 7. Acceptance criteria

### Automated

Extend the existing `core/services/folderBrowser.test.ts`, `core/atom/folderRoutes.test.ts`,
`src/core/folderBrowserClient.spec.ts` and Folder Web tests to cover real behavior instead of only
checking source-code strings.

| Scenario                    | Requirement                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Default and natural sorting | Behavior is compatible when the parameter is omitted; CD2/CD10 and 2/10 order correctly; ascending/descending order keeps the groups                         |
| Modification time           | Folders/audio/containers/materials use the current physical time; equal times sort stably; descendants are not read recursively                              |
| Track sorting               | Missing disc numbers, missing track numbers and duplicate track numbers have a defined order; mixed unscanned files and containers trigger no extra probing  |
| CUE/SACD                    | Outer sorting does not reverse the expanded track order and does not add duplicate backing-audio entries                                                     |
| Pagination and filtering    | Data beyond the default 200 and maximum 500 single-page limits is traversed completely; matches outside the first page can still be found                    |
| Cursor changes              | Changing sorting/filtering/path cannot reuse an old cursor; a stale page is rejected when file times or scanned metadata change                              |
| Web request races           | Old responses do not mix into the new list when sorting or directories are switched quickly; switching sorting clears the selection and old pages            |
| Navigation and location     | Returning to the parent restores sorting/filtering/anchor; refresh restores sorting; focus lands on the correct page after sorting                           |
| Action scope                | Whole-directory actions do not inherit the display filter/sort; Select all/Invert covers the complete filtered pagination; containers are not selected twice |
| Search truncation           | Truncation and the next-page state are presented separately, and a new query clears the old notice                                                           |

Run the relevant tests during implementation; before merging, run `pnpm typecheck`, `pnpm test`,
`pnpm lint`, `pnpm build:web` and `git diff --check`, and run `pnpm docs:build` when synchronizing
documentation. This round does not modify native/audio, and unless an actual dependency change
requires it, no additional full audio-hardware or Rust re-verification is added.

### Manual and performance

On 2026-09-28 the first-batch functionality was accepted against the current real music library
and browser:

- Name, modification time and track order, together with ascending/descending order, behave as
  expected; the fixed grouping stays stable, and the internal CUE/SACD order is unaffected by outer
  sorting.
- On a real directory with 243 subdirectories, paging across 200 items, switching sorting after
  paging and rapidly switching sorting in succession were checked; no duplicates, omissions, stale
  responses mixed in or obvious jumping were observed.
- Returning to the parent directory, ordinary “Open containing folder”, filter-state isolation,
  batch operations after filtering and the Folder Search function all passed.
- The “Select all / Invert” semantics passed; after a CUE/SACD is expanded, Invert acts only on the
  inner virtual tracks and no longer selects the physical container a second time.
- The final semantics of “Open containing folder” for CUE/SACD were settled as locating and
  expanding the physical container, without locating or highlighting the inner virtual tracks.
- The automated gate passed after the final interaction wrap-up: Node 428/428, Web 111/111, plus
  Web/Node typecheck, lint, Core/Web build and `git diff --check`.
- Uncovered boundary: no real sample of “a single directory with more than 200 songs” was available
  for an on-device batch-operation check; the existing implementation and automated coverage
  already cover complete cross-page selection semantics.
- Performance observation: Folder Search is functionally correct, but searching the current real
  library feels slow; this is recorded as a follow-up performance-optimization observation and does
  not block first-batch functional acceptance.

- Executed together with the real-library acceptance in sections 17/18 of the original plan: a
  library of about 20k tracks, hundreds of subdirectories, a directory with at least 12,000 direct
  entries, and directories mixing PCM/DSD/CUE/SACD with supplementary materials.
- Record first-screen, sort-switch and next-page timings on local disks and on any available
  NAS/USB, and confirm that the access scope is still the current directory; do not claim a
  performance pass just because a virtual list exists, and do not preset unmeasured latency
  thresholds.
- Cover long Chinese/English filenames, identical times, scan updates, temporarily offline roots,
  ordinary-file location after sorting, and physical-container location for CUE/SACD.
- On desktop and mobile, check that controls are reachable, information is readable, and
  back/forward, refresh, list/grid switching and selection-scope notices work.
- Record the source commit, build artifacts (if used), browser/viewport, storage type, data scale,
  passing items and uncovered items. Do not write code completion, passing automation or a local
  synthetic directory test as completed NAS/real-device acceptance.
