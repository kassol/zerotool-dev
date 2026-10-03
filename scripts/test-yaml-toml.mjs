// YAML ↔ TOML — library behavior quoted on the en tool page
//
// Read:  node_modules js-yaml and smol-toml (the same packages YamlTomlTool.astro imports),
//        src/components/tools/YamlTomlTool.astro (import lines and dump options)
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// The component converts with jsyaml.load → smol-toml stringify and smol-toml parse →
// jsyaml.dump({ indent: 2, lineWidth: -1, noRefs: true }). This test runs the same calls on the
// inputs shown on src/content/tools/yaml-toml/en.mdx (worked example, Cargo.toml example,
// "Values That Change" table, error messages), so a library upgrade that changes them fails here.
// The old page put `tags` after `[database]`, which in TOML makes it a key of that table.
//
// Run: node scripts/test-yaml-toml.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import jsyaml from 'js-yaml';
import { parse, stringify } from 'smol-toml';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comp = readFileSync(join(root, 'src/components/tools/YamlTomlTool.astro'), 'utf8');
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
eq('component dumps YAML with the options used here', /jsyaml\.dump\([^,]+, \{ indent: 2, lineWidth: -1, noRefs: true \}\)/.test(comp), true);
eq('component imports js-yaml and smol-toml', /from 'js-yaml'/.test(comp) && /from 'smol-toml'/.test(comp), true);

const y2t = (y) => { try { return stringify(jsyaml.load(y)); } catch (e) { return 'ERR ' + e.message; } };
const t2y = (t) => { try { return jsyaml.dump(parse(t), { indent: 2, lineWidth: -1, noRefs: true }); } catch (e) { return 'ERR ' + e.message; } };

eq('worked example', y2t('database:\n  host: localhost\n  port: 5432\n  enabled: true\ntags:\n  - web\n  - backend'),
  'tags = [ "web", "backend" ]\n\n[database]\nhost = "localhost"\nport = 5432\nenabled = true\n');
eq('Cargo.toml example', t2y('[package]\nname = "zerotool"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n\n[[bin]]\nname = "cli"\npath = "src/main.rs"\n'),
  "package:\n  name: zerotool\n  version: 0.1.0\n  edition: '2021'\ndependencies:\n  serde:\n    version: '1.0'\n    features:\n      - derive\nbin:\n  - name: cli\n    path: src/main.rs\n");
eq('services list becomes [[services]]', y2t('services:\n  - name: web\n  - name: api'), '[[services]]\nname = "web"\n\n[[services]]\nname = "api"\n');
eq('1.10 becomes 1.1', y2t('version: 1.10'), 'version = 1.1\n');
eq('YAML date becomes offset date-time', y2t('released: 2026-10-01'), 'released = 2026-10-01T00:00:00.000Z\n');
eq('yes stays a string', y2t('flag: yes'), 'flag = "yes"\n');
eq('large YAML integer loses precision and is serialized as a float', y2t('big: 9007199254740993'), 'big = 9007199254740992.0\n');
eq('hex becomes decimal', t2y('hex = 0xff'), 'hex: 255\n');
eq('local time gains milliseconds', t2y('local = 09:30:00'), 'local: 09:30:00.000\n');
eq('offset date-time keeps offset', t2y('created = 2026-10-01T09:30:00+09:00'), 'created: 2026-10-01T09:30:00.000+09:00\n');
eq('multi-document error', y2t('a: 1\n---\nb: 2'), 'ERR expected a single document in the stream, but found more');
eq('large TOML integer is rejected', /integer value cannot be represented losslessly/.test(t2y('big = 9007199254740993')), true);
eq('duplicate key is rejected', /trying to redefine an already defined table or value/.test(t2y('a = 1\na = 2')), true);
eq('anchors are expanded', y2t('x: &a {k: 1}\ny: *a'), '[x]\nk = 1\n\n[y]\nk = 1\n');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
