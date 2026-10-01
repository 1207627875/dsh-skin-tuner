# dsh-skin-tuner

English | [中文](README.zh.md)

A **standalone appearance tuner** for the DeepSeek Harness (dsh) web GUI: background occlusion, backdrop blur, composer-card frost, message-bubble opacity and bubble blur — all on one Settings page, `Settings → Appearance tuner`.

It requires no skin and installs no skin. Every value lives in `<harness-home>/dsh-skin-tuner.json`, survives a restart, and the master switch removes every variable and element the plugin wrote.

---

## Why this exists on its own

The skin center (`@linxin666/dsh-client-ui-skin-center`) has the same sliders, but they are welded to its identity as *the* skin loader: disabling it also disables the sliders. This plugin extracts the sliders into an independent plugin, so you can

- tune opacity and blur without adopting a skin,
- keep tuning after the skin center is switched off,
- be the single writer when two skins fight over the same custom properties.

## Install

```sh
# from GitHub (recommended)
dsh plugin --profile <profile> add 'github:1207627875/dsh-skin-tuner'

# from a local clone (dev loop: edit, npm run build, restart dsh)
git clone https://github.com/1207627875/dsh-skin-tuner.git
cd dsh-skin-tuner && npm install && npm run build
dsh plugin --profile <profile> add .
```

`dsh plugin` records the dependency in the profile's `package.json` and appends this package to `dsh.profile.bundles` (the package ships `dsh.bundle.patch`).

**Desktop (`desktop` profile)**: an external CLI cannot boot that profile, so install from the sidebar **Plugins** page. For local development you can also edit the profile's `package.json` by hand:

```json
{
  "dependencies": { "dsh-skin-tuner": "link:D:/path/to/dsh-skin-tuner" },
  "dsh": { "profile": { "bundles": ["…", "dsh-skin-tuner"] } }
}
```

then run `pnpm install` once in `profiles/<name>`. The dependency must also appear in `dsh.profile.bundles`, or it is never loaded.

**Restart** afterwards: the browser loads the new client plugin and the "Appearance tuner" section appears.

## The panel

| Control | Range | Default | Effect |
|---|---|---|---|
| Enable tuning | on/off | on | master switch; off removes every write |
| Background occlusion | 0–100% | 0 | fogs the artwork behind panels; 0 clear, 100 nearly hidden |
| Backdrop blur (empty) | 0–20px | 0 | backdrop blur while the conversation is empty |
| Backdrop blur (with content) | 0–20px | 0 | backdrop blur while the conversation has messages |
| Composer frost | 0–20px | 10 | blurs only the region behind the composer card |
| Bubble opacity | 0–100% | 100 | message-bubble opacity; higher is easier to read |
| Bubble blur | 0–20px | 0 | blurs the region behind translucent bubbles |

Changes apply immediately; writes are coalesced (a burst of slider input sends one POST per 120 ms).

## The contract it writes

The panel edits no skin file. It writes the custom properties and markers the skin ecosystem already reads:

| Name | Value | Read by |
|---|---|---|
| `--dsw-skin-scrim` | `0`–`1` | backdrop-art skins (`rgba(..., calc(1 - var(--dsw-skin-scrim) * .5))`) |
| `--dsh-skin-bubble-alpha` | `0`–`1` | skins exposing translucent bubbles |
| `--dsh-skin-bubble-blur` | `px` | this plugin's own bubble-blur rule |
| `--dsh-input-card-blur` | `px` | composer-card frost |
| `body[data-skin-tuner]` | presence | gates this plugin's stylesheet |
| `body[data-skin-tuner-content]` | when messages exist | selects the empty/with-content blur step |
| `[data-skin-tuner-backdrop]` | injected element | carrier for occlusion and backdrop blur (`z-index: 0`) |
| `[data-skin-tuner-composer-frost]` | injected element | out-of-card frost layer following the composer |

A skin that already supports those properties needs **no code change** to become tunable here; with no skin at all, occlusion, bubble opacity and composer frost still work.

## Running beside another plugin

**One writer wins for a given property (the last one).** This plugin and the skin center write the same set, so:

- when both are mounted the panel shows a notice that the skin center is active on the page;
- pick one: disable the skin center to drive these values from here, or turn this plugin's master switch off.

The plugin reads and writes no skin or skin-center file, and leaves nothing behind when disabled or removed.

## Development

```sh
npm install        # esbuild only
npm test           # 15 cases: schema, store, controller, DOM writes, built-artifact smoke
npm run build      # src/client/* -> client.js (the DSH client module format)
```

`client.js` is a **build artifact**; rebuild and commit it with any client-source change.

Bundle format: the DSH client wraps each plugin as `window.__ModuleLoader__.load({ id, factory })`; `scripts/build-client.mjs` produces that shell with esbuild's banner/footer and keeps `react` plus the client runtime external so a second React never ships.

## Known limits

- Bubble blur needs translucent bubbles; fully opaque ones show nothing.
- Bubble blur adds `backdrop-filter` per message row; very long conversations may cost GPU. Leave it at 0 when unused.
- The empty/with-content backdrop switch is polled every 500 ms, so the change can lag by a moment.
- Occlusion and frost are visible only on skins that paint backdrop art; the official default has none.

## License

MIT
