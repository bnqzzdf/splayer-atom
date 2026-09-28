# Plugin Overview and Architecture

> Last updated: 2026-09-28

SPlayer Atom Core runs third-party JavaScript plugins in isolated sandboxes. A plugin interacts with Core only through the injected global `splayer` object.

This plugin model is inherited from SPlayer-Next and adapted for the Web + Core runtime. Atom does not operate a plugin market; authors host their own scripts and users install them from raw HTTPS URLs.

- [Source plugins](./source.md) resolve playable URLs and can provide fallback lyrics, covers, and comments.
- [Control plugins](./control.md) control the player, expose settings, and add track menu items.
- [Plugin updates](./update.md) describes update metadata and in-place upgrades.

End users should see [Using Plugins](../plugins-usage.md).

## Plugin types

| Type                           | `@type`   | Purpose                                                   |
| ------------------------------ | --------- | --------------------------------------------------------- |
| [Source plugin](./source.md)   | `source`  | Provide playable URLs and metadata fallbacks              |
| [Control plugin](./control.md) | `control` | Extend playback control, settings, and track-menu actions |

A script has one type, selected by `@type`; the default is `source`.

## Distributing plugins

Atom does not maintain a plugin market. Authors can host a script on GitHub, Gitee, or another HTTPS location and share its raw `.js` URL. Declare a stable `@updateUrl` in the manifest so installed plugins can still check for and apply updates from **Settings → Plugin Management**. See [Plugin Updates](./update.md).

## Architecture

### Process model

All enabled plugins share a dedicated plugin-host process. Each plugin runs in its own `node:vm` context. The process boundary prevents scripts from reading application memory or another plugin's data.

```text
┌──────────────── SPlayer Atom Core ────────────────┐
│        Player · plugin manager · network · storage     │
└─────────────────────────┬──────────────────────────────┘
                          │ messages routed by pluginId
               ┌──────────▼───────────┐
               │ plugin host process  │
               │  ┌────────┐ ┌──────┐ │
               │  │Plugin A│ │Plugin B│ │ separate vm contexts
               │  └────────┘ └──────┘ │
               └──────────────────────┘
```

- One plugin error does not crash the main UI or audio playback.
- Do not block or create infinite loops. Plugins share the host event loop, so one blocked script can force the watchdog to restart the entire host.
- Persist plugin-private data only through `splayer.storage`.

### Interaction models

A **source plugin is called** when the player needs a URL or metadata. A **control plugin** can expose settings and track-menu actions and, with permission, call `splayer.player.*` back into the player. The `events` / `splayer.player.on(...)` surface remains for protocol compatibility, but the current Atom Core does not publish playback events to plugins. New plugins should not depend on it.

### Lifecycle and states

```text
install → parse manifest → enable → create vm → run → register() → ready
        → host crash → reload all enabled plugins → ready
        → disable → dispose context → disabled
        → uninstall → remove script and local data
```

| State      | Meaning                                       |
| ---------- | --------------------------------------------- |
| `loading`  | Started and waiting for registration          |
| `ready`    | Available                                     |
| `error`    | Load/runtime failure or repeated host crashes |
| `disabled` | Disabled by the user                          |

The host restarts after crashes or hangs using 2s, 8s, and 30s backoff. Only the fourth loss (more than three restart attempts) marks the plugins as `error`. A single plugin runtime failure affects only that plugin.

## Manifest

Metadata is declared in a leading JSDoc block:

```js
/**
 * @name        Example
 * @id          you.example
 * @version     1.0.0
 * @description Example plugin
 * @author      you
 * @homepage    https://example.com
 * @type        source
 * @apiLevel    2
 */
```

