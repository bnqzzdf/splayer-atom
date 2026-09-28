# Streaming Services

> Last updated: 2026-09-28

In addition to local music and online providers, SPlayer Atom Core can connect to self-hosted streaming servers and browse your private library.

## Supported services

| Type                | Description                                                           |
| ------------------- | --------------------------------------------------------------------- |
| **Subsonic family** | Navidrome, OpenSubsonic, Airsonic, Gonic, LMS, and compatible servers |
| **Jellyfin**        | Open-source media server                                              |
| **Emby**            | Media server                                                          |

> Subsonic-compatible services share the same protocol and differ only by their UI label.

## Adding a server

1. Open **Settings → Media Sources** and turn on the **Enable streaming** switch.
2. Add a server and select a type (Navidrome, OpenSubsonic, Airsonic, Gonic, LMS, Subsonic, Jellyfin, or Emby — eight in total).
3. Enter its URL, username, and password.
4. On save, Core activates and connects automatically only when there is no active server yet (the first server); an additional server is not connected automatically and must be switched to manually. Once connected, its tracks, albums, artists, and playlists are exposed to Web Control.

You can configure and switch between multiple servers. Browsing data is cached locally for faster subsequent access.

::: tip Credential security
Core stores the server password in a credential file with `0600` permissions. The current Base64 encoding is not encryption. Web Control receives server settings without the password. Protect the Core host and its data directory.
:::

## Troubleshooting

- **Connection failed:** Verify the protocol (`http://` or `https://`), port, username, and password.
- **Track will not play:** Check that the server can transcode or return a direct URL and that it is reachable from this device.
