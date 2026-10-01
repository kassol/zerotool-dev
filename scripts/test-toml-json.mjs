// TOML ↔ JSON — library behavior quoted on the en tool page
//
// Read:  node_modules smol-toml (the package TomlJsonTool.astro imports),
//        src/components/tools/TomlJsonTool.astro (conversion calls)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The component converts with smol-toml parse → JSON.stringify(data, null, 2) and
// JSON.parse → smol-toml stringify. This test runs the same calls on the examples and limits on
// src/content/tools/toml-json/en.mdx so a library upgrade that changes them fails here.
//
// Run: node scripts/test-toml-json.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'smol-toml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comp = readFileSync(join(root, 'src/components/tools/TomlJsonTool.astro'), 'utf8');
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
eq('component uses JSON.stringify(data, null, 2) and stringify(data)', /JSON\.stringify\(data, null, 2\)/.test(comp) && /stringify\(data\)/.test(comp), true);
const t2j = (t) => { try { return JSON.stringify(parse(t)); } catch (e) { return 'ERR ' + e.message; } };
const j2t = (j) => { try { return stringify(JSON.parse(j)); } catch (e) { return 'ERR ' + e.message; } };

eq('simple table', t2j('[database]\nhost = "localhost"\nport = 5432\nenabled = true'), '{"database":{"host":"localhost","port":5432,"enabled":true}}');
eq('array of tables', t2j('[[fruits]]\nname = "apple"\n\n[[fruits]]\nname = "banana"\ncolor = "yellow"'), '{"fruits":[{"name":"apple"},{"name":"banana","color":"yellow"}]}');
eq('dotted table keeps dashes', t2j('[project]\nrequires-python = ">=3.10"\n[tool.ruff.lint]\nselect = ["E"]'), '{"project":{"requires-python":">=3.10"},"tool":{"ruff":{"lint":{"select":["E"]}}}}');
eq('package.json to TOML', j2t('{"name":"demo","version":"1.0.0","private":true,"scripts":{"build":"astro build","test":"node --test"},"workspaces":["packages/*"],"engines":{"node":">=22"}}'),
  'name = "demo"\nversion = "1.0.0"\nprivate = true\nworkspaces = [ "packages/*" ]\n\n[scripts]\nbuild = "astro build"\ntest = "node --test"\n\n[engines]\nnode = ">=22"\n');
eq('quoted keys', j2t('{"my key":1,"a.b":2}'), '"my key" = 1\n"a.b" = 2\n');
eq('1.0 becomes integer', j2t('{"x":1.0}'), 'x = 1\n');
eq('root array rejected', j2t('[1,2]'), 'ERR stringify can only be called with an object');
eq('null dropped (empty document)', j2t('{"a":null}'), '\n');
eq('redefinition error', /trying to redefine an already defined table or value/.test(t2j('a = 1\n[a]\nb = 2')), true);
eq('dates become strings', t2j('created = 2026-09-29T10:00:00Z\nday = 2026-09-29'), '{"created":"2026-09-29T10:00:00.000Z","day":"2026-09-29"}');
eq('inf becomes null', t2j('ratio = inf'), '{"ratio":null}');
eq('large integer rejected', /cannot be represented losslessly/.test(t2j('big = 9007199254740993')), true);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
