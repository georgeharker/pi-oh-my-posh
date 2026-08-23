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

// Path/git already carry the pointed '>' separator — keep them verbatim; just add the
// round '(' cap to the first segment (path).
const pathCapped = pathSeg.replace(
  /(\[\[blocks\.segments\]\]\n)/,
  `$1    leading_diamond = '${CAP_L}'\n`,
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

function piSeg(bg, fg, template, fgTemplates, trailing) {
  let t =
    `  [[blocks.segments]]\n` +
    `    type = 'text'\n` +
    `    style = 'powerline'\n` +
    `    powerline_symbol = ${q(SEP)}\n` +
    `    background = '${bg}'\n` +
    `    foreground = '${fg}'\n`;
  if (trailing) t += `    trailing_diamond = ${q(trailing)}\n`;
  if (fgTemplates) {
    t += `    foreground_templates = [${fgTemplates.map(q).join(", ")}]\n`;
  }
  t += `    template = ${q(template)}\n`;
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
  pathCapped +
  `\n\n` +
  gitSeg +
  `\n\n` +
  piSeg("p:yellow", "p:black", model) +
  `\n` +
  piSeg("p:blue", "p:white", ctx, ctxFg) +
  `\n` +
  piSeg("p:black", "p:grey", tokens, undefined, CAP_R) + // last on row 1 → round ')' end cap
  // Row 2: other-extension status chips (remote-pi, etc.) on their own line via a
  // newline block. When PI_STATUS is empty the segment (and the whole line) vanishes,
  // and the footer collapses back to a single row.
  `\n\n[[blocks]]\n  type = 'prompt'\n  alignment = 'left'\n  newline = true\n\n` +
  `  [[blocks.segments]]\n` +
  `    type = 'text'\n` +
  `    style = 'powerline'\n` +
  `    leading_diamond = ${q(CAP_L)}\n` +
  `    trailing_diamond = ${q(CAP_R)}\n` +
  `    powerline_symbol = ${q(SEP)}\n` +
  `    background = 'p:grey'\n` +
  `    foreground = 'p:black'\n` +
  `    template = ${q(status)}\n`;

writeFileSync(OUT, out);
console.log("wrote", OUT, "(pointed > sep, round ( ) caps)");
