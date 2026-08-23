/**
 * pi-oh-my-posh — render pi's footer with Oh My Posh.
 *
 * WHAT IT DOES
 * ------------
 * Replaces pi's footer with the output of `oh-my-posh print`, so a user who already
 * themes their shell prompt with Oh My Posh gets the SAME visual language (powerline
 * separators, palette, Nerd Font glyphs) in pi.
 *
 * HOW (the whole trick)
 * ---------------------
 * Oh My Posh is just "template data in -> ANSI out". This extension does NOT reimplement
 * any styling. On each relevant event it:
 *   1. gathers pi session state (model, context-window %, tokens, thinking level) off `ctx`,
 *   2. exposes them to Oh My Posh as environment variables (`.Env.PI_*` in templates) and
 *      precomputes the ▰▱ gauge string (so the config needs no numeric templating),
 *   3. shells `oh-my-posh print primary --config <file> --shell generic --escape=false
 *      --pwd <cwd> -w <width>` and caches the resulting ANSI lines,
 *   4. asks pi to re-render; the footer Component returns the cached lines synchronously.
 *
 * Native `path` / `git` segments in the config render authentic Oh My Posh output for free
 * (OMP runs git itself against `--pwd`). We only supply the pi-specific data.
 *
 * COMPOSITION
 * -----------
 * `oh-my-posh print --config` loads ONE whole theme; OMP has no include/overlay, so this can
 * NOT auto-merge with the theme that drives your shell. Two supported modes instead:
 *   - Standalone: uses the bundled `pi.omp.json` (default).
 *   - Compose into your own theme: set PI_OMP_CONFIG=~/your.omp.json and paste the segments
 *     from `pi-block.snippet.json` into it. One file, your palette + pi data.
 *
 * CONFIG (env)
 *   PI_OMP_CONFIG      path to the .omp.json to render (default: bundled pi.omp.json)
 *   PI_OMP_BIN         oh-my-posh binary (default: "oh-my-posh")
 *   PI_OMP_GAUGE_WIDTH cells in the ▰▱ context gauge (default: 10)
 *   PI_OMP_PROMPT      which OMP prompt to print: primary|right|... (default: "primary")
 *
 * Commands:  /oh-my-posh  toggles the footer on/off for the session.
 *
 * Types are declared locally on purpose (same convention as pi-acp): this file depends on
 * nothing from `@earendil-works/pi-coding-agent`; pi injects the real API at load time.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ---- minimal local typings of the bits of the pi API we touch ----------------

type ThinkingLevel = string; // "off" | "minimal" | "low" | "medium" | "high" | ...

interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

interface PiModel {
  id?: string;
  name?: string;
  provider?: { id?: string } | string;
}

interface FooterDataProvider {
  getGitBranch?(): string | null;
  onBranchChange?(cb: () => void): (() => void) | { dispose?(): void } | void;
  /** Statuses other extensions publish via ctx.ui.setStatus(key, text). */
  getExtensionStatuses?(): ReadonlyMap<string, string>;
}

interface FooterComponent {
  render(width: number): string[];
  invalidate(): void;
  dispose?(): void;
}

interface Tui {
  requestRender?(): void;
}

interface UiContext {
  setFooter(
    factory: ((tui: Tui, theme: unknown, footerData: FooterDataProvider) => FooterComponent) | undefined,
  ): void;
  setStatus?(key: string, text: string | undefined): void;
  notify?(text: string, level?: string): void;
}

interface Ctx {
  cwd?: string;
  model?: PiModel;
  thinkingLevel?: ThinkingLevel;
  getContextUsage?(): ContextUsage | undefined;
  ui: UiContext;
}

interface PiExtensionApi {
  on(event: string, handler: (event: unknown, ctx: Ctx) => void): void;
  registerCommand(
    name: string,
    options: { description?: string; handler: (args: string, ctx: Ctx) => void | Promise<void> },
  ): void;
}

// ---- configuration -----------------------------------------------------------

