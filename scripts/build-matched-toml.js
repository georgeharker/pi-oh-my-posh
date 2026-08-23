const fs = require("node:path") && require("fs");
const THEME = process.env.HOME + "/.config/oh-my-posh/theme.toml";
const JSONCFG = process.env.HOME + "/Development/ext/pi/pi-oh-my-posh/pi.omp.json";
const OUT = process.env.HOME + "/Development/ext/pi/pi-oh-my-posh/pi.omp.toml";

const theme = fs.readFileSync(THEME, "utf8").split("\n");
const line = (a, b) => theme.slice(a - 1, b).join("\n");

const palette = line(7, 15); // [palette] ... grey = '#bcbcbc'
const pathSeg = line(74, 83); // path powerline segment + properties(style=folder)
const gitSeg = line(85, 103); // git powerline segment + properties

// Reuse the exact powerline separator glyph from the user's path segment.
const sep = (pathSeg.match(/powerline_symbol\s*=\s*'([^']*)'/) || [])[1] || "";

// Pull the pi text-segment templates (glyphs intact) from the bundled JSON.
const j = JSON.parse(fs.readFileSync(JSONCFG, "utf8"));
const seg = j.blocks[0].segments;
const byTemplateHas = (needle) => seg.find((s) => s.type === "text" && s.template.includes(needle));
const model = byTemplateHas("PI_MODEL").template;
const ctx = byTemplateHas("PI_CTX_GAUGE").template;
const tokens = byTemplateHas("PI_TOKENS").template;
const status = byTemplateHas("PI_STATUS ").template || byTemplateHas("PI_STATUS").template;

const q = (s) => `'${s}'`; // TOML literal string; our templates contain no apostrophes

function piSeg(bg, fg, template, fgTemplates) {
  let t =
    `  [[blocks.segments]]\n` +
    `    type = 'text'\n` +
    `    style = 'powerline'\n` +
    `    powerline_symbol = ${q(sep)}\n` +
    `    background = '${bg}'\n` +
    `    foreground = '${fg}'\n`;
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
  `# Generated: palette + path/git copied verbatim from ~/.config/oh-my-posh/theme.toml,\n` +
  `# pi segments (model / context / tokens / status) added in your palette colors.\n` +
  `# Point the extension at this file:  export PI_OMP_CONFIG=<this path>\n` +
  `version = 3\n` +
  `final_space = false\n\n` +
  palette +
  `\n\n[[blocks]]\n  type = 'prompt'\n  alignment = 'left'\n\n` +
  pathSeg +
  `\n\n` +
  gitSeg +
  `\n\n` +
  piSeg("p:yellow", "p:black", model) +
  `\n` +
  piSeg("p:blue", "p:white", ctx, ctxFg) +
  `\n` +
  piSeg("p:black", "p:grey", tokens) +
  `\n` +
  piSeg("p:grey", "p:black", status) +
  ``;

fs.writeFileSync(OUT, out);
console.log("wrote", OUT, "(separator glyph U+" + (sep.codePointAt(0) || 0).toString(16) + ")");
