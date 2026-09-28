# Qobuz / TIDAL Rust protocol engine guide

> Last updated: 2026-09-28

`native/streaming-api` is the **only platform protocol implementation** for Qobuz / TIDAL used by the official Atom Node Core. It is not a second Core, nor a separate Headless product: the Node Core still holds provider sessions, user credential persistence, Core events, Track/domain normalization, playback policy, cache and recovery; Rust is responsible only for platform protocols, authentication flows, signing, request/response parsing and playback source resolution.

The official call relationship:

```text
Web Control
        -> Node Core providerApi
        -> qobuz/index.ts | tidal/index.ts
        -> streaming-api.node
        -> native/streaming-api
        -> Qobuz / TIDAL
```

Do not restore the TypeScript HTTP/signature/DASH fallback, and do not let the Rust provider build a second account/session database of its own.

---

## 1. Qobuz

Qobuz is provided according to the current implementation.

### 1.1 Signing and Query / Header boundaries

`track/getFileUrl` uses an MD5 request signature:

```text
request_sig = md5(object + method + sorted_business_params + request_ts + working_secret)
```

The signature input contains only the business parameters required by the platform. `app_id`, `user_auth_token`, `request_ts` and `request_sig` must not be mistakenly mixed into the business parameter sorting. Authentication information follows the header/query positions of the current implementation.

### 1.2 App credential discovery

The Qobuz Web Player bundle changes between versions, so a fixed bundle URL cannot be relied on. The current implementation dynamically discovers the app id / initialization secret candidate through the Web Player Bundle path and caches successful results only within the current process.

Constraints:

- Does not read `~/.config/qobuz-dl`;
- Does not require `qobuz-dl` to be installed;
- A discovered app secret is not written into Atom configuration or the database;
- Explicit `QOBUZ_APP_ID` / `QOBUZ_APP_SECRET` can serve as runtime environment overrides;
- When dynamic discovery fails, only the compatibility parameters in the repository are used; the secret is never guessed from an arbitrary bundle string.

### 1.3 Login flow and Core session

The preferred entry point in Web Control is browser OAuth: the Rust `auth_oauth_start` first starts a one-shot callback listener and generates the authorization URL using a hostname the browser can reach for the Core, a dynamic port, a random callback path and state; `auth_oauth_await` waits for the authorization code, exchanges the token and queries the user. A new authorization cancels the old listener, and the listener also has a timeout. For cross-machine login the browser must be able to reach the Core's callback port. The manual entry point requires only `user_auth_token`, and Rust validates it and obtains the user ID through `user/get`; the email-password entry point is not exposed in Web Control.

The Rust `QobuzClient` can hold `user_auth_token` / `user_id` within a single call, but they are injected by the Node Core. `core/apis/qobuz/auth.ts` writes the login result into the Core's `0600` credential file, and `/providers/sessions` projects only the status without tokens. The current Core secret codec only performs Base64 encoding and does not provide encryption at rest.

```text
Node Core credential file / session
        -> per-call auth context
        -> Rust QobuzClient
        -> remote API
```

Rust does not create a separate account store and does not publish Core provider session events. Real-account acceptance of the flows above is still performed according to the [provider acceptance record](./live-provider-acceptance.md).

### 1.4 Playback source

The platform protocol for `track_getFileUrl` / `song_url` is implemented only in Rust. Rust returns the platform result, and the thin Node adapter normalizes it into the existing Core contract; the final quality policy, cache key, materialization and playback recovery are still decided by the Core `PlaybackSourceResolver`.

---

## 2. TIDAL

### 2.1 Client credential / redirect

The official implementation reuses the TIDAL client credential / redirect parameters that atom-base has already validated against the real service. Apart from explicit environment overrides, these parameters are part of the `native/streaming-api` protocol implementation; do not copy a second set of constants or an auth flow in Node/Control.

The Node Core persists only user-side information, such as access token, refresh token, user id, country code and the session context needed for a later refresh. The platform Authorization Code / PKCE, Device Code, token exchange and refresh protocols are all executed by Rust.