const BIN = process.env.PI_OMP_BIN || "oh-my-posh";
const PROMPT_TYPE = process.env.PI_OMP_PROMPT || "primary";
const GAUGE_WIDTH = clampInt(process.env.PI_OMP_GAUGE_WIDTH, 10, 1, 40);
/**
 * Pick the Oh My Posh config, first existing wins — no env needed in the common case:
 *   1. PI_OMP_CONFIG            explicit override
 *   2. <omp config dir>/pi.*    a pi.{toml,omp.toml,json,omp.json,yaml,omp.yaml} you drop
 *                               next to your theme (~/.config/oh-my-posh, or $XDG / $POSH_)
 *   3. bundled pi.omp.toml      (present only if generated locally)
 *   4. bundled pi.omp.json      generic default (always exists)
 */
function resolveConfig(): string {
  if (process.env.PI_OMP_CONFIG) return process.env.PI_OMP_CONFIG;
  const here = dirname(fileURLToPath(import.meta.url));
  const home = process.env.HOME || homedir();
  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
  const ompDirs = [
    process.env.POSH_THEMES_PATH ? dirname(process.env.POSH_THEMES_PATH) : "",
    join(xdg, "oh-my-posh"),
    join(home, ".config", "oh-my-posh"),
  ].filter(Boolean);
  const names = ["pi.toml", "pi.omp.toml", "pi.json", "pi.omp.json", "pi.yaml", "pi.omp.yaml"];
  const candidates: string[] = [];
  for (const d of ompDirs) for (const n of names) candidates.push(join(d, n));
  candidates.push(join(here, "pi.omp.toml"), join(here, "pi.omp.json"));
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return join(here, "pi.omp.json");
}
const CONFIG_PATH = resolveConfig();

const GAUGE_MARKED = "▰";
const GAUGE_UNMARKED = "▱";

// Which extension statuses (from ctx.ui.setStatus, e.g. remote-pi's) to surface:
//   unset / "all"      -> every published status
//   "none"             -> suppress the aggregated PI_STATUS
//   "a,b,c"            -> allowlist of exact status keys, in that order
// Per-key vars (PI_STATUS_<KEY>) are always exported regardless of this.
const STATUS_SELECT = (process.env.PI_OMP_STATUS || "all").trim();
const STATUS_SEP = process.env.PI_OMP_STATUS_SEP ?? "  ";

// Other extensions embed emoji directly in their status text (remote-pi uses 📡 🟢 🟡 📱).
// Remap them to monochrome Nerd Font glyphs so the footer stays consistent with a powerline
// theme. State that emoji encode via COLOR (🟢 on / 🟡 waiting) is preserved via glyph SHAPE
// (filled vs hollow circle), since a themed segment paints one foreground.
// Override with PI_OMP_ICONS="📡=,🟢=" (merged over defaults) or disable with "none".
const DEFAULT_ICONS: Record<string, string> = {
  "📡": "", // nf-fa-wifi — broadcast/relay session
  "🟢": "", // nf-fa-circle — filled (ready/on)
  "🟡": "", // nf-fa-circle_o — hollow (waiting)
  "🔴": "", // filled circle (error/on)
  "⚪": "", // hollow circle (idle)
  "📱": "", // nf-fa-mobile — paired device
  "🔌": "", // nf-fa-plug — connection
  "⚡": "", // nf-fa-bolt
};
function parseIconMap(): Record<string, string> {
  const raw = (process.env.PI_OMP_ICONS ?? "default").trim();
  if (raw === "none" || raw === "off") return {};
  const map: Record<string, string> = { ...DEFAULT_ICONS };
  if (raw === "" || raw === "default") return map;
  for (const pair of raw.split(",")) {
    const i = pair.indexOf("=");
    if (i <= 0) continue;
    const from = pair.slice(0, i).trim().replace(/️/g, "");
    if (from) map[from] = pair.slice(i + 1); // value kept verbatim (may include spacing)
  }
  return map;
}
const ICON_MAP = parseIconMap();

// ---- module state ------------------------------------------------------------

let enabled = true;
let currentCtx: Ctx | null = null;
let cachedLines: string[] = [" oh-my-posh …"];
let lastWidth = 120;
let running = false;
let queued = false;
let streamTimer: ReturnType<typeof setInterval> | null = null;
let tuiRef: Tui | null = null;
let footerDataRef: FooterDataProvider | null = null;
let lastStatusSig = "";
let warned = false;

