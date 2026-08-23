import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const THEME = process.env.PI_OMP_THEME || join(homedir(), ".config/oh-my-posh/theme.toml");
const JSONCFG = join(REPO, "pi.omp.json");
const OUT = join(REPO, "pi.omp.toml");

const theme = readFileSync(THEME, "utf8").split("\n");
const line = (a, b) => theme.slice(a - 1, b).join("\n");

const palette = line(7, 15); // [palette] ... grey = '#bcbcbc'
const pathSeg = line(74, 83); // path powerline segment + properties(style=folder)
const gitSeg = line(85, 103); // git powerline segment + properties

// Match theme.toml's style exactly: round '(' cap on the LEFT end (e0b6), pointed '>'
// separators BETWEEN segments (e0b0), round ')' cap on the RIGHT end (e0b4). Only the
// ends are round — the inner separators stay pointed.
const SEP = String.fromCodePoint(0xe0b0); // '>' pointed powerline separator (your inner sep)
const CAP_L = String.fromCodePoint(0xe0b6); // '(' round left cap
const CAP_R = String.fromCodePoint(0xe0b4); // ')' round right cap

// First segment (path) must be style='diamond' for the round '(' cap to render —
// OMP ignores leading_diamond on powerline segments. Its trailing '>' connects into
// the powerline chain (git/model/context). git stays verbatim (powerline '>').
const pathDiamond = pathSeg
  .replace(/style = 'powerline'/, "style = 'diamond'")
  .replace(
    /powerline_symbol = '[^']*'/,
    `leading_diamond = '${CAP_L}'\n    trailing_diamond = '${SEP}'`,
  );

// Pull the pi text-segment templates (glyphs intact) from the bundled JSON.
const j = JSON.parse(readFileSync(JSONCFG, "utf8"));
const seg = j.blocks[0].segments;
const byTemplateHas = (needle) => seg.find((s) => s.type === "text" && s.template.includes(needle));
const model = byTemplateHas("PI_MODEL").template;
const ctx = byTemplateHas("PI_CTX_GAUGE").template;
const tokens = byTemplateHas("PI_TOKENS").template;
const status = byTemplateHas("PI_STATUS ").template || byTemplateHas("PI_STATUS").template;

const q = (s) => `'${s}'`; // TOML literal string; our templates contain no apostrophes

// style defaults to powerline ('>' separators). Pass style='diamond' with ld/td for a
// segment that must render round caps (the row ends) — powerline ignores diamonds.
function textSeg({ bg, fg, template, fgTemplates, style = "powerline", ld, td }) {
  let t = `  [[blocks.segments]]\n    type = 'text'\n    style = '${style}'\n`;
  if (ld) t += `    leading_diamond = ${q(ld)}\n`;
  if (td) t += `    trailing_diamond = ${q(td)}\n`;
  if (style === "powerline") t += `    powerline_symbol = ${q(SEP)}\n`;
  if (fgTemplates) t += `    foreground_templates = [${fgTemplates.map(q).join(", ")}]\n`;
  t += `    background = '${bg}'\n    foreground = '${fg}'\n    template = ${q(template)}\n`;
  return t;
}

// Context threshold colors expressed in the user's palette.
const ctxFg = [
  "{{ if ge (atoi .Env.PI_CTX_PERCENT) 90 }}p:red{{ end }}",
  "{{ if ge (atoi .Env.PI_CTX_PERCENT) 70 }}p:orange{{ end }}",
];

const out =
  `# pi.omp.toml — pi footer matched to your theme.toml (Tokyo Night palette).\n` +
  `# Generated: palette + path/git from ~/.config/oh-my-posh/theme.toml, separators\n` +
  `# pointed > separators with round ( ) end caps (matching theme.toml); pi segments (model / context /\n` +
  `# tokens) row 1; status chips on row 2 (newline block); palette colors. Regenerate: node scripts/build-matched-toml.js\n` +
  `version = 3\n` +
  `final_space = false\n\n` +
  palette +
  `\n\n[[blocks]]\n  type = 'prompt'\n  alignment = 'left'\n\n` +
  pathDiamond +
  `\n\n` +
  gitSeg +
  `\n\n` +
  textSeg({ bg: "p:yellow", fg: "p:black", template: model }) +
  `\n` +
  textSeg({ bg: "p:blue", fg: "p:white", template: ctx, fgTemplates: ctxFg }) +
  `\n` +
  // last on row 1: diamond so the round ')' cap renders; '>' leads in from the chain.
  textSeg({ bg: "p:black", fg: "p:grey", template: tokens, style: "diamond", ld: SEP, td: CAP_R }) +
  // Row 2: status chips as a rounded ( ) pill on their own line. When PI_STATUS is empty
  // the segment (and the whole line) vanishes, collapsing the footer back to one row.
  `\n\n[[blocks]]\n  type = 'prompt'\n  alignment = 'left'\n  newline = true\n\n` +
  textSeg({ bg: "p:grey", fg: "p:black", template: status, style: "diamond", ld: CAP_L, td: CAP_R });

writeFileSync(OUT, out);
console.log("wrote", OUT, "(pointed > sep, round ( ) caps)");
