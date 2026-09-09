# User Guide

SPlayer Atom consists of one Linux x86-64 Node Core and a browser-based Web Control. After deploying Core, open the Web page served by Core.

## Library

Add music directories from the Core host and start a scan. Directory selection refers to the Core filesystem, not the browser device.

Local search, album/artist aggregation, tag editing, CUE virtual tracks, and SACD stereo virtual tracks are supported.

## Playback and queue

Core owns the queue, current track, repeat/shuffle modes, auto-next, error recovery, and playback position. Refreshing or closing a browser does not move playback authority into Web Control.

## Outputs

The player bar exposes one Core-backed output selector for ALSA, optional Diretta Source Direct, and UPnP Renderer devices.

## Providers

Atom formally maintains Netease, Qobuz, and TIDAL. Credentials and session state belong to Core; Web Control consumes only token-free session projections.

See [Streaming Services](/en/streaming) for self-hosted media servers.

## Lyrics

LRC, QRC, YRC, and TTML presentation is supported, including translation, romanization, word timing, and offsets. Web rendering never becomes playback authority.

## Downloads and cache

Download and cache directories live on the Core host. Web Control selects Core directories and does not save media to the browser device.

## Plugins

Plugins run in an isolated Core child process and can extend source resolution and playback control. See [Using Plugins](/en/plugins-usage) and [Plugin Development](/en/plugins/).

## Multiple controls

Multiple browsers may connect to one Core and share the same queue/session/output projection.
