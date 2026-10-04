// TOML ↔ JSON — behavior quoted on the toml-json tool pages
//
// Read:  src/components/tools/TomlJsonTool.astro, run through scripts/astro-page-harness.mjs with
//        the npm smol-toml it imports; src/content/tools/toml-json/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each conversion types into the page's own textarea, so the result is what the page shows
// (smol-toml parse, precision marks and fidelity check → stringifyJson(found.value, 2);
// JSON.parse with source text → fidelity check → smol-toml stringify). The inputs are the
// examples and limits on the en page; the two stop messages are checked to appear verbatim on
// all four language pages.
//
// Run: node scripts/test-toml-json.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './astro-page-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comp = readFileSync(join(root, 'src/components/tools/TomlJsonTool.astro'), 'utf8');
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
eq('component uses stringifyJson(found.value, 2) and stringify(found.value)', /stringifyJson\(found\.value, 2\)/.test(comp) && /[^.J]stringify\(found\.value\)/.test(comp), true);
function convert(input, output, text, lang = 'en') {
  const page = loadPage('src/components/tools/TomlJsonTool.astro', { lang, stringsSelector: '.tj-wrap' });
  page.type(input, text);
  const out = page.el(output).value;
  return out || 'ERR ' + page.el('tj-status').textContent;
}
// JSON output is compared in its compact form, as on the page
const t2j = (t, lang) => { const r = convert('tj-toml', 'tj-json', t, lang); return r.startsWith('ERR') ? r : JSON.stringify(JSON.parse(r)); };
const j2t = (j, lang) => convert('tj-json', 'tj-toml', j, lang);
const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, 'src/content/tools/toml-json/' + l + '.mdx'), 'utf8')]));

eq('simple table', t2j('[database]\nhost = "localhost"\nport = 5432\nenabled = true'), '{"database":{"host":"localhost","port":5432,"enabled":true}}');
eq('array of tables', t2j('[[fruits]]\nname = "apple"\n\n[[fruits]]\nname = "banana"\ncolor = "yellow"'), '{"fruits":[{"name":"apple"},{"name":"banana","color":"yellow"}]}');
eq('dotted table keeps dashes', t2j('[project]\nrequires-python = ">=3.10"\n[tool.ruff.lint]\nselect = ["E"]'), '{"project":{"requires-python":">=3.10"},"tool":{"ruff":{"lint":{"select":["E"]}}}}');
eq('package.json to TOML', j2t('{"name":"demo","version":"1.0.0","private":true,"scripts":{"build":"astro build","test":"node --test"},"workspaces":["packages/*"],"engines":{"node":">=22"}}'),
  'name = "demo"\nversion = "1.0.0"\nprivate = true\nworkspaces = [ "packages/*" ]\n\n[scripts]\nbuild = "astro build"\ntest = "node --test"\n\n[engines]\nnode = ">=22"\n');
eq('quoted keys', j2t('{"my key":1,"a.b":2}'), '"my key" = 1\n"a.b" = 2\n');
eq('1.0 becomes integer', j2t('{"x":1.0}'), 'x = 1\n');
eq('root array rejected', j2t('[1,2]'), 'ERR Error: stringify can only be called with an object');
eq('null stops the conversion with its path', j2t('{"a":null}'), 'ERR Not converted: TOML cannot hold these values without changing them: /a: null — TOML has no null');
eq('redefinition error', /trying to redefine an already defined table or value/.test(t2j('a = 1\n[a]\nb = 2')), true);
eq('dates become strings', t2j('created = 2026-09-29T10:00:00Z\nday = 2026-09-29'), '{"created":"2026-09-29T10:00:00.000Z","day":"2026-09-29"}');
eq('inf stops the conversion with its path', t2j('ratio = inf'), 'ERR Not converted: JSON cannot hold these values without changing them: /ratio: inf has no JSON form (JSON.stringify would write null)');
eq('large TOML integer rejected', /cannot be represented losslessly/.test(t2j('big = 9007199254740993')), true);
eq('large JSON integer stops the conversion with its path', j2t('{"big":9007199254740993}'), 'ERR Not converted: TOML cannot hold these values without changing them: /big: integer 9007199254740993 is outside ±(2^53 − 1), so JavaScript would round it');
eq('JSON number too large for a double stops the conversion', j2t('{"x":1e400}'), 'ERR Not converted: TOML cannot hold these values without changing them: /x: 1e400 is outside the range of a double-precision number');
eq('What Changes example', t2j('# build settings\ntitle = "x"\ncreated = 2026-09-29T10:00:00Z\nday = 2026-09-29\n\n[server]\nport = 8080'), '{"title":"x","created":"2026-09-29T10:00:00.000Z","day":"2026-09-29","server":{"port":8080}}');
for (const [lang, text] of Object.entries(pages)) {
  const inf = t2j('ratio = inf\n\n[limits]\nmax = nan', lang).replace(/^ERR /, '');
  const nul = j2t('{"user":{"id":9007199254740993,"nickname":null}}', lang).replace(/^ERR /, '');
  eq(lang + ' page quotes the inf / nan stop message', text.includes('`' + inf + '`'), true);
  eq(lang + ' page quotes the null / integer stop message', text.includes('`' + nul + '`'), true);
  eq(lang + ' page example has no inf → null', /"ratio": null/.test(text), false);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
