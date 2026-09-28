# Qobuz one-click OAuth login · implementation plan (ready to execute)

> Last updated: 2026-09-28

> Status: **implemented and verified end-to-end on real hardware** (2026-09-23, target machine `10.0.0.190`).
> The unknowns in Section 2 have been resolved (see rows #9~#11 below); the real response shape of a
> **successful** exchange has also been measured, see "7. Real-hardware verification results".
>
> Target UX: Settings → "Online platform accounts" → Qobuz → click "Log in with browser" once →
> log in normally in the browser → **completes automatically**. No Console, no F12, no copy-paste.

---

## 1. Established facts (all backed by measurements; do not overturn and re-investigate)

| #   | Fact                                                                                                | Evidence                                                                                                                                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Authorization endpoint = `https://www.qobuz.com/signin/oauth`, params `ext_app_id` + `redirect_url` | base64-decoded result of the link the user provided                                                                                                                                                                                                |
| 2   | app_id = `798273057` (same as the web player)                                                       | confirmed by the user via F12                                                                                                                                                                                                                      |
| 3   | Callback parameter name = **`code_autorisation`** (8 characters, single use)                        | measured landing URL: `https://play.qobuz.com/discover?code_autorisation=HUukQqWc`                                                                                                                                                                 |
| 4   | `redirect_url` **is honored** (the callback happens at that address)                                | same as above; the callback target is exactly the address given in the URL                                                                                                                                                                         |
| 5   | Email + password login **does not work**; do not try it again                                       | fake credentials on a session-less instance: 401 without signing, **still 401 after signing**; and `user/login` is the only call with `signed=false`, and making it signed brought no improvement (the change was reverted)                        |
| 6   | The device-code flow **does not exist** (only TIDAL has RFC 8628)                                   | `native/streaming-api/src/tidal/auth.rs` has `auth_device_authorization`; the qobuz side has no corresponding implementation or public endpoint                                                                                                    |
| 7   | The existing "paste token" path **works fully**                                                     | measured on a clean instance (.132): log out → log in with only a token → search/direct links all OK                                                                                                                                               |
| 8   | Qobuz always returns `401 User authentication is required` for **unsigned** requests                | several endpoints, including a deliberate `bogus123`, give exactly the same response → that 401 cannot be used to distinguish endpoints                                                                                                            |
| 9   | Exchange endpoint = `GET /api.json/0.2/oauth/callback`, query `code` + `private_key`                | play.qobuz.com bundle: `paramsMapper=e=>({code:e.code,private_key:e.privateKey})` + `requester.get("oauth/callback",{query:t})`; a measured fake code returns `404 No result matching given argument` (the endpoint exists and validates the code) |
| 10  | `private_key` = `6lz8C03UDIC7` (web player initialization constant)                                 | bundle: `authenticate({privateKey:"6lz8C03UDIC7",code:t})`; the exchange response contains `user_auth_token` and `userId`                                                                                                                          |
| 11  | The exchange **does not require a request signature**                                               | same as above; the web player sends only `code` + `private_key`, with app_id in the `X-App-Id` header                                                                                                                                              |

## 2. Original unknowns (resolved by #9/#10/#11, kept as a record)

**The call shape that exchanges `code_autorisation` → `user_auth_token`** (endpoint path, method, parameter names/request body).

Three guesses were tried and **all failed** (because of fact #8 above, they cannot tell right from wrong):

```
GET  /api.json/0.2/oauth/code/<code>?app_id=...
GET  /api.json/0.2/user/login?app_id=...&code_autorisation=...
POST /api.json/0.2/user/login   (form: app_id + code_autorisation)
```

**How it was finally located**: by reading play.qobuz.com's `bundle.js` directly (`credentials.rs` was
already doing exactly this), rather than by endpoint probing — fact #8 makes unsigned probing forever
unable to tell right from wrong.

**Still not measured**: the full response shape of a **successful** exchange. The implementation handles
multiple keys
(`user_auth_token`/`token`, `user_id`/`userId`) and always calls back into `user/get` to look up the real
user id; if real-hardware testing later reveals different field names, only those two candidate-key
lines in `auth_oauth.rs` need changing.

## 3. Implementation steps

### 1) Native `native/streaming-api/src/qobuz/auth.rs` (+ `mod.rs` action registration)

```rust
/// Starts a one-shot local callback listener and returns the authorization URL.
/// Returns { url, port }; the url already carries ext_app_id and redirect_url=http://{host}:{port}/qobuz/cb/{state}?state={state}
pub async fn auth_oauth_start(&self, params: &HashMap<String, Value>) -> Result<Value, StreamingError>
```

- The port is a random free port, the listener binds `127.0.0.1`, and it **lives only during login**;
  it closes as soon as the callback arrives or the timeout (180s suggested) is reached.
- It accepts only requests whose path is **character-for-character equal** to `/qobuz/cb/{state}`
  (that is, `GET /qobuz/cb/<state>`); state appears in both the path and the query while
  `code_autorisation` is read from the query; all other requests get 404.

```rust
/// Waits for the callback, exchanges the token, and persists it.
/// Returns exactly the same shape as the existing auth_login (user_id / user_auth_token / display_name / is_active / max_format_id)
pub async fn auth_oauth_await(&self, params: &HashMap<String, Value>) -> Result<Value, StreamingError>
```

- The exchange **needs no signature**: the implementation does a plain `GET oauth/callback`
  (`code` + `private_key` in the query, app_id in the `X-App-Id` header), consistent with fact #11 and
  the measurement in §7.1 — the exchange succeeds without signing.
- On success it reuses the existing persistence logic of `core/apis/qobuz/index.ts::persistQobuzSession`
  (which internally calls `setQobuzAuth`); **do not write a second copy**.

**Note**: `auth_oauth_start` / `auth_oauth_await` must be registered in the action dispatch of
`core/apis/qobuz/index.ts::callQobuz`
(at the same level as `auth_login`), otherwise the frontend cannot call them.

### 2) Frontend `src/components/modals/StreamingLoginDialog.vue`

- On the Qobuz tab, above the existing "paste token", add a primary button "Log in to Qobuz with browser":
  1. call `qobuzApi.oauthStart()` to get `{ url }`
  2. `openExternal(url)` (already available from `@/utils/url`, introduced into this file in phase nine)
  3. poll `qobuzApi.oauthAwait()` (or await once, depending on whether the native implementation is blocking)
  4. on success `providerSessions.refresh()` + reuse the existing success toast
- **Keep** paste token as a fallback (still usable for non-subscription, abnormal networks, or a rejected redirect).
- Add two thin wrappers in `src/apis/qobuz.ts`, in the same style as the existing `login/logout/authStatus`.

### 3) Types and copy

- `shared/types/plugin.ts` needs no change; `ApiCallResponse` goes through the existing `/providers/call`.
- Failure messages reuse the existing `errors.PROVIDER_LOGIN_REQUIRED`; when adding copy, update `zh-CN` / `en-US` together.

## 4. Verification checklist (no item may be skipped)

> Verified locally ✅ / needs real hardware ❗:
> ✅ `cargo test -p streaming-api` 32 passed (including 7 real TCP callback listener cases, for example:
> an unrelated request gets 404 and waiting continues, authorization denial, state mismatch rejected)
> ✅ `cargo build` / `pnpm typecheck` / `pnpm test:web`(108) / `pnpm test:node`(390; the 1
> `coreSourceIdentity` failure comes from the unpacked directory having no `.git`, consistent with the
> baseline) / eslint / prettier
> ❗ Items 1–5 all require a human to complete one browser login.

1. **Clean instance**: on a host where Qobuz is not logged in (`.132` can create a clean state at any
   time with `auth_logout`)
   → click "Log in with browser" → complete the login in the browser → **without touching the Console**,
   the UI on returning should already show connected.
2. Session projection is correct: `userId` is the **real user id** (such as `2961963`), not the app_id `798273057`.
3. Features: `catalog_search` returns results, `track_getFileUrl` returns direct links.
4. **The local listener must be closed**: after the login completes, confirm the port is no longer
   listening (`ss -ltn`).
5. Timeout path: do not complete the login; after 180s the listener should close automatically and give
   a readable error, leaving no leftover process.
6. Regression: `pnpm test:node` fully green; after deploying to three machines, `391+ pass`.
   ⚠️ In an **unpacked directory** `pnpm test:node` fails 1 `coreSourceIdentity` case for lack of `.git`;
   in a git working tree it should be 391 pass.

### The step most likely to go wrong during real-hardware acceptance

Whether `redirect_url` is accepted by Qobuz, and whether it preserves the query as-is. If it is
rejected, the browser will not redirect back, which shows up as timing out after the full 180 seconds —
in that case fall back per Section 5, and **only the frontend needs downgrading** (neither the backend
nor the copy changes): turn the primary button into "Open authorization page" and keep paste token.

## 4b. Three real defects found and fixed during implementation (be sure to keep them)

All three are **real defects in the first implementation**, not theoretical risks; the first two would
make a human login fail 100% of the time.

### 1) state was never sent to Qobuz, yet the callback was required to carry state (fatal)

The first authorization URL had only `ext_app_id` + `redirect_url`, and the `redirect_url` contained no
state either; but the listener side unconditionally required the callback request line to contain
`state=<milliseconds+port>`, otherwise it returned 400 and kept waiting. Qobuz cannot return something
it never received ⇒ a real redirect would inevitably be rejected, idling until the 180-second timeout.

**Why the unit tests did not catch it**: the end-to-end case then passed
`wait_for_callback(listener, None)`, which turned validation off, while the production path passes
`Some(state)` — the test and production parameters differed, so the defect was "tested green".

**Fix (two safeguards)**:

- `state` is written both into the query of `redirect_url` and into the authorization URL itself;
- validation is relaxed to "**reject only when present and mismatched, allow when absent**" — because
  whether Qobuz preserves the query of `redirect_url` was never measured, and requiring it would make
  the real login fail again.

### 2) The callback address used 127.0.0.1, but the browser is not on the device at all (fatal)

The authorization page is opened by `window.open` in the Web Control frontend, and **there is no
graphical browser at all on 190** (measured: neither `firefox` nor `chromium` exists, `DISPLAY` is
unset). So the browser is on the **user's PC**, and `http://127.0.0.1:<port>/qobuz/cb` points at that
PC, so the callback can never come back to Core.

**Fix**: the frontend passes `window.location.hostname` (the address the browser actually uses to reach
Core) to `auth_oauth_start`; the native side then:

- if host is loopback (`localhost` or a `127.` prefix) → bind `127.0.0.1`, keeping the original
  constraint; the hostname whitelist allows only `[A-Za-z0-9.-]`, and `::1` / `[::1]` is judged an
  invalid argument and errors out directly;
- otherwise → bind `0.0.0.0` and write that host into `redirect_url`, so the PC's redirect can reach
  back to the device.

⚠️ This is a **deliberate relaxation** of the original text's "bind only 127.0.0.1". The risk is
bounded by these factors: the port is random, it lives only during login, it lasts at most 180 seconds,
it is one-shot, and the `code` can only be issued by Qobuz. If the network segment is untrusted, use an
SSH tunnel instead of long-term exposure.

### 3) Repeated start did not release the old listener / a denied authorization was misjudged

- The first version's repeated `auth_oauth_start` calls only replaced the slot, **the old `TcpListener`
  was still held by the old task**, and kept `LISTEN`ing for its own full 180 seconds (returning 200
  during that time, but the result was discarded, so the user would wrongly believe it succeeded).
  Fix: add `cancel_tx`; a new start actively stops the old listener, and the old task releases the port
  immediately.
- In the first version the `error=` check came **after** state validation, and a denied callback also
  carries no state ⇒ a real denial also degenerated into "400 + idling until timeout". Fix: move the
  error check before state validation.
- The first version used `request.contains("error=")`, so `?noterror=1` was misjudged as a denied
  authorization. Fix: use exact query-key parsing (`parse_query`).
- Related: `auth_oauth_await` may only `take` the receiver, **it must not take the whole slot** —
  otherwise `cancel_tx` is dropped and the listener task wrongly believes it has been superseded and
  immediately gives up on this login.

Each of the above has a corresponding regression test (the `listener_*` cases inside `auth_oauth.rs`);
that file has 16 tests in total.

## 5. Fallback plan (if `redirect_url` pointing at 127.0.0.1 is rejected)

- **Level one**: keep only the "Log in with browser" button to open the official authorization page;
  after logging in, still use that Console command line to obtain the token.
  That is one step less than typing the URL by hand, **but it does not save you the Console**.
- **Zero information cost**: keep the status quo (one-click paste token, already reduced in phase nine
  to needing only one pasted field).

## 6. Things explicitly not to do

- ❌ Do not try email + password login again (fact #5, verified twice).
- ❌ Do not look for a Qobuz device-code endpoint (fact #6, it does not exist).
- ❌ Do not build an embedded browser window to capture the token (atom's Web Control has no host login
  window, and `coreProviderAccountsUi.test.ts` explicitly forbids approaches such as `openLoginWeb`).
- ⚠️ `coreProviderAccountsUi.test.ts` has line-by-line assertions that the renderer must not access
  `localStorage`; if new copy mentions `localStorage` again, handle it the phase-nine way (Console
  command text is allowed, real access is forbidden).

---

## 7. Real-hardware verification results (2026-09-23 · target machine 10.0.0.190)

Build: Debian 11 container + Diretta SDK 150 (see `docs/debian11-build-compatibility.md` for details).
Artifact commit `8cd2e2a6` (dirty=true); after deployment the platform bits are 5/5 and `data/` is kept.

### 7.1 The real response shape of a successful exchange (the only previously unmeasured item)

After a human completed the login in the browser, `auth_oauth_await` actually returned:

```json
{
  "status": "success",
  "user_id": "2961963",
  "user_auth_token": "mDkSe-0qp-XYfLDEz3C5l3kgv_SpPLJ4mWfZeF0446cFpODxEeLRRp0YBwz32jMX3nsea5-6Hz_DFgF-n5hJ0Q",
  "display_name": "tomosak",
  "user": { "id": "2961963", "login": "tomosak", "display_name": "tomosak" },
  "is_active": false,
  "max_format_id": 5
}
```

**Conclusion**: the `oauth/callback` response does provide `user_auth_token` and `user_id`, and the
multi-key tolerant parsing in the implementation (`user_auth_token`/`token`, `user_id`/`userId`) picked
up the correct values, so no change is needed. `user_id` is the real user id (`2961963`), **not** the
app_id `798273057`. The account is non-subscription (`is_active=false`, `max_format_id=5`), consistent
with the phase-nine record.

### 7.2 Automated verification (all passed)

| #   | Check                                                                                     | Result |
| --- | ----------------------------------------------------------------------------------------- | ------ |
| 1   | Negative control: an unknown action returns `Unsupported Qobuz API`                       | ✅     |
| 2   | `auth_oauth_start` shape (url/port/redirectUri/state/expiresIn=180)                       | ✅     |
| 3   | Loopback case: no host passed → binds `127.0.0.1`                                         | ✅     |
| 4   | Cross-machine case: host passed → binds `0.0.0.0` and the callback address uses that host | ✅     |
| 5   | Repeated start → the old listener releases the port immediately                           | ✅     |
| 6   | Unrelated request (favicon) gets 404 and waiting continues                                | ✅     |
| 7   | Reachable across machines (an external host reaches the callback port)                    | ✅     |
| 8   | Callback with the correct state → 200 + success page                                      | ✅     |
| 9   | **Callback without state → still allowed through**                                        | ✅     |
| 10  | Wrong state → 400 rejected                                                                | ✅     |
| 11  | `error=access_denied` → fails immediately (measured 0 seconds)                            | ✅     |
| 12  | Port released after the callback (`ss -ltn` shows no residue)                             | ✅     |
| 13  | Fake code exchange → correctly reaches Qobuz and returns 404                              | ✅     |
| 14  | Session projection `userId=2961963`                                                       | ✅     |

### 7.3 Human acceptance (items 1~5 of Section 4 of the plan)

| #   | Check                                                                                                                                         | Result                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | On a clean instance, click "Log in with browser" → log in in the browser → completes automatically, without touching Console/F12 at any point | ✅                    |
| 2   | Session projection is the user's real id `2961963` (not the app_id)                                                                           | ✅                    |
| 3   | `catalog_search` returns results (measured: 3 Miles Davis albums)                                                                             | ✅                    |
| 4   | The local listener closes and the port is released after login                                                                                | ✅                    |
| 5   | Timeout path (auto-closes after 180s and reports a readable error)                                                                            | ✅ automated coverage |

**Outstanding**: item 6 of Section 4 of the plan, "`391+ pass` after deploying to three machines", has
not been run yet (only `.190` was deployed this time).
