# Atom lyric improvements

> Last updated: 2026-09-28

Implementation status: P0/P1 were completed on 2026-09-18, automated regression coverage is in
[completed work](./atom-completed.md); this document keeps the design and acceptance basis.

## 1. Scope and conclusions

This proposal only handles the P0/P1 problems in SPlayer's recent lyric changes that have clear value for
Atom: lyric source fallback, candidate competition, invalid lyric protection, TTML first-screen blocking,
plugin preemption and per-word space regression verification.

This round does not migrate parsers, replace the renderer, change the Core/Web protocol shape, or
introduce a second lyric state or cache model.

Basis:

- Atom already has its own LRC, QRC, YRC, KRC, TTML, LyS, SRT and ASS parsers.
- Core already owns platform lyric requests, matching, the lyric cache, the fuzzy-match cache and the
  TTML cache.
- Web still owns the current lyric's source orchestration, the parsed display projection and candidate
  competition; this proposal only fixes the actual errors in them.

## 2. Problems before the change

### 2.1 No fallback for an explicit platform preference

`resolveOnlineByPreference()` in `src/services/lyric/resolve.ts` returns the specified platform's result
directly under an explicit preference. The settings copy expresses "prefer", but with no result it does
not continue trying other platforms in `lyricSourceOrder`.

Target behavior:

1. Request the specified platform first;
2. Return immediately on a hit;
3. On a miss, continue requesting in `lyricSourceOrder` but exclude platforms already tried;
4. `self` still only follows the song's own source and does no cross-platform fallback.

### 2.2 Candidate submission lacks a unified validity and quality gate

`src/services/lyric/loader.ts` currently has several direct submission entries. Concurrent candidates,
plugin results, TTML overrides and preload results do not fully share the same
"parse valid + format priority + current song token" judgment.

This causes:

- low-quality candidates overwriting high-quality lyrics;
- malformed lyrics parsing to empty and then clearing the currently valid lyrics;
- failed results entering the overall flow's cleanup logic;
- old songs or old plugin responses polluting the current song.

Target behavior: all candidates are parsed and verified first, then the current lyrics are replaced
atomically. Automatic selection and background upgrade only accept a better format; when the user
explicitly switches platform, the platform's lower format is allowed per the user's intent.

### 2.3 TTML blocks the first screen on some paths

The normal online platform path submits basic lyrics first, but the streaming and lyric preload paths wait
for `resolveTTMLOverlay()` to finish before producing a final result. When consuming a not-yet-finished
preload result, the lyrics after a track switch may therefore go blank.

Target behavior:

- Streaming and preload display basic lyrics first;
- TTML upgrades in the background after it finishes;
- Background results must pass current song token and track identity verification;
- Downloading lyrics still waits for the final usable result and is not changed to a background display
  model.

### 2.4 Plugin preference does not really preempt

`withPluginPrefer()` sends the plugin request early, but waits for the normal flow to finish before
handling the plugin result. A fast plugin response cannot be displayed immediately.

Target behavior: a plugin response enters the same candidate submission gate as built-in platforms
immediately; a better and valid result replaces immediately, while a worse or invalid one is ignored.

### 2.5 Per-word spaces need verification, no preset migration

SPlayer's `endsWithSpace` is a change that goes with the `lyric-kit` data model. Atom's current parsers keep
the captured text in YRC/QRC/KRC and explicitly keep the spaces between spans in TTML, so it cannot be
concluded directly that Atom necessarily has the same defect.

This round only adds YRC/QRC/KRC/TTML English per-word space tests and verifies the output of TrackInfo,
the progress-bar lyric and copied lyrics. If the tests find a specific parser losing spaces, fix that
parser; do not introduce `endsWithSpace` ahead of time, to avoid two representations of spaces.

## 3. Technical approach

### 3.1 Unified candidate submission

Close a single candidate submission flow inside `src/services/lyric/loader.ts`, reusing the existing
`useMediaStore().setLyric()` and `isBetterFormat()`, without adding a lyric state model.

Candidate submission order:

