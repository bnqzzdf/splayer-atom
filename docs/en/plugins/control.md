# Control Plugins

> Last updated: 2026-09-28

A control plugin (`@type control`) does not provide audio sources. The current Atom Core supports three practical capabilities:

- reverse playback control through `splayer.player.*`;
- plugin-owned settings rendered and persisted by **Settings → Plugin Management**;
- custom track-menu actions.

Read [Plugin Overview and Architecture](/en/plugins/) first for the shared network, storage, logging, and permission model.

::: warning Playback events are not currently published
The protocol still retains `register({ events })` and `splayer.player.on(...)` for compatibility and future evolution, but the current Atom Core **does not push** `trackChange`, `lyricChange`, `lineChange`, or `playStateChange` to plugins. New plugins should not depend on event subscriptions, and should not replace them with high-frequency `getPosition()` polling.
:::

## Requirements

Control plugins must declare `@type control` and use `@apiLevel 2` or newer. Sensitive capabilities require explicit grants:

| Grant     | Capability                             |
| --------- | -------------------------------------- |
| `network` | `splayer.request(...)`                 |
| `control` | `splayer.player.*`                     |
| `ui`      | `register({ menus })` track-menu items |

## Quick start

This plugin exposes one setting and one track-menu action. Clicking the action optionally pauses playback.

```js
/**
 * @name        Example Control
 * @id          you.example-control
 * @version     1.0.0
 * @type        control
 * @apiLevel    2
 * @grant       control ui
 */

splayer.register({
  controls: true,
  settings: [
    {
      key: "pauseOnAction",
      type: "switch",
      label: "Pause when the menu action runs",
      default: true,
    },
  ],
  menus: [{ id: "pause", label: "Plugin: Pause playback" }],
});

splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId !== "pause") return;
  if (splayer.getSetting("pauseOnAction")) splayer.player.pause();
  return { toast: `Handled: ${track.title}` };
});
```

Host the script at an HTTPS raw URL and install it from **Settings → Plugin Management → Import from URL**.

## `splayer.register(args)`

Fields with real effects in the current Core:

| Field      | Type                  | Meaning                                                               |
| ---------- | --------------------- | --------------------------------------------------------------------- |
| `controls` | `boolean`             | Declares reverse playback control                                     |
| `settings` | `PluginSettingItem[]` | User settings rendered in Plugin Management                           |
| `menus`    | `PluginMenuItem[]`    | Track-menu items; requires `@grant ui`                                |
| `events`   | `PlaybackEventKind[]` | **Compatibility-only**; current Core does not publish playback events |

## Reverse playback control

With `@grant control`, a plugin can call:

| Method                     | Meaning                                  |
| -------------------------- | ---------------------------------------- |
| `player.play()`            | Play                                     |
| `player.pause()`           | Pause                                    |
| `player.next()`            | Next track                               |
| `player.prev()`            | Previous track                           |
| `player.seek(positionMs)`  | Seek to a millisecond position           |
| `player.setVolume(volume)` | Set volume, `volume ∈ [0, 1]`            |
| `player.getPosition()`     | `Promise<number>` for occasional queries |

All methods except `getPosition()` are fire-and-forget. Invalid arguments are ignored. `getPosition()` crosses the process boundary and is intended for occasional queries, not continuous polling.

## Settings

Control plugins can declare simple settings:

```js
splayer.register({
  settings: [
    { key: "token", type: "text", label: "Access token", default: "" },
    { key: "interval", type: "number", label: "Interval", default: 30, min: 5, max: 600 },
    { key: "enabled", type: "switch", label: "Enabled", default: true },
    {
      key: "mode",
      type: "select",
      label: "Mode",
      default: "auto",
      options: [
        { label: "Auto", value: "auto" },
        { label: "Manual", value: "manual" },
      ],
    },
  ],
});
```

Supported control types are `switch`, `number`, `text`, and `select`. Core validates and persists values according to the schema.

Read and observe settings with:

```js
const enabled = splayer.getSetting("enabled");

splayer.onSettingChange("enabled", (value) => {
  splayer.log.info("Enabled:", value);
});
```

## Track-menu extensions

With `@grant ui`, a plugin can contribute track-menu actions:

```js
splayer.register({
  menus: [
    { id: "open", label: "Open on website" },
    { id: "local-only", label: "Local tracks only", sources: ["local"] },
  ],
});

splayer.on("menuClick", async ({ menuId, track }) => {
  if (menuId === "open") {
    return { openUrl: `https://music.example.com/song/${track.id}` };
  }
});
```

`menuClick` may return:

| Field      | Effect                       |
| ---------- | ---------------------------- |
| `toast`    | Show a short notification    |
| `openUrl`  | Open an `http` / `https` URL |
| `copyText` | Copy text to the clipboard   |

Menu handlers run in the plugin sandbox, with no DOM and no custom-window capability.

## Updates

Declare `@updateUrl` to let Core compare the remote `@version`. In-place updates preserve enabled state, settings, and plugin storage. See [Plugin Updates](/en/plugins/update).

## Debugging

When Web Control is served by Core, call the Core HTTP API directly from browser DevTools:

```js
await fetch("/api/plugins").then((response) => response.json());

await fetch("/api/plugins/you.example-control/setting", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ key: "pauseOnAction", value: false }),
}).then((response) => response.json());
```

Plugin logs are written through Core logging. See [Plugin Overview and Architecture](/en/plugins/) for sandbox restrictions and error codes.
