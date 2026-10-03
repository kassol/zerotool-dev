// YAML ↔ TOML — behavior quoted on the yaml-toml tool pages
//
// Read:  src/components/tools/YamlTomlTool.astro, run through scripts/astro-page-harness.mjs with
//        the npm js-yaml and smol-toml it imports; src/content/tools/yaml-toml/{en,zh,ja,ko}.mdx
// Write: stdout only (test results)
// Exit:  0 if all PASS, 1 if any FAIL
//
// Each conversion types into the page's own textarea, so the result is what the page shows
// (fidelity checks, timestamp handling and the dump options included). The inputs are the ones
// shown on the en page (worked example, Cargo.toml example, "Values That Change" table, dates,
// values TOML cannot hold, error messages); the dates example and the stop message are also
// checked to appear verbatim on all four language pages. The old page put `tags` after
// `[database]`, which in TOML makes it a key of that table.
//
// Run: node scripts/test-yaml-toml.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './astro-page-harness.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const comp = readFileSync(join(root, 'src/components/tools/YamlTomlTool.astro'), 'utf8');
let passes = 0, failures = 0;
function eq(name, got, want) {
  if (got === want) { passes++; console.log('PASS ' + name); }
  else { failures++; console.log('FAIL ' + name + '\n  got:      ' + JSON.stringify(got) + '\n  expected: ' + JSON.stringify(want)); }
}
eq('component dumps YAML with the options used here', /jsyaml\.dump\([^,]+, \{ indent: 2, lineWidth: -1, noRefs: true \}\)/.test(comp), true);
eq('component imports js-yaml and smol-toml', /from 'js-yaml'/.test(comp) && /from 'smol-toml'/.test(comp), true);

function convert(input, output, text, lang = 'en') {
  const page = loadPage('src/components/tools/YamlTomlTool.astro', { lang, stringsSelector: '.yt-wrap' });
  page.type(input, text);
  const out = page.el(output).value;
  const status = page.el('yt-status').textContent;
  return out || 'ERR ' + status;
}
const y2t = (y, lang) => convert('yt-yaml', 'yt-toml', y, lang);
const t2y = (t) => convert('yt-toml', 'yt-yaml', t);
const pages = Object.fromEntries(['en', 'zh', 'ja', 'ko'].map((l) => [l, readFileSync(join(root, 'src/content/tools/yaml-toml/' + l + '.mdx'), 'utf8')]));

eq('worked example', y2t('database:\n  host: localhost\n  port: 5432\n  enabled: true\ntags:\n  - web\n  - backend'),
  'tags = [ "web", "backend" ]\n\n[database]\nhost = "localhost"\nport = 5432\nenabled = true\n');
eq('Cargo.toml example', t2y('[package]\nname = "zerotool"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n\n[[bin]]\nname = "cli"\npath = "src/main.rs"\n'),
  "package:\n  name: zerotool\n  version: 0.1.0\n  edition: '2021'\ndependencies:\n  serde:\n    version: '1.0'\n    features:\n      - derive\nbin:\n  - name: cli\n    path: src/main.rs\n");
eq('services list becomes [[services]]', y2t('services:\n  - name: web\n  - name: api'), '[[services]]\nname = "web"\n\n[[services]]\nname = "api"\n');
eq('1.10 becomes 1.1', y2t('version: 1.10'), 'version = 1.1\n');
eq('YAML date becomes a TOML local date', y2t('released: 2026-10-01'), 'released = 2026-10-01\n');
eq('yes stays a string', y2t('flag: yes'), 'flag = "yes"\n');
eq('large YAML integer stops the conversion with its path', y2t('big: 9007199254740993'), 'ERR Not converted: TOML cannot hold these values without changing them: /big: integer 9007199254740993 is outside ±(2^53 − 1), so JavaScript would round it');
eq('YAML null stops the conversion with its path', y2t('empty: ~'), 'ERR Not converted: TOML cannot hold these values without changing them: /empty: null — TOML has no null');
eq('hex becomes decimal', t2y('hex = 0xff'), 'hex: 255\n');
eq('local time gains milliseconds', t2y('local = 09:30:00'), 'local: 09:30:00.000\n');
eq('offset date-time keeps offset', t2y('created = 2026-10-01T09:30:00+09:00'), 'created: 2026-10-01T09:30:00.000+09:00\n');
eq('multi-document error', y2t('a: 1\n---\nb: 2').startsWith('ERR Invalid YAML: expected a single document in the stream, but found more'), true);
eq('root list error', y2t('- a'), 'ERR Invalid YAML: YAML root must be a mapping (object), not a scalar or sequence.');
eq('large TOML integer is rejected', /integer value cannot be represented losslessly/.test(t2y('big = 9007199254740993')), true);
eq('duplicate key is rejected', /trying to redefine an already defined table or value/.test(t2y('a = 1\na = 2')), true);
eq('anchors are expanded', y2t('x: &a {k: 1}\ny: *a'), '[x]\nk = 1\n\n[y]\nk = 1\n');

const DATES_YAML = 'release:\n  date: 2026-10-01\n  at: 2026-10-01 09:30:00 +9\n  utc: 2026-10-01T00:30:00Z\n  label: "2026-10-01"\n  ratio: .inf';
const datesToml = y2t(DATES_YAML);
eq('dates example output', datesToml, '[release]\ndate = 2026-10-01\nat = 2026-10-01T09:30:00.000+09:00\nutc = 2026-10-01T00:30:00.000Z\nlabel = "2026-10-01"\nratio = inf\n');
const STOP_YAML = 'service:\n  id: 9007199254740993\n  owner: ~';
for (const [lang, text] of Object.entries(pages)) {
  eq(lang + ' page shows the dates example input', text.includes('```yaml\n' + DATES_YAML + '\n```'), true);
  eq(lang + ' page shows the dates example output', text.includes('```toml\n' + datesToml + '```'), true);
  eq(lang + ' page shows the stop example input', text.includes('```yaml\n' + STOP_YAML + '\n```'), true);
  const msg = y2t(STOP_YAML, lang).replace(/^ERR /, '');
  eq(lang + ' page quotes the stop message: ' + msg, text.includes('<code>' + msg + '</code>'), true);
  eq(lang + ' page no longer says null becomes an empty string', /空字符串|空文字列|빈 문자열|empty string/.test(text), false);
  eq(lang + ' page states the js-yaml limits', text.includes('js-yaml 4.3.2') && text.includes('100') && text.includes('10,000'), true);
}
eq('en page names the parser versions', pages.en.includes('1.7.1 for TOML') && pages.en.includes('js-yaml</a> 4.3.2'), true);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
