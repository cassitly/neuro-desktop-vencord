# Neurcro Vencord adapter

Share a small, curated description of the server channel selected in your local Discord desktop client. You explicitly connect a session, opt in locally, and approve `discord.viewer` in Neurcro. Neuro or Evil separately chooses whether the viewer overlay is visible. Everything starts disconnected and hidden.

This is a desktop **Vencord userplugin**. It does not send Discord messages, read message contents, capture screenshots, collect member lists, retrieve Discord credentials, or automate your account. Selected-channel activity describes a local view; it does **not** prove Neuro or Evil selected it. Summaries say `Selection source; actor unverified.` The configured actor is an overlay routing label only.

For actual Neuro/Evil Discord activity, connect your existing private backend to the Neurcro SDK and emit already-curated events with the real actor. Your private backend remains private. This plugin supplies a local visibility adapter; it cannot recreate that backend or infer who sent a message.

## Install in your development Vencord build

Follow Vencord's [custom plugin installation](https://docs.vencord.dev/installing/custom-plugins/) and [native plugin guide](https://docs.vencord.dev/plugins/native/). Use your own reviewed Vencord build; nothing here patches a running Discord installation automatically.

1. Register this package's `manifest.json` in Neurcro as `vencord-discord`.
2. Enable the global `extensions` permission, then approve `run_allowed` and the required `discord.viewer` capability for this item. Do not delegate management unless you want Neuro to manage the item.
3. Create a scoped **integration** token for this ID. Never enter your operator token, a Discord token, or an OBS viewer token in the plugin.
4. Copy the contents of `plugin/` into `Vencord/src/userplugins/neuroDesktop.desktop/`. Keep the `.desktop` suffix: native IPC is unavailable in browser Vencord. The plugin identifier remains `NeuroDesktop` so existing settings and native bridge names keep working.
5. Build your Vencord checkout with its locked dependencies using `pnpm install --frozen-lockfile`, then `pnpm build`. Follow Vencord's installation instructions and fully restart Discord after native-code changes.
6. Enable the `NeuroDesktop` plugin. In its settings, confirm your local ND port (default `8300`), enter the scoped integration token in the session password field, and select **Connect this session**.
7. Turn on **Share selected channel** when you want to publish. Channel names remain excluded unless you separately opt in to them. DMs and group DMs are always excluded.
8. In Neurcro, let the selected actor enable `set_viewer_visibility` for `vencord-discord`. Use the separately issued read-only viewer token in ND's local OBS overlay.

The source has no invented Discord author identity (`authors` is empty). If you maintain a private build, you can add your own author metadata. This package is a standalone source repository layout with no nested `.git`; its included workflows run at the repository root.

## Exact registration contract

For a tool you operate directly, `PUT /api/integrations/vencord-discord` accepts `{"manifest": <contents of manifest.json>}`. Operator setup needs both your normal `X-ND-Token` and your explicitly re-entered `X-ND-Operator-Token`. Then:

```text
PUT /api/extensions/vencord-discord/permissions
{"manage_allowed":false,"run_allowed":true,"grants":{"discord.viewer":true},"settings":{}}

POST /api/integrations/vencord-discord/token
{"kind":"integration"}
```

Copy the returned `token` once into the plugin's session password control. A second `{"kind":"viewer"}` request creates the independent overlay read token. The token-minting requests also require the operator headers above. The plugin itself never uses those headers or calls those administrative routes.

For visibility, the ND Neuro API action is:

```json
{
  "integration_id": "vencord-discord",
  "actor": "neuro",
  "visible": true,
  "minutes": 15
}
```

Call `set_viewer_visibility` with these parameters; use `actor:"evil"` for Evil and `visible:false` to hide. The SDK does not add a replacement Neuro websocket protocol. It complements the [official Neuro API](https://github.com/VedalAI/neuro-sdk/blob/main/API/SPECIFICATION.md), leaving existing game/Discord integrations intact.

## What you control

| Control | Default | Effect |
| --- | --- | --- |
| Session connection | Disconnected | A scoped token is required each Discord session; token stays in native-process memory and the entry field clears after connecting. |
| Share selected channel | Off | Allows new curated selection summaries; turning it off immediately requests hide and clears ND viewer history. |
| Include channel names | Off | Adds a sanitized, at-most-64-character channel label; otherwise the summary only says a server channel is selected. |
| Actor label | Neuro | Chooses overlay routing only; changing it disconnects and does not establish who acted. |
| ND viewer visibility | Off | Requires ND permission plus current Neuro/Evil visibility consent; expires automatically. |

Changing the port, actor or name-sharing option disconnects the current session; reconnect to apply the new choice. Normal Vencord settings store these preferences, but never the integration token. Disconnect, plugin stop and Discord logout hide the feed, stop the heartbeat and forget the native token reference. If Discord or the server disappears, ND expires readiness after 45 seconds and hides stale activity. Local opt-out cannot enable sharing in ND.

The plugin observes channel selections through Vencord's `ChannelStore`/`SelectedChannelStore` and `CHANNEL_SELECT` event. It reads only whether a selected channel belongs to a server and its name; names are not transmitted by default. It never imports a message store. Explicit name sharing strips mentions, links, controls and formatting. A selection summary is de-duplicated and capped at one publish per two seconds. The native heartbeat runs every 15 seconds with one request at a time.

## Transport and native boundary

`index.ts` communicates through Vencord's documented `VencordNative.pluginHelpers.NeuroDesktop` IPC boundary. `native.ts` exports only connection, disconnect, status, sharing toggle and selection publishing. The renderer cannot provide an arbitrary URL, path, HTTP method, file path or shell command.

The native HTTP origin is always literal `127.0.0.1` with an integer port between 1024 and 65535. Only fixed `/api/integrations/vencord-discord/{heartbeat,activity,hide}` routes are available. Requests use `X-ND-Integration-Token`; redirects are refused, the complete request has an eight-second deadline, and JSON responses are capped at 256 KiB. Neither credentials nor server response bodies are included in error messages. No raw Discord token is ever needed.

`plugin/transport.mjs` contains original standalone transport/validation code. It can be tested without Discord or Vencord. The `.d.mts` declarations provide its TypeScript boundary to the userplugin. This adapter is GPL-3.0-or-later to match the Vencord plugin ecosystem; the separate Python Neurcro SDK is MIT licensed. No private backend source is bundled.

## Test and build

```sh
npm test

# Use a clean, reviewed Vencord development checkout with dependencies installed:
VENCORD_SOURCE=/path/to/Vencord npm run check:vencord
```

The build helper refuses to replace an existing `neuroDesktop.desktop` userplugin. It copies this plugin temporarily, runs Vencord's full `testTsc` and standalone desktop build, then removes only that temporary copy. It does not inject Vencord into Discord. On PowerShell, set `$env:VENCORD_SOURCE` before running the same npm command.

CI runs transport tests on Windows, macOS and Linux and compiles against reviewed Vencord commit `32c90633ce6a95d7e56c95479efbb431bacf1eac`. Update that pin deliberately and rerun the full build when upstream APIs change. Passing these tests establishes transport/build compatibility; it does not claim a live Discord session, the private Vedal backend, or every future Discord client build has been verified.
