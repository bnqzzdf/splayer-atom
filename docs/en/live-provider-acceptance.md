# SPlayer Atom live provider acceptance

> Last updated: 2026-09-28

This document defines the real-account acceptance records for Netease, QM, KG, Qobuz and TIDAL. Static tests, mocks, public metadata queries and credential-free software harnesses cannot mark these items complete.

Status (repository record, 2026-09-23): Core/Web have integrated the five platforms; QM/KG QR-code login, Cookie, search, detail and Core source paths, as well as Qobuz browser OAuth and token-only login, are implemented.
These new paths have not yet completed real-account acceptance against a candidate package from this repository. Passing artifact startup acceptance in both Debian 11 modes does not equal platform-account or audio-hardware acceptance. Section 12 "real hardware" of the [UPnP plan](./upnp-output-plan.md) records part of the real online playback for Netease/TIDAL, and Section 7 of the [Qobuz OAuth plan](./qobuz-oauth-plan.md) records the real-hardware verification result for Qobuz browser OAuth; they belong to the records of their respective plans and do not replace this document's candidate-package acceptance matrix;
this document still has no candidate-package acceptance result covering the full matrix below,
and see also the [Roadmap](./atom-roadmap.md).

## 1. Common prerequisites

- Use a candidate artifact with a recorded SHA256, Atom commit, `sourceDirty=false`, Core protocol and capability.
- Use a real account, real entitlements and the real network authorized by the acceptor; do not write accounts, cookies, tokens or Authorization into commands, fixtures, screenshots, logs, documents or Git.
- Web Control only sends Core Control commands and consumes snapshots/events; the final playable URL, refresh, retry, skip, cache and Diretta materialization are still held by the Core.
- Normal output uses real ALSA hardware; Diretta uses a root Host and a real Target. A software fake output does not count as live acceptance.
- Record `PASS`, `FAIL` or `BLOCKED` for each item. Insufficient entitlement, regional restrictions, an account not being provided, unavailable hardware and server-side limits should all be recorded as `BLOCKED` and must not be disguised as passing.

You may first run the read-only diagnostics to record the release identity, outputs and sanitized session:

```bash
pnpm check:hardware-release -- --base-url http://127.0.0.1:14558
```

## 2. Netease

### Account / pages

- Login status is correctly synchronized from the Core to Web Control.
- Favorites first load, paging/refresh and favorite changes are visible in Headless Web.
- Daily Recommendations can be loaded, refreshed and added to the canonical Core queue.
- Cloud can be paged and played; deletion is performed only on test entries the acceptor explicitly authorized, and it is verified that Web Control can see the Core's latest result.
- After logout the Core session and page state are consistent, and Web Control retains no usable credential.

### Playback

- Free, VIP/SVIP and the different available qualities enter the same Core playback entry.
- A `fee=4` purchase-required Track is explicitly classified and is not attempted as an ordinary VIP URL.
- A three-track online queue plays continuously, with Core auto-next after native-ended.
- An expired URL permits only one fresh resolve of the same Track; if it keeps failing, advance according to Core policy.
- Verify once each on ALSA and Diretta; Diretta online input is exact-byte materialized first, and the DAC/Target indication matches the source format.
- scrobble/play statistics are persisted once by the Core after real playback ends and are not duplicated by the number of Control requests.

## 3. QM / KG

- Verify QR-code login, manual Cookie, session projection after restart and logout separately; Web Control does not persist credentials and the status projection does not contain the Cookie.
- Anonymous search for tracks, albums, artists, playlists and detail paging returns the correct canonical Track.
- For a logged-in account, verify the full-track direct link, quality tiers and three-track continuous queue playback separately; without the plugin it goes through Core source resolution, and with the plugin the fallback is verified.
- No entitlement and preview snippets give the corresponding reason; when preview is not allowed, the snippet must not be played as the full track or cached.
- Verify an available lossless track on ALSA and Diretta each, recording the actual source format and output result.

## 4. Qobuz

- Initiate browser authorization from another Web Control device and verify that the callback can reach the Core's dynamic port, the random path and state validation, and automatic session update; after repeated initiation, cancellation or timeout the callback listener is closed.
- The paste-token entry still works, and when only a token is given the user identity can be confirmed from the server.
- search → detail → queue → playback use real account results; preview snippets obey the preview setting.
- Verify an available lossless track and three-track continuous queue playback on ALSA and Diretta each.

## 5. TIDAL

- The real-account session and subscription/quality entitlement are stored by the Core and correctly synchronized to Web Control.
- The full search → detail → queue → playback chain uses real results.
- Accept the two real playback paths, JSON/BTS and DASH, separately; record the path and quality actually hit.
- Core-owned auto-next and continuous playback pass for a three-track queue.
- JSON/BTS and DASH each cover real ALSA; the product-supported lossless/hi-res paths additionally cover Diretta.
- entitlement, regional or manifest limits must be reported explicitly; silently degrading to another path and marking it as passing is not allowed.

## 6. Record template

```text
Provider: Netease | QM | KG | Qobuz | TIDAL
Result: PASS | FAIL | BLOCKED
Date/timezone / operator:

Artifact SHA256:
Atom version / commit / sourceDirty:
Core protocol / capability:
Provider capability:
Account tier (not an account identifier):
Region (only when relevant to entitlement):

Scenario:
Control surface: Web Control
Source metadata: codec / rate / bits / channels / duration
Output: ALSA device | Diretta Target
Queue length / observed auto-next:
Expected result:
Observed result:
Sanitized error / BLOCKED reason:
Notes:
```

Do not record usernames, email addresses, user IDs (unless irreversibly sanitized and genuinely necessary), cookies, tokens, Authorization, the final playable URL, private file paths or complete provider responses. After acceptance is complete, submit only the sanitized conclusion and the minimal reproduction information.
