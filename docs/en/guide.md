# User Guide

SPlayer Atom is adapted from SPlayer-Next and consists of one Linux x86-64 Node Core plus a browser-based Web Control. After deploying Core, open the Web page served by Core.

## Library

Add music directories from the Core host and start a scan. Directory selection refers to the Core filesystem, not the browser device.

Local search, album/artist aggregation, tag editing, CUE virtual tracks, and SACD stereo virtual tracks are supported.

## Playback and queue

Core manages the queue, current track, repeat/shuffle modes, auto-next, error recovery, and playback position. Refreshing or closing a browser does not interrupt playback running in Core.

## Outputs

The player bar exposes one Core-backed output selector for ALSA, optional Diretta Source Direct, and UPnP Renderer devices.

## Providers

Atom supports Netease, Qobuz, and TIDAL. Credentials stay in Core; Web Control only receives login status and never exposes account tokens to the page.

See [Streaming Services](/en/streaming) for self-hosted media servers.

## Lyrics

LRC, QRC, YRC, and TTML presentation is supported, including translation, romanization, word timing, and offsets. Lyrics rendering in the browser does not affect the playback process in Core.

## Downloads and cache

Download and cache directories live on the Core host. Web Control selects Core directories and does not save media to the browser device.

## Plugins

Plugins run in an isolated Core child process and can extend source resolution and playback control. See [Using Plugins](/en/plugins-usage) and [Plugin Development](/en/plugins/).

## Multiple controls

Multiple browsers may connect to one Core and stay synchronized with the same queue, login status, and output selection.
