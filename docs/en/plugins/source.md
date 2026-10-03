# Source Plugins

> Last updated: 2026-10-03

A source plugin (`@type source`) provides playable URLs when the built-in provider cannot return one: when the player wants to play an online track but cannot obtain the official address, it calls a source plugin, which returns the real playback URL.

A source plugin can optionally **fall back for lyrics and covers** — when a built-in source cannot find lyrics, or a track has no cover, resolution falls back to the plugin. This is not limited to online platforms: local files without embedded lyrics or art are covered too. See [metadata fallback](#metadata-fallback).

Read [Plugin Overview](./index.md) first for the common APIs (`splayer.request`, `storage`, `log`, `utils`, and so on), which apply to source plugins as well and are not repeated here.

## How resolution works

Understanding when the plugin is called, what it receives, and what it must return is the prerequisite for writing a source plugin:

1. The player maps an online track to a source key and selects enabled, ready plugins registered for that key.
2. It calls `musicUrl` with the platform track ID and requested quality.
3. The plugin calls its service and returns `{ url }`.
4. The first non-empty URL is played. An exception or empty URL moves to the next plugin.

::: warning Source keys must match platforms
The source key passed to `register` **is not arbitrary** — only a key agreed with the target platform is called by Core. Atom's LX compatibility layer keeps the community keys `wy`, `tx`, and `kg`.

- When porting an LX source script, reuse its original source key.
- When writing a new plugin, use the key for the target platform; if unsure, log `splayer.log.info(req.source)` in the handler and check the key the player actually passes.
- Registering other keys (such as the common LX keys `kw` / `mg`) does not error and still shows in Plugin Management, but they are not currently called for playback. They can still be used for metadata fallback.
  :::

## Quick start

```js
/**
 * @name        Example
 * @id          you.example
 * @version     1.0.0
 * @description Example source
 * @author      you
 * @type        source
 * @apiLevel    1
 */

splayer.register({
  sources: {
    wy: {
      name: "Example source",
      actions: ["musicUrl"],
      qualities: ["lq", "hq", "lossless"],
    },
  },
});

splayer.on("musicUrl", async ({ musicInfo, quality }) => {
  const response = await splayer.request(
    `https://api.example.com/url?id=${musicInfo.songmid}&q=${quality}`,
    { responseType: "json" },
  );
  if (!response.body?.url) throw new Error("no url");
  return { url: response.body.url, quality, expire: response.body.expire };
});
```

Host `example.js` at an accessible HTTPS URL and paste its raw URL under **Settings → Plugin Management → From URL**.

::: tip
`@type source` may be omitted (the default is `source`). Source plugins do not depend on control capabilities, so playback URL / lyrics / covers may declare `1` or `2`; declaring `musicComment` requires `3`. See [Plugin Overview · API levels](./index.md#api-levels) for the capabilities added at each level.
:::

## `splayer.register(capabilities)`

Declares the sources and capabilities the plugin provides. Call it while the script executes synchronously — only after registration does Plugin Management show the sources the plugin supports, and only then does the player consider it a candidate.

```js
splayer.register({
  sources: {
    wy: {
      name: "Example source",
      actions: ["musicUrl"],
      qualities: ["lq", "sq", "hq", "lossless", "hi-res"],
    },
  },
});
```

`sources` is a `Record<string, Source>`, where the key is the [source key](#how-resolution-works) (`wy` / `tx` / `kg`) and the value is a `Source`:

| Source field | Type        | Required | Description                                                         |
| ------------ | ----------- | -------- | ------------------------------------------------------------------- |
| `name`       | `string`    | Yes      | Display name                                                        |
| `actions`    | `Action[]`  | Yes      | `musicUrl`, `musicSearch`, `musicLyric`, `musicPic`, `musicComment` |
| `qualities`  | `Quality[]` |          | Supported qualities, for display only                               |

| Quality    | Meaning                                    |
| ---------- | ------------------------------------------ |
| `hi-res`   | Sample rate ≥96 kHz and bit depth ≥24 bit  |
| `lossless` | FLAC, APE, WAV, or another lossless format |
| `hq`       | Lossy ≥320 kbps                            |
| `sq`       | Lossy ≥192 kbps                            |
| `lq`       | Lossy below 192 kbps                       |

One plugin can register multiple source keys at once, covering several platforms with a single script.

## `splayer.on("musicUrl", handler)`

Registers the `musicUrl` handler, which asynchronously returns a playback URL. Only one handler exists per action; a later registration replaces the previous one.

### Request `req`

```js
{
  source: "wy",
  quality: "hq",
  musicInfo: { /* ... */ },
}
```

The fields actually present on `musicInfo` (`id` / `songmid` / `songId` are three aliases for the same platform track ID, provided for scripts from different eras):

| Field      | Type             | Description                                       |
| ---------- | ---------------- | ------------------------------------------------- |
| `id`       | `string`         | Platform track ID                                 |
| `songmid`  | `string`         | Alias of `id`                                     |
| `songId`   | `string`         | Alias of `id`                                     |
| `name`     | `string`         | Track title                                       |
| `singer`   | `string`         | Artists joined with `/`                           |
| `source`   | `string`         | Source key, same as `req.source`                  |
| `interval` | `string \| null` | Duration as `mm:ss`, or `null` when unknown       |
| `meta`     | `object`         | Additional `albumName`, `albumId`, `picUrl`, etc. |

::: tip
Most source APIs only need `songmid` (the platform track ID) and `quality` to exchange for a URL. `name` / `singer` / `interval` suit validation or logging required by the API.
:::

### Return `res`

| Field     | Type      | Required | Description                              |
| --------- | --------- | -------- | ---------------------------------------- |
| `url`     | `string`  | Yes      | Playback URL                             |
| `quality` | `Quality` |          | Actual quality if downgraded             |
| `expire`  | `number`  |          | URL expiration timestamp in milliseconds |

Behavior conventions:

- The return value must be an object with a **non-empty string `url`**; otherwise the plugin is treated as having failed to resolve, and the player moves to the next candidate plugin.
- When the track cannot be found or the API errors, just `throw` (you may carry an error code on `err.code`); the player likewise moves to the next candidate.
- The handler has a timeout (`musicUrl` defaults to 20 seconds). After the timeout the router cancels the request and reports `PLUGIN_REQUEST_TIMEOUT` (the plugin itself is not notified of the cancellation; `PLUGIN_CANCELLED` is a host-side result code, and late results are discarded by the caller).
- When the requested `quality` is unavailable, you may downgrade to a lower quality and mark the actual value in `res.quality`.

## Supporting multiple platforms

One plugin can register multiple source keys (for example `wy` and `tx` at the same time). Note that **`splayer.on("musicUrl", ...)` can only register one handler** — no matter how many sources are registered, every request enters that single handler. So the handler must use `req.source` to tell which platform this request belongs to and exchange for a URL through the corresponding API:

```js
splayer.register({
  sources: {
    wy: { name: "WY", actions: ["musicUrl"], qualities: ["hq", "lossless"] },
    tx: { name: "TX", actions: ["musicUrl"], qualities: ["hq"] },
  },
});