1. Check the token and the current track identity;
2. Decide from the current mode whether the candidate format is allowed to replace;
3. Confirm in the temporary parse result that valid lyric lines exist;
4. Replace `activeLyric`, the raw content and the parse result through one state update;
5. When parsing fails or the result is empty, keep the old lyrics and do not push an empty projection to
   Core.

Quality rules:

- Automatic selection, plugin competition and TTML upgrade: the candidate format must be higher than the
  current format;
- First valid candidate with no current lyrics: display directly is allowed;
- Explicit platform switch: that platform's own valid candidate takes precedence per the user's choice and
  a format downgrade is acceptable; other fallback sources must still pass the format quality gate;
- Any failed candidate: must not clear the currently valid lyrics.

### 3.2 Platform preference fallback

In `resolveOnlineByPreference()` only the explicit platform branch is modified:

- The `self` branch stays as is;
- Other explicit platforms query themselves first;
- On a miss, enter the existing ordered query logic and filter out platforms already tried;
- Keep the existing `hasLocal`, `localFormat` and `smartPreferOnline` constraints.

Do not add a resolver, an adapter or a second platform registry.

### 3.3 TTML background upgrade

Split TTML handling in the display loading path into:

- Basic lyric submission: does not wait for TTML;
- Background upgrade task: request TTML, verify the current token/track and the parse result, then submit;
- Upgrade failure: keep the basic lyrics.

Streaming and preload must use this behavior. Downloading lyrics keeps the synchronous resolution, because
the download result needs to determine the final exported content.

Core already has TTML request deduplication and caching, so the Web side only needs to avoid blocking
display and does not add a network cache or dedup layer.

### 3.4 Plugin concurrency

Plugin requests are still initiated by the existing `pluginClient.matchLyric()`. Only the completion
callback is adjusted:

- Plugin requests run concurrently with ordinary sources;
- Once any candidate returns, it immediately passes the unified submission gate;
- When ordinary sources are empty, wait for the plugin task to finish before finally confirming that there
  are no lyrics;
- After the normal flow completes, do not submit the same plugin result again;
- Drop late results when the token is no longer valid.

### 3.5 Test scope

Added or extended:

- `src/services/lyric/loader.spec.ts`
- `src/services/lyric/resolve.spec.ts`
- `src/utils/lyric/parse.spec.ts` or minimal per-format tests

Must cover:

- Explicit platform hit, miss fallback and strict `self` behavior;
- No downgrade when a high format arrives first and a low format later;
- Upgrade when a low format arrives first and a high format later;
- Malformed TTML keeps the basic lyrics;
- Streaming and preload do not wait for TTML for the first display;
- A fast plugin response preempts immediately;
- Old requests do not pollute a new song during fast track switching;
- YRC/QRC/KRC/TTML English per-word space output.

## 4. Acceptance criteria

- When the specified platform has no lyrics, other configured platforms can continue matching.
- Valid high-quality lyrics are not overwritten by low-quality candidates.
- Any malformed or empty parse result does not clear existing valid lyrics.
- Streaming and preload do not show a blank first screen for lyrics because of a TTML network request.
- Plugin lyrics can join the competition immediately when they return faster.
- Fast track switching, preference refresh and preload consumption do not produce old-lyric pollution.
- English per-word lyrics pass the space regression tests in the lyric page, TrackInfo, the progress bar
  and copied results.
- Do not introduce `lyric-kit`, `lyric-dom`, a new lyric protocol, a second cache or a second lyric
  authority.

## 5. Explicitly out of scope

Out of scope for this round:

- Fully replacing Atom's existing lyric parsers;
- Introducing `lyric-kit` and rewriting the shared lyric types;
- Replacing the existing lyric renderer with `lyric-dom`;
- Introducing `endsWithSpace` as a second representation of spaces;
- SPlayer-specific features such as desktop lyrics, taskbar lyrics and dynamic island;
- Core fully taking over lyric parsing and the canonical lyric state;
- Changing downloaded lyrics to a background asynchronous resolution.

Core becoming authoritative is separate follow-up architecture work and is not part of this round of P0/P1
lyric improvements.
