# Web Control phone and tablet responsive spec

> Last updated: 2026-09-28

Update: 2026-09-21. This document replaces the work packages, size-measurement design and acceptance
process of earlier versions.

Status (current code, 2026-09-23): the responsive main layout, navigation drawer, phone single-row
player bar, lists, full player, settings and dialog adaptation are implemented; the two approved
interaction removals are complete. The phone player bar and bottom positioning were adjusted to a
single row fixed to the bottom of the viewport in later implementation; the related descriptions in
sections 3/5 have been updated to the current code. The full acceptance of representative sizes,
real devices and E01–E15 is not yet recorded; it is tracked by
[atom-roadmap.md](./atom-roadmap.md). Executors should first read `AGENTS.md` and
[development conventions](./atom-development.md).

## 1. Settled scope and trade-offs

### 1.1 Product requirements

Adapt to phone and tablet browsers and remove text, menu and control overlaps that actually occur.
Use the same Web Control, the same routes and the existing Core contracts; prioritize minimal
changes, the simplest implementation, stability and performance. The official entry remains
`mountWebControl()` in `src/main.ts`, not the `/debug` diagnostics page.

| Item                                 | Conclusion                          | Implementation requirement                                                                                                                                        |
| ------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playback queue drag reordering       | User approved removal; complete     | Keep normal track selection, scrolling, deletion, clearing and locating the current item; do not reintroduce dragging, long-press, auto-scroll or dedicated state |
| Duplicate dblclick playback on a row | User approved removal; complete     | Keep the original click handling and add no debounce, timer or click-count detection; double clicks in other components are out of scope                          |
| Auto immersive mode                  | User explicitly requires keeping it | Keep the settings entry, the toggle, the existing 3000ms timeout, and the control-bar/mouse hide and restore behavior                                             |
| Remaining features                   | Keep                                | Entries may move or be rearranged, but business meaning, conditions, parameters and results do not change                                                         |
| Android same-origin project          | As the main mobile layout reference | Borrow arrangement and information hierarchy, do not bring in platform bridges, business implementations or new gestures                                          |

This removal does not include sidebar custom ordering, sorting the song list by field, or shuffle/repeat,
and it does not remove Core queue commands or protocols. Do not expand it into "clean up all
sorting/double-click/timers".

### 1.2 What feature invariance specifically means

Adapted buttons, menus and forms continue to call the original handlers and keep track/queue indexes,
source, PlaybackContext, quality, device ID, time units and settings values. Existing visible/disabled
conditions, confirm/cancel, and loading and error prompts stay. Feature equivalence takes the behavior
after the two approved removals as its baseline; do not list the removed interactions as features that
must be restored.

- Pure layout changes do not switch tracks, reorder the queue, select an output, save business settings
  or override desktop display preferences.
- Entries folded into a menu are still touch-accessible; do not trade hidden features for a
  non-overlapping layout.
- The original plugin dynamic menus and settings schema continue to be used; do not hard-code a
  mobile-only feature subset.
- Do not change playback policy, output restrictions, lyric timing/parsing, cache, preloading,
  downloads, statistics, login or plugin logic.
- If existing code conflicts with accepted requirements, record it separately; do not fix unrelated
  business logic along the way.

### 1.3 Extra designs dropped in this version

- Drop forced ResizeObserver measurement of the bottom bar and the B/R/O shared placeholder system;
  narrow-screen main content scrolls independently and simply reserves space for the fixed bottom bar.
- Drop the hard requirement that "no component instance is ever rebuilt"; keep existing state ownership
  and do not copy business instances or initialization.
- Drop the requirement to precisely restore the first visible item after rotation; do not actively reset
  the page and do not add a new scroll-anchor algorithm.
- Do not pre-build multi-level menu pages, a back stack or a general gesture system; adjust existing
  components first.
- Do not build a new project for full HTTP/WS recording comparisons, automatic counting of all listeners,
  or a dedicated test Core.
- Do not require dozens of repetitions across breakpoints, nor a combinatorial traversal of all devices,
  themes, languages and business states.

These omissions do not lower the requirements of "features reachable, layout usable, no new business side
effects"; what changes is the implementation and verification method.

## 2. Implementation boundaries