splayer.on("musicUrl", async (request) => {
  const id = request.musicInfo.songmid;
  const url =
    request.source === "wy"
      ? await resolveWy(id, request.quality)
      : await resolveTx(id, request.quality);
  if (!url) throw new Error("no url");
  return { url, quality: request.quality };
});
```

`resolveWy` / `resolveTx` are yours to implement — each calls its own platform API (typically with [`splayer.request`](./index.md#common-apis)) to obtain a playback URL. The two platforms resolve differently, but both are exposed through the same `musicUrl` handler.

## Metadata fallback {#metadata-fallback}

Besides playback URLs, a source plugin can also **fall back for metadata when a built-in source misses**. Atom's provider and lyric chain prefer the official Core capabilities and only use plugins to supplement already-registered compatibility sources:

- When none of the three built-in platforms matches lyrics, the host falls back to the plugin's `musicLyric` (online-platform tracks and local files are both first matched by title across the three platforms, and the plugin is only reached after all of them miss).
- When a track has **no cover at all** (for example a local file without embedded art), the host falls back to the plugin's `musicPic` to fill in the full-screen player artwork (which also fills the background and color extraction).

This fallback follows **host orchestration, plugin primitives**: you only implement `musicSearch` (find candidates) plus `musicLyric` / `musicPic` / `musicComment` (fetch data); cross-source matching is the host's job.

### Two differences from `musicUrl`

1. **Source keys are not restricted.** `musicUrl` is only called for `wy` / `tx` / `kg`; metadata fallback **works for any key** — the host passes the key you declared through to `musicSearch` unchanged, so platforms the built-ins do not support, such as `kw` / `mg`, can provide lyrics / covers here too.
2. **The host does the matching.** You do not have to judge which search result is this track: the host scores candidates by `name` / `singer` / `durationMs`, where **duration is a hard gate** (if both sides provide a duration and they differ by more than 20 seconds, the candidate is rejected outright), picks the best match, and then calls `musicLyric` / `musicPic` / `musicComment` with it. If the source key you declared happens to match the track's platform (`wy` / `tx` / `kg`), the host skips the search and uses the platform track ID directly.

### Declaring

Add the actions you want to support to the source's `actions`:

```js
splayer.register({
  sources: {
    kw: {
      name: "KW",
      actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"],
    },
  },
});
```

> `musicSearch` is the prerequisite for matching, and is needed for lyrics / covers / comments alike. Comment support is API level 3; see [Plugin Overview](./index.md#api-levels) for the level changelog.

### `musicSearch`

The host calls it first to find candidates for match scoring.

Request: `{ source, keyword, page?, limit? }` — `keyword` looks like `"title artist"`.

Return `{ list: Candidate[] }`, where `Candidate` is:

| Candidate field | Type     | Required | Description                                          |
| --------------- | -------- | -------- | ---------------------------------------------------- |
| `id`            | `string` | Yes      | ID used by later metadata handlers                   |
| `name`          | `string` | Yes      | Track title                                          |
| `singer`        | `string` |          | Artist                                               |
| `album`         | `string` |          | Album                                                |
| `durationMs`    | `number` |          | Duration; strongly recommended for accurate matching |

All additional candidate fields are passed unchanged: the candidate that wins becomes the `musicInfo` handed back to `musicLyric` / `musicPic` / `musicComment`.

::: warning `durationMs` decides match quality
Without `durationMs` the duration gate is ineffective, and a same-name cover or instrumental is easy to match. Fill it in whenever a duration is available.
:::

### `musicLyric`

Request: `{ source, musicInfo }` — `musicInfo` is the `Candidate` the host matched (including `id`). Return:

| Field     | Type     | Required | Description                    |
| --------- | -------- | -------- | ------------------------------ |
| `lyric`   | `string` | Yes      | Main LRC or line-timed lyrics  |
| `tlyric`  | `string` |          | Translation                    |
| `rlyric`  | `string` |          | Romanization                   |
| `awlyric` | `string` |          | Word-timed YRC, QRC, LYS, etc. |

When word-timed `awlyric` is present the host prefers it, and the format is detected automatically. An empty `lyric` is treated as no result and the host moves to the next source.

### `musicPic`

Request: `{ source, musicInfo }`, as above. Return `{ url }` with a direct remote image URL. It supplies both the visible full-screen player cover and the background, so prefer as large an image as possible. An empty `url` is treated as no result.

### `musicComment`

::: warning Requires `@apiLevel 3`
The script header must declare `@apiLevel 3`. See [Plugin Overview · API levels](./index.md#api-levels) for the capabilities added at each level.
:::

Request:

```js
{
  source: "kw",
  musicInfo: { /* matched candidate */ },
  type: "hot",        // "hot" for hot comments / "new" for newest
  page: 1,            // page number, starting at 1
  limit: 20,          // items per page; the host clamps the maximum
}
```

Return:

```js
{
  list: [
    {
      id: "comment-id",
      userId: "user-id",
      userName: "User name",
      avatar: "https://example.com/avatar.jpg",
      text: "Comment text",
      time: 1710000000000,
      location: "Guangdong",
      likedCount: 123,
      reply: [
        { id: "reply-id", userName: "Replied-to user", text: "Reply text" },
      ],
    },
  ],
  total: 1000,
  page: 1,
  limit: 20,
}
```

| Field        | Type        | Required | Description                                                             |
| ------------ | ----------- | -------- | ----------------------------------------------------------------------- |
| `list`       | `Comment[]` | Yes      | Comments on the current page                                            |
| `total`      | `number`    | Yes      | Total comment count, used for pagination                                |
| `page`       | `number`    | Yes      | Current page number                                                     |
| `limit`      | `number`    | Yes      | Items per page on the current page                                      |
| `id`         | `string`    | Yes      | Comment ID                                                              |
| `userName`   | `string`    | Yes      | Comment author name                                                     |
| `text`       | `string`    | Yes      | Comment body                                                            |
| `userId`     | `string`    |          | User ID                                                                 |
| `avatar`     | `string`    |          | User avatar URL                                                         |
| `time`       | `number`    |          | Comment timestamp (ms)                                                  |
| `location`   | `string`    |          | IP region / location                                                    |
| `likedCount` | `number`    |          | Like count                                                              |
| `reply`      | `Comment[]` |          | Embedded reply summaries; paginating nested replies is not required yet |

### Complete metadata example

```js
/**
 * @name     KW Metadata
 * @id       you.kw-metadata
 * @version  1.0.0
 * @type     source
 * @apiLevel 3
 */
