# Plugin Updates

> Last updated: 2026-10-03

SPlayer Atom Core checks plugin versions and Web Control presents the user-approved update action. A plugin declares `@updateUrl`, Core downloads the script and compares `@version`, and applying an update preserves enabled state, settings, and storage.

The **host** decides whether a newer version exists; scripts do not need their own version-comparison logic.

## Workflow

```text
declare @updateUrl + @version (+ @changelog)
  → host fetches the new script from @updateUrl and reads its @version
  → newer than local → the card shows "New version available v1.1.0" + @changelog
  → user chooses Update → host fetches the same address and overwrites in place → restart
```

- **When checks run**: checks run silently at application startup, and users can also check manually
  from each card under **Settings → Plugin Management**.
- **Applying is manual**: the host only notifies; updates are never installed automatically, and the
  user decides when to update.
- Plugins without `@updateUrl` are not checked, and their cards do not show the "Check update" action.

## Update metadata

Add three fields to the script header (only `@updateUrl` is required for update checks):

```js
/**
 * @name      ClassIsland Integration
 * @id        imsyy.classisland
 * @version   1.1.0
 * @updateUrl https://raw.githubusercontent.com/you/repo/main/ClassIsland.js
 * @changelog Fix port collision crashes\nShow album names
 */
```

| Field        | Description                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@updateUrl` | Raw `.js` URL of the new version (HTTPS only; `http://localhost` and `http://127.0.0.1` are allowed for local debugging). The host fetches it to read and compare `@version`, and also uses it as the download source for one-click updates |
| `@version`   | Version number; the host compares it segment by segment as `major.minor.patch`. To release a new version, just bump it                                                                                                                      |
| `@changelog` | Update notes shown in the card prompt; in a single-line header, break lines with a literal `\n`                                                                                                                                             |

::: tip Point @updateUrl at a stable address
`@updateUrl` should point at a **long-lived** raw address (for example, a file on the `main` branch
served through GitHub raw) that always holds the latest script. The host fetches this address every
time to read the latest `@version`.
:::

::: warning The changelog comes from the new script
The `@changelog` shown on the card comes from the **new script** fetched from `@updateUrl`, not from
the copy installed locally. So when releasing, put the release notes in the **new** script header.
:::

## LX scripts: `updateAlert` (compatibility)

LX source scripts have no `@updateUrl` mechanism; instead they report updates at runtime through
their native event, which the host recognizes as the same update prompt:

```js
lx.send(lx.EVENT_NAMES.updateAlert, {
  log: "Several issues fixed",
  updateUrl: "https://example.com/lx-source.js",
});
```

The LX `updateAlert` payload is `log` and `updateUrl`; the host compatibility layer also accepts `version`, and when no version is given the card only shows "New version available" without a specific version. Its `updateUrl` usually points at an introduction page rather than a raw `.js`, in which case an automatic update fails and only shows a failure toast; it does **not** open that address automatically. The user can open it manually through the "Open update page" link in the update dialog, then find the new script's raw URL and re-import it through Plugin Management.

## Applying an update

When the user chooses Update, the host:

1. Fetches `@updateUrl` (which must serve an accessible **raw `.js`** file).
2. After parsing and validating it, **overwrites the plugin in place** and **preserves** enabled
   state, user settings, and plugin-private storage (`splayer.storage`).
3. Restarts the plugin process and clears the update prompt.

::: warning Identity and type must remain stable
An automatic update requires the new script to keep the same **identity (`@id`, or an identity
derived from the name when omitted) and type (`@type`)**: if the new script changes identity, or
switches from `source` to `control`, the update is rejected and the user must re-import it manually.
For a release, change only `@version`, `@changelog`, and the script contents; do not change `@id`
(or `@name` when no ID is declared).
:::

If an automatic update fails (network problems, an `@updateUrl` that is not a valid script, an identity/type change, and so on), the plugin remains on the old version and usable; the "Open update page" external-link button on the card can still open `@updateUrl` manually.

## Relationship to re-importing

Plugin identity depends only on `@id` (derived from the name when omitted) and never on the script
contents, so **manually re-importing a script with the same identity also replaces the existing
plugin in place** and does not create a duplicate entry. Update checks merely announce that a newer
version exists, saving users from comparing versions themselves.
