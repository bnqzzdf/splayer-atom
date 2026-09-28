# Using Plugins

> Last updated: 2026-09-28

SPlayer Atom keeps the plugin model inherited from SPlayer-Next and runs it in Node Core. Plugins can extend **music sources** (resolve playable track URLs) and **control** (reverse playback control, plugin settings, and track-menu actions). SPlayer-Next plugins that do not depend on Desktop/Electron-only APIs and stay within the currently documented API can generally continue to work. This page is for plugin users. Authors should start with [Plugin Development](/en/plugins/).

## Opening plugin management

Open **Settings → Plugin Management**. Each installed plugin card shows its name, version, author, runtime state, and supported sources.

## Installing a plugin

Web Control installs plugins **from URL only**. Paste an HTTPS URL to a `.js` file, such as a GitHub or Gitee raw URL; Core downloads, validates, and installs the script without requiring a local file picker on the Core host.

Scripts distributed with a `gz_` prefix are detected and decompressed automatically.

## Enable, disable, and uninstall

- Newly installed plugins are enabled automatically.
- Multiple plugins may be enabled at once. If several support the same source, Core tries them in registry order (installation/load order); a user-configurable priority is not implemented yet.
- A control plugin can expose settings from its plugin card.
- **Uninstalling deletes the script and its local data and cannot be undone.**

States are **Ready**, **Loading**, **Error** (with a reason), and **Disabled**.

## SPlayer-Next / LX compatibility

Atom's native plugin API is derived from the SPlayer-Next plugin system and now runs in Node Core. Plugins that use the documented `splayer` API can continue to run in Atom.

Core also supports [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) `user_api` scripts. Most public LX scripts can be installed directly from a raw URL. Scripts that depend on unsupported APIs, Electron/DOM, or other host-specific capabilities may fail to load.

## Troubleshooting

**Why is the plugin in Error state?**  
Read the error shown on its card. Common causes are syntax/runtime errors or an API level newer than the installed app supports.

**Can a plugin crash the app?**  
Plugins run in an isolated host process. Failures are contained and the host is restarted automatically.

**Why are plugin requests slow?**  
Plugin network requests follow the system proxy. Performance depends on the destination and network conditions.