splayer.register({
  sources: {
    kw: { name: "KW", actions: ["musicSearch", "musicLyric", "musicPic", "musicComment"] },
  },
});

splayer.on("musicSearch", async ({ keyword }) => {
  const response = await splayer.request(
    `https://api.example.com/search?k=${encodeURIComponent(keyword)}`,
    { responseType: "json" },
  );
  return {
    list: (response.body?.songs ?? []).map((song) => ({
      id: song.rid,
      name: song.name,
      singer: song.artist,
      album: song.album,
      durationMs: song.duration * 1000,
    })),
  };
});

splayer.on("musicLyric", async ({ musicInfo }) => {
  const response = await splayer.request(`https://api.example.com/lyric?id=${musicInfo.id}`, {
    responseType: "json",
  });
  return { lyric: response.body?.lrc ?? "", tlyric: response.body?.tlrc };
});

splayer.on("musicPic", async ({ musicInfo }) => {
  const response = await splayer.request(`https://api.example.com/pic?id=${musicInfo.id}`, {
    responseType: "json",
  });
  return { url: response.body?.cover ?? "" };
});

splayer.on("musicComment", async ({ musicInfo, type, page, limit }) => {
  const response = await splayer.request(
    `https://api.example.com/comment?id=${musicInfo.id}&type=${type}&page=${page}&limit=${limit}`,
    { responseType: "json" },
  );
  return {
    list: (response.body?.comments ?? []).map((item) => ({
      id: String(item.id),
      userName: item.user?.name ?? "",
      avatar: item.user?.avatar,
      text: item.content ?? "",
      time: item.time,
      likedCount: item.likedCount,
    })),
    total: response.body?.total ?? 0,
    page,
    limit,
  };
});
```

### Trigger order

- Lyrics fallback applies to **online-platform tracks, local files, and streaming tracks**. Online tracks come after the three built-in platforms; streaming tracks try server lyrics first; when the built-in or server sources miss, the Web layer tries plugins one by one in plugin-list order (that is, registry / installation order, skipping disabled or not-ready plugins) and the first non-empty result wins (`resolvePluginLyric` in `src/services/lyric/resolve.ts`).
- Cover fallback applies to **any source** (local / online / streaming) and triggers only when the track has **no cover at all**; a track that already has a cover issues no request.
- Comment sources appear in the source dropdown at the top right of the comment dialog; only sources that declare both `musicSearch` and `musicComment` are shown, and the display name uses `sources[key].name`.
- These requests need network access, and source plugins **receive the `network` permission automatically**; no declaration is required.

## Priority

- Multiple source plugins can be **enabled at the same time** for one platform; they do not exclude each other.
- When several enabled plugins support the same platform, the player tries the first ready plugin in registry order (that is, installation / load order); if it fails (throws or returns an empty URL), the next one is tried.
- User-configurable priority ordering (`plugins.priority.*`) is **not implemented yet**: the registry has the lookup but no caller, and neither an HTTP route nor a UI entry can set it.

## Updates

A source plugin declares `@updateUrl` in its script header; the host then checks `@version` and offers the user a one-click in-place update (LX source scripts keep using the runtime `updateAlert`). See [Plugin Updates](./update.md) for the full description.

## LX compatibility

SPlayer Atom Core provides an `lx` compatibility layer that covers the common APIs of [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) `user_api` scripts (`lx.request` / `lx.on("request")` / `lx.send("inited")` / `lx.utils`). The layer is **automatically injected** by Core, so most existing LX source scripts, including `gz_` compressed packages, can be imported and run without any extra declaration.

::: tip
The compatibility layer exists only to support existing LX source scripts, and it covers source capabilities only. When writing **new plugins**, use the `splayer.*` API directly.
:::

## Debugging

When Web Control is served by Core, use the browser DevTools console to call the Core HTTP API directly, without actually playing anything:

```js
await fetch("/api/plugins/resolve-url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    pluginId: "example-splayer",
    source: "wy",
    quality: "hq",
    musicInfo: { songmid: "track-id", name: "Title", singer: "Artist" },
  }),
}).then((response) => response.json());
```

Lyric / cover fallback can also be triggered directly (`track` just needs a Track-shaped object; the plugin ID is available from `GET /api/plugins`):

```js
const track = {
  id: "x",
  source: "local",
  title: "Title",
  artists: [{ name: "Artist" }],
  duration: 269000,
};
const postPlugin = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((response) => response.json());

await postPlugin("/api/plugins/match-lyric", {
  pluginId: "kw-metadata-splayer",
  source: "kw",
  track,
});
await postPlugin("/api/plugins/match-cover", {
  pluginId: "kw-metadata-splayer",
  source: "kw",
  track,
});
```