| Area                                                  | Allowed content                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/layouts/`, `src/pages/`, related Vue components  | Templates, styles, necessary display props/local switches, wiring entries to original handlers                                                                |
| `src/styles/`, `src/web/runtime.css`, `index.html`    | Responsive styles, safe areas, viewport and necessary focus styles                                                                                            |
| `useFloatingPlayerBar.ts`                             | Only stop applying the desktop floating-bar compensation on narrow screens; keep existing call sites and make local corrections as actually needed            |
| Optional `useResponsiveLayout.ts`                     | Share a read-only media query when multiple components genuinely need JS structural decisions; do not add it for pure CSS layout                              |
| `useImmersiveMode.ts`                                 | Only wire in the original display-restore entry when touch adaptation needs it; do not change settings or the timeout, and do not build new gesture detection |
| `OutputDeviceSelector.vue`, `CoreDirectoryPicker.vue` | Width/height, arrangement, text and tap areas; do not change request/selection logic                                                                          |
| i18n, auto-generated declarations                     | Add necessary copy; generated files accept only the necessary differences produced by existing tools                                                          |

The following are read-only: `core/`, `native/`, `shared/`, `src/core/`, `src/services/`, `src/apis/`,
`src/actions/`, `src/stores/`, settings schema/categories/bindings, the lyric engine, virtual list
algorithms, `useTrackMenu`, `useMultiSelect`, `useQueuePanel` and other business composables. Business
code inside `.vue` files is subject to the same constraints. The completed removals and comment cleanup
are kept; do not use this adaptation to keep expanding removals.

Do not add frameworks, dependencies, a mobile route tree, player business implementations, a persistent
layout store, Core connections or polling. Do not import Android bridge/native code, do not use UA/brand
detection, do not restrict browser zoom, and do not add swipe-to-skip. Do not hide clipped content with
`overflow-x: hidden`, and do not scale the whole site or stack `!important`.

Check the actual CSS and component capabilities before implementing. New abstractions, compatibility
layers or safeguards must be justified by a reproducible problem in this task, not merely by "we might
need it later". If business behavior must change, explain the concrete problem first instead of widening
the scope yourself.

Keep the original RouterView/KeepAlive, route keys and existing data holders. Do not mount two sets of
phone/desktop business components at the same time; display-only shells may switch as needed, but do not
write a node-moving/keep-alive framework just to preserve their component identity. If switching shells
genuinely causes duplicate data loading, lost input or a reset output prompt, adjust that component's
state location locally.

## 3. Page layout and per-component requirements

### 3.1 Breakpoints and basic sizes

| Width           | Layout                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `<768px`        | Phone: full navigation folded into a drawer, single-column content, compact player bar, settings categories and content layered |
| `768px～1279px` | Tablet: keep the existing 64/240px sidebar preference; content wraps by container; use the non-phone player bar                 |
| `>=1280px`      | Desktop: keep the existing three layouts and the user's sidebar preference                                                      |

Use 768/1280px media queries consistently. When the height is below 500px, only shrink the cover and
allow necessary scrolling through CSS; do not add a JS device mode. Touch targets may use
`(any-pointer: coarse)`/`(hover: none)` styles; when mouse and touch coexist, both must work.

Phone pages start with 12px horizontal padding, tablet with 16px, and spacing is mostly 8/12/16px;
standalone icon buttons and menu rows need a touch area of at least 44px, input text 16px, ordinary body
text about 14px and secondary text at least 12px.
**The 44px touch area and the 16px input font size are not yet fully implemented and are target values
rather than the current state**: `SButton` heights are 32/36/40px (`h-8`/`h-9`/`h-10`), `SInput` defaults
to `text-sm` (14px), and there is no 44px/16px rule anywhere in the repository yet.
These are initial implementation values; not all components are required to be refactored into a unified
size system, and themes, icons and user fonts are kept.

### 3.2 Main layout and bottom-bar placeholder

Responsible components: `MainLayout.vue`, `useFloatingPlayerBar.ts`, related page/list callers.

1. The narrow-screen app frame uses Flex, with the top navigation and the stretchable main content
   inside the frame; the bottom player bar is fixed to the bottom of the current viewport, and the
   content area scrolls independently instead of scrolling away with the song list.
2. Main content uses `min-width: 0; min-height: 0`; the frame uses `100dvh` with a `100vh` fallback,
   and safe areas use CSS `env(safe-area-inset-*)`; add `viewport-fit=cover` when needed.
3. Narrow screens drop the desktop left offset, the fixed 80px bottom-bar height and the `mb-20`
   compensation; `main` uses `pb-16` for spacing, and the bottom bar separately uses
   `env(safe-area-inset-bottom)` to hug the viewport.
4. On narrow screens `SongList` and `DownloadList` keep only ordinary trailing space; `CoverList`
   keeps the caller's ordinary spacing and no longer adds the floating-bar height; `Home` and `Stats`
   likewise stop using the narrow-screen floating compensation.
5. `useFloatingPlayerBar`'s effective floating state is only used on wide screens; it does not write back
   `appearance.layoutMode`. The existing desktop compensation continues to be used; only fix it locally
   when last-item occlusion is reproduced, and do not migrate the whole desktop layout along the way.
6. Show the bottom bar and the output entry even when there is no current track. The last item is
   reachable in empty states and in both short and long lists.

Do not create a size-measurement service, shared inset state or per-row observers. The existing container
measurement in `CoverList` is kept as is; the above restrictions do not require tearing down existing and
necessary implementations.

### 3.3 Navigation and search

Responsible components: `SideBar`, `NavHeader`, `NavSearch`, `NavUser`, the existing `SDrawer`.

- The phone navigation drawer is `min(320px, 100vw - 24px)` wide; reuse the original menuItems/onSelect,
  groups, playlists, badges, creation and custom entries. Close the drawer after selecting an item;
  closing itself does not navigate.
- Tablet keeps the user's saved collapsed sidebar width; phone navigation uses the drawer and does not
  override the saved collapse preference.
- The top bar is at least 56px high; menu, back, a truncatable title, search, account, more. The account
  reuses the original NavUser. Forward, theme, UI scale and settings may be folded into more and continue
  to call the original handlers.
- Search continues to use NavSearch; the narrow-screen dialog is nearly full-screen and keeps history,
  suggestions, link detection and source selection.
- The sidebar's original right-click actions get an explicit clickable more entry; reuse the original
  menu items and do not create a second configuration.

The drawer uses the existing Reka/SDrawer focus and modal capabilities. Add a small display prop only when
this page genuinely needs it; do not pre-extend an inline/bottom multi-form drawer framework.

### 3.4 Compact player bar, queue and tools

Responsible components: `PlayerBar`, `PlayerControls`, `Toolbar`, `TrackInfo`, `PlayerTimeInfo`,
`QueuePopover`, `OutputDeviceSelector`.

- Phone uses a 56px single row: compact cover with title/artist, output, play/pause, next and queue;
  a thin progress bar hugs the top edge, and remaining actions continue to use the Toolbar and the track
  menu. Tablet uses the non-phone player bar.
- Keep the progress slider; the track may be thin, and the drag area is at least 24px high. The time
  display and the original time-format toggle may live inside the control panel.
- Previous, shuffle/sequential/heart/FM, repeat, favorite, track menu, volume, quality and tools are all
  kept. Prefer reusing existing controls and rearranging them in the original Toolbar/menu; do not copy
  their business branches.
- The output entry and the first-selection prompt remain usable, and an output can be selected while
  nothing is playing; do not infer Direct state from the device name.
- The touch volume panel uses an explicit open entry and keeps the original slider and a separate mute
  action inside the panel; opening the panel does not call mute. Existing desktop operations stay; do not
  add event detection or debounce.
- The queue uses the existing QueuePopover; first adjust the Popover's width/height, scrolling and
  position. When an ordinary panel can meet the need, do not write a draggable bottom sheet just to match
  the Android look. Clear confirmation, duplicate track indexes and close semantics are kept.
- The queue has no drag reordering, and no substitute implementation such as long-press/movement
  thresholds/click interception is added.

### 3.5 Full player and auto immersive

Responsible components: `FullPlayer/index.vue`, `PlayerCover`, `PlayerData`, `LyricActions`, `QueuePanel`.

- Phone stacks cover, song information, lyrics/queue and controls vertically; tablet/landscape uses a
  left-right layout when there is room. Remove the current 360px minimum width of the control area, and
  constrain the cover by both available width and height. At low heights, shrink the cover and allow the
  content to scroll.
- Keep existing semantics such as showLyric/fullQueueOpen/cover layout/centering and all entries; do not
  change settings values to fit a size.
- Favorite, comments, add to playlist, download quality, fullscreen, collapse, time format and lyric
  tools remain accessible.
- Lyric clicks continue to use handleLyricSeek's millisecond parameter and the original seek/play order;
  both engines and their time sources are kept.
- Auto immersive is explicitly kept: the original toggle, the 3000ms timeout, hiding when the mouse is
  idle/leaves, restoring on movement, and the control bar staying visible while hovered. The lyric tools
  and background display conditions related to it do not change.
- If the phone needs to wake up, calling the existing display-restore function from an ordinary touch
  event on the body is enough. Buttons/lyrics continue their original actions; do not add a
  "first-tap interception", gesture overlay, long-press detection or a separate touch state machine.
- Keep the existing show/hide lifecycle; do not add lyric instances, playback clocks or RAF loops.

### 3.6 Lists, cards and business pages

Responsible components: `SongList`, `CoverList`, `CoverCard`, `DownloadList`, each `pages/*.vue`.

- SongList continues to use the 88px virtual row height (76px card + 12px gap). Narrow screens arrange the
  horizontal columns into title, artist/album and secondary information, and keep the originally enabled
  index, duration, size, quality and artist/album navigation.
- Titles are either ellipsized or wrapped over a limited number of lines; longer descriptions, paths and
  device names wrap in details/panels. Use the existing details first; do not build a dedicated expansion
  component for every ellipsized text.
- A normal row tap plays and a tap in batch mode selects, while child buttons keep their original `.stop`.
  Do not restore repeated dblclick and do not add debounce.
- Batch mode, select-all/invert, sort field, favorite, download, delete and plugin menus are kept. The
  toolbar may wrap.
- QueuePopover/QueuePanel keep the 56/72px row height; the delete entry is visible in touch environments.
- CoverList reuses the existing container column count and virtualization; on phone `minSize` may be
  128px with a 12px gap, and the actual column count is decided by the container. Do not keep a separate
  phone grid algorithm alongside it.
- The home page's fixed 4/3 columns become adaptive; the detail header stacks on narrow screens; the
  search source/filter area wraps; the Folder page adapts to its container; stat charts scroll
  horizontally locally when genuinely needed. Other pages are handled with the same components.
- Do not actively clear the selection, query or scroll position; rotation may rearrange normally and is
  not required to restore the same pixel or the first item. Do not modify SVirtualList's algorithm or
  turn the virtual list into full rendering.

### 3.7 Settings and general overlays

Responsible components: `SettingsDialog/Content/Item/Menu/Search`, settings custom components, `modals/`,
UI overlays.

- Phone settings are nearly full-screen, with categories and content layered; tablet keeps the left-right
  layout when it fits. Use the original activeId, search, highlight and input state; complex settings
  items put the description on top and the control below, and switches may share a row.
- schema, visible/disabled state, sub-item conditions, bindings, value ranges, confirmation and save
  timing all stay unchanged.
- Check all custom settings, login, comments, playlists, tag editing, plugin details, path selection and
  onboarding pages, not just the outer frame. Host paths still point to the Core filesystem.
- Regular dialogs are no wider than the viewport minus 24px and their content can scroll; search and
  settings may explicitly use a nearly full-screen layout. Short confirmation boxes stay compact;
  close/confirm are reachable.
- Multi-level menus first use the existing Reka click, collision-avoidance, width/height limiting and
  scrolling capabilities. When touch submenus are unusable, fix only the specific entry; do not add
  same-width subpages, a back stack or a new menu data structure by default.
- Continue to use the existing focus management, Escape and focus return on close; do not build your own
  modal layer manager.
- The soft keyboard relies on the browser and scrollable forms first; fix locally only when occlusion is
  reproduced on a real device. Do not pre-build a VisualViewport compatibility manager or add listeners
  for assumed keyboard behavior.

## 4. Android reference

Reference repository: [SPlayer-CE/SPlayer-for-Android-Next](https://github.com/SPlayer-CE/SPlayer-for-Android-Next/).
Pinned reference commit: [4919fac554e2305d1de1a81f2576d37132c5936d](https://github.com/SPlayer-CE/SPlayer-for-Android-Next/tree/4919fac554e2305d1de1a81f2576d37132c5936d).
Existing conclusions come from reading the source; no APK was run; the existence of the reference project
is not treated as evidence of Atom real-device acceptance.

| Reference                                                              | Adopted content                                                         | Not adopted                                                                             |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [MobilePlayerBar][android-playerbar]                                   | Hierarchy of cover, two-line info and primary buttons                   | Swipe-to-skip, drag to expand, different player parameters and state                    |
| [FullPlayerMobile][android-fullplayer]                                 | Portrait stacking, landscape cover/lyrics split columns                 | Native lyric bridge, orientation control, complex Hero animations and two-page gestures |
| [MobileQueueOverlay][android-queue]                                    | Compact queue, height limiting, content scrolling                       | Panel dragging; Atom's existing overlay is enough, the bottom animation is not required |
| [SettingsContent][android-settings] / [SettingsDialog][android-dialog] | Layered categories/content, narrow-screen forms                         | Android bridge, platform settings filtering                                             |
| [SongList][android-list]                                               | Compact information grouping                                            | Hiding Atom's original album info/navigation, or copying the 76px mobile row height     |
| [MainLayout][android-layout]                                           | Safe areas and layered bottom content                                   | Native role switching, fixed compensation and a second runtime                          |
| [MobileFloatingNav][android-nav]                                       | Visual reference only; this round still uses the full navigation drawer | Replacing all navigation with four fixed tabs, long-press drag navigation               |
| [useResponsiveLayout][android-responsive]                              | Necessary layout decisions centralized in one place                     | isAndroid/UA/screen short edge/device override settings; Atom uses browser width        |

The four Android floating nav items are 90px each and the play button is 36px, so they cannot be used
directly as the standard for 320px narrow-screen/touch adaptation. When actually borrowing source
snippets, record the source and keep the applicable copyright/license notices; do not merge an entire
branch or replace business components. Give only a brief note for what is actually borrowed; a
per-snippet audit system is not required.

## 5. Assignable implementation work packages

The following is a file responsibility split; it does not require starting a fixed number of agents, nor
does each package have to deliver several reports. Record HEAD and existing differences in related files
before starting. The completed interaction removals and the user's other changes must be kept and must not
be overwritten. Only one executor modifies the same shared file; cross-file interface requirements go to
that file's owner to avoid parallel rewrites of each other's work.

Dependencies: complete C1's main layout/common overlays first, then C2/C3/C4 can be implemented
independently according to file ownership, and finally C5 integrates. Every package must be checked
against sections 2/3; the specific files, steps, deliverables and corresponding E acceptance items are
listed below.

### C1: Main frame, navigation and necessary common styles

Files: `MainLayout.vue`, `global.css`, `runtime.css`, `index.html`, `useFloatingPlayerBar.ts`;
`components/layout/*`, and the necessary `SDialog/SDrawer/SPopover/SDropdownMenu/SContextMenu/SSelect/STabs`.
Add `useResponsiveLayout.ts` only when there is a real JS branch that needs it, so downstream code can
read a few booleans such as `<768`/`<1280`.

Steps:

1. Fix the 768/1280px queries; complete the viewport-bottom fixed bar and narrow-screen independent
   scrolling from section 3.2, keeping the three wide-screen layouts.
2. Convert the sidebar to a drawer/compact navigation; reuse the original menu sources, onSelect and
   persisted preferences, and do not change sidebarNav's route data.
3. Rearrange the top bar buttons and the search/account entries; common overlays only gain width/height
   limits and the necessary full-screen display option.
4. Shared component extensions stay backward compatible; do not bulk-modify unaffected UI components.
5. Tell C2/C3/C4 the actual breakpoint-reading approach, effective floating state and display props in use
   so they do not reimplement them.

Deliverables: a working main frame, a brief interface description and phone/desktop screenshots. Check
E01–E04, E07, E13.

### C2: Player bar, full player and queue

Files: the outer Vue components of `components/player/`, `list/QueuePopover.vue`,
`web/OutputDeviceSelector.vue`; `useImmersiveMode.ts` may only wire in the necessary display events.
The lyric engine/time service is read-only; business dialog content styles belong to C4.

Steps:

1. Complete the phone single-row compact player bar from section 3.4; reuse the original Toolbar branches
   and output prompt state.
2. Confirm every original playback tool has a place, the output/queue entries are always visible, and
   Direct/remote output disabled conditions are wired in unchanged.
3. Adjust the full player's portrait/landscape layout and keep lyric switching, queue,
   comments/download/favorite and lyric tools.
4. Keep auto immersive per section 3.5 and adapt it for touch; do not expand it into a new interaction
   system.
5. The queue continues to use the existing overlay and virtual row height; make sure the removed dragging
   does not come back.

Deliverables: phone/landscape player screenshots, and a short table of moved entries with their handlers.
Check E03, E05–E09, E13.

### C3: Lists and business pages

Files: `list/SongList/CoverList/CoverCard/DownloadList.vue`;
`pages/Home/Songs/Liked/History/Daily/Cloud/Download/Collection/Artist/LocalList/Favorites/Search/Folders/Stats.vue`;
`pages/Streaming/*`, `components/stats/*`, `components/library/FolderManager.vue`.

Steps:

1. Complete the list/grid arrangement from section 3.6, keeping original virtual row heights such as
   88px and the existing algorithms.
2. Wire in C1's effective narrow-screen layout: remove redundant bottom-bar compensation and keep
   ordinary trailing space.
3. Wrap the detail page header, the search filters and the batch toolbar; menus reuse the original
   actions/composable.
4. Make the directory card grid container-adaptive; home/stats/streaming use container adaptation and keep
   all sources, filters and tabs.
5. Open and check each group according to the page list below; behaviors already verified in shared
   components do not need to be re-tested on every page.

Deliverables: check results for each page group, and the operation entries actually moved. Check
E02–E04, E06, E10, E12, E13.

### C4: Settings, business dialogs and onboarding

Files: `components/settings/*` and `custom/*`, `components/modals/*`, `pages/Onboarding.vue`,
`components/onboarding/*`, `web/CoreDirectoryPicker.vue`. Settings schema/categories/binding are
read-only; common overlay changes go to C1.

Steps:

1. Layer settings categories/content, stack controls vertically, and reuse the original activeId, search
   highlight, input and save flow.
2. Go through all existing categories and custom components and fix real overflow in long paths, device
   lists, plugin forms, etc.
3. Check login, comments, playlists, tags, audio tools and other business dialogs; close, cancel and
   confirm are reachable.
4. Onboarding order, skipping and save semantics stay unchanged; handle the soft keyboard locally only for
   reproduced problems.

Deliverables: settings and dialog coverage records, and screenshots of representative long forms. Check
E02, E04, E07, E11–E13.

### C5: Integration and wrap-up

Done by the main agent or a designated executor; no separate mandatory independent audit project.

1. Merge display interfaces and necessary i18n, and check that there are no duplicate breakpoints,
   duplicate business instances or regressions of the approved removals.
2. Check feature reachability against the page list and the moved entries; check that the three desktop
   layouts and user preferences still work.
3. Run the verification specified in sections 6/7; record specific unverified devices or existing failures
   and fix problems introduced by this round.
4. Review the actual diff: new code should correspond to a real layout problem, with no unused
   abstractions, safeguards or test frameworks left behind.

Deliverables: the patch, a short acceptance record and the necessary screenshots/command results. Check
E01–E15; do not commit or deploy automatically.

Page coverage list (coverage does not mean re-running every business combination):

| Group                      | Must check                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Home and common navigation | Home, search entry, account, settings, the full sidebar and dynamic playlists                                                      |
| Song lists                 | Songs, Liked, History, Daily, Cloud, Download                                                                                      |
| Details and covers         | Collection, Artist, LocalList, Favorites                                                                                           |
| Search and directories     | Search, Folders, CoreDirectoryPicker                                                                                               |
| Streaming and stats        | Streaming's Songs/Albums/Artists/Playlists, Stats                                                                                  |
| Settings and onboarding    | All categories/custom components of the current schema, Onboarding                                                                 |
| Dialogs                    | AB, sleep timer, lyric copy, EQ, Cookie/QR/streaming login, comments, playlist create/select, speed, tags, scaling, plugin details |

Moved entries only need one table: `action → new location → whether the original handler/condition is preserved`. Unchanged actions do not need a rewritten full business description; dynamic menus follow the original data sources.

## 6. Required acceptance

### 6.1 Representative sizes and environments

| Viewport (CSS px) | Check scope                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| 390×844           | Phone acceptance for the page list and main actions; the primary narrow-screen sample             |
| 320×568           | Narrowest-layout check for navigation, player bar, long-title lists, settings and typical dialogs |
| 820×1180          | Tablet navigation, lists, player, settings                                                        |
| 844×390           | In landscape with low height, player, lists and dialogs can scroll and be closed                  |
| 1440×900          | Desktop three layouts, collapsed/expanded and representative operation regression                 |

Cross 768/1280px once and back within an open page/settings; check Chinese/English and dark/light/image
themes on representative pages, without a combinatorial traversal of all routes and sizes. One browser
zoom check for readability is enough; do not construct a dedicated zoom stress test.

Verify with actually available desktop browsers and phones; prioritize iOS Safari/Android Chrome on
mobile. Record the devices actually tested. Device emulation can check layout but cannot claim that a real
device's keyboard, safe areas and touch have been verified. When a device is missing, state clearly that
"this device is unverified"; do not require purchasing it or building a full device lab first; before
officially claiming that a platform's adaptation is complete, add a representative real-device check for
that platform.

Test data uses existing development data or existing fixtures: at least long Chinese and English titles,
an empty queue/no output selected, an ordinary queue, with lyrics/without lyrics, and a long form. Verify
the virtual list with the existing list that has enough scrolling content; only increase the data volume
when virtual behavior changes or a performance regression appears. Do not build a full simulation system
of all sources/accounts/plugin states for this adaptation.
Use isolated test data or existing mocks for destructive operations; do not run delete/clear acceptance on
the user's real music library.

### 6.2 Acceptance items

The following is the checklist for this diff; it does not require new automated tests or instrumentation
for every item. For unchanged logic, rely mainly on code-reuse review and existing tests; when event
wiring has changed, check the real target, parameters and count of the corresponding operation.

| ID  | Operation                                                                                               | Pass condition                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E01 | Review the diff                                                                                         | Read-only business areas unchanged; existing changes kept; queue dragging or repeated double-click not restored; auto immersive kept                                                      |
| E02 | Open the page list and long-text samples                                                                | No text/button overlap and no clipping of required controls; no unexpected horizontal scrolling on the whole page, local scrolling of charts/tags allowed                                 |
| E03 | Empty/with tracks, scroll short/long lists to the end                                                   | The bottom bar is always present and the output usable; the last item and its actions are visible, and narrow screens have no extra full-bar duplicate spacing                            |
| E04 | Restore after crossing breakpoints, rotate after typing in settings                                     | Route/query/selection/unsubmitted input and saved preferences are kept; no active track switching/output selection/saving; pixel-identical scrolling is not required                      |
| E05 | Play/pause, previous/next, shuffle/repeat and special mode entries actually moved                       | Original handlers and conditions are still called; branches such as FM/heart are not simplified; one normal operation does not trigger duplicate calls due to wiring                      |
| E06 | Click a queue track, delete, clear cancel/confirm                                                       | Indexes are correct, deleting does not trigger row playback, cancel does not clear, confirm follows the original chain; no drag-reorder entry or dedicated events                         |
| E07 | Open menus/submenus/output/typical long dialogs                                                         | Content is touch-accessible and scrolls to the last item, close/confirm are reachable, original disabled/dynamic items exist, existing modal focus behavior works                         |
| E08 | Enter with no output selected, open volume, restore mute, restricted output state                       | Output prompt/selection conditions are kept; opening the panel does not mute; the original volume restore value and Direct/remote disabling are kept, and no handling commands are added  |
| E09 | Expand the player, toggle lyrics/queue, progress and auto immersive                                     | Original entries/seek parameters/lyric behavior are kept; the immersive toggle and the ~3 second hide/mouse restore work, touch can restore operation, and there is no new gesture system |
| E10 | List first/middle/last, change cover grid width, batch operations                                       | No virtual row overlap/gaps/wrong items; original sorting/selection/source/menu kept; child buttons still execute independently; no switch to full DOM                                    |
| E11 | Settings categories, search positioning, modify cancel/confirm; onboarding/login representative dialogs | Settings items are not reduced, bindings/disabling/confirmation/save timing do not change, and input and steps are not lost due to layout                                                 |
| E12 | Search/long form on a real device invoking the keyboard, landscape                                      | Input and close/confirm are reachable, the layout is usable after the keyboard is dismissed; when no real device is available, record it as unverified instead of claiming a pass         |
| E13 | Desktop three layouts, themes/languages on representative pages                                         | Desktop features and preferences are kept; no squeezing, hidden entries or broken styles introduced by this round                                                                         |
| E14 | Check newly added runtime code; hide/restore the player once                                            | No added playback connections, polling, per-row listeners or high-frequency work; the original visibility lifecycle is reused, and no new counting system is built for the audit          |
| E15 | Run the affected checks                                                                                 | The mandatory checks in section 7 succeed and related existing tests pass; failures state whether they are baseline issues and their impact                                               |

The required operations can reuse the following three short groups; there is no need to record every
HTTP/WS message separately:

1. **Queue**: use `[A, B, A, C]` to verify that deleting the second A operates by index; click C to play;
   clear-cancel/confirm. Ordinary scrolling and track selection are kept; do not test "eliminating all
   misclicks" and do not create new interception tests for long-press/drag.
2. **Output/volume/settings**: open the entry when no output is selected; set the volume to 0.37 in a
   workable state, opening the volume panel does not change the value, and muting then restoring is still
   0.37; check disabling with the existing restricted output state; change a settings value and cancel,
   then confirm, once each.
3. **Player/layout**: play a song and expand the full player, toggle lyrics and queue, drag the progress;
   check the auto immersive toggle, move after about 3 seconds of stillness to restore; rotate and return
   to desktop, confirming that playback and display preferences were not changed by layout.

## 7. Verification and handover requirements

Each package first runs targeted lint/necessary checks on the modified files. During integration, run:

```bash
pnpm typecheck:web
pnpm build:web
pnpm exec eslint <frontend files modified this round>
git diff --check
```

Select related existing tests according to the change: run `pnpm test:web` when common components have a
broad impact; when display wiring such as player buttons or output disabling is involved, run the
corresponding `src/core/player/*.test.ts` (such as directUi/coreControlCommands). These `.test.ts` files
use the repository's existing tsx/Node test entry and cannot be replaced by Vitest `.spec.ts` results.
When Core/native is unchanged, the whole `test:node` or a native build is not mandatory. Expand test scope
when necessary; do not repeat already-passing checks unaffected by the new changes just "to be safe".

Add only a small number of tests for wiring actually changed this round that has clear behavioral risk and
is not covered by existing tests. Pure CSS and removed interactions do not require a test framework; do
not write mirror tests that only assert class names, and do not lower existing test requirements to hide
regressions. For documentation changes, check formatting and `pnpm docs:build`; do not rebuild the docs in
every code work package.

Handover only needs one short record:

- Modified files, the layout problems actually solved, and any new display interfaces.
- Moved feature entries and whether the original handler/conditions are kept.
- Results of the relevant items among E01–E15, actual devices/sizes, necessary screenshots and command
  results.
- Existing failures, unverified devices, unfinished items; do not repeat records across several templates,
  and a call-traces directory is not mandatory.

Completion condition: the relevant acceptance passes, pages and original operations are reachable, and no
new business side effects are introduced; environments that cannot be verified are clearly disclosed.
Screenshot checks cannot be written up as real-device acceptance, and unimplemented features cannot be
written up as passing. Commit, merge and release follow user authorization.

Task text that can be copied to a sub-agent:

```text
Execute C<n> of docs/web-responsive-plan.md, following AGENTS.md and sections 1–3/6–7 of the plan.
Modify only the files owned by that package; first keep the differences that existed when the task
started, and hand cross-file requirements to the owning owner.
Implement per the package steps and reuse the original handlers/conditions/parameters. Auto immersive is
kept, and queue dragging and repeated double-click must not be restored.
Prefer CSS/existing components; do not add a measurement system, gesture safeguards, scroll restoration,
a general compatibility layer or a full test project.
When a real blocker appears, explain the minimal solution; do not remove features or change
Core/store/settings schema on your own.
Deliver a change description, the relevant E item results, the actual check commands and unverified
items; do not commit or deploy on your own.
```

[android-playerbar]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/player/MobilePlayerBar.vue
[android-fullplayer]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/player/FullPlayer/FullPlayerMobile.vue
[android-queue]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/player/MobileQueueOverlay.vue
[android-settings]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/settings/SettingsContent.vue
[android-dialog]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/settings/SettingsDialog.vue
[android-list]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/list/SongList.vue
[android-layout]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/layouts/MainLayout.vue
[android-nav]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/components/layout/MobileFloatingNav.vue
[android-responsive]: https://github.com/SPlayer-CE/SPlayer-for-Android-Next/blob/4919fac554e2305d1de1a81f2576d37132c5936d/src/composables/useResponsiveLayout.ts