### 2.2 PKCE

The currently validated authorization flow includes a PKCE verifier/challenge and the established redirect. The authorization URL parameters must stay consistent with the validated client behavior; in particular, do not add scopes or rewrite the redirect/client identity at will. Any change requires re-acceptance of entitlement and Hi-Res playback with a real account.

### 2.3 Device Code

The verification URI returned by the TIDAL Device Code may have no scheme. The protocol layer should return a complete URL that Control can open safely, and must not let the browser treat `link.tidal.com/...` as a relative path of the Atom Core.

### 2.4 Token refresh and persistence boundary

The refresh request is performed by the Rust protocol engine; after the new token response returns to Node, the Node Core updates its single auth state / SecretStore. Rust does not write tokens into files of its own.

Expiry times use millisecond timestamps uniformly in the Node Core contract; if a Rust API response uses seconds or `expiresIn`, it may be normalized only once at the thin adapter boundary.

### 2.5 API pagination

Some TIDAL list endpoints have a strict upper bound on the per-page `limit`. The protocol implementation must respect the platform limits inside Rust; when more results are needed, fetch them through offset pagination, and do not send an invalid oversized limit to the remote as-is.

### 2.6 BTS / DASH playback

TIDAL playback info may return a direct URL, a BTS manifest or an MPEG-DASH MPD. The official handling is all in Rust:

```text
playback info
  -> direct URL / BTS -> stream URL
  -> DASH MPD         -> parse SegmentTemplate/Timeline
                         -> download init + media fragments
                         -> Core temp file
                         -> localPath
```

The current DASH implementation accepts only the explicitly validated Number-based `SegmentTemplate` form. `$Time$`, infinite repeat or a template that cannot be determined fails explicitly; segments must not be guessed, silently degraded to a low-quality TS path, or handled by restoring the old JavaScript materializer.

DASH materialization is only lossless container-level concatenation and does not participate in audio sample processing; whether the result later enters normal output or strict Diretta Source Direct is decided by the Core/audio-engine.

---

## 3. N-API boundary

`streaming-api.node` exposes only one narrow entry point, `callStreamingProvider(platform, action, auth, params)`. Do not add a Rust-side Provider Registry, SessionManager or a second Core domain model.

The responsibilities of the Node adapter are limited to:

- assembling this call's authentication context from the Core auth state;
- calling the single Rust protocol engine;
- normalizing the Rust private response shape into the existing Core provider contract;
- updating the Node Core auth state after a successful login/token refresh.

Web Control should not know that `streaming-api.node` exists and uses only the unified Core Control Protocol.

---

## 4. Boundary with the audio engine

`streaming-api` does not process PCM/DSD and does not own playback state. After online platform URL/manifest resolution completes, the Core decides whether to cache/materialize and calls the single audio implementation:

```text
Node Core PlaybackSourceResolver
        -> audio-engine.node
        -> audio-engine-core
             -> normal f32/DSP output
             -> strict Diretta Source Direct
```

The Qobuz/TIDAL protocol layer must not build its own player or Diretta connection in order to "pass through".

---

## 5. Acceptance gate

After modifying the TIDAL protocol implementation, run at least:

```text
cargo test -p streaming-api
pnpm typecheck
pnpm test:node
pnpm test:web
```

The official Core must also verify that both `audio-engine.node` and `streaming-api.node` are built, loaded and staged by the no-SDK Core artifact; a Diretta release is accepted separately under the controlled SDK/hardware gate.

Real-account acceptance focuses on:

- TIDAL PKCE or Device Code, token refresh, search/catalog;
- both TIDAL BTS and DASH playback paths;
- normal output and Diretta both entering through the same Core source resolver;
- provider errors not being hidden by a second JS fallback.

There are only two final principles: **the Qobuz/TIDAL platform protocol has exactly one implementation, in Rust; the Provider/Core authority has exactly one owner, the Node Core.**
