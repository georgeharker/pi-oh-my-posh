# pi-oh-my-posh

Render [pi](https://pi.dev)'s footer with [Oh My Posh](https://ohmyposh.dev), so pi
wears the same theme as your shell prompt — powerline separators, palette, Nerd Font
glyphs — with pi's own context/model/token data mixed in.

## How it works

Oh My Posh is just *template data in → ANSI out*. This extension does no styling of its
own. On each relevant pi event it:

1. reads pi session state off `ctx` — model, context-window %, tokens, thinking level;
2. exposes them to Oh My Posh as environment variables (`.Env.PI_*`) and precomputes the
   `▰▱` context gauge;
3. shells `oh-my-posh print primary --config <file> --shell generic --escape=false
   --pwd <cwd> -w <width>` and caches the ANSI lines;
4. returns those lines from pi's footer `Component` (raw ANSI is allowed per line).

Native `path` / `git` segments in the config render authentic Oh My Posh output for free
(OMP runs git itself against `--pwd`). The extension only supplies the pi-specific data.

## Install

```sh
./install.sh          # symlinks pi-oh-my-posh.ts into ~/.pi/agent/extensions/
```

Requires `oh-my-posh` on PATH (`brew install oh-my-posh`, etc.). Start pi — the footer
renders through Oh My Posh. `/oh-my-posh` toggles it for the session.

## The `.Env.PI_*` variables it exports

| Variable         | Meaning                                             |
|------------------|-----------------------------------------------------|
| `PI_MODEL`       | active model name/id                                |
| `PI_PROVIDER`    | provider id (when available)                        |
| `PI_THINKING`    | thinking level (omitted when `off`)                 |
| `PI_CTX_PERCENT` | context-window used, integer percent                |
| `PI_CTX_GAUGE`   | precomputed `▰▱` bar (width = `PI_OMP_GAUGE_WIDTH`)  |
| `PI_TOKENS`      | current context tokens, humanized (`1.5K`, `2.3M`)  |
| `PI_CTX_WINDOW`  | context-window size, humanized                      |
| `PI_STATUS`      | selected statuses from other extensions, joined     |
| `PI_STATUS_COUNT`| number of selected statuses                         |
| `PI_STATUS_<KEY>`| one var per publisher (e.g. `PI_STATUS_REMOTE_PI_SESSION`) |

### Surfacing other extensions' footer items

Extensions like **remote-pi** publish footer chips via `ctx.ui.setStatus(key, text)` — pi
collects them in `footerData.getExtensionStatuses()`. Because our footer replaces pi's, we
read that same map and re-expose it:

- **Aggregated:** `.Env.PI_STATUS` is every selected status joined (the default theme puts
  it in the last segment). remote-pi's `📡 backend (1)  🟢 relay  📱 iphone` shows up here.
- **Individual:** each publisher also gets `.Env.PI_STATUS_<KEY>`, so you can place them in
  separate segments — e.g. `{{ .Env.PI_STATUS_REMOTE_PI_RELAY }}` in its own pill.
- **Select which:** `PI_OMP_STATUS` = `all` (default) · `none` · or a comma list of exact
  keys in the order you want, e.g. `PI_OMP_STATUS="remote-pi:relay,remote-pi:session"`.
  `PI_OMP_STATUS_SEP` sets the join separator (default two spaces).
- **Discover keys:** run `/oh-my-posh-status` in pi — it lists the live status keys and the
  `.Env.` var each maps to.

ANSI in status text is stripped so your theme controls the color. The footer refreshes
automatically when a status changes.

**Emoji → Nerd Font.** Publishers embed emoji directly (remote-pi uses 📡 🟢 🟡 📱). By
default those are remapped to monochrome Nerd Font glyphs so the footer stays consistent
with a powerline theme — state that emoji encode via *color* (🟢 on / 🟡 waiting) is kept
via glyph *shape* (filled  vs hollow  circle), since a themed segment paints one color.

| Var | Meaning |
|-----|---------|
| `PI_OMP_ICONS=none` | keep raw emoji, no remap |
| `PI_OMP_ICONS="📡=,🟢="` | override/add mappings (merged over the defaults) |

Defaults: `📡→` (wifi) `🟢→` `🔴→` (filled) `🟡→` `⚪→` (hollow) `📱→` (mobile)
`🔌→` (plug) `⚡→` (bolt). Edit `DEFAULT_ICONS` in the extension to change the built-ins.

## Configuration (env vars)

| Var                  | Default              | Purpose                                   |
|----------------------|----------------------|-------------------------------------------|
| `PI_OMP_CONFIG`      | auto (see below)     | override the config path                  |
| `PI_OMP_BIN`         | `oh-my-posh`         | Oh My Posh binary                         |
| `PI_OMP_GAUGE_WIDTH` | `10`                 | cells in the `▰▱` gauge                    |
| `PI_OMP_PROMPT`      | `primary`            | which OMP prompt to print                 |

### Config resolution (no env needed)

The config is auto-detected, first match wins:

1. `PI_OMP_CONFIG` if set (explicit override);
2. a `pi.toml` / `pi.omp.toml` / `pi.json` / `pi.omp.json` / `pi.yaml` / `pi.omp.yaml` in
   your Oh My Posh config dir (`$XDG_CONFIG_HOME/oh-my-posh`, `~/.config/oh-my-posh`, or the
   dir of `$POSH_THEMES_PATH`) — drop a `pi.toml` next to your `theme.toml` and it's used;
3. the bundled `pi.omp.toml` (present only if you generated a matched one locally);
4. the bundled `pi.omp.json` (generic default).

## Matching your existing theme (composition)

Oh My Posh's `--config` loads **one whole theme** — there is no include/overlay, so this
cannot auto-merge with the theme that drives your shell. Two modes instead:

- **Standalone (default).** Edit `pi.omp.json` — swap the hex colors and glyphs for your
  palette. Separate file, hand-matched.
- **Compose into your own theme.** Copy the three segments from `pi-block.snippet.json`
  into a block in *your* `.omp.json` (keep your colors/separators), then point the
  extension at it:

  ```sh
  export PI_OMP_CONFIG="$HOME/mytheme.omp.json"
  ```

  One file, your palette + pi data. Each pi segment self-hides when its data is absent.

  **Note:** Oh My Posh has no include/extends — a config can't reference a base theme. So
  if you want a footer that shows *only* pi's segments (not your whole shell prompt), you
  need a separate, trimmed config; you can't overlay onto your live theme.

### Bundled `pi.omp.toml` (matched to a Tokyo Night `theme.toml`)

`pi.omp.toml` is a standalone footer built to match an existing
`~/.config/oh-my-posh/theme.toml`: its `[palette]` and `path`/`git` segments are copied
verbatim (same colors, separators, folder hyperlink, upstream URL, branch status), then the
pi segments are added in the same palette (`p:yellow` model, `p:blue` context with
`p:orange`/`p:red` thresholds, `p:black` tokens, `p:grey` status).

Row 1 carries path/git + model/context/tokens; other-extension status chips (remote-pi) sit on a second row that collapses away when there are none. It's picked up automatically (step 3 above) — no env needed. To keep it with your dotfiles
instead, copy it to `~/.config/oh-my-posh/pi.toml` and it wins (step 2). Regenerate it after
changing your theme's palette:

```sh
node scripts/build-matched-toml.js   # re-copies palette + path/git from your theme.toml
```

## Composition with pi's UI and other extensions

- pi's footer is a **single, last-writer-wins slot** (`ctx.ui.setFooter`). This extension
  **replaces** the footer; it does **not** stack with another footer extension.
- It works alongside **pi-open-tui**: that overhaul installs its footer once at
  `session_start` and never re-asserts, so this extension **defers** its own `setFooter`
  to take the slot deterministically. You keep pi-open-tui's header, editor, and message
  boxes; only its Starship-style footer is replaced by the Oh My Posh one. (Colors of the
  header vs. footer will differ — they're different theming systems.)
- It ignores pi's color theme by design — the footer's colors come from your Oh My Posh
  theme, not pi's palette.
- If you'd rather keep another extension's footer and just inject pi data, that would use
  `ctx.ui.setStatus` (additive) instead of `setFooter` — not what this extension does,
  since it targets the full Oh My Posh look.

## Notes / limits

- **Cost** isn't shown: pi's `getContextUsage()` exposes tokens/percent/window but not a
  running USD cost, so there's no reliable number to render yet.
- The footer refreshes on `session_start`, `model_select`, `before_agent_start`,
  `agent_settled`, git-branch changes, and a ~1.2s poll while a turn streams (so the gauge
  grows live). Each refresh is one `oh-my-posh` subprocess.
