# DSH WorkBuddy Connect

English | [中文](./README.md)

Brings every model in the WorkBuddy desktop app (GLM-5.3, GLM-5.2, DeepSeek-V4-Pro, DeepSeek-V4-Flash, Kimi-K3, MiniMax-M3, Hy3, and more) straight into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — zero configuration in the DSH chat.

Both the CN **WorkBuddy** and the international **WorkBuddy AI** apps are supported: whichever one you have installed shows up as its own model group, and having both installed shows both, each with its own account and credit.

> **This is a fork of [`corrinehu/dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect)**. On top of 0.7.1 it adds the **account pool** (multi-account rotation with failover), the **`workbuddy_search` host tool** and an **Anthropic-Messages search endpoint**, and it fixes **every plugin route returning 403 under a `--trusted-host` deployment**.
>
> **This fork's work is unreleased**: `package.json` still reads `0.7.1`, which is a *different codebase* from the upstream 0.7.1 on npm. Do **not** install `dsh-workbuddy-connect@0.7.1` — that gets you upstream, with none of the account-pool features described here. See the Install section below.

## Features

- **Works out of the box**: install and enable the plugin, then use it directly in DSH — no extra configuration.

![WorkBuddy models in the DSH model picker](assets/1.png)

- **CN and international side by side**: the CN app appears as the **WorkBuddy** group and the international one as **WorkBuddy AI**. Their models, accounts, and credit never mix. **Each group follows only its own app's sign-in**: install just the international app and only WorkBuddy AI appears; install both and both groups appear; sign out of one and that group goes away. Settings likewise shows **one card per version**.

![WorkBuddy AI models in the DSH model picker](assets/5.png)

- **Image input**: most models accept images — paste or drop one straight into the conversation (GLM-5.3-Flash, GLM-5.2, the DeepSeek-V4 series, and more); the few text-only models (e.g. GLM-5.1) clearly say so.

- **Reasoning levels**: levels explicitly declared by WorkBuddy appear directly — for example, GLM-5.3 and GLM-5.3-Flash offer low / high / max. For models that do not declare selectable levels, Web and Desktop provide a **Reasoning levels** control in the model picker for a manual check. It sends a few requests and may consume credit. Models without a check result or selectable levels continue to use WorkBuddy's default.

- **Status and detection**: Settings → Plugins → the matching card shows the account, token validity, remaining credit, and model offers. It also lets you refresh the model list manually and shows whether the current list came from the upstream or from the built-in fallback, and provides manual reasoning-level detection for eligible models.

- **Model visibility**: both cards (Context window tab) let you check which models appear in the model picker. Hidden lists are **saved per signed-in account**: switching accounts switches to that account's own list, switching back restores it; new accounts and newly added models are visible by default. Hiding only affects pickability — **existing chats using a hidden model keep working**.

![Model visibility in the context-window list](assets/6.png)

- **Enterprise credit**: on the CN product, enterprise accounts (non-empty `enterpriseId`) read their cycle quota from the enterprise billing endpoint, and the card shows an "enterprise quota" row with the cycle reset time.

- **Rate**: every model name carries its credits multiplier (e.g. `GLM-5.2 · x0.79`, `Hy3 · x0.00`) in both the `/model` popup and the composer's model dropdown. The rate is display-only and never affects requests.

- **Promo badges**: promo badges (`限时免费`, `夜间折扣`) ride the model name itself (e.g. `Hy4 preview · x0.00 · 限时免费`); the status card also collects currently-discounted models. Per the WorkBuddy service data, synced each time DSH starts. The international version's promotions come from the service's `modelPromotions` (which carry an effective window). Once a promotion lapses its badge is withdrawn; because the service writes the discounted value into the model's own rate field, the original price cannot be reconstructed, so that model then reports "price unavailable — refresh to update".

![Settings card showing the plugin](assets/2.png)

The expanded card has three tabs: **Status** (account, token validity, total credit, catalog source, reasoning-level detection), **Context** (each model's context window; where the international version offers a larger declared window, the "Use the largest declared context window" switch lives here — it is **on by default**, and the preference persists across restarts), and **Details** (per-package credit and model offers).

![Settings card showing account and remaining credit](assets/3.png)

## Account pool (new in this fork)

Each WorkBuddy desktop sign-in leaves `workbuddy-desktop-ai.info` (the current login) alongside timestamped backups in the same directory. The **account pool** brings those backups into scope: tick the accounts you want in the pool, and the plugin picks one to bill per request, moving on automatically when an account fails.

> **Off by default.** While off, behaviour is exactly as before — follow the desktop app's current sign-in. Once on, the plugin decides who pays.

Ranking rules (highest priority first):

| Priority | Rule | Why |
| --- | --- | --- |
| 1 | **Availability** | A billable account always outranks every excluded one |
| 2 | **Most credit first** | Spend the deepest balance first, so near-empty accounts are preserved rather than drained first |
| 3 | **Soonest expiry first** | Credit expiring soonest is worth the least if left unused |
| 4 | **Newest credential first** | Keeps an expired token from winning a tie |
| 5 | **Account id** | The tiebreaker that makes the ordering **total** — otherwise two runs over one pool could rotate in different orders |

Failure handling: `401` is a rejected credential (re-sign-in required; waiting is pointless); `429` and region quota code `code=6004` are rate limits (cooled down until the upstream's stated reset); `5xx` and transport failures are transient (returned to the pool after cooldown). `HTTP 400` **does not** swap accounts — the same body fails for everyone, so retrying only wastes time.

Configuration:

```yaml
- id: llm-workbuddy
  config:
    accountPool: true          # default false
```

The pool file lives at `$DSH_HOME/.workbuddy-pool-<variant>.json` with two domains: `members` is your selection (written only when you tick something) and `probes` is the plugin's observation (written per request). They share a file but not fields, so a measurement **never** overwrites your selection.

### `workbuddy_search` and the search endpoint (new in this fork)

This fork also exposes WorkBuddy's search capability to DSH:

- **The `workbuddy_search` host tool**: a search tool usable straight from the conversation.
- **An Anthropic-Messages search endpoint**: point DSH's own `web_search` at this plugin by setting `web-search-deepseek.baseURL` to `<dsh web origin>/plugins/dsh-workbuddy-connect/search`. It is registered even when the host tool is off — the two are alternative routes to the same capability.

> The account-pool implementation is ported from [`dsh-connect-workbuddy`](https://github.com/dingminhua/dsh-connect-workbuddy) (MIT).

## Why reasoning levels work this way

Information about WorkBuddy models' reasoning levels is currently split between upstream API responses and private UI logic in the client, while the model catalog changes quickly. If the plugin filled in one uniform set of levels for every model without an upstream declaration, it would need to keep chasing unpublished product logic with no stable contract.

![Reasoning-level detection in the composer](assets/4.png)

Testing also found that some models accept the `reasoning_effort` parameter while ignoring unknown values and falling back to their default behavior. A successful request alone therefore does not prove that a level is actually usable.

For models without declared levels, Web and Desktop instead use user-authorized, on-demand detection: it first confirms that the upstream validates the parameter, then checks which standard levels it accepts. The check sends a few requests and may consume credit. Its result means only that the upstream currently accepts that level; it does not promise a particular change in reasoning quality, speed, or credit use.

## Install

Prerequisite: the WorkBuddy desktop app is installed and signed in. The plugin reuses the app's sign-in state and follows account switches automatically; the same applies to the international WorkBuddy AI app, and the two do not affect each other.

**Match the plugin version to your DSH core** — from `0.6.0` on, one plugin version spans both core generations; from `0.7.0` the plugin targets `0.2.0` cores only, so `0.1.x` users should stay on `0.6.5`.

| Plugin | Required DSH core | Desktop app |
|---|---|---|
| **0.7.1 (current)** | **`0.2.0-rc.2` only** (`0.2.0-rc.1` users should stay on `0.7.0`); `@earendil-works/pi-ai` peer is **`^0.87.1`** | desktop builds bundling the `0.2.0-rc.2` core (preview / nightly) |
| **0.7.0** | `0.2.0-rc.1` / `0.2.0-rc.2`; adapts to DSH `0.2.0`'s settings-service rework | desktop builds bundling the `0.2.0` core |
| **0.6.5** | `0.1.5` / `0.1.6` / `0.1.7` / `0.2.0-rc.1` (final release of the `0.1.x` line) | desktop builds bundling `0.1.x` cores (incl. the released `2.0.7`+ line) |
| **0.3.2 – 0.5.4** | the `0.1.5-rc.1` line only (no `0.1.6+`) | `2.0.7`+ |

A mismatched combination fails to start DSH. See the upstream README for the full historical table.

### Installing this fork

**Install this repository, not the same-named package on npm.** This fork's work is unreleased, so `@0.7.1` resolves to upstream code.

```sh
# Web (recommended): install from this repository's source
dsh plugin --profile web add github:zcbxxx1/dsh-workbuddy-connect
dsh web

# Pin a commit when you need reproducibility:
dsh plugin --profile web add github:zcbxxx1/dsh-workbuddy-connect#<commit>
```

> Installing via `github:` builds through the plugin's `prepare` script, which pnpm blocks until allowed — add the exact key pnpm prints under `allowBuilds` in `pnpm-workspace.yaml`. This fork's `lib/` is committed and matches its source commit, so a local build is usually unnecessary.

```sh
# TUI (terminal UI): that profile requires pnpm 11
dsh plugin --profile dsh-tui add github:zcbxxx1/dsh-workbuddy-connect
dsh --profile dsh-tui
```

**The Desktop app** does not install via the command line: the `desktop` profile is managed exclusively by the Electron app and the CLI rejects it outright (`profile "desktop" is managed exclusively by the Electron application`). Use the desktop app's built-in plugin manager, or the file route: (1) confirm the profile directory the desktop app actually uses (default `~/.dsh/profiles/desktop`, on Windows `%USERPROFILE%\.dsh\profiles\desktop`); (2) fully quit the desktop app; (3) back up `package.json` and `pnpm-lock.yaml` in that directory; (4) add `"dsh-workbuddy-connect": "github:zcbxxx1/dsh-workbuddy-connect"` to dependencies; (5) install in that directory with the matching pnpm (prefer the pnpm bundled with the desktop app); (6) relaunch the desktop app.

### After installing

Once DSH restarts, the model picker should show the "WorkBuddy / WorkBuddy AI" groups — with only the CN or only the international app installed, verify just the corresponding group. **Groups and credit being visible only proves the plugin loaded and the catalog and account were read; pick one model from the group and finish a short conversation — a normal reply is what counts as a working integration.**

> **`--trusted-host` deployments (fixed in this fork)**: if you serve the GUI on a real hostname with `dsh web --host 0.0.0.0 --trusted-host <authority>`, upstream 0.7.1's plugin routes accept loopback only — the card and the pool page render their shells and then report `读取账号池失败: HTTP 403`. This fork lets the plugin routes reuse the trusted authority the host already declared, so such deployments work; undeclared hostnames, cross-origin requests, and DNS rebinding are still refused.
>
> The fix takes effect only after **restarting DSH**: plugin routes mount at startup.

### Where the cards live by DSH version

```text
DSH 0.1.5 + this plugin
├─ Settings → Plugins: ✅ two config cards (CN / international)
└─ chat model picker: ✅ WorkBuddy / WorkBuddy AI groups

DSH 0.1.6+ / 0.2.0 + this plugin
├─ main UI → Plugins → workbuddy-connect → View: ✅ two config cards
├─ Settings → Account pool: ✅ account-pool page (this fork)
└─ chat model picker: ✅ WorkBuddy / WorkBuddy AI groups
```

From `0.6.0` on, the Models settings page no longer shows the non-editable WorkBuddy cards (consistent across both core generations); the model picker, `/model`, and chat calls are unaffected. From `0.2.0` the settings service became a Config-derived form facade, and the plugin adapts to what the host actually offers: on `0.1.5` / `0.1.6` both sections install as before, while on `0.1.7+` / `0.2.0` it degrades to a settings-less provider — models, the picker, model visibility, and the context rows all keep working; only the "use the upstream's declared maximum context window" preference stops being persistable.

> **TUI users**: the terminal UI package (`@deepseek-harness-tui/dsh-tui`) must be **`0.10.0-beta.5` or newer** — older versions fail at startup with `events is not iterable` when this plugin is installed. Manual reasoning-level detection is currently available only on Web and Desktop.

## CLI

`dsh plugin --profile <web|dsh-tui> exec dsh-workbuddy-connect status`: sign-in state and remaining credit (`--json` for machine-readable output; `doctor` for diagnostics and `logout` for credential cleanup are also available). The `desktop` profile is managed exclusively by the desktop app, so the CLI (including `exec`) does not work against it.

Both commands target the CN version by default; add `--provider workbuddy-ai` for the international one:

```sh
dsh plugin --profile web exec dsh-workbuddy-connect status --provider workbuddy-ai
dsh plugin --profile web exec dsh-workbuddy-connect doctor --provider workbuddy-ai
```

> For a plugin installed into a pnpm profile, `exec` may fail to resolve host packages (`ERR_MODULE_NOT_FOUND: @deepseek-ai/...`): the plugin's host dependencies are supplied by DSH itself at runtime, and `pnpm exec` cannot see them. Normal in-host use is unaffected.

`logout` removes only that version's plugin-owned credential copy. It leaves the desktop app's own sign-in alone and does not promise the model group will disappear.

## Known limitations

- Verified on macOS with the DSH Web / Desktop / TUI profiles (as of 0.3.2 this requires `0.1.5-rc.1`+ and Node 22+). Windows probes Local and Roaming AppData in order; WSL first reads credentials from the mounted Windows user profile. If the Windows and Linux user names differ and Windows environment variables are not forwarded into WSL, point `WORKBUDDY_AUTH_FILE` (or `WORKBUDDY_AI_AUTH_FILE` for the international version) at the actual file.
- **Encrypted desktop credential helper discovery**: both the CN and international versions use their own verified default path and app discovery on macOS; on Windows the CN version first checks `%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe` and then the uninstall registry records, while the international version checks the registry records only. Each product locates and runs only its own app identity, so neither can pick the other's app. If automatic discovery still fails, set the product's variable — `WORKBUDDY_ELECTRON_BIN` for CN, `WORKBUDDY_AI_ELECTRON_BIN` for international (separate since 0.6.4) — then fully quit and restart DSH. Linux has no built-in auto-discovery; the card offers Agent Assist when needed.
- **The international version's model catalog comes from the app's own interface**: the service splits it by User-Agent, a private implementation detail that a server-side change can break. When that happens the plugin degrades to this account's last successful catalog and then to its built-in roster, showing the source and the failure reason on the card — but long-term compatibility is not guaranteed. The CN version's catalog uses the same interface as the official CLI and is unaffected.
- **International-version environments not yet covered**: on Windows / WSL / Linux no reliable source for the international app's version has been located yet, so the saved value or the built-in default is used.
- **Behaviour change with no credentials**: a version whose app was never signed in — and that left no plugin-owned copy — no longer shows a model group.
- **The enterprise credit path currently covers the CN product only**: the international enterprise billing interface is unverified, so those accounts still read through the personal endpoint.
- Relies on WorkBuddy client interfaces (not a public API); the plugin may need updates as WorkBuddy changes.

## Disclaimer

- This project is for **personal learning and research only**, driving your own WorkBuddy account on your own machine. Do not use it commercially or beyond reasonable personal use.
- Users must comply with the WorkBuddy terms of service. Any consequence of using this project (including but not limited to account restrictions, depleted credit, or service interruption) is borne by the user.
- The author is not liable for any direct or indirect loss arising from the use or misuse of this project.
- This project is not affiliated with, endorsed by, or sponsored by Tencent, WorkBuddy, or DeepSeek. Product names are used for compatibility description only; trademarks belong to their respective owners.

## Acknowledgements

- [corrinehu/dsh-workbuddy-connect](https://github.com/corrinehu/dsh-workbuddy-connect) (MIT) — the upstream project this fork tracks.
- [dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy) (MIT) — reference for the account pool.
- [Sliverkiss/workbuddy2api](https://github.com/Sliverkiss/workbuddy2api) (MIT) — reference implementation of the WorkBuddy upstream protocol.
- [franksong2702/dsh-codex-connect](https://github.com/franksong2702/dsh-codex-connect) (Apache-2.0) — reference for the DSH plugin structure and provider registration.

## License

[MIT](./LICENSE)
