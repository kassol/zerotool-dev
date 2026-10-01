// CSS generator tools — styles for elements the script creates
//
// Read:  src/components/tools/{CssFlexbox,CssGrid,CssTriangle,CssGradient,CssFilter,BoxShadow}GeneratorTool.astro
// Write: stdout only
// Exit:  0 if all PASS, 1 if any FAIL
//
// Astro scopes component styles by adding a data-astro-cid attribute to the template's elements.
// Elements made by the inline script (innerHTML highlight spans, createElement preview cells) do not
// get that attribute, so a plain `.cfg-cell { ... }` rule never matched them: in the built pages the
// highlight colors were missing in all six tools and the flexbox preview boxes were 7px wide instead
// of at least 60px. Every rule for these classes must sit inside :global(...) (AGENTS.md rule 11).
//
// Run: node scripts/test-css-generator-script-styles.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tools = ['CssFlexboxGenerator', 'CssGridGenerator', 'CssTriangleGenerator', 'CssGradientGenerator', 'CssFilterGenerator', 'BoxShadowGenerator'];

let passes = 0, failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; return; }
  failures++;
  console.log('FAIL: ' + name + (detail !== undefined ? ' — ' + detail : ''));
}

for (const tool of tools) {
  const src = readFileSync(join(root, `src/components/tools/${tool}Tool.astro`), 'utf8');
  const a = src.indexOf('<style>');
  const b = src.indexOf('</style>', a);
  const style = src.slice(a, b);
  const script = src.slice(src.indexOf('<script'), src.indexOf('</script>'));

  // Classes the script puts on generated elements.
  const generated = new Set();
  for (const m of script.matchAll(/class="([a-z]+-(?:hl-[a-z]+|cell))"/g)) generated.add(m[1]);
  for (const m of script.matchAll(/className = '([a-z]+-cell)'/g)) generated.add(m[1]);
  check(`${tool}: script creates styled elements`, generated.size > 0);

  for (const cls of generated) {
    const uses = [...style.matchAll(new RegExp('(:global\\()?\\.' + cls + '\\b', 'g'))];
    if (uses.length === 0) continue; // no rule for this class (e.g. a semicolon span without color)
    const bare = uses.filter((m) => !m[1]);
    check(`${tool}: .${cls} rules are :global`, bare.length === 0, `${bare.length} scoped selector(s)`);
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