| Field          | Required | Description                                                                    |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `@name`        |          | Display name, max 64 characters; a compatibility name is generated if omitted  |
| `@version`     |          | Version; defaults to `0.0.0`                                                   |
| `@id`          |          | Stable identity, preferably reverse-domain style; derived from name if omitted |
| `@description` |          | Summary                                                                        |
| `@author`      |          | Author                                                                         |
| `@homepage`    |          | Homepage URL                                                                   |
| `@grant`       |          | Comma-separated `network`, `control`, and `ui` permissions                     |
| `@type`        |          | `source` (default) or `control`; explicit declaration recommended              |
| `@apiLevel`    |          | Required host API level; current level is `3`                                  |
| `@updateUrl`   |          | Update script URL                                                              |
| `@changelog`   |          | Release notes                                                                  |

::: warning Stable identity
Native SPlayer plugins should explicitly declare `@name`, `@version`, and `@id`. Identity uses `@id` when present and otherwise derives from the name. Re-importing the same identity replaces the existing plugin. Change the version and code for a release, not the ID or fallback name.
:::

## Permissions

| Permission | Gated API             | Capability        |
| ---------- | --------------------- | ----------------- |
| `network`  | `splayer.request`     | HTTP requests     |
| `control`  | `splayer.player.*`    | Control playback  |
| `ui`       | `register({ menus })` | Add UI menu items |

- Source plugins receive `network` automatically.
- Control plugins must declare each sensitive capability through `@grant`.
- Without permission, requests fail with `PLUGIN_PERMISSION_DENIED`, player controls are ignored, and menu declarations are discarded.

## API levels

Capabilities accumulate: a higher level includes all lower levels.

| Level | New capabilities                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `1`   | Source registration, `musicUrl`, `musicSearch`, `musicLyric`, `musicPic`, and common APIs                                         |
| `2`   | Reverse playback control, settings, `onSettingChange`, menus, and `menuClick`; `events` is compatibility-only in the current Core |
| `3`   | `musicComment`; the host searches for a candidate before requesting comments                                                      |

The current host level is **3**. A plugin requiring a newer level is rejected with `PLUGIN_API_LEVEL_MISMATCH`. Declare the lowest level actually used. Control plugins require at least level 2; comment plugins require level 3.

## Sandbox environment

- No Node built-ins, `require`, `import`, DOM, or browser-host API.
- Available globals include `splayer`, `Buffer`, URL APIs, text encoders, Base64 APIs, promises, microtasks, timers, and a forwarded `console`.
- Network access is available only through `splayer.request` and only for HTTP(S).
- Top-level synchronous execution has a ten-second limit. Put expensive work in asynchronous handlers.

## Common APIs

### Properties

| Property             | Type     | Description                           |
| -------------------- | -------- | ------------------------------------- |
| `splayer.pluginId`   | `string` | Assigned plugin ID                    |
| `splayer.apiLevel`   | `number` | The plugin's own declared `@apiLevel` |
| `splayer.locale`     | `string` | UI locale such as `en-US`             |
| `splayer.appVersion` | `string` | Application version                   |

### `splayer.request(url, options?)`

Sends an HTTP(S) request through the system proxy.

| Option         | Type                                  | Default  | Description               |
| -------------- | ------------------------------------- | -------- | ------------------------- |
| `method`       | `"GET" \| "POST"`                     | `"GET"`  | HTTP method               |
| `headers`      | `Record<string, string>`              | —        | Request headers           |
| `body`         | `string \| ArrayBuffer \| Uint8Array` | —        | Request body              |
| `timeout`      | `number`                              | `15000`  | Milliseconds, max `60000` |
| `responseType` | `"text" \| "json" \| "arraybuffer"`   | `"text"` | Response parsing          |

The promise resolves to `{ status, headers, body }`. An array-buffer response is exposed as `Uint8Array`.

```js
const response = await splayer.request("https://api.example.com/song?id=1", {
  headers: { "User-Agent": "..." },
  responseType: "json",
});
console.log(response.status, response.body);
```

### `splayer.storage`

Private per-plugin key-value storage, removed when the plugin is uninstalled.

| Method                    | Result               |
| ------------------------- | -------------------- |
| `storage.get(key)`        | `Promise<T \| null>` |
| `storage.set(key, value)` | `Promise<void>`      |
| `storage.remove(key)`     | `Promise<void>`      |
| `storage.keys()`          | `Promise<string[]>`  |

