/**
 * Formatting config for this repo's TypeScript (pi-oh-my-posh.ts).
 * pi-lens formats JS/TS via its formatter cascade ["biome", "prettier", ...];
 * without this file biome's defaults apply. This pins prettier(d) instead,
 * configured to match the code as written (semicolons, double quotes,
 * 2-space, 80 cols) so adding the config causes no reformat churn.
 *
 * prettier also claims YAML/JSON/Markdown when the cascade formats them, so
 * the override below keeps those at the standard 2-space style and 120-col
 * width — otherwise workflow comment lines longer than this repo's TS 80-col
 * width would get wrapped on the next format pass.
 *
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
    semi: true,
    singleQuote: false,
    tabWidth: 2,
    useTabs: false,
    trailingComma: "all",
    printWidth: 80,
    overrides: [
        {
            files: ["*.yml", "*.yaml", "*.json", "*.jsonc", "*.md", "*.mdx"],
            options: { tabWidth: 2, printWidth: 120 },
        },
    ],
}

export default config