// ---- helpers -----------------------------------------------------------------

function clampInt(v: string | undefined, def: number, lo: number, hi: number): number {
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

/** Oh My Posh's formatTokenCount: 42, 1.5K, 2.3M. */
function formatTokens(n: number | null | undefined): string {
  if (!n || n <= 0) return "";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** The claude segment's gauge, precomputed: `used` cells marked, rest unmarked. */
function gauge(percent: number | null | undefined): string {
  const p = Math.min(100, Math.max(0, Math.round(percent ?? 0)));
  const used = Math.round((p / 100) * GAUGE_WIDTH);
  return GAUGE_MARKED.repeat(used) + GAUGE_UNMARKED.repeat(GAUGE_WIDTH - used);
}

function modelName(m: PiModel | undefined): string {
  if (!m) return "";
  return m.name || m.id || "";
}

function providerId(m: PiModel | undefined): string {
  if (!m) return "";
  const p = m.provider;
  if (!p) return "";
  return typeof p === "string" ? p : p.id || "";
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Replace configured emoji with Nerd Font glyphs; strips stray VS16 selectors. */
function remapIcons(s: string): string {
  let out = s;
  for (const [from, to] of Object.entries(ICON_MAP)) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out.replace(/️/g, "");
}

/** status key -> env-var suffix: "remote-pi:session" -> "REMOTE_PI_SESSION". */
function statusEnvKey(key: string): string {
  return "PI_STATUS_" + key.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** Read published extension statuses (ANSI stripped), in insertion order. */
function readStatuses(): Array<[string, string]> {
  let map: ReadonlyMap<string, string> | undefined;
  try {
    map = footerDataRef?.getExtensionStatuses?.();
  } catch {
    map = undefined;
  }
  if (!map) return [];
  const out: Array<[string, string]> = [];
  for (const [k, v] of map) {
    const text = remapIcons(stripAnsi(String(v ?? ""))).trim();
    if (text) out.push([k, text]);
  }
  return out;
}

/** Apply the PI_OMP_STATUS allowlist to the aggregated set. */
function selectStatuses(entries: Array<[string, string]>): string[] {
  const sel = STATUS_SELECT.toLowerCase();
  if (sel === "none") return [];
  if (sel === "" || sel === "all") return entries.map(([, v]) => v);
  const order = STATUS_SELECT.split(",").map((s) => s.trim()).filter(Boolean);
  const byKey = new Map(entries);
  return order.map((k) => byKey.get(k)).filter((v): v is string => !!v);
}

function statusSig(entries: Array<[string, string]>): string {
  return entries.map(([k, v]) => `${k}=${v}`).join("");
}

/** Build the env map Oh My Posh reads as `.Env.PI_*`. Only meaningful keys are set. */
function buildEnv(ctx: Ctx): Record<string, string> {
  const env: Record<string, string> = {};
  const set = (k: string, v: string) => {
    if (v) env[k] = v;
  };

  set("PI_MODEL", modelName(ctx.model));
  set("PI_PROVIDER", providerId(ctx.model));

  const think = (ctx.thinkingLevel || "").trim();
  if (think && think.toLowerCase() !== "off") set("PI_THINKING", think);

  let usage: ContextUsage | undefined;
  try {
    usage = ctx.getContextUsage?.();
  } catch {
    usage = undefined;
  }
  if (usage) {
    const pct = usage.percent == null ? 0 : Math.round(usage.percent);
    set("PI_CTX_PERCENT", String(pct));
    set("PI_CTX_GAUGE", gauge(usage.percent));
    set("PI_TOKENS", formatTokens(usage.tokens));
    set("PI_CTX_WINDOW", formatTokens(usage.contextWindow));
  }

  // Statuses other extensions published via ctx.ui.setStatus (remote-pi, etc.).
  // Per-key vars for individual placement; PI_STATUS for the selected, joined set.
  const statuses = readStatuses();
  for (const [k, v] of statuses) set(statusEnvKey(k), v);
  const selected = selectStatuses(statuses);
  set("PI_STATUS", selected.join(STATUS_SEP));
  set("PI_STATUS_COUNT", selected.length ? String(selected.length) : "");
  lastStatusSig = statusSig(statuses);

  return env;
}

function runOmp(env: Record<string, string>, width: number, cwd: string): Promise<string[]> {
  const args = [
    "print",
    PROMPT_TYPE,
    "--config",
    CONFIG_PATH,
    "--shell",
    "generic",
    "--escape=false",
    "--pwd",
    cwd,
    "-w",
    String(Math.max(1, width)),
  ];
  return new Promise((resolve, reject) => {
    execFile(
      BIN,
      args,
      { env: { ...process.env, ...env }, timeout: 4000, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) return reject(err);
        const lines = String(stdout)
          .replace(/\r/g, "")
          .split("\n")
          .filter((l) => l.length > 0);
        resolve(lines.length ? lines : [""]);
      },
    );
  });
}

async function refresh(): Promise<void> {
  if (!enabled || !currentCtx) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  const ctx = currentCtx;
  try {
    const env = buildEnv(ctx);
    cachedLines = await runOmp(env, lastWidth, ctx.cwd || process.cwd());
    tuiRef?.requestRender?.();
  } catch (err) {
    if (!warned) {
      warned = true;
      const msg =
        (err as { code?: string })?.code === "ENOENT"
          ? `pi-oh-my-posh: '${BIN}' not found on PATH — install Oh My Posh or set PI_OMP_BIN.`
          : `pi-oh-my-posh: oh-my-posh failed (${String((err as Error)?.message || err)}).`;
      currentCtx?.ui.notify?.(msg, "warning");
      cachedLines = [];
    }
  } finally {
    running = false;
    if (queued) {
      queued = false;
      void refresh();
    }
  }
}

/** ANSI-aware visible width: counts printable code points, skips escape sequences. */
function visibleWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; ) {
    if (s[i] === "\x1b") {
      // CSI ... final byte, or OSC ... BEL/ST — skip the whole sequence.
      i++;
      if (s[i] === "[") {
        i++;
        while (i < s.length && !(s[i] >= "@" && s[i] <= "~")) i++;
        i++;
      } else if (s[i] === "]") {
        i++;
        while (i < s.length && s[i] !== "\x07" && !(s[i] === "\x1b" && s[i + 1] === "\\")) i++;
        i += s[i] === "\x1b" ? 2 : 1;
      } else {
        i++;
      }
      continue;
    }
    w++;
    i++;
  }
  return w;
}

/** Truncate to `width` visible columns, keeping escape sequences intact. */
function truncateVisible(s: string, width: number): string {
  if (visibleWidth(s) <= width) return s;
  let out = "";
  let w = 0;
  for (let i = 0; i < s.length; ) {
    if (s[i] === "\x1b") {
      const start = i;
      i++;
      if (s[i] === "[") {
        i++;
        while (i < s.length && !(s[i] >= "@" && s[i] <= "~")) i++;
        i++;
      } else if (s[i] === "]") {
        i++;
        while (i < s.length && s[i] !== "\x07" && !(s[i] === "\x1b" && s[i + 1] === "\\")) i++;
        i += s[i] === "\x1b" ? 2 : 1;
      } else {
        i++;
      }
      out += s.slice(start, i);
      continue;
    }
    if (w >= width) break;
    out += s[i];
    w++;
    i++;
  }
  return out;
}

function startStreamTimer(): void {
  if (streamTimer) return;
  streamTimer = setInterval(() => void refresh(), 1200);
}

function stopStreamTimer(): void {
  if (streamTimer) {
    clearInterval(streamTimer);
    streamTimer = null;
  }
  void refresh(); // one final settle so the last numbers land
}

// ---- footer component --------------------------------------------------------

function footerFactory(tui: Tui, _theme: unknown, footerData: FooterDataProvider): FooterComponent {
  tuiRef = tui;
  footerDataRef = footerData;
  let unsub: (() => void) | { dispose?(): void } | void;
  try {
    unsub = footerData.onBranchChange?.(() => void refresh());
  } catch {
    unsub = undefined;
  }
  return {
    render(width: number): string[] {
      if (width !== lastWidth) {
        lastWidth = width;
        void refresh(); // width changed — re-render at the new column count
      } else if (statusSig(readStatuses()) !== lastStatusSig) {
        // Another extension changed a status (which triggered this render).
        // Re-render through OMP so the new status text lands.
        void refresh();
      }
      return cachedLines.map((l) => truncateVisible(l, width));
    },
    invalidate() {},
    dispose() {
      try {
        if (typeof unsub === "function") unsub();
        else unsub?.dispose?.();
      } catch {
        /* ignore */
      }
      footerDataRef = null;
    },
  };
}

function install(ctx: Ctx): void {
  currentCtx = ctx;
  ctx.ui.setFooter(footerFactory);
  void refresh();
}

/**
 * Take the single footer slot deterministically.
 *
 * `ctx.ui.setFooter` is last-writer-wins, and full-TUI extensions like pi-open-tui install
 * THEIR footer synchronously inside their own `session_start` handler (once — they don't
 * re-assert). Load order between extensions is not guaranteed, so installing synchronously
 * could lose the race. Deferring past the current tick puts us after any synchronous
 * installer; a second assertion a beat later covers another extension that also defers.
 * We keep the slot afterwards because neither side re-installs on later events.
 */
function installDeferred(ctx: Ctx): void {
  currentCtx = ctx;
  setTimeout(() => {
    if (enabled) install(ctx);
  }, 0);
  setTimeout(() => {
    if (enabled) install(ctx);
  }, 60);
}

function uninstall(ctx: Ctx): void {
  stopStreamTimerHard();
  ctx.ui.setFooter(undefined);
}

function stopStreamTimerHard(): void {
  if (streamTimer) {
    clearInterval(streamTimer);
    streamTimer = null;
  }
}

// ---- extension entry ---------------------------------------------------------

export default function (pi: PiExtensionApi): void {
  pi.on("session_start", (_e, ctx) => {
    currentCtx = ctx;
    // Defer so we win the footer slot over full-TUI extensions (e.g. pi-open-tui) that
    // install their footer synchronously on session_start. See installDeferred().
    if (enabled) installDeferred(ctx);
  });

  // Re-gather + re-render on the events that change what the footer shows.
  pi.on("model_select", (_e, ctx) => {
    currentCtx = ctx;
    void refresh();
  });
  pi.on("before_agent_start", (_e, ctx) => {
    currentCtx = ctx;
    startStreamTimer(); // poll while the turn streams so the gauge grows live
    void refresh();
  });
  pi.on("agent_settled", (_e, ctx) => {
    currentCtx = ctx;
    stopStreamTimer();
  });

  pi.on("session_shutdown", () => {
    stopStreamTimerHard();
    currentCtx = null;
  });

  pi.registerCommand("oh-my-posh", {
    description: "Toggle the Oh My Posh footer for this session",
    handler: (_args, ctx) => {
      enabled = !enabled;
      currentCtx = ctx;
      if (enabled) {
        install(ctx);
        ctx.ui.notify?.("Oh My Posh footer: on", "info");
      } else {
        uninstall(ctx);
        ctx.ui.notify?.("Oh My Posh footer: off", "info");
      }
    },
  });

  // Discovery: list the extension statuses currently available to surface, with the
  // env-var name each maps to, so you know what to put in PI_OMP_STATUS / your theme.
  pi.registerCommand("oh-my-posh-status", {
    description: "List extension statuses available to the Oh My Posh footer",
    handler: (_args, ctx) => {
      currentCtx = ctx;
      const entries = readStatuses();
      if (!entries.length) {
        ctx.ui.notify?.("No extension statuses published right now.", "info");
        return;
      }
      const lines = entries.map(([k, v]) => `${k}  →  {{ .Env.${statusEnvKey(k)} }}   (${v})`);
      ctx.ui.notify?.(`Available statuses:\n${lines.join("\n")}`, "info");
    },
  });
}