### `splayer.getSetting(key)`

Synchronously reads a plugin setting or returns `undefined`. Control plugins declare settings during registration.

### `splayer.log`

`debug`, `info`, `warn`, and `error` methods are forwarded to the host log. `console.*` uses the same channel.

### `splayer.utils`

| Namespace      | Methods                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `utils.crypto` | `md5`, `sha1`, `sha256`, `hmac`, `randomBytes`, `aesEncrypt`, `aesDecrypt`, `rsaEncrypt` |
| `utils.buffer` | `from`, `bufToString`, `concat`                                                          |
| `utils.base64` | `encode`, `decode`                                                                       |
| `utils.zlib`   | `inflate`, `deflate`, `gunzip`, `gzip`                                                   |

## Limits and security

| Limit                   | Value      |
| ----------------------- | ---------- |
| Host load timeout       | 10 seconds |
| Top-level execution     | 10 seconds |
| Default request timeout | 15 seconds |
| Maximum request timeout | 60 seconds |
| Remote import size      | About 9 MB |

::: warning A stability boundary, not a security boundary
Process isolation protects the main app from failures, not from malicious intent. A plugin runs with your user permissions, can access the network, and can persist data. Installing a plugin means trusting it like any other program.
:::

## Data storage

```text
{userData}/app-data/plugins/
├── scripts/        installed JavaScript files
├── data/           per-plugin storage
└── manifest.json   installed plugin metadata
```

Moving the portable edition's complete `app-data` directory preserves all plugins and data.

## Error codes

| Code                        | Meaning                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `PLUGIN_UNKNOWN`            | Unknown error                                                                                     |
| `PLUGIN_NOT_FOUND`          | Plugin not found                                                                                  |
| `PLUGIN_DISABLED`           | Plugin is disabled                                                                                |
| `PLUGIN_NOT_READY`          | Plugin is not ready                                                                               |
| `PLUGIN_ACTION_UNSUPPORTED` | Handler not registered                                                                            |
| `PLUGIN_LOAD_TIMEOUT`       | Load timeout (fork to ready signal)                                                               |
| `PLUGIN_SCRIPT_ERROR`       | Syntax or runtime error                                                                           |
| `PLUGIN_INVALID_MANIFEST`   | Invalid manifest field                                                                            |
| `PLUGIN_API_LEVEL_MISMATCH` | Incompatible level (newer than host, or a control plugin below 2)                                 |
| `PLUGIN_REQUEST_TIMEOUT`    | Request timeout                                                                                   |
| `PLUGIN_CANCELLED`          | Cancelled, for example after a track change                                                       |
| `PLUGIN_NETWORK_ERROR`      | Network error                                                                                     |
| `PLUGIN_URL_NOT_ALLOWED`    | Disallowed URL scheme                                                                             |
| `PLUGIN_PERMISSION_DENIED`  | Missing permission such as `network` or `control`                                                 |
| `PLUGIN_WORKER_CRASHED`     | Host process crashed                                                                              |
| `PLUGIN_HANDLER_ERROR`      | Default handler error                                                                             |
| `PLUGIN_INVALID_RESULT`     | Invalid handler result; thrown only by the lx compatibility layer, not part of `PluginErrorCodes` |

## Debugging

When Web Control is served by Core, the browser DevTools console can call the Core HTTP API directly:

```js
await fetch("/api/plugins").then((response) => response.json());

await fetch("/api/plugins/resolve-url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    pluginId: "my-plugin-splayer",
    source: "wy",
    quality: "hq",
    musicInfo: { songmid: "123" },
  }),
}).then((response) => response.json());

await fetch("/api/plugins/my-plugin-splayer/setting", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "someKey", value: true }),
}).then((response) => response.json());
```

Plugin logs are written to `{userData}/app-data/logs/`. Re-import a modified script to replace the old version.
